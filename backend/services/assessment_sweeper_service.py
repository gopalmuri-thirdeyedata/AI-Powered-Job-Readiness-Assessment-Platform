"""
Background sweeper + post-outage reconciler (plan section 5, A-C).

Sweeper lifecycle (safe with several FastAPI workers):
  1. short claim transaction (MySQL: SELECT ... FOR UPDATE SKIP LOCKED; SQLite: one atomic UPDATE with a sub-select)
  2. evaluation in memory, outside any transaction (assessment_flow_service.terminalize_session)
  3. fenced commit: WHERE sweeper_worker_id = :worker AND sweeper_claimed_at = :claimed_at AND state IN (in-progress)
A worker whose lease expired (120s) finds rowcount == 0 and aborts without writing. COMPLETED (and every other
terminal) session is never selected, locked or modified.

Deadline semantics: the 10s submission arrival window applies, so overall-deadline expiry is swept only once
overall_deadline_at + 10s has passed (a final submission dispatched at the deadline can still arrive).
"""
import asyncio
import logging
import os
import socket
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy import bindparam, text
from sqlalchemy.exc import DatabaseError, OperationalError
from sqlalchemy.orm import Session

import database
import models
from services import assessment_clock as clock
from services import assessment_flow_service as flow

log = logging.getLogger("prepwin.sweeper")

SWEEP_INTERVAL_SECONDS = 60
CLAIM_BATCH_SIZE = 10
CLAIM_TIMEOUT_SECONDS = 120
HEARTBEAT_ABANDON_SECONDS = 60
BACKOFF_SCHEDULE = (5, 10, 30, 60)
INFRA_ACTIVE_WINDOW_SECONDS = 60       # heartbeat at/after outage_start - 60s  => candidate was engaged
INFRA_BORDERLINE_SECONDS = 30          # heartbeat in [outage_start - 90s, outage_start - 60s) => ambiguous

_IN_PROGRESS_SQL = ", ".join(f"'{s}'" for s in flow.IN_PROGRESS_STATES)


def new_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"


_CLAIMABLE = (
    "workflow_type = :wt AND current_state IN (" + _IN_PROGRESS_SQL + ") "
    "AND (overall_deadline_at <= :dl_cutoff OR (overall_deadline_at > :now AND last_heartbeat_at < :hb_cutoff)) "
    "AND (sweeper_claimed_at IS NULL OR sweeper_claimed_at < :claim_timeout)"
)


def claim_sessions(db: Session, worker_id: str, now: datetime, limit: int = CLAIM_BATCH_SIZE) -> List[int]:
    """Step 1 - holds database locks only for the duration of this short transaction."""
    params = {
        "wt": flow.WORKFLOW_TYPE,
        "dl_cutoff": clock.naive_utc(now - timedelta(seconds=flow.TRANSIT_WINDOW_SECONDS)),
        "now": clock.naive_utc(now),
        "hb_cutoff": clock.naive_utc(now - timedelta(seconds=HEARTBEAT_ABANDON_SECONDS)),
        "claim_timeout": clock.naive_utc(now - timedelta(seconds=CLAIM_TIMEOUT_SECONDS)),
        "worker": worker_id,
        "claimed_at": clock.naive_utc(now),
        "limit": limit,
    }
    try:
        if db.bind.dialect.name == "sqlite":
            db.execute(text(
                "UPDATE roleready_sessions SET sweeper_worker_id = :worker, sweeper_claimed_at = :claimed_at "
                "WHERE id IN (SELECT id FROM roleready_sessions WHERE " + _CLAIMABLE + " ORDER BY id LIMIT :limit)"), params)
            ids = [r[0] for r in db.execute(text(
                "SELECT id FROM roleready_sessions WHERE sweeper_worker_id = :worker AND sweeper_claimed_at = :claimed_at "
                "AND current_state IN (" + _IN_PROGRESS_SQL + ")"), params)]
        else:
            ids = [r[0] for r in db.execute(text(
                "SELECT id FROM roleready_sessions WHERE " + _CLAIMABLE + " ORDER BY id LIMIT :limit FOR UPDATE SKIP LOCKED"), params)]
            if ids:
                db.execute(text("UPDATE roleready_sessions SET sweeper_worker_id = :worker, sweeper_claimed_at = :claimed_at "
                                "WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)),
                           {**params, "ids": ids})
        db.commit()  # row/db locks released immediately
        return ids
    except BaseException:
        db.rollback()
        raise


def decide_terminal_state(session: models.RoleReadySession, now: datetime) -> Optional[str]:
    overall = clock.aware(session.overall_deadline_at)
    if overall is not None and overall <= now - timedelta(seconds=flow.TRANSIT_WINDOW_SECONDS):
        return "TIMED_OUT"
    hb = clock.aware(session.last_heartbeat_at)
    if overall is not None and overall > now and (hb is None or hb < now - timedelta(seconds=HEARTBEAT_ABANDON_SECONDS)):
        return "ABANDONED"
    return None


def process_claimed(db: Session, worker_id: str, claimed_ids: List[int], claimed_at: datetime, now: datetime) -> Dict[str, int]:
    """Steps 2 and 3 for each claimed session."""
    stats = {"timed_out": 0, "abandoned": 0, "skipped": 0, "fenced_out": 0}
    for pk in claimed_ids:
        session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == pk).populate_existing().first()
        db.rollback()
        if session is None:
            stats["skipped"] += 1
            continue
        terminal = decide_terminal_state(session, now)
        if terminal is None:
            stats["skipped"] += 1
            continue
        ok = flow.terminalize_session(db, pk, terminal, now=now, reason=f"sweeper:{terminal.lower()}", fence=(worker_id, claimed_at))
        if ok:
            stats["timed_out" if terminal == "TIMED_OUT" else "abandoned"] += 1
        else:
            stats["fenced_out"] += 1
            log.warning("sweeper worker %s lost session %s (fenced out); discarding its evaluation", worker_id, pk)
    return stats


def sweep_once(worker_id: Optional[str] = None, now: Optional[datetime] = None, session_factory=None,
               max_batches: int = 50) -> Dict[str, int]:
    """Run claim/process cycles until nothing is left (bounded). Safe to call concurrently from many workers."""
    worker_id = worker_id or new_worker_id()
    session_factory = session_factory or database.SessionLocal
    totals = {"timed_out": 0, "abandoned": 0, "skipped": 0, "fenced_out": 0, "claimed": 0}
    for _ in range(max_batches):
        now_value = now or clock.now()
        db = session_factory()
        try:
            ids = claim_sessions(db, worker_id, now_value)
            if not ids:
                break
            totals["claimed"] += len(ids)
            stats = process_claimed(db, worker_id, ids, now_value, now_value)
            for k, v in stats.items():
                totals[k] += v
            if len(ids) < CLAIM_BATCH_SIZE:
                break
        finally:
            db.close()
    return totals


async def sweeper_loop(stop: asyncio.Event, interval: float = SWEEP_INTERVAL_SECONDS):
    """Runs on application startup (immediate catch-up) and then every `interval` seconds."""
    from starlette.concurrency import run_in_threadpool
    worker_id = new_worker_id()
    failures = 0
    while not stop.is_set():
        try:
            totals = await run_in_threadpool(sweep_once, worker_id)
            if totals["claimed"]:
                log.info("sweeper %s: %s", worker_id, totals)
            failures = 0
            delay = interval
        except (OperationalError, DatabaseError) as exc:
            delay = BACKOFF_SCHEDULE[min(failures, len(BACKOFF_SCHEDULE) - 1)]
            failures += 1
            log.warning("sweeper transient database error (%s); backing off %ss", type(exc).__name__, delay)
        except Exception:
            log.exception("sweeper iteration failed")
            delay = interval
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass


# ==============================================================================
# Post-outage infrastructure reconciliation
# ==============================================================================
def record_incident(db: Session, outage_start: datetime, outage_resolved: datetime, affected_subsystems: Optional[List[str]] = None,
                    telemetry_evidence_ref: Optional[str] = None, telemetry_complete: bool = True,
                    created_by: Optional[int] = None) -> models.IncidentRecord:
    if outage_resolved < outage_start:
        raise ValueError("outage_resolved_utc must not precede outage_start_utc")
    ref = f"INCIDENT_{clock.aware(outage_start).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    incident = models.IncidentRecord(
        incident_reference_id=ref, outage_start_utc=clock.naive_utc(outage_start), outage_resolved_utc=clock.naive_utc(outage_resolved),
        affected_subsystems=affected_subsystems or [], telemetry_evidence_ref=telemetry_evidence_ref,
        telemetry_complete=bool(telemetry_complete), created_by=created_by,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return incident


def classify_for_incident(session: models.RoleReadySession, incident: models.IncidentRecord, now: datetime) -> str:
    """
    INFRASTRUCTURE_FAILURE : heartbeat at/after outage_start - 60s (candidate engaged until the platform failed)
    MANUAL_REVIEW_REQUIRED : telemetry incomplete, no heartbeat on record, or heartbeat in the 30s borderline band
                             just before that threshold ([outage_start - 90s, outage_start - 60s))
    ABANDONED / TIMED_OUT  : heartbeat older than the borderline band (candidate left independently of the outage)
    """
    start = clock.aware(incident.outage_start_utc)
    hb = clock.aware(session.last_heartbeat_at)
    if not incident.telemetry_complete or hb is None:
        return "MANUAL_REVIEW_REQUIRED"
    active_floor = start - timedelta(seconds=INFRA_ACTIVE_WINDOW_SECONDS)
    border_floor = active_floor - timedelta(seconds=INFRA_BORDERLINE_SECONDS)
    if hb >= active_floor:
        return "INFRASTRUCTURE_FAILURE"
    if hb >= border_floor:
        return "MANUAL_REVIEW_REQUIRED"
    overall = clock.aware(session.overall_deadline_at)
    if overall is not None and overall <= now - timedelta(seconds=flow.TRANSIT_WINDOW_SECONDS):
        return "TIMED_OUT"
    return "ABANDONED"


def reconcile_infrastructure_failures(db: Session, incident: Optional[models.IncidentRecord] = None,
                                      now: Optional[datetime] = None) -> Dict[str, int]:
    """Idempotent: only in-progress sessions are touched; terminal states are never modified."""
    now = now or clock.now()
    if incident is not None:
        incidents = [incident]
    else:
        incidents = db.query(models.IncidentRecord).filter(models.IncidentRecord.reconciled_at.is_(None)).order_by(models.IncidentRecord.id).all()
    totals = {"INFRASTRUCTURE_FAILURE": 0, "MANUAL_REVIEW_REQUIRED": 0, "ABANDONED": 0, "TIMED_OUT": 0, "skipped": 0}
    for inc in incidents:
        start, resolved, ref, inc_id = inc.outage_start_utc, inc.outage_resolved_utc, inc.incident_reference_id, inc.id
        ids = [r[0] for r in db.query(models.RoleReadySession.id).filter(
            models.RoleReadySession.workflow_type == flow.WORKFLOW_TYPE,
            models.RoleReadySession.current_state.in_(flow.IN_PROGRESS_STATES),
            models.RoleReadySession.started_at <= resolved,
            models.RoleReadySession.overall_deadline_at >= start,
            # a sitting that kept heart-beating after the outage resolved survived it: not a casualty
            models.RoleReadySession.last_heartbeat_at <= resolved,
        ).all()]
        db.rollback()
        for pk in ids:
            session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == pk).populate_existing().first()
            db.rollback()
            if session is None or session.current_state not in flow.IN_PROGRESS_STATES:
                totals["skipped"] += 1
                continue
            fresh_inc = db.query(models.IncidentRecord).filter(models.IncidentRecord.id == inc_id).first()
            outcome = classify_for_incident(session, fresh_inc, now)
            db.rollback()
            kwargs = {}
            if outcome in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED"):
                kwargs = {"incident_reference_id": ref, "failed_at": clock.aware(start)}
            if flow.terminalize_session(db, pk, outcome, now=now, reason=f"incident:{ref}", **kwargs):
                totals[outcome] += 1
            else:
                totals["skipped"] += 1
        row = db.query(models.IncidentRecord).filter(models.IncidentRecord.id == inc_id).first()
        if row is not None and row.reconciled_at is None:
            row.reconciled_at = clock.naive_utc(now)
            db.commit()
        db.rollback()
    return totals
