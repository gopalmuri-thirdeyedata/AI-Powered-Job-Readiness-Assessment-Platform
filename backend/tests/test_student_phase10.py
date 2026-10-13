"""
Test Suite for Student Career Platform — Phase 10:
Student Enrollment, Onboarding & Role-Based UX
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase10_data():
    """Sets up student users for onboarding testing."""
    db = database.SessionLocal()
    try:
        org_a = db.query(models.Organization).filter(models.Organization.slug == "college-alpha-p10").first()
        if not org_a:
            org_a = models.Organization(name="College Alpha P10", slug="college-alpha-p10", status="active")
            db.add(org_a)
            db.commit()
            db.refresh(org_a)

        org_b = db.query(models.Organization).filter(models.Organization.slug == "college-beta-p10").first()
        if not org_b:
            org_b = models.Organization(name="College Beta P10", slug="college-beta-p10", status="active")
            db.add(org_b)
            db.commit()
            db.refresh(org_b)

        # Fresh Student Alpha (Not onboarded)
        user_a = db.query(models.User).filter(models.User.email == "fresh.student.a@college.edu").first()
        if not user_a:
            user_a = models.User(
                email="fresh.student.a@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_a)
            db.commit()
            db.refresh(user_a)

        profile_a = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_a.id).first()
        if not profile_a:
            profile_a = models.StudentProfile(
                user_id=user_a.id,
                organization_id=org_a.id,
                full_name="Fresh Alpha",
                email="fresh.student.a@college.edu",
                target_role="Software Engineer",
                is_onboarded=False,
                onboarding_step=1
            )
            db.add(profile_a)
            db.commit()
            db.refresh(profile_a)
        else:
            profile_a.is_onboarded = False
            profile_a.onboarding_step = 1
            db.commit()

        # Student Beta (Different college)
        user_b = db.query(models.User).filter(models.User.email == "student.b.p10@college.edu").first()
        if not user_b:
            user_b = models.User(
                email="student.b.p10@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_b.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_b)
            db.commit()
            db.refresh(user_b)

        profile_b = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_b.id).first()
        if not profile_b:
            profile_b = models.StudentProfile(
                user_id=user_b.id,
                organization_id=org_b.id,
                full_name="Beta Student",
                email="student.b.p10@college.edu",
                target_role="Backend Developer",
                is_onboarded=True,
                onboarding_step=4
            )
            db.add(profile_b)
            db.commit()
            db.refresh(profile_b)

        token_a = utils.create_access_token({"sub": user_a.email, "role": models.UserRole.STUDENT})
        token_b = utils.create_access_token({"sub": user_b.email, "role": models.UserRole.STUDENT})

        return {
            "token_a": token_a,
            "token_b": token_b,
            "profile_a_id": profile_a.id,
            "profile_b_id": profile_b.id,
            "org_a_id": org_a.id
        }
    finally:
        db.close()


def test_onboarding_status_initial(setup_phase10_data):
    """Verifies fresh student begins with is_onboarded=False and step=1."""
    data = setup_phase10_data
    res = client.get(
        "/api/student/onboarding/status",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert res.status_code == 200, res.text
    status_info = res.json()
    assert status_info["is_onboarded"] is False
    assert status_info["onboarding_step"] == 1
    assert "Career Onboarding Wizard" in status_info["recommended_action"]


def test_onboarding_step_updates(setup_phase10_data):
    """Verifies incremental progression through onboarding steps 1, 2, and 3."""
    data = setup_phase10_data
    # Step 1: Target role and company
    res1 = client.post(
        "/api/student/onboarding/step",
        json={
            "step": 1,
            "target_role": "Full Stack Developer",
            "target_company": "Microsoft"
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert res1.status_code == 200, res1.text
    p1 = res1.json()
    assert p1["target_role"] == "Full Stack Developer"
    assert p1["target_company"] == "Microsoft"
    assert p1["onboarding_step"] >= 2

    # Step 2: Academics
    res2 = client.post(
        "/api/student/onboarding/step",
        json={
            "step": 2,
            "college_name": "Tech Institute of Engineering",
            "branch": "Computer Science",
            "graduation_year": 2026,
            "cgpa": 8.7
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert res2.status_code == 200, res2.text
    p2 = res2.json()
    assert p2["branch"] == "Computer Science"
    assert p2["cgpa"] == 8.7
    assert p2["onboarding_step"] >= 3

    # Step 3: Skills
    res3 = client.post(
        "/api/student/onboarding/step",
        json={
            "step": 3,
            "current_skills": ["React", "Python", "Node.js", "Docker"]
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert res3.status_code == 200, res3.text
    p3 = res3.json()
    assert "React" in p3["current_skills"]
    assert p3["onboarding_step"] >= 4


def test_onboarding_completion(setup_phase10_data):
    """Verifies completing onboarding marks is_onboarded=True and transitions student."""
    data = setup_phase10_data
    res = client.post(
        "/api/student/onboarding/complete",
        json={
            "target_role": "Full Stack Developer",
            "target_company": "Microsoft",
            "college_name": "Tech Institute of Engineering",
            "branch": "Computer Science",
            "graduation_year": 2026,
            "cgpa": 8.7,
            "current_skills": ["React", "Python", "Node.js", "Docker", "SQL"]
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert res.status_code == 200, res.text
    profile = res.json()
    assert profile["is_onboarded"] is True
    assert profile["onboarding_step"] == 4
    assert profile["readiness_score"] > 0

    # Ensure status endpoint confirms completed state
    status_res = client.get(
        "/api/student/onboarding/status",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert status_res.status_code == 200
    assert status_res.json()["is_onboarded"] is True


def test_profile_endpoint_reflects_onboarding_state(setup_phase10_data):
    """Verifies GET /api/student/profile includes onboarding attributes."""
    data = setup_phase10_data
    res = client.get(
        "/api/student/profile",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert res.status_code == 200, res.text
    p = res.json()
    assert "is_onboarded" in p
    assert p["is_onboarded"] is True
    assert "onboarding_step" in p
    assert p["onboarding_step"] == 4


def test_onboarding_unauthenticated_guard():
    """Verifies that onboarding endpoints reject unauthenticated requests."""
    res1 = client.get("/api/student/onboarding/status")
    assert res1.status_code == 401

    res2 = client.post("/api/student/onboarding/step", json={"step": 1})
    assert res2.status_code == 401

    res3 = client.post("/api/student/onboarding/complete", json={"target_role": "Engineer"})
    assert res3.status_code == 401


def test_onboarding_tenant_and_student_isolation(setup_phase10_data):
    """Verifies student B sees only their own onboarding status without cross-student bleed."""
    data = setup_phase10_data
    res_b = client.get(
        "/api/student/onboarding/status",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert res_b.status_code == 200
    status_b = res_b.json()
    # Student B's target role is Backend Developer, not Full Stack Developer
    assert status_b["target_role"] == "Backend Developer"
    assert status_b["is_onboarded"] is True
