import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

import database
import models
from services import assessment_clock
from services import assessment_flow_service as flow
from tests import recruitment_helpers as h

client = h.client


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
def _limits():
    h.reset_public_limiters()
    yield
    h.reset_public_limiters()


@pytest.fixture
def clk(monkeypatch):
    fake = h.FakeClock()
    monkeypatch.setattr(assessment_clock, "now", fake.now)
    return fake


@pytest.fixture(autouse=True)
def _sandbox_and_ai(monkeypatch):
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)


def new_started(env):
    token, _ = h.register_ok(env["token"])
    return h.start_ok(env["token"], token)


def aptitude_payload(db, started, correct=None):
    return {"answers": h.correct_aptitude_answers(db, started["session_uuid"], correct)}


def to_coding(db, env, clk=None, at=0):
    started = new_started(env)
    if clk is not None and at:
        clk.advance(at)
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started))
    assert r.status_code == 200, r.text
    return started, r.json()


def interview_answers():
    return {f"I{i}": f"Detailed answer {i} covering trade-offs and scale." for i in range(1, 6)}


# ------------------------------------------------------------------ start / single attempt
def test_start_creates_hashed_capabilities_and_server_deadlines(db, env, clk):
    started = new_started(env)
    row = h.session_row(db, started["session_uuid"])
    assert row.workflow_type == "RECRUITMENT_ASSESSMENT" and row.current_state == "APTITUDE_IN_PROGRESS"
    assert row.session_capability_hash == flow.sha256_hex(started["session_token"])
    assert row.active_lease_hash == flow.sha256_hex(started["session_lease"])
    for raw in (started["session_token"], started["session_lease"]):
        assert raw not in json.dumps({c.name: str(getattr(row, c.name)) for c in row.__table__.columns})
    start_ts = clk.current.replace(tzinfo=None)
    assert abs((row.started_at - start_ts).total_seconds()) < 1  # pre-existing started_at is whole-second on MySQL
    assert row.overall_deadline_at == start_ts + timedelta(minutes=60)
    assert row.current_section_deadline_at == start_ts + timedelta(minutes=20)
    section = started["state"]["section"]
    assert section["key"] == "aptitude" and section["remaining_seconds"] == 1200
    assert started["state"]["overall_remaining_seconds"] == 3600
    blob = json.dumps(started["state"])
    assert "correct_key" not in blob and "explanation" not in blob
    rounds = flow.get_rounds(db, row.id)
    assert [rounds[s].status for s in flow.SECTION_ORDER] == ["IN_PROGRESS", "PENDING", "PENDING"]


def test_start_requires_valid_registration_capability(env):
    assert h.start(env["token"], "").status_code == 401
    assert h.start(env["token"], "not-a-real-token").status_code == 403


def test_registration_token_from_another_assessment_rejected(env, monkeypatch, db):
    other = h.create_published_job(env["admin"], monkeypatch)
    token, _ = h.register_ok(other["share_token"])
    assert h.start(env["token"], token).status_code == 403


def test_single_attempt_concurrency_10_requests(db, env):
    token, email = h.register_ok(env["token"])

    def go(_):
        return h.start(env["token"], token).status_code

    with ThreadPoolExecutor(max_workers=10) as pool:
        codes = list(pool.map(go, range(10)))
    assert sorted(codes) == [200] + [409] * 9, codes
    reg = db.query(models.CandidateRegistration).filter_by(email=email).first()
    db.refresh(reg)
    assert db.query(models.RoleReadySession).filter_by(registration_id=reg.id).count() == 1
    assert reg.status == "CONSUMED" and reg.attempt_session_uuid
    h.reset_public_limiters()
    assert h.start(env["token"], token).status_code == 409


def test_database_rejects_second_attempt_for_same_registration(db, env):
    token, email = h.register_ok(env["token"])
    started = h.start_ok(env["token"], token)
    reg = db.query(models.CandidateRegistration).filter_by(email=email).first()
    dup = models.RoleReadySession(session_uuid="dup-" + h.new_tag(), workflow_type="RECRUITMENT_ASSESSMENT",
                                  registration_id=reg.id, target_role="x", current_state="APTITUDE_IN_PROGRESS")
    db.add(dup)
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    reg2 = models.CandidateRegistration(registration_token_hash="c" * 64, job_description_id=reg.job_description_id,
                                        organization_id=reg.organization_id, name="x", phone="+14155550000",
                                        email="uniq-uuid@example.com", attempt_session_uuid=reg.attempt_session_uuid)
    db.add(reg2)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ------------------------------------------------------------------ capability, lease, duplicate tab, reload
def test_session_capability_required(env):
    started = new_started(env)
    assert client.get(h.sess_url(started, "state")).status_code == 401
    assert client.get(h.sess_url(started, "state"), headers={"X-Session-Token": "wrong", "X-Session-Lease": started["session_lease"]}).status_code == 403
    other = new_started(env)
    assert client.get(h.sess_url(started, "state"), headers=h.sh(other)).status_code == 403
    assert client.get("/api/public/assessment/session/does-not-exist/state", headers=h.sh(started)).status_code == 404


def test_state_returns_client_safe_section_with_timer(env, clk):
    started = new_started(env)
    clk.advance(100)
    r = client.get(h.sess_url(started, "state"), headers=h.sh(started))
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "APTITUDE_IN_PROGRESS" and body["section"]["remaining_seconds"] == 1100
    assert len(body["section"]["questions"]) == 15
    assert "correct_key" not in r.text


def test_heartbeat_updates_server_clock_and_requires_lease(db, env, clk):
    started = new_started(env)
    clk.advance(15)
    r = client.post(h.sess_url(started, "heartbeat"), headers=h.sh(started))
    assert r.status_code == 200 and "questions" not in json.dumps(r.json())
    assert h.session_row(db, started["session_uuid"]).last_heartbeat_at == clk.current.replace(tzinfo=None)


def test_duplicate_tab_rejected_without_affecting_active_session(db, env, clk):
    started = new_started(env)
    clk.advance(10)
    assert client.post(h.sess_url(started, "heartbeat"), headers=h.sh(started)).status_code == 200  # tab 1 alive
    clk.advance(5)
    # Tab 2: copied sessionStorage (token) but blank memory (no lease)
    tab2 = client.get(h.sess_url(started, "state"), headers=h.sh(started, lease=False))
    assert tab2.status_code == 409
    assert "another window" in tab2.json()["detail"]
    row = h.session_row(db, started["session_uuid"])
    assert row.current_state == "APTITUDE_IN_PROGRESS" and row.abandoned_at is None
    # Tab 1 keeps working
    assert client.get(h.sess_url(started, "state"), headers=h.sh(started)).status_code == 200
    assert client.post(h.sess_url(started, "heartbeat"), headers=h.sh(started)).status_code == 200
    # repeated duplicate attempts still never mutate the sitting
    for _ in range(3):
        assert client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started, lease=False), json={"answers": {}}).status_code == 409
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"


def test_page_reload_without_the_lease_no_longer_ends_the_attempt_it_resumes(db, env, clk):
    started = new_started(env)
    draft = aptitude_payload(db, started, correct=4)
    assert client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "aptitude", "payload": draft}).status_code == 200
    clk.advance(31)  # the pre-reload runtime is gone: heartbeats stopped > 30s ago
    r = client.get(h.sess_url(started, "state"), headers=h.sh(started, lease=False))
    assert r.status_code == 409 and "reload the page to resume" in r.json()["detail"].lower()      # told what to do, nothing was ended
    row = h.session_row(db, started["session_uuid"])
    assert row.current_state == "APTITUDE_IN_PROGRESS" and row.abandoned_at is None and row.finalized_at is None

    res = client.post(h.sess_url(started, "resume"), headers={"X-Session-Token": started["session_token"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["resumed"] is True and body["session_lease"] and body["resume_count"] == 1
    assert body["state"]["section"]["key"] == "aptitude" and body["state"]["section"]["remaining_seconds"] < 20 * 60     # the clock did not pause
    assert body["draft"]["section"] == "aptitude" and body["draft"]["payload"]["answers"] == draft["answers"]            # saved work comes back
    assert [e["type"] for e in body["violations"]] == [flow.RESUME_EVENT]                                                 # the reload is on record
    fresh = {"X-Session-Token": started["session_token"], "X-Session-Lease": body["session_lease"]}
    assert client.get(h.sess_url(started, "state"), headers=fresh).status_code == 200
    assert client.post(h.sess_url(started, "heartbeat"), headers=fresh).status_code == 200
    # the OLD lease is dead: an older window can never work on the same attempt
    assert client.get(h.sess_url(started, "state"), headers=h.sh(started)).status_code == 409


def test_resume_is_limited_and_each_resume_is_recorded(db, env, clk, monkeypatch):
    monkeypatch.setattr(flow, "MAX_RESUMES", 2)
    started = new_started(env)
    head = {"X-Session-Token": started["session_token"]}
    for n in (1, 2):
        clk.advance(40)
        r = client.post(h.sess_url(started, "resume"), headers=head)
        assert r.status_code == 200 and r.json()["resume_count"] == n
    clk.advance(40)
    third = client.post(h.sess_url(started, "resume"), headers=head)
    assert third.status_code == 409 and "cannot be resumed again" in third.json()["detail"]
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"


def test_resume_needs_the_session_capability_and_never_revives_a_finished_attempt(db, env, clk):
    started = new_started(env)
    assert client.post(h.sess_url(started, "resume")).status_code == 401
    assert client.post(h.sess_url(started, "resume"), headers={"X-Session-Token": "wrong"}).status_code == 403
    assert client.post(f"/api/public/assessment/session/{'0' * 8}-0000-0000-0000-{'0' * 12}/resume", headers={"X-Session-Token": "x"}).status_code == 404
    flow.abandon_session(db, h.session_row(db, started["session_uuid"]).id, "test")
    r = client.post(h.sess_url(started, "resume"), headers={"X-Session-Token": started["session_token"]})
    assert r.status_code == 200 and r.json()["resumed"] is False and r.json()["state"]["terminal"] is True and "session_lease" not in r.json()


def test_a_deadline_that_passed_while_the_page_was_away_is_enforced_on_resume(db, env, clk):
    started = new_started(env)
    clk.advance(60 * 60 + 300)                      # far past the overall deadline and the arrival window
    r = client.post(h.sess_url(started, "resume"), headers={"X-Session-Token": started["session_token"]})
    assert r.status_code == 200 and r.json()["resumed"] is False and r.json()["state"]["terminal"] is True


def tab_switch(n=1):
    return [{"type": "Navigated away from assessment window (Tab Switch)", "strike": i + 1, "timestamp": f"2026-01-01T00:00:0{i}Z"} for i in range(n)]


def other_events(n):
    return [{"type": f"Face not visible in camera #{i}", "strike": i + 1, "timestamp": f"2026-01-01T00:01:0{i}Z"} for i in range(n)]


def terminate(started, violations):
    return client.post(h.sess_url(started, "terminate"), headers=h.sh(started), json={"reason": "test", "violations": violations})


def test_the_second_tab_switch_disqualifies_and_submits_the_work_so_far(db, env, clk):
    started = new_started(env)
    draft = aptitude_payload(db, started, correct=6)
    assert client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "aptitude", "payload": draft, "violations": tab_switch(2)}).status_code == 200
    one = terminate(started, tab_switch(1))                                          # one tab switch is only recorded
    assert one.status_code == 400
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"
    blur_only = terminate(started, tab_switch(1) + [{"type": "Application lost focus (Window Blur / Switch)", "strike": 2, "timestamp": "2026-01-01T00:00:09Z"}])
    assert blur_only.status_code == 400                                                # a window losing focus is ignored: it is not a second tab switch
    two = terminate(started, tab_switch(2))
    assert two.status_code == 200, two.text
    body = two.json()
    assert body["terminated"] is True and body["disqualified"] is True and "disqualified" in body["message"].lower() and body["terminal"] is True
    row = h.session_row(db, started["session_uuid"])
    assert row.current_state == "ABANDONED"
    assert row.final_report_data["sections"]["aptitude"]["score"] == pytest.approx(40.0)       # the saved draft was scored
    assert row.final_report_data["sections"]["coding"]["status"] == "UNATTEMPTED"
    log = db.query(models.ActivityLog).filter(models.ActivityLog.target == f"session:{started['session_uuid']}",
                                              models.ActivityLog.action == "ASSESSMENT_DISQUALIFIED_TAB_SWITCH").first()
    assert log is not None
    # a finished attempt cannot be resumed or continued
    assert client.post(h.sess_url(started, "resume"), headers={"X-Session-Token": started["session_token"]}).json()["resumed"] is False


def test_more_than_five_integrity_events_end_the_assessment_and_the_resume_event_does_not_count(db, env, clk):
    started = new_started(env)
    reload_event = {"type": flow.RESUME_EVENT, "strike": 0, "timestamp": "2026-01-01T00:00:00Z"}
    assert terminate(started, other_events(5) + [reload_event]).status_code == 400          # five events (+ a reload) is still allowed
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"
    six = terminate(started, other_events(6) + [reload_event])
    assert six.status_code == 200 and six.json()["terminated"] is True and six.json()["disqualified"] is False
    assert "too many integrity events" in six.json()["message"]
    assert h.session_row(db, started["session_uuid"]).current_state == "ABANDONED"
    log = db.query(models.ActivityLog).filter(models.ActivityLog.target == f"session:{started['session_uuid']}",
                                              models.ActivityLog.action == "ASSESSMENT_ENDED_INTEGRITY_LIMIT").first()
    assert log is not None


def test_terminate_needs_the_live_lease(db, env, clk):
    started = new_started(env)
    r = client.post(h.sess_url(started, "terminate"), headers=h.sh(started, lease=False), json={"violations": tab_switch(3)})
    assert r.status_code == 409
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"


def test_unload_beacon_is_advisory_and_never_abandons_by_itself(db, env):
    """A browser event alone must not establish a confirmed abandonment (mobile browsers fire pagehide when merely backgrounded)."""
    a = new_started(env)
    r = client.post(h.sess_url(a, "abandon"), headers={"X-Session-Token": a["session_token"]})
    assert r.status_code == 200 and r.json()["state"] == "APTITUDE_IN_PROGRESS" and r.json()["abandoned"] is False
    assert client.post(h.sess_url(a, "abandon"), headers={"X-Session-Token": a["session_token"]}).status_code == 200  # idempotent

    b = new_started(env)  # navigator.sendBeacon cannot set headers: token in a text/plain body
    r = client.post(h.sess_url(b, "abandon"), content=json.dumps({"session_token": b["session_token"]}), headers={"Content-Type": "text/plain"})
    assert r.status_code == 200 and h.session_row(db, b["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"
    # the sitting is intact: the lease holder carries on
    assert client.get(h.sess_url(b, "state"), headers=h.sh(b)).status_code == 200

    c = new_started(env)
    assert client.post(h.sess_url(c, "abandon")).status_code == 401
    assert client.post(h.sess_url(c, "abandon"), headers={"X-Session-Token": "bad"}).status_code == 403
    assert h.session_row(db, c["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"


def test_abandon_never_touches_completed_session(db, env, clk):
    started, _ = to_coding(db, env)
    client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    r = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": interview_answers()})
    assert r.status_code == 200
    assert client.post(h.sess_url(started, "abandon"), headers={"X-Session-Token": started["session_token"]}).json()["state"] == "COMPLETED"
    assert h.session_row(db, started["session_uuid"]).current_state == "COMPLETED"


# ------------------------------------------------------------------ sequencing and scoring
def test_strict_sequential_transitions(db, env):
    started = new_started(env)
    assert client.post(h.sess_url(started, "start-coding"), headers=h.sh(started)).status_code == 403
    assert client.post(h.sess_url(started, "start-interview"), headers=h.sh(started)).status_code == 403
    assert client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": {}}).status_code == 403
    assert client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": {}}).status_code == 403
    assert client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": "C1", "code": "x"}).status_code == 403

    assert client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started)).status_code == 200
    assert client.post(h.sess_url(started, "start-interview"), headers=h.sh(started)).status_code == 403
    assert client.post(h.sess_url(started, "start-coding"), headers=h.sh(started)).status_code == 200
    # a section cannot be submitted twice or reopened
    again = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started))
    assert again.status_code == 403


def test_aptitude_scoring_partial_credit_and_next_section_deadline(db, env, clk):
    started = new_started(env)
    clk.advance(300)
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started, correct=10))
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "CODING_IN_PROGRESS" and body["section"]["key"] == "coding"
    assert body["section"]["remaining_seconds"] == 1200
    row = h.session_row(db, started["session_uuid"])
    assert row.aptitude_score == pytest.approx(66.7, abs=0.05)   # the student platform's one-decimal section percentage
    rounds = flow.get_rounds(db, row.id)
    assert rounds["APTITUDE"].status == "EVALUATED" and rounds["APTITUDE"].score == pytest.approx(66.7, abs=0.05)
    assert rounds["CODING"].status == "IN_PROGRESS" and abs((rounds["CODING"].started_at - clk.current.replace(tzinfo=None)).total_seconds()) < 1


def test_wrong_and_unknown_answers_score_zero_and_are_ignored(db, env):
    started = new_started(env)
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started),
                    json={"answers": {"A1": "Z", "nope": "A", "A2": "B" if h.correct_aptitude_answers(db, started["session_uuid"])["A2"] != "B" else "C"}})
    assert r.status_code == 200
    assert h.session_row(db, started["session_uuid"]).aptitude_score == 0.0


# ------------------------------------------------------------------ deadline boundary (arrival window)
@pytest.mark.parametrize("offset", [0.0, 1.0, 10.0])
def test_arrival_window_accepts_final_aptitude_submission(db, env, clk, offset):
    started = new_started(env)
    clk.advance(1200 + offset)
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started))
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "CODING_IN_PROGRESS"


def test_arrival_window_plus_10_1_rejected_and_work_auto_closed(db, env, clk):
    started = new_started(env)
    draft = aptitude_payload(db, started, correct=3)
    assert client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "aptitude", "payload": draft}).status_code == 200
    clk.advance(1210.1)
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started))
    assert r.status_code == 408
    detail = r.json()["detail"]
    assert detail["state"] == "CODING_IN_PROGRESS"  # the section was closed from its saved draft (3/15), not the late payload
    assert h.session_row(db, started["session_uuid"]).aptitude_score == pytest.approx(20.0)


@pytest.mark.parametrize("offset", [0.0, 1.0, 10.0])
def test_coding_run_rejected_at_deadline_but_submission_accepted_in_window(db, env, clk, offset):
    started, _ = to_coding(db, env)
    clk.advance(1200 + offset)  # coding deadline = +20m after the (instant) aptitude submit
    run = client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": "C1", "code": h.GOOD_SOLUTIONS["C1"]["code"]})
    assert run.status_code == 408
    draft = client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "coding", "payload": {"solutions": h.GOOD_SOLUTIONS}})
    assert draft.status_code == 408  # editing is also a hard stop at deadline + 0s
    sub = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert sub.status_code == 200, sub.text
    assert sub.json()["state"] == "INTERVIEW_IN_PROGRESS"


def test_coding_run_allowed_before_deadline(env, db, clk):
    started, _ = to_coding(db, env)
    clk.advance(1199)
    run = client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": "C1", "code": h.GOOD_SOLUTIONS["C1"]["code"]})
    assert run.status_code == 200 and run.json()["all_passed"] is True


def test_coding_plus_10_1_rejected(db, env, clk):
    started, _ = to_coding(db, env)
    clk.advance(1210.1)
    sub = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert sub.status_code == 408
    assert sub.json()["detail"]["state"] == "INTERVIEW_IN_PROGRESS"
    row = h.session_row(db, started["session_uuid"])
    assert row.coding_score == 0.0  # the late payload was NOT used and no draft existed


def test_arrival_window_consumption_reduces_next_section_time(db, env, clk):
    started = new_started(env)
    t0 = clk.current
    clk.set(t0 + timedelta(seconds=1205))  # 5s into the aptitude arrival window
    assert client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=aptitude_payload(db, started)).status_code == 200
    row = h.session_row(db, started["session_uuid"])
    assert row.current_section_deadline_at == (t0 + timedelta(seconds=1205 + 1200)).replace(tzinfo=None)  # 40m05s

    clk.set(t0 + timedelta(seconds=2405))  # full 20m used in coding, submitted exactly at its deadline
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert r.status_code == 200
    section = r.json()["section"]
    assert section["key"] == "interview"
    assert section["remaining_seconds"] == 1195  # 60m - 40m05s: the overall deadline is never extended
    row = h.session_row(db, started["session_uuid"])
    assert row.current_section_deadline_at == row.overall_deadline_at


def test_near_global_deadline_submission_leaves_only_remaining_seconds(db, env, clk):
    started, _ = to_coding(db, env)
    t0 = (h.session_row(db, started["session_uuid"]).overall_deadline_at - timedelta(minutes=60)).replace(tzinfo=clk.current.tzinfo)  # precise on every DB
    row = h.session_row(db, started["session_uuid"])
    row.current_section_deadline_at = row.overall_deadline_at  # coding window runs to the overall hard stop
    db.commit()
    clk.set(t0 + timedelta(seconds=3595))
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert r.status_code == 200
    assert r.json()["section"]["remaining_seconds"] == 5


def test_arrival_window_past_global_deadline_marks_section3_unattempted(db, env, clk):
    started, _ = to_coding(db, env)
    t0 = (h.session_row(db, started["session_uuid"]).overall_deadline_at - timedelta(minutes=60)).replace(tzinfo=clk.current.tzinfo)  # precise on every DB
    row = h.session_row(db, started["session_uuid"])
    row.current_section_deadline_at = row.overall_deadline_at
    db.commit()
    clk.set(t0 + timedelta(seconds=3605))  # 5s past the overall deadline, inside the arrival window
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "TIMED_OUT"
    row = h.session_row(db, started["session_uuid"])
    rounds = flow.get_rounds(db, row.id)
    assert rounds["CODING"].status == "EVALUATED" and rounds["CODING"].score == pytest.approx(100.0)
    assert rounds["INTERVIEW"].status == "UNATTEMPTED"
    assert row.final_report_data["overall_score"] is None and row.final_report_data["sections"]["interview"]["score"] is None
    assert row.finalized_at is not None and row.abandoned_at is None and row.failed_at is None


def test_interview_closed_by_overall_deadline_times_out_with_null_overall(db, env, clk):
    started, _ = to_coding(db, env)
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert r.status_code == 200
    t0 = (h.session_row(db, started["session_uuid"]).overall_deadline_at - timedelta(minutes=60)).replace(tzinfo=clk.current.tzinfo)  # precise on every DB
    row = h.session_row(db, started["session_uuid"])
    row.current_section_deadline_at = row.overall_deadline_at
    db.commit()
    client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "interview", "payload": {"answers": interview_answers()}})
    clk.set(t0 + timedelta(seconds=3611))
    late = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": {"I1": "late edit"}})
    assert late.status_code == 408
    row = h.session_row(db, started["session_uuid"])
    assert row.current_state == "TIMED_OUT"
    assert row.final_report_data["overall_score"] is None
    assert row.final_report_data["sections"]["interview"]["score"] is not None  # drafted answers up to the cutoff were scored


def test_state_after_expiry_lazily_finalizes(db, env, clk):
    started = new_started(env)
    clk.advance(3611)
    r = client.get(h.sess_url(started, "state"), headers=h.sh(started))
    assert r.status_code == 200 and r.json()["state"] == "TIMED_OUT" and r.json()["terminal"] is True
    assert h.session_row(db, started["session_uuid"]).finalized_at is not None


# ------------------------------------------------------------------ completion and idempotent finalize
def test_full_completion_equal_weighted_score_and_idempotent_finalize(db, env, clk):
    started, _ = to_coding(db, env)
    r = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": {"C1": h.GOOD_SOLUTIONS["C1"], "C2": {"language": "python", "code": "def solve(s):\n    return s\n"}}})
    assert r.status_code == 200
    done = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": interview_answers()})
    assert done.status_code == 200 and done.json()["state"] == "COMPLETED"
    assert "score" not in json.dumps(done.json()).lower().replace("evaluation_pending", "")
    row = h.session_row(db, started["session_uuid"])
    rep = row.final_report_data
    apt, cod, itv = (rep["sections"][k]["score"] for k in ("aptitude", "coding", "interview"))
    assert apt == 100.0 and itv == 80.0
    assert 50.0 <= cod < 100.0  # problem 1 fully correct, problem 2 passes only the palindromic/empty cases
    assert rep["overall_score"] == pytest.approx(round((apt + cod + itv) / 3.0, 2))
    assert row.overall_readiness_score == pytest.approx(rep["overall_score"])
    snapshot = json.dumps(row.final_report_data, sort_keys=True)

    # idempotent finalize: identical, never re-evaluated or mutated
    for _ in range(2):
        fin = client.post(h.sess_url(started, "finalize"), headers=h.sh(started, lease=False))
        assert fin.status_code == 200 and fin.json()["state"] == "COMPLETED"
    assert json.dumps(h.session_row(db, started["session_uuid"]).final_report_data, sort_keys=True) == snapshot
    # completed sessions reject further work
    assert client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": interview_answers()}).status_code == 409
    st = client.get(h.sess_url(started, "state"), headers=h.sh(started))
    assert st.status_code == 200 and st.json()["terminal"] is True


def test_finalize_before_completion_is_rejected(env):
    started = new_started(env)
    assert client.post(h.sess_url(started, "finalize"), headers=h.sh(started)).status_code == 409


def test_interview_ai_outage_leaves_evaluation_pending_without_fabricated_score(db, env, monkeypatch):
    h.patch_interview_eval(monkeypatch, source="fallback_default")
    started, _ = to_coding(db, env)
    client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    done = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": interview_answers()})
    assert done.status_code == 200
    assert done.json()["state"] == "EVALUATION_PENDING" and done.json()["evaluation_pending"] is True
    row = h.session_row(db, started["session_uuid"])
    rounds = flow.get_rounds(db, row.id)
    assert rounds["INTERVIEW"].status == "EVALUATION_PENDING"
    assert row.final_report_data["overall_score"] is None and row.final_report_data["sections"]["interview"]["score"] is None
    saved = {a["question_id"]: a["response"] for a in rounds["INTERVIEW"].submission_payload["answers"]}
    assert saved["I1"].startswith("Detailed answer 1")  # answers preserved


def test_drafts_are_scored_when_sitting_is_abandoned(db, env, clk):
    started = new_started(env)
    draft = aptitude_payload(db, started, correct=6)
    assert client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "aptitude", "payload": draft}).status_code == 200
    clk.advance(45)
    assert client.get(h.sess_url(started, "state"), headers=h.sh(started, lease=False)).status_code == 409      # a request alone no longer ends it ...
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"
    flow.abandon_session(db, h.session_row(db, started["session_uuid"]).id, "heartbeat_silence", now=clk.now())    # ... the sweeper does, after the silence window
    row = h.session_row(db, started["session_uuid"])
    assert row.current_state == "ABANDONED"
    rep = row.final_report_data
    assert rep["sections"]["aptitude"]["score"] == pytest.approx(40.0)
    assert rep["sections"]["coding"]["status"] == "UNATTEMPTED" and rep["sections"]["interview"]["status"] == "UNATTEMPTED"
    assert rep["overall_score"] is None


def test_draft_for_inactive_section_rejected(env):
    started = new_started(env)
    r = client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "coding", "payload": {"solutions": {}}})
    assert r.status_code == 403
