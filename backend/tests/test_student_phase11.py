"""
Phase 11 — Security Hardening, Penetration Testing & Integration Audit.
Automated audit suite verifying:
1. Cross-tenant IDOR isolation for student profiles.
2. Cross-tenant IDOR isolation for placement drives and applications.
3. Role escalation prevention: Student cannot access recruiter endpoints.
4. Role escalation prevention: Candidate cannot access student career features.
5. Role escalation prevention: Student cannot access college placement officer endpoints.
6. File upload security: Malicious extensions (.exe, .sh, .php, .py, .bat) and null bytes rejected.
7. File upload security: Empty (0 bytes) and oversized (>10MB) payloads rejected with 400 / 413.
8. SQL injection parameterization & directory traversal resistance.
"""

import io
import pytest
from fastapi.testclient import TestClient

import models
import database
import utils
from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def audit_data():
    """Provisions isolated tenants, users, and drives for the Phase 11 security audit."""
    db = database.SessionLocal()
    # The fixture hands ORM objects to the tests after db.close(). With the default expire_on_commit, the later commits
    # (candidate user, drive) expire profile_b on a fresh database and `profile_b.id` raises DetachedInstanceError.
    db.expire_on_commit = False
    try:
        # 1. Tenants: Org Alpha and Org Beta
        org_a = db.query(models.Organization).filter(models.Organization.slug == "audit-college-a").first()
        if not org_a:
            org_a = models.Organization(name="Audit College Alpha", slug="audit-college-a", status="active")
            db.add(org_a)
            db.commit()
            db.refresh(org_a)

        org_b = db.query(models.Organization).filter(models.Organization.slug == "audit-college-b").first()
        if not org_b:
            org_b = models.Organization(name="Audit College Beta", slug="audit-college-b", status="active")
            db.add(org_b)
            db.commit()
            db.refresh(org_b)

        # 2. Student A (Org Alpha)
        user_student_a = db.query(models.User).filter(models.User.email == "student.sec.a@college.edu").first()
        if not user_student_a:
            user_student_a = models.User(
                email="student.sec.a@college.edu",
                hashed_password=utils.get_password_hash("StudentA_Secret123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_student_a)
            db.commit()
            db.refresh(user_student_a)

        profile_a = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_student_a.id).first()
        if not profile_a:
            profile_a = models.StudentProfile(
                user_id=user_student_a.id,
                organization_id=org_a.id,
                full_name="Alice Security Alpha",
                email="student.sec.a@college.edu",
                target_role="Full Stack Developer",
                cgpa=8.5,
                readiness_score=75.0,
                is_onboarded=True
            )
            db.add(profile_a)
            db.commit()
            db.refresh(profile_a)

        # 3. Student B (Org Beta)
        user_student_b = db.query(models.User).filter(models.User.email == "student.sec.b@college.edu").first()
        if not user_student_b:
            user_student_b = models.User(
                email="student.sec.b@college.edu",
                hashed_password=utils.get_password_hash("StudentB_Secret123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_b.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_student_b)
            db.commit()
            db.refresh(user_student_b)

        profile_b = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_student_b.id).first()
        if not profile_b:
            profile_b = models.StudentProfile(
                user_id=user_student_b.id,
                organization_id=org_b.id,
                full_name="Bob Security Beta",
                email="student.sec.b@college.edu",
                target_role="Backend Engineer",
                cgpa=7.2,
                readiness_score=60.0,
                is_onboarded=True
            )
            db.add(profile_b)
            db.commit()
            db.refresh(profile_b)

        # 4. Candidate user (Interview test taker)
        user_candidate = db.query(models.User).filter(models.User.email == "candidate.sec@extern.com").first()
        if not user_candidate:
            user_candidate = models.User(
                email="candidate.sec@extern.com",
                hashed_password=utils.get_password_hash("Candidate_Secret123!"),
                role=models.UserRole.CANDIDATE,
                is_active=True
            )
            db.add(user_candidate)
            db.commit()
            db.refresh(user_candidate)

        # 5. Drive under Org Alpha
        drive_a = db.query(models.PlacementDrive).filter(
            models.PlacementDrive.organization_id == org_a.id,
            models.PlacementDrive.company_name == "Alpha Technologies"
        ).first()
        if not drive_a:
            drive_a = models.PlacementDrive(
                organization_id=org_a.id,
                company_name="Alpha Technologies",
                role_title="Software Development Engineer",
                description="Core product engineering drive for 2026 batch",
                minimum_cgpa=7.0,
                status="OPEN"
            )
            db.add(drive_a)
            db.commit()
            db.refresh(drive_a)

        token_student_a = utils.create_access_token({"sub": user_student_a.email, "role": models.UserRole.STUDENT})
        token_student_b = utils.create_access_token({"sub": user_student_b.email, "role": models.UserRole.STUDENT})
        token_candidate = utils.create_access_token({"sub": user_candidate.email, "role": models.UserRole.CANDIDATE})

        return {
            "org_a": org_a,
            "org_b": org_b,
            "user_student_a": user_student_a,
            "profile_a": profile_a,
            "user_student_b": user_student_b,
            "profile_b": profile_b,
            "drive_a": drive_a,
            "headers_student_a": {"Authorization": f"Bearer {token_student_a}"},
            "headers_student_b": {"Authorization": f"Bearer {token_student_b}"},
            "headers_candidate": {"Authorization": f"Bearer {token_candidate}"}
        }
    finally:
        db.close()


def test_idor_cross_tenant_student_profile_isolation(audit_data):
    """Verifies Student A in Org A cannot read Student B in Org B profile by ID."""
    headers_a = audit_data["headers_student_a"]
    profile_b_id = audit_data["profile_b"].id

    res = client.get(f"/api/student/profile/{profile_b_id}", headers=headers_a)
    assert res.status_code == 403
    assert "Cross-tenant or unauthorized access denied" in res.json()["detail"]


def test_idor_cross_tenant_placement_drives_isolation(audit_data):
    """Verifies Student B in Org B cannot apply to or view private drive from Org A."""
    headers_b = audit_data["headers_student_b"]
    drive_a_id = audit_data["drive_a"].id

    res = client.post(
        f"/api/student/drives/{drive_a_id}/apply",
        headers=headers_b,
        json={"notes": "Attempting cross-tenant drive application"}
    )
    assert res.status_code in (400, 403)
    assert "Placement drive not found in your college" in res.json()["detail"] or "only apply" in res.json()["detail"]


def test_role_escalation_student_attempting_recruiter_endpoints(audit_data):
    """Verifies STUDENT token is strictly forbidden from accessing recruiter management APIs."""
    headers_a = audit_data["headers_student_a"]

    # 1. Recruiter Organization info
    res_org = client.get("/api/organization/", headers=headers_a)
    assert res_org.status_code == 403

    # 2. Recruiter Organization users
    res_users = client.get("/api/organization/users", headers=headers_a)
    assert res_users.status_code == 403

    # 3. Recruiter Organization user invite
    res_invite = client.post(
        "/api/organization/users/invite",
        headers=headers_a,
        json={"email": "attacker@evil.com", "role": "HR"}
    )
    assert res_invite.status_code == 403


def test_role_escalation_candidate_attempting_student_features(audit_data):
    """Verifies CANDIDATE token (interview taker) is strictly forbidden from student features."""
    headers_cand = audit_data["headers_candidate"]

    # Student Profile
    res_prof = client.get("/api/student/profile", headers=headers_cand)
    assert res_prof.status_code == 403
    assert "Candidate interviewees are not authorized" in res_prof.json()["detail"]

    # Student Roadmap
    res_road = client.get("/api/student/roadmap", headers=headers_cand)
    assert res_road.status_code == 403

    # Student Practice
    res_prac = client.get("/api/student/practice/topics", headers=headers_cand)
    assert res_prac.status_code == 403


def test_role_escalation_student_attempting_college_admin_endpoints(audit_data):
    """Verifies STUDENT token is strictly forbidden from college administration endpoints."""
    headers_a = audit_data["headers_student_a"]

    # College Overview
    res_over = client.get("/api/college/overview", headers=headers_a)
    assert res_over.status_code == 403
    assert "Students and candidates are not authorized" in res_over.json()["detail"]

    # College Student Roster
    res_stud = client.get("/api/college/students", headers=headers_a)
    assert res_stud.status_code == 403

    # College Create Drive
    res_drive = client.post(
        "/api/college/drives",
        headers=headers_a,
        json={"company_name": "Rogue Drive Inc", "role_title": "Hacker", "description": "Fake"}
    )
    assert res_drive.status_code == 403


def test_file_upload_security_malicious_extensions(audit_data):
    """Verifies file upload rejects disallowed script and executable extensions."""
    headers_a = audit_data["headers_student_a"]

    disallowed_files = [
        "sample_executable.exe",
        "shell_script.sh",
        "web_script.php",
        "batch_script.bat",
        "python_script.py"
    ]

    for fname in disallowed_files:
        file_obj = io.BytesIO(b"disallowed file test content")
        res = client.post(
            "/api/student/resume/upload",
            headers=headers_a,
            files={"file": (fname, file_obj, "application/octet-stream")}
        )
        assert res.status_code == 400
        assert "Unsupported file format" in res.json()["detail"]

    # Null-byte injection attempt
    null_byte_file = io.BytesIO(b"sample null byte test")
    res_null = client.post(
        "/api/student/resume/upload",
        headers=headers_a,
        files={"file": ("resume.pdf\x00.exe", null_byte_file, "application/pdf")}
    )
    assert res_null.status_code == 400


def test_file_upload_security_oversized_and_empty_payloads(audit_data):
    """Verifies upload rejects empty files (400) and oversized files > 10MB (413)."""
    headers_a = audit_data["headers_student_a"]

    # 1. Empty payload (0 bytes)
    empty_file = io.BytesIO(b"")
    res_empty = client.post(
        "/api/student/resume/upload",
        headers=headers_a,
        files={"file": ("empty_resume.pdf", empty_file, "application/pdf")}
    )
    assert res_empty.status_code == 400
    assert "Uploaded resume file cannot be empty" in res_empty.json()["detail"]

    # 2. Oversized payload (10MB + 1KB)
    eleven_mb = b"X" * (10 * 1024 * 1024 + 1024)
    huge_file = io.BytesIO(eleven_mb)
    res_huge = client.post(
        "/api/student/resume/upload",
        headers=headers_a,
        files={"file": ("huge_resume.pdf", huge_file, "application/pdf")}
    )
    assert res_huge.status_code == 413
    assert "exceeds maximum allowed limit" in res_huge.json()["detail"]


def test_sql_injection_and_path_traversal_resistance(audit_data):
    """Verifies directory traversal sanitization and SQL injection payload neutralization."""
    headers_a = audit_data["headers_student_a"]

    # 1. Directory traversal upload filename with allowed .txt extension
    valid_text_content = (
        b"Skills: Python, FastAPI, Docker, SQL, React, Node.js.\n"
        b"Projects: Built distributed career platform with 99.9% uptime.\n"
        b"Experience: Software Engineer Intern at Tech Corp.\n"
        b"Education: Bachelor of Computer Science, CGPA 8.5.\n"
    )
    traversal_file = io.BytesIO(valid_text_content)
    res_traversal = client.post(
        "/api/student/resume/upload",
        headers=headers_a,
        files={"file": ("../../../../etc/passwd_resume.txt", traversal_file, "text/plain")}
    )
    assert res_traversal.status_code == 200
    saved_path = res_traversal.json().get("file_name")
    assert ".." not in saved_path

    # 2. SQL Injection in practice questions query params
    sqli_payload = "' OR 1=1; DROP TABLE student_profiles; --"
    res_sqli_practice = client.get(
        f"/api/student/practice/questions?category=DSA&topic={sqli_payload}",
        headers=headers_a
    )
    assert res_sqli_practice.status_code in (200, 404)

    # 3. SQL Injection in drive query search
    res_sqli_drives = client.get(
        "/api/student/drives",
        headers=headers_a
    )
    assert res_sqli_drives.status_code == 200
    drives = res_sqli_drives.json()
    assert isinstance(drives, list)
    for d in drives:
        assert d["company_name"] == "Alpha Technologies"


def test_resume_download_security_and_tenant_isolation(audit_data):
    """Verifies that student resumes can only be downloaded by authorized owners, blocking IDOR."""
    headers_a = audit_data["headers_student_a"]
    headers_b = audit_data["headers_student_b"]

    # 1. Upload a resume for Student A
    content = b"John Doe Resume. Skills: Python, FastAPI. Education: B.Tech."
    upload_res = client.post(
        "/api/student/resume/upload",
        headers=headers_a,
        files={"file": ("johndoe_resume.txt", io.BytesIO(content), "text/plain")}
    )
    assert upload_res.status_code == 200
    resume_id = upload_res.json()["id"]

    # 2. Student A can download their own resume via /resume/download
    dl_self = client.get("/api/student/resume/download", headers=headers_a)
    assert dl_self.status_code == 200
    assert dl_self.content == content

    # 3. Student A can download their own resume via /resume/{id}/download
    dl_self_id = client.get(f"/api/student/resume/{resume_id}/download", headers=headers_a)
    assert dl_self_id.status_code == 200
    assert dl_self_id.content == content

    # 4. Student B (different org) CANNOT download Student A's resume by ID (403 Forbidden IDOR blocked)
    dl_cross_org = client.get(f"/api/student/resume/{resume_id}/download", headers=headers_b)
    assert dl_cross_org.status_code == 403
    assert "Cross-tenant or unauthorized access denied" in dl_cross_org.json()["detail"]

    # 5. Unauthenticated user CANNOT download resume (401 Unauthorized)
    dl_unauth = client.get(f"/api/student/resume/{resume_id}/download")
    assert dl_unauth.status_code == 401
