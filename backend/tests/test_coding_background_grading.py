"""Coding is graded in the background: the student is never held on a loading screen, the interview unlocks at
once, and the final report always contains the real grade."""
import threading
import time
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import models
from main import app
from services import piston_service, roleready_service
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401
from tests.test_roleready_plan_requirements import _advance_to_coding, _url

client = TestClient(app)
State = models.RoleReadySessionState
SOLUTIONS = {"1": {"code": "print(1)", "language": "python"}, "2": {"code": "print(2)", "language": "python"}}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    roleready_service._run_code_calls.clear()
    roleready_service._run_code_active.clear()
    roleready_service._coding_eval_events.clear()
    monkeypatch.setattr(piston_service, "_sleep", lambda *_: None)
    yield


def _round(db_session, session):
    db_session.expire_all()
    return db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="CODING").first()


def _correct_sandbox(session_round, delay=0.0, calls=None):
    """A sandbox that answers every hidden test correctly, optionally slowly, and counts its calls."""
    expected = {}
    for problem in session_round.server_keys_payload.values():
        for test in problem["hidden_test_cases"]:
            expected[test.get("input", "")] = test.get("expected_output", "")

    def _exec(language_key, code, stdin=""):
        if calls is not None:
            calls.append(stdin)
        if delay:
            time.sleep(delay)
        out = expected.get(stdin, "")
        return {"status": "success", "output": out, "stdout": out, "stderr": "", "compile_output": "",
                "timed_out": False, "execution_time_ms": 5.0, "raw": {}}
    return _exec


def _wait_for(predicate, timeout=15.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def test_a_fast_grade_comes_back_with_the_submit(db_session, setup_test_data, monkeypatch):
    session, h = _advance_to_coding(db_session, setup_test_data)
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, session)))
    res = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS})
    body = res.json()
    assert res.status_code == 200 and body["status"] == "success"
    assert body["score"] == 100.0 and len(body["results"]) == 2
    assert all(r["passed_tests"] == r["total_tests"] for r in body["results"])
    assert body["current_state"] == State.INTERVIEW_UNLOCKED


def test_a_slow_grade_does_not_hold_the_student_and_finishes_in_the_background(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(roleready_service, "CODING_EVAL_WAIT_SECONDS", 0.4)
    session, h = _advance_to_coding(db_session, setup_test_data)
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, session), delay=1.5))

    started = time.perf_counter()
    res = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS})
    took = time.perf_counter() - started
    body = res.json()

    assert took < 1.4, f"the student waited {took:.1f}s for a grade that takes much longer"
    assert res.status_code == 200 and body["status"] == "evaluating" and body["evaluation_pending"] is True
    assert body["score"] is None and body["next_round_unlocked"] is True
    # the interview is open immediately, while grading is still running
    assert client.post(_url(session, "start-interview"), headers=h).status_code == 200

    # ...and the grade lands by itself
    assert _wait_for(lambda: _round(db_session, session).status == "EVALUATED"), "the background grade never finished"
    rnd = _round(db_session, session)
    assert rnd.score == 100.0
    db_session.refresh(session)
    assert session.coding_score == 100.0
    assert rnd.evaluation_payload["passed_hidden_tests"] == rnd.evaluation_payload["total_hidden_tests"] > 0


def test_pressing_submit_twice_grades_once_and_never_double_runs_the_tests(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(roleready_service, "CODING_EVAL_WAIT_SECONDS", 0.3)
    session, h = _advance_to_coding(db_session, setup_test_data)
    calls = []
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, session), delay=0.6, calls=calls))

    first = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS})
    second = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS})
    assert first.status_code == 200 and second.status_code == 200
    assert second.json().get("idempotent_replay") is True
    assert _wait_for(lambda: _round(db_session, session).status == "EVALUATED")
    total_tests = _round(db_session, session).evaluation_payload["total_hidden_tests"]
    assert len(calls) == total_tests, f"{len(calls)} sandbox runs for {total_tests} tests: some ran twice"


def test_different_code_cannot_replace_a_submission_that_is_being_graded(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(roleready_service, "CODING_EVAL_WAIT_SECONDS", 0.2)
    session, h = _advance_to_coding(db_session, setup_test_data)
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, session), delay=1.0))
    assert client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS}).status_code == 200
    other = {"1": {"code": "print('cheat')", "language": "python"}}
    res = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": other})
    assert res.status_code == 400
    assert _round(db_session, session).submission_payload == SOLUTIONS
    _wait_for(lambda: _round(db_session, session).status == "EVALUATED")


def test_the_final_report_waits_for_a_grade_that_is_still_running(db_session, setup_test_data, monkeypatch):
    """Finishing the interview before the grade lands must still produce the real overall score, not a zero."""
    monkeypatch.setattr(roleready_service, "CODING_EVAL_WAIT_SECONDS", 0.2)
    session, h = _advance_to_coding(db_session, setup_test_data)
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, session), delay=1.2))
    assert client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS}).json()["status"] == "evaluating"
    assert client.post(_url(session, "start-interview"), headers=h).status_code == 200

    done = client.post(_url(session, "submit-interview"), headers=h, json={"answers": []})
    assert done.status_code == 200 and done.json()["current_state"] == State.COMPLETED
    db_session.expire_all()
    db_session.refresh(session)
    assert session.coding_score == 100.0, "the final score was computed before the coding grade arrived"
    expected = round(session.aptitude_score * 0.25 + 100.0 * 0.40 + session.interview_score * 0.35, 1)
    assert session.overall_readiness_score == expected


def test_a_grade_lost_to_a_server_restart_is_recovered(db_session, setup_test_data, monkeypatch):
    """EVALUATING with no thread running and an old timestamp means its worker died: it is graded again."""
    session, h = _advance_to_coding(db_session, setup_test_data)
    rnd = _round(db_session, session)
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(rnd))
    rnd.status = "EVALUATING"
    rnd.submission_payload = SOLUTIONS
    rnd.submitted_at = datetime.utcnow() - timedelta(seconds=roleready_service.CODING_EVAL_STALE_SECONDS + 60)
    session.current_state = State.INTERVIEW_UNLOCKED
    db_session.commit()
    assert roleready_service._coding_eval_is_stale(_round(db_session, session)) is True

    roleready_service.ensure_coding_evaluated(db_session, session, wait_seconds=20)
    rnd = _round(db_session, session)
    assert rnd.status == "EVALUATED" and rnd.score == 100.0


def test_a_grade_that_is_young_is_not_mistaken_for_a_lost_one(db_session, setup_test_data):
    session, h = _advance_to_coding(db_session, setup_test_data)
    rnd = _round(db_session, session)
    rnd.status = "EVALUATING"
    rnd.submitted_at = datetime.utcnow()
    db_session.commit()
    assert roleready_service._coding_eval_is_stale(_round(db_session, session)) is False


def test_if_the_sandbox_stays_down_the_report_still_completes_and_says_so(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(roleready_service, "CODING_FINAL_WAIT_SECONDS", 3)
    session, h = _advance_to_coding(db_session, setup_test_data)
    monkeypatch.setattr(piston_service, "execute_code",
                        lambda *a, **k: {"status": "service_error", "output": "down", "stdout": "", "stderr": "",
                                         "compile_output": "", "timed_out": False, "execution_time_ms": None, "raw": {}})
    assert client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS}).json()["status"] == "evaluating"
    client.post(_url(session, "start-interview"), headers=h)

    started = time.perf_counter()
    done = client.post(_url(session, "submit-interview"), headers=h, json={"answers": []})
    assert time.perf_counter() - started < 30, "the final step must not hang when the sandbox is down"
    assert done.status_code == 200 and done.json()["current_state"] == State.COMPLETED
    rnd = _round(db_session, session)
    assert rnd.evaluation_payload["evaluation_status"] == "UNAVAILABLE"
    assert "sandbox" in rnd.evaluation_payload["message"].lower()


def test_an_empty_submission_from_the_timer_scores_zero_without_the_sandbox(db_session, setup_test_data, monkeypatch):
    calls = []
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, _advance_to_coding(db_session, setup_test_data)[0]), calls=calls))
    session, h = _advance_to_coding(db_session, setup_test_data)
    calls.clear()
    res = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": {}})
    assert res.status_code == 200 and res.json()["score"] == 0.0 and res.json()["status"] == "success"
    assert calls == [], "unanswered problems must not touch the sandbox"


def test_grading_threads_do_not_leak_or_block_the_server(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(roleready_service, "CODING_EVAL_WAIT_SECONDS", 0.2)
    session, h = _advance_to_coding(db_session, setup_test_data)
    monkeypatch.setattr(piston_service, "execute_code", _correct_sandbox(_round(db_session, session), delay=0.5))
    client.post(_url(session, "submit-coding"), headers=h, json={"solutions": SOLUTIONS})
    assert _wait_for(lambda: _round(db_session, session).status == "EVALUATED")
    assert _wait_for(lambda: not any(t.name.startswith("coding-eval-") for t in threading.enumerate()), timeout=5)
