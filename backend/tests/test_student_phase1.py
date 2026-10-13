"""
Phase 1 Final Security & Authorization Test Suite.
Verifies all 14 required security scenarios:
1. Student registers/provisions correctly (Model A pre-invite and Model B invite code).
2. Student cannot provide arbitrary organization_id.
3. Student cannot create themselves under another organization.
4. Student can access own profile.
5. Student cannot access another student's profile (cross-student blocked).
6. Student can access own resume.
7. Student cannot access another student's resume.
8. Organization A student cannot access Organization B data.
9. Unauthenticated user receives 401.
10. Existing recruiter authentication still works.
11. Existing candidate authentication still works.
12. Existing Platform Admin still works.
13. Existing Organization Admin still works.
14. Existing HR still works.
"""

import io
import pytest
from fastapi.testclient import TestClient

import models, database, utils
from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_security_data():
    """Sets up isolated organizations, users, and pre-conditions in test database."""
    db = database.SessionLocal()
    try:
        # 1. Organizations: College Alpha & College Beta
        org_a = db.query(models.Organization).filter(models.Organization.slug == "college-alpha").first()
        if not org_a:
            org_a = models.Organization(name="College Alpha", slug="college-alpha", status="active")
            db.add(org_a)
            db.commit()
            db.refresh(org_a)

        org_b = db.query(models.Organization).filter(models.Organization.slug == "college-beta").first()
        if not org_b:
            org_b = models.Organization(name="College Beta", slug="college-beta", status="active")
            db.add(org_b)
            db.commit()
            db.refresh(org_b)

        # 2. Platform Admin
        plat_user = db.query(models.User).filter(models.User.email == "admin@hiringai.com").first()
        if not plat_user:
            plat_user = models.User(
                email="admin@hiringai.com",
                role=models.UserRole.PLATFORM_ADMIN,
                hashed_password=utils.get_password_hash("PlatformAdminPass123!"),
                is_active=True
            )
            db.add(plat_user)
            db.commit()
            db.refresh(plat_user)

        # 3. Organization Admin (College Alpha)
        org_a_admin = db.query(models.User).filter(models.User.email == "admin.alpha@college.edu").first()
        if not org_a_admin:
            org_a_admin = models.User(
                email="admin.alpha@college.edu",
                role=models.UserRole.ORGANIZATION_ADMIN,
                hashed_password=utils.get_password_hash("OrgAdminPass123!"),
                organization_id=org_a.id,
                is_active=True
            )
            db.add(org_a_admin)
            db.commit()
            db.refresh(org_a_admin)

            member_admin = models.OrganizationMember(
                organization_id=org_a.id,
                user_id=org_a_admin.id,
                role="ORGANIZATION_ADMIN",
                status="active"
            )
            db.add(member_admin)
            db.commit()

        # 4. HR User (College Alpha)
        hr_user = db.query(models.User).filter(models.User.email == "hr.alpha@college.edu").first()
        if not hr_user:
            hr_user = models.User(
                email="hr.alpha@college.edu",
                role=models.UserRole.HR,
                hashed_password=utils.get_password_hash("RecruiterPass123!"),
                organization_id=org_a.id,
                is_active=True
            )
            db.add(hr_user)
            db.commit()
            db.refresh(hr_user)

            member_hr = models.OrganizationMember(
                organization_id=org_a.id,
                user_id=hr_user.id,
                role="HR",
                status="active"
            )
            db.add(member_hr)
            db.commit()

        # 5. Student A (College Alpha)
        user_student_a = db.query(models.User).filter(models.User.email == "student.alpha@college.edu").first()
        if not user_student_a:
            user_student_a = models.User(
                email="student.alpha@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
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
                full_name="Alice Alpha",
                email="student.alpha@college.edu",
                target_role="Full Stack Developer",
                readiness_score=75.0
            )
            db.add(profile_a)
            db.commit()
            db.refresh(profile_a)

        # Resume for Student A
        resume_a = db.query(models.StudentResume).filter(models.StudentResume.student_profile_id == profile_a.id).first()
        if not resume_a:
            resume_a = models.StudentResume(
                student_profile_id=profile_a.id,
                version=1,
                file_path="media/student_resumes/alice_v1.pdf",
                file_name="alice_v1.pdf",
                overall_score=82.0,
                ats_score=85.0,
                analysis_data={"technical_skills": ["React", "Python", "SQL"]},
                strengths=["React", "Python"],
                weaknesses=["System Design"],
                missing_information=["GitHub link"],
                recommendations=["Improve project metrics"]
            )
            db.add(resume_a)
            db.commit()
            db.refresh(resume_a)

        # 6. Student B (College Beta)
        user_student_b = db.query(models.User).filter(models.User.email == "student.beta@college.edu").first()
        if not user_student_b:
            user_student_b = models.User(
                email="student.beta@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
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
                full_name="Bob Beta",
                email="student.beta@college.edu",
                target_role="Data Engineer",
                readiness_score=60.0
            )
            db.add(profile_b)
            db.commit()
            db.refresh(profile_b)

        # Resume for Student B
        resume_b = db.query(models.StudentResume).filter(models.StudentResume.student_profile_id == profile_b.id).first()
        if not resume_b:
            resume_b = models.StudentResume(
                student_profile_id=profile_b.id,
                version=1,
                file_path="media/student_resumes/bob_v1.pdf",
                file_name="bob_v1.pdf",
                overall_score=70.0,
                ats_score=72.0,
                analysis_data={"technical_skills": ["Java", "SQL"]},
                strengths=["Java"],
                weaknesses=["Cloud Deployment"],
                missing_information=["Certifications"],
                recommendations=["Add AWS certifications"]
            )
            db.add(resume_b)
            db.commit()
            db.refresh(resume_b)

        # 7. Candidate user & record
        cand_record = db.query(models.Candidate).filter(models.Candidate.email == "cand.portal@test.com").first()
        if not cand_record:
            cand_record = models.Candidate(
                name="Candidate Portal User",
                email="cand.portal@test.com",
                role="Software Engineer",
                hashed_password=utils.get_password_hash("CandPortalPass123!"),
                organization_id=org_a.id,
                is_active=True
            )
            db.add(cand_record)
            db.commit()
            db.refresh(cand_record)

        cand_shadow_email = f"candidate_{cand_record.id}@hiringai.internal"
        cand_user = db.query(models.User).filter(models.User.email == cand_shadow_email).first()
        if not cand_user:
            cand_user = models.User(
                email=cand_shadow_email,
                role=models.UserRole.CANDIDATE,
                hashed_password=utils.get_password_hash("CandPass123!"),
                organization_id=org_a.id,
                is_active=True
            )
            db.add(cand_user)
            db.commit()

        # Generate tokens
        token_a = utils.create_access_token({"sub": "student.alpha@college.edu", "role": "STUDENT"})
        token_b = utils.create_access_token({"sub": "student.beta@college.edu", "role": "STUDENT"})
        token_org_admin = utils.create_access_token({"sub": "admin.alpha@college.edu", "role": "ORGANIZATION_ADMIN"})
        token_hr = utils.create_access_token({"sub": "hr.alpha@college.edu", "role": "HR"})
        token_plat = utils.create_access_token({"sub": "admin@hiringai.com", "role": "PLATFORM_ADMIN"})

        latest_resume_a = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == profile_a.id
        ).order_by(models.StudentResume.version.desc()).first()

        latest_resume_b = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == profile_b.id
        ).order_by(models.StudentResume.version.desc()).first()

        return {
            "token_a": token_a,
            "token_b": token_b,
            "token_org_admin": token_org_admin,
            "token_hr": token_hr,
            "token_plat": token_plat,
            "profile_a_id": profile_a.id,
            "profile_b_id": profile_b.id,
            "resume_a_id": latest_resume_a.id,
            "resume_b_id": latest_resume_b.id,
            "org_a_id": org_a.id,
            "org_b_id": org_b.id
        }
    finally:
        db.close()


def test_01_student_registers_and_provisions_correctly(setup_security_data):
    """1. Student registers/provisions correctly via College Admin invite (Model A) or Invite Code (Model B)."""
    # Clean up test email if exists
    db = database.SessionLocal()
    for e in ["invited.student@college.edu", "codeslug.student@college.edu"]:
        u = db.query(models.User).filter(models.User.email == e).first()
        if u:
            db.query(models.StudentProfile).filter(models.StudentProfile.user_id == u.id).delete()
            db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == u.id).delete()
            db.delete(u)
    db.commit()

    # Model A: College Admin invites a student
    headers_admin = {"Authorization": f"Bearer {setup_security_data['token_org_admin']}"}
    invite_res = client.post(
        "/api/organization/users/invite",
        headers=headers_admin,
        json={"email": "invited.student@college.edu", "role": "STUDENT"}
    )
    assert invite_res.status_code == 200, invite_res.text

    # Student activates account by registering with their invited email
    reg_res_a = client.post(
        "/api/student/auth/register",
        json={
            "email": "invited.student@college.edu",
            "password": "NewStudentPass123!",
            "full_name": "Invited Student"
        }
    )
    assert reg_res_a.status_code == 200, reg_res_a.text
    token_data_a = reg_res_a.json()
    assert "access" in token_data_a

    # Verify student is bound to College Alpha
    me_res = client.get("/api/student/profile", headers={"Authorization": f"Bearer {token_data_a['access']}"})
    assert me_res.status_code == 200
    assert me_res.json()["organization_id"] == setup_security_data["org_a_id"]

    # Model B: Student registers using College Beta invite code slug
    reg_res_b = client.post(
        "/api/student/auth/register",
        json={
            "email": "codeslug.student@college.edu",
            "password": "NewStudentPass123!",
            "full_name": "Code Slug Student",
            "invite_code": "college-beta"
        }
    )
    assert reg_res_b.status_code == 200, reg_res_b.text
    token_data_b = reg_res_b.json()
    me_res_b = client.get("/api/student/profile", headers={"Authorization": f"Bearer {token_data_b['access']}"})
    assert me_res_b.status_code == 200
    assert me_res_b.json()["organization_id"] == setup_security_data["org_b_id"]


def test_02_student_cannot_provide_arbitrary_organization_id():
    """2. Student cannot provide arbitrary organization_id (uninvited unknown student is rejected)."""
    # Unknown student attempts to pass organization_id=1 without invite or code
    res = client.post(
        "/api/student/auth/register",
        json={
            "email": "malicious.student.1@random.com",
            "password": "Password123!",
            "organization_id": 1
        }
    )
    assert res.status_code == 403
    assert "registration rejected" in res.json()["detail"].lower()


def test_03_student_cannot_create_themselves_under_another_organization(setup_security_data):
    """3. Student cannot create themselves under another organization (client-sent organization_id is ignored)."""
    # Student provides valid invite code for College Beta, but maliciously sends organization_id=setup_security_data['org_a_id']
    email = "tamper.student@test.com"
    db = database.SessionLocal()
    u = db.query(models.User).filter(models.User.email == email).first()
    if u:
        db.query(models.StudentProfile).filter(models.StudentProfile.user_id == u.id).delete()
        db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == u.id).delete()
        db.delete(u)
        db.commit()

    res = client.post(
        "/api/student/auth/register",
        json={
            "email": email,
            "password": "Password123!",
            "full_name": "Tamper Test",
            "invite_code": "college-beta",
            "organization_id": setup_security_data["org_a_id"]  # Attempting to hijack Org A
        }
    )
    assert res.status_code == 200
    token = res.json()["access"]

    # Verify that the server bound them STRICTLY to College Beta (from invite_code), NOT Org A
    profile_res = client.get("/api/student/profile", headers={"Authorization": f"Bearer {token}"})
    assert profile_res.status_code == 200
    assert profile_res.json()["organization_id"] == setup_security_data["org_b_id"]
    assert profile_res.json()["organization_id"] != setup_security_data["org_a_id"]


def test_04_student_can_access_own_profile(setup_security_data):
    """4. Student can access own profile."""
    headers_a = {"Authorization": f"Bearer {setup_security_data['token_a']}"}
    res = client.get("/api/student/profile", headers=headers_a)
    assert res.status_code == 200
    data = res.json()
    assert data["email"] == "student.alpha@college.edu"
    assert data["id"] == setup_security_data["profile_a_id"]


def test_05_student_cannot_access_another_students_profile(setup_security_data):
    """5. Student cannot access another student's profile (cross-student blocked)."""
    headers_a = {"Authorization": f"Bearer {setup_security_data['token_a']}"}
    # Student A attempts to access Student B's profile by ID
    res = client.get(f"/api/student/profile/{setup_security_data['profile_b_id']}", headers=headers_a)
    assert res.status_code == 403
    assert "cross-tenant or unauthorized access denied" in res.json()["detail"].lower()


def test_06_student_can_access_own_resume(setup_security_data):
    """6. Student can access own resume."""
    headers_a = {"Authorization": f"Bearer {setup_security_data['token_a']}"}
    # Access via general resume endpoint
    res = client.get("/api/student/resume", headers=headers_a)
    assert res.status_code == 200
    assert res.json()["id"] == setup_security_data["resume_a_id"]

    # Access via specific resume_id
    res_by_id = client.get(f"/api/student/resume/{setup_security_data['resume_a_id']}", headers=headers_a)
    assert res_by_id.status_code == 200
    assert res_by_id.json()["id"] == setup_security_data["resume_a_id"]


def test_07_student_cannot_access_another_students_resume(setup_security_data):
    """7. Student cannot access another student's resume."""
    headers_a = {"Authorization": f"Bearer {setup_security_data['token_a']}"}
    # Student A attempts to access Student B's resume by path param
    res_path = client.get(f"/api/student/resume/{setup_security_data['resume_b_id']}", headers=headers_a)
    assert res_path.status_code == 403

    # Student A attempts to access Student B's resume via query param
    res_query = client.get(f"/api/student/resume?resume_id={setup_security_data['resume_b_id']}", headers=headers_a)
    assert res_query.status_code == 403


def test_08_organization_a_student_cannot_access_organization_b_data(setup_security_data):
    """8. Organization A student cannot access Organization B data."""
    headers_a = {"Authorization": f"Bearer {setup_security_data['token_a']}"}
    # Student in Org A attempts to access Student in Org B
    res_prof = client.get(f"/api/student/profile/{setup_security_data['profile_b_id']}", headers=headers_a)
    assert res_prof.status_code == 403

    res_res = client.get(f"/api/student/resume/{setup_security_data['resume_b_id']}", headers=headers_a)
    assert res_res.status_code == 403


def test_09_unauthenticated_user_receives_401():
    """9. Unauthenticated user receives 401."""
    assert client.get("/api/student/profile").status_code == 401
    assert client.get("/api/student/resume").status_code == 401
    assert client.get("/api/student/dashboard").status_code == 401
    assert client.get("/api/student/readiness").status_code == 401


def test_10_existing_recruiter_authentication_still_works(setup_security_data):
    """10. Existing recruiter authentication still works."""
    login_res = client.post("/api/auth/login/", json={
        "username": "hr.alpha@college.edu",
        "password": "RecruiterPass123!"
    })
    assert login_res.status_code == 200
    assert "access" in login_res.json()


def test_11_existing_candidate_authentication_still_works():
    """11. Existing candidate authentication still works."""
    cand_res = client.post("/api/auth/candidate-login/", json={
        "username": "cand.portal@test.com",
        "password": "CandPortalPass123!"
    })
    assert cand_res.status_code == 200
    assert "access" in cand_res.json()


def test_12_existing_platform_admin_still_works(setup_security_data):
    """12. Existing Platform Admin still works."""
    headers_plat = {"Authorization": f"Bearer {setup_security_data['token_plat']}"}
    me_res = client.get("/api/auth/me", headers=headers_plat)
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "PLATFORM_ADMIN"

    # Platform Admin can view any student profile
    prof_a = client.get(f"/api/student/profile/{setup_security_data['profile_a_id']}", headers=headers_plat)
    assert prof_a.status_code == 200


def test_13_existing_organization_admin_still_works(setup_security_data):
    """13. Existing Organization Admin still works."""
    headers_admin = {"Authorization": f"Bearer {setup_security_data['token_org_admin']}"}
    me_res = client.get("/api/auth/me", headers=headers_admin)
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "ORGANIZATION_ADMIN"

    # Org Admin can view students within their own organization
    prof_a = client.get(f"/api/student/profile/{setup_security_data['profile_a_id']}", headers=headers_admin)
    assert prof_a.status_code == 200

    # Org Admin cannot access students in another organization (Org B)
    prof_b = client.get(f"/api/student/profile/{setup_security_data['profile_b_id']}", headers=headers_admin)
    assert prof_b.status_code == 403


def test_14_existing_hr_still_works(setup_security_data):
    """14. Existing HR still works."""
    headers_hr = {"Authorization": f"Bearer {setup_security_data['token_hr']}"}
    me_res = client.get("/api/auth/me", headers=headers_hr)
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "HR"

    # HR cannot invite other organization admins
    inv_res = client.post(
        "/api/organization/users/invite",
        headers=headers_hr,
        json={"email": "bad.invite@test.com", "role": "ORGANIZATION_ADMIN"}
    )
    assert inv_res.status_code == 403
