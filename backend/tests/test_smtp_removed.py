"""SMTP/email delivery has been removed: no code path may send mail, and the recruiter flows that used to
depend on it must hand the login link / credentials back to the recruiter instead."""
import re
import smtplib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import models
import utils
from main import app
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401

client = TestClient(app)
BACKEND = Path(__file__).resolve().parent.parent


def _admin_headers(db_session, setup_test_data):
    org = setup_test_data["org"]
    admin = db_session.query(models.User).filter_by(email="admin.nosmtp@roleready.com").first()
    if not admin:
        admin = models.User(
            email="admin.nosmtp@roleready.com",
            hashed_password="fakehashedpassword",
            role=models.UserRole.ORGANIZATION_ADMIN,
            organization_id=org.id,
        )
        db_session.add(admin)
        db_session.commit()
        db_session.refresh(admin)
    member = db_session.query(models.OrganizationMember).filter_by(user_id=admin.id).first()
    if not member:
        db_session.add(models.OrganizationMember(
            organization_id=org.id, user_id=admin.id, role="ORGANIZATION_ADMIN", status="active"
        ))
        db_session.commit()
    token = utils.create_access_token(data={"sub": admin.email, "role": admin.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def no_mail(monkeypatch):
    """Fail loudly if anything tries to open an SMTP connection."""
    def boom(*args, **kwargs):
        raise AssertionError("SMTP connection attempted, but email delivery has been removed")
    monkeypatch.setattr(smtplib, "SMTP", boom)
    monkeypatch.setattr(smtplib, "SMTP_SSL", boom)


def test_email_helpers_are_gone(monkeypatch):
    assert not hasattr(utils, "EMAIL_HOST") and not hasattr(utils, "EMAIL_PASSWORD")
    assert not (BACKEND / "services" / "email_templates.py").exists()

    # send_email survives only as a no-op for the frozen interview router; it must never open a connection
    def boom(*a, **k):
        raise AssertionError("SMTP connection attempted")
    monkeypatch.setattr(smtplib, "SMTP", boom)
    assert utils.send_email("someone@example.com", "subject", "<p>body</p>") is False


def test_no_source_file_sends_email_or_imports_smtp():
    pattern = re.compile(r"smtplib|email_templates|EMAIL_HOST|MIMEMultipart|MIMEText|send_email")
    # routers/interview.py is frozen (zero git diff is enforced by other tests) and still calls the no-op shim
    allowed = {"routers/interview.py"}
    offenders = []
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("venv/", ".venv/", "tests/", "__pycache__/")) or "/__pycache__/" in rel:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if rel == "utils.py":
            # only the documented no-op definition may mention it
            text = re.sub(r"def send_email\(.*?return False\n", "", text, flags=re.S)
        if rel not in allowed and pattern.search(text):
            offenders.append(rel)
    assert offenders == []


def test_env_example_has_no_smtp_settings():
    example = (BACKEND / ".env.example").read_text(encoding="utf-8")
    assert "EMAIL_HOST" not in example and "SMTP" not in example


def test_assign_returns_login_details_instead_of_emailing(db_session, setup_test_data, no_mail):
    headers = _admin_headers(db_session, setup_test_data)
    res = client.post("/api/assessments/assign/", headers=headers, json={
        "type": "interview",
        "candidates": [
            {"email": "nosmtp.one@gmail.com", "name": "No Smtp One"},
            {"email": "nosmtp.two@gmail.com", "name": "No Smtp Two"},
        ],
        "config": {"role": "Backend Engineer", "duration": 15},
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "success"
    assert "email_errors" not in body
    assert "share" in body["message"].lower()

    creds = {c["email"]: c for c in body["credentials"]}
    assert set(creds) == {"nosmtp.one@gmail.com", "nosmtp.two@gmail.com"}
    for email, c in creds.items():
        assert len(c["password"]) == 10 and c["password"].isalnum()
        assert c["login_url"].endswith("/portal/login")
        assert c["round"] == "interview" and c["role"]

    # The returned password is the real one: it matches what was stored for the candidate
    stored = db_session.query(models.Candidate).filter_by(email="nosmtp.one@gmail.com").first()
    assert utils.verify_password(creds["nosmtp.one@gmail.com"]["password"], stored.hashed_password)
    # Different candidates get different passwords
    assert creds["nosmtp.one@gmail.com"]["password"] != creds["nosmtp.two@gmail.com"]["password"]


def test_assign_candidate_without_email_is_skipped(db_session, setup_test_data, no_mail):
    headers = _admin_headers(db_session, setup_test_data)
    res = client.post("/api/assessments/assign/", headers=headers, json={
        "type": "interview",
        "candidates": [{"name": "No Email"}, {"email": "nosmtp.three@gmail.com", "name": "Has Email"}],
        "config": {"role": "Backend Engineer"},
    })
    assert res.status_code == 200, res.text
    assert [c["email"] for c in res.json()["credentials"]] == ["nosmtp.three@gmail.com"]


def test_roleready_dispatch_makes_no_smtp_call_and_returns_links(db_session, setup_test_data, no_mail):
    headers = _admin_headers(db_session, setup_test_data)
    res = client.post("/api/roleready/admin/dispatch-batch", headers=headers, json={
        "batch_name": "No SMTP batch",
        "target_role": "Backend Engineer",
        "target_company": "ThirdEye Data",
        "job_description": "Backend Engineer with Python, FastAPI and SQL experience for our platform team.",
        "candidates": [{"name": "Link Only", "email": "link.only@gmail.com", "phone": "+10000000000"}],
    })
    assert res.status_code == 200, res.text
    row = res.json()["results"][0]
    assert row["portal_url"].endswith(row["token"]) and "email_sent" not in row and row["status"] == "PENDING"


def test_retry_email_endpoint_is_removed(db_session, setup_test_data):
    headers = _admin_headers(db_session, setup_test_data)
    res = client.post("/api/roleready/admin/invitations/1/retry", headers=headers)
    assert res.status_code in (404, 405)
