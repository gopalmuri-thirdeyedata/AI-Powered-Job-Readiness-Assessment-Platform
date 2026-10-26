"""
Regression tests for two formerly CRITICAL, now CLOSED security gaps.

Until the local-authentication migration, POST /api/auth/clerk-sync/ issued a JWT for any e-mail address without verifying any
identity (including a platform-admin token for the hard-coded admin e-mail). These were recorded as strict expected failures; the
endpoint has been removed, so they are now ordinary passing tests that keep the hole closed.
"""
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

TOKEN_EXCHANGE_PATHS = ["/api/auth/clerk-sync/", "/api/auth/clerk-sync", "/api/auth/token-exchange/", "/api/auth/oauth-sync/"]


@pytest.mark.parametrize("path", TOKEN_EXCHANGE_PATHS)
def test_no_endpoint_issues_a_token_for_an_unverified_email(path):
    r = client.post(path, json={"email": "someone.else@example.com", "clerk_user_id": "x", "role_intent": "student"})
    assert r.status_code in (404, 405), f"{path} answered {r.status_code}"
    assert "access" not in r.text and "prepwin_session" not in r.cookies


@pytest.mark.parametrize("path", TOKEN_EXCHANGE_PATHS)
def test_anonymous_caller_cannot_obtain_a_platform_admin_session(path):
    r = client.post(path, json={"email": "admin@thirdeyedata.ai", "clerk_user_id": "anything", "role_intent": "admin"})
    assert r.status_code in (404, 405), "an anonymous caller must not be handed any session for the platform-admin e-mail"
    assert "access" not in r.text and "prepwin_session" not in r.cookies
    # ...and the only door left, the password login, does not accept a missing/invented credential
    login = client.post("/api/auth/login/", json={"email": "admin@thirdeyedata.ai", "password": "anything"})
    assert login.status_code in (401, 429)
