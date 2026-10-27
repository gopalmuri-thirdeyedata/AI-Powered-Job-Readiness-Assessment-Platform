"""
Judge0 adapter reliability (services/judge0_service.py) and how the shared engine treats its results.

MOCKED: requests.post / requests.get are replaced by scripted fakes and the clock is controlled, so these tests prove the
adapter's classification, bounded retry / polling, breaker and error hygiene. They prove nothing about the live service
(see the release report for the live probe results).
"""
import json

import pytest
import requests

from services import assessment_engine as engine
from services import judge0_service as ps


class Resp:
    def __init__(self, body=None, status=200, headers=None, text=None, bad_json=False):
        self._body, self.status_code, self.headers = body, status, headers or {}
        self.text = text if text is not None else json.dumps(body)
        self._bad_json = bad_json

    def json(self):
        if self._bad_json:
            raise ValueError("not json")
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(response=self)


def judge(status_id, desc="x", **fields):
    return {"status": {"id": status_id, "description": desc}, **fields}


ACCEPTED = judge(3, "Accepted", stdout="42\n", time="0.01")


class Script:
    """Scripted requests.post / requests.get. Items are responses or exceptions, consumed in order (the last one repeats)."""

    def __init__(self, monkeypatch, posts=(), gets=()):
        self.posts, self.gets = list(posts), list(gets)
        self.post_calls, self.get_calls = [], []
        monkeypatch.setattr(ps.requests, "post", self._post)
        monkeypatch.setattr(ps.requests, "get", self._get)

    @staticmethod
    def _next(queue):
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, BaseException):
            raise item
        return item

    def _post(self, url, json=None, headers=None, timeout=None):
        self.post_calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        return self._next(self.posts)

    def _get(self, url, params=None, headers=None, timeout=None):
        self.get_calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        return self._next(self.gets)


class Clock:
    def __init__(self):
        self.t = 1000.0
        self.sleeps = []

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.t += seconds


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("JUDGE0_API_URL", "http://judge0.test/submissions")
    monkeypatch.delenv("JUDGE0_WAIT", raising=False)
    monkeypatch.delenv("JUDGE0_AUTH_TOKEN", raising=False)
    ps.reset_circuit()


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(ps, "_time", c.now)
    monkeypatch.setattr(ps, "_sleep", c.sleep)
    monkeypatch.setattr(engine.time, "sleep", c.sleep)
    return c


# ------------------------------------------------------------------------------ successful runs
def test_python_success(monkeypatch):
    s = Script(monkeypatch, posts=[Resp(ACCEPTED, 201)])
    res = ps.execute_code("python", "print(42)", "in")
    assert res["status"] == "success" and res["stdout"] == "42\n" and res["timed_out"] is False
    assert s.post_calls[0]["json"]["language_id"] == 71 and s.post_calls[0]["json"]["stdin"] == "in"
    assert s.post_calls[0]["url"] == "http://judge0.test/submissions?wait=true"


def test_java_success(monkeypatch):
    s = Script(monkeypatch, posts=[Resp(judge(3, "Accepted", stdout="[0, 1]\n"), 201)])
    res = ps.execute_code("java", "public class Main {}", "")
    assert res["status"] == "success" and res["stdout"] == "[0, 1]\n"
    assert s.post_calls[0]["json"]["language_id"] == 62


def test_auth_token_is_sent_when_configured(monkeypatch):
    monkeypatch.setenv("JUDGE0_AUTH_TOKEN", "t0k3n")
    s = Script(monkeypatch, posts=[Resp(ACCEPTED)])
    ps.execute_code("python", "x")
    assert s.post_calls[0]["headers"]["X-Auth-Token"] == "t0k3n"


# ------------------------------------------------------------------------------ candidate errors are not infrastructure errors
def test_compilation_failure(monkeypatch):
    Script(monkeypatch, posts=[Resp(judge(6, "Compilation Error", compile_output="Main.java:3: error: ';' expected"))])
    res = ps.execute_code("java", "bad")
    assert res["status"] == "error" and "expected" in res["output"] and res["timed_out"] is False
    assert ps.classify_execution(res) == ps.COMPILATION_ERROR


@pytest.mark.parametrize("status_id", [7, 8, 9, 10, 11, 12])
def test_runtime_failure(monkeypatch, status_id):
    Script(monkeypatch, posts=[Resp(judge(status_id, "Runtime Error", stderr="Traceback: ZeroDivisionError"))])
    res = ps.execute_code("python", "1/0")
    assert res["status"] == "failed" and "ZeroDivisionError" in res["output"]
    assert ps.classify_execution(res) == ps.RUNTIME_ERROR


def test_execution_timeout(monkeypatch):
    Script(monkeypatch, posts=[Resp(judge(5, "Time Limit Exceeded"))])
    res = ps.execute_code("python", "while True: pass")
    assert res["status"] == "failed" and res["timed_out"] is True
    assert ps.classify_execution(res) == ps.TIME_LIMIT_EXCEEDED


# ------------------------------------------------------------------------------ the sandbox itself failing is never "success"
@pytest.mark.parametrize("body", [
    ["not", "an", "object"],
    {},
    {"status": "Accepted"},
    {"status": {"description": "no id"}},
    {"status": {"id": "3"}},
    {"status": {"id": 3}, "stdout": 12345},
    judge(13, "Internal Error"),
    judge(14, "Exec Format Error"),
    judge(99, "Surprise"),
])
def test_malformed_or_unknown_results_are_service_errors(monkeypatch, body):
    Script(monkeypatch, posts=[Resp(body)])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and res["status"] != "success"
    assert res["retryable"] is False
    assert ps.classify_execution(res) == ps.INFRASTRUCTURE_ERROR


def test_non_json_response_is_a_service_error(monkeypatch):
    Script(monkeypatch, posts=[Resp(bad_json=True, text="<html>502 Bad Gateway nginx/1.2</html>")])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and "nginx" not in res["output"] and "<html>" not in res["output"]


@pytest.mark.parametrize("code,retryable", [(500, False), (502, True), (503, True), (504, True), (400, False), (401, False), (403, False), (404, False)])
def test_upstream_http_failures(monkeypatch, code, retryable):
    Script(monkeypatch, posts=[Resp({"error": "internal path /srv/judge0/secret"}, code, text="stacktrace /srv/judge0/secret")])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and res["retryable"] is retryable
    assert f"HTTP {code}" in res["output"] and "/srv/judge0" not in json.dumps(res)     # upstream bodies never leak


def test_rate_limit_handling(monkeypatch):
    Script(monkeypatch, posts=[Resp({}, 429, headers={"Retry-After": "1"})])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and res["rate_limited"] is True and res["retryable"] is True and res["retry_after"] == 1.0
    Script(monkeypatch, posts=[Resp({}, 429, headers={"Retry-After": "120"})])
    res = ps.execute_code("python", "x")
    assert res["rate_limited"] is True and res["retryable"] is False                     # a long wait is not served inside a request
    Script(monkeypatch, posts=[Resp({}, 429)])
    assert ps.execute_code("python", "x")["rate_limited"] is True


def test_timeouts_and_connection_failures(monkeypatch):
    Script(monkeypatch, posts=[requests.ReadTimeout("slow")])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and res["retryable"] is False                # it may be running: never resubmit
    Script(monkeypatch, posts=[requests.ConnectTimeout("no route")])
    assert ps.execute_code("python", "x")["retryable"] is True                            # nothing reached the service
    Script(monkeypatch, posts=[requests.ConnectionError("refused")])
    assert ps.execute_code("python", "x")["retryable"] is True
    Script(monkeypatch, posts=[RuntimeError("adapter bug at /srv/app/x.py")])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and "/srv/app" not in json.dumps(res)


def test_unsupported_language_and_oversized_input_are_rejected_locally(monkeypatch):
    s = Script(monkeypatch, posts=[Resp(ACCEPTED)])
    res = ps.execute_code("cobol", "x")
    assert res["status"] == "error" and "Unsupported language" in res["output"]
    assert ps.execute_code("python", "a" * (64 * 1024 + 1))["status"] == "error"
    assert s.post_calls == []                                                             # nothing was sent upstream


# ------------------------------------------------------------------------------ asynchronous submissions and polling
def test_token_only_response_is_polled_to_completion_with_a_single_submission(monkeypatch, clock):
    s = Script(monkeypatch, posts=[Resp({"token": "abc"}, 201)],
               gets=[Resp(judge(1, "In Queue")), Resp(judge(2, "Processing")), Resp(ACCEPTED)])
    res = ps.execute_code("python", "x")
    assert res["status"] == "success" and res["stdout"] == "42\n"
    assert len(s.post_calls) == 1 and len(s.get_calls) == 3                               # exactly one submission
    assert s.get_calls[0]["url"] == "http://judge0.test/submissions/abc"
    assert clock.sleeps == sorted(clock.sleeps) and max(clock.sleeps) <= ps.POLL_MAX_INTERVAL_SECONDS


def test_wait_false_mode_submits_without_wait_and_polls(monkeypatch, clock):
    monkeypatch.setenv("JUDGE0_WAIT", "false")
    s = Script(monkeypatch, posts=[Resp({"token": "tok"}, 201)], gets=[Resp(judge(5, "Time Limit Exceeded"))])
    res = ps.execute_code("python", "x")
    assert s.post_calls[0]["url"].endswith("?wait=false") and res["timed_out"] is True


def test_queued_status_with_token_is_polled(monkeypatch, clock):
    Script(monkeypatch, posts=[Resp({"token": "abc", "status": {"id": 1, "description": "In Queue"}}, 201)], gets=[Resp(ACCEPTED)])
    assert ps.execute_code("python", "x")["status"] == "success"


def test_polling_timeout_is_a_service_error_not_a_result(monkeypatch, clock):
    s = Script(monkeypatch, posts=[Resp({"token": "abc"}, 201)], gets=[Resp(judge(2, "Processing"))])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and "timed out" in res["output"] and res["retryable"] is False
    assert len(s.post_calls) == 1                                                         # never resubmitted
    assert clock.t - 1000.0 >= ps.POLL_TIMEOUT_SECONDS - ps.POLL_MAX_INTERVAL_SECONDS and len(s.get_calls) < 40   # bounded, not a hot loop


def test_repeated_poll_errors_stop_the_polling(monkeypatch, clock):
    s = Script(monkeypatch, posts=[Resp({"token": "abc"}, 201)], gets=[requests.ConnectionError("down")])
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and len(s.get_calls) == ps.POLL_MAX_CONSECUTIVE_ERRORS and len(s.post_calls) == 1


def test_poll_recovers_from_a_single_blip(monkeypatch, clock):
    Script(monkeypatch, posts=[Resp({"token": "abc"}, 201)], gets=[requests.ConnectionError("blip"), Resp(ACCEPTED)])
    assert ps.execute_code("python", "x")["status"] == "success"


def test_malformed_poll_result_is_a_service_error(monkeypatch, clock):
    Script(monkeypatch, posts=[Resp({"token": "abc"}, 201)], gets=[Resp({"weird": True})])
    assert ps.execute_code("python", "x")["status"] == "service_error"


# ------------------------------------------------------------------------------ circuit breaker (no retry storms during an outage)
def test_circuit_opens_after_consecutive_failures_and_recovers(monkeypatch, clock):
    s = Script(monkeypatch, posts=[Resp({}, 503)])
    for _ in range(ps.CIRCUIT_FAILURE_THRESHOLD):
        assert ps.execute_code("python", "x")["status"] == "service_error"
    sent = len(s.post_calls)
    res = ps.execute_code("python", "x")
    assert res["status"] == "service_error" and "temporarily unavailable" in res["output"] and len(s.post_calls) == sent   # failed fast
    clock.t += ps.CIRCUIT_COOLDOWN_SECONDS + 1
    s.posts = [Resp(ACCEPTED)]
    assert ps.execute_code("python", "x")["status"] == "success" and len(s.post_calls) == sent + 1


def test_a_success_resets_the_failure_count(monkeypatch, clock):
    Script(monkeypatch, posts=[Resp({}, 503)] * 5 + [Resp(ACCEPTED)] + [Resp({}, 503)] * 5)
    results = [ps.execute_code("python", "x")["status"] for _ in range(11)]
    assert results.count("success") == 1 and all("temporarily" not in str(r) for r in results)


def test_candidate_errors_do_not_trip_the_breaker(monkeypatch, clock):
    s = Script(monkeypatch, posts=[Resp(judge(11, "Runtime Error", stderr="boom"))])
    for _ in range(ps.CIRCUIT_FAILURE_THRESHOLD + 3):
        assert ps.execute_code("python", "x")["status"] == "failed"
    assert len(s.post_calls) == ps.CIRCUIT_FAILURE_THRESHOLD + 3


# ------------------------------------------------------------------------------ how the engine uses it
PROBLEMS = [{"id": "1", "title": "Sum"}]
KEYS = {"1": {"hidden_test_cases": [{"id": "h1", "input": "1 2\n", "expected_output": "SECRET-3"},
                                     {"id": "h2", "input": "2 3\n", "expected_output": "SECRET-5"}], "comparison": "text"}}
SOLUTION = {"1": {"code": "print('x')", "language": "python"}}


def _expect_unavailable(monkeypatch, posts):
    s = Script(monkeypatch, posts=posts)
    with pytest.raises(engine.SandboxUnavailable):
        engine.evaluate_coding(PROBLEMS, KEYS, SOLUTION, concurrency=1)
    return s


def test_engine_never_scores_when_the_sandbox_fails(monkeypatch, clock):
    for failure in (Resp({}, 500), Resp({"junk": 1}), Resp(bad_json=True), requests.ReadTimeout("slow")):
        ps.reset_circuit()
        _expect_unavailable(monkeypatch, [failure])


def test_engine_retries_a_provably_unsubmitted_request_exactly_once(monkeypatch, clock):
    s = _expect_unavailable(monkeypatch, [Resp({}, 503)])
    assert len(s.post_calls) == 2                      # one attempt + one retry, and then it stops (the first failure aborts the rest)


def test_engine_never_resubmits_after_a_read_timeout(monkeypatch, clock):
    s = _expect_unavailable(monkeypatch, [requests.ReadTimeout("slow")])
    assert len(s.post_calls) == 1                      # the code may be running: no duplicate submission


def test_engine_recovers_when_the_retry_succeeds(monkeypatch, clock):
    outputs = [Resp({}, 503), Resp(judge(3, "Accepted", stdout="SECRET-3")), Resp(judge(3, "Accepted", stdout="SECRET-5"))]
    Script(monkeypatch, posts=outputs)
    res = engine.evaluate_coding(PROBLEMS, KEYS, SOLUTION, concurrency=1)
    assert res["score"] == 100.0


def test_engine_stops_issuing_submissions_after_the_first_outage_result(monkeypatch, clock):
    many = {"1": {"hidden_test_cases": [{"id": f"h{i}", "input": f"{i}\n", "expected_output": "1"} for i in range(10)], "comparison": "text"}}
    s = Script(monkeypatch, posts=[requests.ReadTimeout("slow")])
    with pytest.raises(engine.SandboxUnavailable):
        engine.evaluate_coding(PROBLEMS, many, SOLUTION, concurrency=1)
    assert len(s.post_calls) == 1                      # nine more 30-second waits were not started


def test_compile_and_runtime_errors_are_scored_as_failed_tests_not_outages(monkeypatch, clock):
    Script(monkeypatch, posts=[Resp(judge(6, "Compilation Error", compile_output="error: boom"))])
    res = engine.evaluate_coding(PROBLEMS, KEYS, SOLUTION, concurrency=1)
    assert res["score"] == 0.0 and res["problems"][0]["classification"] == ps.COMPILATION_ERROR and "boom" in res["problems"][0]["message"]
    Script(monkeypatch, posts=[Resp(judge(5, "Time Limit Exceeded"))])
    res = engine.evaluate_coding(PROBLEMS, KEYS, SOLUTION, concurrency=1)
    assert res["score"] == 0.0 and res["problems"][0]["classification"] == ps.TIME_LIMIT_EXCEEDED


def test_hidden_expectations_never_leave_the_server(monkeypatch, clock):
    s = Script(monkeypatch, posts=[Resp(judge(3, "Accepted", stdout="SECRET-3")), Resp(judge(3, "Accepted", stdout="SECRET-5"))])
    engine.evaluate_coding(PROBLEMS, KEYS, SOLUTION, concurrency=1)
    sent = json.dumps(s.post_calls)
    assert "SECRET" not in sent and "expected" not in sent.lower()                        # only the inputs are submitted
    assert [c["json"]["stdin"] for c in s.post_calls] == ["1 2\n", "2 3\n"]


# ------------------------------------------------------------------------------ no local execution fallback
def test_candidate_code_is_never_executed_locally_when_the_service_fails(monkeypatch, clock):
    import os
    import subprocess

    def forbidden(*_a, **_k):
        raise AssertionError("candidate code must never run on the application server")

    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    monkeypatch.setattr(os, "system", forbidden)
    Script(monkeypatch, posts=[requests.ConnectionError("refused")])
    res = ps.execute_code("python", "print('hi')")
    assert res["status"] == "service_error"
    src = open(ps.__file__, encoding="utf-8").read()
    for needle in ("subprocess", "os.system", "exec(", "eval(", "compile("):
        assert needle not in src, needle
