"""
Gemini failure handling for blueprint generation.

Reproduces what a real outage looks like at the HTTP layer (the actual Gemini REST answers, including the HTTP 402
"prepayment credits are depleted" body that triggered the original report) and checks that:
  * each failure is classified (config / auth / quota / rate limit / model / invalid request / timeout / network / outage / output),
  * permanent failures are not retried, transient ones are retried once,
  * the administrator gets a specific message and a machine-readable code,
  * the provider's raw text and any key material stay out of API responses and logs,
  * an existing blueprint is never touched and nothing is published.
"""
import json
import logging

import httpx
import pytest

from services import gemini_client, gemini_mock_fixtures, jd_blueprint_service
from tests import recruitment_helpers as h

client = h.client
FAKE_KEY = "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE0123456789"

# The real body Gemini returned for the configured key (HTTP 402).
REAL_402 = {"error": {"code": 402, "status": "RESOURCE_EXHAUSTED",
                      "message": "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. "
                                 "Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay."}}


def err_body(code, status, message):
    return {"error": {"code": code, "status": status, "message": message}}


@pytest.fixture(autouse=True)
def live_client(monkeypatch):
    """Exercise the real REST adapter (conftest normally forces mock mode) with a fake key and no sleeping."""
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", FAKE_KEY)
    monkeypatch.delenv("GEMINI_USE_SDK", raising=False)
    monkeypatch.setattr(gemini_client, "_sleep", lambda s: None)
    monkeypatch.setattr(jd_blueprint_service, "_sleep", lambda s: None)


def fake_gemini(monkeypatch, responder):
    """Replace the network call. `responder(n, timeout)` returns an httpx.Response or raises an httpx exception."""
    calls = {"n": 0, "timeouts": []}

    def post(url, json, headers, timeout):
        calls["n"] += 1
        calls["timeouts"].append(timeout)
        assert headers["x-goog-api-key"] == FAKE_KEY
        return responder(calls["n"], timeout)

    monkeypatch.setattr(gemini_client, "_http_post", post)
    return calls


def status_response(code, body):
    return lambda n, t: httpx.Response(code, json=body)


def good_response(n=1, t=None):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(gemini_mock_fixtures.sample_blueprint())}]}}]})


# ------------------------------------------------------------------ client: classification and retry policy
@pytest.mark.parametrize("code,body,kind,calls_expected", [
    (402, REAL_402, "quota", 1),                                                                           # the reported failure: never retried
    (429, err_body(429, "RESOURCE_EXHAUSTED", "Quota exceeded for metric ... per day"), "quota", 1),
    (429, err_body(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details."), "rate_limit", 2),
    (400, err_body(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."), "auth", 1),
    (401, err_body(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."), "auth", 1),
    (403, err_body(403, "PERMISSION_DENIED", "The caller does not have permission"), "auth", 1),
    (404, err_body(404, "NOT_FOUND", "models/gemini-9-ultra is not found for API version v1beta, or is not supported for generateContent."), "model", 1),
    (400, err_body(400, "INVALID_ARGUMENT", "Request contains an invalid argument."), "invalid_request", 1),
    (500, err_body(500, "INTERNAL", "Internal error encountered."), "service", 2),
    (503, err_body(503, "UNAVAILABLE", "The model is overloaded. Please try again later."), "service", 2),
])
def test_http_failures_are_classified_and_retried_only_when_retrying_can_help(monkeypatch, code, body, kind, calls_expected):
    calls = fake_gemini(monkeypatch, status_response(code, body))
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.kind == kind
    assert exc.value.http_status == code
    assert calls["n"] == calls_expected


def test_the_real_402_keeps_provider_status_in_the_server_side_error(monkeypatch):
    fake_gemini(monkeypatch, status_response(402, REAL_402))
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.provider_status == "RESOURCE_EXHAUSTED"
    assert "HTTP 402" in str(exc.value) and "prepayment credits are depleted" in str(exc.value)
    assert exc.value.retryable is False


def test_timeout_and_network_errors_are_classified_and_retried_once(monkeypatch):
    def timeout(n, t):
        raise httpx.ReadTimeout("read timed out")

    calls = fake_gemini(monkeypatch, timeout)
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.kind == "timeout" and calls["n"] == 2

    def network(n, t):
        raise httpx.ConnectError("connection refused")

    calls = fake_gemini(monkeypatch, network)
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.kind == "network" and calls["n"] == 2


def test_transient_failure_then_success_recovers(monkeypatch):
    calls = fake_gemini(monkeypatch, lambda n, t: httpx.Response(503, json=err_body(503, "UNAVAILABLE", "busy")) if n == 1 else good_response())
    assert "aptitude_questions" in gemini_client.call_gemini("p")
    assert calls["n"] == 2


def test_empty_blocked_and_non_json_answers_are_classified(monkeypatch):
    fake_gemini(monkeypatch, status_response(200, {"promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.kind == "blocked" and "SAFETY" in str(exc.value)

    fake_gemini(monkeypatch, status_response(200, {"candidates": [{"content": {"parts": [{"text": "this is not json"}]}}]}))
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.kind == "invalid_output"


def test_missing_key_is_classified_not_configured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: None)
    with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
        gemini_client.call_gemini("p")
    assert exc.value.kind == "not_configured" and exc.value.retryable is False


def test_per_call_timeout_is_passed_to_the_http_layer_and_defaults_to_30(monkeypatch):
    calls = fake_gemini(monkeypatch, lambda n, t: good_response())
    gemini_client.call_gemini("p")
    gemini_client.call_gemini("p", timeout=45)
    assert calls["timeouts"] == [30, 45]


def test_keys_and_prompts_never_reach_the_logs_or_exceptions(monkeypatch, caplog):
    echo = err_body(400, "INVALID_ARGUMENT", f"API key not valid: {FAKE_KEY}. Please pass a valid API key.")
    fake_gemini(monkeypatch, status_response(400, echo))
    secret_prompt = "CONFIDENTIAL-JOB-DESCRIPTION-TEXT"
    with caplog.at_level(logging.INFO, logger="prepwin.gemini"):
        with pytest.raises(gemini_client.GeminiUnavailableError) as exc:
            gemini_client.call_gemini(secret_prompt)
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert FAKE_KEY not in logged and FAKE_KEY not in str(exc.value)
    assert secret_prompt not in logged and secret_prompt not in str(exc.value)
    assert "kind=auth" in logged and "http_status=400" in logged and "gemini-2.5-flash" in logged, "diagnostics for operators are logged"


# ------------------------------------------------------------------ blueprint service: messages and retry policy
@pytest.mark.parametrize("kind,must_say", [
    ("not_configured", "GEMINI_API_KEY"),
    ("auth", "key was rejected"),
    ("quota", "run out of quota or prepaid credits"),
    ("rate_limit", "rate limiting"),
    ("model", "GEMINI_MODEL_NAME"),
    ("invalid_request", "rejected this request"),
    ("timeout", "too long"),
    ("network", "could not reach Gemini"),
    ("service", "temporarily unavailable"),
    ("blocked", "blocked response"),
    ("invalid_output", "did not pass validation"),
])
def test_each_failure_kind_has_a_specific_admin_message(monkeypatch, kind, must_say):
    def boom(prompt, system_prompt="", temperature=0.1, json_mode=True, timeout=None):
        raise gemini_client.GeminiUnavailableError("SECRET provider detail " + FAKE_KEY, kind=kind)

    monkeypatch.setattr(jd_blueprint_service.gemini_client, "call_gemini", boom)
    with pytest.raises(jd_blueprint_service.BlueprintGenerationError) as exc:
        jd_blueprint_service.generate_jd_blueprint(h.JD_TEXT)
    assert exc.value.kind == kind
    assert must_say in str(exc.value)
    assert "SECRET" not in str(exc.value) and FAKE_KEY not in str(exc.value)


def test_blueprint_retries_transient_kinds_but_not_permanent_ones(monkeypatch):
    for kind, expected_calls in [("quota", 1), ("auth", 1), ("model", 1), ("invalid_request", 1), ("not_configured", 1),
                                 ("timeout", 2), ("service", 2), ("rate_limit", 2), ("network", 2)]:
        n = {"c": 0}

        def boom(prompt, system_prompt="", temperature=0.1, json_mode=True, timeout=None, _k=kind):
            n["c"] += 1
            raise gemini_client.GeminiUnavailableError("x", kind=_k)

        monkeypatch.setattr(jd_blueprint_service.gemini_client, "call_gemini", boom)
        with pytest.raises(jd_blueprint_service.BlueprintGenerationError):
            jd_blueprint_service.generate_jd_blueprint(h.JD_TEXT)
        assert n["c"] == expected_calls, kind


def test_blueprint_asks_for_the_larger_timeout(monkeypatch):
    seen = {}

    def ok(prompt, system_prompt="", temperature=0.1, json_mode=True, timeout=None):
        seen["timeout"] = timeout
        return gemini_mock_fixtures.sample_blueprint()

    monkeypatch.setattr(jd_blueprint_service.gemini_client, "call_gemini", ok)
    jd_blueprint_service.generate_jd_blueprint(h.JD_TEXT)
    assert seen["timeout"] == jd_blueprint_service.GEMINI_TIMEOUT_SECONDS == 45


# ------------------------------------------------------------------ end to end through the API
@pytest.fixture()
def admin():
    db = h.new_session()
    a = h.make_admin(db)
    yield a
    h.cleanup_orgs(db, [a["org"].id])
    db.close()


def generate(admin, job):
    return client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(admin["token"]))


def test_reported_402_reaches_the_admin_as_a_clear_quota_message_and_the_log_has_the_cause(monkeypatch, admin, caplog):
    job = h.create_job(admin)
    calls = fake_gemini(monkeypatch, status_response(402, REAL_402))
    with caplog.at_level(logging.WARNING, logger="prepwin.gemini"):
        r = generate(admin, job)
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert detail["code"] == "quota"
    assert "run out of quota or prepaid credits" in detail["message"] and "Google AI Studio" in detail["message"]
    assert "GeminiUnavailableError" not in r.text, "the raw exception class name is no longer the message"
    assert "prepayment" not in r.text and "RESOURCE_EXHAUSTED" not in r.text, "provider text stays server side"
    assert calls["n"] == 1, "a depleted balance is not retried"
    logged = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "kind=quota" in logged and "http_status=402" in logged and "provider_status=RESOURCE_EXHAUSTED" in logged and FAKE_KEY not in logged


@pytest.mark.parametrize("code,body,expected_code", [
    (402, REAL_402, "quota"),
    (400, err_body(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."), "auth"),
    (404, err_body(404, "NOT_FOUND", "models/x is not found"), "model"),
    (429, err_body(429, "RESOURCE_EXHAUSTED", "Too many requests"), "rate_limit"),
    (503, err_body(503, "UNAVAILABLE", "overloaded"), "service"),
])
def test_failure_never_touches_an_existing_blueprint_or_publishes(monkeypatch, admin, code, body, expected_code):
    job = h.create_job(admin)
    h.patch_gemini_blueprint(monkeypatch)
    ok = generate(admin, job)
    assert ok.status_code == 200
    before = client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(admin["token"])).json()

    monkeypatch.undo()   # drop the helper patch, then simulate the outage at the HTTP layer
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", FAKE_KEY)
    monkeypatch.setattr(gemini_client, "_sleep", lambda s: None)
    monkeypatch.setattr(jd_blueprint_service, "_sleep", lambda s: None)
    fake_gemini(monkeypatch, status_response(code, body))
    r = generate(admin, job)
    assert r.status_code == 502 and r.json()["detail"]["code"] == expected_code

    after = client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(admin["token"])).json()
    assert after["blueprint_data"] == before["blueprint_data"] and after["blueprint_version"] == before["blueprint_version"] == 1
    assert after["status"] == before["status"] == "DRAFT" and after["is_published"] is False and after["share_path"] is None


def test_invalid_json_and_bad_schema_are_retried_then_reported_without_changing_anything(monkeypatch, admin):
    job = h.create_job(admin)
    bad = gemini_mock_fixtures.sample_blueprint()
    bad["aptitude_questions"] = bad["aptitude_questions"][:14]
    calls = fake_gemini(monkeypatch, status_response(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(bad)}]}}]}))
    r = generate(admin, job)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "invalid_output"
    assert calls["n"] == 1 + jd_blueprint_service.GENERATION_RETRIES
    after = client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(admin["token"])).json()
    assert after["blueprint_data"] is None and after["blueprint_version"] == 0

    calls = fake_gemini(monkeypatch, status_response(200, {"candidates": [{"content": {"parts": [{"text": "Sorry, I cannot do that"}]}}]}))
    r = generate(admin, job)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "invalid_output" and calls["n"] == 2


def test_successful_generation_through_the_real_adapter(monkeypatch, admin):
    """The REST adapter path (headers, parsing, validation, persistence) with a simulated 200. NOT a live Gemini call."""
    job = h.create_job(admin)
    calls = fake_gemini(monkeypatch, lambda n, t: good_response())
    r = generate(admin, job)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["blueprint"]["valid"] is True and body["blueprint_version"] == 1
    assert (body["status"], body["is_published"]) == ("DRAFT", False), "generation never publishes"
    assert calls["n"] == 1 and calls["timeouts"] == [45]


def test_transient_outage_then_recovery_through_the_api(monkeypatch, admin):
    job = h.create_job(admin)
    calls = fake_gemini(monkeypatch, lambda n, t: httpx.Response(503, json=err_body(503, "UNAVAILABLE", "busy")) if n == 1 else good_response())
    r = generate(admin, job)
    assert r.status_code == 200 and calls["n"] == 2


def test_timeout_through_the_api_is_reported_as_a_timeout(monkeypatch, admin):
    job = h.create_job(admin)

    def slow(n, t):
        raise httpx.ReadTimeout("timed out")

    fake_gemini(monkeypatch, slow)
    r = generate(admin, job)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "timeout" and "too long" in r.json()["detail"]["message"]


def test_missing_key_through_the_api(monkeypatch, admin):
    job = h.create_job(admin)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: None)
    r = generate(admin, job)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "not_configured" and "GEMINI_API_KEY" in r.json()["detail"]["message"]
