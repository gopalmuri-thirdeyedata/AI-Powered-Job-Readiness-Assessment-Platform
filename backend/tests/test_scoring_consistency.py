"""
Scoring precision and result consistency across the Student Platform and Admin Recruitment workflows.

Canonical rule under test:  overall = round( (Aptitude% + Coding% + Interview%) / 3 , 2 )  computed from FULL-PRECISION
section percentages (rounding a section for display never changes the overall); section percentages are presented with two
decimals; no overall for an incomplete attempt; repeated submissions / evaluations never change a stored result.

Mocked: the code sandbox (a local Python subprocess) and the AI interview evaluator. Nothing here proves live behaviour.
"""
import pytest

import models
from services import assessment_flow_service as flow
from services import assessment_policy as policy
from services import roleready_service as rs
from tests import recruitment_helpers as h
from tests.test_assessment_parity_matrix import (  # noqa: F401  (fixtures + journey helpers shared with the parity suite)
    GOOD, HALF, INTERVIEW, WRONG, _blueprint, _pin_interview_score, _recruitment_surfaces, _setup, _student_session,
    _student_surfaces, clk, db, env, run_recruitment, run_student)
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (student fixtures)

client = h.client

# aptitude answers correct, coding solutions, interview score -> expected overall
TWO_OF_FIFTEEN_PERFECT_REST = (2, GOOD, 100.0)    # 13.3333.. / 100 / 100  -> 71.11 (rounded sections first would give 71.1)
TWO_OF_FIFTEEN_NO_INTERVIEW = (2, GOOD, 0.0)      # 13.3333.. / 100 / 0    -> 37.78 (rounded sections first would give 37.77)


# ------------------------------------------------------------------------------ the formula
def test_overall_is_the_rounded_mean_of_full_precision_sections():
    assert policy.overall_score(100 * 2 / 15, 100, 100) == 71.11
    assert policy.overall_score(100 * 2 / 15, 100, 0) == 37.78
    assert policy.overall_score(13.3, 100, 0) == 37.77                 # what rounding the section first used to give
    assert policy.overall_score(80, 60, 90) == 76.67
    assert policy.overall_score(0, 0, 0) == 0.0                         # a real zero is not a missing score
    assert policy.overall_score(None, 100, 100) is None and policy.overall_score(100, 100, None) is None


def test_sections_are_normalized_to_0_100_and_presented_with_two_decimals():
    assert policy.normalize_pct(140) == 100.0 and policy.normalize_pct(-5) == 0.0 and policy.normalize_pct("abc") is None
    assert policy.display_pct(100 / 3) == 33.33 and policy.display_pct(None) is None and policy.display_pct(250) == 100.0
    assert policy.overall_score(150, 150, 150) == 100.0                # inputs are clamped before averaging


# ------------------------------------------------------------------------------ equivalent inputs, equivalent results
@pytest.mark.parametrize("scenario,expected", [(TWO_OF_FIFTEEN_PERFECT_REST, 71.11), (TWO_OF_FIFTEEN_NO_INTERVIEW, 37.78)])
def test_both_workflows_compute_the_overall_from_full_precision(db, env, db_session, setup_test_data, clk, monkeypatch, scenario, expected):
    _pin_interview_score(monkeypatch, scenario[2])
    _, sess = run_student(db_session, setup_test_data, clk, _blueprint(), scenario)
    _, s = run_recruitment(db, env, clk, scenario)
    srow, sreport, shistory = _student_surfaces(db_session, setup_test_data, sess)
    rrow, dossier, roster = _recruitment_surfaces(db, env, s)

    assert srow.overall_readiness_score == rrow.overall_readiness_score == expected
    for row in (srow, rrow):                                            # persisted sections keep full precision
        assert row.aptitude_score == pytest.approx(100 * 2 / 15, abs=1e-6) and row.aptitude_score != 13.3
        assert row.final_report_data["scoring_model"] == policy.SCORING_MODEL
    # every surface: two-decimal sections, the same overall
    assert sreport["aptitude_score"] == dossier["report"]["sections"]["aptitude"]["score"] == roster["aptitude_score"] == 13.33
    assert shistory[0]["aptitude_score"] == 13.33
    assert sreport["overall_readiness_score"] == shistory[0]["overall_readiness_score"] == expected
    assert dossier["report"]["overall_score"] == roster["overall_score"] == expected


def test_unanswered_everything_is_a_completed_real_zero_in_both_workflows(db, env, db_session, setup_test_data, clk, monkeypatch):
    """No answers, no code, no spoken responses: three real zeros and an overall of 0.0, never a null or a placeholder."""
    scenario = (0, {}, 0.0)
    monkeypatch.setattr(rs.engine.interview_evaluation, "evaluate_five_technical_questions",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no AI call for an empty interview")))
    sess = _student_session(db_session, setup_test_data, _blueprint())
    hdr, base = setup_test_data["auth_headers"], f"/api/roleready/session/{sess.session_uuid}"
    client.post(f"{base}/start-aptitude", headers=hdr)
    client.post(f"{base}/submit-aptitude", headers=hdr, json={"answers": {}})
    client.post(f"{base}/start-coding", headers=hdr)
    client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": {}})
    client.post(f"{base}/start-interview", headers=hdr)
    assert client.post(f"{base}/submit-interview", headers=hdr, json={"answers": []}).status_code == 200

    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    for path, body in (("submit-aptitude", {"answers": {}}), ("submit-coding", {"solutions": {}}), ("submit-interview", {"answers": [], "transcript": []})):
        assert client.post(h.sess_url(s, path), headers=h.sh(s), json=body).status_code == 200, path

    _, sreport, _ = _student_surfaces(db_session, setup_test_data, sess)
    _, dossier, roster = _recruitment_surfaces(db, env, s)
    assert sreport["overall_readiness_score"] == dossier["report"]["overall_score"] == roster["overall_score"] == 0.0
    assert (sreport["aptitude_score"], sreport["coding_score"], sreport["interview_score"]) == (0.0, 0.0, 0.0)
    assert (roster["aptitude_score"], roster["coding_score"], roster["interview_score"]) == (0.0, 0.0, 0.0)


# ------------------------------------------------------------------------------ duplicates never change a stored result
def _snapshot(row):
    return (row.aptitude_score, row.coding_score, row.interview_score, row.overall_readiness_score,
            (row.final_report_data or {}).get("overall_score", (row.final_report_data or {}).get("overall_readiness_score")))


def test_duplicate_submissions_cannot_change_a_completed_result_in_either_workflow(db, env, db_session, setup_test_data, clk, monkeypatch):
    scenario = (9, HALF, 90.0)
    _pin_interview_score(monkeypatch, 90.0)
    _, sess = run_student(db_session, setup_test_data, clk, _blueprint(), scenario)
    _, s = run_recruitment(db, env, clk, scenario)
    srow = _student_surfaces(db_session, setup_test_data, sess)[0]
    rrow = _recruitment_surfaces(db, env, s)[0]
    before_s, before_r = _snapshot(srow), _snapshot(rrow)

    all_correct = {qid: info["correct_key"] for qid, info in
                   db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=sess.id, round_type="APTITUDE").first().server_keys_payload.items()}
    hdr, base = setup_test_data["auth_headers"], f"/api/roleready/session/{sess.session_uuid}"
    for path, body in (("submit-aptitude", {"answers": all_correct}), ("submit-coding", {"solutions": GOOD}), ("submit-interview", {"answers": INTERVIEW})):
        client.post(f"{base}/{path}", headers=hdr, json=body)                 # a replay or a rejection: never a re-score
    rcorrect = h.correct_aptitude_answers(db, s["session_uuid"])
    for path, body in (("submit-aptitude", {"answers": rcorrect}), ("submit-coding", {"solutions": GOOD}),
                       ("submit-interview", {"answers": INTERVIEW, "transcript": []})):
        client.post(h.sess_url(s, path), headers=h.sh(s), json=body)

    assert _snapshot(_student_surfaces(db_session, setup_test_data, sess)[0]) == before_s
    assert _snapshot(_recruitment_surfaces(db, env, s)[0]) == before_r


def test_admin_retry_on_a_completed_attempt_is_refused_and_changes_nothing(db, env, db_session, setup_test_data, clk, monkeypatch):
    _pin_interview_score(monkeypatch, 90.0)
    _, s = run_recruitment(db, env, clk, (9, HALF, 90.0))
    row = h.session_row(db, s["session_uuid"])
    before = _snapshot(row)
    with pytest.raises(flow.HTTPException) as refused:                       # a completed assessment is immutable: refused, never re-scored
        flow.retry_pending_evaluation(db, row.id)
    assert refused.value.status_code == 409
    assert _snapshot(h.session_row(db, s["session_uuid"])) == before


# ------------------------------------------------------------------------------ failed evaluations
def test_a_sandbox_outage_scores_nothing_in_either_workflow_and_recovery_gives_the_same_score(db, env, db_session, setup_test_data, clk, monkeypatch):
    healthy = h.install_local_sandbox(monkeypatch)                             # reference run, healthy sandbox
    _, ref = run_recruitment(db, env, clk, (9, HALF, 90.0), stop_after="aptitude")
    assert client.post(h.sess_url(ref, "submit-coding"), headers=h.sh(ref), json={"solutions": HALF}).status_code == 200
    reference_coding = h.session_row(db, ref["session_uuid"]).coding_score
    assert 0 < reference_coding < 100

    h.install_local_sandbox(monkeypatch, fail=True)                            # the sandbox goes down
    sj, sess = run_student(db_session, setup_test_data, clk, _blueprint(), (9, HALF, 90.0), stop_after="coding_open")
    hdr, base = setup_test_data["auth_headers"], f"/api/roleready/session/{sess.session_uuid}"
    down = client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": HALF})
    assert down.status_code == 503
    _, sreport, _ = _student_surfaces(db_session, setup_test_data, sess)
    assert sreport["coding_score"] in (None, 0.0) or sreport["overall_readiness_score"] is None
    assert sreport["overall_readiness_score"] is None                          # nothing is reported while evaluation is unavailable

    _, rec = run_recruitment(db, env, clk, (9, HALF, 90.0), stop_after="aptitude")
    assert client.post(h.sess_url(rec, "submit-coding"), headers=h.sh(rec), json={"solutions": HALF}).status_code == 503
    rrow = h.session_row(db, rec["session_uuid"])
    assert flow.get_rounds(db, rrow.id)["CODING"].status == "EVALUATION_PENDING"
    assert rrow.final_report_data["sections"]["coding"]["score"] is None and rrow.final_report_data["overall_score"] is None

    h.install_local_sandbox(monkeypatch)                                       # recovery: both workflows reach the reference score
    assert client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": HALF}).status_code == 200
    flow.retry_pending_evaluation(db, rrow.id)
    db_session.expire_all()
    assert db_session.query(models.RoleReadySession).filter_by(id=sess.id).first().coding_score == pytest.approx(reference_coding)
    assert h.session_row(db, rec["session_uuid"]).coding_score == pytest.approx(reference_coding)
    assert healthy["n"] > 0


def test_incomplete_and_timed_out_attempts_never_report_the_placeholder_overall(db, env, db_session, setup_test_data, clk, monkeypatch):
    from datetime import timedelta
    from tests.test_assessment_parity_matrix import T0
    _pin_interview_score(monkeypatch, 90.0)
    _, sess = run_student(db_session, setup_test_data, clk, _blueprint(), (9, HALF, 90.0), stop_after="aptitude")
    _, s = run_recruitment(db, env, clk, (9, HALF, 90.0), stop_after="aptitude")
    clk.set(T0 + timedelta(minutes=61))
    client.get(f"/api/roleready/session/{sess.session_uuid}", headers=setup_test_data["auth_headers"])
    client.get(h.sess_url(s, "state"), headers=h.sh(s))
    srow, sreport, shistory = _student_surfaces(db_session, setup_test_data, sess)
    rrow, dossier, roster = _recruitment_surfaces(db, env, s)
    assert srow.overall_readiness_score == 0.0 and rrow.overall_readiness_score == 0.0       # the NOT NULL placeholder column
    assert sreport["overall_readiness_score"] is None and shistory[0]["overall_readiness_score"] is None
    assert dossier["report"]["overall_score"] is None and roster["overall_score"] is None
    # the section that was evaluated before the deadline is preserved, with the same two-decimal value in both
    assert sreport["aptitude_score"] == dossier["report"]["sections"]["aptitude"]["score"] == 60.0
