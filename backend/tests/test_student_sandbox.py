"""
The waiting line in front of the code sandbox, and the load behaviour of the student code paths.

Nothing here changes what is run or how it is judged; it proves that many students at once are queued fairly instead of refused, that no
database connection is held while code waits, and that repeated database work is cut. The "sandbox" is a fake that sleeps.
"""
import concurrent.futures
import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

import database
import models
from main import app
from routers import student_coding
from services import coding_platform_service as cps, judge0_service, student_sandbox
from services.student_sandbox import SandboxGate
from tests.test_coding_platform import student  # noqa: F401  (fixture)

client = TestClient(app)
REAL_EXECUTE = student_sandbox.execute            # the autouse fixture in test_coding_platform replaces it; these tests need the real one

GOOD = ("class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, x in enumerate(nums):\n"
        "            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n")


@pytest.fixture(autouse=True)
def _real_gate(monkeypatch):
    monkeypatch.setattr(student_sandbox, "execute", REAL_EXECUTE)
    student_coding.run_limiter.reset()
    student_coding.submit_limiter.reset()


def _hold(gate, seconds, log=None, name=None):
    with gate.slot():
        if log is not None:
            log.append(name)
        time.sleep(seconds)


# ------------------------------------------------------------------ the gate
def test_never_more_than_the_limit_run_at_once_and_everyone_gets_a_turn():
    gate = SandboxGate(concurrency=3, max_wait_seconds=10, max_waiting=100)
    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as pool:
        list(pool.map(lambda _: _hold(gate, 0.02), range(30)))
    stats = gate.stats()
    assert stats["peak_running"] == 3 and stats["admitted"] == 30 and stats["running"] == 0 and stats["waiting"] == 0
    assert stats["refused_line_full"] == 0 and stats["refused_wait_timeout"] == 0


def test_the_line_is_first_come_first_served():
    gate = SandboxGate(concurrency=1, max_wait_seconds=10, max_waiting=100)
    order = []
    threads = []
    for i in range(8):
        t = threading.Thread(target=_hold, args=(gate, 0.03, order, i))
        threads.append(t)
        t.start()
        time.sleep(0.01)                           # arrive one after another
    for t in threads:
        t.join()
    assert order == list(range(8))


def test_a_wait_that_runs_out_is_the_ordinary_busy_answer_and_frees_nothing_it_did_not_take():
    gate = SandboxGate(concurrency=1, max_wait_seconds=0.15, max_waiting=10)
    holder = threading.Thread(target=_hold, args=(gate, 0.6))
    holder.start()
    time.sleep(0.05)
    started = time.monotonic()
    with pytest.raises(judge0_service.SandboxBusy):
        with gate.slot():
            pytest.fail("must not get a turn")
    assert 0.1 < time.monotonic() - started < 0.5
    holder.join()
    with gate.slot():                              # the holder's turn was returned, and the refused caller took none
        pass
    stats = gate.stats()
    assert stats["refused_wait_timeout"] == 1 and stats["running"] == 0 and stats["waiting"] == 0


def test_a_line_that_is_too_long_refuses_at_once_instead_of_making_everyone_wait():
    gate = SandboxGate(concurrency=1, max_wait_seconds=5, max_waiting=2)
    threads = [threading.Thread(target=_hold, args=(gate, 0.5)) for _ in range(3)]       # one running, two waiting
    for t in threads:
        t.start()
        time.sleep(0.03)
    started = time.monotonic()
    with pytest.raises(judge0_service.SandboxBusy):
        with gate.slot():
            pass
    assert time.monotonic() - started < 0.1, "refused immediately"
    for t in threads:
        t.join()
    assert gate.stats()["refused_line_full"] == 1 and gate.stats()["admitted"] == 3


def test_a_turn_is_returned_even_when_the_run_fails():
    gate = SandboxGate(concurrency=1, max_wait_seconds=1, max_waiting=5)
    with pytest.raises(RuntimeError):
        with gate.slot():
            raise RuntimeError("the runner blew up")
    with gate.slot():
        pass
    assert gate.stats()["running"] == 0 and gate.stats()["admitted"] == 2


def test_settings_come_from_the_environment_with_safe_defaults(monkeypatch):
    for name in ("STUDENT_SANDBOX_CONCURRENCY", "STUDENT_SANDBOX_WAIT_SECONDS", "STUDENT_SANDBOX_MAX_WAITING"):
        monkeypatch.delenv(name, raising=False)
    gate = student_sandbox._from_env()
    assert (gate.concurrency, gate.max_wait_seconds, gate.max_waiting) == (3, 20.0, 150)
    monkeypatch.setenv("STUDENT_SANDBOX_CONCURRENCY", "6")
    monkeypatch.setenv("STUDENT_SANDBOX_WAIT_SECONDS", "7.5")
    monkeypatch.setenv("STUDENT_SANDBOX_MAX_WAITING", "bogus")
    gate = student_sandbox._from_env()
    assert (gate.concurrency, gate.max_wait_seconds, gate.max_waiting) == (6, 7.5, 150)


def test_execute_keeps_the_input_cap_and_classification_of_the_sandbox_wrapper(monkeypatch):
    calls = []
    monkeypatch.setattr(judge0_service, "execute_code", lambda lang, code, stdin="": calls.append(stdin) or {"status": "success", "stdout": "ok"})
    big = student_sandbox.execute("python", "print(1)", "x" * (judge0_service.MAX_STDIN_BYTES + 1))
    assert big["classification"] == judge0_service.RUNTIME_ERROR and not calls, "an oversized input never reaches the runner"
    assert student_sandbox.execute("python", "print(1)", "1")["classification"] == judge0_service.OK and calls == ["1"]


# ------------------------------------------------------------------ the Coding page under load
def _slow_sandbox(log, delay=0.05):
    """A runner that takes `delay` seconds per run and records how many runs overlap."""
    lock = threading.Lock()
    state = {"now": 0}

    def execute_code(language, code, stdin=""):
        with lock:
            state["now"] += 1
            log.append(state["now"])
        time.sleep(delay)
        with lock:
            state["now"] -= 1
        return {"status": "success", "stdout": "", "stderr": "", "timed_out": False, "output": "", "compile_output": "", "execution_time_ms": 1.0, "raw": {}}
    return execute_code


def test_many_students_running_at_once_are_queued_not_refused_and_the_runner_is_never_flooded(student, monkeypatch):
    overlap = []
    monkeypatch.setattr(judge0_service, "execute_code", _slow_sandbox(overlap))
    monkeypatch.setattr(student_sandbox, "gate", SandboxGate(concurrency=3, max_wait_seconds=20, max_waiting=100))
    run_ok = []

    def one(_):
        r = TestClient(app).post("/api/student/coding/problems/two-sum/run", headers=student["headers"], json={"code": GOOD})
        run_ok.append(r.status_code)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(one, range(16)))
    # the fake runner prints nothing, so the verdict is not the point: every one of the 16 requests was SERVED (no 429, no 5xx),
    # and the runner never saw more than the allowed number of programs at once
    assert run_ok == [200] * 16, run_ok
    assert len(overlap) == 16 and max(overlap) <= 3, f"the runner saw {max(overlap)} at once"
    assert student_sandbox.gate.stats()["peak_running"] <= 3


def test_without_the_line_the_same_burst_floods_the_runner(student, monkeypatch):
    """The comparison that justifies the line: calling the sandbox directly lets every request through at once."""
    overlap = []
    monkeypatch.setattr(judge0_service, "execute_code", _slow_sandbox(overlap))
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda _: judge0_service.execute_code("python", "x", ""), range(12)))
    assert max(overlap) > 3


# ------------------------------------------------------------------ database work
def test_no_database_connection_is_held_while_code_waits_for_the_sandbox(student, monkeypatch):
    db = database.SessionLocal()
    seen = {}

    def execute_code(language, code, stdin=""):
        seen["in_transaction"] = db.in_transaction()
        return {"status": "success", "stdout": "", "stderr": "", "timed_out": False, "output": "", "compile_output": "", "execution_time_ms": 1.0, "raw": {}}

    monkeypatch.setattr(judge0_service, "execute_code", execute_code)
    try:
        problem = cps.snapshot_for_execution(db, "two-sum")
        profile = db.query(models.StudentProfile).filter(models.StudentProfile.id == student["profile_id"]).one()
        cps.submit_code(db, profile, problem, GOOD)
        assert seen["in_transaction"] is False, "submit held a database transaction while the code ran"
        seen.clear()
        cps.run_code(db, problem, GOOD, None)
        assert seen["in_transaction"] is False, "run held a database transaction while the code ran"
    finally:
        db.close()


def _count_statements(engine):
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, "before_cursor_execute", record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", record)


def test_a_problem_for_running_is_served_from_memory_after_the_first_time(student):
    db = database.SessionLocal()
    try:
        cps._problem_cache.clear()
        first = cps.snapshot_for_execution(db, "two-sum")
        statements, stop = _count_statements(database.engine)
        try:
            second = cps.snapshot_for_execution(db, "two-sum")
            third = cps.snapshot_for_execution(db, "two-sum")
        finally:
            stop()
        assert second is first and third is first
        assert statements == [], f"the problem was read from the database again: {statements}"
        assert len(first.test_cases) >= 6 and first.function_name == "twoSum"
    finally:
        db.close()


def test_the_problem_list_and_detail_do_not_load_the_large_test_data(student):
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        statements, stop = _count_statements(database.engine)
        try:
            profile = db.query(models.StudentProfile).filter(models.StudentProfile.id == student["profile_id"]).one()
            cps.list_problems(db, profile)
            cps.problem_detail(db, profile, "two-sum")
        finally:
            stop()
        selects = [s for s in statements if "FROM coding_problems" in s and s.lstrip().upper().startswith("SELECT")]
        assert selects, "expected the screens to read problems"
        assert not [s for s in selects if "coding_problems.test_cases" in s], "the test data (up to ~100 KB per problem) was loaded for a screen"
    finally:
        db.close()


def test_seeding_is_checked_once_per_database_not_on_every_request(student):
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        statements, stop = _count_statements(database.engine)
        try:
            for _ in range(5):
                cps.ensure_seeded(db)
        finally:
            stop()
        assert statements == []
    finally:
        db.close()


# ------------------------------------------------------------------ Practice and the assessment use the same line
def test_practice_submissions_are_limited_per_student_and_a_busy_runner_is_a_429_not_a_500(student, monkeypatch):
    from routers import student as student_router
    student_router.practice_submit_limiter.reset()
    h = student["headers"]
    questions = client.get("/api/student/practice/questions", params={"category": "CODING"}, headers=h).json()
    qid = questions[0]["id"]
    body = {"question_id": qid, "code": "class Solution:\n    pass\n", "language": "python"}

    def busy(*a, **k):
        raise judge0_service.SandboxBusy("full")
    monkeypatch.setattr(student_sandbox, "run", busy)
    r = client.post("/api/student/practice/submit", headers=h, json=body)
    assert r.status_code == 429 and r.headers.get("Retry-After") and "busy" in r.json()["detail"].lower()
    codes = [client.post("/api/student/practice/submit", headers=h, json=body).status_code for _ in range(14)]
    assert codes[-1] == 429 and "Too many" in client.post("/api/student/practice/submit", headers=h, json=body).json()["detail"]
    student_router.practice_submit_limiter.reset()
