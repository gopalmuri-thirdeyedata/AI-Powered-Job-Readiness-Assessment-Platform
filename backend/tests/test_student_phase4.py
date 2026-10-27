"""
Test Suite for Student Career Platform — Phase 4:
DSA, Aptitude & Topic-Wise Practice Environment
"""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase4_data():
    """Sets up student user and profile in the database."""
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "college-alpha").first()
        if not org:
            org = models.Organization(name="College Alpha", slug="college-alpha", status="active")
            db.add(org)
            db.commit()
            db.refresh(org)

        user = db.query(models.User).filter(models.User.email == "student.alpha@college.edu").first()
        if not user:
            user = models.User(
                email="student.alpha@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org.id,
                is_active=True,
                password_changed=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
        if not profile:
            profile = models.StudentProfile(
                user_id=user.id,
                organization_id=org.id,
                full_name="Alice Alpha",
                email="student.alpha@college.edu",
                target_role="Full Stack Developer",
                current_skills=["React", "Python"]
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)

        token = utils.create_access_token({"sub": "student.alpha@college.edu", "role": "STUDENT"})

        return {
            "token": token,
            "profile_id": profile.id,
            "org_id": org.id
        }
    finally:
        db.close()


def test_get_practice_topics(setup_phase4_data):
    """Validates GET /api/student/practice/topics returns available topics."""
    headers = {"Authorization": f"Bearer {setup_phase4_data['token']}"}
    response = client.get("/api/student/practice/topics", headers=headers)
    assert response.status_code == 200
    topics = response.json()
    assert len(topics) >= 4
    topic_names = [t["topic"] for t in topics]
    assert "Arrays" in topic_names
    assert "Quantitative" in topic_names


def test_get_practice_questions_confidentiality(setup_phase4_data):
    """
    CRITICAL SECURITY TEST:
    Validates GET /api/student/practice/questions never leaks:
    1. 'correct_answer'
    2. 'is_hidden: true' test cases (only public test cases visible)
    """
    headers = {"Authorization": f"Bearer {setup_phase4_data['token']}"}
    response = client.get("/api/student/practice/questions?topic=Arrays", headers=headers)
    assert response.status_code == 200
    questions = response.json()
    assert len(questions) > 0

    for q in questions:
        # 1. Answer key must NEVER be in client payload
        assert "correct_answer" not in q

        # 2. Test cases exposed must strictly be public
        assert "public_test_cases" in q
        for tc in q["public_test_cases"]:
            assert "is_hidden" not in tc


def test_submit_aptitude_practice_success_and_failure(setup_phase4_data):
    """Validates aptitude MCQ practice evaluation."""
    headers = {"Authorization": f"Bearer {setup_phase4_data['token']}"}
    q_res = client.get("/api/student/practice/questions?category=APTITUDE", headers=headers)
    assert q_res.status_code == 200
    apt_questions = q_res.json()
    assert len(apt_questions) > 0
    q = apt_questions[0]

    # Test wrong choice
    res_wrong = client.post(
        "/api/student/practice/submit",
        json={"question_id": q["id"], "selected_option": "Z"},
        headers=headers
    )
    assert res_wrong.status_code == 200
    assert res_wrong.json()["is_correct"] is False
    assert res_wrong.json()["tests_passed"] == 0

    # Test correct choice from database
    db = database.SessionLocal()
    try:
        db_q = db.query(models.StudentPracticeQuestion).filter(models.StudentPracticeQuestion.id == q["id"]).first()
        correct_opt = db_q.correct_answer
    finally:
        db.close()

    res_correct = client.post(
        "/api/student/practice/submit",
        json={"question_id": q["id"], "selected_option": correct_opt},
        headers=headers
    )
    assert res_correct.status_code == 200
    assert res_correct.json()["is_correct"] is True
    assert res_correct.json()["tests_passed"] == 1


@patch("services.judge0_service.execute_code")
def test_submit_coding_practice_evaluation(mock_execute_code, setup_phase4_data):
    """Validates server-side coding practice evaluation with Judge0 mock."""
    mock_execute_code.return_value = {
        "stdout": "true\n",
        "stderr": "",
        "status": {"id": 3, "description": "Accepted"}
    }

    headers = {"Authorization": f"Bearer {setup_phase4_data['token']}"}
    q_res = client.get("/api/student/practice/questions?topic=Arrays", headers=headers)
    assert q_res.status_code == 200
    q_id = q_res.json()[0]["id"]

    submit_res = client.post(
        "/api/student/practice/submit",
        json={
            "question_id": q_id,
            "code": "print('true')",
            "language": "python"
        },
        headers=headers
    )
    assert submit_res.status_code == 200
    data = submit_res.json()
    assert data["total_tests"] >= 2
    assert "feedback" in data


def test_unauthenticated_practice_denied():
    """Validates unauthenticated requests return 401."""
    res = client.get("/api/student/practice/topics")
    assert res.status_code == 401
