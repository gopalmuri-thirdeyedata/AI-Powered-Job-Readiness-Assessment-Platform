"""
KNOWN, UNFIXED security gaps, recorded as strict expected failures so they stay visible in every test run and the suite
turns red the moment one is fixed (remove the marker then). They are NOT passing tests: they document defects.

Reproduction was verified on a scratch database. These are outside the scope of the assessment-unification work and touch the
authentication design (Clerk), so they need an explicit decision before anyone changes them.
"""
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


@pytest.mark.xfail(strict=True, reason="CRITICAL: POST /api/auth/clerk-sync/ issues a JWT for any e-mail with no proof of identity (no Clerk token is verified)")
def test_clerk_sync_does_not_issue_a_token_without_a_verified_clerk_session():
    r = client.post("/api/auth/clerk-sync/", json={"email": "someone.else@example.com", "clerk_user_id": "x", "role_intent": "student"})
    assert r.status_code in (401, 403), f"an anonymous caller received {r.status_code} and a token"


@pytest.mark.xfail(strict=True, reason="CRITICAL: the platform-admin e-mail address is hard-coded in clerk-sync, so an anonymous caller receives a PLATFORM_ADMIN token")
def test_anonymous_caller_cannot_obtain_a_platform_admin_token():
    r = client.post("/api/auth/clerk-sync/", json={"email": "admin@thirdeyedata.ai", "clerk_user_id": "anything", "role_intent": "admin"})
    assert r.status_code in (401, 403), "an anonymous caller was handed a platform-admin token"
