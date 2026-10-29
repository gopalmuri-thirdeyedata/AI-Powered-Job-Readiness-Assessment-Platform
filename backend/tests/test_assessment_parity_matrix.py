"""
Release-review evidence: the Student Platform and the Admin Recruitment shared-link workflow behave identically where the
product says they must.

Each test drives the SAME blueprint content, answers, code and interview evaluation through BOTH lifecycles (student JWT
endpoints, public capability endpoints) on ONE controlled clock, then compares:
  * section scores and the overall score,
  * the scoring model recorded,
  * section deadlines and the 60-minute overall deadline,
  * incomplete attempts (no reported overall, unattempted sections stay null),
  * what each workflow's report / roster / history actually shows versus the persisted row.

Mocked here (and therefore NOT proof of a live integration): the code sandbox (a real local Python subprocess, so the hidden
tests really execute), the AI interview evaluator and the voice service. See the release report for the live checks.
"""
from datetime import datetime, timedelta, timezone

import pytest

import models
from services import assessment_clock, assessment_engine as engine, assessment_flow_service as flow, assessment_policy as policy
from services import gemini_mock_fixtures, interview_evaluation, jd_blueprint_service, roleready_service as rs
from tests import recruitment_helpers as h
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (student fixtures)

client = h.client
T0 = datetime(2026, 3, 2, 9, 0, 0, tzinfo=timezone.utc)
GOOD = h.GOOD_SOLUTIONS
WRONG = {"C1": {"language": "python", "code": h.program("def solve(a, b):\n    return -1\n")},
         "C2": {"language": "python", "code": h.program("def solve(s):\n    return s\n")}}
HALF = {"C1": GOOD["C1"], "C2": WRONG["C2"]}
INTERVIEW = [{"question_id": f"I{i}", "response": f"answer {i}"} for i in range(1, 6)]

# name -> (aptitude answers answered correctly, coding solutions, interview evaluator score)
SCENARIOS = {
    "perfect": (None, GOOD, 100.0),     # every aptitude answer correct
    "mixed": (9, HALF, 90.0),           # 9 of 15 = 60 %, one of two problems solved
    "all_wrong_but_complete": (0, WRONG, 0.0),   # a real, completed zero: the overall is 0.0, not null
}


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def env(db):
    mp = pytest.MonkeyPatch()
    admin = h.make_admin(db)
    job = h.create_published_job(admin, mp)
    yield {"admin": admin, "job": job, "token": job["share_token"]}
    mp.undo()
    h.cleanup_orgs(db, [admin["org"].id])


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    rs._run_code_calls.clear()
    rs._run_code_active.clear()
    yield
    h.reset_public_limiters()


@pytest.fixture
def clk(monkeypatch):
    fake = h.FakeClock(T0)
    monkeypatch.setattr(assessment_clock, "now", fake.now)
    return fake


def _evaluator(score):
    def evaluate(questions, answers, role, jd_summary="", resume_summary="", transcript=None, call_gemini_fn=None):
        return {"score": score, "summary": "ok", "evaluation_source": "ai", "question_evaluations": []}
    return evaluate


def _pin_interview_score(monkeypatch, score):
    monkeypatch.setattr(interview_evaluation, "evaluate_five_technical_questions", _evaluator(score))
    monkeypatch.setattr(rs, "evaluate_five_technical_questions", _evaluator(score))


def _blueprint():
    return jd_blueprint_service.validate_blueprint(gemini_mock_fixtures.sample_blueprint()).model_dump()


def _student_session(db, data, blueprint):
    """A student attempt whose rounds hold the SAME adapted blueprint content a recruitment attempt serves."""
    session = rs.create_student_session(db=db, student_profile=data["student_profile"], target_role="Backend Engineer", target_company="Acme")
    payloads = engine.adapt_blueprint(blueprint)
    for r in db.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id):
        r.questions_payload, r.server_keys_payload = payloads[r.round_type]
    db.commit()
    return session


def _minutes(_clk, iso):
    """Minutes after the controlled T0 that the server said something happens."""
    return round((datetime.fromisoformat(iso) - T0).total_seconds() / 60, 3)


class Journey:
    """One complete or partial attempt in one workflow, recording every deadline the server reported."""

    def __init__(self):
        self.deadlines = {}          # section -> minutes after T0 the server said it ends
        self.overall_deadline = None
        self.persisted = None        # the RoleReadySession row after the run
        self.shown = {}              # what the workflow's own report surface displays


def _answers(db, session_uuid, count):
    sess = db.query(models.RoleReadySession).filter_by(session_uuid=session_uuid).first()
    rnd = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=sess.id, round_type="APTITUDE").first()
    items = [(qid, info["correct_key"]) for qid, info in rnd.server_keys_payload.items()]
    return dict(items if count is None else items[:count])


def run_student(db, data, clk, blueprint, scenario, stop_after=None):
    apt_correct, coding, _ = scenario
    clk.set(T0)
    sess = _student_session(db, data, blueprint)
    hdr = data["auth_headers"]
    base = f"/api/roleready/session/{sess.session_uuid}"
    j = Journey()
    r = client.post(f"{base}/start-aptitude", headers=hdr)
    assert r.status_code == 200, r.text
    j.deadlines["aptitude"] = _minutes(clk, r.json()["deadline_at"])
    j.overall_deadline = _minutes(clk, r.json()["overall_deadline_at"])
    clk.advance(8 * 60)
    assert client.post(f"{base}/submit-aptitude", headers=hdr, json={"answers": _answers(db, sess.session_uuid, apt_correct)}).status_code == 200
    if stop_after == "aptitude":
        return j, sess
    r = client.post(f"{base}/start-coding", headers=hdr)                                  # started the moment it unlocked
    assert r.status_code == 200, r.text
    j.deadlines["coding"] = _minutes(clk, r.json()["deadline_at"])
    if stop_after == "coding_open":
        return j, sess
    clk.advance(12 * 60)
    assert client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": coding}).status_code == 200, "coding submit"
    r = client.post(f"{base}/start-interview", headers=hdr)
    assert r.status_code == 200, r.text
    j.deadlines["interview"] = _minutes(clk, r.json()["deadline_at"])
    clk.advance(8 * 60)                          # the interview section is 10 minutes
    assert client.post(f"{base}/submit-interview", headers=hdr, json={"answers": INTERVIEW}).status_code == 200
    return j, sess


def run_recruitment(db, env, clk, scenario, stop_after=None):
    apt_correct, coding, _ = scenario
    clk.set(T0)
    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    j = Journey()

    def state():
        r = client.get(h.sess_url(s, "state"), headers=h.sh(s))
        assert r.status_code == 200, r.text
        return r.json()

    st = state()
    j.deadlines["aptitude"] = _minutes(clk, st["section"]["deadline_at"])
    j.overall_deadline = _minutes(clk, st["overall_deadline_at"])
    clk.advance(8 * 60)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": _answers(db, s["session_uuid"], apt_correct)}).status_code == 200
    if stop_after == "aptitude":
        return j, s
    j.deadlines["coding"] = _minutes(clk, state()["section"]["deadline_at"])              # its clock began at the submit
    clk.advance(12 * 60)
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": coding}).status_code == 200, "coding submit"
    j.deadlines["interview"] = _minutes(clk, state()["section"]["deadline_at"])
    clk.advance(8 * 60)                          # the interview section is 10 minutes
    assert client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": INTERVIEW, "transcript": []}).status_code == 200
    return j, s


def _student_surfaces(db, data, sess):
    db.expire_all()
    row = db.query(models.RoleReadySession).filter_by(id=sess.id).first()
    hdr = data["auth_headers"]
    report = client.get(f"/api/roleready/session/{sess.session_uuid}/report", headers=hdr).json()
    history = [i for i in client.get("/api/roleready/student/history", headers=hdr).json()["assessments"] if i["session_uuid"] == sess.session_uuid]
    return row, report, history


def _recruitment_surfaces(db, env, s):
    row = h.session_row(db, s["session_uuid"])
    reg = db.query(models.CandidateRegistration).filter_by(attempt_session_uuid=s["session_uuid"]).first()
    headers = h.auth(env["admin"]["token"])
    dossier = client.get(f"/api/admin/recruitment/candidates/{reg.id}/dossier", headers=headers).json()
    roster = [i for i in client.get(f"/api/admin/recruitment/candidates?search={reg.email}", headers=headers).json()["items"] if i["id"] == reg.id]
    return row, dossier, roster[0]


# ------------------------------------------------------------------------------ complete attempts
@pytest.mark.parametrize("name", list(SCENARIOS))
def test_section_scores_overall_and_model_agree_between_the_workflows(db, env, db_session, setup_test_data, clk, monkeypatch, name):
    scenario = SCENARIOS[name]
    _pin_interview_score(monkeypatch, scenario[2])
    blueprint = _blueprint()

    sj, sess = run_student(db_session, setup_test_data, clk, blueprint, scenario)
    rj, s = run_recruitment(db, env, clk, scenario)
    srow, sreport, shistory = _student_surfaces(db_session, setup_test_data, sess)
    rrow, dossier, roster = _recruitment_surfaces(db, env, s)

    # section scores agree row to row
    assert (srow.aptitude_score, srow.coding_score, srow.interview_score) == (rrow.aptitude_score, rrow.coding_score, rrow.interview_score)
    assert srow.interview_score == scenario[2]
    expected = policy.overall_score(srow.aptitude_score, srow.coding_score, srow.interview_score)
    # overall agrees, and is exactly (A + C + I) / 3 -- not the legacy 25/40/35 weighting
    assert srow.overall_readiness_score == rrow.overall_readiness_score == expected
    assert expected == round((srow.aptitude_score + srow.coding_score + srow.interview_score) / 3, 2)
    legacy = round(srow.aptitude_score * 0.25 + srow.coding_score * 0.40 + srow.interview_score * 0.35, 2)
    if name == "mixed":
        assert expected != legacy                                  # the scenario really distinguishes the two formulas
    # the scoring model recorded is the new one, in both
    assert srow.final_report_data["scoring_model"] == rrow.final_report_data["scoring_model"] == policy.SCORING_MODEL
    assert sreport["scoring_model"] == dossier["report"]["scoring_model"] == policy.SCORING_MODEL

    # every report surface shows the PERSISTED backend numbers
    assert sreport["overall_readiness_score"] == srow.overall_readiness_score
    shown = tuple(policy.display_pct(v) for v in (srow.aptitude_score, srow.coding_score, srow.interview_score))   # two-decimal presentation
    assert (sreport["aptitude_score"], sreport["coding_score"], sreport["interview_score"]) == shown
    assert shistory and shistory[0]["overall_readiness_score"] == srow.overall_readiness_score
    assert shistory[0]["scoring_model"] == policy.SCORING_MODEL
    assert (shistory[0]["aptitude_score"], shistory[0]["coding_score"], shistory[0]["interview_score"]) == shown
    assert dossier["report"]["overall_score"] == roster["overall_score"] == rrow.overall_readiness_score
    for key, column in (("aptitude", rrow.aptitude_score), ("coding", rrow.coding_score), ("interview", rrow.interview_score)):
        assert dossier["report"]["sections"][key]["score"] == policy.display_pct(column)
    assert (roster["aptitude_score"], roster["coding_score"], roster["interview_score"]) == shown


# ------------------------------------------------------------------------------ timers and deadlines
def test_section_and_overall_deadlines_follow_the_same_policy(db, env, db_session, setup_test_data, clk, monkeypatch):
    _pin_interview_score(monkeypatch, 80.0)
    sj, _ = run_student(db_session, setup_test_data, clk, _blueprint(), SCENARIOS["mixed"])
    rj, _ = run_recruitment(db, env, clk, SCENARIOS["mixed"])
    # aptitude starts at 0 -> ends at 20; coding starts at 8 -> 28; the interview (10 minutes) starts at 20 -> 30; overall is 60 from the start
    assert sj.deadlines == rj.deadlines == {"aptitude": 20.0, "coding": 28.0, "interview": 30.0}
    assert sj.overall_deadline == rj.overall_deadline == 60.0
    assert policy.SECTION_MINUTES == 20 and policy.OVERALL_MINUTES == 60


def test_the_overall_deadline_caps_a_late_section_in_both_workflows(db, env, db_session, setup_test_data, clk):
    """Aptitude (20) + Coding (20) + Interview (10) end at the 50-minute mark, inside the 60-minute overall deadline, which never moves."""
    sess = _student_session(db_session, setup_test_data, _blueprint())
    hdr = setup_test_data["auth_headers"]
    base = f"/api/roleready/session/{sess.session_uuid}"
    clk.set(T0)
    assert client.post(f"{base}/start-aptitude", headers=hdr).status_code == 200
    clk.advance(20 * 60)
    assert client.post(f"{base}/submit-aptitude", headers=hdr, json={"answers": {}}).status_code == 200
    client.post(f"{base}/start-coding", headers=hdr)
    clk.advance(20 * 60)
    assert client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": {}}).status_code == 200
    interview = client.post(f"{base}/start-interview", headers=hdr).json()
    assert _minutes(clk, interview["deadline_at"]) == 50.0 and _minutes(clk, interview["overall_deadline_at"]) == 60.0

    clk.set(T0)
    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    clk.advance(20 * 60)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": {}}).status_code == 200
    clk.advance(20 * 60)
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {}}).status_code == 200
    st = client.get(h.sess_url(s, "state"), headers=h.sh(s)).json()
    assert _minutes(clk, st["section"]["deadline_at"]) == 50.0 and _minutes(clk, st["overall_deadline_at"]) == 60.0


# ------------------------------------------------------------------------------ incomplete attempts
def test_incomplete_attempts_report_no_overall_in_either_workflow(db, env, db_session, setup_test_data, clk, monkeypatch):
    _pin_interview_score(monkeypatch, 90.0)
    scenario = SCENARIOS["mixed"]
    # Recruitment opens the next section's clock at the submit, so an equivalent student attempt has opened coding too.
    # (A student who never presses "start coding" has an UNATTEMPTED coding section: covered in test_student_unified_timing_scoring.)
    sj, sess = run_student(db_session, setup_test_data, clk, _blueprint(), scenario, stop_after="coding_open")
    rj, s = run_recruitment(db, env, clk, scenario, stop_after="aptitude")
    clk.set(T0 + timedelta(minutes=61))                                       # the candidate walked away; the 60 minutes are gone

    # lazy finalisation on the next read, exactly as a returning candidate / the admin console would trigger it
    assert client.get(f"/api/roleready/session/{sess.session_uuid}", headers=setup_test_data["auth_headers"]).status_code == 200
    assert client.get(h.sess_url(s, "state"), headers=h.sh(s)).json()["state"] == "TIMED_OUT"
    srow, sreport, shistory = _student_surfaces(db_session, setup_test_data, sess)
    rrow, dossier, roster = _recruitment_surfaces(db, env, s)

    assert srow.current_state == "TIMED_OUT" and rrow.current_state == "TIMED_OUT"
    # reported overall is null on every surface; the NOT NULL column's 0.0 is never what a reader sees
    assert sreport["overall_readiness_score"] is None and shistory[0]["overall_readiness_score"] is None
    assert dossier["report"]["overall_score"] is None and roster["overall_score"] is None and roster["status"] == "TIMED_OUT"
    # the evaluated section is kept; a section that was open but empty is scored from its (empty) draft; the one never reached stays null
    assert srow.aptitude_score == rrow.aptitude_score == 60.0
    assert (sreport["coding_score"], sreport["interview_score"]) == (0.0, None)
    assert (dossier["report"]["sections"]["coding"]["score"], dossier["report"]["sections"]["interview"]["score"]) == (0.0, None)
    assert (roster["coding_score"], roster["interview_score"]) == (0.0, None)
    s_status = {r.round_type: r.status for r in db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=sess.id)}
    r_status = {k: v.status for k, v in flow.get_rounds(db, rrow.id).items()}
    assert s_status == r_status == {"APTITUDE": "EVALUATED", "CODING": "EVALUATED", "INTERVIEW": "UNATTEMPTED"}


def test_an_in_progress_attempt_reports_no_overall_in_either_workflow(db, env, db_session, setup_test_data, clk):
    sj, sess = run_student(db_session, setup_test_data, clk, _blueprint(), SCENARIOS["perfect"], stop_after="aptitude")
    rj, s = run_recruitment(db, env, clk, SCENARIOS["perfect"], stop_after="aptitude")
    _, sreport, _ = _student_surfaces(db_session, setup_test_data, sess)
    _, dossier, roster = _recruitment_surfaces(db, env, s)
    assert sreport["overall_readiness_score"] is None
    assert dossier["report"]["overall_score"] is None and roster["overall_score"] is None and roster["status"] == "IN_PROGRESS"


# ------------------------------------------------------------------------------ evaluation components and languages
def test_both_workflows_call_the_same_evaluators_and_languages():
    assert rs.engine is flow.engine is engine
    for name in ("evaluate_aptitude", "evaluate_coding", "evaluate_interview", "adapt_blueprint"):
        assert callable(getattr(engine, name, None)), name
    assert engine.SUPPORTED_LANGUAGES == {"python", "python3", "java"}
    assert rs.SUPPORTED_CODING_LANGUAGES is engine.SUPPORTED_LANGUAGES
    coding_problems, _keys = engine.adapt_blueprint(_blueprint())["CODING"]
    assert coding_problems
    for problem in coding_problems:
        assert set(problem["starter_code"]) == {"python"}                         # candidates code in Python only, like the students
        assert problem["starter_code"]["python"].startswith("class Solution:")    # the same LeetCode structure as the students


def test_unsupported_languages_are_rejected_identically(db, env, db_session, setup_test_data, clk):
    sess = _student_session(db_session, setup_test_data, _blueprint())
    hdr = setup_test_data["auth_headers"]
    base = f"/api/roleready/session/{sess.session_uuid}"
    client.post(f"{base}/start-aptitude", headers=hdr)
    client.post(f"{base}/submit-aptitude", headers=hdr, json={"answers": {}})
    client.post(f"{base}/start-coding", headers=hdr)
    student = client.post(f"{base}/run-code", headers=hdr, json={"problem_id": "C1", "code": "x", "language": "cpp"})

    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": {}})
    recruit = client.post(h.sess_url(s, "run-code"), headers=h.sh(s), json={"problem_id": "C1", "code": "x", "language": "cpp"})
    assert student.status_code == recruit.status_code == 400
