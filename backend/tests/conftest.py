"""
Pytest configuration for backend automated test suite.
Ensures ordinary test runs operate offline using deterministic mocks
to prevent live Gemini API calls, quota consumption, and HTTP 429 rate limits.
"""
import os
import sys
import pytest

# Database safety FIRST, before anything imports `database`/`main`: the tests must never write to the configured (dev/prod)
# database. See tests/db_guard.py. Opt in deliberately with PREPWIN_TESTS_USE_CONFIGURED_DB=1.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db_guard  # noqa: E402

_FORCED_DB, _DB_REASON = db_guard.apply_guard(os.environ, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


def pytest_report_header(config):
    return f"prepwin test database: {os.environ.get('DATABASE_URL', '(configured)')}  [{_DB_REASON}]"


def pytest_sessionstart(session):
    """If `database` was imported before this guard could run (e.g. by a plugin), refuse to continue against the configured DB."""
    if _FORCED_DB and "database" in sys.modules:
        import database
        if database.SQLALCHEMY_DATABASE_URL != _FORCED_DB:
            raise pytest.UsageError("`database` was imported before the test-database guard ran and points at the configured database; "
                                    "set DATABASE_URL to a throw-away database or PREPWIN_TESTS_USE_CONFIGURED_DB=1 to proceed deliberately.")


# Default to offline mock mode for all automated test runs unless explicitly opted into live tests
if os.getenv("GEMINI_LIVE_TESTS", "").lower() not in ("true", "1", "yes"):
    os.environ["GEMINI_MOCK_MODE"] = "true"


class _VapiHttpStub:
    """
    Stands in for `requests` inside services.vapi_service so no test ever creates (or deletes) a real, billable Vapi assistant
    on the account behind VAPI_PRIVATE_KEY. Calls are recorded in `.calls`. Opt back in to the real API with VAPI_LIVE_TESTS=true.
    """

    class _Response:
        def __init__(self, status, body):
            self.status_code, self._body, self.text = status, body, str(body)

        def json(self):
            return self._body

    def __init__(self):
        self.calls = []
        self._n = 0

    def post(self, url, json=None, headers=None, timeout=None):
        self._n += 1
        self.calls.append({"method": "POST", "url": url, "json": json, "headers": headers, "timeout": timeout})
        return self._Response(201, {"id": f"00000000-0000-4000-8000-{self._n:012d}"})

    def delete(self, url, headers=None, timeout=None):
        self.calls.append({"method": "DELETE", "url": url, "headers": headers, "timeout": timeout})
        return self._Response(200, {})


@pytest.fixture(autouse=True)
def vapi_http(monkeypatch):
    from services import vapi_service
    if os.getenv("VAPI_LIVE_TESTS", "").lower() in ("true", "1", "yes"):
        yield None
        return
    stub = _VapiHttpStub()
    monkeypatch.setattr(vapi_service, "requests", stub)
    monkeypatch.setattr(vapi_service, "_spawn", lambda fn, *args: fn(*args))     # cleanup runs inline so tests can assert on it
    monkeypatch.setenv("VAPI_PRIVATE_KEY", "test-private-key-not-real")
    yield stub


@pytest.fixture(autouse=True)
def _no_real_smtp(monkeypatch):
    """
    backend/.env carries real SMTP credentials and load_dotenv() puts them in the test process, so any test that reaches the
    invitation endpoints unmocked would send real e-mail. Every SMTP connection attempt fails loudly instead; tests that
    exercise sending install their own fake (tests/test_assessment_invitations.py).
    """
    import smtplib

    def refuse(*args, **kwargs):
        raise AssertionError("a test tried to open a real SMTP connection; install a fake SMTP server instead")

    monkeypatch.setattr(smtplib, "SMTP", refuse)
    monkeypatch.setattr(smtplib, "SMTP_SSL", refuse)


@pytest.fixture(autouse=True)
def _reset_sandbox_circuit():
    """The execution-service circuit breaker is process-wide state: every test starts with it closed."""
    from services import piston_service
    piston_service.reset_circuit()
    yield
    piston_service.reset_circuit()


@pytest.fixture(autouse=True)
def _score_interview_inline(monkeypatch):
    """Existing tests assert on the submit response, so score the interview inline by default.
    The background path has its own tests (test_roleready_background_eval.py)."""
    from services import roleready_service
    monkeypatch.setattr(roleready_service, "BACKGROUND_INTERVIEW_EVALUATION", False)
