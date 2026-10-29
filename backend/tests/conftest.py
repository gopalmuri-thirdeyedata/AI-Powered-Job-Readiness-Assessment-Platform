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


class _ElevenLabsHttpStub:
    """
    Stands in for `requests.post` inside services.elevenlabs_service so no test ever calls (or bills) the real ElevenLabs account.
    Calls are recorded in `.calls`; `.transcript` is what speech-to-text "hears". Opt back in with ELEVENLABS_LIVE_TESTS=true.
    """

    class _Response:
        def __init__(self, status, body=None, content=b""):
            self.status_code, self._body, self.content, self.text = status, body, content, str(body)

        def json(self):
            return self._body

    def __init__(self):
        self.calls = []
        self.transcript = "I led a team that built a payments service in Python."
        self.fail_with = None

    def post(self, url, params=None, headers=None, json=None, data=None, files=None, timeout=None):
        self.calls.append({"url": url, "params": params, "headers": headers, "json": json, "data": data, "files": files, "timeout": timeout})
        if self.fail_with:
            return self._Response(self.fail_with, {"detail": "upstream failure"})
        if url.endswith("/speech-to-text"):
            return self._Response(200, {"text": self.transcript})
        if url.endswith("/single-use-token/realtime_scribe"):
            return self._Response(200, {"token": "sutkn_test_token"})
        return self._Response(200, content=b"ID3-fake-mp3-bytes")


@pytest.fixture(autouse=True)
def elevenlabs_http(monkeypatch):
    from services import elevenlabs_service
    if os.getenv("ELEVENLABS_LIVE_TESTS", "").lower() in ("true", "1", "yes"):
        yield None
        return
    import requests
    from types import SimpleNamespace
    stub = _ElevenLabsHttpStub()
    # Replace the module's own `requests` name, never requests.post itself (that would break every other HTTP caller, e.g. Judge0)
    monkeypatch.setattr(elevenlabs_service, "requests", SimpleNamespace(
        post=stub.post, RequestException=requests.RequestException, Session=lambda: SimpleNamespace(post=stub.post)))
    monkeypatch.setattr(elevenlabs_service, "_session", None)           # the shared connection must be rebuilt on the stub
    elevenlabs_service._audio_cache.clear()                              # a cached line would skip the (recorded) provider call
    monkeypatch.setenv("ELEVENLABS_PREWARM", "false")                    # no background thread racing the recorded calls
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-api-key-not-real")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "test-voice-id")
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
    from services import judge0_service
    judge0_service.reset_circuit()
    yield
    judge0_service.reset_circuit()


@pytest.fixture(autouse=True)
def _score_interview_inline(monkeypatch):
    """Existing tests assert on the submit response, so score the interview inline by default.
    The background path has its own tests (test_roleready_background_eval.py)."""
    from services import roleready_service
    monkeypatch.setattr(roleready_service, "BACKGROUND_INTERVIEW_EVALUATION", False)


@pytest.fixture(autouse=True)
def _blueprint_reference_runs_locally(monkeypatch):
    """Generated coding problems are verified by running Gemini's reference solution. In tests that happens in a local Python subprocess,
    never in the real code sandbox (and never over the network)."""
    from services import coding_problem_factory, jd_blueprint_service
    monkeypatch.setattr(jd_blueprint_service, "_run_batch", coding_problem_factory.local_run_batch)
    yield
