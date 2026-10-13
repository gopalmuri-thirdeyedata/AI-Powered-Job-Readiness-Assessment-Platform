"""
Test Suite for Student Career Platform — Phase 8:
Student Career Dashboard & Career Copilot
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase8_data():
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


def test_copilot_chat_grounded(setup_phase8_data):
    """Verifies sending message to copilot returns grounded response."""
    data = setup_phase8_data
    chat_res = client.post(
        "/api/student/copilot/chat",
        json={"content": "What skills should I learn to improve my readiness for Full Stack Developer?"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert chat_res.status_code == 200, chat_res.text
    msg = chat_res.json()
    assert msg["id"] is not None
    assert msg["role"] == "ASSISTANT"
    assert msg["intent"] == "SKILL_GAP"
    assert len(msg["content"]) > 30


def test_copilot_history_and_suggestions(setup_phase8_data):
    """Verifies getting chat history and contextual suggestions."""
    data = setup_phase8_data
    # Send another message
    client.post(
        "/api/student/copilot/chat",
        json={"content": "How do I structure a STAR response in my interviews?"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )

    hist_res = client.get(
        "/api/student/copilot/history",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert hist_res.status_code == 200, hist_res.text
    history = hist_res.json()
    assert len(history["messages"]) >= 2
    assert len(history["suggestions"]) >= 2


def test_clear_copilot_history(setup_phase8_data):
    """Verifies clearing copilot conversation history."""
    data = setup_phase8_data
    del_res = client.delete(
        "/api/student/copilot/history",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert del_res.status_code == 200, del_res.text
    assert del_res.json()["deleted_count"] >= 0

    # Ensure empty history
    hist_res = client.get(
        "/api/student/copilot/history",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert hist_res.status_code == 200
    assert len(hist_res.json()["messages"]) == 0


def test_unified_dashboard_metrics(setup_phase8_data):
    """Verifies GET /dashboard/unified returns complete preparatory metrics."""
    data = setup_phase8_data
    dash_res = client.get(
        "/api/student/dashboard/unified",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert dash_res.status_code == 200, dash_res.text
    d = dash_res.json()
    assert d["student_name"] == "Alice Alpha"
    assert d["target_role"] == "Full Stack Developer"
    assert "readiness_score" in d
    assert "resume" in d
    assert "roadmap" in d
    assert "practice" in d
    assert "mock_interviews" in d
    assert "projects" in d
    assert "placement_simulation" in d
    assert len(d["copilot_suggestions"]) > 0


def test_copilot_idor_and_isolation(setup_phase8_data):
    """Verifies student B cannot access or affect student A's copilot messages."""
    data = setup_phase8_data
    # Student A sends a private message
    client.post(
        "/api/student/copilot/chat",
        json={"content": "Private confidential student query."},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )

    # Student B reads history
    hist_b = client.get(
        "/api/student/copilot/history",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert hist_b.status_code == 200
    messages_b = hist_b.json()["messages"]
    # None of student A's messages should appear in student B's history
    assert not any("Private confidential" in m["content"] for m in messages_b)


def test_copilot_unauthenticated_guard():
    """Verifies that endpoints require authentication."""
    res1 = client.post("/api/student/copilot/chat", json={"content": "Hello"})
    assert res1.status_code == 401

    res2 = client.get("/api/student/copilot/history")
    assert res2.status_code == 401
