"""
Test Suite for Student Career Platform — Phase 9:
College Placement Officer Dashboard & Campus Drives
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase9_data():
    """Sets up two college organizations, college admins, and students for testing."""
    db = database.SessionLocal()
    try:
        # College Alpha
        org_a = db.query(models.Organization).filter(models.Organization.slug == "college-alpha-p9").first()
        if not org_a:
            org_a = models.Organization(name="College Alpha P9", slug="college-alpha-p9", status="active")
            db.add(org_a)
            db.commit()
            db.refresh(org_a)

        # College Beta
        org_b = db.query(models.Organization).filter(models.Organization.slug == "college-beta-p9").first()
        if not org_b:
            org_b = models.Organization(name="College Beta P9", slug="college-beta-p9", status="active")
            db.add(org_b)
            db.commit()
            db.refresh(org_b)

        # Officer/Admin for College Alpha
        admin_a = db.query(models.User).filter(models.User.email == "officer.alpha@college.edu").first()
        if not admin_a:
            admin_a = models.User(
                email="officer.alpha@college.edu",
                hashed_password=utils.get_password_hash("OfficerPass123!"),
                role=models.UserRole.ORGANIZATION_ADMIN,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(admin_a)
            db.commit()
            db.refresh(admin_a)

            member_a = models.OrganizationMember(
                organization_id=org_a.id,
                user_id=admin_a.id,
                role="ORGANIZATION_ADMIN",
                status="active"
            )
            db.add(member_a)
            db.commit()

        # Officer/Admin for College Beta
        admin_b = db.query(models.User).filter(models.User.email == "officer.beta@college.edu").first()
        if not admin_b:
            admin_b = models.User(
                email="officer.beta@college.edu",
                hashed_password=utils.get_password_hash("OfficerPass123!"),
                role=models.UserRole.ORGANIZATION_ADMIN,
                organization_id=org_b.id,
                is_active=True,
                password_changed=True
            )
            db.add(admin_b)
            db.commit()
            db.refresh(admin_b)

            member_b = models.OrganizationMember(
                organization_id=org_b.id,
                user_id=admin_b.id,
                role="ORGANIZATION_ADMIN",
                status="active"
            )
            db.add(member_b)
            db.commit()

        # Student Alpha (Eligible, CGPA 8.5)
        user_sa = db.query(models.User).filter(models.User.email == "alice.p9@college.edu").first()
        if not user_sa:
            user_sa = models.User(
                email="alice.p9@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_sa)
            db.commit()
            db.refresh(user_sa)

        profile_sa = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_sa.id).first()
        if not profile_sa:
            profile_sa = models.StudentProfile(
                user_id=user_sa.id,
                organization_id=org_a.id,
                full_name="Alice Alpha P9",
                email="alice.p9@college.edu",
                branch="Computer Science",
                graduation_year=2026,
                cgpa=8.5,
                target_role="Full Stack Developer",
                current_skills=["React", "Python", "Docker"],
                readiness_score=78.0
            )
            db.add(profile_sa)
            db.commit()
            db.refresh(profile_sa)

        # Student Alpha Low CGPA (Ineligible for 8.0+ drives, CGPA 6.5)
        user_low = db.query(models.User).filter(models.User.email == "lowcgpa.p9@college.edu").first()
        if not user_low:
            user_low = models.User(
                email="lowcgpa.p9@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_low)
            db.commit()
            db.refresh(user_low)

        profile_low = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_low.id).first()
        if not profile_low:
            profile_low = models.StudentProfile(
                user_id=user_low.id,
                organization_id=org_a.id,
                full_name="Low CGPA Student",
                email="lowcgpa.p9@college.edu",
                branch="Information Technology",
                graduation_year=2026,
                cgpa=6.5,
                target_role="Backend Engineer",
                current_skills=["Python"],
                readiness_score=42.0
            )
            db.add(profile_low)
            db.commit()
            db.refresh(profile_low)

        # Student Beta (Different college)
        user_sb = db.query(models.User).filter(models.User.email == "bob.p9@college.edu").first()
        if not user_sb:
            user_sb = models.User(
                email="bob.p9@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_b.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_sb)
            db.commit()
            db.refresh(user_sb)

        profile_sb = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_sb.id).first()
        if not profile_sb:
            profile_sb = models.StudentProfile(
                user_id=user_sb.id,
                organization_id=org_b.id,
                full_name="Bob Beta P9",
                email="bob.p9@college.edu",
                branch="Electronics",
                graduation_year=2026,
                cgpa=8.0,
                target_role="Data Engineer",
                current_skills=["Python", "SQL"],
                readiness_score=60.0
            )
            db.add(profile_sb)
            db.commit()
            db.refresh(profile_sb)

        token_admin_a = utils.create_access_token({"sub": admin_a.email, "role": models.UserRole.ORGANIZATION_ADMIN})
        token_admin_b = utils.create_access_token({"sub": admin_b.email, "role": models.UserRole.ORGANIZATION_ADMIN})
        token_student_a = utils.create_access_token({"sub": user_sa.email, "role": models.UserRole.STUDENT})
        token_student_low = utils.create_access_token({"sub": user_low.email, "role": models.UserRole.STUDENT})
        token_student_b = utils.create_access_token({"sub": user_sb.email, "role": models.UserRole.STUDENT})

        return {
            "token_admin_a": token_admin_a,
            "token_admin_b": token_admin_b,
            "token_student_a": token_student_a,
            "token_student_low": token_student_low,
            "token_student_b": token_student_b,
            "org_a_id": org_a.id,
            "org_b_id": org_b.id,
            "profile_sa_id": profile_sa.id
        }
    finally:
        db.close()


def test_college_overview_analytics(setup_phase9_data):
    """Verifies GET /api/college/overview aggregates cohort metrics and skill intelligence."""
    data = setup_phase9_data
    res = client.get(
        "/api/college/overview",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert res.status_code == 200, res.text
    overview = res.json()
    assert overview["total_students"] >= 2
    assert overview["average_readiness_score"] > 0
    assert overview["high_readiness_count"] >= 1
    assert overview["at_risk_count"] >= 1
    assert len(overview["top_cohort_skills"]) > 0
    assert "Computer Science" in overview["branch_distribution"]


def test_college_students_roster_and_filtering(setup_phase9_data):
    """Verifies GET /api/college/students supports search and branch filters."""
    data = setup_phase9_data
    # Search by Alice
    res = client.get(
        "/api/college/students?search=Alice",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert res.status_code == 200, res.text
    students = res.json()
    assert len(students) >= 1
    alice = students[0]
    assert alice["full_name"] == "Alice Alpha P9"
    assert alice["branch"] == "Computer Science"
    assert alice["cgpa"] == 8.5
    assert alice["readiness_score"] == 78.0

    # Filter by min_readiness
    res_high = client.get(
        "/api/college/students?min_readiness=70.0",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert res_high.status_code == 200
    for s in res_high.json():
        assert s["readiness_score"] >= 70.0


def test_create_and_list_placement_drives(setup_phase9_data):
    """Verifies creating an on-campus placement drive and listing drives."""
    data = setup_phase9_data
    create_res = client.post(
        "/api/college/drives",
        json={
            "company_name": "Acme Corp",
            "role_title": "Software Development Engineer",
            "description": "Full-time campus placement for graduating engineers.",
            "eligibility_criteria": "B.Tech Computer Science / IT with 7.5+ CGPA",
            "minimum_cgpa": 7.5,
            "required_skills": ["React", "Python"],
            "package_lpa": 14.5,
            "status": "OPEN"
        },
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert create_res.status_code == 201, create_res.text
    drive = create_res.json()
    assert drive["id"] is not None
    assert drive["company_name"] == "Acme Corp"
    assert drive["minimum_cgpa"] == 7.5
    assert drive["applicant_count"] == 0

    # List drives
    list_res = client.get(
        "/api/college/drives?status=OPEN",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert list_res.status_code == 200
    drives = list_res.json()
    assert any(d["company_name"] == "Acme Corp" for d in drives)


def test_student_apply_to_drive_and_eligibility(setup_phase9_data):
    """Verifies student application submission, CGPA eligibility enforcement, and duplicate rejection."""
    data = setup_phase9_data
    # Fetch open drive
    drives_res = client.get(
        "/api/student/drives",
        headers={"Authorization": f"Bearer {data['token_student_a']}"}
    )
    assert drives_res.status_code == 200, drives_res.text
    drives = drives_res.json()
    acme_drive = next(d for d in drives if d["company_name"] == "Acme Corp")
    drive_id = acme_drive["id"]

    # Alice (CGPA 8.5) applies -> SUCCESS
    apply_res = client.post(
        f"/api/student/drives/{drive_id}/apply",
        json={"notes": "Eager to interview for this role."},
        headers={"Authorization": f"Bearer {data['token_student_a']}"}
    )
    assert apply_res.status_code == 201, apply_res.text
    app_data = apply_res.json()
    assert app_data["status"] == "APPLIED"
    assert app_data["company_name"] == "Acme Corp"

    # Alice attempts duplicate application -> 400 Bad Request
    dup_res = client.post(
        f"/api/student/drives/{drive_id}/apply",
        json={"notes": "Duplicate attempt"},
        headers={"Authorization": f"Bearer {data['token_student_a']}"}
    )
    assert dup_res.status_code == 400
    assert "already submitted an application" in dup_res.json()["detail"]

    # Student with CGPA 6.5 attempts to apply to 7.5 CGPA drive -> 400 Bad Request
    ineligible_res = client.post(
        f"/api/student/drives/{drive_id}/apply",
        headers={"Authorization": f"Bearer {data['token_student_low']}"}
    )
    assert ineligible_res.status_code == 400
    assert "minimum eligibility requirement" in ineligible_res.json()["detail"]


def test_college_drive_applications_and_status_update(setup_phase9_data):
    """Verifies reviewing drive applicants and progressing candidate status."""
    data = setup_phase9_data
    # Admin gets drive applications
    drives_res = client.get(
        "/api/college/drives",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    acme_drive = next(d for d in drives_res.json() if d["company_name"] == "Acme Corp")
    drive_id = acme_drive["id"]

    apps_res = client.get(
        f"/api/college/drives/{drive_id}/applications",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert apps_res.status_code == 200, apps_res.text
    applications = apps_res.json()
    assert len(applications) >= 1
    alice_app = next(a for a in applications if a["student_email"] == "alice.p9@college.edu")
    assert alice_app["student_name"] == "Alice Alpha P9"
    assert alice_app["student_cgpa"] == 8.5
    assert alice_app["status"] == "APPLIED"

    # Update status to SHORTLISTED
    update_res = client.patch(
        f"/api/college/applications/{alice_app['id']}/status",
        json={"status": "SHORTLISTED", "notes": "Shortlisted for Round 1 interviews."},
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert update_res.status_code == 200, update_res.text
    assert update_res.json()["status"] == "SHORTLISTED"
    assert update_res.json()["notes"] == "Shortlisted for Round 1 interviews."

    # Update status to PLACED
    placed_res = client.patch(
        f"/api/college/applications/{alice_app['id']}/status",
        json={"status": "PLACED", "notes": "Offer extended and accepted."},
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    assert placed_res.status_code == 200
    assert placed_res.json()["status"] == "PLACED"


def test_college_tenant_isolation_and_idor(setup_phase9_data):
    """Verifies multi-tenant isolation, cross-tenant IDOR prevention, and role guard enforcement."""
    data = setup_phase9_data
    # Get Alpha's drive id
    drives_res = client.get(
        "/api/college/drives",
        headers={"Authorization": f"Bearer {data['token_admin_a']}"}
    )
    alpha_drive_id = drives_res.json()[0]["id"]

    # 1. College Beta admin attempts to access College Alpha's drive -> 404
    beta_get_res = client.get(
        f"/api/college/drives/{alpha_drive_id}",
        headers={"Authorization": f"Bearer {data['token_admin_b']}"}
    )
    assert beta_get_res.status_code == 404

    # 2. College Beta admin attempts to update College Alpha's drive -> 404
    beta_update_res = client.put(
        f"/api/college/drives/{alpha_drive_id}",
        json={"company_name": "Hacked Name"},
        headers={"Authorization": f"Bearer {data['token_admin_b']}"}
    )
    assert beta_update_res.status_code == 404

    # 3. College Beta admin attempts to view College Alpha's applications -> 404
    beta_apps_res = client.get(
        f"/api/college/drives/{alpha_drive_id}/applications",
        headers={"Authorization": f"Bearer {data['token_admin_b']}"}
    )
    assert beta_apps_res.status_code == 404

    # 4. Student Beta attempts to apply to College Alpha's drive -> 400
    beta_apply_res = client.post(
        f"/api/student/drives/{alpha_drive_id}/apply",
        headers={"Authorization": f"Bearer {data['token_student_b']}"}
    )
    assert beta_apply_res.status_code == 400
    assert "not found in your college" in beta_apply_res.json()["detail"]

    # 5. Student attempts to access College Admin overview -> 403 Forbidden
    student_admin_res = client.get(
        "/api/college/overview",
        headers={"Authorization": f"Bearer {data['token_student_a']}"}
    )
    assert student_admin_res.status_code == 403

    # 6. Unauthenticated request -> 401 Unauthorized
    anon_res = client.get("/api/college/overview")
    assert anon_res.status_code == 401
