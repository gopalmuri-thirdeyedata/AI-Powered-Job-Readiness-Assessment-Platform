"""
E-mail invitations to a published assessment link. SMTP is always a fake server (tests/conftest.py forbids real connections);
time is the controllable server clock. Covers: student scope + authorization, successful submission, missing/invalid SMTP
configuration, connection/authentication failures, partial failure, bounded retries, duplicate requests, expired/closed links,
and that manual link sharing and the assessment rules are untouched.
"""
import logging
import smtplib
from datetime import datetime, timedelta, timezone

import pytest

import models
import utils
from services import assessment_clock
from services import assessment_invitation_service as invitations
from services import email_service
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h

client = h.client
ROLES = "/api/admin/job-roles"
PASSWORD = "S3cret-Smtp-Pa55word"
FRONTEND = "https://app.prepwin.test"


# ------------------------------------------------------------------------------ fake SMTP server
class FakeSmtpServer:
    """Records everything; failures are scripted. Installed over smtplib.SMTP / SMTP_SSL."""

    def __init__(self):
        self.connections = []       # (kind, host, port)
        self.logins = []
        self.sent = []              # (to_addr, EmailMessage)
        self.send_calls = 0
        self.connect_error = None
        self.login_error = None
        self.starttls_offered = True
        self.starttls_used = 0
        self.refuse = set()                  # addresses refused permanently (550)
        self.script = {}                     # address -> list of exceptions to raise on successive sends

    def factory(self, kind):
        server = self

        class Conn:
            def __init__(self, host, port, timeout=None, context=None):
                if server.connect_error:
                    raise server.connect_error
                server.connections.append((kind, host, port))

            def ehlo(self):
                return (250, b"ok")

            def has_extn(self, name):
                return server.starttls_offered if name == "starttls" else False

            def starttls(self, context=None):
                server.starttls_used += 1

            def login(self, user, password):
                server.logins.append((user, password))
                if server.login_error:
                    raise server.login_error

            def send_message(self, msg, from_addr=None, to_addrs=None):
                server.send_calls += 1
                addr = to_addrs[0]
                queued = server.script.get(addr)
                if queued:
                    raise queued.pop(0)
                if addr in server.refuse:
                    raise smtplib.SMTPRecipientsRefused({addr: (550, b"mailbox unavailable")})
                server.sent.append((addr, msg))
                return {}

            def quit(self):
                return (221, b"bye")

            def close(self):
                pass

        return Conn


@pytest.fixture
def smtp(monkeypatch):
    server = FakeSmtpServer()
    monkeypatch.setattr(smtplib, "SMTP", server.factory("plain"))
    monkeypatch.setattr(smtplib, "SMTP_SSL", server.factory("ssl"))
    monkeypatch.setattr(email_service, "_sleep", lambda s: None)
    monkeypatch.setenv("SMTP_HOST", "mail.prepwin.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "mailer@prepwin.test")
    monkeypatch.setenv("SMTP_PASSWORD", PASSWORD)
    monkeypatch.setenv("SMTP_FROM", "PrepWin <mailer@prepwin.test>")
    monkeypatch.delenv("SMTP_SECURITY", raising=False)
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    return server


@pytest.fixture
def clock(monkeypatch):
    fake = h.FakeClock(datetime(2030, 1, 15, 9, 0, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(assessment_clock, "now", fake.now)
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    yield fake
    h.reset_public_limiters()


# ------------------------------------------------------------------------------ data
@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def tenants(db):
    a = h.make_admin(db)
    b = h.make_admin(db)
    platform = h.make_admin(db, tag="platform" + h.new_tag(), member_role="PLATFORM_ADMIN")
    created = []
    yield {"a": a, "b": b, "platform": platform, "created": created}
    ids = created
    if ids:
        db.rollback()
        db.query(models.AssessmentInvitation).filter(models.AssessmentInvitation.student_user_id.in_(ids)).delete(synchronize_session=False)
        db.query(models.StudentProfile).filter(models.StudentProfile.user_id.in_(ids)).delete(synchronize_session=False)
        db.query(models.User).filter(models.User.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    db.query(models.AssessmentInvitation).filter(models.AssessmentInvitation.organization_id.in_(
        [a["org"].id, b["org"].id])).delete(synchronize_session=False)
    db.commit()
    h.cleanup_orgs(db, [a["org"].id, b["org"].id, platform["org"].id])


def make_student(db, tenants, org, name, tag=None, active=True, role=models.UserRole.STUDENT.value):
    tag = tag or h.new_tag()
    user = models.User(email=f"{name.lower().replace(' ', '.')}.{tag}@rwtest.com", full_name=name, role=role,
                       hashed_password=utils.get_password_hash("password123"), organization_id=org.id, is_active=active)
    db.add(user)
    db.commit()
    db.refresh(user)
    tenants["created"].append(user.id)
    if role == models.UserRole.STUDENT.value:
        db.add(models.StudentProfile(user_id=user.id, organization_id=org.id, email=user.email, full_name=name, target_role=""))
        db.commit()
    return user


def published(admin, monkeypatch):
    return h.create_published_job(admin, monkeypatch)


def send(admin, role_id, student_ids, org_id=None):
    return client.post(f"{ROLES}/{role_id}/invitations", headers=h.auth(admin["token"], org_id), json={"student_ids": student_ids})


def listing(admin, role_id, q=None, org_id=None):
    r = client.get(f"{ROLES}/{role_id}/share-students", headers=h.auth(admin["token"], org_id), params={"q": q} if q else None)
    assert r.status_code == 200, r.text
    return r.json()


def by_email(body):
    return {r["email"]: r for r in body["results"]}


def invitation_rows(db, role_id):
    db.expire_all()
    return db.query(models.AssessmentInvitation).filter_by(job_description_id=role_id).all()


# ------------------------------------------------------------------------------ 1. student selection + authorization
def test_listing_is_limited_to_the_callers_active_students(db, tenants, smtp, monkeypatch):
    a, b = tenants["a"], tenants["b"]
    tag = h.new_tag()
    alice = make_student(db, tenants, a["org"], "Alice Anders", tag)
    bob = make_student(db, tenants, a["org"], "Bob Brown", tag)
    gone = make_student(db, tenants, a["org"], "Inactive Ian", tag, active=False)
    other_org = make_student(db, tenants, b["org"], "Other Org Olga", tag)
    org_admin = make_student(db, tenants, a["org"], "Admin Person", tag, role=models.UserRole.ADMIN.value)
    job = published(a, monkeypatch)

    body = listing(a, job["id"])
    emails = {i["email"] for i in body["items"]}
    assert {alice.email, bob.email} <= emails
    assert not ({gone.email, other_org.email, org_admin.email} & emails)
    assert body["can_send"] is True and body["email_configured"] is True and body["link_expires_at"]
    item = next(i for i in body["items"] if i["email"] == alice.email)
    assert item["name"] == "Alice Anders" and item["invitation"] is None
    # nothing about the link token or any SMTP setting leaks
    assert job["share_token"] not in str(body) and PASSWORD not in str(body)


def test_search_by_name_or_email(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    tag = h.new_tag()
    one = make_student(db, tenants, a["org"], "Zephyr Quill", tag)
    make_student(db, tenants, a["org"], "Someone Else", tag)
    job = published(a, monkeypatch)
    assert [i["email"] for i in listing(a, job["id"], q="zephyr")["items"]] == [one.email]
    assert [i["email"] for i in listing(a, job["id"], q=one.email.upper())["items"]] == [one.email]
    assert listing(a, job["id"], q="no-such-person-xyz")["items"] == []


def test_listing_requires_an_admin_and_the_owning_organization(db, tenants, smtp, monkeypatch):
    a, b = tenants["a"], tenants["b"]
    student = make_student(db, tenants, a["org"], "Plain Student")
    job = published(a, monkeypatch)
    assert client.get(f"{ROLES}/{job['id']}/share-students").status_code in (401, 403)
    student_token = utils.create_access_token(data={"sub": student.email, "role": "STUDENT"})
    assert client.get(f"{ROLES}/{job['id']}/share-students", headers=h.auth(student_token)).status_code == 403
    assert send({"token": student_token}, job["id"], [student.id]).status_code == 403
    # another organization's administrator cannot even see the role
    assert client.get(f"{ROLES}/{job['id']}/share-students", headers=h.auth(b["token"])).status_code == 404
    assert send(b, job["id"], [student.id]).status_code == 404
    assert smtp.send_calls == 0


@pytest.mark.parametrize("kind", ["other_org", "admin_account", "inactive", "unknown"])
def test_server_rejects_students_outside_the_callers_scope(db, tenants, smtp, monkeypatch, kind):
    a, b = tenants["a"], tenants["b"]
    ok = make_student(db, tenants, a["org"], "In Scope")
    bad = {
        "other_org": lambda: make_student(db, tenants, b["org"], "Foreign Student").id,
        "admin_account": lambda: make_student(db, tenants, a["org"], "An Admin", role=models.UserRole.ADMIN.value).id,
        "inactive": lambda: make_student(db, tenants, a["org"], "Deactivated", active=False).id,
        "unknown": lambda: 99999999,
    }[kind]()
    job = published(a, monkeypatch)
    r = send(a, job["id"], [ok.id, bad])
    assert r.status_code == 404, r.text
    assert smtp.send_calls == 0 and smtp.connections == []          # not even the valid student was mailed
    assert invitation_rows(db, job["id"]) == []


def test_super_admin_invites_students_of_the_organization_it_targets(db, tenants, smtp, monkeypatch):
    a, platform = tenants["a"], tenants["platform"]
    student = make_student(db, tenants, a["org"], "Targeted Student")
    job = published(a, monkeypatch)
    r = send(platform, job["id"], [student.id], org_id=a["org"].id)
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["status"] == "sent"
    assert listing(platform, job["id"], org_id=a["org"].id)["items"]  # same scope for listing
    # without naming an organization the platform admin has no scope at all
    assert client.get(f"{ROLES}/{job['id']}/share-students", headers=h.auth(platform["token"])).status_code in (400, 404)


@pytest.mark.parametrize("ids", [[], list(range(1, invitations.MAX_RECIPIENTS_PER_REQUEST + 2))])
def test_selection_size_is_validated(db, tenants, smtp, monkeypatch, ids):
    job = published(tenants["a"], monkeypatch)
    assert send(tenants["a"], job["id"], ids).status_code == 422


# ------------------------------------------------------------------------------ 2. successful submission
def test_successful_invitation_content_and_tracking(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Maya Patel")
    job = published(a, monkeypatch)
    before_users = db.query(models.User).count()
    before_regs = db.query(models.CandidateRegistration).count()

    r = send(a, job["id"], [student.id])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"] == {"sent": 1, "failed": 0, "skipped": 0}
    assert body["results"][0] == {"student_id": student.id, "email": student.email, "name": "Maya Patel",
                                  "status": "sent", "reason": None, "attempts": 1}

    assert smtp.connections == [("plain", "mail.prepwin.test", 587)] and smtp.starttls_used == 1
    assert smtp.logins == [("mailer@prepwin.test", PASSWORD)]
    (to_addr, msg), = smtp.sent
    assert to_addr == student.email
    assert "Backend Engineer" in msg["Subject"]
    assert "mailer@prepwin.test" in msg["From"]
    text_part = msg.get_body(preferencelist=("plain",)).get_content()
    html_part = msg.get_body(preferencelist=("html",)).get_content()
    link = f"{FRONTEND}/assessment/join/{job['share_token']}"
    for part in (text_part, html_part):
        assert link in part
        assert "Backend Engineer" in part and "Maya Patel" in part
        assert "expires on" in part and "UTC" in part
        assert "one attempt" in part
    assert 'href="' + link + '"' in html_part and "Start the assessment" in html_part

    row, = invitation_rows(db, job["id"])
    assert (row.status, row.attempts, row.last_error) == ("SENT", 1, None) and row.accepted_at is not None
    assert row.recipient_email == student.email and row.invited_by == a["user"].id
    # tracking is visible, but the response never carries the secret or the token
    item = next(i for i in listing(a, job["id"])["items"] if i["id"] == student.id)
    assert item["invitation"]["status"] == "SENT"
    assert PASSWORD not in r.text and job["share_token"] not in r.text
    # no student account / registration was created by sending
    assert db.query(models.User).count() == before_users
    assert db.query(models.CandidateRegistration).count() == before_regs


def test_recipient_address_comes_from_the_database_not_the_request(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Db Sourced")
    job = published(a, monkeypatch)
    r = client.post(f"{ROLES}/{job['id']}/invitations", headers=h.auth(a["token"]),
                    json={"student_ids": [student.id], "email": "attacker@evil.test", "to": ["attacker@evil.test"]})
    assert r.status_code == 200
    assert [addr for addr, _ in smtp.sent] == [student.email]


# ------------------------------------------------------------------------------ 3. SMTP configuration problems
@pytest.mark.parametrize("env,expected", [
    ({"SMTP_HOST": None}, "SMTP_HOST"),
    ({"SMTP_PORT": "not-a-port"}, "SMTP_PORT"),
    ({"SMTP_PASSWORD": None}, "SMTP_USER and SMTP_PASSWORD"),
    ({"SMTP_USER": None, "SMTP_FROM": None}, "SMTP_USER and SMTP_PASSWORD"),
    ({"SMTP_FROM": "not-an-address"}, "SMTP_FROM"),
    ({"SMTP_SECURITY": "plaintext-please"}, "SMTP_SECURITY"),
])
def test_missing_or_invalid_smtp_configuration(db, tenants, smtp, monkeypatch, env, expected):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Config Case")
    job = published(a, monkeypatch)
    for key, value in env.items():
        monkeypatch.delenv(key, raising=False) if value is None else monkeypatch.setenv(key, value)
    assert listing(a, job["id"])["email_configured"] is False
    r = send(a, job["id"], [student.id])
    assert r.status_code == 503, r.text
    assert expected in r.json()["detail"] and PASSWORD not in r.text
    assert smtp.connections == [] and invitation_rows(db, job["id"]) == []   # nothing claimed, nothing tracked


def test_production_refuses_a_localhost_link(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Prod Check")
    job = published(a, monkeypatch)
    monkeypatch.setattr(utils, "is_production", lambda: True)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:5173")
    r = send(a, job["id"], [student.id])
    assert r.status_code == 503 and "FRONTEND_URL" in r.json()["detail"]
    assert smtp.send_calls == 0


# ------------------------------------------------------------------------------ 4. connection / authentication failures
def test_authentication_failure_stops_the_batch_without_retries_and_never_leaks_credentials(db, tenants, smtp, monkeypatch, caplog):
    a = tenants["a"]
    tag = h.new_tag()
    s1, s2 = make_student(db, tenants, a["org"], "Auth One", tag), make_student(db, tenants, a["org"], "Auth Two", tag)
    job = published(a, monkeypatch)
    smtp.login_error = smtplib.SMTPAuthenticationError(535, ("5.7.8 Bad credentials " + PASSWORD).encode())
    with caplog.at_level(logging.DEBUG):
        r = send(a, job["id"], [s1.id, s2.id])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"] == {"sent": 0, "failed": 2, "skipped": 0}
    res = by_email(body)
    assert "rejected the configured credentials" in res[s1.email]["reason"]
    assert res[s2.email]["reason"].startswith("Not attempted:")
    assert len(smtp.connections) == 1 and smtp.send_calls == 0       # one login attempt, no pointless retries
    assert PASSWORD not in r.text and PASSWORD not in caplog.text
    assert {row.status for row in invitation_rows(db, job["id"])} == {"FAILED"}
    assert all(PASSWORD not in (row.last_error or "") for row in invitation_rows(db, job["id"]))


def test_connection_failure_is_reported_per_recipient(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Offline Case")
    job = published(a, monkeypatch)
    smtp.connect_error = ConnectionRefusedError("connection refused by mail.prepwin.test:587")
    r = send(a, job["id"], [student.id])
    assert r.status_code == 200
    only = r.json()["results"][0]
    assert only["status"] == "failed" and only["reason"] == "Could not connect to the mail server."
    assert "mail.prepwin.test" not in r.text                           # internal error text is never forwarded


def test_tls_is_required_before_credentials_are_sent(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "No Tls Case")
    job = published(a, monkeypatch)
    smtp.starttls_offered = False
    r = send(a, job["id"], [student.id])
    assert r.json()["results"][0]["status"] == "failed"
    assert smtp.logins == [] and smtp.send_calls == 0                  # the password was never offered in clear text


def test_port_465_uses_implicit_tls_and_none_security_skips_login_encryption(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    s1, s2 = make_student(db, tenants, a["org"], "Ssl One"), make_student(db, tenants, a["org"], "Ssl Two")
    job = published(a, monkeypatch)
    monkeypatch.setenv("SMTP_PORT", "465")
    assert send(a, job["id"], [s1.id]).json()["summary"]["sent"] == 1
    assert smtp.connections[-1] == ("ssl", "mail.prepwin.test", 465) and smtp.starttls_used == 0
    monkeypatch.setenv("SMTP_PORT", "25")
    monkeypatch.setenv("SMTP_SECURITY", "none")
    assert send(a, job["id"], [s2.id]).json()["summary"]["sent"] == 1
    assert smtp.connections[-1] == ("plain", "mail.prepwin.test", 25) and smtp.starttls_used == 0


# ------------------------------------------------------------------------------ 5. partial failures and bounded retries
def test_partial_failure_is_not_reported_as_overall_success(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    tag = h.new_tag()
    good1, bad, good2 = (make_student(db, tenants, a["org"], n, tag) for n in ("Good One", "Bad Box", "Good Two"))
    job = published(a, monkeypatch)
    smtp.refuse.add(bad.email)
    r = send(a, job["id"], [good1.id, bad.id, good2.id])
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"sent": 2, "failed": 1, "skipped": 0}
    res = by_email(body)
    assert res[good1.email]["status"] == "sent" and res[good2.email]["status"] == "sent"
    assert res[bad.email]["status"] == "failed" and "refused" in res[bad.email]["reason"]
    assert smtp.send_calls == 3                                        # permanent refusal: no retries
    assert {addr for addr, _ in smtp.sent} == {good1.email, good2.email}
    states = {row.recipient_email: row.status for row in invitation_rows(db, job["id"])}
    assert states == {good1.email: "SENT", bad.email: "FAILED", good2.email: "SENT"}
    items = {i["email"]: i["invitation"] for i in listing(a, job["id"])["items"]}
    assert items[bad.email]["status"] == "FAILED" and "refused" in items[bad.email]["error"]


def test_transient_failures_are_retried_a_bounded_number_of_times(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    flaky, dead = make_student(db, tenants, a["org"], "Flaky Box"), make_student(db, tenants, a["org"], "Dead Box")
    job = published(a, monkeypatch)
    smtp.script[flaky.email] = [smtplib.SMTPServerDisconnected("dropped"), smtplib.SMTPResponseException(451, b"try later")]
    smtp.script[dead.email] = [smtplib.SMTPServerDisconnected("dropped")] * 10
    sleeps = []
    monkeypatch.setattr(email_service, "_sleep", sleeps.append)
    body = send(a, job["id"], [flaky.id, dead.id]).json()
    res = by_email(body)
    assert res[flaky.email]["status"] == "sent"                                    # 3rd attempt succeeded
    assert res[dead.email]["status"] == "failed"
    assert smtp.send_calls == email_service.MAX_ATTEMPTS * 2                       # 3 + 3, never unbounded
    assert len(smtp.script[dead.email]) == 10 - email_service.MAX_ATTEMPTS
    assert len(sleeps) == 2 * (email_service.MAX_ATTEMPTS - 1)                     # backoff between attempts only


def test_failed_invitations_can_be_retried_without_resending_the_successful_ones(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    ok, bad = make_student(db, tenants, a["org"], "Retry Ok"), make_student(db, tenants, a["org"], "Retry Bad")
    job = published(a, monkeypatch)
    smtp.refuse.add(bad.email)
    assert send(a, job["id"], [ok.id, bad.id]).json()["summary"] == {"sent": 1, "failed": 1, "skipped": 0}
    smtp.refuse.clear()
    r = send(a, job["id"], [ok.id, bad.id])
    body = r.json()
    assert body["summary"] == {"sent": 1, "failed": 0, "skipped": 1}
    res = by_email(body)
    assert res[ok.email]["status"] == "skipped" and res[ok.email]["reason"] == invitations.SKIP_ALREADY_SENT
    assert res[bad.email]["status"] == "sent" and res[bad.email]["attempts"] == 2
    assert sorted(addr for addr, _ in smtp.sent) == sorted([ok.email, bad.email])  # exactly one mail each
    assert {row.status for row in invitation_rows(db, job["id"])} == {"SENT"}


# ------------------------------------------------------------------------------ 6. duplicate requests
def test_repeated_request_never_sends_a_second_email(db, tenants, smtp, monkeypatch):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Double Click")
    job = published(a, monkeypatch)
    assert send(a, job["id"], [student.id, student.id, student.id]).json()["summary"] == {"sent": 1, "failed": 0, "skipped": 0}
    again = send(a, job["id"], [student.id])
    assert again.status_code == 200 and again.json()["summary"] == {"sent": 0, "failed": 0, "skipped": 1}
    assert len(smtp.sent) == 1 and len(invitation_rows(db, job["id"])) == 1


def test_an_invitation_being_sent_by_another_request_is_not_sent_twice(db, tenants, smtp, monkeypatch, clock):
    a = tenants["a"]
    busy, abandoned = make_student(db, tenants, a["org"], "In Flight"), make_student(db, tenants, a["org"], "Abandoned")
    job = published(a, monkeypatch)
    now = clock.now()
    for student, age in ((busy, timedelta(seconds=30)), (abandoned, invitations.STALE_PENDING + timedelta(seconds=1))):
        db.add(models.AssessmentInvitation(
            job_description_id=job["id"], organization_id=a["org"].id, student_user_id=student.id, share_token=job["share_token"],
            recipient_email=student.email, status="PENDING", attempts=1, updated_at=assessment_clock.naive_utc(now - age)))
    db.commit()
    res = by_email(send(a, job["id"], [busy.id, abandoned.id]).json())
    assert res[busy.email]["status"] == "skipped" and res[busy.email]["reason"] == invitations.SKIP_IN_PROGRESS
    assert res[abandoned.email]["status"] == "sent"                    # a crashed request's claim is recoverable
    assert [addr for addr, _ in smtp.sent] == [abandoned.email]


def test_compare_and_set_claim_lets_only_one_request_win(db, tenants, smtp, monkeypatch, clock):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Race Case")
    job = published(a, monkeypatch)
    send_row = models.AssessmentInvitation(
        job_description_id=job["id"], organization_id=a["org"].id, student_user_id=student.id, share_token=job["share_token"],
        recipient_email=student.email, status="FAILED", attempts=1, updated_at=assessment_clock.naive_utc(clock.now()))
    db.add(send_row)
    db.commit()
    job_row = db.query(models.JobDescription).get(job["id"])
    competitor = h.new_session()
    try:
        first = invitations._claim(db, job_row, student, a["user"].id, clock.now())
        # a second request that read the row BEFORE the first claim committed tries the same transition
        stale = models.AssessmentInvitation.__table__.update().where(
            models.AssessmentInvitation.id == send_row.id, models.AssessmentInvitation.status == "FAILED",
            models.AssessmentInvitation.attempts == 1).values(status="PENDING")
        assert first is not None and first.attempts == 2
        assert competitor.execute(stale).rowcount == 0
    finally:
        competitor.rollback()
        competitor.close()


# ------------------------------------------------------------------------------ 7. expired / closed / unpublished links
def test_expired_link_cannot_be_used_for_invitations(db, tenants, smtp, monkeypatch, clock):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Late Student")
    job = published(a, monkeypatch)
    assert send(a, job["id"], [student.id]).status_code == 200
    clock.advance(24 * 3600 + 1)
    r = send(a, job["id"], [student.id])
    assert r.status_code == 410 and "expired" in r.json()["detail"].lower()
    body = listing(a, job["id"])
    assert body["can_send"] is False and "expired" in body["cannot_send_reason"].lower()
    assert len(smtp.sent) == 1

    # a renewed link is a fresh slate: the student may be invited to the NEW link
    renewed = client.post(f"{ROLES}/{job['id']}/new-link", headers=h.auth(a["token"])).json()
    assert renewed["share_token"] != job["share_token"]
    item = next(i for i in listing(a, job["id"])["items"] if i["id"] == student.id)
    assert item["invitation"] is None
    assert send(a, job["id"], [student.id]).json()["summary"]["sent"] == 1
    assert renewed["share_token"] in smtp.sent[-1][1].get_body(preferencelist=("plain",)).get_content()


def test_closed_and_unpublished_assessments_cannot_be_invited(db, tenants, smtp, monkeypatch, clock):
    a = tenants["a"]
    student = make_student(db, tenants, a["org"], "Closed Case")
    job = published(a, monkeypatch)
    assert client.post(f"{ROLES}/{job['id']}/close", headers=h.auth(a["token"])).status_code == 200
    r = send(a, job["id"], [student.id])
    assert r.status_code == 409 and "closed" in r.json()["detail"].lower()
    draft = h.create_job(a, title="Never Published")
    r = send(a, draft["id"], [student.id])
    assert r.status_code == 409 and "Publish" in r.json()["detail"]
    assert smtp.send_calls == 0 and invitation_rows(db, job["id"]) == []


# ------------------------------------------------------------------------------ 8. manual sharing + assessment rules untouched
def test_manual_sharing_and_assessment_rules_are_unaffected(db, tenants, smtp, monkeypatch, clock):
    a = tenants["a"]
    invited, walk_in = make_student(db, tenants, a["org"], "Invited One"), make_student(db, tenants, a["org"], "Walk In")
    job = published(a, monkeypatch)
    before = client.get(f"{ROLES}/{job['id']}", headers=h.auth(a["token"])).json()
    assert before["share_url"] == f"{FRONTEND}/assessment/join/{before['share_token']}" and before["share_link_expires_at"]

    assert send(a, job["id"], [invited.id]).status_code == 200
    after = client.get(f"{ROLES}/{job['id']}", headers=h.auth(a["token"])).json()
    for key in ("share_token", "share_path", "share_url", "share_link_expires_at", "share_link_state", "status", "is_published"):
        assert after[key] == before[key], key                         # link, 24 h expiry and publish state are untouched

    # the link works for the invited student AND for a student who was never e-mailed (manual / external distribution): both sign in
    # with their own account (the old name / phone form is not used for students) and receive their own start capability
    share = before["share_token"]
    meta = client.get(f"/api/public/assessment/{share}")
    assert meta.status_code == 200

    def signed_in(user):
        c, res = lah.login(user.email, "password123")
        c.headers["X-CSRF-Token"] = res.json()["csrf_token"]
        return c

    ic, wc = signed_in(invited), signed_in(walk_in)
    got1 = ic.post(f"/api/student-assessment/{share}/access")
    got2 = wc.post(f"/api/student-assessment/{share}/access")
    assert got1.status_code == got2.status_code == 200 and got1.json()["status"] == got2.json()["status"] == "READY"
    # single-attempt rule: coming back creates no second registration, and the legacy form refuses a student's e-mail
    assert ic.post(f"/api/student-assessment/{share}/access").status_code == 200
    legacy, _ = h.register(share, email=invited.email, name="Invited One")
    assert legacy.status_code == 409
    regs = db.query(models.CandidateRegistration).filter_by(job_description_id=job["id"]).count()
    assert regs == 2
    cap1 = ic.post(f"/api/student-assessment/{share}/access").json()["registration_token"]
    started = ic.post(f"/api/public/assessment/{share}/start", headers={"X-Registration-Token": cap1}, json={"acknowledged": True})
    assert started.status_code == 200 and started.json()["session_uuid"]
    again = ic.post(f"/api/public/assessment/{share}/start", headers={"X-Registration-Token": cap1}, json={"acknowledged": True})
    assert again.status_code in (403, 409)


# ------------------------------------------------------------------------------ 9. templates and the SMTP service
def test_template_escapes_html_and_strips_header_injection():
    r = invitations.render_invitation(
        job_title='Engineer <script>alert(1)</script>\r\nBcc: evil@evil.test', recipient_name='<b>Eve</b> & "Co"',
        organization_name="Acme <Corp>", link_url="https://app.test/assessment/join/abc?x=1&y=2",
        expires_at=datetime(2030, 1, 16, 9, 0, tzinfo=timezone.utc))
    assert "<script>" not in r.html and "&lt;script&gt;" in r.html and "<b>Eve</b>" not in r.html
    assert "x=1&amp;y=2" in r.html and "16 Jan 2030 at 09:00 UTC" in r.text
    assert "\n" not in r.subject and "\r" not in r.subject
    msg = email_service.build_message(
        email_service.SmtpSettings("h", 587, None, None, "a@b.test", "a@b.test", "starttls"), "to@x.test", r.subject, r.html, r.text)
    assert msg["Bcc"] is None and msg.is_multipart()
    assert [p.get_content_type() for p in msg.iter_parts()] == ["text/plain", "text/html"]


def test_legacy_link_without_expiry_is_described_honestly():
    r = invitations.render_invitation(job_title="Legacy", recipient_name=None, organization_name=None,
                                      link_url="https://app.test/assessment/join/x", expires_at=None)
    assert "no fixed expiry" in r.text and r.text.startswith("Hello,")


def test_smtp_settings_defaults_and_sender_parsing():
    s = email_service.load_settings({"SMTP_HOST": "h", "SMTP_USER": "u@x.test", "SMTP_PASSWORD": "p", "SMTP_FROM": "Team <t@x.test>"})
    assert (s.port, s.security, s.sender, s.sender_header) == (587, "starttls", "t@x.test", "Team <t@x.test>")
    assert email_service.load_settings({"SMTP_HOST": "h", "SMTP_PORT": "465", "SMTP_USER": "u@x.test", "SMTP_PASSWORD": "p"}).security == "ssl"
    assert email_service.load_settings({"SMTP_HOST": "h", "SMTP_USER": "u@x.test", "SMTP_PASSWORD": "p"}).sender == "u@x.test"
    assert email_service.is_configured({}) is False
