"""
Test Suite for Student Career Platform — Phase 5:
AI Mock Interview & Communication Improvement
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase5_data():
    """Sets up student user and profile in the database."""
    db = database.SessionLocal()
    try:
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

        # Student Alpha
        user_a = db.query(models.User).filter(models.User.email == "student.alpha@college.edu").first()
        if not user_a:
            user_a = models.User(
                email="student.alpha@college.edu",
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
                full_name="Alice Alpha",
                email="student.alpha@college.edu",
                target_role="Full Stack Developer",
                current_skills=["React", "Python"]
            )
            db.add(profile_a)
            db.commit()
            db.refresh(profile_a)

        # Student Beta (Different org)
        user_b = db.query(models.User).filter(models.User.email == "student.beta@college.edu").first()
        if not user_b:
            user_b = models.User(
                email="student.beta@college.edu",
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
                full_name="Bob Beta",
                email="student.beta@college.edu",
                target_role="Backend Engineer",
                current_skills=["Python", "FastAPI"]
            )
            db.add(profile_b)
            db.commit()
            db.refresh(profile_b)

        token_a = utils.create_access_token({"sub": "student.alpha@college.edu", "role": "STUDENT"})
        token_b = utils.create_access_token({"sub": "student.beta@college.edu", "role": "STUDENT"})

        return {
            "token_a": token_a,
            "profile_a_id": profile_a.id,
            "org_a_id": org_a.id,
            "token_b": token_b,
            "profile_b_id": profile_b.id,
            "org_b_id": org_b.id
        }
    finally:
        db.close()


def test_start_mock_interview(setup_phase5_data):
    """Verifies starting a mock interview session generates turn 1."""
    data = setup_phase5_data
    response = client.post(
        "/api/student/mock-interview/start",
        json={
            "interview_type": "TECHNICAL",
            "target_role": "Full Stack Developer"
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert response.status_code == 200, response.text
    res_data = response.json()
    assert res_data["id"] is not None
    assert res_data["interview_type"] == "TECHNICAL"
    assert res_data["target_role"] == "Full Stack Developer"
    assert res_data["status"] == "IN_PROGRESS"
    assert len(res_data["turns"]) == 1
    first_turn = res_data["turns"][0]
    assert first_turn["turn_number"] == 1
    assert len(first_turn["question_text"]) > 10


def test_submit_mock_interview_turn(setup_phase5_data):
    """Submits answer to turn 1 and checks STAR evaluation + next question."""
    data = setup_phase5_data
    # Start session
    start_res = client.post(
        "/api/student/mock-interview/start",
        json={"interview_type": "HR", "target_role": "Full Stack Developer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert start_res.status_code == 200
    interview_id = start_res.json()["id"]

    # Submit answer
    turn_res = client.post(
        f"/api/student/mock-interview/{interview_id}/turn",
        json={
            "student_response": (
                "In my final semester project, our team had conflicting views on database schemas. "
                "I analyzed query patterns, designed a prototype with MongoDB and PostgreSQL benchmarks, "
                "and demonstrated our access latency dropped by 40%. The team agreed, and we successfully delivered on time."
            )
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert turn_res.status_code == 200, turn_res.text
    turn_data = turn_res.json()
    assert turn_data["turn_number"] == 1
    assert turn_data["score"] >= 70.0
    assert turn_data["star_score"] >= 70.0
    assert len(turn_data["feedback"]) > 10
    assert len(turn_data["strengths"]) > 0
    assert turn_data["next_question"] is not None
    assert not turn_data["is_finished"]


def test_complete_mock_interview(setup_phase5_data):
    """Verifies manual or automatic interview completion with scores."""
    data = setup_phase5_data
    start_res = client.post(
        "/api/student/mock-interview/start",
        json={"interview_type": "TECHNICAL", "target_role": "Backend Engineer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert start_res.status_code == 200
    interview_id = start_res.json()["id"]

    # Answer turn 1
    client.post(
        f"/api/student/mock-interview/{interview_id}/turn",
        json={
            "student_response": "I implemented Redis caching for hot user sessions, which reduced SQL load by 60% and improved latency."
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )

    # Complete interview
    comp_res = client.post(
        f"/api/student/mock-interview/{interview_id}/complete",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert comp_res.status_code == 200, comp_res.text
    comp_data = comp_res.json()
    assert comp_data["status"] == "COMPLETED"
    assert comp_data["overall_score"] > 0
    assert comp_data["star_structure_score"] > 0
    assert comp_data["technical_accuracy_score"] > 0
    assert comp_data["feedback_summary"] is not None
    assert comp_data["completed_at"] is not None


def test_get_mock_interview_history(setup_phase5_data):
    """Verifies retrieval of student's mock interview history."""
    data = setup_phase5_data
    hist_res = client.get(
        "/api/student/mock-interview/history",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert hist_res.status_code == 200, hist_res.text
    items = hist_res.json()
    assert isinstance(items, list)
    assert len(items) >= 1
    assert "overall_score" in items[0]
    assert "status" in items[0]


def test_mock_interview_idor_isolation(setup_phase5_data):
    """Verifies student B cannot access or modify student A's mock interview."""
    data = setup_phase5_data
    start_res = client.post(
        "/api/student/mock-interview/start",
        json={"interview_type": "TECHNICAL", "target_role": "Full Stack Developer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    interview_id = start_res.json()["id"]

    # Student B attempts GET
    get_res = client.get(
        f"/api/student/mock-interview/{interview_id}",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert get_res.status_code == 404

    # Student B attempts submit turn
    turn_res = client.post(
        f"/api/student/mock-interview/{interview_id}/turn",
        json={"student_response": "Malicious turn injection"},
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert turn_res.status_code == 404

    # Student B attempts complete
    comp_res = client.post(
        f"/api/student/mock-interview/{interview_id}/complete",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert comp_res.status_code == 404


def test_mock_interview_unauthenticated(setup_phase5_data):
    """Verifies that endpoints require authentication."""
    res1 = client.post("/api/student/mock-interview/start", json={"interview_type": "HR"})
    assert res1.status_code == 401

    res2 = client.get("/api/student/mock-interview/history")
    assert res2.status_code == 401
