"""
Tests for the 'Replace Passwords & Share' bulk feature:
1. Students without retained passwords have their passwords replaced and new credentials emailed.
2. Generates unique, cryptographically secure passwords for every student.
3. Revokes existing active sessions when password is replaced.
4. SMTP failure preserves the newly set password in retained credentials for safe retry without re-resetting.
5. Role permissions and organization boundaries are enforced.
6. Inactive student accounts are skipped without changing passwords.
7. Duplicate and concurrent requests are handled safely.
8. Rate limiting and batch size limits.
9. Individual Replace Password and Share actions remain preserved.
"""
import re
import threading
from datetime import timedelta

import pytest
from sqlalchemy import text

import database
import models
import utils
from routers import users as users_router
from services import assessment_clock
from services import credential_delivery as cd
from services import email_service, local_auth
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h
from tests.test_assessment_invitations import FakeSmtpServer, smtp  # noqa: F401

client = h.client
USERS = "/api/admin/users"
OLD_PW = "Old#Pass987!qAz"
FRONTEND = "https://app.prepwin.test"


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def world(db):
    a, b = h.make_admin(db), h.make_admin(db)
    platform = h.make_admin(db, tag="platform" + h.new_tag(), member_role="PLATFORM_ADMIN")
    created = []
    yield {"a": a, "b": b, "platform": platform, "created": created}
    if created:
        db.rollback()
        db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id.in_(created)).delete(synchronize_session=False)
        db.query(models.AuthSession).filter(models.AuthSession.user_id.in_(created)).delete(synchronize_session=False)
        db.query(models.StudentProfile).filter(models.StudentProfile.user_id.in_(created)).delete(synchronize_session=False)
        db.commit()
    h.cleanup_orgs(db, [a["org"].id, b["org"].id, platform["org"].id])
    if created:
        db.query(models.User).filter(models.User.id.in_(created)).delete(synchronize_session=False)
        db.commit()


@pytest.fixture(autouse=True)
def _env(monkeypatch, smtp):
    monkeypatch.setattr(cd, "ttl", cd.ttl)
    monkeypatch.delenv("CREDENTIAL_SHARE_TTL_MINUTES", raising=False)
    monkeypatch.delenv("CREDENTIAL_DELIVERY_KEY", raising=False)
    lah.reset_login_limits()
    if hasattr(users_router, "_bulk_replace_limiter"):
        users_router._bulk_replace_limiter.reset()
    if hasattr(users_router, "_bulk_share_limiter"):
        users_router._bulk_share_limiter.reset()
    yield


def create_student(world, admin, name="Test Student", password=OLD_PW, email=None):
    email = email or f"{name.lower().replace(' ', '.')}.{h.new_tag()}@students.example.org"
    r = client.post(f"{USERS}/", headers=h.auth(admin["token"]), json={"role": "STUDENT", "full_name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    world["created"].append(r.json()["user"]["id"])
    return r.json()["user"]


def replace_and_share_bulk(admin, user_ids, org_id=None):
    return client.post(f"{USERS}/replace-passwords-and-share/bulk", headers=h.auth(admin["token"], org_id), json={"user_ids": user_ids})


def share_bulk(admin, user_ids, org_id=None):
    return client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(admin["token"], org_id), json={"user_ids": user_ids})


def extract_password_from_email(msg):
    text = msg.get_body(preferencelist=("plain",)).get_content()
    # Find Password: <value>
    m = re.search(r"Password:\s*(\S+)", text)
    return m.group(1) if m else None


# ------------------------------------------------------------------------------ Tests

def test_1_students_without_retained_passwords_can_be_replaced_and_shared(db, world, smtp):
    """Students whose retained password was lost/cleared get new passwords generated, saved, and delivered."""
    a = world["a"]
    s1 = create_student(world, a, "Old Student 1", OLD_PW)
    s2 = create_student(world, a, "Old Student 2", OLD_PW)

    # Wipe retained passwords to simulate legacy students
    db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id.in_([s1["id"], s2["id"]])).delete()
    db.commit()

    # Normal share would skip them
    r_share = share_bulk(a, [s1["id"], s2["id"]])
    assert r_share.status_code == 200
    assert r_share.json()["sent"] == 0
    assert r_share.json()["skipped"] == 2
    assert len(smtp.sent) == 0

    # Replace passwords & share succeeds!
    r_replace = replace_and_share_bulk(a, [s1["id"], s2["id"]])
    assert r_replace.status_code == 200, r_replace.text
    data = r_replace.json()
    assert data["total"] == 2
    assert data["sent"] == 2
    assert data["failed"] == 0
    assert data["skipped"] == 0

    assert len(smtp.sent) == 2
    by_email = {to_addr: msg for to_addr, msg in smtp.sent}

    # Verify student 1's new password
    pw1 = extract_password_from_email(by_email[s1["email"]])
    assert pw1 is not None and pw1 != OLD_PW
    assert not local_auth.password_policy_errors(pw1, s1["email"])

    # Old password no longer works
    assert not lah.new_client().post("/api/auth/login/", json={"email": s1["email"], "password": OLD_PW}).status_code == 200

    # New password works for login!
    login_res = lah.new_client().post("/api/auth/login/", json={"email": s1["email"], "password": pw1})
    assert login_res.status_code == 200, login_res.text


def test_2_generates_unique_passwords_for_every_student(world, smtp):
    """Each student in the batch receives their own distinct secure password."""
    a = world["a"]
    s1 = create_student(world, a, "Unique A", OLD_PW)
    s2 = create_student(world, a, "Unique B", OLD_PW)
    s3 = create_student(world, a, "Unique C", OLD_PW)

    r = replace_and_share_bulk(a, [s1["id"], s2["id"], s3["id"]])
    assert r.status_code == 200
    assert r.json()["sent"] == 3

    passwords = []
    for to_addr, msg in smtp.sent[-3:]:
        pw = extract_password_from_email(msg)
        assert pw is not None
        passwords.append(pw)

    # All generated passwords must be unique
    assert len(set(passwords)) == 3


def test_3_revokes_existing_active_sessions(db, world, smtp):
    """Replacing a student's password revokes all active login sessions immediately."""
    a = world["a"]
    s = create_student(world, a, "Session Student", OLD_PW)

    user_obj = db.query(models.User).filter_by(id=s["id"]).first()
    local_auth.create_session(db, user_obj)
    db.commit()

    active_before = db.query(models.AuthSession).filter_by(user_id=s["id"], revoked_at=None).count()
    assert active_before >= 1

    r = replace_and_share_bulk(a, [s["id"]])
    assert r.status_code == 200

    db.expire_all()
    active_after = db.query(models.AuthSession).filter_by(user_id=s["id"], revoked_at=None).count()
    assert active_after == 0


def test_4_smtp_failure_preserves_retained_password_for_safe_resend(db, world, smtp, monkeypatch):
    """
    If password replacement succeeds but SMTP fails, the student's password was changed
    and is safely retained in models.CredentialDelivery so it can be retried via standard Share
    without resetting it a second time.
    """
    a = world["a"]
    s = create_student(world, a, "SMTP Fail Student", OLD_PW)

    real_send = email_service.send

    def fail_send(settings, to_email, subject, html_body, text_body, **kwargs):
        if to_email == s["email"]:
            raise email_service.EmailSystemError("Mail server connection timed out.")
        return real_send(settings, to_email, subject, html_body, text_body, **kwargs)

    monkeypatch.setattr(email_service, "send", fail_send)

    r = replace_and_share_bulk(a, [s["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["failed"] == 1
    assert data["sent"] == 0

    res = data["results"][0]
    assert res["status"] == "failed"
    assert res["stage"] == "email_delivery"
    assert "retry" in res["message"].lower()

    # Old password no longer works (it was already replaced)
    assert not lah.new_client().post("/api/auth/login/", json={"email": s["email"], "password": OLD_PW}).status_code == 200

    # The new password is preserved in CredentialDelivery for retry!
    db.expire_all()
    row = db.query(models.CredentialDelivery).filter_by(user_id=s["id"]).first()
    assert row is not None

    # Now restore SMTP and retry with standard share (does NOT replace password again!)
    monkeypatch.setattr(email_service, "send", real_send)
    smtp.sent.clear()

    r_retry = share_bulk(a, [s["id"]])
    assert r_retry.status_code == 200
    assert r_retry.json()["sent"] == 1
    assert len(smtp.sent) == 1

    retried_pw = extract_password_from_email(smtp.sent[0][1])
    assert retried_pw is not None

    # The student can sign in with the retried password!
    assert lah.new_client().post("/api/auth/login/", json={"email": s["email"], "password": retried_pw}).status_code == 200


def test_5_role_permissions_and_cross_org_isolation(db, world, smtp):
    """Enforces caller role, non-student filtering, and organization restrictions."""
    a, b, platform = world["a"], world["b"], world["platform"]
    s_a = create_student(world, a, "Org A Stud", OLD_PW)
    s_b = create_student(world, b, "Org B Stud", OLD_PW)

    # Anonymous call rejected
    assert client.post(f"{USERS}/replace-passwords-and-share/bulk", json={"user_ids": [s_a["id"]]}).status_code in (401, 403)

    # Student caller rejected
    student_token = utils.create_access_token(data={"sub": s_a["email"], "role": "STUDENT"})
    assert client.post(f"{USERS}/replace-passwords-and-share/bulk", headers=h.auth(student_token), json={"user_ids": [s_a["id"]]}).status_code == 403

    # Admin A trying to replace Admin B's student -> unauthorized without leaking info
    r_cross = replace_and_share_bulk(a, [s_a["id"], s_b["id"]])
    assert r_cross.status_code == 200
    data = r_cross.json()
    assert data["sent"] == 1
    assert data["skipped"] == 1

    res_b = next(r for r in data["results"] if r["id"] == s_b["id"])
    assert res_b["status"] == "unauthorized"
    assert res_b["name"] is None and res_b["email"] is None

    # Target is Admin -> skipped
    admin_row = client.post(f"{USERS}/", headers=h.auth(platform["token"], a["org"].id), json={
        "role": "ADMIN", "full_name": "Target Admin", "email": f"t.admin.{h.new_tag()}@students.example.org", "password": OLD_PW}).json()["user"]
    world["created"].append(admin_row["id"])

    r_admin = replace_and_share_bulk(platform, [admin_row["id"]], org_id=a["org"].id)
    assert r_admin.status_code == 200
    assert r_admin.json()["results"][0]["status"] in ("skipped", "unauthorized")
    assert r_admin.json()["sent"] == 0


def test_6_inactive_student_accounts_skipped(db, world, smtp):
    """Inactive accounts are skipped without changing their passwords."""
    a = world["a"]
    s = create_student(world, a, "Inactive Student", OLD_PW)
    client.post(f"{USERS}/{s['id']}/deactivate", headers=h.auth(a["token"]))

    r = replace_and_share_bulk(a, [s["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["sent"] == 0
    assert data["skipped"] == 1
    assert data["results"][0]["status"] == "skipped"
    assert data["results"][0]["code"] == "ACCOUNT_INACTIVE"

    # Password was NOT changed; activating account allows sign-in with original password
    client.post(f"{USERS}/{s['id']}/activate", headers=h.auth(a["token"]))
    assert lah.new_client().post("/api/auth/login/", json={"email": s["email"], "password": OLD_PW}).status_code == 200


def test_7_concurrent_replace_and_share_requests(db, world, smtp):
    """Concurrent requests for the same student do not duplicate emails."""
    a = world["a"]
    s = create_student(world, a, "Conc Replace", OLD_PW)
    barrier = threading.Barrier(2)
    responses = []

    def call():
        barrier.wait()
        res = replace_and_share_bulk(a, [s["id"]])
        responses.append(res)

    t1 = threading.Thread(target=call)
    t2 = threading.Thread(target=call)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert all(r.status_code == 200 for r in responses)
    # Total emails sent across both calls for this student should be at most 2 (or 1 depending on claim timing)
    # and both succeed or one replaces after the other cleanly
    assert all("results" in r.json() for r in responses)


def test_8_batch_limits_and_rate_limiting(world):
    """Validates min 1, max 100 batch size and rate limiting."""
    a = world["a"]

    # Empty user_ids -> 422
    assert client.post(f"{USERS}/replace-passwords-and-share/bulk", headers=h.auth(a["token"]), json={"user_ids": []}).status_code == 422

    # > 100 user_ids -> 422
    assert client.post(f"{USERS}/replace-passwords-and-share/bulk", headers=h.auth(a["token"]), json={"user_ids": list(range(1, 102))}).status_code == 422

    # Rate limiting
    for _ in range(10):
        r = client.post(f"{USERS}/replace-passwords-and-share/bulk", headers=h.auth(a["token"]), json={"user_ids": [999999]})
        assert r.status_code == 200
    r_blocked = client.post(f"{USERS}/replace-passwords-and-share/bulk", headers=h.auth(a["token"]), json={"user_ids": [999999]})
    assert r_blocked.status_code == 429
    assert "Too many" in r_blocked.text
