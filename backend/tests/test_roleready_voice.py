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


def test_streaming_voice_turn_is_gated_like_the_plain_turn_and_streams_ndjson(db_session):
    import json as _json
    test_email = f"voice.stream.{uuid.uuid4().int % 10**6:06d}@roleready.test"
    org = lh.ensure_org(db_session)
    user = lh.ensure_user(db_session, test_email, models.UserRole.STUDENT, org=org, student_profile=True,
                          full_name=test_email.split("@")[0].replace(".", " ").title())
    token = utils.create_access_token(data={"sub": user.email, "role": models.UserRole.STUDENT})
    profile = db_session.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
    session = roleready_service.create_student_session(
        db=db_session, student_profile=profile, target_role="Full Stack Engineer", target_company="ThirdEye Data",
        custom_jd_text="Looking for a Full Stack Engineer proficient in React and Python.",
        resume_raw_text="Gopal Muri - Full Stack Developer.", resume_snapshot={"skills": ["React", "Python"]})
    h = {"Authorization": f"Bearer {token}"}
    url = f"/api/roleready/session/{session.session_uuid}/voice-turn-stream"
    # not unlocked / not initialised: an ordinary HTTP refusal before any byte is streamed
    assert client.post(url, data={"opening": "true"}, headers=h).status_code in (400, 403, 409)
    assert client.post(url, data={"opening": "true"}).status_code == 401

    session.current_state = models.RoleReadySessionState.INTERVIEW_UNLOCKED
    db_session.commit()
    assert client.post(f"/api/roleready/session/{session.session_uuid}/voice-init", headers=h).status_code == 200

    opening = client.post(url, data={"opening": "true"}, headers=h)
    assert opening.status_code == 200 and opening.headers["content-type"].startswith("application/x-ndjson")
    assert opening.headers["content-encoding"] == "identity" and opening.headers["cache-control"] == "no-store"
    events = [_json.loads(line) for line in opening.text.splitlines()]
    assert [e["type"] for e in events] == ["transcript", "audio", "done"] and events[1]["audio_base64"]

    turn = client.post(url, data={"history": "[]", "opening": "false"}, files={"audio": ("answer.webm", b"RIFFfake", "audio/webm")}, headers=h)
    events = [_json.loads(line) for line in turn.text.splitlines()]
    assert events[0]["type"] == "transcript" and events[0]["user_text"] and events[-1]["type"] == "done" and events[-1]["reply_text"]
    assert any(e["type"] == "audio" for e in events) and "system_prompt" not in turn.text

    bad = client.post(url, data={"history": "{not json", "opening": "false"}, headers=h)
    assert bad.status_code == 400


def test_live_caption_token_is_gated_like_a_spoken_turn_and_never_exposes_the_api_key(db_session, elevenlabs_http):
    from urllib.parse import parse_qs, urlparse
    test_email = f"voice.caption.{uuid.uuid4().int % 10**6:06d}@roleready.test"
    org = lh.ensure_org(db_session)
    user = lh.ensure_user(db_session, test_email, models.UserRole.STUDENT, org=org, student_profile=True,
                          full_name=test_email.split("@")[0].replace(".", " ").title())
    token = utils.create_access_token(data={"sub": user.email, "role": models.UserRole.STUDENT})
    profile = db_session.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
    session = roleready_service.create_student_session(
        db=db_session, student_profile=profile, target_role="Full Stack Engineer", target_company="ThirdEye Data",
        custom_jd_text="Looking for a Full Stack Engineer proficient in React and Python.",
        resume_raw_text="Gopal Muri - Full Stack Developer.", resume_snapshot={"skills": ["React", "Python"]})
    h = {"Authorization": f"Bearer {token}"}
    url = f"/api/roleready/session/{session.session_uuid}/voice-caption-token"

    assert client.post(url).status_code == 401                                          # no credential
    assert client.post(url, headers=h).status_code in (400, 403, 409)                   # the interview is not open yet
    assert not [c for c in elevenlabs_http.calls if "single-use-token" in c["url"]]     # and nothing was asked of the provider

    session.current_state = models.RoleReadySessionState.INTERVIEW_IN_PROGRESS
    db_session.commit()
    res = client.post(url, headers=h)
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    body = res.json()
    parsed = urlparse(body["url"])
    query = parse_qs(parsed.query)
    assert parsed.scheme == "wss" and parsed.netloc == "api.elevenlabs.io" and parsed.path == "/v1/speech-to-text/realtime"
    assert query["token"] == ["sutkn_test_token"] and query["audio_format"] == ["pcm_16000"] and query["commit_strategy"] == ["vad"]
    assert body["sample_rate"] == 16000 and body["expires_in_seconds"] == 900
    assert "test-api-key-not-real" not in res.text                                       # only the single-use token leaves the server
    call = [c for c in elevenlabs_http.calls if "single-use-token" in c["url"]][-1]
    assert call["headers"]["xi-api-key"] == "test-api-key-not-real"

    for _ in range(12):                                                                   # one token per connection: hammering it is limited
        last = client.post(url, headers=h)
    assert last.status_code == 429
    roleready_service.caption_token_limiter.reset()


def test_a_provider_failure_gives_a_safe_message_not_the_upstream_body(db_session, elevenlabs_http):
    from services import elevenlabs_service as el
    elevenlabs_http.fail_with = 401
    with pytest.raises(el.VoiceServiceError) as caught:
        el.realtime_caption_session()
    assert "401" not in caught.value.public_message and "upstream" not in caught.value.public_message


def test_the_greeting_never_names_a_placeholder_company_when_none_was_entered():
    from services import elevenlabs_service as el
    without = el.build_voice_session("Gopal", "Full Stack Engineer", questions=[{"question": "A?"}])
    assert "Full Stack Engineer position" in without["first_message"] and "Target Company" not in without["first_message"] + without["system_prompt"]
    import inspect
    from services import roleready_service
    assert 'or "Target Company"' not in inspect.getsource(roleready_service.init_voice_interview_session)      # the init builds "<role> at <company>" only for a real company
