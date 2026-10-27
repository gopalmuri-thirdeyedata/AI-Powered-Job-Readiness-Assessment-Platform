"""
Execution order: the in-house runner first (CODE_RUNNER_URL), Judge0 (JUDGE0_API_URL) only when the runner could not serve the request.
No network is used: requests.post is replaced by a function that answers per URL.
"""
import pytest
import requests

from services import judge0_service as js

RUNNER = "http://code_runner:2358/submissions"
JUDGE0 = "http://judge0.test/submissions"


class _Resp:
    def __init__(self, status=201, body=None, headers=None):
        self.status_code, self._body, self.headers, self.text = status, body, headers or {}, str(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(response=self)


def _ok(stdout="5\n"):
    return _Resp(201, {"token": "t", "stdout": stdout, "stderr": "", "compile_output": "", "time": "0.01", "status": {"id": 3, "description": "Accepted"}})


def _status(sid, text, **extra):
    return _Resp(201, {"token": "t", "stdout": "", "stderr": extra.get("stderr", ""), "compile_output": extra.get("compile_output", ""),
                       "time": "0.01", "status": {"id": sid, "description": text}})


@pytest.fixture
def wire(monkeypatch):
    """Returns (calls, setup) - setup(runner=..., judge0=...) installs the per-URL answers (a callable may raise)."""
    calls = []
    answers = {}

    def fake_post(url, json=None, headers=None, timeout=None, **kw):
        base = url.split("?")[0]
        calls.append({"url": base, "headers": dict(headers or {})})
        answer = answers[base]
        if isinstance(answer, Exception):
            raise answer
        return answer() if callable(answer) else answer

    monkeypatch.setattr(js.requests, "post", fake_post)
    monkeypatch.setattr(js, "_sleep", lambda *_: None)
    monkeypatch.setenv("CODE_EXECUTION_ENGINE", "judge0")
    monkeypatch.setenv("JUDGE0_API_URL", JUDGE0)
    monkeypatch.setenv("JUDGE0_AUTH_TOKEN", "judge0-secret")
    monkeypatch.setenv("CODE_RUNNER_URL", RUNNER)

    def setup(runner=None, judge0=None):
        if runner is not None:
            answers[RUNNER] = runner
        if judge0 is not None:
            answers[JUDGE0] = judge0
    return calls, setup


def _urls(calls):
    return [c["url"] for c in calls]


def test_the_runner_answers_and_judge0_is_never_called(wire):
    calls, setup = wire
    setup(runner=_ok("7\n"), judge0=_ok("never\n"))
    res = js.execute_code("python", "print(7)")
    assert res["status"] == "success" and res["output"] == "7\n"
    assert _urls(calls) == [RUNNER]


def test_the_runner_never_receives_the_judge0_token_but_judge0_does(wire):
    calls, setup = wire
    setup(runner=ConnectionError("down"), judge0=_ok())
    js.execute_code("python", "print(5)")
    runner_call = next(c for c in calls if c["url"] == RUNNER)
    judge0_call = next(c for c in calls if c["url"] == JUDGE0)
    assert "X-Auth-Token" not in runner_call["headers"]
    assert judge0_call["headers"].get("X-Auth-Token") == "judge0-secret"


@pytest.mark.parametrize("runner_failure", [
    requests.ConnectionError("refused"),
    requests.ConnectTimeout("no route"),
    _Resp(503, {}),
    _Resp(502, {}),
    _Resp(500, {}),
    _Resp(429, {}, {"Retry-After": "1"}),
    _Resp(201, {"not": "a judge0 result"}),                      # invalid answer
    _status(13, "Internal Error"),                                 # the runner itself failed
])
def test_a_runner_service_failure_falls_back_to_judge0(wire, runner_failure):
    calls, setup = wire
    setup(runner=runner_failure, judge0=_ok("from judge0\n"))
    res = js.execute_code("python", "print(1)")
    assert res["status"] == "success" and res["output"] == "from judge0\n"
    assert RUNNER in _urls(calls) and JUDGE0 in _urls(calls)


@pytest.mark.parametrize("sid,text,expected_status", [
    (6, "Compilation Error", "error"),
    (5, "Time Limit Exceeded", "failed"),
    (11, "Runtime Error (NZEC)", "failed"),
])
def test_a_candidates_own_error_is_returned_and_never_re_run_on_judge0(wire, sid, text, expected_status):
    calls, setup = wire
    setup(runner=_status(sid, text, compile_output="Main.java: error", stderr="boom"), judge0=_ok("wrong\n"))
    res = js.execute_code("java", "bad code")
    assert res["status"] == expected_status
    assert _urls(calls) == [RUNNER], "a compile error / runtime error / timeout is a real result, not a service failure"


def test_with_no_runner_configured_only_judge0_is_used(wire, monkeypatch):
    calls, setup = wire
    monkeypatch.delenv("CODE_RUNNER_URL")
    setup(runner=_ok("never\n"), judge0=_ok("5\n"))
    assert js.execute_code("python", "print(5)")["output"] == "5\n"
    assert _urls(calls) == [JUDGE0]


def test_when_both_are_down_the_result_is_a_service_error_never_a_score(wire):
    calls, setup = wire
    setup(runner=requests.ConnectionError("x"), judge0=requests.ConnectionError("y"))
    res = js.execute_code("python", "print(1)")
    assert res["status"] == "service_error"
    assert js.classify_execution(res) == js.INFRASTRUCTURE_ERROR


def test_a_dead_runner_opens_only_its_own_circuit_so_judge0_keeps_serving(wire):
    calls, setup = wire
    setup(runner=requests.ConnectionError("x"), judge0=_ok())
    for _ in range(js.CIRCUIT_FAILURE_THRESHOLD):
        assert js.execute_code("python", "print(5)")["status"] == "success"      # every call still succeeds through the fallback
    assert js._circuit_is_open("runner") is True and js._circuit_is_open("judge0") is False
    before = len(_urls(calls))
    assert js.execute_code("python", "print(5)")["status"] == "success"
    assert _urls(calls)[before:] == [JUDGE0], "with the runner's circuit open, the runner is skipped (no wasted attempt)"


def test_a_recovering_runner_is_used_again(wire, monkeypatch):
    calls, setup = wire
    state = {"down": True}
    setup(runner=lambda: (_ for _ in ()).throw(requests.ConnectionError("x")) if state["down"] else _ok("runner\n"), judge0=_ok("judge0\n"))
    assert js.execute_code("python", "print(1)")["output"] == "judge0\n"
    state["down"] = False
    js.reset_circuit()
    assert js.execute_code("python", "print(1)")["output"] == "runner\n"
