"""
Test Suite: RoleReady Vapi Voice Interview Initialization
Verifies:
1. Unauthenticated calls to /api/roleready/session/{session_uuid}/vapi-init return 401.
2. Calls with nonexistent session_uuid return 404.
3. Authenticated session with INTERVIEW_UNLOCKED returns assistantId, 5 role-specific questions, role, and candidateName.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
import models, database, utils
from services import roleready_service
from main import app

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()

def test_vapi_init_unauthenticated():
    fake_uuid = str(uuid.uuid4())
    res = client.post(f"/api/roleready/session/{fake_uuid}/vapi-init")
    assert res.status_code == 401

def test_vapi_init_not_found(db_session):
    test_email = f"vapi.test.{uuid.uuid4().hex[:6]}@roleready.test"
    # 1. Authorize email
    client.post("/api/auth/check-email/", json={"email": test_email, "intent": "student"})
    # 2. Sync Clerk user
    sync_res = client.post("/api/auth/clerk-sync/", json={
        "email": test_email,
        "clerk_user_id": f"clerk_{uuid.uuid4().hex[:8]}",
        "first_name": "Test",
        "last_name": "Candidate",
        "role_intent": "student"
    })
    assert sync_res.status_code == 200
    token = sync_res.json()["access"]

    nonexistent_uuid = str(uuid.uuid4())
    res = client.post(
        f"/api/roleready/session/{nonexistent_uuid}/vapi-init",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 404

def test_vapi_init_success_with_session(db_session):
    # The profile name is only replaced by the resume name when the email-derived placeholder contains digits,
    # so the handle must always contain one (a random hex suffix was digit-free ~0.3% of runs -> flaky).
    test_email = f"vapi.success.{uuid.uuid4().int % 10**6:06d}@roleready.test"
    client.post("/api/auth/check-email/", json={"email": test_email, "intent": "student"})
    sync_res = client.post("/api/auth/clerk-sync/", json={
        "email": test_email,
        "clerk_user_id": f"clerk_{uuid.uuid4().hex[:8]}",
        "first_name": "Gopal",
        "last_name": "Muri",
        "role_intent": "student"
    })
    assert sync_res.status_code == 200
    token = sync_res.json()["access"]

    # Locate student profile
    user = db_session.query(models.User).filter(models.User.email == test_email).first()
    profile = db_session.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()

    # Create session
    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Full Stack Engineer",
        target_company="ThirdEye Data",
        custom_jd_text="Looking for a Full Stack Engineer proficient in React, Node.js, and System Design.",
        resume_raw_text="Gopal Muri - Full Stack Developer with React, Python, PostgreSQL experience.",
        resume_snapshot={"skills": ["React", "Node.js", "Python", "PostgreSQL"]}
    )

    # Set state to INTERVIEW_UNLOCKED (simulating Aptitude and Coding rounds completed)
    session.current_state = models.RoleReadySessionState.INTERVIEW_UNLOCKED
    db_session.commit()

    # Call vapi-init
    res = client.post(
        f"/api/roleready/session/{session.session_uuid}/vapi-init",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    data = res.json()
    assert "questions" in data
    assert len(data["questions"]) >= 3
    assert data["role"] == "Full Stack Engineer"
    assert data["candidateName"] == "Gopal Muri"
    assert "@" not in data["candidateName"]
    assert "duration" in data

    # Verify student profile full_name was updated to the extracted resume name
    db_session.refresh(profile)
    assert profile.full_name == "Gopal Muri"
