"""
Coding execution for shared-link candidates, through the SHARED coding engine (services.assessment_engine) and the
platform's Judge0 adapter. Blueprint problems are delivered in the student stdin format.

These are MOCKED-SANDBOX tests: piston_service.execute_code is replaced by a local subprocess (recruitment_helpers.
install_local_sandbox), so they prove the backend's confidentiality, classification and scoring logic, NOT that Judge0 runs
the code. Live Judge0 verification is separate (see docs/recruitment-workflow.md).
"""
import copy
import json

import pytest

import database
import models
from services import gemini_mock_fixtures, piston_service
from services import assessment_flow_service as flow
from tests import recruitment_helpers as h

client = h.client
HIDDEN_SENTINEL = 918273645
PUBLIC_SENTINEL = 111222333


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def env(db):
    mp = pytest.MonkeyPatch()
    bp = copy.deepcopy(gemini_mock_fixtures.sample_blueprint())
    bp["coding_problems"][0]["hidden_test_cases"].append({"input": {"a": 400000000, "b": 518273645}, "expected": HIDDEN_SENTINEL})
    bp["coding_problems"][0]["public_test_cases"].append({"input": {"a": 100000000, "b": 11222333}, "expected": PUBLIC_SENTINEL})
    admin = h.make_admin(db)
    h.patch_gemini_blueprint(mp, blueprint=bp)
    job = h.create_job(admin)
    assert client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(admin["token"])).status_code == 200
    pub = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"])).json()
    yield {"admin": admin, "job": pub, "token": pub["share_token"]}
    mp.undo()
    h.cleanup_orgs(db, [admin["org"].id])


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    h.reset_public_limiters()
    h.patch_interview_eval(monkeypatch)
    yield
    h.reset_public_limiters()


def coding_session(db, env):
    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    r = client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])})
    assert r.status_code == 200
    return s


def run(s, problem="C1", code=None, language="python"):
    return client.post(h.sess_url(s, "run-code"), headers=h.sh(s), json={
        "problem_id": problem, "language": language, "code": code if code is not None else h.GOOD_SOLUTIONS[problem]["code"]})


def test_public_code_execution_success(db, env, monkeypatch):
    h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    r = run(s)
    assert r.status_code == 200
    body = r.json()
    assert body["all_passed"] is True and body["status"] == "success" and body["language"] == "python"
    assert len(body["test_results"]) == 3 and all(x["passed"] for x in body["test_results"])
    assert body["problem_id"] == "C1"
    wrong = run(s, code=h.program("def solve(a, b):\n    return a - b\n")).json()
    assert wrong["all_passed"] is False


def test_sample_run_uses_the_student_response_shape(db, env, monkeypatch):
    """The shared coding UI renders exactly this shape for both workflows."""
    h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    body = run(s).json()
    for key in ("all_passed", "sample_test_passed", "stdout", "stderr", "error_type", "expected_output", "actual_output", "test_results"):
        assert key in body
    first = body["test_results"][0]
    for key in ("input", "expected_output", "actual_output", "error", "error_type", "timed_out", "passed"):
        assert key in first


def test_failures_are_reported_as_compile_or_runtime_errors(db, env, monkeypatch):
    h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    syntax = run(s, code="def solve(a, b:\n    return 1").json()
    assert syntax["all_passed"] is False and syntax["error_type"] in ("Compilation Error", "Runtime Error")
    boom = run(s, code=h.program("def solve(a, b):\n    raise ZeroDivisionError('x')\n")).json()
    assert boom["all_passed"] is False and boom["error_type"] == "Runtime Error"


def test_infinite_loop_killed_at_timeout_is_time_limit_exceeded(db, env, monkeypatch):
    s = coding_session(db, env)

    def timed_out(language_key, code, stdin=""):  # Judge0 status 5 as mapped by execute_code()
        return {"status": "failed", "output": piston_service.TIMEOUT_MESSAGE, "stdout": "", "stderr": "", "compile_output": "",
                "timed_out": True, "execution_time_ms": 5000.0, "raw": {}}

    monkeypatch.setattr(piston_service, "execute_code", timed_out)
    body = run(s, code="while True:\n    pass\n").json()
    assert body["error_type"] == "Time Limit Exceeded" and body["all_passed"] is False
    assert all(t["timed_out"] for t in body["test_results"])

    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {"C1": {"language": "python", "code": "while True:\n    pass\n"}}})
    assert sub.status_code == 200
    problems = {p["id"]: p for p in h.session_row(db, s["session_uuid"]).final_report_data["sections"]["coding"]["details"]["problems"]}
    assert problems["C1"]["classification"] == "TIME_LIMIT_EXCEEDED" and problems["C1"]["passed_tests"] == 0


def test_hidden_test_cases_confidential(db, env, monkeypatch):
    calls = h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)

    # 1. nothing the candidate can fetch contains hidden tests
    state = client.get(h.sess_url(s, "state"), headers=h.sh(s)).text
    started_blob = json.dumps(s["state"])
    for blob in (state, started_blob):
        assert "hidden" not in blob.lower() and str(HIDDEN_SENTINEL) not in blob and "518273645" not in blob
    assert str(PUBLIC_SENTINEL) in state  # the coding section shows only the public samples

    # 2. run-code only ever executes (and returns) public cases: hidden inputs never reach the sandbox here
    r = run(s)
    assert "hidden" not in r.text.lower() and str(HIDDEN_SENTINEL) not in r.text
    assert all("518273645" not in stdin for stdin in calls["stdins"])

    # 3. submission grades against hidden cases on the backend without echoing them
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})
    assert sub.status_code == 200
    assert "hidden" not in sub.text.lower() and str(HIDDEN_SENTINEL) not in sub.text and "518273645" not in sub.text
    # Expected outputs never enter the sandbox - not in the source, not on stdin. Hidden INPUTS do (one test at a time),
    # which is useless to a candidate without the answers.
    assert all(str(HIDDEN_SENTINEL) not in src and str(PUBLIC_SENTINEL) not in src for src in calls["sources"])
    assert all(str(HIDDEN_SENTINEL) not in stdin and str(PUBLIC_SENTINEL) not in stdin for stdin in calls["stdins"])
    assert any("518273645" in stdin for stdin in calls["stdins"])
    row = h.session_row(db, s["session_uuid"])
    problems = {p["id"]: p for p in row.final_report_data["sections"]["coding"]["details"]["problems"]}
    assert problems["C1"]["passed_tests"] == problems["C1"]["total_tests"] == 4   # hidden tests only (the student platform's logic)
    assert row.final_report_data["sections"]["coding"]["score"] == 100.0


def test_solution_cannot_read_expected_outputs(db, env, monkeypatch):
    calls = h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    cheat = ("import sys\nprint(sorted(k for k in globals()))\n"
             "print([v for k, v in globals().items() if 'expected' in k.lower()])\n")
    body = run(s, code=cheat).json()
    assert body["all_passed"] is False and str(HIDDEN_SENTINEL) not in json.dumps(body)
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {"C1": {"language": "python", "code": cheat}}})
    assert sub.status_code == 200
    assert h.session_row(db, s["session_uuid"]).coding_score == 0.0


def test_sandbox_outage_returns_503_without_score_penalty(db, env, monkeypatch):
    calls = h.install_local_sandbox(monkeypatch, fail=True)
    s = coding_session(db, env)
    r = run(s)
    assert r.status_code == 503
    row = h.session_row(db, s["session_uuid"])
    assert row.current_state == "CODING_IN_PROGRESS"  # the round stays open

    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})
    assert sub.status_code == 503
    detail = sub.json()["detail"]
    assert detail["evaluation_pending"] is True and "pending" in detail["message"].lower()
    assert detail["state"] == "INTERVIEW_IN_PROGRESS"  # the candidate is never blocked by our infrastructure
    row = h.session_row(db, s["session_uuid"])
    coding = flow.get_rounds(db, row.id)["CODING"]
    assert coding.status == "EVALUATION_PENDING"
    assert coding.submission_payload["solutions"]["C1"]["code"] == h.GOOD_SOLUTIONS["C1"]["code"]  # code persisted
    assert row.final_report_data["sections"]["coding"]["score"] is None  # not a fabricated zero

    # Admin "Retry Code Evaluation" once the sandbox is back: evaluated for real, nothing was penalised
    h.install_local_sandbox(monkeypatch)
    out = flow.retry_pending_evaluation(db, row.id)
    assert out["all_evaluated"] is False  # interview still in progress
    row = h.session_row(db, s["session_uuid"])
    assert flow.get_rounds(db, row.id)["CODING"].status == "EVALUATED" and row.coding_score == 100.0


def test_java_is_supported_like_the_student_platform(db, env, monkeypatch):
    """Both languages the Student Platform supports are accepted; Java is routed to the sandbox as Java."""
    calls = h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    r = run(s, language="java", code="public class Main { public static void main(String[] a) {} }")
    assert r.status_code == 200 and r.json()["language"] == "java"
    assert calls["languages"][-1] == "java"
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {
        "C1": {"language": "java", "code": "public class Main { public static void main(String[] a) {} }"}}})
    assert sub.status_code == 200
    problems = {p["id"]: p for p in h.session_row(db, s["session_uuid"]).final_report_data["sections"]["coding"]["details"]["problems"]}
    assert problems["C1"]["language"] == "java"


def test_unsupported_language_and_oversized_code_rejected(db, env, monkeypatch):
    h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    assert run(s, language="cobol").status_code == 400
    assert run(s, code="x = 1\n" * 20000).status_code == 400
    assert client.put(h.sess_url(s, "draft"), headers=h.sh(s), json={"section": "coding", "payload": {"solutions": {"C1": {"code": "x" * 70000}}}}).status_code == 400
    assert run(s, problem="NOPE", code="print(1)").status_code == 404


def test_run_code_rate_limited_per_session(db, env, monkeypatch):
    h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    codes = [run(s).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]


def test_sandbox_concurrency_cap_returns_429(db, env, monkeypatch):
    h.install_local_sandbox(monkeypatch)
    s = coding_session(db, env)
    held = []
    for _ in range(piston_service.SANDBOX_MAX_CONCURRENCY):
        assert piston_service._SANDBOX_SLOTS.acquire(blocking=False)
        held.append(1)
    try:
        assert run(s).status_code == 429
    finally:
        for _ in held:
            piston_service._SANDBOX_SLOTS.release()
    assert run(s).status_code == 200


def test_stdin_input_cap_enforced():
    res = piston_service.execute_sandboxed("python", "print(1)", stdin="x" * (piston_service.MAX_STDIN_BYTES + 1))
    assert res["classification"] == piston_service.RUNTIME_ERROR and "64 KB" in res["output"]
