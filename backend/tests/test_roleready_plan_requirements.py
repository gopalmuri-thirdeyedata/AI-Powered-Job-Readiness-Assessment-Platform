"""
Implementation-plan verification for RoleReady: 10 aptitude MCQs, Python-only coding,
zero-rejection progression, hidden-test confidentiality, sandbox failure handling,
idempotent/concurrent submissions, timer expiry, 17-point dossier, sandbox adapter mapping,
no host code execution, and the additive migration.

All sandbox calls are mocked (offline). Live Judge0 / Gemini behaviour is NOT exercised here.
"""
import pathlib
import re
import sqlite3
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from main import app
import models
from services import judge0_service, roleready_service
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (fixtures)

client = TestClient(app)
BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
State = models.RoleReadySessionState


def _fake_sandbox(stdout="ok", status="success"):
    def _exec(language_key, code, stdin=""):
        return {"status": status, "output": stdout, "stdout": stdout, "stderr": "", "compile_output": "",
                "timed_out": False, "execution_time_ms": 12.0, "raw": {}}
    return _exec


@pytest.fixture(autouse=True)
def _reset_limiter():
    roleready_service._run_code_calls.clear()
    roleready_service._run_code_active.clear()
    yield


def _new_session(db_session, setup_test_data, role="Full Stack Engineer"):
    return roleready_service.create_student_session(
        db=db_session, student_profile=setup_test_data["student_profile"], target_role=role, target_company="Stripe")


def _url(session, action):
    return f"/api/roleready/session/{session.session_uuid}/{action}"


def _advance_to_coding(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    assert client.post(_url(session, "start-aptitude"), headers=h).status_code == 200
    assert client.post(_url(session, "submit-aptitude"), headers=h, json={"answers": {}}).status_code == 200
    assert client.post(_url(session, "start-coding"), headers=h).status_code == 200
    db_session.refresh(session)
    return session, h


# ─── REQ-04 / REQ-07: 10 MCQs, secret keys withheld ────────────────────────────

@pytest.mark.parametrize("role", ["Frontend Developer", "Data Analyst", "DevOps Engineer",
                                  "ML Engineer", "Backend Engineer", "Full Stack Engineer"])
def test_every_role_gets_exactly_ten_four_option_questions(db_session, setup_test_data, role):
    session = _new_session(db_session, setup_test_data, role)
    h = setup_test_data["auth_headers"]
    res = client.post(_url(session, "start-aptitude"), headers=h)
    assert res.status_code == 200
    body = res.json()
    assert len(body["questions"]) == 10
    assert [q["id"] for q in body["questions"]] == [str(i) for i in range(1, 11)]
    for q in body["questions"]:
        assert [o["key"] for o in q["options"]] == ["A", "B", "C", "D"]
        assert "correct_key" not in q and "explanation" not in q
    assert "remaining_seconds" in body and "deadline_at" in body


def test_invalid_ai_aptitude_output_falls_back_to_ten(monkeypatch):
    monkeypatch.setattr(roleready_service, "call_gemini", lambda *a, **k: {"questions": [{"id": 1}] * 10})
    client_safe, keys = roleready_service.generate_aptitude_questions({"role_title": "Backend Engineer"}, 10)
    assert len(client_safe) == 10 and len(keys) == 10


# ─── REQ-03: zero-rejection ────────────────────────────────────────────────────

def test_zero_percent_aptitude_unlocks_coding(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(_url(session, "start-aptitude"), headers=h)
    res = client.post(_url(session, "submit-aptitude"), headers=h, json={"answers": {}})
    assert res.status_code == 200
    body = res.json()
    assert body["score"] == 0.0 and body["total_questions"] == 10
    assert body["current_state"] == State.CODING_UNLOCKED


def test_zero_percent_coding_and_empty_interview_complete_session(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox("never-matches"))
    session, h = _advance_to_coding(db_session, setup_test_data)
    res = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": {}})
    assert res.status_code == 200 and res.json()["score"] == 0.0
    assert res.json()["current_state"] == State.INTERVIEW_UNLOCKED
    client.post(_url(session, "start-interview"), headers=h)
    res = client.post(_url(session, "submit-interview"), headers=h, json={"answers": []})
    assert res.status_code == 200
    assert res.json()["current_state"] == State.COMPLETED
    assert res.json()["score"] == 0.0 and res.json()["report_available"] is True


# ─── REQ-06 / REQ-07: Python + Java only, hidden tests private ────────────────────────

def test_coding_payload_is_python_and_java_only_with_one_public_sample_and_no_hidden_leak(db_session, setup_test_data):
    session, h = _advance_to_coding(db_session, setup_test_data)
    problems = client.post(_url(session, "start-coding"), headers=h).json()["problems"]
    assert len(problems) == 2
    for p in problems:
        assert list(p["starter_code"].keys()) == ["python", "java"]
        assert len(p["public_test_cases"]) == 2
        assert "hidden_test_cases" not in p
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="CODING").first()
    for hidden in rnd.server_keys_payload.values():
        assert 3 <= len(hidden["hidden_test_cases"]) <= 4


def test_run_code_rejects_non_python_with_400(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox())
    session, h = _advance_to_coding(db_session, setup_test_data)
    res = client.post(_url(session, "run-code"), headers=h,
                      json={"problem_id": "1", "code": "console.log(1)", "language": "javascript"})
    assert res.status_code == 400


def test_submit_coding_rejects_unsupported_language_and_changes_nothing(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox())
    session, h = _advance_to_coding(db_session, setup_test_data)
    res = client.post(_url(session, "submit-coding"), headers=h,
                      json={"solutions": {"1": {"code": "x", "language": "ruby"}}})
    assert res.status_code == 400
    db_session.refresh(session)
    assert session.current_state == State.CODING_IN_PROGRESS


def test_run_code_never_sends_hidden_expected_output(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox("zzz"))
    session, h = _advance_to_coding(db_session, setup_test_data)
    res = client.post(_url(session, "run-code"), headers=h, json={"problem_id": "1", "code": "print(1)", "language": "python"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["test_results"]) == 2  # the two examples
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="CODING").first()
    hidden_outputs = {t["expected_output"] for v in rnd.server_keys_payload.values() for t in v["hidden_test_cases"]}
    public_output = body["test_results"][0]["expected_output"]
    leaked = hidden_outputs - {public_output}
    assert not any(f'"{o}"' in res.text for o in leaked if len(o) > 6)


# ─── Sandbox failure handling (scenarios 9, 10) ────────────────────────────────

def test_sandbox_down_never_blocks_the_student(db_session, setup_test_data, monkeypatch):
    """
    A single "Run" still reports the outage (503). A final submission no longer fails with it: the code is saved,
    the interview unlocks, and the grading is simply retried later (the round is marked EVAL_FAILED meanwhile).
    """
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox("down", status="service_error"))
    session, h = _advance_to_coding(db_session, setup_test_data)
    run = client.post(_url(session, "run-code"), headers=h, json={"problem_id": "1", "code": "print(1)", "language": "python"})
    assert run.status_code == 503
    solutions = {"1": {"code": "print(1)", "language": "python"}}
    sub = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": solutions})
    assert sub.status_code == 200
    assert sub.json()["status"] == "evaluating" and sub.json()["next_round_unlocked"] is True
    db_session.expire_all()
    db_session.refresh(session)
    assert session.current_state == State.INTERVIEW_UNLOCKED
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="CODING").first()
    assert rnd.status == "EVAL_FAILED"
    assert rnd.submission_payload == solutions, "the student's code must be kept"
    # recovery: sending the same submission again grades it once the sandbox is back
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox("down-recovered"))
    ok = client.post(_url(session, "submit-coding"), headers=h, json={"solutions": solutions})
    assert ok.status_code == 200 and ok.json()["status"] == "success"


def test_run_code_rate_limited_after_five_runs(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox())
    session, h = _advance_to_coding(db_session, setup_test_data)
    payload = {"problem_id": "1", "code": "print(1)", "language": "python"}
    codes = [client.post(_url(session, "run-code"), headers=h, json=payload).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]


# ─── Idempotency, conflicts, gating (scenarios 2, 3, 15, 16, 17) ───────────────

def test_identical_retry_replays_and_new_submission_is_rejected(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(_url(session, "start-aptitude"), headers=h)
    first = client.post(_url(session, "submit-aptitude"), headers=h, json={"answers": {"1": "A"}})
    retry = client.post(_url(session, "submit-aptitude"), headers=h, json={"answers": {"1": "A"}})
    assert retry.status_code == 200 and retry.json()["idempotent_replay"] is True
    assert retry.json()["score"] == first.json()["score"]
    different = client.post(_url(session, "submit-aptitude"), headers=h, json={"answers": {"1": "B", "2": "B"}})
    assert different.status_code == 400
    db_session.expire_all()
    db_session.refresh(session)
    assert session.aptitude_score == first.json()["score"]


def test_losing_concurrent_claim_gets_409(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="APTITUDE").first()
    roleready_service._claim_round(db_session, rnd)
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        roleready_service._claim_round(db_session, rnd)
    assert exc.value.status_code == 409


def test_locked_rounds_reject_submission_with_403(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    assert client.post(_url(session, "submit-coding"), headers=h, json={"solutions": {}}).status_code == 403
    assert client.post(_url(session, "submit-interview"), headers=h, json={"answers": []}).status_code == 403


# ─── Timer expiry (scenario 7) ─────────────────────────────────────────────────

def test_expired_round_is_finalized_by_server_and_unlocks_next(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(_url(session, "start-aptitude"), headers=h)
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="APTITUDE").first()
    rnd.started_at = datetime.utcnow() - timedelta(minutes=rnd.time_limit_minutes + 5)
    db_session.commit()
    res = client.get(f"/api/roleready/session/{session.session_uuid}", headers=h)
    assert res.status_code == 200
    assert res.json()["current_state"] == State.CODING_UNLOCKED
    assert res.json()["aptitude_score"] == 0.0


def test_submission_to_expired_round_is_rejected_with_400(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(_url(session, "start-aptitude"), headers=h)
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="APTITUDE").first()
    rnd.started_at = datetime.utcnow() - timedelta(minutes=rnd.time_limit_minutes + 5)
    db_session.commit()
    res = client.post(_url(session, "submit-aptitude"), headers=h, json={"answers": {"1": "A"}})
    assert res.status_code == 400
    assert "already been recorded" in res.json()["detail"] or "Round completed" in res.json()["detail"]


def test_active_round_not_finalized_before_deadline(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(_url(session, "start-aptitude"), headers=h)
    res = client.get(f"/api/roleready/session/{session.session_uuid}", headers=h)
    assert res.json()["current_state"] == State.APTITUDE_IN_PROGRESS


# ─── REQ-10: 17-point dossier, dual metric independence ────────────────────────

DOSSIER_KEYS = {
    "student_name", "company_name", "target_role", "jd_summary", "overall_readiness_score", "readiness_tier",
    "aptitude_score", "coding_score", "interview_score", "resume_to_jd_match_score", "demonstrated_strengths",
    "areas_for_improvement", "skill_gap_analysis", "technical_feedback", "communication_feedback",
    "personalized_recommendations", "suggested_learning_roadmap",
}


def test_completed_session_report_contains_full_dossier(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox("0 1"))
    session, h = _advance_to_coding(db_session, setup_test_data)
    client.post(_url(session, "submit-coding"), headers=h, json={"solutions": {}})
    client.post(_url(session, "start-interview"), headers=h)
    client.post(_url(session, "submit-interview"), headers=h, json={"answers": [{"question_id": 1, "response": "x"}]})
    report = client.get(_url(session, "report"), headers=h).json()
    assert DOSSIER_KEYS <= set(report["final_report"].keys())
    assert report["final_report"]["student_name"] == "Jordan Lee"


@pytest.mark.parametrize("score,tier", [(95, "Exceptional Placement Ready"), (90, "Exceptional Placement Ready"),
                                        (89.9, "Direct Role Ready"), (75, "Direct Role Ready"),
                                        (74.9, "Foundation Strong"), (60, "Foundation Strong"),
                                        (59.9, "Building Foundation"), (0, "Building Foundation")])
def test_readiness_tier_thresholds(score, tier):
    assert roleready_service.readiness_tier(score) == tier


def test_resume_match_is_independent_of_assessment_scores(db_session, setup_test_data):
    session = _new_session(db_session, setup_test_data)
    session.extracted_jd_data = {"required_skills": ["Python", "Kubernetes", "Go", "Rust", "Terraform"]}
    session.resume_snapshot = {"skills": ["Python", "Kubernetes"]}
    session.resume_raw_text = None
    low = roleready_service.compute_resume_jd_match(session)
    session.aptitude_score, session.coding_score, session.interview_score = 100.0, 100.0, 100.0
    assert roleready_service.compute_resume_jd_match(session) == low == 40.0
    db_session.rollback()


# ─── Judge0 adapter mapping (mocked HTTP) ──────────────────────────────────────

class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code, self.text = body, status, str(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(response=self)


def _judge0(monkeypatch, body, status=200):
    sent = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.update(url=url, json=json, timeout=timeout)
        return _Resp(body, status)
    monkeypatch.setattr(judge0_service.requests, "post", fake_post)
    return sent


def test_adapter_accepted_returns_stdout_and_sends_limits(monkeypatch):
    sent = _judge0(monkeypatch, {"stdout": "15\n", "status": {"id": 3, "description": "Accepted"}, "time": "0.042"})
    res = judge0_service.execute_code("python", "print(15)", "")
    assert res["status"] == "success" and res["stdout"] == "15\n" and res["execution_time_ms"] == 42.0
    assert sent["json"]["cpu_time_limit"] == 5 and sent["json"]["wall_time_limit"] == 10
    assert sent["json"]["memory_limit"] == 128000 and sent["json"]["language_id"] == 71


def test_adapter_time_limit_is_reported_as_timeout(monkeypatch):
    _judge0(monkeypatch, {"status": {"id": 5, "description": "Time Limit Exceeded"}})
    res = judge0_service.execute_code("python", "while True: pass")
    assert res["timed_out"] is True and res["status"] == "failed" and "Timed Out (5.0s)" in res["output"]


def test_adapter_compile_and_runtime_errors_are_candidate_errors(monkeypatch):
    _judge0(monkeypatch, {"status": {"id": 11, "description": "Runtime Error"}, "stderr": "Traceback"})
    assert judge0_service.execute_code("python", "1/0")["status"] == "failed"


def test_adapter_internal_error_and_http_failure_are_service_errors(monkeypatch):
    monkeypatch.setattr(judge0_service, "_sleep", lambda *_: None)
    _judge0(monkeypatch, {"status": {"id": 13, "description": "Internal Error"}})
    assert judge0_service.execute_code("python", "x")["status"] == "service_error"
    _judge0(monkeypatch, {}, status=503)
    assert judge0_service.execute_code("python", "x")["status"] == "service_error"

    def boom(*a, **k):
        raise ConnectionError("refused")
    monkeypatch.setattr(judge0_service.requests, "post", boom)
    assert judge0_service.execute_code("python", "x")["status"] == "service_error"


def test_adapter_clips_output_and_rejects_oversized_source(monkeypatch):
    _judge0(monkeypatch, {"stdout": "a" * 50_000, "status": {"id": 3, "description": "Accepted"}})
    assert len(judge0_service.execute_code("python", "x")["stdout"]) == 10 * 1024
    res = judge0_service.execute_code("python", "a" * (64 * 1024 + 1))
    assert res["status"] == "error"


def test_adapter_honours_configurable_judge0_url(monkeypatch):
    monkeypatch.setenv("JUDGE0_API_URL", "http://judge0.internal:2358/submissions")
    sent = _judge0(monkeypatch, {"stdout": "", "status": {"id": 3, "description": "Accepted"}})
    judge0_service.execute_code("python", "x")
    assert sent["url"].startswith("http://judge0.internal:2358/submissions")


# ─── REQ-08: no host execution of untrusted code ───────────────────────────────

def test_backend_never_executes_code_on_host():
    pattern = re.compile(r"\b(exec|eval)\(|\bsubprocess\b|os\.system|os\.popen|\bcompile\(")
    offenders = []
    for path in BACKEND_DIR.rglob("*.py"):
        rel = path.relative_to(BACKEND_DIR)
        if rel.parts[0] in ("venv", "tests", "__pycache__") or path.name.startswith("migrate_"):
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if pattern.search(line) and not line.lstrip().startswith("#"):
                offenders.append(f"{rel}:{n}")
    assert offenders == []


# ─── Practice workspace is Python only ─────────────────────────────────────────

def test_practice_submission_rejects_non_python(db_session, setup_test_data):
    from services.practice_service import evaluate_practice_submission
    question = db_session.query(models.StudentPracticeQuestion).filter_by(category="CODING").first()
    if question is None:
        pytest.skip("No seeded coding practice question in this database")
    with pytest.raises(ValueError, match="Only Python"):
        evaluate_practice_submission(profile=setup_test_data["student_profile"], question_id=question.id,
                                     code="console.log(1)", language="javascript", selected_option=None, db=db_session)


# ─── Additive migration (REQ-16) ───────────────────────────────────────────────

def test_additive_migration_is_idempotent_and_preserves_rows(tmp_path):
    import migrate_roleready_schema as mig
    db_file = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE roleready_sessions (id INTEGER PRIMARY KEY, session_uuid TEXT)")
    conn.execute("INSERT INTO roleready_sessions (session_uuid) VALUES ('legacy-1')")
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_file}")
    assert mig.apply_additive_columns(engine) == ["roleready_sessions.resume_raw_text"]
    assert mig.apply_additive_columns(engine) == []  # re-run is a no-op
    with engine.connect() as c:
        row = c.execute(text("SELECT session_uuid, resume_raw_text FROM roleready_sessions")).fetchone()
    assert tuple(row) == ("legacy-1", None)


# ─── REQ-05: every fallback coding problem is Medium, Python+Java starters, 1 public + 3-4 hidden ──

@pytest.mark.parametrize("role", ["Frontend Developer", "Data Analyst", "DevOps Engineer",
                                  "ML Engineer", "Backend Engineer", "Full Stack Engineer"])
def test_fallback_coding_problems_are_medium_python_and_java_only(role):
    problems, keys = roleready_service.generate_coding_problems({"role_title": role, "required_skills": ["x"]}, 2)
    assert len(problems) == 2
    for p in problems:
        assert p["difficulty"] == "Medium"
        assert list(p["starter_code"]) == ["python", "java"]
        assert len(p["public_test_cases"]) == 2
        assert 3 <= len(keys[p["id"]]["hidden_test_cases"]) <= 4


# ─── Interview scoring behaviour (plan §6 scenarios 8 and 14) ──────────────────

def _complete_to_interview(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _fake_sandbox("0 1"))
    session, h = _advance_to_coding(db_session, setup_test_data)
    client.post(_url(session, "submit-coding"), headers=h, json={"solutions": {}})
    client.post(_url(session, "start-interview"), headers=h)
    return session, h


def _interview_eval(db_session, session):
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="INTERVIEW").first()
    return rnd.evaluation_payload


def test_ai_failure_still_completes_with_fallback_dossier_and_flags_source(db_session, setup_test_data, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Gemini down")
    monkeypatch.setattr(roleready_service, "call_gemini", boom)
    session, h = _complete_to_interview(db_session, setup_test_data, monkeypatch)
    res = client.post(_url(session, "submit-interview"), headers=h,
                      json={"answers": [{"question_id": 1, "response": "I led a migration..."}]})
    assert res.status_code == 200 and res.json()["current_state"] == State.COMPLETED
    assert DOSSIER_KEYS <= set(res.json()["final_report"])
    db_session.expire_all()
    assert _interview_eval(db_session, session)["evaluation_source"] == "fallback_default"


def test_ai_score_is_used_and_clamped_when_available(db_session, setup_test_data, monkeypatch):
    monkeypatch.setattr(roleready_service, "call_gemini", lambda *a, **k: {"score": 140, "summary": "great"})
    session, h = _complete_to_interview(db_session, setup_test_data, monkeypatch)
    res = client.post(_url(session, "submit-interview"), headers=h, json={"answers": [{"question_id": 1, "response": "x"}]})
    assert res.json()["score"] == 100.0
    db_session.expire_all()
    assert _interview_eval(db_session, session)["evaluation_source"] == "ai"


def test_empty_interview_never_calls_ai_and_scores_zero(db_session, setup_test_data, monkeypatch):
    def must_not_call(*a, **k):
        raise AssertionError("AI must not be called for an empty interview")
    monkeypatch.setattr(roleready_service, "call_gemini", must_not_call)
    session, h = _complete_to_interview(db_session, setup_test_data, monkeypatch)
    res = client.post(_url(session, "submit-interview"), headers=h, json={"answers": []})
    assert res.json()["score"] == 0.0
    db_session.expire_all()
    assert _interview_eval(db_session, session)["evaluation_source"] == "no_answers"


def test_mysql_schema_and_migration_use_mediumtext_for_resume_text():
    """MySQL TEXT caps at 64 KB; extracted resume text from a 10 MB upload can exceed it (static DDL check, no live MySQL)."""
    from sqlalchemy.dialects import mysql, sqlite
    from sqlalchemy.schema import CreateTable
    import migrate_roleready_schema as mig
    table = models.RoleReadySession.__table__
    assert "resume_raw_text MEDIUMTEXT" in str(CreateTable(table).compile(dialect=mysql.dialect()))
    assert "resume_raw_text TEXT" in str(CreateTable(table).compile(dialect=sqlite.dialect()))
    (name, sqlite_ddl, mysql_ddl), = mig.ADDITIVE_COLUMNS["roleready_sessions"]
    assert (name, sqlite_ddl, mysql_ddl) == ("resume_raw_text", "TEXT NULL", "MEDIUMTEXT NULL")


def test_adapter_polls_a_queued_job_until_it_finishes(monkeypatch):
    monkeypatch.setattr(judge0_service, "_sleep", lambda *_: None)
    _judge0(monkeypatch, {"token": "abc"}, status=201)
    polls = []

    def fake_get(url, headers=None, timeout=None):
        polls.append(url)
        if len(polls) < 3:
            return _Resp({"status": {"id": 1, "description": "In Queue"}})
        return _Resp({"stdout": "7\n", "status": {"id": 3, "description": "Accepted"}, "time": "0.01"})
    monkeypatch.setattr(judge0_service.requests, "get", fake_get)
    res = judge0_service.execute_code("python", "print(7)")
    assert res["status"] == "success" and res["stdout"] == "7\n"
    assert len(polls) == 3 and "/abc" in polls[0]


def test_adapter_retries_submit_on_rate_limit_then_succeeds(monkeypatch):
    monkeypatch.setattr(judge0_service, "_sleep", lambda *_: None)
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(url)
        if len(calls) == 1:
            return _Resp({}, status=429)
        return _Resp({"stdout": "ok", "status": {"id": 3, "description": "Accepted"}})
    monkeypatch.setattr(judge0_service.requests, "post", fake_post)
    res = judge0_service.execute_code("python", "print('ok')")
    assert res["status"] == "success" and len(calls) == 2


def test_adapter_gives_up_with_service_error_when_queue_never_finishes(monkeypatch):
    monkeypatch.setattr(judge0_service, "_sleep", lambda *_: None)
    monkeypatch.setattr(judge0_service, "RESULT_DEADLINE_SECONDS", 0.05)
    _judge0(monkeypatch, {"token": "slow"}, status=201)
    monkeypatch.setattr(judge0_service.requests, "get", lambda *a, **k: _Resp({"status": {"id": 1, "description": "In Queue"}}))
    res = judge0_service.execute_code("python", "print(1)")
    assert res["status"] == "service_error"


def test_adapter_sends_auth_token_when_configured(monkeypatch):
    monkeypatch.setenv("JUDGE0_AUTH_TOKEN", "secret")
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(headers or {})
        return _Resp({"stdout": "1", "status": {"id": 3, "description": "Accepted"}})
    monkeypatch.setattr(judge0_service.requests, "post", fake_post)
    judge0_service.execute_code("python", "print(1)")
    assert seen.get("X-Auth-Token") == "secret"
