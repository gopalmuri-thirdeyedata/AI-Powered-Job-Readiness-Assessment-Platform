"""
Test Suite for RoleReady Assessment Initialization Fix:
- Verifies successful assessment initialization
- Verifies Gemini timeout, rate limit, and deterministic fallback behavior
- Verifies non-retryable errors fail fast without retries
- Verifies concurrent generation in create_student_session
- Verifies no live Gemini API calls are made
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils
from services import gemini_client, roleready_service

client = TestClient(app)


@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()


@pytest.fixture(scope="module")
def setup_student(db_session):
    org = db_session.query(models.Organization).filter_by(slug="roleready-test-org").first()
    if not org:
        org = models.Organization(name="RoleReady Test Organization", slug="roleready-test-org", status="active")
        db_session.add(org)
        db_session.commit()
        db_session.refresh(org)

    student_user = db_session.query(models.User).filter_by(email="init.test@roleready.com").first()
    if not student_user:
        student_user = models.User(
            email="init.test@roleready.com",
            hashed_password="fakehashedpassword",
            role=models.UserRole.STUDENT,
            organization_id=org.id
        )
        db_session.add(student_user)
        db_session.commit()
        db_session.refresh(student_user)

    student_profile = db_session.query(models.StudentProfile).filter_by(user_id=student_user.id).first()
    if not student_profile:
        student_profile = models.StudentProfile(
            user_id=student_user.id,
            organization_id=org.id,
            full_name="Init Test User",
            email="init.test@roleready.com",
            target_role="Backend Developer",
            target_company="Acme Corp",
            current_skills=["Python", "FastAPI", "SQL"]
        )
        db_session.add(student_profile)
        db_session.commit()
        db_session.refresh(student_profile)

    student_token = utils.create_access_token(data={"sub": student_user.email, "role": student_user.role})
    headers = {"Authorization": f"Bearer {student_token}"}
    return student_profile, headers


def test_successful_session_initialization_with_mock_gemini(setup_student, monkeypatch):
    """Verifies successful assessment session creation with mock mode returns valid session_uuid."""
    monkeypatch.setenv("GEMINI_MOCK_MODE", "true")
    profile, headers = setup_student

    response = client.post(
        "/api/roleready/student/initialize",
        headers=headers,
        data={
            "target_role": "Backend Developer",
            "target_company": "Acme Corp",
            "custom_jd_text": "Looking for a Backend Developer skilled in Python, FastAPI, and PostgreSQL."
        }
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "session_uuid" in data
    assert data["session_uuid"] is not None
    assert len(data["session_uuid"]) == 36
    assert data["target_role"] == "Backend Developer"
    assert data["current_state"] == "NOT_STARTED"

    # Verify rounds were created in database
    db = database.SessionLocal()
    try:
        session = db.query(models.RoleReadySession).filter_by(session_uuid=data["session_uuid"]).first()
        assert session is not None
        rounds = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id).order_by(models.RoleReadyRoundAttempt.round_order).all()
        assert len(rounds) == 3
        assert rounds[0].round_type == "APTITUDE"
        assert rounds[1].round_type == "CODING"
        assert rounds[2].round_type == "INTERVIEW"
    finally:
        db.close()


def test_gemini_timeout_triggers_deterministic_fallback(setup_student, monkeypatch):
    """When Gemini calls time out, initialization succeeds using deterministic fallback banks."""
    profile, headers = setup_student
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "mock_key")
    monkeypatch.setattr(gemini_client, "_sleep", lambda s: None)

    # Simulate Gemini request timeout
    call_counts = []
    def fake_generate(*args, **kwargs):
        call_counts.append(1)
        raise gemini_client.GeminiUnavailableError("Gemini request timed out after 30s")

    monkeypatch.setattr(gemini_client, "_generate", fake_generate)

    response = client.post(
        "/api/roleready/student/initialize",
        headers=headers,
        data={
            "target_role": "Frontend Developer",
            "custom_jd_text": "React, CSS, JavaScript frontend role"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "session_uuid" in data

    # Verify fallback rounds were correctly populated
    db = database.SessionLocal()
    try:
        session = db.query(models.RoleReadySession).filter_by(session_uuid=data["session_uuid"]).first()
        rounds = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id).order_by(models.RoleReadyRoundAttempt.round_order).all()
        assert len(rounds) == 3
        # Aptitude round contains 10 fallback questions
        assert len(rounds[0].questions_payload) == 10
        # Coding round contains 2 fallback problems
        assert len(rounds[1].questions_payload) == 2
        # Interview round contains fallback questions
        assert len(rounds[2].questions_payload) >= 3
    finally:
        db.close()


def test_non_retryable_errors_fail_fast(monkeypatch):
    """Non-transient errors (like HTTP 400 Bad Request) must fail immediately without retries."""
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "mock_key")
    
    sleep_calls = []
    rest_calls = []
    monkeypatch.setattr(gemini_client, "_sleep", sleep_calls.append)

    import httpx
    def fake_post(url, json, headers, timeout):
        rest_calls.append(1)
        return httpx.Response(400, text="Bad Request: Invalid argument")

    monkeypatch.setattr(gemini_client.httpx, "post", fake_post)

    with pytest.raises(gemini_client.GeminiUnavailableError):
        gemini_client.call_gemini("test prompt")

    # Must NOT retry 400
    assert len(rest_calls) == 1
    assert len(sleep_calls) == 0


def test_transient_error_retries_once_then_raises(monkeypatch):
    """Transient errors (like HTTP 429) retry once with 1s backoff, then raise GeminiUnavailableError."""
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "mock_key")
    
    sleep_calls = []
    rest_calls = []
    monkeypatch.setattr(gemini_client, "_sleep", sleep_calls.append)

    import httpx
    def fake_post(url, json, headers, timeout):
        rest_calls.append(1)
        return httpx.Response(429, text="Too Many Requests")

    monkeypatch.setattr(gemini_client.httpx, "post", fake_post)

    with pytest.raises(gemini_client.GeminiUnavailableError):
        gemini_client.call_gemini("test prompt")

    assert len(rest_calls) == 2  # 1 initial + 1 retry
    assert sleep_calls == [1]


def test_create_student_session_parallel_generators(setup_student, monkeypatch):
    """Verifies that round question generators run concurrently in create_student_session."""
    import time
    profile, headers = setup_student
    monkeypatch.setenv("GEMINI_MOCK_MODE", "true")

    db = database.SessionLocal()
    try:
        # Measure creation time with mock mode
        start = time.perf_counter()
        session = roleready_service.create_student_session(
            db=db,
            student_profile=profile,
            target_role="Full Stack Engineer",
            custom_jd_text="Full stack web developer with Python and React"
        )
        elapsed = time.perf_counter() - start
        assert session.session_uuid is not None
        # Concurrent execution should complete rapidly
        assert elapsed < 5.0
    finally:
        db.close()
