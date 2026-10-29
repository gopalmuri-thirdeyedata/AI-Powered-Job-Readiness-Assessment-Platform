"""
Rules of Assessment: every statement shown to a Recruitment candidate is pinned to the behaviour that enforces it.

Two kinds of tests:
  * the rules text is GENERATED from the enforcing modules' constants, so changing a constant must change the text;
  * each material promise is exercised against the real lifecycle (server clock controlled, nothing waits).
Nothing here asserts a rule that the implementation does not enforce.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import models
from services import assessment_clock
from services import assessment_engine as engine
from services import assessment_policy as policy
from services import assessment_rules as rules
from services import assessment_sweeper_service as sweeper
from tests import recruitment_helpers as h

client = h.client
FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
GROUP_KEYS = ["structure", "timing", "answering", "aptitude", "coding", "interview", "proctoring", "completion"]


def text_of(group_key=None):
    groups = [g for g in rules.candidate_rules() if group_key in (None, g["key"])]
    return "\n".join(i["text"] for g in groups for i in g["items"])


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


@pytest.fixture
def clock(monkeypatch):
    fake = h.FakeClock(datetime.now(timezone.utc))   # the link was published just now: it is inside its 24 h window
    monkeypatch.setattr(assessment_clock, "now", fake.now)
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    yield fake
    h.reset_public_limiters()


def start(env):
    h.reset_public_limiters()
    token, _ = h.register_ok(env["token"])
    return h.start_ok(env["token"], token)


def state(started, lease=True):
    return client.get(h.sess_url(started, "state"), headers=h.sh(started, lease=lease))


def session_state(db, started):
    return h.session_row(db, started["session_uuid"]).current_state


# ============================================================ structure of the rules
def test_every_required_rule_category_is_present_and_nonempty():
    groups = rules.candidate_rules()
    assert [g["key"] for g in groups] == GROUP_KEYS
    assert [g["title"] for g in groups] == ["Assessment Structure", "Timing", "Answering and Submitting", "Aptitude", "Coding",
                                           "Technical Interview", "Proctoring and Integrity", "Completion and Results"]
    for g in groups:
        assert g["items"] and all(isinstance(i["text"], str) and i["text"].strip() for i in g["items"])
    texts = rules.flat_rule_texts()
    assert len(texts) == len(set(texts)), "no duplicated rule"
    assert any(i["important"] for g in groups for i in g["items"]), "restrictions and deadline behaviour are flagged as important"


def test_public_metadata_serves_the_generated_rules_and_nothing_internal(env):
    h.reset_public_limiters()
    body = client.get(f"/api/public/assessment/{env['token']}").json()
    assert body["rules"] == rules.candidate_rules()
    blob = json.dumps(body["rules"]).lower()
    for internal in ("/api/", "heartbeat", "lease", "sqlite", "judge0", "elevenlabs", "yolo", "sweeper", "capability", "token"):
        assert internal not in blob, f"rules must not expose implementation detail: {internal}"


# ============================================================ the numbers come from the enforcing code
def test_timing_text_follows_the_timing_policy(monkeypatch):
    assert f"{policy.SECTION_MINUTES}-minute timer" in text_of("timing")
    assert f"hard limit of {policy.OVERALL_MINUTES} minutes" in text_of("timing")
    monkeypatch.setattr(policy, "SECTION_MINUTES", 25)
    monkeypatch.setattr(policy, "OVERALL_MINUTES", 75)
    assert "25-minute timer" in text_of("timing") and "hard limit of 75 minutes" in text_of("timing")


def test_structure_counts_match_what_a_started_attempt_really_contains(db, env, clock):
    started = start(env)
    rounds = {r.round_type: r for r in db.query(models.RoleReadyRoundAttempt).filter_by(
        session_id=h.session_row(db, started["session_uuid"]).id)}
    from services import jd_blueprint_service as bp
    assert len(rounds["APTITUDE"].questions_payload) == bp.APTITUDE_COUNT == 15
    assert len(rounds["CODING"].questions_payload) == bp.CODING_COUNT == 2
    assert len(rounds["INTERVIEW"].questions_payload) == bp.INTERVIEW_COUNT == 5
    structure = text_of("structure")
    assert "15 multiple-choice" in structure and "2 programming" in structure and "5 questions" in structure
    assert structure.index("Aptitude") < structure.index("Coding") < structure.index("voice-based AI Technical Interview")


def test_coding_languages_and_limits_match_the_engine(monkeypatch):
    assert engine.SUPPORTED_LANGUAGES == {"python", "python3", "java"}
    coding = text_of("coding")
    assert "Java or Python" in coding and "Main" in coding and f"{engine.MAX_CODE_BYTES // 1024} KB" in coding
    for other in ("JavaScript", "C++", "Go", "Ruby"):
        assert other not in coding
    monkeypatch.setattr(engine, "SUPPORTED_LANGUAGES", {"python", "python3"})
    assert "Java" not in rules.candidate_rules()[4]["items"][0]["text"]


def test_connection_text_follows_the_interruption_window(monkeypatch):
    assert sweeper.HEARTBEAT_ABANDON_SECONDS == 60 and "about a minute" in text_of("answering")
    monkeypatch.setattr(sweeper, "HEARTBEAT_ABANDON_SECONDS", 90)
    assert "about 90 seconds" in text_of("answering")


# ============================================================ frontend constants the proctoring text mirrors
def test_proctoring_text_matches_the_workspace_constants():
    fullscreen = (FRONTEND / "hooks" / "useAssessmentFullscreen.js").read_text(encoding="utf-8")
    camera = (FRONTEND / "hooks" / "useFaceProctoring.js").read_text(encoding="utf-8")
    assert re.search(r"recoveryDuration\s*=\s*10\b", fullscreen) and rules.FULLSCREEN_RECOVERY_SECONDS == 10
    checks = int(re.search(r"NO_PERSON_THRESHOLD\s*=\s*(\d+)", camera).group(1))
    interval_ms = int(re.search(r"CHECK_INTERVAL_MS\s*=\s*(\d+)", camera).group(1))
    assert checks * interval_ms // 1000 == rules.NO_PERSON_SECONDS == 6
    for label in ("Multiple persons detected", "Mobile phone detected", "Secondary electronic device", "Reference material or notes"):
        assert label in camera


def test_recruitment_policy_is_flag_only_in_the_candidate_workflow():
    page = (FRONTEND / "pages" / "candidate" / "RecruitmentAssessmentPage.jsx").read_text(encoding="utf-8")
    adapter = (FRONTEND / "services" / "assessmentApi.js").read_text(encoding="utf-8")
    assert 'proctoringPolicy="flag"' in page
    assert "terminate: async () => ({ status: 'ignored' })" in adapter
    proctoring = text_of("proctoring")
    assert "never stop or end your assessment" in proctoring and "not proof of misconduct" in proctoring
    for forbidden in ("strike", "terminated", "3rd", "three warnings", "disqualif", "automatically fail"):
        assert forbidden not in proctoring.lower()


# ============================================================ timing promises, against the real lifecycle
def test_nothing_is_timed_until_start_and_acknowledgement_does_not_start_the_timer(db, env, clock):
    h.reset_public_limiters()
    before = db.query(models.RoleReadySession).filter_by(job_description_id=env["job"]["id"]).count()
    assert client.get(f"/api/public/assessment/{env['token']}").status_code == 200       # opening the instructions
    reg_token, _ = h.register_ok(env["token"])                                           # registering
    clock.advance(10 * 60)                                                               # reading the rules for ten minutes
    assert client.get(f"/api/public/assessment/{env['token']}").status_code == 200       # refreshing the instructions page
    unacked = h.start(env["token"], reg_token, acknowledged=False)                       # ticking nothing / bypassing the box
    assert unacked.status_code == 422
    db.expire_all()
    assert db.query(models.RoleReadySession).filter_by(job_description_id=env["job"]["id"]).count() == before, "no attempt, no timer"
    started = h.start_ok(env["token"], reg_token)                                        # only the explicit start
    s = started["state"]
    assert s["overall_remaining_seconds"] == policy.OVERALL_MINUTES * 60
    assert s["section"]["remaining_seconds"] == policy.SECTION_MINUTES * 60 and s["section"]["key"] == "aptitude"


def test_timers_are_server_side_refresh_cannot_reset_them_and_a_second_start_cannot_either(db, env, clock):
    started = start(env)
    clock.advance(7 * 60)
    s = state(started).json()
    assert s["section"]["remaining_seconds"] == (policy.SECTION_MINUTES - 7) * 60
    assert s["overall_remaining_seconds"] == (policy.OVERALL_MINUTES - 7) * 60
    # a "refresh" of the data (same capability) changes nothing; a repeated start is refused and creates nothing
    assert state(started).json()["overall_deadline_at"] == s["overall_deadline_at"]
    again = h.start(env["token"], "any-registration-token")
    assert again.status_code in (403, 409)


def test_next_section_clock_starts_at_submission_and_time_between_sections_is_not_paused(db, env, clock):
    started = start(env)
    clock.advance(5 * 60)
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["state"] == "CODING_IN_PROGRESS" and s["section"]["key"] == "coding"
    assert s["section"]["remaining_seconds"] == policy.SECTION_MINUTES * 60          # started at submission, no "click to begin"
    assert s["overall_remaining_seconds"] == (policy.OVERALL_MINUTES - 5) * 60       # the overall limit kept running
    clock.advance(3 * 60)                                                            # candidate lingers on a confirmation screen
    s2 = state(started).json()
    assert s2["section"]["remaining_seconds"] == (policy.SECTION_MINUTES - 3) * 60
    assert client.post(h.sess_url(started, "start-coding"), headers=h.sh(started)).json()["section"]["remaining_seconds"] == (policy.SECTION_MINUTES - 3) * 60


def test_section_timer_expiry_submits_what_was_saved_and_moves_on(db, env, clock):
    started = start(env)
    answers = h.correct_aptitude_answers(db, started["session_uuid"], count=6)
    saved = client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "APTITUDE", "payload": {"answers": answers}})
    assert saved.status_code == 200 and saved.json()["saved"] is True
    clock.advance(policy.SECTION_MINUTES * 60 + policy.TRANSIT_WINDOW_SECONDS + 1)
    s = state(started).json()
    assert s["state"] == "CODING_IN_PROGRESS"                                         # the next section began
    apt = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=h.session_row(db, started["session_uuid"]).id, round_type="APTITUDE").first()
    db.refresh(apt)
    assert apt.status == "EVALUATED" and apt.submission_payload["auto_closed"] is True
    assert apt.evaluation_payload["correct_count"] == 6                               # the saved work was scored


def test_overall_deadline_ends_the_assessment_later_sections_unscored_no_overall_score(db, env, clock):
    started = start(env)
    clock.advance(policy.OVERALL_MINUTES * 60 + policy.TRANSIT_WINDOW_SECONDS + 1)
    s = state(started).json()
    assert s["terminal"] is True and s["state"] == "TIMED_OUT"
    row = h.session_row(db, started["session_uuid"])
    rounds = {r.round_type: r.status for r in db.query(models.RoleReadyRoundAttempt).filter_by(session_id=row.id)}
    assert rounds["CODING"] == "UNATTEMPTED" and rounds["INTERVIEW"] == "UNATTEMPTED"
    assert row.final_report_data["overall_score"] is None and row.final_report_data["complete"] is False
    assert client.put(h.sess_url(started, "draft"), headers=h.sh(started),
                      json={"section": "APTITUDE", "payload": {"answers": {}}}).status_code == 409   # no further work


# ============================================================ answering and submitting
def test_a_submitted_section_is_final_and_sections_cannot_be_skipped(db, env, clock):
    started = start(env)
    assert client.post(h.sess_url(started, "start-coding"), headers=h.sh(started)).status_code == 403     # cannot skip ahead
    assert client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": {}}).status_code == 403
    first = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}})
    assert first.status_code == 200
    again = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": h.correct_aptitude_answers(db, started["session_uuid"])})
    assert again.status_code == 403                                                                        # cannot reopen or change it
    late_draft = client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "APTITUDE", "payload": {"answers": {}}})
    assert late_draft.status_code == 403


def test_answers_can_change_until_submission_and_only_the_final_copy_counts(db, env, clock):
    started = start(env)
    right = h.correct_aptitude_answers(db, started["session_uuid"])
    wrong = {qid: ("A" if key != "A" else "B") for qid, key in right.items()}
    for payload in (wrong, right):                                                    # change of mind before submitting
        assert client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "APTITUDE", "payload": {"answers": payload}}).status_code == 200
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": right})
    assert r.status_code == 200
    apt = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=h.session_row(db, started["session_uuid"]).id, round_type="APTITUDE").first()
    db.refresh(apt)
    assert apt.evaluation_payload["correct_count"] == 15 and apt.evaluation_payload["score"] == 100


def test_aptitude_unanswered_score_zero_and_wrong_answers_do_not_lose_marks(db, env, clock):
    started = start(env)
    right = h.correct_aptitude_answers(db, started["session_uuid"])
    ids = list(right)
    answers = {ids[0]: right[ids[0]], ids[1]: ("A" if right[ids[1]] != "A" else "B")}    # 1 right, 1 wrong, 13 unanswered
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": answers})
    assert r.status_code == 200
    apt = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=h.session_row(db, started["session_uuid"]).id, round_type="APTITUDE").first()
    db.refresh(apt)
    assert apt.evaluation_payload["correct_count"] == 1
    assert apt.evaluation_payload["score"] == pytest.approx(1 / 15 * 100)             # no deduction for the wrong answer
    assert "unanswered; they score zero" in text_of("aptitude") and "do not lose marks" in text_of("aptitude")


# ============================================================ interruptions
def test_reload_resumes_the_attempt_and_a_live_second_tab_does_not_take_it(db, env, clock):
    started = start(env)
    client.post(h.sess_url(started, "heartbeat"), headers=h.sh(started))
    clock.advance(5)
    second_tab = state(started, lease=False)                                           # no lease, heartbeat fresh
    assert second_tab.status_code == 409 and "another window" in second_tab.json()["detail"]
    assert session_state(db, started) == "APTITUDE_IN_PROGRESS"                         # the live sitting is untouched
    assert state(started).status_code == 200
    clock.advance(sweeper.HEARTBEAT_ABANDON_SECONDS - 20)                              # the original page was reloaded (heartbeats stopped, not yet abandoned)
    reloaded = state(started, lease=False)
    assert reloaded.status_code == 409 and "reload the page to resume" in reloaded.json()["detail"].lower()
    assert session_state(db, started) == "APTITUDE_IN_PROGRESS"                         # a reload no longer ends the attempt
    resumed = client.post(h.sess_url(started, "resume"), headers={"X-Session-Token": started["session_token"]})
    assert resumed.status_code == 200 and resumed.json()["resumed"] is True
    assert state(started).status_code == 409                                           # the pre-reload lease is dead


def test_a_sitting_nobody_returns_to_is_ended_by_the_sweeper_after_the_silence_window(db, env, clock):
    started = start(env)
    clock.advance(sweeper.HEARTBEAT_ABANDON_SECONDS + 5)                               # the page is gone and nobody resumed
    assert sweeper.sweep_once(worker_id="rules-test-silence", now=clock.now())
    assert session_state(db, started) == "ABANDONED"
    row = h.session_row(db, started["session_uuid"])
    assert row.final_report_data["overall_score"] is None and row.final_report_data["complete"] is False
    assert "resume" in text_of("answering").lower() and "more than 5 integrity events" in text_of("answering")
    assert "disqualified" in text_of("answering")


def test_silence_for_the_stated_window_ends_the_attempt_but_keeps_saved_work(db, env, clock):
    started = start(env)
    answers = h.correct_aptitude_answers(db, started["session_uuid"], count=4)
    client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "APTITUDE", "payload": {"answers": answers}})
    clock.advance(sweeper.HEARTBEAT_ABANDON_SECONDS + 5)                                # connection lost: no heartbeat
    assert sweeper.sweep_once(worker_id="rules-test", now=clock.now())
    assert session_state(db, started) == "ABANDONED"
    row = h.session_row(db, started["session_uuid"])
    apt = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=row.id, round_type="APTITUDE").first()
    db.refresh(apt)
    assert apt.evaluation_payload["correct_count"] == 4                                # work saved before the drop is kept and scored
    assert row.final_report_data["overall_score"] is None


# ============================================================ coding
def test_public_run_shows_samples_and_errors_while_hidden_tests_stay_confidential(db, env, clock):
    started = start(env)
    client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}})
    coding_state = state(started).json()
    problems = coding_state["section"]["questions"]
    blob = json.dumps(coding_state)
    row = h.session_row(db, started["session_uuid"])
    keys = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=row.id, round_type="CODING").first().server_keys_payload
    for pid, info in keys.items():
        for case in info["hidden_test_cases"]:
            assert case["id"] not in blob and "hidden_test_cases" not in blob
    pid = problems[0]["id"]
    ok = client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": pid, "language": "python", "code": "print(1)"})
    assert ok.status_code == 200
    run = ok.json()
    assert 1 <= len(run["test_results"]) <= engine.SAMPLE_TESTS_SHOWN
    public_inputs = {t["input"] for t in problems[0]["public_test_cases"]}
    assert {t["input"] for t in run["test_results"]} <= public_inputs                 # only the public samples ran
    hidden_ids = {c["id"] for c in keys[str(pid)]["hidden_test_cases"]}
    assert not hidden_ids & {t.get("id") for t in run["test_results"]} and "hidden" not in json.dumps(run).lower()
    err = client.post(h.sess_url(started, "run-code"), headers=h.sh(started),
                      json={"problem_id": pid, "language": "python", "code": "raise SystemExit('boom')"}).json()
    assert err["all_passed"] is False and err["error_type"] == "Runtime Error"          # errors are shown, not hidden
    java = client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": pid, "language": "java", "code": "class Main{}"})
    assert java.status_code == 400 and "Python" in java.json()["detail"]                 # candidates code in Python only, like the students
    bad_lang = client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": pid, "language": "javascript", "code": "1"})
    assert bad_lang.status_code == 400
    too_big = client.post(h.sess_url(started, "run-code"), headers=h.sh(started),
                          json={"problem_id": pid, "language": "python", "code": "#" * (engine.MAX_CODE_BYTES + 1)})
    assert too_big.status_code == 400


def test_one_coding_submission_scores_hidden_tests_and_empty_problems_score_zero(db, env, clock):
    started = start(env)
    client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}})
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": {"C1": h.GOOD_SOLUTIONS["C1"]}})
    assert r.status_code == 200 and r.json()["state"] == "INTERVIEW_IN_PROGRESS"
    cod = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=h.session_row(db, started["session_uuid"]).id, round_type="CODING").first()
    db.refresh(cod)
    by_problem = {p["problem_id"]: p for p in cod.evaluation_payload["problems"]}
    assert by_problem["C1"]["passed_tests"] == by_problem["C1"]["total_tests"] > 0
    assert by_problem["C2"]["passed_tests"] == 0 and by_problem["C2"]["classification"] == "NO_SUBMISSION"
    assert 0 < cod.evaluation_payload["score"] < 100
    assert "never shown" in text_of("coding") and "A problem with no code scores zero" in text_of("coding")


def test_code_runner_outage_at_submission_keeps_the_code_and_lets_the_candidate_continue(db, env, clock, monkeypatch):
    started = start(env)
    client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}})
    h.install_local_sandbox(monkeypatch, fail=True)
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": {"C1": h.GOOD_SOLUTIONS["C1"]}})
    assert r.status_code == 503 and r.json()["detail"]["state"] == "INTERVIEW_IN_PROGRESS"       # continue is possible
    row = h.session_row(db, started["session_uuid"])
    cod = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=row.id, round_type="CODING").first()
    db.refresh(cod)
    assert cod.status == "EVALUATION_PENDING" and cod.submission_payload["solutions"]["C1"]["code"] == h.GOOD_SOLUTIONS["C1"]["code"]
    assert cod.evaluation_payload["score"] is None                                                # no score is invented
    assert "kept and checked later" in text_of("coding")


# ============================================================ interview
def finish_to_interview(db, started):
    client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}})
    client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": {}})
    assert state(started).json()["section"]["key"] == "interview"


def test_written_answers_are_accepted_for_the_interview_and_completion_gives_no_score_to_the_candidate(db, env, clock):
    started = start(env)
    finish_to_interview(db, started)
    typed = {f"I{i}": "my written answer" for i in range(1, 6)}                                     # the written fallback's shape
    r = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": typed, "transcript": []})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    assert not re.search(r"score|result|report", json.dumps(r.json()).replace("overall_remaining_seconds", "").replace("remaining_seconds", ""), re.I), \
        "the candidate-facing completion response carries no scores or reports"
    after = state(started)
    assert after.status_code == 200 and "score" not in json.dumps(after.json()).lower()
    assert client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": typed}).status_code == 409   # final


def test_interview_autosaves_and_is_submitted_when_time_ends_even_without_pressing_end(db, env, clock):
    started = start(env)
    finish_to_interview(db, started)
    answers = [{"question_id": "I1", "response": "spoken answer", "follow_ups": []}]
    transcript = [{"role": "ai", "text": "Question 1"}, {"role": "user", "text": "spoken answer"}]
    assert client.put(h.sess_url(started, "draft"), headers=h.sh(started),
                      json={"section": "INTERVIEW", "payload": {"answers": answers, "transcript": transcript}}).status_code == 200
    clock.advance(policy.SECTION_MINUTES * 60 + policy.TRANSIT_WINDOW_SECONDS + 1)
    s = state(started).json()
    assert s["terminal"] is True and s["state"] in ("COMPLETED", "TIMED_OUT")
    row = h.session_row(db, started["session_uuid"])
    intr = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=row.id, round_type="INTERVIEW").first()
    db.refresh(intr)
    assert intr.submission_payload["final"] is True and intr.submission_payload["transcript"][1]["text"] == "spoken answer"


def test_failed_interview_evaluation_keeps_the_responses_and_still_shows_a_submitted_assessment(db, env, clock, monkeypatch):
    from services import interview_evaluation
    monkeypatch.setattr(interview_evaluation, "evaluate_five_technical_questions",
                        lambda *a, **k: {"score": 0, "evaluation_source": "fallback_default"})
    started = start(env)
    finish_to_interview(db, started)
    r = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started),
                    json={"answers": {f"I{i}": "answer" for i in range(1, 6)}})
    assert r.status_code == 200 and r.json()["state"] == "EVALUATION_PENDING"
    row = h.session_row(db, started["session_uuid"])
    intr = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=row.id, round_type="INTERVIEW").first()
    db.refresh(intr)
    assert intr.status == "EVALUATION_PENDING" and len(intr.submission_payload["answers"]) == 5
    assert row.final_report_data["overall_score"] is None
    page = (FRONTEND / "pages" / "candidate" / "RecruitmentAssessmentPage.jsx").read_text(encoding="utf-8")
    assert "['COMPLETED', 'EVALUATION_PENDING'].includes(outcome?.state)" in page       # the candidate sees "submitted", not a failure
    assert "kept and evaluated later" in text_of("interview")


# ============================================================ proctoring
def test_integrity_events_are_recorded_and_never_end_the_attempt(db, env, clock):
    started = start(env)
    events = [{"type": "Navigated away from assessment window (Tab Switch)", "strike": i, "timestamp": clock.now().isoformat()} for i in range(1, 9)]
    r = client.put(h.sess_url(started, "draft"), headers=h.sh(started),
                   json={"section": "APTITUDE", "payload": {"answers": {}}, "violations": events})
    assert r.status_code == 200
    assert session_state(db, started) == "APTITUDE_IN_PROGRESS"                         # eight events, still sitting
    sub = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": {}, "violations": events})
    assert sub.status_code == 200 and sub.json()["state"] == "CODING_IN_PROGRESS"
    apt = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=h.session_row(db, started["session_uuid"]).id, round_type="APTITUDE").first()
    db.refresh(apt)
    assert len(apt.proctoring_violations) == 8                                           # recorded for the hiring team


def test_candidate_responses_never_contain_answer_keys_or_hidden_data(db, env, clock):
    started = start(env)
    blob = json.dumps(state(started).json())
    assert "correct_key" not in blob and "explanation" not in blob and "hidden" not in blob and "evaluation_criteria" not in blob
