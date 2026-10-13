"""
Regression Test Suite: Security Audit Remediation
Covers:
1. Task 1: JWT Secret Validation and Fail-Safe Startup in Production.
2. Task 2: Recruiter Resume Authorization, Cross-Tenant Isolation, Role-Based Access, and Path Traversal Protection.
"""

import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

import models
import database
import utils
from main import app

client = TestClient(app)


# =============================================================================
# TASK 1: JWT SECRET VALIDATION & FAIL-SAFE STARTUP TESTS
# =============================================================================

def test_jwt_secret_fails_in_production_when_empty(monkeypatch):
    """Production mode must raise RuntimeError if JWT secret is missing or empty."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)

    with pytest.raises(RuntimeError, match="JWT signing secret is unconfigured"):
        utils.validate_jwt_secret()


def test_jwt_secret_fails_in_production_when_using_insecure_default(monkeypatch):
    """Production mode must raise RuntimeError if JWT secret is a known default placeholder."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    for default_secret in ["your-secret-key-here", "secret", "changeme", "admin", "default", "password"]:
        monkeypatch.setenv("JWT_SECRET_KEY", default_secret)
        with pytest.raises(RuntimeError, match="using a default placeholder"):
            utils.validate_jwt_secret()


def test_jwt_secret_fails_in_production_when_too_short(monkeypatch):
    """Production mode must raise RuntimeError if JWT secret is shorter than 32 characters."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("JWT_SECRET_KEY", "short-secret-key-less-than-32")
    with pytest.raises(RuntimeError, match="must be at least 32 characters long"):
        utils.validate_jwt_secret()


def test_jwt_secret_succeeds_in_production_with_strong_secret(monkeypatch):
    """Production mode must accept a strong secret (>= 32 chars)."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    strong_secret = "a" * 32 + "-super-secure-production-jwt-secret-key"
    monkeypatch.setenv("JWT_SECRET_KEY", strong_secret)

    validated = utils.validate_jwt_secret()
    assert validated == strong_secret


def test_jwt_secret_allows_development_fallback(monkeypatch):
    """Development / test environments can safely fall back to the development default."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)

    secret = utils.validate_jwt_secret()
    assert secret == "your-secret-key-here"


# =============================================================================
# TASK 2: RECRUITER RESUME AUTHORIZATION & TENANT ISOLATION TESTS
# =============================================================================

@pytest.fixture(scope="module")
def resume_test_env():
    """Sets up organizations, users, candidates, and test resume files on disk."""
    db = database.SessionLocal()

    # Create storage directory and dummy resumes
    resume_dir = Path("media/resumes")
    resume_dir.mkdir(parents=True, exist_ok=True)

    file_a = resume_dir / "audit_test_cand_a.pdf"
    file_b = resume_dir / "audit_test_cand_b.pdf"
    file_a.write_bytes(b"%PDF-1.4 Org A Candidate Resume Content")
    file_b.write_bytes(b"%PDF-1.4 Org B Candidate Resume Content")

    # Clean up previous test entities if any
    db.query(models.Candidate).filter(models.Candidate.email.in_([
        "audit_cand_a@test.org", "audit_cand_b@test.org"
    ])).delete(synchronize_session=False)
    db.query(models.User).filter(models.User.email.in_([
        "audit_recruiter_a@test.org",
        "audit_recruiter_b@test.org",
        "audit_student@test.org",
        "audit_cand_a@test.org",
        "audit_cand_b@test.org",
        "audit_platform_admin@test.org"
    ])).delete(synchronize_session=False)
    db.query(models.Organization).filter(models.Organization.slug.in_([
        "audit-org-a", "audit-org-b"
    ])).delete(synchronize_session=False)
    db.commit()

    # Create Organizations
    org_a = models.Organization(name="Audit Org A", slug="audit-org-a", status="active")
    org_b = models.Organization(name="Audit Org B", slug="audit-org-b", status="active")
    db.add_all([org_a, org_b])
    db.commit()
    db.refresh(org_a)
    db.refresh(org_b)

    # Create Users
    user_recruiter_a = models.User(
        email="audit_recruiter_a@test.org",
        role=models.UserRole.HR,
        organization_id=org_a.id,
        is_active=True
    )
    user_recruiter_b = models.User(
        email="audit_recruiter_b@test.org",
        role=models.UserRole.HR,
        organization_id=org_b.id,
        is_active=True
    )
    user_student = models.User(
        email="audit_student@test.org",
        role=models.UserRole.STUDENT,
        organization_id=None,
        is_active=True
    )
    user_platform_admin = models.User(
        email="audit_platform_admin@test.org",
        role=models.UserRole.PLATFORM_ADMIN,
        organization_id=None,
        is_active=True
    )
    user_cand_a = models.User(
        email="audit_cand_a@test.org",
        role=models.UserRole.CANDIDATE,
        organization_id=org_a.id,
        is_active=True
    )
    user_cand_b = models.User(
        email="audit_cand_b@test.org",
        role=models.UserRole.CANDIDATE,
        organization_id=org_b.id,
        is_active=True
    )

    db.add_all([
        user_recruiter_a, user_recruiter_b, user_student,
        user_platform_admin, user_cand_a, user_cand_b
    ])
    db.commit()

    # Create Candidate Records
    cand_a = models.Candidate(
        name="Candidate Alpha",
        email="audit_cand_a@test.org",
        role="Backend Engineer",
        resume_file="audit_test_cand_a.pdf",
        organization_id=org_a.id
    )
    cand_b = models.Candidate(
        name="Candidate Beta",
        email="audit_cand_b@test.org",
        role="Frontend Engineer",
        resume_file="audit_test_cand_b.pdf",
        organization_id=org_b.id
    )
    db.add_all([cand_a, cand_b])
    db.commit()

    # Generate Tokens
    tokens = {
        "recruiter_a": utils.create_access_token({"sub": user_recruiter_a.email, "role": "HR"}),
        "recruiter_b": utils.create_access_token({"sub": user_recruiter_b.email, "role": "HR"}),
        "student": utils.create_access_token({"sub": user_student.email, "role": "STUDENT"}),
        "platform_admin": utils.create_access_token({"sub": user_platform_admin.email, "role": "PLATFORM_ADMIN"}),
        "cand_a": utils.create_access_token({"sub": user_cand_a.email, "role": "CANDIDATE"}),
        "cand_b": utils.create_access_token({"sub": user_cand_b.email, "role": "CANDIDATE"}),
    }

    yield {
        "tokens": tokens,
        "file_a": "audit_test_cand_a.pdf",
        "file_b": "audit_test_cand_b.pdf",
    }

    # Teardown
    db.query(models.Candidate).filter(models.Candidate.email.in_([
        "audit_cand_a@test.org", "audit_cand_b@test.org"
    ])).delete(synchronize_session=False)
    db.query(models.User).filter(models.User.email.in_([
        "audit_recruiter_a@test.org",
        "audit_recruiter_b@test.org",
        "audit_student@test.org",
        "audit_cand_a@test.org",
        "audit_cand_b@test.org",
        "audit_platform_admin@test.org"
    ])).delete(synchronize_session=False)
    db.query(models.Organization).filter(models.Organization.slug.in_([
        "audit-org-a", "audit-org-b"
    ])).delete(synchronize_session=False)
    db.commit()
    db.close()

    if file_a.exists():
        file_a.unlink()
    if file_b.exists():
        file_b.unlink()


def test_resume_access_unauthenticated_rejected(resume_test_env):
    """Unauthenticated requests without headers or query tokens must return 401."""
    res = client.get(f"/media/resumes/{resume_test_env['file_a']}")
    assert res.status_code == 401
    assert "Authentication required" in res.json().get("detail", "")


def test_resume_access_invalid_token_rejected(resume_test_env):
    """Requests with malformed or tampered tokens must return 401."""
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": "Bearer invalid.jwt.token"}
    )
    assert res.status_code == 401


def test_resume_access_path_traversal_blocked(resume_test_env):
    """Requests attempting directory traversal outside media/resumes must return 400."""
    token = resume_test_env["tokens"]["recruiter_a"]
    res = client.get(
        "/media/resumes/%2e%2e%2fmain.py",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 400
    assert "Invalid file path" in res.json().get("detail", "")


def test_resume_access_student_role_denied(resume_test_env):
    """Students attempting to access recruiter candidate resumes must return 403."""
    token = resume_test_env["tokens"]["student"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403
    assert "Students cannot access recruiter candidate resumes" in res.json().get("detail", "")


def test_resume_access_cross_tenant_recruiter_denied(resume_test_env):
    """Recruiter from Organization B attempting to access Org A candidate resume must return 403."""
    token = resume_test_env["tokens"]["recruiter_b"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403
    assert "another organization" in res.json().get("detail", "")


def test_resume_access_authorized_recruiter_bearer_header(resume_test_env):
    """Authorized recruiter in Org A accessing Org A candidate resume via Bearer header succeeds."""
    token = resume_test_env["tokens"]["recruiter_a"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert b"Org A Candidate Resume Content" in res.content


def test_resume_access_authorized_recruiter_query_param(resume_test_env):
    """Authorized recruiter in Org A accessing Org A candidate resume via ?token= query param succeeds."""
    token = resume_test_env["tokens"]["recruiter_a"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}?token={token}"
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert b"Org A Candidate Resume Content" in res.content


def test_resume_access_platform_admin_allowed(resume_test_env):
    """Platform admin can access any organization's candidate resume."""
    token = resume_test_env["tokens"]["platform_admin"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    assert b"Org A Candidate Resume Content" in res.content


def test_resume_access_candidate_owner_allowed(resume_test_env):
    """Candidate can access their own resume."""
    token = resume_test_env["tokens"]["cand_a"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    assert b"Org A Candidate Resume Content" in res.content


def test_resume_access_other_candidate_denied(resume_test_env):
    """Candidate cannot access another candidate's resume."""
    token = resume_test_env["tokens"]["cand_b"]
    res = client.get(
        f"/media/resumes/{resume_test_env['file_a']}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403
    assert "cannot access other candidates" in res.json().get("detail", "")


def test_resume_access_nonexistent_file_returns_404(resume_test_env):
    """Requesting a non-existent file returns 404."""
    token = resume_test_env["tokens"]["recruiter_a"]
    res = client.get(
        "/media/resumes/non_existent_file.pdf",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 404


def test_preview_token_generation_authorized_recruiter(resume_test_env):
    """Authorized recruiter in Org A can obtain a 60s scoped preview token for candidate in Org A."""
    token = resume_test_env["tokens"]["recruiter_a"]
    file_a = resume_test_env["file_a"]
    res = client.get(
        f"/api/resume/preview-token?file_path={file_a}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    data = res.json()
    assert "preview_token" in data
    assert data["expires_in"] == 60


def test_preview_token_generation_student_denied(resume_test_env):
    """Students cannot request recruiter resume preview tokens."""
    token = resume_test_env["tokens"]["student"]
    file_a = resume_test_env["file_a"]
    res = client.get(
        f"/api/resume/preview-token?file_path={file_a}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403


def test_preview_token_generation_cross_tenant_denied(resume_test_env):
    """Recruiter from Org B cannot request preview token for candidate in Org A."""
    token = resume_test_env["tokens"]["recruiter_b"]
    file_a = resume_test_env["file_a"]
    res = client.get(
        f"/api/resume/preview-token?file_path={file_a}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403
    assert "another organization" in res.json().get("detail", "")


def test_resume_access_with_valid_scoped_preview_token(resume_test_env):
    """Using a scoped preview token grants access and sets strict cache and referrer headers."""
    file_a = resume_test_env["file_a"]
    preview_token = utils.create_resume_preview_token(
        email="audit_recruiter_a@test.org",
        file_path=file_a,
        expires_seconds=60
    )
    res = client.get(f"/media/resumes/{file_a}?token={preview_token}")
    assert res.status_code == 200
    assert b"Org A Candidate Resume Content" in res.content

    # Cache and Referrer protections
    assert "no-store" in res.headers.get("cache-control", "")
    assert res.headers.get("referrer-policy") == "no-referrer"
    assert res.headers.get("x-content-type-options") == "nosniff"


def test_resume_access_scoped_token_file_mismatch_denied(resume_test_env):
    """A scoped preview token generated for File A cannot be used to fetch File B."""
    file_a = resume_test_env["file_a"]
    file_b = resume_test_env["file_b"]
    preview_token_for_a = utils.create_resume_preview_token(
        email="audit_recruiter_a@test.org",
        file_path=file_a,
        expires_seconds=60
    )
    res = client.get(f"/media/resumes/{file_b}?token={preview_token_for_a}")
    assert res.status_code == 403
    assert "Scoped token does not match" in res.json().get("detail", "")


def test_resume_access_expired_token_rejected(resume_test_env):
    """An expired token must be rejected with 401 Unauthorized."""
    file_a = resume_test_env["file_a"]
    # Token expired 10 seconds ago
    expired_token = utils.create_resume_preview_token(
        email="audit_recruiter_a@test.org",
        file_path=file_a,
        expires_seconds=-10
    )
    res = client.get(f"/media/resumes/{file_a}?token={expired_token}")
    assert res.status_code == 401
    assert "expired" in res.json().get("detail", "").lower()


def test_sqlite_database_path_resolves_consistently_regardless_of_cwd():
    """
    Verifies that SQLite database path resolves to backend/hiringai.db
    both when run from backend/ and when run from the workspace root directory.
    """
    import subprocess
    import sys
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parent.parent
    workspace_root = backend_dir.parent
    expected_db_file = (backend_dir / "hiringai.db").resolve()

    python_exe = sys.executable

    # 1. Test when working directory is backend/
    code_backend = "import database; print(str(database.engine.url.database))"
    res_backend = subprocess.run(
        [python_exe, "-c", code_backend],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
        check=True
    )
    db_from_backend = Path(res_backend.stdout.strip()).resolve()
    assert db_from_backend == expected_db_file

    # 2. Test when working directory is workspace root
    code_root = "import sys; sys.path.insert(0, 'backend'); import database; print(str(database.engine.url.database))"
    res_root = subprocess.run(
        [python_exe, "-c", code_root],
        cwd=str(workspace_root),
        capture_output=True,
        text=True,
        check=True
    )
    db_from_root = Path(res_root.stdout.strip()).resolve()
    assert db_from_root == expected_db_file


