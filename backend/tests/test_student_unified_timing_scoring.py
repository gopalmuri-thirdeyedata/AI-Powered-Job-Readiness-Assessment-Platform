"""
Student Platform: canonical timing (20 / 20 / 20 minutes, 60-minute overall deadline) and equal-weight scoring.

Controlled clock: every timing decision reads services.assessment_clock.now(), replaced here by FakeClock, so nothing
sleeps and nothing depends on the machine's time. Sandbox and AI evaluators are MOCKED; these tests prove the backend's
lifecycle, enforcement and arithmetic, not live Judge0 / Gemini behaviour.
"""
import concurrent.futures
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import database
import models
from main import app
from services import assessment_clock, assessment_engine, assessment_policy as policy, judge0_service, roleready_service as rs
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (fixtures)

client = TestClient(app)
State = models.RoleReadySessionState
T0 = datetime(2026, 3, 2, 9, 0, 0, tzinfo=timezone.utc)


class FakeClock:
    def __init__(self, start=T0):
        self.current = start

    def now(self):
        return self.current

    def advance(self, seconds):
        self.current = self.current + timedelta(seconds=seconds)
        return self.current


@pytest.fixture
def clk(monkeypatch):
    c = FakeClock()
    monkeypatch.setattr(assessment_clock, "now", c.now)
    return c


@pytest.fixture(autouse=True)
def _clean_limiter():
    rs._run_code_calls.clear()
    rs._run_code_active.clear()
    yield


def _sandbox(stdout="ok"):
    def _exec(language_key, code, stdin=""):
        return {"status": "success", "output": stdout, "stdout": stdout, "stderr": "", "compile_output": "",
                "timed_out": False, "execution_time_ms": 3.0, "raw": {}}
    return _exec


def new_session(db, data, role="Full Stack Engineer"):
    return rs.create_student_session(db=db, student_profile=data["student_profile"], target_role=role, target_company="Acme")


def url(session, action):
    return f"/api/roleready/session/{session.session_uuid}/{action}"


def correct_answers(db, session, count=None):
    rnd = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="APTITUDE").first()
    items = [(qid, info["correct_key"]) for qid, info in rnd.server_keys_payload.items()]
    return dict(items[:count] if count is not None else items)


def reload(db, session):
    db.expire_all()
    return db.query(models.RoleReadySession).filter_by(id=session.id).first()


def rounds(db, session):
    db.expire_all()
    return {r.round_type: r for r in db.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id)}


def aware(dt):
    return assessment_clock.aware(dt)


# ------------------------------------------------------------------------------ limits
def test_every_new_student_round_has_its_canonical_limit_20_20_10_minutes(db_session, setup_test_data):
    s = new_session(db_session, setup_test_data)
    assert {r.round_type: r.time_limit_minutes for r in rounds(db_session, s).values()} == {"APTITUDE": 20, "CODING": 20, "INTERVIEW": 10}


def test_both_workflows_import_the_same_canonical_constants():
    from services import assessment_flow_service as flow
    assert (flow.SECTION_MINUTES, flow.OVERALL_MINUTES, flow.TRANSIT_WINDOW_SECONDS) == (20, 60, 10)
    assert rs.policy is flow.policy is policy
    assert rs.EXPIRY_GRACE_SECONDS == policy.TRANSIT_WINDOW_SECONDS == flow.TRANSIT_WINDOW_SECONDS


# ------------------------------------------------------------------------------ the timer starts only on explicit start
def test_nothing_starts_the_clock_until_the_explicit_start(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    clk.advance(3600)                                                   # an hour of reading instructions
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()
    assert status["current_state"] == State.NOT_STARTED and status["overall_deadline_at"] is None
    row = reload(db_session, s)
    assert row.overall_deadline_at is None and row.started_at is None
    assert all(r.started_at is None for r in rounds(db_session, s).values())


def test_explicit_start_establishes_one_authoritative_60_minute_deadline(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    body = client.post(url(s, "start-aptitude"), headers=h).json()
    row = reload(db_session, s)
    assert aware(row.overall_deadline_at) == T0 + timedelta(minutes=60)
    assert aware(row.current_section_deadline_at) == T0 + timedelta(minutes=20)
    assert body["remaining_seconds"] == 1200 and body["overall_remaining_seconds"] == 3600 and body["time_limit_minutes"] == 20


def test_repeated_start_requests_never_reset_the_deadline(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    first = aware(reload(db_session, s).overall_deadline_at)
    clk.advance(420)
    again = client.post(url(s, "start-aptitude"), headers=h).json()
    assert aware(reload(db_session, s).overall_deadline_at) == first
    assert again["remaining_seconds"] == 780 and again["overall_remaining_seconds"] == 3180


def test_concurrent_start_requests_create_one_deadline(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(lambda _: client.post(url(s, "start-aptitude"), headers=h).status_code, range(8)))
    assert codes == [200] * 8
    row = reload(db_session, s)
    assert aware(row.overall_deadline_at) == T0 + timedelta(minutes=60) and row.current_state == State.APTITUDE_IN_PROGRESS


def test_page_refresh_does_not_reset_timers(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(600)
    for _ in range(3):                                                   # a refresh = status + start (re-hydrate)
        client.get(f"/api/roleready/session/{s.session_uuid}", headers=h)
    body = client.post(url(s, "start-aptitude"), headers=h).json()
    assert body["remaining_seconds"] == 600 and body["overall_remaining_seconds"] == 3000


def test_section_transitions_never_reset_the_overall_deadline(db_session, setup_test_data, clk, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _sandbox())
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    overall = aware(reload(db_session, s).overall_deadline_at)
    clk.advance(300)
    assert client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}}).status_code == 200
    clk.advance(60)                                                      # coding unlocked at +5m, started at +6m
    coding = client.post(url(s, "start-coding"), headers=h).json()
    assert coding["remaining_seconds"] == 1200 and aware(reload(db_session, s).overall_deadline_at) == overall
    clk.advance(44 * 60)                                                 # +50m
    assert client.post(url(s, "submit-coding"), headers=h, json={"solutions": {}}).status_code == 200
    clk.advance(60)                                                      # interview starts at +51m: only 9 of its 10 minutes fit in the 60
    interview = client.post(url(s, "start-interview"), headers=h).json()
    assert interview["remaining_seconds"] == 9 * 60 and interview["overall_remaining_seconds"] == 9 * 60      # capped by the overall deadline
    assert aware(reload(db_session, s).overall_deadline_at) == overall


def test_time_spent_is_measured_by_the_server_not_the_browser(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(600)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}, "time_spent_seconds": 1})   # a tampered clock claims 1 second
    assert rounds(db_session, s)["APTITUDE"].time_spent_seconds == 600


# ------------------------------------------------------------------------------ server-enforced deadlines
def test_expired_section_is_closed_from_the_autosaved_draft_and_cannot_be_reopened(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    draft = correct_answers(db_session, s, count=4)
    assert client.put(url(s, "draft"), headers=h, json={"section": "aptitude", "payload": {"answers": draft}}).json()["saved"] is True
    clk.advance(20 * 60 + 11)                                            # past the 20 minutes and the 10-second arrival window
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()
    assert status["current_state"] == State.CODING_UNLOCKED
    assert status["aptitude_score"] == 40.0                              # partial work preserved: 4 of 10
    assert client.post(url(s, "start-aptitude"), headers=h).status_code == 400                  # cannot reopen
    assert client.post(url(s, "submit-aptitude"), headers=h, json={"answers": correct_answers(db_session, s)}).status_code == 400
    assert rounds(db_session, s)["APTITUDE"].score == 40.0


def test_submission_inside_the_arrival_window_is_accepted_and_after_it_is_not(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(20 * 60 + 5)
    ok = client.post(url(s, "submit-aptitude"), headers=h, json={"answers": correct_answers(db_session, s)})
    assert ok.status_code == 200 and ok.json()["score"] == 100.0

    s2 = new_session(db_session, setup_test_data)
    client.post(url(s2, "start-aptitude"), headers=h)
    clk.advance(20 * 60 + 11)
    late = client.post(url(s2, "submit-aptitude"), headers=h, json={"answers": correct_answers(db_session, s2)})
    assert late.status_code == 400
    assert rounds(db_session, s2)["APTITUDE"].score == 0.0               # the late answers were not accepted


def test_run_code_is_rejected_after_the_section_deadline(db_session, setup_test_data, clk, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _sandbox())
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}})
    problems = client.post(url(s, "start-coding"), headers=h).json()["problems"]
    ok = client.post(url(s, "run-code"), headers=h, json={"problem_id": problems[0]["id"], "code": "print(1)", "language": "python"})
    assert ok.status_code == 200
    clk.advance(20 * 60 + 1)
    late = client.post(url(s, "run-code"), headers=h, json={"problem_id": problems[0]["id"], "code": "print(1)", "language": "python"})
    assert late.status_code == 408


def test_coding_section_expiry_scores_the_draft_through_the_sandbox(db_session, setup_test_data, clk, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _sandbox("never-matches"))
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}})
    problems = client.post(url(s, "start-coding"), headers=h).json()["problems"]
    client.put(url(s, "draft"), headers=h, json={"section": "coding", "payload": {"solutions": {str(problems[0]["id"]): {"language": "python", "code": "print(1)"}}}})
    clk.advance(20 * 60 + 11)
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()
    assert status["current_state"] == State.INTERVIEW_UNLOCKED
    assert rounds(db_session, s)["CODING"].evaluation_payload["problems"][0]["language"] == "python"


def test_students_code_in_python_only(db_session, setup_test_data):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}})
    problems = client.post(url(s, "start-coding"), headers=h).json()["problems"]
    pid = problems[0]["id"]
    run = client.post(url(s, "run-code"), headers=h, json={"problem_id": pid, "code": "class Main {}", "language": "java"})
    assert run.status_code == 400 and "Python" in run.json()["detail"]
    sub = client.post(url(s, "submit-coding"), headers=h, json={"solutions": {str(pid): {"language": "java", "code": "class Main {}"}}})
    assert sub.status_code == 400 and "Python" in sub.json()["detail"]


def test_an_old_java_draft_does_not_keep_an_expired_coding_round_open(db_session, setup_test_data, clk, monkeypatch):
    """A draft saved in a language that is no longer accepted must not trap the student: the timer still closes the round."""
    monkeypatch.setattr(judge0_service, "execute_code", _sandbox("never-matches"))
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}})
    problems = client.post(url(s, "start-coding"), headers=h).json()["problems"]
    rnd = rounds(db_session, s)["CODING"]
    rnd.submission_payload = {"_draft": {"solutions": {str(problems[0]["id"]): {"language": "java", "code": "class Main {}"}}}}
    db_session.commit()
    clk.advance(20 * 60 + 11)
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h)
    assert status.status_code == 200 and status.json()["current_state"] == State.INTERVIEW_UNLOCKED


def test_overall_expiry_times_out_the_attempt_and_keeps_partial_results(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(600)
    assert client.post(url(s, "submit-aptitude"), headers=h, json={"answers": correct_answers(db_session, s)}).json()["score"] == 100.0
    clk.advance(60 * 60)                                                 # the candidate never starts coding; 60 minutes pass
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()
    assert status["current_state"] == State.TIMED_OUT and status["is_completed"] is True and status["is_timed_out"] is True
    assert status["overall_readiness_score"] is None                     # incomplete => no overall, never a zero
    report = client.get(f"/api/roleready/session/{s.session_uuid}/report", headers=h).json()
    assert report["overall_readiness_score"] is None and report["aptitude_score"] == 100.0
    assert report["coding_score"] is None and report["interview_score"] is None and report["report_status"] == "INCOMPLETE"
    assert {k: r.status for k, r in rounds(db_session, s).items()} == {"APTITUDE": "EVALUATED", "CODING": "UNATTEMPTED", "INTERVIEW": "UNATTEMPTED"}


def test_overall_expiry_mid_section_scores_the_draft_and_marks_later_sections_unattempted(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(55 * 60)                                                 # the candidate dawdles: the 20-minute section ended at 20m
    # (the aptitude section expired at +20m; the next request closes it and unlocks coding with 5 minutes left overall)
    assert client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()["current_state"] == State.CODING_UNLOCKED
    clk.advance(10 * 60)                                                 # +65m: the overall deadline has now passed as well
    row = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()
    assert row["current_state"] == State.TIMED_OUT and row["overall_readiness_score"] is None
    assert reload(db_session, s).final_report_data["completion_status"] == "TIMED_OUT"


def test_timed_out_attempt_is_closed_for_good(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(61 * 60)
    client.get(f"/api/roleready/session/{s.session_uuid}", headers=h)
    for action, body in (("start-coding", None), ("start-interview", None), ("submit-coding", {"solutions": {}}),
                         ("submit-interview", {"answers": []}), ("voice-init", None)):
        r = client.post(url(s, action), headers=h, json=body) if body is not None else client.post(url(s, action), headers=h)
        assert r.status_code in (400, 403, 409), (action, r.status_code)
    assert client.put(url(s, "draft"), headers=h, json={"section": "aptitude", "payload": {}}).status_code in (403, 409)
    assert reload(db_session, s).current_state == State.TIMED_OUT


def test_history_marks_timed_out_attempts_closed_and_never_reopens_them(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(61 * 60)
    client.get(f"/api/roleready/session/{s.session_uuid}", headers=h)
    hist = client.get("/api/roleready/student/assessments", headers=h).json()
    rec = next(a for a in hist["assessments"] if a["session_uuid"] == s.session_uuid)
    assert rec["current_state"] == State.TIMED_OUT and rec["is_closed"] is True and rec["overall_readiness_score"] is None
    assert rec["continue_url"] is None and rec["report_url"].endswith("/report")
    assert (hist["active_session"] or {}).get("session_uuid") != s.session_uuid


# ------------------------------------------------------------------------------ drafts
def test_draft_endpoint_validates_section_and_stops_at_the_deadline(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    assert client.put(url(s, "draft"), headers=h, json={"section": "coding", "payload": {}}).status_code == 403
    assert client.put(url(s, "draft"), headers=h, json={"section": "nonsense", "payload": {}}).status_code == 400
    saved = client.put(url(s, "draft"), headers=h, json={"section": "aptitude", "payload": {"answers": {"1": "A", "zzz": "B", "2": "Q"}}})
    assert saved.status_code == 200
    assert rounds(db_session, s)["APTITUDE"].submission_payload["_draft"] == {"answers": {"1": "A"}}   # unknown ids / choices dropped
    clk.advance(20 * 60 + 1)
    assert client.put(url(s, "draft"), headers=h, json={"section": "aptitude", "payload": {"answers": {"1": "B"}}}).status_code == 408


# ------------------------------------------------------------------------------ scoring
def _finish(db, data, monkeypatch, aptitude_correct, coding_score, interview_score):
    monkeypatch.setattr(assessment_engine, "evaluate_coding", lambda *a, **k: {
        "score": coding_score, "problems": [{"problem_id": "1", "title": "t", "language": "python", "passed_tests": 1, "total_tests": 2, "score": coding_score}],
        "total_hidden_tests": 2, "passed_hidden_tests": 1})
    monkeypatch.setattr(rs, "evaluate_five_technical_questions", lambda **k: {
        "score": interview_score, "summary": "ok", "evaluation_source": "ai", "question_evaluations": []})
    s = new_session(db, data)
    h = data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": correct_answers(db, s, count=aptitude_correct)})
    client.post(url(s, "start-coding"), headers=h)
    client.post(url(s, "submit-coding"), headers=h, json={"solutions": {}})
    client.post(url(s, "start-interview"), headers=h)
    done = client.post(url(s, "submit-interview"), headers=h, json={"answers": [{"question_id": 1, "response": "x"}]})
    assert done.status_code == 200
    return s, done.json(), h


def test_student_overall_uses_the_equal_weight_formula(db_session, setup_test_data, clk, monkeypatch):
    """80% aptitude, 60% coding, 90% interview -> 76.67% (the old 25/40/35 weighting would give 74.5)."""
    s, done, h = _finish(db_session, setup_test_data, monkeypatch, aptitude_correct=8, coding_score=60.0, interview_score=90.0)
    assert done["overall_readiness_score"] == 76.67 and done["current_state"] == State.COMPLETED
    row = reload(db_session, s)
    assert (row.aptitude_score, row.coding_score, row.interview_score, row.overall_readiness_score) == (80.0, 60.0, 90.0, 76.67)
    report = client.get(f"/api/roleready/session/{s.session_uuid}/report", headers=h).json()
    assert report["overall_readiness_score"] == 76.67 and report["scoring_model"] == "equal_v1"
    assert report["final_report"]["overall_readiness_score"] == 76.67 and report["final_report"]["scoring_model"] == "equal_v1"
    hist = client.get("/api/roleready/student/assessments", headers=h).json()
    assert next(a for a in hist["assessments"] if a["session_uuid"] == s.session_uuid)["overall_readiness_score"] == 76.67
    assert 76.67 != round(80 * 0.25 + 60 * 0.40 + 90 * 0.35, 2)


def test_in_progress_attempt_reports_no_overall_score(db_session, setup_test_data, clk):
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    client.post(url(s, "submit-aptitude"), headers=h, json={"answers": correct_answers(db_session, s)})
    assert client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()["overall_readiness_score"] is None
    rec = next(a for a in client.get("/api/roleready/student/assessments", headers=h).json()["assessments"] if a["session_uuid"] == s.session_uuid)
    assert rec["overall_readiness_score"] is None


def test_zero_scores_are_a_real_overall_zero_not_a_missing_one(db_session, setup_test_data, clk, monkeypatch):
    s, done, _ = _finish(db_session, setup_test_data, monkeypatch, aptitude_correct=0, coding_score=0.0, interview_score=0.0)
    assert done["overall_readiness_score"] == 0.0 and reload(db_session, s).current_state == State.COMPLETED


# ------------------------------------------------------------------------------ existing data is never silently rewritten
def test_legacy_completed_result_keeps_its_persisted_score_and_is_labelled(db_session, setup_test_data, clk):
    legacy_uuid = f"legacy-weighted-{uuid.uuid4().hex[:8]}"
    legacy = models.RoleReadySession(
        session_uuid=legacy_uuid, workflow_type="SELF_ASSESSMENT", student_profile_id=setup_test_data["student_profile"].id,
        organization_id=setup_test_data["student_profile"].organization_id, target_role="Dev", current_state="COMPLETED",
        aptitude_score=80.0, coding_score=60.0, interview_score=90.0, overall_readiness_score=74.5,
        final_report_data={"completion_status": "COMPLETED"})
    db_session.add(legacy)
    db_session.commit()
    h = setup_test_data["auth_headers"]
    rec = next(a for a in client.get("/api/roleready/student/assessments", headers=h).json()["assessments"] if a["session_uuid"] == legacy_uuid)
    assert rec["overall_readiness_score"] == 74.5 and rec["scoring_model"] == policy.LEGACY_SCORING_MODEL
    report = client.get(f"/api/roleready/session/{legacy_uuid}/report", headers=h).json()
    assert report["overall_readiness_score"] == 74.5 and report["scoring_model"] == policy.LEGACY_SCORING_MODEL
    assert reload(db_session, legacy).overall_readiness_score == 74.5


def test_in_flight_legacy_session_is_not_given_a_new_deadline(db_session, setup_test_data, clk):
    """A session that was already running before the 60-minute limit existed keeps its original rounds and gets no invented deadline."""
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    db_session.expire_all()
    row = db_session.query(models.RoleReadySession).filter_by(id=s.id).first()
    r = {x.round_type: x for x in db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=s.id)}
    row.current_state = State.CODING_IN_PROGRESS
    row.started_at = T0 - timedelta(minutes=80)
    r["APTITUDE"].status = "EVALUATED"
    r["CODING"].status = "IN_PROGRESS"
    r["CODING"].started_at = T0 - timedelta(minutes=25)
    r["CODING"].time_limit_minutes = 45                                  # created under the old 45-minute rule
    db_session.commit()
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h).json()
    assert status["current_state"] == State.CODING_IN_PROGRESS and status["overall_deadline_at"] is None
    assert reload(db_session, s).overall_deadline_at is None


def test_an_expired_coding_section_is_closed_automatically_without_a_server_error(db_session, setup_test_data, clk, monkeypatch):
    """The auto-close of coding used to call submit_coding_round(_auto=True), a parameter it did not accept: a 500 instead of a close."""
    monkeypatch.setattr(judge0_service, "execute_code", _sandbox())
    s = new_session(db_session, setup_test_data)
    h = setup_test_data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(300)
    assert client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}}).status_code == 200
    clk.advance(60)
    assert client.post(url(s, "start-coding"), headers=h).status_code == 200
    clk.advance(20 * 60 + 11)                                            # past the 20 minutes and the 10-second arrival window
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h)
    assert status.status_code == 200
    assert status.json()["current_state"] == State.INTERVIEW_UNLOCKED
    assert rounds(db_session, s)["CODING"].status == "EVALUATED"          # closed from the (empty) draft; never left half open
