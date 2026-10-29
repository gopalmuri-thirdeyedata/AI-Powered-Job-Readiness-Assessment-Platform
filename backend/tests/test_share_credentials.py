"""
User Management -> Share: e-mail a student's login e-mail + assigned password.

SMTP is the fake server of the invitation tests (tests/conftest.py forbids real connections). The password is never recoverable from the
stored hash, so Share only works for a password the server was handed at account creation / Replace password (kept encrypted and
short-lived). These tests prove that, and that nothing leaks it (responses, logs, database, audit rows) or changes an account.
"""
import json
import logging
import smtplib
import threading
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import inspect, text

import database
import models
import utils
from services import assessment_clock
from services import credential_delivery as cd
from services import email_service
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h
from tests.test_assessment_invitations import FakeSmtpServer, smtp  # noqa: F401  (fixture + fake server)

client = h.client
USERS = "/api/admin/users"
PW = "Zx9#pLm2!qWe-4417"
PW2 = "Rq7$kNv3@tYu-9021"
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
    monkeypatch.setattr(cd, "ttl", cd.ttl)          # real TTL unless a test overrides it
    monkeypatch.delenv("CREDENTIAL_SHARE_TTL_MINUTES", raising=False)
    monkeypatch.delenv("CREDENTIAL_DELIVERY_KEY", raising=False)
    lah.reset_login_limits()
    yield


def create_student(world, admin, name="Maya Patel", password=PW, email=None):
    email = email or f"{name.lower().replace(' ', '.')}.{h.new_tag()}@students.example.org"
    r = client.post(f"{USERS}/", headers=h.auth(admin["token"]), json={"role": "STUDENT", "full_name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    world["created"].append(r.json()["user"]["id"])
    return r.json()["user"]


def share(admin, user_id, org_id=None, body=None):
    return client.post(f"{USERS}/{user_id}/share-credentials", headers=h.auth(admin["token"], org_id), json=body or {})


def pending(db, user_id):
    db.expire_all()
    return db.query(models.CredentialDelivery).filter_by(user_id=user_id).first()


def mail_text(msg):
    return (msg.get_body(preferencelist=("plain",)).get_content(), msg.get_body(preferencelist=("html",)).get_content())


def can_login(email, password, expect=200):
    lah.reset_login_limits()
    return lah.new_client().post("/api/auth/login/", json={"email": email, "password": password}).status_code == expect


def listed(admin, user_id, org_id=None):
    r = client.get(f"{USERS}/", headers=h.auth(admin["token"], org_id), params={"q": "", "page_size": 100})
    assert r.status_code == 200
    return next(i for i in r.json()["items"] if i["id"] == user_id), r.text


# ------------------------------------------------------------------------------ the happy path
def test_share_after_creation_sends_the_actual_credentials_and_nothing_else_leaks(db, world, smtp, caplog):
    a = world["a"]
    with caplog.at_level(logging.DEBUG):
        user = create_student(world, a, "Maya Patel")
        row, body = listed(a, user["id"])
        assert row["credentials_ready"] is True and PW not in body
        r = share(a, user["id"], body={"email": "attacker@evil.test", "password": "x", "to": "attacker@evil.test"})   # nothing from the browser is trusted
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sent" and PW not in r.text and "accepted" in r.json()["message"]

    (to_addr, msg), = smtp.sent
    assert to_addr == user["email"]                                                        # recipient comes from the database
    assert msg["Subject"] == "Your PrepWin Student Login Credentials"
    text_part, html_part = mail_text(msg)
    for part in (text_part, html_part):
        assert user["email"] in part and PW in part and f"{FRONTEND}/student/login" in part
        assert "Maya Patel" in part and "Keep your login credentials private." in part
        assert "{{" not in part and "}}" not in part                                      # no placeholder is ever sent
    assert "Login Email: " + user["email"] in text_part and "Password: " + PW in text_part
    for step in ("Open the PrepWin Student Login page.", "Enter your registered email address.",
                 "Enter the password provided in this email.", "Click Login to access your student account."):
        assert step in text_part and step in html_part
    assert text_part.rstrip().endswith("Regards,\nPrepWin Team")

    # the temporary copy is gone, the audit trail says who/what/outcome and never the secret, and nothing was logged
    assert pending(db, user["id"]) is None
    log = db.query(models.ActivityLog).filter_by(action="CREDENTIALS_SHARE_SENT", target=user["email"]).one()
    assert log.user_id == a["user"].id and log.details == f"student_user_id={user['id']}"
    assert PW not in caplog.text and PW not in json.dumps([log.action, log.target, log.details])
    # sharing never touched the account: the student signs in with exactly that password
    assert can_login(user["email"], PW)

    # delivered once: the password is no longer available, and the answer says what to do (no second e-mail)
    again = share(a, user["id"])
    assert again.status_code == 409 and again.json()["detail"]["code"] == "PASSWORD_NOT_AVAILABLE"
    assert "Replace password" in again.json()["detail"]["message"] and len(smtp.sent) == 1
    assert listed(a, user["id"])[0]["credentials_ready"] is False


def test_super_admin_shares_within_the_organization_it_targets(db, world, smtp):
    a, platform = world["a"], world["platform"]
    user = create_student(world, a, "Via Platform")
    r = share(platform, user["id"], org_id=a["org"].id)
    assert r.status_code == 200 and [addr for addr, _ in smtp.sent] == [user["email"]]
    # a super admin who names no organization has no scope at all
    other = create_student(world, a, "No Scope")
    assert share(platform, other["id"]).status_code in (400, 404) and len(smtp.sent) == 1


def test_a_super_admin_can_create_a_student_in_a_chosen_organization_and_share(db, world, smtp):
    platform, a = world["platform"], world["a"]
    r = client.post(f"{USERS}/", headers=h.auth(platform["token"], a["org"].id), json={
        "role": "STUDENT", "full_name": "Platform Created", "email": f"platform.created.{h.new_tag()}@students.example.org", "password": PW})
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    world["created"].append(uid)
    assert share(platform, uid, org_id=a["org"].id).status_code == 200
    assert PW in mail_text(smtp.sent[0][1])[0]


# ------------------------------------------------------------------------------ authorization
def test_unauthorized_callers_are_refused_and_nothing_is_sent(db, world, smtp):
    a, b = world["a"], world["b"]
    user = create_student(world, a, "Protected Student")
    assert client.post(f"{USERS}/{user['id']}/share-credentials").status_code in (401, 403)           # anonymous
    student_token = utils.create_access_token(data={"sub": user["email"], "role": "STUDENT"})
    assert client.post(f"{USERS}/{user['id']}/share-credentials", headers=h.auth(student_token)).status_code == 403   # a student
    assert share(b, user["id"]).status_code == 404                                                      # another organization: no existence leak
    assert smtp.send_calls == 0 and pending(db, user["id"]) is not None                                 # untouched, still shareable by its owner


def test_credentials_can_only_be_shared_for_student_accounts(db, world, smtp):
    a, platform = world["a"], world["platform"]
    admin_row = client.post(f"{USERS}/", headers=h.auth(platform["token"], a["org"].id), json={
        "role": "ADMIN", "full_name": "Some Admin", "email": f"some.admin.{h.new_tag()}@students.example.org", "password": PW}).json()["user"]
    super_row = client.post(f"{USERS}/", headers=h.auth(platform["token"], a["org"].id), json={
        "role": "SUPER_ADMIN", "full_name": "Other Super", "email": f"other.super.{h.new_tag()}@students.example.org", "password": PW}).json()["user"]
    world["created"] += [admin_row["id"], super_row["id"]]
    for target in (admin_row, super_row):
        r = share(platform, target["id"], org_id=a["org"].id)
        assert r.status_code == 403 and "student" in r.json()["detail"].lower()
    assert share(a, admin_row["id"]).status_code == 403                                                    # an Admin cannot manage Admins at all
    assert db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id.in_([admin_row["id"], super_row["id"]])).count() == 0
    assert smtp.send_calls == 0                                                                           # admin passwords are never retained


def test_deactivated_students_are_refused(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Gone Soon")
    assert client.post(f"{USERS}/{user['id']}/deactivate", headers=h.auth(a["token"])).status_code == 200
    r = share(a, user["id"])
    assert r.status_code == 409 and "Activate" in r.json()["detail"] and smtp.send_calls == 0


# ------------------------------------------------------------------------------ existing accounts, Replace password
def test_an_existing_account_whose_password_is_unavailable_is_never_silently_changed(db, world, smtp):
    a = world["a"]
    old_hash_user = lah.ensure_user(db, f"legacy.{h.new_tag()}@students.example.org", "STUDENT", org=a["org"], password=PW, student_profile=True, full_name="Legacy Student")
    world["created"].append(old_hash_user.id)
    before = old_hash_user.hashed_password
    row, _ = listed(a, old_hash_user.id)
    assert row["credentials_ready"] is False
    r = share(a, old_hash_user.id)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PASSWORD_NOT_AVAILABLE"
    assert smtp.send_calls == 0
    db.expire_all()
    assert db.query(models.User).filter_by(id=old_hash_user.id).one().hashed_password == before        # no silent replacement
    assert can_login(old_hash_user.email, PW)


def test_replace_password_then_share_sends_the_new_password(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Replaced Student")
    r = client.post(f"{USERS}/{user['id']}/reset-password", headers=h.auth(a["token"]), json={"new_password": PW2})
    assert r.status_code == 200 and PW2 not in r.text
    assert listed(a, user["id"])[0]["credentials_ready"] is True
    assert share(a, user["id"]).status_code == 200
    text_part, _ = mail_text(smtp.sent[0][1])
    assert PW2 in text_part and PW not in text_part                                                       # the CURRENT password, not the first one
    assert can_login(user["email"], PW2) and can_login(user["email"], PW, expect=401)


def test_a_password_the_student_changed_is_never_sent(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Changed Mind")
    c, res = lah.login(user["email"], PW)
    c.headers["X-CSRF-Token"] = res.json()["csrf_token"]
    assert c.post("/api/auth/change-password/", json={"current_password": PW, "new_password": PW2}).status_code == 200
    assert pending(db, user["id"]) is None                                                                # invalidated by the change itself
    assert share(a, user["id"]).status_code == 409 and smtp.send_calls == 0


def test_a_retained_password_that_no_longer_matches_the_account_is_refused_and_deleted(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Mismatch Case")
    row = db.query(models.User).filter_by(id=user["id"]).one()
    row.hashed_password = utils.get_password_hash(PW2)                                                    # changed outside the app's own paths
    db.commit()
    r = share(a, user["id"])
    assert r.status_code == 409 and smtp.send_calls == 0 and pending(db, user["id"]) is None


def test_ciphertext_is_bound_to_its_student(db, world, smtp):
    a = world["a"]
    one, two = create_student(world, a, "Student One"), create_student(world, a, "Student Two", password=PW2)
    r1, r2 = pending(db, one["id"]), pending(db, two["id"])
    r2.ciphertext = r1.ciphertext                                                                         # a swapped row
    db.commit()
    assert share(a, two["id"]).status_code == 409 and smtp.send_calls == 0
    assert pending(db, two["id"]) is None


# ------------------------------------------------------------------------------ retention rules
def test_retention_expires_and_can_be_disabled(db, world, smtp, monkeypatch):
    a = world["a"]
    user = create_student(world, a, "Expiring Student")
    clock = h.FakeClock(datetime.now(timezone.utc) + timedelta(minutes=cd.DEFAULT_TTL_MINUTES + 1))
    monkeypatch.setattr(assessment_clock, "now", clock.now)
    assert listed(a, user["id"])[0]["credentials_ready"] is False
    r = share(a, user["id"])
    assert r.status_code == 409 and smtp.send_calls == 0 and pending(db, user["id"]) is None             # expired material is deleted

    monkeypatch.undo()
    monkeypatch.setenv("CREDENTIAL_SHARE_TTL_MINUTES", "0")
    off = create_student(world, a, "Not Retained")
    assert pending(db, off["id"]) is None and share(a, off["id"]).status_code == 409


def test_nothing_is_retained_when_e_mail_is_not_configured(db, world, smtp, monkeypatch):
    a = world["a"]
    monkeypatch.delenv("SMTP_HOST", raising=False)
    user = create_student(world, a, "No Smtp Yet")
    assert pending(db, user["id"]) is None                                                                # no point keeping a secret that cannot be sent
    r = share(a, user["id"])
    assert r.status_code == 503 and "SMTP_HOST" in r.json()["detail"]["message"]


def test_no_plaintext_password_anywhere_in_the_database(db, world, smtp):
    a = world["a"]
    marker = "Pl4intext-Marker!Zq9"
    user = create_student(world, a, "Scan Student", password=marker)
    client.post(f"{USERS}/{user['id']}/reset-password", headers=h.auth(a["token"]), json={"new_password": marker + "x"})
    row = pending(db, user["id"])
    assert row is not None and marker not in row.ciphertext and not any(c in row.ciphertext for c in (" ", "\n"))
    insp = inspect(database.engine)
    with database.engine.connect() as conn:
        for table in insp.get_table_names():
            for rec in conn.execute(text(f'SELECT * FROM "{table}"')).fetchall():
                for value in rec:
                    if isinstance(value, (str, bytes)):
                        v = value.decode("utf-8", "ignore") if isinstance(value, bytes) else value
                        assert marker not in v, f"plaintext password found in {table}"
    assert "password" not in {c["name"] for c in insp.get_columns("credential_deliveries")}
    assert utils.verify_password(marker + "x", db.query(models.User).filter_by(id=user["id"]).one().hashed_password)   # hashing unchanged


def test_ordinary_account_apis_never_return_a_password(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Api Student")
    bodies = [client.get(f"{USERS}/", headers=h.auth(a["token"])).text, client.get(f"{USERS}/{user['id']}", headers=h.auth(a["token"])).text,
              client.get(f"/api/admin/job-roles/", headers=h.auth(a["token"])).text]
    created = client.post(f"{USERS}/", headers=h.auth(a["token"]), json={"role": "STUDENT", "full_name": "Echo Check", "email": f"echo.{h.new_tag()}@students.example.org", "password": PW2})
    world["created"].append(created.json()["user"]["id"])
    bodies.append(created.text)
    for body in bodies:
        assert PW not in body and PW2 not in body and "ciphertext" not in body and "hashed_password" not in body


# ------------------------------------------------------------------------------ SMTP failures and retries
def test_missing_or_invalid_smtp_configuration(db, world, smtp, monkeypatch):
    a = world["a"]
    user = create_student(world, a, "Config Case")
    monkeypatch.setenv("SMTP_PORT", "not-a-port")
    r = share(a, user["id"])
    assert r.status_code == 503 and r.json()["detail"]["code"] == "EMAIL_NOT_CONFIGURED" and PW not in r.text
    assert pending(db, user["id"]) is not None and smtp.send_calls == 0                                   # kept: fixing the config makes a retry possible
    monkeypatch.setenv("SMTP_PORT", "587")
    assert share(a, user["id"]).status_code == 200


@pytest.mark.parametrize("setup,code", [
    (lambda s, email: setattr(s, "login_error", smtplib.SMTPAuthenticationError(535, b"bad credentials Zx9")), "EMAIL_UNAVAILABLE"),
    (lambda s, email: setattr(s, "connect_error", ConnectionRefusedError("refused by mail.prepwin.test")), "EMAIL_UNAVAILABLE"),
    (lambda s, email: setattr(s, "starttls_offered", False), "EMAIL_UNAVAILABLE"),
    (lambda s, email: s.refuse.add(email), "EMAIL_REJECTED"),
])
def test_delivery_failures_are_explained_without_secrets_and_change_nothing(db, world, smtp, caplog, setup, code):
    a = world["a"]
    user = create_student(world, a, "Failure Case")
    setup(smtp, user["email"])
    before = db.query(models.User).filter_by(id=user["id"]).one().hashed_password
    with caplog.at_level(logging.DEBUG):
        r = share(a, user["id"])
    assert r.status_code == 502 and r.json()["detail"]["code"] == code, r.text
    assert "you can try again" in r.json()["detail"]["message"]
    for forbidden in (PW, "Zx9", "mail.prepwin.test", "Traceback"):
        assert forbidden not in r.text and forbidden not in caplog.text
    row = pending(db, user["id"])
    assert row is not None and row.sending_at is None and row.last_error and PW not in row.last_error        # kept for a retry, claim released
    db.expire_all()
    assert db.query(models.User).filter_by(id=user["id"]).one().hashed_password == before                   # the account is unchanged
    assert db.query(models.ActivityLog).filter_by(action="CREDENTIALS_SHARE_FAILED", target=user["email"]).count() == 1
    assert smtp.sent == []
    assert can_login(user["email"], PW)


def test_a_failed_send_can_be_retried_and_a_temporary_failure_is_retried_automatically(db, world, smtp, monkeypatch):
    a = world["a"]
    monkeypatch.setattr(email_service, "_sleep", lambda s: None)
    user = create_student(world, a, "Retry Case")
    smtp.script[user["email"]] = [smtplib.SMTPResponseException(451, b"try later")] * email_service.MAX_ATTEMPTS
    assert share(a, user["id"]).status_code == 502                                                        # transient failures exhausted
    assert smtp.send_calls == email_service.MAX_ATTEMPTS and pending(db, user["id"]).attempts == 1
    r = share(a, user["id"])                                                                             # the safe retry
    assert r.status_code == 200 and len(smtp.sent) == 1
    assert pending(db, user["id"]) is None
    flaky = create_student(world, a, "Flaky Case")
    smtp.script[flaky["email"]] = [smtplib.SMTPServerDisconnected("dropped")]
    assert share(a, flaky["id"]).status_code == 200                                                       # recovered inside one request


def test_duplicate_requests_cannot_send_twice(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Double Click")
    # a send already in flight (fresh claim): refused, nothing sent, the record is untouched
    row = pending(db, user["id"])
    row.sending_at = assessment_clock.naive_utc(assessment_clock.now())
    db.commit()
    r = share(a, user["id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "SEND_IN_PROGRESS" and smtp.send_calls == 0
    # a claim left by a crashed request is recoverable
    row = pending(db, user["id"])
    row.sending_at = assessment_clock.naive_utc(assessment_clock.now() - cd.CLAIM_STALE - timedelta(seconds=5))
    db.commit()
    assert share(a, user["id"]).status_code == 200


def test_concurrent_shares_send_exactly_one_email(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Race Student")
    codes = []
    threads = [threading.Thread(target=lambda: codes.append(share(a, user["id"]).status_code)) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes.count(200) == 1 and set(codes) <= {200, 409}
    assert len(smtp.sent) == 1


def test_production_refuses_a_localhost_login_link(db, world, smtp, monkeypatch):
    a = world["a"]
    user = create_student(world, a, "Prod Check")
    monkeypatch.setattr(utils, "is_production", lambda: True)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:5173")
    r = share(a, user["id"])
    assert r.status_code == 503 and r.json()["detail"]["code"] == "FRONTEND_URL_NOT_CONFIGURED" and smtp.send_calls == 0
    assert pending(db, user["id"]) is not None


# ------------------------------------------------------------------------------ template, encryption, regression
def test_template_escapes_html_and_has_no_placeholders():
    r = cd.render_email(student_name='<b>Eve</b> & "Co"', student_email="eve@students.example.org", password='A<b>&"x1Z9\'', url="https://app.test/student/login?a=1&b=2")
    assert "<b>Eve</b>" not in r.html and "&lt;b&gt;Eve&lt;/b&gt;" in r.html
    assert "A&lt;b&gt;&amp;&quot;x1Z9" in r.html and "a=1&amp;b=2" in r.html
    assert 'A<b>&"x1Z9\'' in r.text                                                                      # the plain-text part is verbatim
    assert "{{" not in r.html + r.text and r.subject == "Your PrepWin Student Login Credentials"
    assert cd.render_email(student_name=None, student_email="x@y.org", password="p", url="u").text.startswith("Hello Student,")


def test_template_has_recommended_websites_and_keeps_login_unchanged():
    url = "https://app.test/student/login"
    r = cd.render_email(student_name="Eve", student_email="eve@students.example.org", password="Pw-1234", url=url)
    sites = [("Neev Learning Platform", "https://neev.learningpath.ai/"), ("Interviewer Platform", "https://interviewer.learningpath.ai/")]
    for name, link in sites:
        assert f'<a href="{link}"' in r.html and f">{link}</a>" in r.html and name in r.html
        assert f"- {name}: {link}" in r.text
    for body in (r.html, r.text):
        assert "Recommended Websites" in body
        assert "We also recommend exploring the following platforms to enhance your learning and interview preparation:" in body
        assert "Visit these websites to explore the available learning resources and interview preparation opportunities." in body
        assert body.index("Keep your login credentials private.") < body.index("Recommended Websites") < body.index("Regards,")
    # the existing login button / link, username and password are untouched
    assert f'<a href="{url}" style="display:inline-block' in r.html and ">Open PrepWin Student Login</a>" in r.html
    assert f"Student Login: {url}" in r.text and "Login Email: eve@students.example.org" in r.text and "Password: Pw-1234" in r.text
    assert "eve@students.example.org" in r.html and "Pw-1234" in r.html


def test_encryption_roundtrip_key_binding_and_explicit_key(monkeypatch):
    token = cd._seal(7, "s3cret!")
    assert "s3cret" not in token and cd._open(7, token) == "s3cret!"
    assert cd._open(8, token) is None and cd._open(7, token[:-3] + "AAA") is None
    from cryptography.fernet import Fernet
    monkeypatch.setenv("CREDENTIAL_DELIVERY_KEY", Fernet.generate_key().decode())
    assert cd._open(7, token) is None                                                                    # another key cannot read it
    assert cd._open(7, cd._seal(7, "other")) == "other"


def test_existing_creation_login_and_management_actions_still_work(db, world, smtp):
    a = world["a"]
    user = create_student(world, a, "Regression Student")
    assert can_login(user["email"], PW)
    assert client.get(f"{USERS}/{user['id']}", headers=h.auth(a["token"])).json()["email"] == user["email"]
    assert client.patch(f"{USERS}/{user['id']}", headers=h.auth(a["token"]), json={"full_name": "Renamed Student"}).status_code == 200
    assert client.post(f"{USERS}/{user['id']}/deactivate", headers=h.auth(a["token"])).status_code == 200
    assert client.post(f"{USERS}/{user['id']}/activate", headers=h.auth(a["token"])).status_code == 200
    dup = client.post(f"{USERS}/", headers=h.auth(a["token"]), json={"role": "STUDENT", "full_name": "Dup", "email": user["email"], "password": PW2})
    assert dup.status_code == 409
    weak = client.post(f"{USERS}/", headers=h.auth(a["token"]), json={"role": "STUDENT", "full_name": "Weak", "email": f"weak.{h.new_tag()}@students.example.org", "password": "short"})
    assert weak.status_code == 422
    assert db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id.notin_(world["created"])).count() == 0


def test_migration_creates_the_table_once_and_touches_nothing_else(tmp_path):
    import migrate_credential_delivery as migration
    from sqlalchemy import create_engine
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(150), hashed_password VARCHAR(255))"))
        conn.execute(text("INSERT INTO users (email, hashed_password) VALUES ('keep@example.org', 'hash-untouched')"))
    assert migration.apply(engine) == ["credential_deliveries"]
    assert migration.apply(engine) == []                                     # a restart / re-run is a no-op
    cols = {c["name"] for c in inspect(engine).get_columns("credential_deliveries")}
    assert {"user_id", "ciphertext", "expires_at", "sending_at", "attempts", "last_error"} <= cols and "password" not in cols
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email, hashed_password FROM users")).one() == ("keep@example.org", "hash-untouched")
