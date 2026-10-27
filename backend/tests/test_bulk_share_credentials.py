"""
User Management -> Bulk Share Credentials test suite.

Tests bulk sharing of login credentials for multiple students:
1. Selecting multiple students and sending their credentials.
2. Admin permissions and Super Admin permissions.
3. Students with valid retained credentials.
4. Students without retained credentials.
5. Expired credentials.
6. SMTP failure for one student while other emails succeed.
7. Cross-organization access restrictions.
8. Inactive student accounts.
9. Duplicate and concurrent submissions.
10. Ensuring each email contains only its intended student's credentials.
11. Retrying failures without resending successful deliveries.
12. Preserving existing individual Share Credentials behavior.
"""
import copy
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
from services import email_service
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h
from tests.test_assessment_invitations import FakeSmtpServer, smtp  # noqa: F401

client = h.client
USERS = "/api/admin/users"
PW1 = "Zx9#pLm2!qWe-4417"
PW2 = "Rq7$kNv3@tYu-9021"
PW3 = "Wb5^mJk8#vCx-3184"
FRONTEND = "https://app.prepwin.test"


# ------------------------------------------------------------------------------ fixtures
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
    if hasattr(users_router, "_bulk_share_limiter"):
        users_router._bulk_share_limiter.reset()
    yield


def create_student(world, admin, name="Maya Patel", password=PW1, email=None):
    email = email or f"{name.lower().replace(' ', '.')}.{h.new_tag()}@students.example.org"
    r = client.post(f"{USERS}/", headers=h.auth(admin["token"]), json={"role": "STUDENT", "full_name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    world["created"].append(r.json()["user"]["id"])
    return r.json()["user"]


def share_individual(admin, user_id, org_id=None, body=None):
    return client.post(f"{USERS}/{user_id}/share-credentials", headers=h.auth(admin["token"], org_id), json=body or {})


def share_bulk(admin, user_ids, org_id=None):
    return client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(admin["token"], org_id), json={"user_ids": user_ids})


def mail_parts(msg):
    return (msg.get_body(preferencelist=("plain",)).get_content(), msg.get_body(preferencelist=("html",)).get_content())


# ------------------------------------------------------------------------------ Tests

def test_1_selecting_multiple_students_and_sending_credentials(db, world, smtp):
    """1. Multiple students with retained credentials get individual emails in a single bulk operation."""
    a = world["a"]
    s1 = create_student(world, a, "Student One", PW1)
    s2 = create_student(world, a, "Student Two", PW2)
    s3 = create_student(world, a, "Student Three", PW3)

    r = share_bulk(a, [s1["id"], s2["id"], s3["id"]])
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 3
    assert data["sent"] == 3
    assert data["failed"] == 0
    assert data["skipped"] == 0
    assert len(data["results"]) == 3

    assert len(smtp.sent) == 3
    sent_emails = [to_addr for to_addr, _ in smtp.sent]
    assert s1["email"] in sent_emails
    assert s2["email"] in sent_emails
    assert s3["email"] in sent_emails


def test_2_admin_and_super_admin_permissions(db, world, smtp):
    """2. Enforces caller permissions (Admin and Super Admin permitted; unauthenticated/student forbidden)."""
    a = world["a"]
    platform = world["platform"]
    s = create_student(world, a, "Perm Student", PW1)

    # Anonymous call rejected
    r_anon = client.post(f"{USERS}/share-credentials/bulk", json={"user_ids": [s["id"]]})
    assert r_anon.status_code in (401, 403)

    # Student caller rejected
    student_token = utils.create_access_token(data={"sub": s["email"], "role": "STUDENT"})
    r_student = client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(student_token), json={"user_ids": [s["id"]]})
    assert r_student.status_code == 403

    # Super Admin can bulk share
    r_super = share_bulk(platform, [s["id"]], org_id=a["org"].id)
    assert r_super.status_code == 200
    assert r_super.json()["sent"] == 1


def test_3_students_with_valid_retained_credentials(db, world, smtp):
    """3. Students with valid retained credentials are sent emails and retained rows are cleared."""
    a = world["a"]
    s = create_student(world, a, "Valid Student", PW1)

    # Credential row exists before send
    row_before = db.query(models.CredentialDelivery).filter_by(user_id=s["id"]).first()
    assert row_before is not None

    r = share_bulk(a, [s["id"]])
    assert r.status_code == 200
    assert r.json()["sent"] == 1

    # Credential row deleted after SMTP acceptance
    db.expire_all()
    row_after = db.query(models.CredentialDelivery).filter_by(user_id=s["id"]).first()
    assert row_after is None


def test_4_students_without_retained_credentials(db, world, smtp):
    """4. Student without retained credentials is marked as skipped with guidance to replace password."""
    a = world["a"]
    s = create_student(world, a, "No Cred Student", PW1)

    # Manually remove the retained password record
    db.query(models.CredentialDelivery).filter_by(user_id=s["id"]).delete()
    db.commit()

    r = share_bulk(a, [s["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["sent"] == 0
    assert data["skipped"] == 1
    result = data["results"][0]
    assert result["status"] == "skipped"
    assert result["code"] == "PASSWORD_NOT_AVAILABLE"
    assert "Replace password" in result["message"]
    assert len(smtp.sent) == 0


def test_5_expired_credentials(db, world, smtp):
    """5. Expired retained credentials are treated as unavailable and marked as skipped."""
    a = world["a"]
    s = create_student(world, a, "Expired Student", PW1)

    # Set expires_at in the past
    row = db.query(models.CredentialDelivery).filter_by(user_id=s["id"]).first()
    row.expires_at = assessment_clock.naive_utc(assessment_clock.now() - timedelta(hours=1))
    db.commit()

    r = share_bulk(a, [s["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["sent"] == 0
    assert data["skipped"] == 1
    assert data["results"][0]["status"] == "skipped"
    assert data["results"][0]["code"] == "PASSWORD_NOT_AVAILABLE"


def test_6_smtp_failure_one_student_others_succeed(db, world, smtp, monkeypatch):
    """6. SMTP failure for one student marks them as failed while other emails succeed."""
    a = world["a"]
    s1 = create_student(world, a, "SMTP Success 1", PW1)
    s2 = create_student(world, a, "SMTP Fail", PW2)
    s3 = create_student(world, a, "SMTP Success 2", PW3)

    real_send = email_service.send

    def mock_send(settings, to_email, subject, html_body, text_body, **kwargs):
        if to_email == s2["email"]:
            raise email_service.EmailSystemError("SMTP connection timed out")
        return real_send(settings, to_email, subject, html_body, text_body, **kwargs)

    monkeypatch.setattr(email_service, "send", mock_send)

    r = share_bulk(a, [s1["id"], s2["id"], s3["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 3
    assert data["sent"] == 2
    assert data["failed"] == 1
    assert data["skipped"] == 0

    results_by_id = {res["id"]: res for res in data["results"]}
    assert results_by_id[s1["id"]]["status"] == "sent"
    assert results_by_id[s2["id"]]["status"] == "failed"
    assert "timed out" in results_by_id[s2["id"]]["message"]
    assert results_by_id[s3["id"]]["status"] == "sent"

    # S2's credential was preserved for retry, while S1 and S3 were removed
    db.expire_all()
    assert db.query(models.CredentialDelivery).filter_by(user_id=s1["id"]).first() is None
    assert db.query(models.CredentialDelivery).filter_by(user_id=s2["id"]).first() is not None
    assert db.query(models.CredentialDelivery).filter_by(user_id=s3["id"]).first() is None


def test_7_cross_organization_access_restrictions(db, world, smtp):
    """7. Requester cannot manage student from another organization; reported unauthorized without leaking info."""
    a = world["a"]
    b = world["b"]
    s_a = create_student(world, a, "Org A Student", PW1)
    s_b = create_student(world, b, "Org B Student", PW2)

    # Admin A tries to bulk share to their own student and Admin B's student
    r = share_bulk(a, [s_a["id"], s_b["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2
    assert data["sent"] == 1
    assert data["skipped"] == 1  # unauthorized grouped under skipped count

    results_by_id = {res["id"]: res for res in data["results"]}
    assert results_by_id[s_a["id"]]["status"] == "sent"
    res_b = results_by_id[s_b["id"]]
    assert res_b["status"] == "unauthorized"
    assert res_b["name"] is None
    assert res_b["email"] is None
    assert "not found or you do not have permission" in res_b["message"].lower()

    # Only s_a received an email
    assert len(smtp.sent) == 1
    assert smtp.sent[0][0] == s_a["email"]


def test_8_inactive_student_accounts(db, world, smtp):
    """8. Inactive student account is skipped with a clear activation prompt."""
    a = world["a"]
    s = create_student(world, a, "Inactive Student", PW1)

    # Deactivate account
    client.post(f"{USERS}/{s['id']}/deactivate", headers=h.auth(a["token"]))

    r = share_bulk(a, [s["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["sent"] == 0
    assert data["skipped"] == 1
    assert data["results"][0]["status"] == "skipped"
    assert data["results"][0]["code"] == "ACCOUNT_INACTIVE"
    assert "Activate" in data["results"][0]["message"]
    assert len(smtp.sent) == 0


def test_9_duplicate_and_concurrent_submissions(db, world, smtp):
    """9. Duplicate IDs in a request are deduplicated; concurrent requests send credentials at most once."""
    a = world["a"]
    s1 = create_student(world, a, "Dup Student 1", PW1)
    s2 = create_student(world, a, "Dup Student 2", PW2)

    # Single request with duplicate IDs
    r = share_bulk(a, [s1["id"], s1["id"], s2["id"], s1["id"]])
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2
    assert data["sent"] == 2
    assert len(smtp.sent) == 2

    # Concurrent bulk shares for a new student
    smtp.sent.clear()
    s_conc = create_student(world, a, "Concurrent Student", PW1)

    barrier = threading.Barrier(2)
    responses = []

    def run_call():
        barrier.wait()
        res = share_bulk(a, [s_conc["id"]])
        responses.append(res)

    t1 = threading.Thread(target=run_call)
    t2 = threading.Thread(target=run_call)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert len(responses) == 2
    assert all(r.status_code == 200 for r in responses)

    # Across both concurrent calls, exactly 1 email was sent to smtp
    assert len(smtp.sent) == 1
    total_sent = sum(r.json()["sent"] for r in responses)
    assert total_sent == 1


def test_10_each_email_contains_only_intended_student_credentials(db, world, smtp):
    """10. Ensures each email contains only that student's credentials, no CC/BCC, no cross-contamination."""
    a = world["a"]
    s1 = create_student(world, a, "Isolate Maya", PW1)
    s2 = create_student(world, a, "Isolate Arjun", PW2)

    r = share_bulk(a, [s1["id"], s2["id"]])
    assert r.status_code == 200

    assert len(smtp.sent) == 2
    by_recipient = {to_addr: msg for to_addr, msg in smtp.sent}

    # Verify message to s1
    msg1 = by_recipient[s1["email"]]
    text1, html1 = mail_parts(msg1)
    assert PW1 in text1 and PW1 in html1
    assert PW2 not in text1 and PW2 not in html1
    assert s1["email"] in text1 and s1["email"] in html1
    assert s2["email"] not in text1 and s2["email"] not in html1
    assert not msg1.get("Cc") and not msg1.get("Bcc")

    # Verify message to s2
    msg2 = by_recipient[s2["email"]]
    text2, html2 = mail_parts(msg2)
    assert PW2 in text2 and PW2 in html2
    assert PW1 not in text2 and PW1 not in html2
    assert s2["email"] in text2 and s2["email"] in html2
    assert s1["email"] not in text2 and s1["email"] not in html2
    assert not msg2.get("Cc") and not msg2.get("Bcc")


def test_11_retrying_failures_without_resending_successful_deliveries(db, world, smtp, monkeypatch):
    """11. Retrying failed recipients does not resend credentials to already successful recipients."""
    a = world["a"]
    s1 = create_student(world, a, "Retry Success", PW1)
    s2 = create_student(world, a, "Retry Temp Fail", PW2)

    real_send = email_service.send

    def mock_send(settings, to_email, subject, html_body, text_body, **kwargs):
        if to_email == s2["email"]:
            raise email_service.EmailSystemError("Temporary SMTP error")
        return real_send(settings, to_email, subject, html_body, text_body, **kwargs)

    monkeypatch.setattr(email_service, "send", mock_send)

    # First attempt: s1 succeeds, s2 fails
    r1 = share_bulk(a, [s1["id"], s2["id"]])
    assert r1.status_code == 200
    assert r1.json()["sent"] == 1
    assert r1.json()["failed"] == 1
    assert len(smtp.sent) == 1
    assert smtp.sent[0][0] == s1["email"]

    # Restore real send and retry both
    monkeypatch.setattr(email_service, "send", real_send)
    smtp.sent.clear()

    r2 = share_bulk(a, [s1["id"], s2["id"]])
    assert r2.status_code == 200
    data2 = r2.json()
    # s1 is skipped (password was deleted upon earlier success), s2 is sent now
    assert data2["sent"] == 1
    assert data2["skipped"] == 1
    assert len(smtp.sent) == 1
    assert smtp.sent[0][0] == s2["email"]


def test_12_preserving_existing_individual_share_credentials_behavior(db, world, smtp):
    """12. Existing individual Share Credentials endpoint behavior is completely preserved."""
    a = world["a"]
    s = create_student(world, a, "Individual Share Student", PW1)

    r = share_individual(a, s["id"])
    assert r.status_code == 200
    assert r.json()["status"] == "sent"
    assert "accepted" in r.json()["message"]
    assert len(smtp.sent) == 1
    assert smtp.sent[0][0] == s["email"]


def test_validation_and_rate_limits(world):
    """Batch size validation (min 1, max 100) and rate limiting."""
    a = world["a"]

    # Empty user_ids
    r_empty = client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(a["token"]), json={"user_ids": []})
    assert r_empty.status_code == 422

    # Over 100 user_ids
    r_over = client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(a["token"]), json={"user_ids": list(range(1, 102))})
    assert r_over.status_code == 422

    # Rate limiting after 10 requests
    for _ in range(10):
        r = client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(a["token"]), json={"user_ids": [999999]})
        assert r.status_code == 200  # returns 200 with unauthorized/not found for non-existent id
    r_blocked = client.post(f"{USERS}/share-credentials/bulk", headers=h.auth(a["token"]), json={"user_ids": [999999]})
    assert r_blocked.status_code == 429
    assert "Too many bulk credential sharing requests" in r_blocked.text
