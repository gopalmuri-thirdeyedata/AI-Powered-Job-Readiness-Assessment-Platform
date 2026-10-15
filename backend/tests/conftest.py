"""
Pytest configuration for backend automated test suite.
Ensures ordinary test runs operate offline using deterministic mocks
to prevent live Gemini API calls, quota consumption, and HTTP 429 rate limits.
"""
import os
import pytest

# Default to offline mock mode for all automated test runs unless explicitly opted into live tests
if os.getenv("GEMINI_LIVE_TESTS", "").lower() not in ("true", "1", "yes"):
    os.environ["GEMINI_MOCK_MODE"] = "true"


@pytest.fixture(autouse=True)
def _score_interview_inline(monkeypatch):
    """Existing tests assert on the submit response, so score the interview inline by default.
    The background path has its own tests (test_roleready_background_eval.py)."""
    from services import roleready_service
    monkeypatch.setattr(roleready_service, "BACKGROUND_INTERVIEW_EVALUATION", False)
