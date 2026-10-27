"""
Recruitment assessment LIFECYCLE (plan sections 4-6, 9) on top of the shared assessment engine.

Delivery formats, aptitude / coding / interview evaluation, drafts and the 20 / 20 / 20 + 60 minute policy are NOT implemented
here: they come from services.assessment_engine and services.assessment_policy, the same modules the Student Platform
uses. This module owns what is specific to accountless candidates: the registration -> attempt hand-over, capability + lease
authentication, the no-resume rules, interruption states and the admin-facing report.

Key properties
  * Server clock is the only authority (services.assessment_clock.now()); all deadlines are UTC.
  * Exactly one attempt per registration: row lock + UNIQUE(registration_id) + UNIQUE(attempt_session_uuid).
  * Dual-token no-resume: session capability (sessionStorage) + volatile in-memory lease (never persisted).
  * Submitting a section atomically starts the next one: next deadline = min(now + 20m, overall_deadline_at).
  * Evaluation of candidate work (sandbox / Gemini) never runs inside a database lock.
  * Finalization writes are fenced: conditional UPDATEs on state (and the sweeper lease when present).
"""
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from services import assessment_clock as clock
from services import assessment_engine as engine
from services import assessment_policy as policy
from services import jd_blueprint_service as blueprints
from services import judge0_service
from services import share_link_policy as link_policy
from services import elevenlabs_service
from services.rate_limiter import ConcurrencyGate, SlidingWindowLimiter

WORKFLOW_TYPE = "RECRUITMENT_ASSESSMENT"
SECTION_ORDER = policy.SECTION_ORDER
STATE_FOR_SECTION = {s: f"{s}_IN_PROGRESS" for s in SECTION_ORDER}
SECTION_FOR_STATE = {v: k for k, v in STATE_FOR_SECTION.items()}
IN_PROGRESS_STATES = tuple(STATE_FOR_SECTION.values())
SECTION_LABELS = {"APTITUDE": "Aptitude", "CODING": "Coding", "INTERVIEW": "AI Technical Interview"}

SECTION_MINUTES = policy.SECTION_MINUTES
OVERALL_MINUTES = policy.OVERALL_MINUTES
TRANSIT_WINDOW_SECONDS = policy.TRANSIT_WINDOW_SECONDS
FRESH_HEARTBEAT_SECONDS = 30
HEARTBEAT_INTERVAL_SECONDS = 15
MAX_ANSWER_CHARS = engine.MAX_INTERVIEW_ANSWER_CHARS
MAX_VIOLATION_EVENTS = 200
RULES_VERSION = 1

TERMINAL_STATES = ("COMPLETED", "TIMED_OUT", "ABANDONED", "INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED",
                   "EVALUATION_PENDING", "REVOKED_RETRIED")

run_code_limiter = SlidingWindowLimiter(limit=5, window_seconds=60)
run_code_gate = ConcurrencyGate(limit=2)
voice_init_limiter = SlidingWindowLimiter(limit=4, window_seconds=60)   # each call rebuilds the interview and stores its prompt
voice_turn_limiter = SlidingWindowLimiter(limit=40, window_seconds=60)  # each turn calls two billable voice APIs and Gemini


# ==============================================================================
# Primitives
# ==============================================================================
def sha256_hex(value: str) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


def _hash_matches(candidate: Optional[str], stored_hash: Optional[str]) -> bool:
    if not candidate or not stored_hash:
        return False
    return hmac.compare_digest(sha256_hex(candidate), stored_hash)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return clock.aware(dt).isoformat() if dt else None


def _db_dt(dt: datetime) -> datetime:
    return clock.naive_utc(dt)


def _http(code: int, detail) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def begin_write(db: Session, table: str, row_id: int) -> None:
    """
    SQLite: take the database write lock now (equivalent to BEGIN IMMEDIATE for this transaction) so concurrent
    writers serialize. MySQL/InnoDB: row locks are taken by SELECT ... FOR UPDATE in lock_* helpers.
    """
    if db.bind.dialect.name == "sqlite":
        db.execute(text(f"UPDATE {table} SET id = id WHERE id = :i"), {"i": row_id})


def lock_session(db: Session, session_pk: int) -> models.RoleReadySession:
    begin_write(db, "roleready_sessions", session_pk)
    q = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == session_pk).populate_existing()
    if db.bind.dialect.name != "sqlite":
        q = q.with_for_update()
    session = q.first()
    if session is None:
        db.rollback()
        raise _http(404, "Assessment session not found.")
    return session


def get_rounds(db: Session, session_pk: int) -> Dict[str, models.RoleReadyRoundAttempt]:
    rows = db.query(models.RoleReadyRoundAttempt).filter(
        models.RoleReadyRoundAttempt.session_id == session_pk
    ).populate_existing().order_by(models.RoleReadyRoundAttempt.round_order).all()
    return {r.round_type: r for r in rows}


def applicable_deadline(session: models.RoleReadySession) -> datetime:
    section = clock.aware(session.current_section_deadline_at)
    overall = clock.aware(session.overall_deadline_at)
    return min(section, overall) if section and overall else (section or overall)


# ==============================================================================
# Blueprint -> round payloads (the explicit adapter lives in the shared engine)
# ==============================================================================
def build_round_payloads(bp: Dict[str, Any]) -> Dict[str, Tuple[List[Dict[str, Any]], Dict[str, Any]]]:
    """Returns {SECTION: (client_safe_payload, server_only_keys)} in the student round formats; secrets stay server-side."""
    return engine.adapt_blueprint(bp)


def _load_blueprint_for_registration(db: Session, job: models.JobDescription, reg: models.CandidateRegistration) -> Dict[str, Any]:
    data = None
    if reg.blueprint_version:
        row = db.query(models.JobBlueprintVersion).filter(
            models.JobBlueprintVersion.job_description_id == job.id,
            models.JobBlueprintVersion.version == reg.blueprint_version,
        ).first()
        data = row.blueprint_data if row else None
    if data is None:
        data = job.blueprint_data
    try:
        return blueprints.validate_blueprint(data).model_dump()
    except ValueError:
        raise _http(409, "This assessment is not available right now. Please contact the hiring team.")


# ==============================================================================
# Public lookup + atomic start
# ==============================================================================
def get_open_job_by_token(db: Session, share_token: str) -> models.JobDescription:
    if not share_token or len(share_token) > 128:
        raise _http(404, "Assessment not found.")
    job = db.query(models.JobDescription).filter(models.JobDescription.share_token == share_token).first()
    if job is None:
        # A superseded link stays dead with a clear message instead of turning into "not found".
        retired = db.query(models.JobShareLinkHistory.id).filter(models.JobShareLinkHistory.share_token == share_token).first()
        if retired is not None:
            raise _http(410, link_policy.EXPIRED_MESSAGE)
        raise _http(404, "Assessment not found.")
    # Server clock only; checked before the closed flag so an expired link is always reported as expired.
    if link_policy.is_expired(job, clock.now()):
        raise _http(410, link_policy.EXPIRED_MESSAGE)
    if not job.is_published or job.status != "PUBLISHED":
        raise _http(410, link_policy.CLOSED_MESSAGE)
    return job


def start_assessment(db: Session, share_token: str, registration_token: Optional[str], acknowledged: bool = False) -> Dict[str, Any]:
    job = get_open_job_by_token(db, share_token)
    if not registration_token:
        raise _http(401, "Registration capability required.")
    if acknowledged is not True:
        # Enforced here, not only by the instructions page's checkbox: no acknowledgement, no attempt, no timer.
        raise _http(422, "You must acknowledge the assessment rules before starting.")
    token_hash = sha256_hex(registration_token)
    probe = db.query(models.CandidateRegistration).filter(
        models.CandidateRegistration.registration_token_hash == token_hash,
        models.CandidateRegistration.job_description_id == job.id,
    ).first()
    if probe is None or not hmac.compare_digest(probe.registration_token_hash, token_hash):
        raise _http(403, "Invalid registration capability.")

    # Serialize concurrent starts for this registration (SQLite write lock / MySQL row lock) ...
    begin_write(db, "candidate_registrations", probe.id)
    q = db.query(models.CandidateRegistration).filter(models.CandidateRegistration.id == probe.id).populate_existing()
    if db.bind.dialect.name != "sqlite":
        q = q.with_for_update()
    reg = q.first()
    if reg is None or reg.attempt_session_uuid is not None or reg.status != "REGISTERED":
        db.rollback()
        raise _http(409, "An assessment attempt has already been initiated for this registration.")

    try:
        bp = _load_blueprint_for_registration(db, job, reg)
    except HTTPException:
        db.rollback()
        raise
    payloads = build_round_payloads(bp)

    now = clock.now()
    overall_deadline = now + timedelta(minutes=OVERALL_MINUTES)
    section_deadline = min(now + timedelta(minutes=SECTION_MINUTES), overall_deadline)
    session_uuid = str(uuid.uuid4())
    session_token = secrets.token_urlsafe(32)
    lease_token = secrets.token_urlsafe(24)
    org = db.query(models.Organization).filter(models.Organization.id == job.organization_id).first()

    session = models.RoleReadySession(
        session_uuid=session_uuid,
        workflow_type=WORKFLOW_TYPE,
        organization_id=job.organization_id,
        job_description_id=job.id,
        registration_id=reg.id,
        target_role=(job.role or job.title or "Candidate")[:200],
        target_company=(org.name if org else None),
        jd_title=(job.title or "")[:255],
        current_state=STATE_FOR_SECTION["APTITUDE"],
        started_at=_db_dt(now),
        overall_deadline_at=_db_dt(overall_deadline),
        current_section_deadline_at=_db_dt(section_deadline),
        last_heartbeat_at=_db_dt(now),
        session_capability_hash=sha256_hex(session_token),
        active_lease_hash=sha256_hex(lease_token),
    )
    try:
        db.add(session)
        db.flush()
        for order, section in enumerate(SECTION_ORDER, start=1):
            client_payload, server_payload = payloads[section]
            first = section == "APTITUDE"
            db.add(models.RoleReadyRoundAttempt(
                session_id=session.id, round_type=section, round_order=order,
                status="IN_PROGRESS" if first else "PENDING", time_limit_minutes=SECTION_MINUTES,
                questions_payload=client_payload, server_keys_payload=server_payload,
                started_at=_db_dt(now) if first else None,
            ))
        reg.status = "CONSUMED"
        reg.attempt_session_uuid = session_uuid
        db.add(models.ActivityLog(
            user_id=None, organization_id=job.organization_id, action="ASSESSMENT_RULES_ACKNOWLEDGED",
            target=f"session:{session_uuid}",
            details=json.dumps({"registration_id": reg.id, "rules_version": RULES_VERSION,
                                "acknowledged_at": now.isoformat(), "job_role_id": job.id})))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _http(409, "An assessment attempt has already been initiated for this registration.")

    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.session_uuid == session_uuid).first()
    state = build_state(db, session, now)
    return {"session_uuid": session_uuid, "session_token": session_token, "session_lease": lease_token, "state": state}


# ==============================================================================
# Request authentication: capability + volatile lease
# ==============================================================================
_STATE_MESSAGES = {
    "ABANDONED": "Session abandoned and terminated. The assessment cannot be resumed.",
    "TIMED_OUT": "The assessment time limit has expired.",
    "COMPLETED": "This assessment has already been completed.",
    "EVALUATION_PENDING": "Your responses were received and are being evaluated.",
    "INFRASTRUCTURE_FAILURE": "Platform error under review. The hiring team has been notified.",
    "MANUAL_REVIEW_REQUIRED": "Platform error under review. The hiring team has been notified.",
    "REVOKED_RETRIED": "This attempt has been archived by the hiring team.",
}


def abandon_session(db: Session, session_pk: int, reason: str, now: Optional[datetime] = None) -> bool:
    """Permanently mark an in-progress session ABANDONED (scores of the active section computed from drafts)."""
    return terminalize_session(db, session_pk, "ABANDONED", now=now, reason=reason)


def abandon_by_token(db: Session, session_uuid: str, session_token: Optional[str]) -> Dict[str, Any]:
    """
    Tab / window close beacon. It needs only the session capability and is ADVISORY: a browser event alone never
    establishes a confirmed abandonment (a mobile browser can fire it when the app is merely backgrounded). Abandonment is
    decided from server evidence only - a request that arrives without the lease after the heartbeat went stale
    (load_session), or the sweeper finding no heartbeat for 60s. Idempotent; never touches terminal sessions.
    """
    probe = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.session_uuid == session_uuid,
        models.RoleReadySession.workflow_type == WORKFLOW_TYPE,
    ).first()
    if probe is None:
        raise _http(404, "Assessment session not found.")
    if not session_token:
        raise _http(401, "Session capability required.")
    if not _hash_matches(session_token, probe.session_capability_hash):
        raise _http(403, "Invalid session capability.")
    state = probe.current_state
    db.rollback()
    return {"state": state, "abandoned": state == "ABANDONED", "recorded": True}


def load_session(db: Session, session_uuid: str, session_token: Optional[str], lease_token: Optional[str],
                 *, require_lease: bool = True, allow_terminal: bool = False) -> models.RoleReadySession:
    probe = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.session_uuid == session_uuid,
        models.RoleReadySession.workflow_type == WORKFLOW_TYPE,
    ).first()
    if probe is None:
        raise _http(404, "Assessment session not found.")
    if not session_token:
        raise _http(401, "Session capability required.")
    if not _hash_matches(session_token, probe.session_capability_hash):
        raise _http(403, "Invalid session capability.")

    probe_pk = probe.id
    # End the read-only transaction opened by the probe so that, on MySQL (REPEATABLE READ), the snapshot used by
    # every read that follows is taken AFTER the row lock is held - never before it.
    db.rollback()
    session = lock_session(db, probe_pk)
    state = session.current_state

    if state == "ABANDONED":
        db.rollback()
        raise _http(409, _STATE_MESSAGES["ABANDONED"])
    if state not in IN_PROGRESS_STATES:
        if allow_terminal:
            return session
        db.rollback()
        raise _http(409, _STATE_MESSAGES.get(state, "This assessment is no longer active."))

    if require_lease and not _hash_matches(lease_token, session.active_lease_hash):
        now = clock.now()
        hb = clock.aware(session.last_heartbeat_at)
        if hb is not None and (now - hb).total_seconds() <= FRESH_HEARTBEAT_SECONDS:
            # A live sitting exists elsewhere: reject WITHOUT touching it (accidental duplicate tabs cannot sabotage it).
            db.rollback()
            raise _http(409, "Active assessment sitting detected in another window. Simultaneous multi-tab access is prohibited.")
        db.rollback()
        abandon_session(db, probe_pk, "lease_missing", now=now)
        raise _http(409, "Session interrupted. Page refresh detected. In accordance with strict recruitment integrity rules, assessments cannot be resumed after a reload.")
    return session


def authorize_proctoring(db: Session, session_uuid: Optional[str], session_token: Optional[str]) -> int:
    """
    Read-only authorization for the shared proctoring service: the caller must hold the session capability of a recruitment
    sitting that is still in progress. Unlike load_session it never locks, never abandons and never touches the attempt (the
    volatile lease is deliberately not required), so a probe with a valid token cannot disturb a live sitting.
    Returns the session id; every failure is a generic 403 so nothing about other sittings can be learned.
    """
    if not session_uuid or not session_token:
        raise _http(401, "Authentication required.")
    probe = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.session_uuid == session_uuid,
        models.RoleReadySession.workflow_type == WORKFLOW_TYPE,
    ).first()
    allowed = probe is not None and _hash_matches(session_token, probe.session_capability_hash) and probe.current_state in IN_PROGRESS_STATES
    pk = probe.id if allowed else None
    db.rollback()
    if pk is None:
        raise _http(403, "Not authorized.")
    return pk


# ==============================================================================
# State / heartbeat / drafts
# ==============================================================================
def build_state(db: Session, session: models.RoleReadySession, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or clock.now()
    state = session.current_state
    overall = clock.aware(session.overall_deadline_at)
    out: Dict[str, Any] = {
        "session_uuid": session.session_uuid,
        "state": state,
        "terminal": state not in IN_PROGRESS_STATES,
        "server_time": now.isoformat(),
        "overall_deadline_at": _iso(session.overall_deadline_at),
        "overall_remaining_seconds": max(0, int((overall - now).total_seconds())) if overall else None,
        "heartbeat_interval_seconds": HEARTBEAT_INTERVAL_SECONDS,
    }
    if state in IN_PROGRESS_STATES:
        section = SECTION_FOR_STATE[state]
        rounds = get_rounds(db, session.id)
        deadline = applicable_deadline(session)
        out["section"] = {
            "key": section.lower(), "label": SECTION_LABELS[section],
            "index": SECTION_ORDER.index(section) + 1, "total_sections": len(SECTION_ORDER),
            "started_at": _iso(rounds[section].started_at),
            "deadline_at": deadline.isoformat(),
            "remaining_seconds": max(0, int((deadline - now).total_seconds())),
            "questions": rounds[section].questions_payload,
        }
    else:
        out["message"] = _STATE_MESSAGES.get(state, "This assessment is no longer active.")
    return out


def get_state(db: Session, session: models.RoleReadySession) -> Dict[str, Any]:
    now = clock.now()
    if session.current_state in IN_PROGRESS_STATES:
        session = _enforce_expiry(db, session, now)
    out = build_state(db, session, now)
    db.rollback()  # read-only: release the write lock taken by lock_session
    return out


def _enforce_expiry(db: Session, session: models.RoleReadySession, now: datetime) -> models.RoleReadySession:
    """Lazy safety net (the sweeper is the primary mechanism): finalize sessions past deadline + arrival window."""
    pk = session.id
    overall = clock.aware(session.overall_deadline_at)
    section_deadline = clock.aware(session.current_section_deadline_at)
    window = timedelta(seconds=TRANSIT_WINDOW_SECONDS)
    if overall and now > overall + window:
        db.rollback()
        terminalize_session(db, pk, "TIMED_OUT", now=now, reason="overall_deadline")
        return db.query(models.RoleReadySession).filter(models.RoleReadySession.id == pk).populate_existing().first()
    if section_deadline and now > section_deadline + window:
        section = SECTION_FOR_STATE[session.current_state]
        db.rollback()
        try:
            close_section(db, pk, section, None, auto=True)
        except HTTPException:
            pass
        return db.query(models.RoleReadySession).filter(models.RoleReadySession.id == pk).populate_existing().first()
    return session


def record_heartbeat(db: Session, session: models.RoleReadySession) -> Dict[str, Any]:
    """Keep-alive (every 15s while the lease is held). Returns timing only - never question payloads."""
    now = clock.now()
    pk = session.id
    if session.current_state in IN_PROGRESS_STATES:
        session = _enforce_expiry(db, session, now)
    if session.current_state in IN_PROGRESS_STATES:
        session = lock_session(db, pk)
        session.last_heartbeat_at = _db_dt(now)
        db.commit()
    out = build_state(db, session, now)
    db.rollback()
    if "section" in out:
        out["section"] = {k: v for k, v in out["section"].items() if k != "questions"}
    return out


def _normalize_payload(section: str, payload: Optional[Dict[str, Any]], rnd: models.RoleReadyRoundAttempt) -> Dict[str, Any]:
    """Canonical submission for the section (shared with the Student Platform's drafts)."""
    try:
        return engine.normalize_submission(section, payload, rnd.questions_payload or [])
    except ValueError as exc:
        raise _http(400, str(exc))


def _clean_violations(violations: Any) -> List[Dict[str, Any]]:
    """Client-reported proctoring events (advisory evidence for the hiring team; never an automatic verdict)."""
    out: List[Dict[str, Any]] = []
    for v in (violations or [])[:MAX_VIOLATION_EVENTS] if isinstance(violations, list) else []:
        if isinstance(v, dict):
            strike = v.get("strike")
            out.append({"type": str(v.get("type") or "")[:200], "strike": int(strike) if isinstance(strike, (int, float)) else 0,
                        "timestamp": str(v.get("timestamp") or "")[:40]})
    return out


def save_draft(db: Session, session: models.RoleReadySession, section: str, payload: Dict[str, Any],
               violations: Any = None) -> Dict[str, Any]:
    """Autosave of in-progress answers so partial work can be scored if the sitting ends. Hard stop at the deadline."""
    section = (section or "").upper()
    if section not in SECTION_ORDER or session.current_state != STATE_FOR_SECTION[section]:
        db.rollback()
        raise _http(403, "That section is not the active section.")
    now = clock.now()
    if now >= applicable_deadline(session):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    rnd = get_rounds(db, session.id)[section]
    if rnd.status != "IN_PROGRESS":
        db.rollback()
        raise _http(409, "This section has already been submitted.")
    normalized = _normalize_payload(section, payload, rnd)
    rnd.submission_payload = {**normalized, "final": False, "saved_at": now.isoformat()}
    if violations is not None:
        rnd.proctoring_violations = _clean_violations(violations)
    db.commit()
    return {"saved": True, "server_time": now.isoformat()}


def start_section(db: Session, session: models.RoleReadySession, section: str) -> Dict[str, Any]:
    """start-coding / start-interview: strict sequential check; the section clock was already started by the previous submit."""
    section = section.upper()
    if session.current_state != STATE_FOR_SECTION[section]:
        db.rollback()
        raise _http(403, f"The {SECTION_LABELS[section]} section is not unlocked yet.")
    now = clock.now()
    if now >= applicable_deadline(session):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    out = build_state(db, session, now)
    db.rollback()
    return out


# ==============================================================================
# Code execution (public samples only) - the shared coding engine, behind the concurrency-capped sandbox
# ==============================================================================
def _sandboxed_execute(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    """The platform's Judge0 adapter with the recruitment concurrency / input caps (raises SandboxBusy when saturated)."""
    return judge0_service.execute_sandboxed(language, code, stdin)


def run_code(db: Session, session: models.RoleReadySession, problem_id: str, language: Optional[str], code: str) -> Dict[str, Any]:
    if session.current_state != STATE_FOR_SECTION["CODING"]:
        db.rollback()
        raise _http(403, "The coding section is not active.")
    now = clock.now()
    if now >= applicable_deadline(session):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    rnd = get_rounds(db, session.id)["CODING"]
    problem = next((p for p in (rnd.questions_payload or []) if str(p.get("id")) == str(problem_id)), None)
    comparison = ((rnd.server_keys_payload or {}).get(str(problem_id)) or {}).get("comparison", "text")
    session_pk = session.id
    db.rollback()  # never hold a DB lock while the sandbox runs
    if problem is None:
        raise _http(404, "Problem not found.")
    try:
        lang = engine.normalize_language(language)
    except ValueError as exc:
        raise _http(400, str(exc))
    if len((code or "").encode("utf-8")) > engine.MAX_CODE_BYTES:
        raise _http(400, "Code exceeds the 64 KB submission limit.")
    if not run_code_limiter.allow(session_pk):
        raise _http(429, "Too many code runs. Please wait a moment.")
    if not run_code_gate.acquire(session_pk):
        raise _http(429, "A code run is already in progress.")
    try:
        result = engine.run_sample_tests(problem, code, lang, execute=_sandboxed_execute, comparison=comparison)
    except engine.SandboxBusy:
        raise _http(429, "The code runner is busy. Please retry in a few seconds.")
    except engine.SandboxUnavailable:
        raise _http(503, "The code runner is temporarily unavailable. Your work is not affected.")
    finally:
        run_code_gate.release(session_pk)
    return {**result, "problem_id": problem_id}


# ==============================================================================
# Voice interview (the Student Platform's interview, provisioned for a public candidate)
# ==============================================================================
def voice_init(db: Session, session: models.RoleReadySession) -> Dict[str, Any]:
    """
    Define the voice interview for the active INTERVIEW section. Same builder the Student Platform uses;
    the call may not outlive the section, so its maximum duration is the seconds left on the server clock.
    Rubrics and expected concepts are never sent to the browser or to the voice model.
    """
    if session.current_state != STATE_FOR_SECTION["INTERVIEW"]:
        db.rollback()
        raise _http(403, "The AI Technical Interview section is not unlocked yet.")
    now = clock.now()
    deadline = applicable_deadline(session)
    if now >= deadline:
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    if not voice_init_limiter.allow(session.id):
        db.rollback()
        raise _http(429, "Too many voice-interview connection attempts. Please wait a moment and try again.")
    rnd = get_rounds(db, session.id)["INTERVIEW"]
    client_questions = list(rnd.questions_payload or [])
    job = db.query(models.JobDescription).filter(models.JobDescription.id == session.job_description_id).first()
    reg = db.query(models.CandidateRegistration).filter(models.CandidateRegistration.id == session.registration_id).first()         if session.registration_id else None
    candidate_name = (reg.name if reg and reg.name else "Candidate")
    role = session.target_role or (job.role if job else None) or "the role"
    company = session.target_company
    skills = ", ".join(job.required_skills or []) if job is not None and isinstance(job.required_skills, list) else ""
    jd_summary = (f"Target Role: {role}. Required Skills: {skills}. JD Context: {((job.description or '') if job else '')[:600]}").strip()
    remaining = max(1, int((deadline - now).total_seconds()))
    started_at = _iso(rnd.started_at)
    rnd_id = rnd.id
    db.rollback()

    voice_config = None
    try:
        voice_session = elevenlabs_service.build_voice_session(
            candidate_name=candidate_name,
            role=f"{role} at {company}" if company else role,
            resume_summary="",
            custom_instructions=f"Conduct a rigorous, professional interview evaluating the candidate against: {jd_summary}. Focus on asking the {len(client_questions)} questions one by one.",
            questions=client_questions,
            jd_summary=jd_summary,
            max_duration_seconds=remaining,
        )
        fresh = db.query(models.RoleReadyRoundAttempt).filter(models.RoleReadyRoundAttempt.id == rnd_id).first()
        elevenlabs_service.store_voice_session(db, fresh, voice_session)     # the prompt stays on the server
        voice_config = elevenlabs_service.public_voice_config(voice_session)
    except Exception as exc:  # never leak the provider error; the candidate is offered a retry
        db.rollback()
        print(f"[Recruitment] Voice interview setup failed: {type(exc).__name__}")
    return {
        "session_uuid": session.session_uuid,
        "voiceConfig": voice_config,
        "questions": client_questions,
        "role": role, "company": company or "Target Company", "candidateName": candidate_name,
        "duration": SECTION_MINUTES,
        "started_at": started_at, "deadline_at": deadline.isoformat(), "remaining_seconds": remaining,
        "server_time": now.isoformat(),
    }


def voice_turn(db: Session, session: models.RoleReadySession, audio, content_type: str, history, opening: bool) -> Dict[str, Any]:
    """One spoken exchange of the interview. Same gating as voice_init: interview section active and before the deadline."""
    if session.current_state != STATE_FOR_SECTION["INTERVIEW"]:
        db.rollback()
        raise _http(403, "The AI Technical Interview section is not unlocked yet.")
    if clock.now() >= applicable_deadline(session):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    if not voice_turn_limiter.allow(session.id):
        db.rollback()
        raise _http(429, "Too many voice requests. Please wait a moment and try again.")
    rnd = get_rounds(db, session.id)["INTERVIEW"]
    voice_session = elevenlabs_service.load_voice_session(rnd)
    db.rollback()
    if voice_session is None:
        raise _http(409, "The voice interview has not been initialised. Reload and try again.")
    try:
        return elevenlabs_service.run_turn(voice_session, audio=audio, content_type=content_type, history=history, opening=opening)
    except elevenlabs_service.VoiceServiceError as exc:
        raise _http(exc.status_code, exc.public_message)


# ==============================================================================
# Evaluation (pure with respect to the database)
# ==============================================================================
def _jd_summary(db: Session, session: models.RoleReadySession) -> str:
    job = db.query(models.JobDescription).filter(models.JobDescription.id == session.job_description_id).first()
    if not job:
        return ""
    skills = ", ".join(job.required_skills or []) if isinstance(job.required_skills, list) else ""
    return f"{job.title}. Skills: {skills}. {(job.description or '')[:1500]}"


def evaluate_round(db: Session, session: models.RoleReadySession, rnd: models.RoleReadyRoundAttempt) -> Dict[str, Any]:
    """
    Score one round with the SHARED evaluators (services.assessment_engine) - identical section logic to the Student
    Platform. Returns the student evaluation payload plus a lifecycle `status`: EVALUATED, or EVALUATION_PENDING when the
    sandbox / AI service is down (answers are kept, no score is invented, an admin can retry).
    """
    submission = rnd.submission_payload or {}
    keys = rnd.server_keys_payload or {}
    if rnd.round_type == "APTITUDE":
        return {"status": "EVALUATED", **engine.evaluate_aptitude(keys, submission.get("answers"))}
    if rnd.round_type == "CODING":
        try:
            return {"status": "EVALUATED", **engine.evaluate_coding(rnd.questions_payload or [], keys, submission.get("solutions"),
                                                                     execute=_sandboxed_execute)}
        except engine.SandboxUnavailable:
            return {"status": "EVALUATION_PENDING", "score": None, "pending_reason": "Sandbox unavailable",
                    "problems": [{"problem_id": str(p.get("id")), "title": p.get("title")} for p in (rnd.questions_payload or [])]}
    result = engine.evaluate_interview(
        keys.get("questions", []), submission.get("answers"), role=session.target_role or "Candidate",
        jd_summary=_jd_summary(db, session), transcript=submission.get("transcript"))
    if result.get("evaluation_source") == "fallback_default":
        # AI unavailable: keep the answers, do not fabricate a score.
        return {"status": "EVALUATION_PENDING", "score": None, "pending_reason": "AI evaluation unavailable"}
    return {"status": "EVALUATED", **result}


def _apply_evaluation(rnd: models.RoleReadyRoundAttempt, evaluation: Dict[str, Any]) -> None:
    rnd.status = evaluation["status"]
    rnd.score = float(evaluation["score"]) if evaluation.get("score") is not None else 0.0
    rnd.evaluation_payload = evaluation
    if rnd.status == "EVALUATED":
        rnd.evaluated_at = _db_dt(clock.now())


# ==============================================================================
# Reports
# ==============================================================================
def _violations_of(rnd: Optional[models.RoleReadyRoundAttempt]) -> Dict[str, Any]:
    events = list(rnd.proctoring_violations or []) if rnd is not None and isinstance(rnd.proctoring_violations, list) else []
    return {"count": len(events), "events": events[:MAX_VIOLATION_EVENTS]}


def _section_details(name: str, rnd: models.RoleReadyRoundAttempt) -> Dict[str, Any]:
    """The admin dossier view of one section, derived from the shared evaluation payload and the round's own questions."""
    ev = rnd.evaluation_payload or {}
    sub = rnd.submission_payload or {}
    questions = rnd.questions_payload or []
    keys = rnd.server_keys_payload or {}
    details: Dict[str, Any] = {}
    if ev.get("pending_reason"):
        details["pending_reason"] = ev["pending_reason"]
    if name == "APTITUDE" and "breakdown" in ev:
        by_id = {str(q.get("id")): q for q in questions}
        items = []
        for b in ev.get("breakdown", []):
            q = by_id.get(str(b.get("question_id")), {})
            items.append({"id": b.get("question_id"), "domain": q.get("topic"), "question": q.get("question"),
                          "options": {o.get("key"): o.get("text") for o in q.get("options", []) if isinstance(o, dict)},
                          "selected": b.get("student_choice") or None,
                          "correct_key": (keys.get(str(b.get("question_id"))) or {}).get("correct_key"),
                          "is_correct": bool(b.get("is_correct")), "explanation": b.get("explanation", "")})
        details.update({"correct": ev.get("correct_count"), "total": ev.get("total_questions"), "questions": items})
    elif name == "CODING":
        solutions = sub.get("solutions") or {}
        problems = []
        for p in ev.get("problems", []):
            pid = str(p.get("problem_id"))
            sol = solutions.get(pid) or {}
            problems.append({**p, "id": pid, "language": p.get("language") or sol.get("language"), "code": sol.get("code", "")})
        if problems:
            details["problems"] = problems
        if "passed_hidden_tests" in ev:
            details.update({"hidden_passed": ev.get("passed_hidden_tests"), "hidden_total": ev.get("total_hidden_tests")})
    elif name == "INTERVIEW" and ev.get("status") != "EVALUATION_PENDING" and "question_evaluations" in ev:
        answers = {str(a.get("question_id")): a for a in (sub.get("answers") or []) if isinstance(a, dict)}
        asked = (keys.get("questions") or [])
        items = []
        for i, qe in enumerate(ev.get("question_evaluations", [])):
            qid = str(asked[i]["id"]) if i < len(asked) else str(qe.get("question_id"))
            items.append({"id": qid, "topic": qe.get("category"), "question_text": qe.get("question_text"),
                          "response": (answers.get(qid) or {}).get("response", ""), "score": qe.get("score"),
                          "status": qe.get("status"), "explanation": qe.get("explanation"),
                          "strengths": qe.get("demonstrated_strengths", []), "gaps": qe.get("knowledge_gaps", [])})
        details.update({"summary": ev.get("qualitative_feedback"), "evaluation_source": ev.get("evaluation_source"),
                        "technical_depth_score": ev.get("technical_depth_score"), "communication_score": ev.get("communication_score"),
                        "key_strengths": ev.get("key_strengths", []), "key_areas_for_improvement": ev.get("key_areas_for_improvement", []),
                        "questions": items, "transcript": sub.get("transcript") or []})
    return details


def build_report(session: models.RoleReadySession, rounds: Dict[str, models.RoleReadyRoundAttempt]) -> Dict[str, Any]:
    sections = {}
    raw_scores: Dict[str, Optional[float]] = {}   # full precision: what the overall is calculated from
    for name in SECTION_ORDER:
        rnd = rounds.get(name)
        ev = (rnd.evaluation_payload or {}) if rnd else {}
        raw = policy.normalize_pct(ev.get("score")) if rnd and rnd.status == "EVALUATED" else None
        raw_scores[name] = raw
        entry = {
            "status": rnd.status if rnd else "UNATTEMPTED",
            "score": policy.display_pct(raw),
            "time_spent_seconds": rnd.time_spent_seconds if rnd else 0,
            "started_at": _iso(rnd.started_at) if rnd else None,
            "submitted_at": _iso(rnd.submitted_at) if rnd else None,
            "details": _section_details(name, rnd) if rnd else {},
            "proctoring": _violations_of(rnd),
        }
        sections[name.lower()] = entry
    complete = session.current_state == "COMPLETED" and all(sections[s.lower()]["status"] == "EVALUATED" for s in SECTION_ORDER)
    # The canonical equal-weight formula (shared with the Student Platform); null unless every section was completed.
    overall = policy.overall_score(*(raw_scores[s] for s in SECTION_ORDER)) if complete else None
    state = session.current_state
    if state == "COMPLETED":
        overall_status = "COMPLETED"
    elif state in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED"):
        overall_status = "PENDING_REVIEW"
    elif state in IN_PROGRESS_STATES:
        overall_status = "IN_PROGRESS"
    else:
        overall_status = state
    return {"version": 2, "scoring_model": policy.SCORING_MODEL, "sections": sections, "overall_score": overall,
            "overall_status": overall_status, "complete": complete, "state": state, "generated_at": clock.now().isoformat()}


def _write_scores(session: models.RoleReadySession, rounds: Dict[str, models.RoleReadyRoundAttempt], report: Dict[str, Any]) -> None:
    def raw(name: str) -> float:     # the persisted columns keep full precision (the report shows two decimals)
        rnd = rounds.get(name)
        score = policy.normalize_pct(((rnd.evaluation_payload or {}).get("score")) if rnd and rnd.status == "EVALUATED" else None)
        return float(score or 0.0)

    session.aptitude_score = raw("APTITUDE")
    session.coding_score = raw("CODING")
    session.interview_score = raw("INTERVIEW")
    session.overall_readiness_score = float(report["overall_score"] or 0.0)
    session.final_report_data = report


# ==============================================================================
# Section submission (aptitude / coding / interview) and advancement
# ==============================================================================
def _mark_unattempted(rounds, from_section_idx: int) -> None:
    for name in SECTION_ORDER[from_section_idx:]:
        rnd = rounds.get(name)
        if rnd and rnd.status in ("PENDING", "IN_PROGRESS"):
            rnd.status = "UNATTEMPTED"
            rnd.score = 0.0
            rnd.evaluation_payload = {"status": "UNATTEMPTED", "score": None}


def _finalize_in_place(session, rounds, terminal_state: str, now: datetime, *, abandoned: bool = False) -> None:
    session.current_state = terminal_state
    session.finalized_at = _db_dt(now)
    session.sweeper_claimed_at = None
    session.sweeper_worker_id = None
    if abandoned:
        session.abandoned_at = _db_dt(now)
    if terminal_state == "COMPLETED":
        session.completed_at = _db_dt(now)
    report = build_report(session, rounds)
    _write_scores(session, rounds, report)


def close_section(db: Session, session_pk: int, section: str, payload: Optional[Dict[str, Any]], *, auto: bool = False,
                  violations: Any = None) -> Dict[str, Any]:
    """
    Phase A (locked): validate + persist the final submission. Phase B (unlocked): evaluate.
    Phase C (locked): apply the evaluation and advance / finalize. Used by submit endpoints and lazy auto-close.
    """
    section = section.upper()
    session = lock_session(db, session_pk)
    if session.current_state != STATE_FOR_SECTION[section]:
        state = session.current_state
        db.rollback()
        if state in IN_PROGRESS_STATES:
            raise _http(403, f"Section order violation: {SECTION_LABELS[section]} is not the active section.")
        raise _http(409, _STATE_MESSAGES.get(state, "This assessment is no longer active."))

    now = clock.now()
    late = False
    if not auto and now > applicable_deadline(session) + timedelta(seconds=TRANSIT_WINDOW_SECONDS):
        auto, late = True, True
    rnd = get_rounds(db, session.id)[section]
    if rnd.status != "IN_PROGRESS":
        db.rollback()
        raise _http(409, "This section has already been submitted.")

    if auto or payload is None:
        final_payload = {k: v for k, v in (rnd.submission_payload or {}).items() if k in ("answers", "solutions", "transcript")}
    else:
        final_payload = _normalize_payload(section, payload, rnd)
    rnd.submission_payload = {**final_payload, "final": True, "auto_closed": bool(auto), "submitted_at": now.isoformat()}
    if violations is not None:
        rnd.proctoring_violations = _clean_violations(violations)
    rnd.status = "SUBMITTED"
    rnd.submitted_at = _db_dt(now)
    started = clock.aware(rnd.started_at)
    rnd.time_spent_seconds = max(0, int((now - started).total_seconds())) if started else 0
    db.commit()

    # Phase B: evaluation without any database lock.
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == session_pk).populate_existing().first()
    rnd = get_rounds(db, session_pk)[section]
    evaluation = evaluate_round(db, session, rnd)
    db.rollback()

    # Phase C
    session = lock_session(db, session_pk)
    if session.current_state != STATE_FOR_SECTION[section]:
        state = session.current_state
        db.rollback()
        return {"superseded": True, "state": state, "message": _STATE_MESSAGES.get(state, "")}
    rounds = get_rounds(db, session_pk)
    _apply_evaluation(rounds[section], evaluation)
    idx = SECTION_ORDER.index(section)
    done_at = clock.now()
    overall = clock.aware(session.overall_deadline_at)
    pending = evaluation["status"] == "EVALUATION_PENDING"
    if idx < len(SECTION_ORDER) - 1:
        if done_at >= overall:
            _mark_unattempted(rounds, idx + 1)
            _finalize_in_place(session, rounds, "TIMED_OUT", done_at)
        else:
            nxt = SECTION_ORDER[idx + 1]
            deadline = min(done_at + timedelta(minutes=SECTION_MINUTES), overall)
            session.current_state = STATE_FOR_SECTION[nxt]
            session.current_section_deadline_at = _db_dt(deadline)
            rounds[nxt].status = "IN_PROGRESS"
            rounds[nxt].started_at = _db_dt(done_at)
            _write_scores(session, rounds, build_report(session, rounds))
    else:
        any_pending = any(r.status == "EVALUATION_PENDING" for r in rounds.values())
        if auto and done_at >= overall:
            terminal = "TIMED_OUT"  # the last section was closed by the overall deadline, not submitted by the candidate
        else:
            terminal = "EVALUATION_PENDING" if any_pending else "COMPLETED"
        _finalize_in_place(session, rounds, terminal, done_at)
    db.commit()
    if section == "INTERVIEW":
        elevenlabs_service.release_voice_session(db, rounds[section])    # the interview is closed: drop its prompt

    out = build_state(db, session, done_at)
    out["evaluation_pending"] = pending
    out["submitted_section"] = section.lower()
    db.rollback()
    if late:
        out["message"] = "Submission arrival window has expired. Your saved work was submitted automatically."
        raise _http(408, out)
    if pending and section == "CODING":
        out["message"] = "Code received. Sandbox evaluation pending."
        raise _http(503, out)
    if pending and section == "INTERVIEW":
        out["message"] = "Interview responses received. AI evaluation pending."
    return out


def submit_section(db: Session, session: models.RoleReadySession, section: str, payload: Optional[Dict[str, Any]],
                   violations: Any = None) -> Dict[str, Any]:
    pk = session.id
    db.rollback()
    return close_section(db, pk, section, payload, auto=False, violations=violations)


def finalize(db: Session, session: models.RoleReadySession) -> Dict[str, Any]:
    """Idempotent: terminal sessions return their candidate-safe status; an active sitting cannot be finalized early."""
    if session.current_state in IN_PROGRESS_STATES:
        db.rollback()
        raise _http(409, "The assessment cannot be finalized until all three sections are submitted.")
    out = build_state(db, session)
    db.rollback()
    return out


# ==============================================================================
# Shared terminalization (request path + sweeper). Fenced; evaluation happens outside the transaction.
# ==============================================================================
def terminalize_session(db: Session, session_pk: int, terminal_state: str, *, now: Optional[datetime] = None,
                        reason: str = "", fence: Optional[Tuple[str, datetime]] = None,
                        incident_reference_id: Optional[str] = None, failed_at: Optional[datetime] = None) -> bool:
    """
    Move an in-progress session to `terminal_state`. TIMED_OUT/ABANDONED score the active section from its saved
    draft; INFRASTRUCTURE_FAILURE/MANUAL_REVIEW_REQUIRED preserve everything and score nothing.
    `fence=(worker_id, claimed_at)` adds the sweeper lease predicate. Returns False if another actor won.
    """
    now = now or clock.now()
    # Step 2: evaluation on a snapshot (no locks held)
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == session_pk).populate_existing().first()
    if session is None or session.current_state not in IN_PROGRESS_STATES:
        db.rollback()
        return False
    snapshot_state = session.current_state
    active = SECTION_FOR_STATE[snapshot_state]
    rounds = get_rounds(db, session_pk)
    evaluation = None
    if terminal_state in ("TIMED_OUT", "ABANDONED") and rounds[active].status in ("IN_PROGRESS", "SUBMITTED"):
        if rounds[active].status == "IN_PROGRESS":
            draft = {k: v for k, v in (rounds[active].submission_payload or {}).items() if k in ("answers", "solutions", "transcript")}
            rounds[active].submission_payload = {**draft, "final": True, "auto_closed": True, "reason": reason}
        evaluation = evaluate_round(db, session, rounds[active])
    submission_to_store = rounds[active].submission_payload
    db.rollback()

    # Step 3: fenced commit
    begin_write(db, "roleready_sessions", session_pk)
    values = {
        "current_state": terminal_state,
        "finalized_at": _db_dt(now),
        "sweeper_claimed_at": None,
        "sweeper_worker_id": None,
        "updated_at": _db_dt(now),
    }
    if terminal_state == "ABANDONED":
        values["abandoned_at"] = _db_dt(now)
    if terminal_state == "INFRASTRUCTURE_FAILURE":
        values["failed_at"] = _db_dt(failed_at or now)
        values.pop("finalized_at")
    if terminal_state == "MANUAL_REVIEW_REQUIRED":
        values.pop("finalized_at")
    if incident_reference_id:
        values["incident_reference_id"] = incident_reference_id
    q = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.id == session_pk,
        models.RoleReadySession.current_state == snapshot_state,
    )
    if fence is not None:
        q = q.filter(models.RoleReadySession.sweeper_worker_id == fence[0],
                     models.RoleReadySession.sweeper_claimed_at == _db_dt(fence[1]))
    if q.update(values, synchronize_session=False) != 1:
        db.rollback()
        return False

    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == session_pk).populate_existing().first()
    rounds = get_rounds(db, session_pk)
    active_round = rounds[active]
    if evaluation is not None:
        active_round.submission_payload = submission_to_store
        active_round.submitted_at = active_round.submitted_at or _db_dt(now)
        started = clock.aware(active_round.started_at)
        active_round.time_spent_seconds = max(0, int((now - started).total_seconds())) if started else 0
        _apply_evaluation(active_round, evaluation)
    elif terminal_state in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED") and active_round.status in ("IN_PROGRESS", "SUBMITTED"):
        active_round.status = "INFRASTRUCTURE_INTERRUPTED"
    _mark_unattempted(rounds, SECTION_ORDER.index(active) + 1)
    report = build_report(session, rounds)
    _write_scores(session, rounds, report)
    db.commit()
    return True


def retry_pending_evaluation(db: Session, session_pk: int) -> Dict[str, Any]:
    """Admin action: re-run sandbox/AI evaluation for sections left EVALUATION_PENDING (no penalty was applied)."""
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == session_pk).populate_existing().first()
    if session is None:
        raise _http(404, "Session not found.")
    if session.current_state == "COMPLETED":
        raise _http(409, "A completed assessment is immutable.")
    rounds = get_rounds(db, session_pk)
    pending = [r for r in rounds.values() if r.status == "EVALUATION_PENDING"]
    if not pending:
        raise _http(409, "No evaluation is pending for this session.")
    results = {r.round_type: evaluate_round(db, session, r) for r in pending}
    db.rollback()

    begin_write(db, "roleready_sessions", session_pk)
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == session_pk).populate_existing().first()
    if session.current_state == "COMPLETED":
        db.rollback()
        raise _http(409, "A completed assessment is immutable.")
    rounds = get_rounds(db, session_pk)
    for name, ev in results.items():
        if rounds[name].status == "EVALUATION_PENDING":
            _apply_evaluation(rounds[name], ev)
    all_done = all(r.status in ("EVALUATED", "UNATTEMPTED") for r in rounds.values())
    if session.current_state == "EVALUATION_PENDING" and all(r.status == "EVALUATED" for r in rounds.values()):
        _finalize_in_place(session, rounds, "COMPLETED", clock.now())
    else:
        _write_scores(session, rounds, build_report(session, rounds))
    db.commit()
    return {"state": session.current_state, "all_evaluated": all_done}
