import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import database
import models
from services import assessment_clock
from services import assessment_flow_service as flow
from services import assessment_sweeper_service as sweeper
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
def _setup(monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    yield
    h.reset_public_limiters()


def naive(dt):
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def new_session(db, env, *, started=None, overall=None, heartbeat=None, section_deadline=None, now=None):
    now = now or datetime.now(timezone.utc)
    h.reset_public_limiters()
    token, _ = h.register_ok(env["token"])
    started_resp = h.start_ok(env["token"], token)
    row = h.session_row(db, started_resp["session_uuid"])
    row.started_at = naive(started or now - timedelta(minutes=5))
    row.overall_deadline_at = naive(overall if overall is not None else now + timedelta(minutes=55))
    row.current_section_deadline_at = naive(section_deadline if section_deadline is not None else now + timedelta(minutes=15))
    row.last_heartbeat_at = naive(heartbeat if heartbeat is not None else now)
    db.commit()
    return started_resp


def state_of(db, started):
    return h.session_row(db, started["session_uuid"])


def sweep(now, worker="w-test", **kw):
    return sweeper.sweep_once(worker_id=worker, now=now, **kw)


# ------------------------------------------------------------------ distinct state transitions
def test_sweeper_deadline_expiry_transitions_to_timed_out(db, env):
    now = datetime.now(timezone.utc)
    s = new_session(db, env)  # alive and well while the draft is saved ...
    draft = {"answers": h.correct_aptitude_answers(db, s["session_uuid"], 9)}
    assert client.put(h.sess_url(s, "draft"), headers=h.sh(s), json={"section": "aptitude", "payload": draft}).status_code == 200
    row = state_of(db, s)  # ... then the overall deadline passes
    row.overall_deadline_at = naive(now - timedelta(seconds=30))
    row.current_section_deadline_at = naive(now - timedelta(seconds=30))
    row.last_heartbeat_at = naive(now - timedelta(seconds=2))
    db.commit()
    sweep(now)
    row = state_of(db, s)
    assert row.current_state == "TIMED_OUT"
    assert row.finalized_at is not None and row.abandoned_at is None and row.failed_at is None
    assert row.sweeper_worker_id is None and row.sweeper_claimed_at is None
    rep = row.final_report_data
    assert rep["sections"]["aptitude"]["score"] == pytest.approx(60.0)  # draft evaluated up to the cutoff
    assert rep["sections"]["coding"]["status"] == "UNATTEMPTED" and rep["sections"]["interview"]["score"] is None
    assert rep["overall_score"] is None
    # retake is impossible: the registration stays consumed and the session is terminal
    assert client.get(h.sess_url(s, "state"), headers=h.sh(s)).json()["state"] == "TIMED_OUT"


def test_deadline_expiry_waits_for_the_arrival_window(db, env):
    now = datetime.now(timezone.utc)
    s = new_session(db, env, overall=now - timedelta(seconds=5), heartbeat=now - timedelta(seconds=1))
    sweep(now)
    assert state_of(db, s).current_state == "APTITUDE_IN_PROGRESS"  # +5s: a final submission may still arrive
    sweep(now + timedelta(seconds=6))
    assert state_of(db, s).current_state == "TIMED_OUT"


def test_sweeper_heartbeat_gap_transitions_to_abandoned(db, env):
    now = datetime.now(timezone.utc)
    s = new_session(db, env, heartbeat=now - timedelta(seconds=61))
    fresh = new_session(db, env, heartbeat=now - timedelta(seconds=59))
    sweep(now)
    row = state_of(db, s)
    assert row.current_state == "ABANDONED" and row.abandoned_at is not None and row.finalized_at is not None
    assert row.failed_at is None
    assert row.final_report_data["overall_score"] is None
    assert state_of(db, fresh).current_state == "APTITUDE_IN_PROGRESS"  # 59s of silence is not abandonment yet
    # any later reconnect gets 409
    assert client.get(h.sess_url(s, "state"), headers=h.sh(s)).status_code == 409


def test_completed_sessions_never_overwritten_by_sweeper(db, env, monkeypatch):
    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    apt = {"answers": h.correct_aptitude_answers(db, s["session_uuid"])}
    client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json=apt)
    client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})
    done = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": {f"I{i}": "answer" for i in range(1, 6)}})
    assert done.status_code == 200
    row = state_of(db, s)
    row.overall_deadline_at = naive(datetime.now(timezone.utc) - timedelta(hours=2))
    row.last_heartbeat_at = naive(datetime.now(timezone.utc) - timedelta(hours=2))
    db.commit()
    before = (row.current_state, row.final_report_data, row.aptitude_score, row.coding_score, row.interview_score, row.overall_readiness_score, row.finalized_at)
    db2 = database.SessionLocal()
    try:
        assert row.id not in sweeper.claim_sessions(db2, "w-x", datetime.now(timezone.utc))  # never even selected
    finally:
        db2.close()
    sweep(datetime.now(timezone.utc))
    after = state_of(db, s)
    assert (after.current_state, after.final_report_data, after.aptitude_score, after.coding_score, after.interview_score,
            after.overall_readiness_score, after.finalized_at) == before
    assert after.sweeper_worker_id is None


def test_sweeper_vs_late_submission_race_is_serialized(db, env):
    """A final submission inside the arrival window beats the sweeper; after the window the sweeper wins and submit gets 409."""
    now = datetime.now(timezone.utc)
    s = new_session(db, env, section_deadline=now - timedelta(seconds=2), overall=now + timedelta(minutes=50))
    # +8s after the section deadline: candidate submission arrives; sweeper (overall not expired, heartbeat fresh) does nothing
    sweep(now + timedelta(seconds=6))
    assert state_of(db, s).current_state == "APTITUDE_IN_PROGRESS"

    # overall deadline passes while submission is still within the window
    s2 = new_session(db, env, overall=now - timedelta(seconds=8), heartbeat=now - timedelta(seconds=3), section_deadline=now - timedelta(seconds=8))
    clk = h.FakeClock(now)
    mp = pytest.MonkeyPatch()
    mp.setattr(assessment_clock, "now", clk.now)
    try:
        sweep(now)  # deadline + 8s: sweeper must NOT finalize yet
        assert state_of(db, s2).current_state == "APTITUDE_IN_PROGRESS"
        ok = client.post(h.sess_url(s2, "submit-aptitude"), headers=h.sh(s2), json={"answers": h.correct_aptitude_answers(db, s2["session_uuid"])})
        assert ok.status_code == 200  # accepted at deadline+8s; overall already expired -> next section cannot start
        row = state_of(db, s2)
        assert row.current_state == "TIMED_OUT" and row.final_report_data["sections"]["aptitude"]["score"] == 100.0
        sweep(now + timedelta(seconds=30))
        assert state_of(db, s2).current_state == "TIMED_OUT"  # the sweeper did not corrupt or re-evaluate it
    finally:
        mp.undo()

    # reverse order: sweeper first (past the window) -> later submit is rejected cleanly
    s3 = new_session(db, env, overall=now - timedelta(seconds=30), heartbeat=now - timedelta(seconds=3), section_deadline=now - timedelta(seconds=30))
    sweep(now)
    late = client.post(h.sess_url(s3, "submit-aptitude"), headers=h.sh(s3), json={"answers": {}})
    assert late.status_code == 409
    assert state_of(db, s3).current_state == "TIMED_OUT"


# ------------------------------------------------------------------ multi-worker concurrency + fencing
def test_multi_worker_concurrent_sweepers(db, env, monkeypatch):
    now = datetime.now(timezone.utc)
    sessions = [new_session(db, env, overall=now - timedelta(minutes=2), heartbeat=now - timedelta(minutes=2)) for _ in range(20)]
    ids = {state_of(db, s).id for s in sessions}
    evaluated, lock = [], threading.Lock()
    real_eval = flow.evaluate_round

    def counting(db_, session, rnd):
        if session.id in ids:
            with lock:
                evaluated.append((session.id, rnd.round_type))
        return real_eval(db_, session, rnd)

    monkeypatch.setattr(flow, "evaluate_round", counting)
    errors = []

    def worker(i):
        try:
            sweeper.sweep_once(worker_id=f"worker-{i}", now=now)
        except Exception as exc:  # pragma: no cover
            errors.append(repr(exc))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
    [t.start() for t in threads]
    [t.join(60) for t in threads]
    assert not errors, errors
    states = {state_of(db, s).current_state for s in sessions}
    assert states == {"TIMED_OUT"}
    assert len(evaluated) == 20 and len(set(evaluated)) == 20  # each session evaluated exactly once: no duplicate work


def test_sweeper_stale_worker_fenced_lease_rejection(db, env):
    now = datetime.now(timezone.utc)
    s = new_session(db, env, overall=now - timedelta(minutes=2), heartbeat=now - timedelta(minutes=2))
    pk = state_of(db, s).id

    dba = database.SessionLocal()
    claimed_by_a = sweeper.claim_sessions(dba, "worker-A", now)
    assert pk in claimed_by_a
    # Worker A stalls past the 120s lease; worker B reclaims the orphaned session
    later = now + timedelta(seconds=130)
    dbb = database.SessionLocal()
    claimed_by_b = sweeper.claim_sessions(dbb, "worker-B", later)
    assert pk in claimed_by_b
    assert state_of(db, s).sweeper_worker_id == "worker-B"

    # A resumes and tries to commit with its stale lease: fails closed, writes nothing
    stats = sweeper.process_claimed(dba, "worker-A", [pk], claimed_at=now, now=later)
    assert stats["fenced_out"] == 1 and stats["timed_out"] == 0
    row = state_of(db, s)
    assert row.current_state == "APTITUDE_IN_PROGRESS" and row.sweeper_worker_id == "worker-B" and row.final_report_data is None

    # B (current lease holder) finalizes; A can never overwrite B's result afterwards
    stats_b = sweeper.process_claimed(dbb, "worker-B", [pk], claimed_at=later, now=later)
    assert stats_b["timed_out"] == 1
    finalized = state_of(db, s)
    snapshot = (finalized.current_state, finalized.finalized_at, finalized.final_report_data)
    stats_a2 = sweeper.process_claimed(dba, "worker-A", [pk], claimed_at=now, now=later + timedelta(seconds=5))
    assert stats_a2["timed_out"] == 0 and stats_a2["abandoned"] == 0
    again = state_of(db, s)
    assert (again.current_state, again.finalized_at, again.final_report_data) == snapshot
    dba.close()
    dbb.close()


def test_sweeper_startup_catchup(db, env):
    now = datetime.now(timezone.utc)
    s = new_session(db, env, overall=now - timedelta(minutes=3), heartbeat=now - timedelta(minutes=3))
    # Real startup hook (lifespan) = reconcile, then an immediate sweep
    from main import app
    with TestClient(app):
        deadline = time.time() + 15
        while time.time() < deadline and state_of(db, s).current_state not in ("TIMED_OUT", "ABANDONED"):
            time.sleep(0.2)
    assert state_of(db, s).current_state == "TIMED_OUT"


# ------------------------------------------------------------------ post-outage reconciliation
def _incident(db, start, resolved, complete=True):
    return sweeper.record_incident(db, start, resolved, ["database"], "probe-log-sha", complete)


def test_post_outage_infrastructure_reconciliation(db, env):
    now = datetime.now(timezone.utc)
    outage_start, resolved = now - timedelta(minutes=10), now - timedelta(minutes=5)
    active = new_session(db, env, heartbeat=outage_start - timedelta(seconds=5), overall=now + timedelta(minutes=30), started=outage_start - timedelta(minutes=8))
    long_gone = new_session(db, env, heartbeat=outage_start - timedelta(minutes=4), overall=now + timedelta(minutes=30), started=outage_start - timedelta(minutes=8))
    unrelated = new_session(db, env, heartbeat=now, overall=now + timedelta(minutes=30), started=resolved + timedelta(minutes=1))
    draft = {"answers": h.correct_aptitude_answers(db, active["session_uuid"], 5)}
    # preserved work must exist before the outage; persist a draft directly (the platform was down afterwards)
    rnd = flow.get_rounds(db, state_of(db, active).id)["APTITUDE"]
    rnd.submission_payload = {**draft, "final": False}
    db.commit()

    inc = _incident(db, outage_start, resolved)
    totals = sweeper.reconcile_infrastructure_failures(db, inc, now=now)
    assert totals["INFRASTRUCTURE_FAILURE"] == 1 and totals["ABANDONED"] == 1

    a = state_of(db, active)
    assert a.current_state == "INFRASTRUCTURE_FAILURE"
    assert a.failed_at == naive(outage_start) and a.incident_reference_id == inc.incident_reference_id
    assert a.finalized_at is None
    assert a.final_report_data["overall_score"] is None and a.final_report_data["overall_status"] == "PENDING_REVIEW"
    assert flow.get_rounds(db, a.id)["APTITUDE"].submission_payload["answers"] == draft["answers"]  # answers preserved
    assert flow.get_rounds(db, a.id)["APTITUDE"].status == "INFRASTRUCTURE_INTERRUPTED"

    g = state_of(db, long_gone)
    assert g.current_state == "ABANDONED" and g.failed_at is None and g.incident_reference_id is None  # never falsely converted
    assert state_of(db, unrelated).current_state == "APTITUDE_IN_PROGRESS"

    # idempotent: a second run never modifies terminal states
    snap = (a.current_state, a.failed_at, a.incident_reference_id, g.current_state, g.abandoned_at)
    again = sweeper.reconcile_infrastructure_failures(db, inc, now=now + timedelta(minutes=1))
    assert again["INFRASTRUCTURE_FAILURE"] == 0 and again["ABANDONED"] == 0
    a2, g2 = state_of(db, active), state_of(db, long_gone)
    assert (a2.current_state, a2.failed_at, a2.incident_reference_id, g2.current_state, g2.abandoned_at) == snap


def test_infrastructure_reconciliation_manual_review_required(db, env):
    now = datetime.now(timezone.utc)
    outage_start, resolved = now - timedelta(minutes=10), now - timedelta(minutes=5)
    borderline = new_session(db, env, heartbeat=outage_start - timedelta(seconds=75), overall=now + timedelta(minutes=30), started=outage_start - timedelta(minutes=8))
    ambiguous_telemetry = new_session(db, env, heartbeat=outage_start - timedelta(seconds=3), overall=now + timedelta(minutes=30), started=outage_start - timedelta(minutes=8))

    inc = _incident(db, outage_start, resolved)
    totals = sweeper.reconcile_infrastructure_failures(db, inc, now=now)
    assert totals["MANUAL_REVIEW_REQUIRED"] >= 1
    b = state_of(db, borderline)
    assert b.current_state == "MANUAL_REVIEW_REQUIRED" and b.incident_reference_id == inc.incident_reference_id
    assert b.abandoned_at is None  # no arbitrary abandonment, no automated retake
    assert state_of(db, ambiguous_telemetry).current_state in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED")

    fresh = new_session(db, env, heartbeat=outage_start - timedelta(seconds=3), overall=now + timedelta(minutes=30), started=outage_start - timedelta(minutes=8))
    inc2 = _incident(db, outage_start, resolved, complete=False)  # canary data incomplete
    sweeper.reconcile_infrastructure_failures(db, inc2, now=now)
    assert state_of(db, fresh).current_state == "MANUAL_REVIEW_REQUIRED"


def test_sweeper_never_selects_non_in_progress_sessions(db, env):
    now = datetime.now(timezone.utc)
    s = new_session(db, env, overall=now - timedelta(minutes=2), heartbeat=now - timedelta(minutes=2))
    row = state_of(db, s)
    for terminal in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED", "ABANDONED", "REVOKED_RETRIED", "EVALUATION_PENDING"):
        row.current_state = terminal
        db.commit()
        db2 = database.SessionLocal()
        try:
            assert row.id not in sweeper.claim_sessions(db2, "w", now)
        finally:
            db2.close()
