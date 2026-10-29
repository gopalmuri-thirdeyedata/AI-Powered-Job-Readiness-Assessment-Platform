"""
Section retests for the recruitment assessment.

An administrator can give a candidate another chance at ONE section (Aptitude, Coding or AI Interview) of an attempt that is already over.
This module is the only place that knows about it; everything section-specific (question payloads, answer normalization, the Aptitude /
Coding / Interview evaluators, the voice interview, the code sandbox, the equal-weight overall formula, the report builder) is the shared
code in services.assessment_engine / assessment_policy / assessment_flow_service. Nothing is re-implemented here.

Data model (see models.AssessmentRetest)
  * ONE row per assignment, linked to the ORIGINAL attempt (roleready_sessions.id) and its registration. The candidate's registration, the
    attempt and its other sections are never copied, recreated or reset. The original sitting stays locked (its state is terminal).
  * The retest row also holds the independent sitting (capability + volatile lease, 20 minute section clock, drafts, submission, evaluation).

Who may open a retest (existing mechanisms only; nothing new to type in)
  * a registration made from a student account  -> that signed-in student (the normal PrepWin cookie / Bearer session), nothing else;
  * an accountless registration                 -> the single-use hand-over token the administrator receives at assignment (the same pattern
                                                    as the audited retake link); it is consumed by starting the sitting.
  The retest only ever serves its own section. The candidate cannot send a score, a section or an id that changes what is graded.

When the effective score changes
  Only after the section was submitted AND evaluated successfully. In one transaction (session row locked first, then the retest row):
    1. the retested section's round row receives the new evaluation (the replaced evidence is archived in the retest row),
    2. `<section>_score` of the session gets the new percentage - the other two score columns are not written,
    3. the overall score is recalculated by the existing report builder / assessment_policy.overall_score and stored in
       overall_readiness_score, and only the retested section entry (+ overall fields) of final_report_data is replaced,
    4. the retest row becomes COMPLETED and releases its active_key.
  Abandoned, expired, cancelled, failed or unevaluated retests never reach step 1, and a second delivery of the same evaluation finds the
  retest already COMPLETED and does nothing.
"""
import copy
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from email_validator import EmailNotValidError, validate_email
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from services import assessment_clock as clock
from services import assessment_engine as engine
from services import assessment_flow_service as flow
from services import assessment_policy as policy
from services import elevenlabs_service, retest_notification, student_code_run
from services import jd_blueprint_service as blueprints
from services.rate_limiter import SlidingWindowLimiter

SECTIONS = tuple(policy.SECTION_ORDER)
SECTION_LABELS = flow.SECTION_LABELS
SCORE_COLUMN = {"APTITUDE": "aptitude_score", "CODING": "coding_score", "INTERVIEW": "interview_score"}

ACTIVE_STATUSES = ("ASSIGNED", "IN_PROGRESS", "SUBMITTED", "EVALUATION_PENDING")
FINAL_STATUSES = ("COMPLETED", "ABANDONED", "CANCELLED", "EXPIRED")
# Attempts that are over and still hold a result worth correcting. Interrupted attempts have their own audited full-retake path.
ASSIGNABLE_ATTEMPT_STATES = ("COMPLETED", "TIMED_OUT", "ABANDONED", "EVALUATION_PENDING")
VALIDITY_HOURS = 24                  # the ONE source of truth: a retest is valid from its assignment until assigned_at + this many hours
ABANDON_AFTER_SECONDS = 60           # no heartbeat for this long = abandoned (same threshold as the attempt sweeper)
MAX_REASON_CHARS = 1000

retest_voice_init_limiter = SlidingWindowLimiter(limit=4, window_seconds=60)
retest_voice_turn_limiter = SlidingWindowLimiter(limit=40, window_seconds=60)
retest_caption_limiter = SlidingWindowLimiter(limit=8, window_seconds=60)

_STATUS_MESSAGES = {
    "ASSIGNED": "This retest has not been started.",
    "SUBMITTED": "Your responses were received and are being evaluated.",
    "EVALUATION_PENDING": "Your responses were received. The evaluation is pending and the hiring team has been notified.",
    "COMPLETED": "This retest has already been completed.",
    "ABANDONED": "This retest was interrupted and cannot be resumed.",
    "CANCELLED": "This retest was cancelled by the hiring team.",
    "EXPIRED": "This retest has expired.",
}


def _http(code: int, detail) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _now_db() -> datetime:
    return clock.naive_utc(clock.now())


def _iso(dt) -> Optional[str]:
    return clock.aware(dt).isoformat() if dt else None


def _active_key(session_id: int, section: str) -> str:
    return f"{session_id}:{section}"


# ==============================================================================
# Locking
# ==============================================================================
def lock_retest(db: Session, retest_pk: int) -> models.AssessmentRetest:
    flow.begin_write(db, "assessment_retests", retest_pk)
    q = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == retest_pk).populate_existing()
    if db.bind.dialect.name != "sqlite":
        q = q.with_for_update()
    retest = q.first()
    if retest is None:
        db.rollback()
        raise _http(404, "Retest not found.")
    return retest


def _release(retest: models.AssessmentRetest, status: str) -> None:
    """Moves an open retest to a final status and frees its (attempt, section) slot."""
    retest.status = status
    retest.active_key = None


# ==============================================================================
# Effective scores and the administrator's view
# ==============================================================================
def effective_scores(session: Optional[models.RoleReadySession],
                     rounds: Optional[Dict[str, models.RoleReadyRoundAttempt]] = None) -> Dict[str, Optional[float]]:
    """The scores the roster shows (display percentage, None when a section has no evaluated score)."""
    out: Dict[str, Optional[float]] = {s: None for s in SECTIONS}
    if session is None:
        return out
    sections = ((session.final_report_data or {}).get("sections") or {})
    for s in SECTIONS:
        if (sections.get(s.lower()) or {}).get("score") is not None:
            out[s] = policy.display_pct(getattr(session, SCORE_COLUMN[s]))
    return out


def _admin_email(db: Session, user_id: Optional[int]) -> Optional[str]:
    if user_id is None:
        return None
    return db.query(models.User.email).filter(models.User.id == user_id).scalar()


def history_view(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    """One retest as the administrator sees it. This is history: the effective score lives in the attempt's own result."""
    return {
        "retest_uuid": retest.retest_uuid,
        "section": retest.section.lower(),
        "label": SECTION_LABELS[retest.section],
        "status": retest.status,
        "active": retest.status in ACTIVE_STATUSES,
        "reason": retest.reason,
        "original_score": policy.display_pct(retest.original_score),
        "retest_score": policy.display_pct(retest.retest_score),
        "assigned_at": _iso(retest.assigned_at),
        "assigned_by": _admin_email(db, retest.assigned_by),
        "expires_at": _iso(retest.expires_at),
        "started_at": _iso(retest.started_at),
        "completed_at": _iso(retest.completed_at),
        "accepted_as_effective_score": retest.status == "COMPLETED",
        "email": {"status": retest.email_status, "to": retest.email_recipient, "attempts": retest.email_attempts or 0,
                  "error": retest.email_last_error if retest.email_status == "FAILED" else None,
                  "sent_at": _iso(retest.email_sent_at)},
    }


def list_for_session(db: Session, session_pk: int) -> List[models.AssessmentRetest]:
    return db.query(models.AssessmentRetest).filter(models.AssessmentRetest.session_id == session_pk).order_by(
        models.AssessmentRetest.id.asc()).all()


def overview(db: Session, reg: models.CandidateRegistration, session: Optional[models.RoleReadySession],
             job_title: Optional[str]) -> Dict[str, Any]:
    """Everything the Retest dialog shows, read from the database: candidate, role, status, the effective score per section."""
    eligible, why = True, None
    if session is None:
        eligible, why = False, "This candidate has not started the assessment, so there is nothing to retest."
    elif session.current_state in flow.IN_PROGRESS_STATES:
        eligible, why = False, "The candidate is sitting the assessment right now. A retest can be assigned once it is over."
    elif session.current_state not in ASSIGNABLE_ATTEMPT_STATES:
        eligible, why = False, ("This attempt is under review for a platform incident. Use \"Authorize outage retake\" in the dossier."
                                if session.current_state in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED")
                                else "A retest is not available for this attempt.")
    history: List[models.AssessmentRetest] = []
    if session is not None:
        for r in list_for_session(db, session.id):
            settle(db, r.id)
        db.expire_all()
        history = list_for_session(db, session.id)
    open_by_section = {r.section: r for r in history if r.status in ACTIVE_STATUSES}
    scores = effective_scores(session)
    return {
        "candidate": {"id": reg.id, "name": reg.name, "email": reg.email},
        "job_role": {"id": reg.job_description_id, "title": job_title},
        "attempt_state": session.current_state if session else "REGISTERED",
        "eligible": eligible,
        "ineligible_reason": why,
        "sections": [{"key": s.lower(), "label": SECTION_LABELS[s], "score": scores[s],
                      "active_retest": history_view(db, open_by_section[s]) if s in open_by_section else None} for s in SECTIONS],
        "history": [history_view(db, r) for r in history],
    }


# ==============================================================================
# Assignment (administrator)
# ==============================================================================
def assign(db: Session, *, admin_user_id: int, reg: models.CandidateRegistration, sections: List[str],
           reason: Optional[str]) -> Dict[str, Any]:
    wanted: List[str] = []
    for raw in sections or []:
        key = str(raw or "").strip().upper()
        if key not in SECTIONS:
            raise _http(422, "Choose Aptitude, Coding and/or AI Interview.")
        if key not in wanted:
            wanted.append(key)
    if not wanted:
        raise _http(422, "Select at least one section to retest.")
    reason = " ".join((reason or "").split())[:MAX_REASON_CHARS] or None
    try:
        validate_email((reg.email or "").strip(), check_deliverability=False)
    except EmailNotValidError:
        raise _http(422, "The candidate's registered e-mail address is not valid, so a retest e-mail cannot be sent. Correct it first.")

    probe = db.query(models.RoleReadySession).filter(models.RoleReadySession.registration_id == reg.id).first()
    if probe is None:
        raise _http(409, "This candidate has not started the assessment, so there is nothing to retest.")
    probe_pk = probe.id
    db.rollback()
    session = flow.lock_session(db, probe_pk)          # the attempt is locked first (the same order every writer uses)
    if session.current_state in flow.IN_PROGRESS_STATES:
        db.rollback()
        raise _http(409, "The candidate is sitting the assessment right now. A retest can be assigned once it is over.")
    if session.current_state not in ASSIGNABLE_ATTEMPT_STATES:
        db.rollback()
        raise _http(409, "A retest is not available for this attempt.")
    db.rollback()
    for r in list_for_session(db, probe_pk):           # an abandoned / expired sitting must not block a new assignment
        settle(db, r.id)
    db.rollback()

    session = flow.lock_session(db, probe_pk)
    rounds = flow.get_rounds(db, probe_pk)
    open_sections = {r.section for r in list_for_session(db, probe_pk) if r.status in ACTIVE_STATUSES}
    clash = [SECTION_LABELS[s] for s in wanted if s in open_sections]
    if clash:
        db.rollback()
        raise _http(409, {"code": "RETEST_ALREADY_ACTIVE", "message": f"{', '.join(clash)} already has an active retest for this candidate."})
    if any(rounds.get(s) is None for s in wanted):
        db.rollback()
        raise _http(409, "The original attempt has no record for that section.")

    now = _now_db()
    scores = effective_scores(session)
    created: List[Dict[str, Any]] = []
    rows: List[models.AssessmentRetest] = []
    batch = str(uuid.uuid4())                           # retests assigned together are announced in ONE e-mail
    for s in wanted:
        token = None if reg.student_user_id is not None else secrets.token_urlsafe(32)
        row = models.AssessmentRetest(
            retest_uuid=str(uuid.uuid4()), session_id=session.id, registration_id=reg.id, job_description_id=reg.job_description_id,
            organization_id=reg.organization_id, section=s, status="ASSIGNED", active_key=_active_key(session.id, s), reason=reason,
            assigned_by=admin_user_id, assigned_at=now, expires_at=now + timedelta(hours=VALIDITY_HOURS),
            access_token_hash=flow.sha256_hex(token) if token else None, original_score=scores[s], proctoring_violations=[],
            notify_batch=batch, email_status="PENDING", email_recipient=reg.email)
        db.add(row)
        rows.append(row)
        created.append({"token": token, "uuid": row.retest_uuid})
    try:
        db.add(models.ActivityLog(user_id=admin_user_id, organization_id=reg.organization_id, action="ASSESSMENT_RETEST_ASSIGNED",
                                  target=f"registration:{reg.id}",
                                  details=f"sections={','.join(wanted)}; session_id={session.id}; job_role={reg.job_description_id}; reason={reason or ''}"))
        db.commit()
    except IntegrityError:                              # lost the UNIQUE(active_key) race to a concurrent assignment
        db.rollback()
        raise _http(409, {"code": "RETEST_ALREADY_ACTIVE", "message": "A retest for one of these sections was just assigned. Reload and check."})
    # The assignment is committed. Only now is the candidate told; a mail failure never touches the assignment.
    tokens = {c["uuid"]: c["token"] for c in created if c["token"]}
    notice = retest_notification.deliver(db, batch, tokens=tokens)
    return {"retests": _views_with_fallback(db, batch, notice), "student_account": reg.student_user_id is not None,
            "email": notice["email"], "email_outcome": notice["status"]}


def _views_with_fallback(db: Session, batch: str, notice: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    The batch's retests for the administrator. When the e-mail was NOT delivered, an accountless candidate's single-use token is included
    (shown once) so the link can be handed over by other means; once the mail is SENT no token ever leaves the server again.
    """
    db.expire_all()
    out = []
    for row in db.query(models.AssessmentRetest).filter(models.AssessmentRetest.notify_batch == batch).order_by(models.AssessmentRetest.id):
        view = history_view(db, row)
        token = (notice.get("tokens") or {}).get(row.retest_uuid)
        if token and notice["status"] != "sent" and row.status == "ASSIGNED":
            view["access_token"] = token
        out.append(view)
    return out


def resend_notification(db: Session, retest: models.AssessmentRetest, admin_user_id: int) -> Dict[str, Any]:
    """Retries the candidate e-mail of an assignment whose delivery failed. Never creates an assignment; a SENT e-mail is never re-sent."""
    batch, org, reg_id = retest.notify_batch, retest.organization_id, retest.registration_id
    db.rollback()
    if not batch:
        raise _http(409, "This retest has no e-mail to retry.")
    notice = retest_notification.deliver(db, batch)
    if notice["status"] == "skipped":
        raise _http(409, notice["reason"])
    db.add(models.ActivityLog(user_id=admin_user_id, organization_id=org, action="ASSESSMENT_RETEST_EMAIL_RETRIED",
                              target=f"registration:{reg_id}", details=f"batch={batch}; outcome={notice['status']}"))
    db.commit()
    student = db.query(models.CandidateRegistration.student_user_id).filter(models.CandidateRegistration.id == reg_id).scalar() is not None
    return {"retests": _views_with_fallback(db, batch, notice), "student_account": student, "email": notice["email"], "email_outcome": notice["status"]}


def cancel(db: Session, retest: models.AssessmentRetest, admin_user_id: int) -> Dict[str, Any]:
    pk = retest.id
    db.rollback()
    row = lock_retest(db, pk)
    if row.status not in ("ASSIGNED", "IN_PROGRESS", "EVALUATION_PENDING"):
        db.rollback()
        raise _http(409, "Only an open retest can be cancelled.")
    _release(row, "CANCELLED")
    row.access_token_hash = None
    db.add(models.ActivityLog(user_id=admin_user_id, organization_id=row.organization_id, action="ASSESSMENT_RETEST_CANCELLED",
                              target=f"registration:{row.registration_id}", details=f"section={row.section}; retest={row.retest_uuid}"))
    db.commit()
    return history_view(db, row)


def retry_evaluation(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    """Re-runs the evaluation of a stored submission whose evaluation was unavailable. Same evaluators, same acceptance rules."""
    pk = retest.id
    db.rollback()
    row = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == pk).populate_existing().first()
    if row is None or row.status != "EVALUATION_PENDING":
        raise _http(409, "No evaluation is pending for this retest.")
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == row.session_id).first()
    evaluation = _evaluate(db, session, row)
    db.rollback()
    return _finish(db, pk, evaluation)


# ==============================================================================
# Authorization of the candidate (existing credentials only)
# ==============================================================================
def find(db: Session, retest_uuid: str) -> models.AssessmentRetest:
    row = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.retest_uuid == (retest_uuid or "")[:64]).first() \
        if retest_uuid else None
    if row is None:
        raise _http(404, "Retest not found.")
    return row


def authorize_owner(db: Session, retest: models.AssessmentRetest, *, token: Optional[str], viewer_id: Optional[int]) -> models.CandidateRegistration:
    """
    Proves the caller is the candidate the retest was assigned to. Student-made registrations: the signed-in account must be the owner.
    Accountless registrations: the hand-over token. Every failure for someone else is the same "not found".
    """
    reg = db.query(models.CandidateRegistration).filter(models.CandidateRegistration.id == retest.registration_id).first()
    if reg is None:
        raise _http(404, "Retest not found.")
    if reg.student_user_id is not None:
        if viewer_id is None:
            raise _http(401, {"code": "SIGN_IN_REQUIRED", "message": "Sign in with your student account to open this retest."})
        if viewer_id != reg.student_user_id:
            raise _http(404, "Retest not found.")
        return reg
    if not token or not flow._hash_matches(token, retest.access_token_hash):
        raise _http(404, "Retest not found.")
    return reg


# What each section consists of, worded for the candidate. The COUNT comes from the attempt's own round (the blueprint's questions), with
# the blueprint's published counts as the fallback, so this text cannot disagree with what the sitting actually serves.
_FORMAT_NOUN = {"APTITUDE": "multiple-choice question", "CODING": "programming problem", "INTERVIEW": "voice-based interview question"}
_FORMAT_DEFAULT_COUNT = {"APTITUDE": blueprints.APTITUDE_COUNT, "CODING": blueprints.CODING_COUNT, "INTERVIEW": blueprints.INTERVIEW_COUNT}


def section_format(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    original = db.query(models.RoleReadyRoundAttempt.questions_payload).filter(
        models.RoleReadyRoundAttempt.session_id == retest.session_id, models.RoleReadyRoundAttempt.round_type == retest.section).scalar()
    count = len(original) if isinstance(original, list) and original else _FORMAT_DEFAULT_COUNT[retest.section]
    noun = _FORMAT_NOUN[retest.section]
    return {"item_count": count, "format": f"{count} {noun}{'' if count == 1 else 's'}"}


def describe(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    """What the entry page shows before the sitting (no questions, no keys)."""
    job = db.query(models.JobDescription).filter(models.JobDescription.id == retest.job_description_id).first()
    org = db.query(models.Organization).filter(models.Organization.id == retest.organization_id).first()
    return {
        "retest_uuid": retest.retest_uuid, "section": retest.section.lower(), "label": SECTION_LABELS[retest.section],
        "status": retest.status, "can_start": retest.status == "ASSIGNED", "minutes": policy.SECTION_MINUTES, **section_format(db, retest),
        "message": _STATUS_MESSAGES.get(retest.status), "expires_at": _iso(retest.expires_at),
        "assessment": {"title": job.title if job else None, "role": job.role if job else None, "company_name": (job.company_name or None) if job else None,
                       "organization_name": org.name if org else None},
        "rules": _rules(),
    }


def _rules() -> List[Any]:
    from services import assessment_rules
    return assessment_rules.candidate_rules()


def list_for_student(db: Session, user: models.User) -> List[Dict[str, Any]]:
    """The signed-in student's own open retests (nothing of anyone else's)."""
    regs = [r[0] for r in db.query(models.CandidateRegistration.id).filter(models.CandidateRegistration.student_user_id == user.id)]
    if not regs:
        return []
    rows = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.registration_id.in_(regs),
                                                    models.AssessmentRetest.status.in_(("ASSIGNED", "IN_PROGRESS"))).all()
    out = []
    for r in rows:
        settle(db, r.id)
    db.expire_all()
    for r in db.query(models.AssessmentRetest).filter(models.AssessmentRetest.registration_id.in_(regs),
                                                      models.AssessmentRetest.status == "ASSIGNED").order_by(models.AssessmentRetest.id).all():
        job = db.query(models.JobDescription).filter(models.JobDescription.id == r.job_description_id).first()
        out.append({"retest_uuid": r.retest_uuid, "section": r.section.lower(), "label": SECTION_LABELS[r.section], "status": r.status,
                    "job_title": job.title if job else None, "expires_at": _iso(r.expires_at), "assigned_at": _iso(r.assigned_at)})
    return out


# ==============================================================================
# The sitting
# ==============================================================================
def _deadline(retest: models.AssessmentRetest) -> datetime:
    return clock.aware(retest.section_deadline_at)


def expired(retest: models.AssessmentRetest, now: Optional[datetime] = None) -> bool:
    """
    True once the server clock has reached the stored expiry (>=, not >). A row without an expiry can never be valid: missing data is
    treated as expired, never as indefinite access. The stored value is what counts, so assignments made under an earlier validity
    period keep exactly the expiry they were given.
    """
    exp = clock.aware(retest.expires_at)
    return exp is None or (now or clock.now()) >= exp


def _expire(retest: models.AssessmentRetest) -> None:
    """Ends an open retest whose validity ran out: no score is applied and any saved draft is not graded."""
    _release(retest, "EXPIRED")
    retest.access_token_hash = None
    retest.evaluation_payload = {"status": "EXPIRED", "reason": "validity_ended", "score": None}


def build_state(retest: models.AssessmentRetest, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or clock.now()
    live = retest.status == "IN_PROGRESS"
    out: Dict[str, Any] = {"retest_uuid": retest.retest_uuid, "state": f"{retest.section}_IN_PROGRESS" if live else retest.status,
                           "terminal": not live, "server_time": now.isoformat(),
                           "heartbeat_interval_seconds": flow.HEARTBEAT_INTERVAL_SECONDS}
    if live:
        deadline = _deadline(retest)
        remaining = max(0, int((deadline - now).total_seconds()))
        out["overall_deadline_at"] = deadline.isoformat()
        out["overall_remaining_seconds"] = remaining
        out["section"] = {"key": retest.section.lower(), "label": SECTION_LABELS[retest.section], "index": 1, "total_sections": 1,
                          "started_at": _iso(retest.started_at), "deadline_at": deadline.isoformat(), "remaining_seconds": remaining,
                          "questions": retest.questions_payload}
    else:
        out["message"] = _STATUS_MESSAGES.get(retest.status, "This retest is no longer active.")
    return out


def start(db: Session, retest_uuid: str, *, token: Optional[str], viewer_id: Optional[int], acknowledged: bool) -> Dict[str, Any]:
    if acknowledged is not True:
        raise _http(422, "You must acknowledge the assessment rules before starting.")
    probe = find(db, retest_uuid)
    authorize_owner(db, probe, token=token, viewer_id=viewer_id)
    pk = probe.id
    db.rollback()
    settle(db, pk)
    db.rollback()

    row = lock_retest(db, pk)
    if row.status != "ASSIGNED":
        message = _STATUS_MESSAGES.get(row.status, "This retest is not available.")
        db.rollback()
        raise _http(409, "This retest has already been started and cannot be resumed." if row.status == "IN_PROGRESS" else message)
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == row.session_id).first()
    if session is None or session.current_state not in ASSIGNABLE_ATTEMPT_STATES:
        db.rollback()
        raise _http(409, "This retest is no longer available. Please contact the hiring team.")
    original = db.query(models.RoleReadyRoundAttempt).filter(
        models.RoleReadyRoundAttempt.session_id == session.id, models.RoleReadyRoundAttempt.round_type == row.section).first()
    if original is None:
        db.rollback()
        raise _http(409, "This retest is no longer available. Please contact the hiring team.")

    now = clock.now()
    if expired(row, now):                                                   # validity ended between the check above and the lock
        _expire(row)
        db.commit()
        db.rollback()
        raise _http(409, _STATUS_MESSAGES["EXPIRED"])
    session_token, lease = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    keys = {k: v for k, v in (original.server_keys_payload or {}).items() if k != elevenlabs_service.STATE_KEY}
    row.questions_payload = copy.deepcopy(original.questions_payload)       # the same blueprint questions the attempt used
    row.server_keys_payload = copy.deepcopy(keys)
    row.submission_payload = None
    row.proctoring_violations = []
    row.capability_hash = flow.sha256_hex(session_token)
    row.lease_hash = flow.sha256_hex(lease)
    row.access_token_hash = None                                           # the hand-over token is single use
    row.last_heartbeat_at = clock.naive_utc(now)
    row.started_at = clock.naive_utc(now)
    # the 20 minute section clock never outlives the retest's validity (a sitting cannot run past its expiry)
    row.section_deadline_at = clock.naive_utc(min(now + timedelta(minutes=policy.SECTION_MINUTES), clock.aware(row.expires_at)))
    row.status = "IN_PROGRESS"
    db.commit()
    row = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == pk).first()
    state = build_state(row, now)
    db.rollback()
    return {"retest_uuid": retest_uuid, "session_token": session_token, "session_lease": lease, "state": state}


def abandon(db: Session, retest_pk: int, reason: str) -> bool:
    """Server-evidenced abandonment (lost heartbeat / missing lease). The effective score is not touched."""
    row = lock_retest(db, retest_pk)
    if row.status != "IN_PROGRESS":
        db.rollback()
        return False
    _release(row, "ABANDONED")
    row.evaluation_payload = {"status": "ABANDONED", "reason": reason, "score": None}
    db.commit()
    return True


def load(db: Session, retest_uuid: str, session_token: Optional[str], lease_token: Optional[str], *, require_lease: bool = True,
         allow_terminal: bool = False, viewer=None) -> models.AssessmentRetest:
    probe = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.retest_uuid == (retest_uuid or "")[:64]).first()
    if probe is None:
        raise _http(404, "Retest not found.")
    if not session_token:
        raise _http(401, "Session capability required.")
    if not flow._hash_matches(session_token, probe.capability_hash):
        raise _http(403, "Invalid session capability.")
    if viewer is not None:
        owner = db.query(models.CandidateRegistration.student_user_id).filter(models.CandidateRegistration.id == probe.registration_id).scalar()
        if owner is not None and viewer() != owner:
            db.rollback()
            raise _http(401, "Sign in with your student account to continue this retest.")
    pk = probe.id
    db.rollback()
    row = lock_retest(db, pk)
    if row.status != "IN_PROGRESS":
        if allow_terminal:
            return row
        message = _STATUS_MESSAGES.get(row.status, "This retest is no longer active.")
        db.rollback()
        raise _http(409, message)
    if expired(row):                                                        # a sitting cannot be used (or resumed) after the validity ended
        _expire(row)
        db.commit()
        db.rollback()
        raise _http(409, _STATUS_MESSAGES["EXPIRED"])
    if require_lease and not flow._hash_matches(lease_token, row.lease_hash):
        now = clock.now()
        hb = clock.aware(row.last_heartbeat_at)
        db.rollback()
        if hb is not None and (now - hb).total_seconds() <= flow.FRESH_HEARTBEAT_SECONDS:
            raise _http(409, "Active assessment sitting detected in another window. Simultaneous multi-tab access is prohibited.")
        abandon(db, pk, "lease_missing")
        raise _http(409, "Session interrupted. Page refresh detected. In accordance with strict recruitment integrity rules, assessments cannot be resumed after a reload.")
    return row


def _enforce_expiry(db: Session, retest: models.AssessmentRetest) -> models.AssessmentRetest:
    pk = retest.id
    if retest.status == "IN_PROGRESS" and clock.now() > _deadline(retest) + timedelta(seconds=policy.TRANSIT_WINDOW_SECONDS):
        db.rollback()
        try:
            close(db, pk, None, auto=True)
        except HTTPException:
            pass
        return db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == pk).populate_existing().first()
    return retest


def get_state(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    retest = _enforce_expiry(db, retest)
    out = build_state(retest)
    db.rollback()
    return out


def heartbeat(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    pk = retest.id
    retest = _enforce_expiry(db, retest)
    if retest.status == "IN_PROGRESS":
        retest = lock_retest(db, pk)
        retest.last_heartbeat_at = _now_db()
        db.commit()
    out = build_state(retest)
    db.rollback()
    if "section" in out:
        out["section"] = {k: v for k, v in out["section"].items() if k != "questions"}
    return out


def save_draft(db: Session, retest: models.AssessmentRetest, section: str, payload: Dict[str, Any], violations: Any = None) -> Dict[str, Any]:
    if (section or "").upper() != retest.section:
        db.rollback()
        raise _http(403, "That section is not assigned to you.")
    now = clock.now()
    if now >= _deadline(retest):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    normalized = flow._normalize_payload(retest.section, payload, retest)
    retest.submission_payload = {**normalized, "final": False, "saved_at": now.isoformat()}
    if violations is not None:
        retest.proctoring_violations = flow._clean_violations(violations)
    db.commit()
    return {"saved": True, "server_time": now.isoformat()}


def start_section(db: Session, retest: models.AssessmentRetest, section: str) -> Dict[str, Any]:
    """start-coding / start-interview of the shared workspace: only the assigned section is ever unlocked."""
    if section.upper() != retest.section:
        db.rollback()
        raise _http(403, f"The {SECTION_LABELS[section.upper()]} section is not assigned to you.")
    if clock.now() >= _deadline(retest):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    out = build_state(retest)
    db.rollback()
    return out


def run_code(db: Session, retest: models.AssessmentRetest, problem_id: str, language: Optional[str], code: str,
             custom_input: Optional[str] = None) -> Dict[str, Any]:
    if retest.section != "CODING":
        db.rollback()
        raise _http(403, "The coding section is not assigned to you.")
    if clock.now() >= _deadline(retest):
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    problem = next((p for p in (retest.questions_payload or []) if str(p.get("id")) == str(problem_id)), None)
    key = (retest.server_keys_payload or {}).get(str(problem_id)) or {}
    comparison, driver = key.get("comparison", "text"), key.get("driver")
    limiter_key = f"retest:{retest.id}"
    db.rollback()                                       # never hold a DB lock while the sandbox runs
    if problem is None:
        raise _http(404, "Problem not found.")
    try:
        lang = engine.normalize_language(language)
    except ValueError as exc:
        raise _http(400, str(exc))
    if lang != "python":
        raise _http(400, flow.PYTHON_ONLY_DETAIL)
    if len((code or "").encode("utf-8")) > engine.MAX_CODE_BYTES:
        raise _http(400, "Code exceeds the 64 KB submission limit.")
    if custom_input is not None and len(custom_input) > 5000:
        raise _http(400, "Your testcase is too long (limit 5000 characters).")
    if not flow.run_code_limiter.allow(limiter_key):
        raise _http(429, "Too many code runs. Please wait a moment.")
    if not flow.run_code_gate.acquire(limiter_key):
        raise _http(429, "A code run is already in progress.")
    try:
        result = student_code_run.run_samples(problem, code, lang, driver=driver, custom_input=custom_input, comparison=comparison)
    except engine.SandboxBusy:
        raise _http(429, "The code runner is busy. Please retry in a few seconds.")
    except engine.SandboxUnavailable:
        raise _http(503, "The code runner is temporarily unavailable. Your work is not affected.")
    finally:
        flow.run_code_gate.release(limiter_key)
    return {**result, "problem_id": problem_id}


# ------------------------------------------------------------------------------ voice interview (the shared ElevenLabs builder)
def _require_interview(db: Session, retest: models.AssessmentRetest) -> datetime:
    if retest.section != "INTERVIEW":
        db.rollback()
        raise _http(403, "The AI Technical Interview section is not assigned to you.")
    deadline = _deadline(retest)
    if clock.now() >= deadline:
        db.rollback()
        raise _http(408, "Assessment round deadline reached. No further work permitted.")
    return deadline


def voice_init(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    deadline = _require_interview(db, retest)
    if not retest_voice_init_limiter.allow(retest.id):
        db.rollback()
        raise _http(429, "Too many voice-interview connection attempts. Please wait a moment and try again.")
    now = clock.now()
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == retest.session_id).first()
    job = db.query(models.JobDescription).filter(models.JobDescription.id == retest.job_description_id).first()
    reg = db.query(models.CandidateRegistration).filter(models.CandidateRegistration.id == retest.registration_id).first()
    client_questions = list(retest.questions_payload or [])
    candidate_name = reg.name if reg and reg.name else "Candidate"
    role = (session.target_role if session else None) or (job.role if job else None) or "the role"
    company = session.target_company if session else None
    skills = ", ".join(job.required_skills or []) if job is not None and isinstance(job.required_skills, list) else ""
    jd_summary = (f"Target Role: {role}. Required Skills: {skills}. JD Context: {((job.description or '') if job else '')[:600]}").strip()
    remaining = max(1, int((deadline - now).total_seconds()))
    started_at, retest_pk, session_uuid = _iso(retest.started_at), retest.id, retest.retest_uuid
    db.rollback()

    voice_config = None
    try:
        voice_session = elevenlabs_service.build_voice_session(
            candidate_name=candidate_name, role=f"{role} at {company}" if company else role, resume_summary="",
            custom_instructions=f"Conduct a rigorous, professional interview evaluating the candidate against: {jd_summary}. Focus on asking the {len(client_questions)} questions one by one.",
            questions=client_questions, jd_summary=jd_summary, max_duration_seconds=remaining)
        fresh = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == retest_pk).first()
        elevenlabs_service.store_voice_session(db, fresh, voice_session)
        elevenlabs_service.prewarm_opening(voice_session)
        voice_config = elevenlabs_service.public_voice_config(voice_session)
    except Exception as exc:  # never leak the provider error; the candidate is offered a retry
        db.rollback()
        print(f"[Retest] Voice interview setup failed: {type(exc).__name__}")
    return {"session_uuid": session_uuid, "voiceConfig": voice_config, "questions": client_questions, "role": role,
            "company": company or "Target Company", "candidateName": candidate_name, "duration": policy.SECTION_MINUTES,
            "started_at": started_at, "deadline_at": deadline.isoformat(), "remaining_seconds": remaining, "server_time": now.isoformat()}


def _voice_session_for_turn(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    _require_interview(db, retest)
    if not retest_voice_turn_limiter.allow(retest.id):
        db.rollback()
        raise _http(429, "Too many voice requests. Please wait a moment and try again.")
    voice_session = elevenlabs_service.load_voice_session(retest)
    db.rollback()
    if voice_session is None:
        raise _http(409, "The voice interview has not been initialised. Reload and try again.")
    return voice_session


def voice_turn(db: Session, retest: models.AssessmentRetest, audio, content_type: str, history, opening: bool) -> Dict[str, Any]:
    voice_session = _voice_session_for_turn(db, retest)
    try:
        return elevenlabs_service.run_turn(voice_session, audio=audio, content_type=content_type, history=history, opening=opening)
    except elevenlabs_service.VoiceServiceError as exc:
        raise _http(exc.status_code, exc.public_message)


def voice_turn_stream(db: Session, retest: models.AssessmentRetest, audio, content_type: str, history, opening: bool):
    voice_session = _voice_session_for_turn(db, retest)
    return elevenlabs_service.run_turn_stream(voice_session, audio=audio, content_type=content_type, history=history, opening=opening)


def voice_caption_session(db: Session, retest: models.AssessmentRetest) -> Dict[str, Any]:
    _require_interview(db, retest)
    if not retest_caption_limiter.allow(retest.id):
        db.rollback()
        raise _http(429, "Too many caption requests. Please wait a moment and try again.")
    db.rollback()
    try:
        return elevenlabs_service.realtime_caption_session()
    except elevenlabs_service.VoiceServiceError as exc:
        raise _http(exc.status_code, exc.public_message)


# ==============================================================================
# Submission, evaluation, acceptance
# ==============================================================================
def _evaluate(db: Session, session: models.RoleReadySession, retest: models.AssessmentRetest) -> Dict[str, Any]:
    """The shared evaluators; any unexpected failure leaves the retest unevaluated (never a score)."""
    try:
        return flow.evaluate_round(db, session, retest)
    except Exception as exc:
        print(f"[Retest] evaluation failed: {type(exc).__name__}")
        return {"status": "EVALUATION_PENDING", "score": None, "pending_reason": "Evaluation error"}


def submit(db: Session, retest: models.AssessmentRetest, payload: Optional[Dict[str, Any]], violations: Any = None) -> Dict[str, Any]:
    if retest.section == "CODING" and isinstance((payload or {}).get("solutions"), dict):
        for sol in payload["solutions"].values():
            if isinstance(sol, dict) and (sol.get("language") or "python") not in ("python", "python3"):
                raise _http(400, flow.PYTHON_ONLY_DETAIL)
    pk = retest.id
    db.rollback()
    return close(db, pk, payload, auto=False, violations=violations)


def close(db: Session, retest_pk: int, payload: Optional[Dict[str, Any]], *, auto: bool = False, violations: Any = None) -> Dict[str, Any]:
    """Phase A (locked) persists the final submission; phase B evaluates with no lock; phase C (locked) accepts or parks the result."""
    row = lock_retest(db, retest_pk)
    if row.status != "IN_PROGRESS":
        message = _STATUS_MESSAGES.get(row.status, "This retest is no longer active.")
        db.rollback()
        raise _http(409, "This section has already been submitted." if row.status in ("SUBMITTED", "EVALUATION_PENDING", "COMPLETED") else message)
    now = clock.now()
    if expired(row, now):
        # Validity ended: there is no transit window for this. The submission is refused and nothing is graded or applied.
        _expire(row)
        db.commit()
        db.rollback()
        raise _http(409, _STATUS_MESSAGES["EXPIRED"])
    late = False
    if not auto and now > _deadline(row) + timedelta(seconds=policy.TRANSIT_WINDOW_SECONDS):
        auto, late = True, True
    if auto or payload is None:
        final = {k: v for k, v in (row.submission_payload or {}).items() if k in ("answers", "solutions", "transcript")}
    else:
        final = flow._normalize_payload(row.section, payload, row)
    if auto and not final:
        # The time ran out and nothing was ever saved: there is no work to grade, so the previous score must stand.
        _release(row, "EXPIRED")
        db.commit()
        out = build_state(row, now)
        db.rollback()
        if late:
            out["message"] = "The retest time limit has expired."
            raise _http(408, out)
        return out
    row.submission_payload = {**final, "final": True, "auto_closed": bool(auto), "submitted_at": now.isoformat()}
    if violations is not None:
        row.proctoring_violations = flow._clean_violations(violations)
    row.status = "SUBMITTED"
    row.submitted_at = clock.naive_utc(now)
    started = clock.aware(row.started_at)
    row.time_spent_seconds = max(0, int((now - started).total_seconds())) if started else 0
    db.commit()

    row = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == retest_pk).populate_existing().first()
    session = db.query(models.RoleReadySession).filter(models.RoleReadySession.id == row.session_id).first()
    evaluation = _evaluate(db, session, row)
    db.rollback()

    out = _finish(db, retest_pk, evaluation)
    if late:
        out["message"] = "Submission arrival window has expired. Your saved work was submitted automatically."
        raise _http(408, out)
    return out


def _finish(db: Session, retest_pk: int, evaluation: Dict[str, Any]) -> Dict[str, Any]:
    """Phase C. Accepts the evaluation only if it succeeded; the whole acceptance is one transaction and applies at most once."""
    session_pk = db.query(models.AssessmentRetest.session_id).filter(models.AssessmentRetest.id == retest_pk).scalar()
    db.rollback()
    if session_pk is None:
        raise _http(404, "Retest not found.")
    session = flow.lock_session(db, session_pk)           # attempt first, then the retest: one lock order everywhere
    row = lock_retest(db, retest_pk)
    if row.status not in ("SUBMITTED", "EVALUATION_PENDING"):
        out = build_state(row)                            # already applied / cancelled: a repeat delivery changes nothing
        db.rollback()
        out["duplicate"] = True
        return out

    score = evaluation.get("score")
    if evaluation.get("status") != "EVALUATED" or score is None:
        row.status = "EVALUATION_PENDING"                  # answers kept, nothing applied, an administrator can retry
        row.evaluation_payload = evaluation
        db.commit()
        out = build_state(row)
        db.rollback()
        out["evaluation_pending"] = True
        out["message"] = _STATUS_MESSAGES["EVALUATION_PENDING"]
        return out

    if session.current_state not in ASSIGNABLE_ATTEMPT_STATES:
        _release(row, "CANCELLED")                         # the attempt was meanwhile archived / reopened: do not touch it
        db.commit()
        out = build_state(row)
        db.rollback()
        return out

    now = clock.now()
    _accept(db, session, row, evaluation, now)
    db.commit()
    out = build_state(row, now)
    db.rollback()
    if row.section == "INTERVIEW":
        fresh = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == retest_pk).first()
        elevenlabs_service.release_voice_session(db, fresh)
        db.rollback()
    return out


def _accept(db: Session, session: models.RoleReadySession, retest: models.AssessmentRetest, evaluation: Dict[str, Any], now: datetime) -> None:
    """The targeted update. Runs inside the caller's transaction with the attempt and the retest locked."""
    rounds = flow.get_rounds(db, session.id)
    rnd = rounds[retest.section]
    key = retest.section.lower()
    old_report = copy.deepcopy(session.final_report_data) if isinstance(session.final_report_data, dict) else None

    # 1. archive the evidence being replaced (history only: it is never read back as the current result)
    retest.previous_snapshot = {
        "status": rnd.status, "score": rnd.score, "evaluation_payload": rnd.evaluation_payload, "submission_payload": rnd.submission_payload,
        "proctoring_violations": rnd.proctoring_violations, "started_at": _iso(rnd.started_at), "submitted_at": _iso(rnd.submitted_at),
        "evaluated_at": _iso(rnd.evaluated_at), "time_spent_seconds": rnd.time_spent_seconds,
        "effective_score": (((old_report or {}).get("sections") or {}).get(key) or {}).get("score")}

    # 2. only the retested section's round receives the new, evaluated result
    flow._apply_evaluation(rnd, evaluation)
    rnd.submission_payload = copy.deepcopy(retest.submission_payload)
    rnd.proctoring_violations = copy.deepcopy(retest.proctoring_violations or [])
    rnd.started_at, rnd.submitted_at = retest.started_at, retest.submitted_at
    rnd.time_spent_seconds = retest.time_spent_seconds

    # 3. the existing completion rule (the one retry_pending_evaluation uses) is the only way a retest can complete an attempt
    if session.current_state == "EVALUATION_PENDING" and all(r.status == "EVALUATED" for r in rounds.values()):
        session.current_state = "COMPLETED"
        session.finalized_at = clock.naive_utc(now)
        session.completed_at = clock.naive_utc(now)

    # 4. the overall score comes from the existing report builder (assessment_policy.overall_score); write only what changed
    report = flow.build_report(session, rounds)
    setattr(session, SCORE_COLUMN[retest.section], float(policy.normalize_pct((evaluation or {}).get("score")) or 0.0))
    session.overall_readiness_score = float(report["overall_score"] or 0.0)
    merged = old_report if old_report is not None else report
    merged.setdefault("sections", {})
    merged["sections"][key] = report["sections"][key]
    for field in ("overall_score", "overall_status", "complete", "state"):
        merged[field] = report[field]
    session.final_report_data = merged                    # a new object: the JSON column change is detected

    retest.retest_score = policy.normalize_pct(evaluation.get("score"))
    retest.evaluation_payload = evaluation
    retest.evaluated_at = clock.naive_utc(now)
    retest.completed_at = clock.naive_utc(now)
    _release(retest, "COMPLETED")


# ==============================================================================
# Lazy settlement of retests that nobody finished (no background job needed)
# ==============================================================================
def settle(db: Session, retest_pk: int) -> None:
    """Expires an unstarted retest past its validity, abandons a sitting that lost its heartbeat, closes one that ran out of time."""
    row = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.id == retest_pk).populate_existing().first()
    if row is None:
        db.rollback()
        return
    now = clock.now()
    status = row.status
    lapsed = status in ("ASSIGNED", "IN_PROGRESS") and expired(row, now)
    out_of_time = status == "IN_PROGRESS" and row.section_deadline_at is not None and now > _deadline(row) + timedelta(seconds=policy.TRANSIT_WINDOW_SECONDS)
    hb = clock.aware(row.last_heartbeat_at)
    stale = status == "IN_PROGRESS" and hb is not None and (now - hb).total_seconds() > ABANDON_AFTER_SECONDS
    db.rollback()
    if lapsed:
        locked = lock_retest(db, retest_pk)
        if locked.status in ("ASSIGNED", "IN_PROGRESS") and expired(locked):   # re-checked under the lock; finished / cancelled rows are never touched
            _expire(locked)
            db.commit()
        else:
            db.rollback()
    elif out_of_time:
        try:
            close(db, retest_pk, None, auto=True)
        except HTTPException:
            pass
    elif stale:
        abandon(db, retest_pk, "heartbeat_lost")


def authorize_proctoring(db: Session, retest_uuid: Optional[str], session_token: Optional[str]) -> int:
    """Read-only check for the shared proctoring service: the caller holds the capability of a retest sitting that is in progress."""
    if not retest_uuid or not session_token:
        raise _http(401, "Authentication required.")
    probe = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.retest_uuid == retest_uuid[:64]).first()
    allowed = probe is not None and flow._hash_matches(session_token, probe.capability_hash) and probe.status == "IN_PROGRESS"
    pk = probe.id if allowed else None
    db.rollback()
    if pk is None:
        raise _http(403, "Not authorized.")
    return pk
