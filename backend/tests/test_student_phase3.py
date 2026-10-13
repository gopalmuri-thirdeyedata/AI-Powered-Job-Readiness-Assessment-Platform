"""
Test Suite for Student Career Platform — Phase 3:
Personalized Roadmap & Daily Preparation Plan
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase3_data():
    """Sets up student user, profile, and second student for IDOR testing."""
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "college-alpha").first()
        if not org:
            org = models.Organization(name="College Alpha", slug="college-alpha", status="active")
            db.add(org)
            db.commit()
            db.refresh(org)

        # Student A
        user_a = db.query(models.User).filter(models.User.email == "student.alpha@college.edu").first()
        if not user_a:
            user_a = models.User(
                email="student.alpha@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org.id,
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
                organization_id=org.id,
                full_name="Alice Alpha",
                email="student.alpha@college.edu",
                target_role="Full Stack Developer",
                target_company="Google",
                current_skills=["React", "JavaScript"]
            )
            db.add(profile_a)
            db.commit()
            db.refresh(profile_a)
        else:
            profile_a.target_role = "Full Stack Developer"
            db.commit()

        # Clean up existing roadmap for student A to test fresh generation
        db.query(models.StudentDailyTask).filter(models.StudentDailyTask.student_profile_id == profile_a.id).delete()
        db.query(models.StudentRoadmap).filter(models.StudentRoadmap.student_profile_id == profile_a.id).delete()
        db.commit()

        # Student B
        user_b = db.query(models.User).filter(models.User.email == "student.beta@college.edu").first()
        if not user_b:
            user_b = models.User(
                email="student.beta@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org.id,
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
                organization_id=org.id,
                full_name="Bob Beta",
                email="student.beta@college.edu",
                target_role="Data Engineer",
                current_skills=["Python", "SQL"]
            )
            db.add(profile_b)
            db.commit()
            db.refresh(profile_b)

        token_a = utils.create_access_token({"sub": "student.alpha@college.edu", "role": "STUDENT"})
        token_b = utils.create_access_token({"sub": "student.beta@college.edu", "role": "STUDENT"})

        return {
            "token_a": token_a,
            "token_b": token_b,
            "profile_a_id": profile_a.id,
            "profile_b_id": profile_b.id
        }
    finally:
        db.close()


def test_get_student_roadmap_auto_generation(setup_phase3_data):
    """Validates GET /api/student/roadmap auto-generates active roadmap with 20 tasks across 4 weeks."""
    headers = {"Authorization": f"Bearer {setup_phase3_data['token_a']}"}
    response = client.get("/api/student/roadmap", headers=headers)
    assert response.status_code == 200
    data = response.json()

    assert data["target_role"] == "Full Stack Developer"
    assert data["total_weeks"] == 4
    assert data["total_tasks"] == 20
    assert len(data["weeks"]) == 4
    assert data["completion_rate"] == 0.0

    week1 = data["weeks"][0]
    assert week1["week_number"] == 1
    assert len(week1["tasks"]) == 5
    assert "category" in week1["tasks"][0]
    assert "why_recommended" in week1["tasks"][0]


def test_update_daily_task_status(setup_phase3_data):
    """Validates PATCH /api/student/daily-tasks/{id} updates status to COMPLETED."""
    headers = {"Authorization": f"Bearer {setup_phase3_data['token_a']}"}
    roadmap_res = client.get("/api/student/roadmap", headers=headers)
    task_id = roadmap_res.json()["weeks"][0]["tasks"][0]["id"]

    update_res = client.patch(
        f"/api/student/daily-tasks/{task_id}",
        json={"status": "COMPLETED"},
        headers=headers
    )
    assert update_res.status_code == 200
    updated_task = update_res.json()
    assert updated_task["status"] == "COMPLETED"
    assert updated_task["completed_at"] is not None

    # Check that roadmap completion rate increased
    roadmap_res2 = client.get("/api/student/roadmap", headers=headers)
    assert roadmap_res2.json()["completed_tasks"] >= 1
    assert roadmap_res2.json()["completion_rate"] > 0.0


def test_update_task_idor_denied(setup_phase3_data):
    """Validates student B cannot modify student A's daily tasks (IDOR prevention)."""
    headers_a = {"Authorization": f"Bearer {setup_phase3_data['token_a']}"}
    headers_b = {"Authorization": f"Bearer {setup_phase3_data['token_b']}"}

    roadmap_res_a = client.get("/api/student/roadmap", headers=headers_a)
    task_a_id = roadmap_res_a.json()["weeks"][0]["tasks"][0]["id"]

    # Student B attempts to alter Student A's task
    tamper_res = client.patch(
        f"/api/student/daily-tasks/{task_a_id}",
        json={"status": "SKIPPED"},
        headers=headers_b
    )
    assert tamper_res.status_code == 404


def test_roadmap_regeneration_preserves_completed(setup_phase3_data):
    """Validates regenerating roadmap preserves already completed tasks."""
    headers = {"Authorization": f"Bearer {setup_phase3_data['token_a']}"}

    # Ensure at least one task is COMPLETED
    roadmap_res = client.get("/api/student/roadmap", headers=headers)
    completed_before = roadmap_res.json()["completed_tasks"]
    assert completed_before >= 1

    # Regenerate roadmap
    regen_res = client.post(
        "/api/student/roadmap/generate",
        json={"target_role": "Backend Engineer", "regenerate": True},
        headers=headers
    )
    assert regen_res.status_code == 200
    regen_data = regen_res.json()

    assert regen_data["target_role"] == "Backend Engineer"
    # Completed tasks must be preserved!
    assert regen_data["completed_tasks"] >= completed_before


def test_invalid_task_status_rejected(setup_phase3_data):
    """Validates invalid task status returns 400 Bad Request."""
    headers = {"Authorization": f"Bearer {setup_phase3_data['token_a']}"}
    roadmap_res = client.get("/api/student/roadmap", headers=headers)
    task_id = roadmap_res.json()["weeks"][0]["tasks"][0]["id"]

    invalid_res = client.patch(
        f"/api/student/daily-tasks/{task_id}",
        json={"status": "INVALID_STATE"},
        headers=headers
    )
    assert invalid_res.status_code == 400


def test_unauthenticated_roadmap_denied():
    """Validates unauthenticated roadmap requests return 401."""
    res = client.get("/api/student/roadmap")
    assert res.status_code == 401
