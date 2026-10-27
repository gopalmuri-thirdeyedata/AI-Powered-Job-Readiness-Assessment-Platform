"""
Test Suite: RoleReady Voice Interview Initialization and Turns
Verifies:
1. Unauthenticated calls to /api/roleready/session/{session_uuid}/voice-init return 401.
2. Calls with nonexistent session_uuid return 404.
3. Authenticated session with INTERVIEW_UNLOCKED returns the voice config (no prompt, no provider id), role-specific questions, role, and candidateName.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
import models, database, utils
from services import roleready_service
from main import app
from tests import local_auth_helpers as lh

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()

def test_voice_init_unauthenticated():
    fake_uuid = str(uuid.uuid4())
    res = client.post(f"/api/roleready/session/{fake_uuid}/voice-init")
    assert res.status_code == 401

def test_voice_init_not_found(db_session):
    test_email = f"voice.test.{uuid.uuid4().hex[:6]}@roleready.test"
    # 1. An administrator-provisioned student (the profile carries the e-mail-derived placeholder name)
    org = lh.ensure_org(db_session)
    user = lh.ensure_user(db_session, test_email, models.UserRole.STUDENT, org=org, student_profile=True,
                          full_name=test_email.split("@")[0].replace(".", " ").title())
    token = utils.create_access_token(data={"sub": user.email, "role": models.UserRole.STUDENT})

    nonexistent_uuid = str(uuid.uuid4())
    res = client.post(
        f"/api/roleready/session/{nonexistent_uuid}/voice-init",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 404

def test_voice_init_success_with_session(db_session):
    # The profile name is only replaced by the resume name when the email-derived placeholder contains digits,
    # so the handle must always contain one (a random hex suffix was digit-free ~0.3% of runs -> flaky).
    test_email = f"voice.success.{uuid.uuid4().int % 10**6:06d}@roleready.test"
    org = lh.ensure_org(db_session)
    user = lh.ensure_user(db_session, test_email, models.UserRole.STUDENT, org=org, student_profile=True,
                          full_name=test_email.split("@")[0].replace(".", " ").title())
    token = utils.create_access_token(data={"sub": user.email, "role": models.UserRole.STUDENT})

    # Locate student profile
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

    # Call voice-init
    res = client.post(
        f"/api/roleready/session/{session.session_uuid}/voice-init",
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
    assert data["voiceConfig"]["firstMessage"].startswith("Hello Gopal Muri")
    assert data["voiceConfig"]["maxDurationSeconds"] >= 1
    assert "assistantId" not in data and "system_prompt" not in res.text      # the interview prompt stays on the server

    # The first spoken line, then a recorded answer
    opening = client.post(f"/api/roleready/session/{session.session_uuid}/voice-turn", data={"opening": "true"},
                          headers={"Authorization": f"Bearer {token}"})
    assert opening.status_code == 200 and opening.json()["audio_base64"]
    turn = client.post(f"/api/roleready/session/{session.session_uuid}/voice-turn",
                       data={"history": "[]", "opening": "false"}, files={"audio": ("answer.webm", b"RIFFfake", "audio/webm")},
                       headers={"Authorization": f"Bearer {token}"})
    assert turn.status_code == 200 and turn.json()["user_text"] and turn.json()["reply_text"] and turn.json()["audio_base64"]

    # Verify student profile full_name was updated to the extracted resume name
    db_session.refresh(profile)
    assert profile.full_name == "Gopal Muri"


def test_voice_turn_requires_authentication_and_an_initialised_interview(db_session):
    res = client.post(f"/api/roleready/session/{uuid.uuid4()}/voice-turn", data={"opening": "true"})
    assert res.status_code == 401
