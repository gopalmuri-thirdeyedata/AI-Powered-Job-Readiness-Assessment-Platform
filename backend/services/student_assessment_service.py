"""
Invited-student access to a shared-link assessment, the mandatory exam review, and the gated report.

This module only adds what is specific to students who already have an account. Attempt creation, timers, scoring, evaluation and
the report data itself stay in services.assessment_flow_service (the same engine candidates use):

  1. access()   an authenticated STUDENT of the assessment's organization gets (or re-gets) their own registration, created from
                the account: nothing is typed again, no account is created, and NO attempt or timer starts. The registration token
                it returns is only the "may press Start" capability; /start additionally requires the same signed-in student.
  2. review     one immutable review (>= 30 words) per attempt, owned by the student whose registration produced the attempt.
  3. report     released only to that owner, for a COMPLETED attempt whose report data exists AND whose review is saved.

Identity always comes from the authenticated account, never from the link, a student id or a role sent by the browser. Someone
else's attempt is reported as "not found" so its existence is not revealed.
"""
import logging
import secrets
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import utils
from services import assessment_clock as clock
from services import assessment_flow_service as flow
from services import review_policy

logger = logging.getLogger("prepwin.student_assessment")

Reg, Sess = models.CandidateRegistration, models.RoleReadySession

# Attempt states in which all three sections have been submitted: the student may write the review.
REVIEWABLE_STATES = ("COMPLETED", "EVALUATION_PENDING")


def _http(code: int, detail) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _coded(code: int, error_code: str, message: str) -> HTTPException:
    return _http(code, {"code": error_code, "message": message})


# ------------------------------------------------------------------------------ identity and authorization
def require_student(user: models.User) -> models.User:
    if getattr(user, "is_active", True) is False:
        raise _http(403, "This account is deactivated.")
    if str(getattr(user.role, "value", user.role)) != models.UserRole.STUDENT.value:
        raise _http(403, "Only student accounts can take this assessment. Sign in with your student account.")
    return user


def _profile(db: Session, user: models.User) -> Optional[models.StudentProfile]:
    return db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()


def display_name(db: Session, user: models.User) -> str:
    profile = _profile(db, user)
    name = " ".join((user.full_name or (profile.full_name if profile else "") or "").split())
    return name or (user.email or "Student").split("@")[0]


UNRESOLVED_ORG_ACTION = "STUDENT_ORGANIZATION_UNRESOLVED"


def student_organization_ids(db: Session, user: models.User) -> set:
    """
    Every organization the student account is authoritatively linked to: the account itself, its profile and its ACTIVE memberships.
    Nothing is inferred or defaulted: an account with none of these belongs to no organization and is refused (see below).
    """
    profile = _profile(db, user)
    orgs = {user.organization_id, profile.organization_id if profile else None}
    orgs |= {m.organization_id for m in db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == user.id, models.OrganizationMember.status == "active")}
    return orgs - {None}


def _record_unresolved_organization(db: Session, user: models.User, job: models.JobDescription) -> None:
    """Leaves an auditable note (once per student and assessment) for an administrator to link the account to its organization."""
    details = f"student_user_id={user.id}; job_role_id={job.id}; fix: assign this student to the correct organization (see scripts/audit_student_organizations.py)"
    exists = db.query(models.ActivityLog.id).filter(models.ActivityLog.action == UNRESOLVED_ORG_ACTION,
                                                    models.ActivityLog.target == user.email,
                                                    models.ActivityLog.details == details).first()
    if exists is None:
        db.add(models.ActivityLog(user_id=user.id, organization_id=job.organization_id, action=UNRESOLVED_ORG_ACTION,
                                  target=user.email, details=details))
        db.commit()


def _authorize_for_job(db: Session, user: models.User, job: models.JobDescription) -> None:
    """The student must belong to the organization that owns the assessment."""
    orgs = student_organization_ids(db, user)
    if job.organization_id in orgs:
        return
    if not orgs:
        _record_unresolved_organization(db, user, job)
        raise _http(403, "Your student account is not linked to an organization yet. Please contact your administrator.")
    raise _http(403, "This assessment is not available for your account. Please contact the hiring team.")


def _validate_retake_token(db: Session, user: models.User, job: models.JobDescription, token: str) -> None:
    """
    An administrator-authorised retake link names ONE student's registration. The token never replaces sign-in: it only has to belong
    to this job and to the signed-in account. Anything else is the same generic refusal (no hint whose link it is).
    """
    reg = db.query(Reg).filter(Reg.job_description_id == job.id, Reg.registration_token_hash == flow.sha256_hex(token)).first()
    if reg is None or reg.student_user_id != user.id:
        raise _http(403, "This link is not valid for your account.")
    if reg.attempt_session_uuid is not None or reg.status != "REGISTERED":
        raise _http(409, "This retake link has already been used.")


def find_job_any_state(db: Session, share_token: str) -> models.JobDescription:
    """The job behind a current OR retired link, regardless of expiry/closure (results stay reachable after the link ends)."""
    if not share_token or len(share_token) > 128:
        raise _http(404, "Assessment not found.")
    job = db.query(models.JobDescription).filter(models.JobDescription.share_token == share_token).first()
    if job is None:
        retired = db.query(models.JobShareLinkHistory).filter(models.JobShareLinkHistory.share_token == share_token).first()
        job = db.query(models.JobDescription).filter(models.JobDescription.id == retired.job_description_id).first() if retired else None
    if job is None:
        raise _http(404, "Assessment not found.")
    return job


def _registration_for(db: Session, job: models.JobDescription, user: models.User) -> Optional[models.CandidateRegistration]:
    email = utils.normalize_email(user.email)
    return db.query(Reg).filter(
        Reg.job_description_id == job.id,
        or_(Reg.student_user_id == user.id, func.lower(func.trim(Reg.email)) == email),
    ).first()


def _owned(reg: Optional[models.CandidateRegistration], user: models.User) -> bool:
    return reg is not None and reg.student_user_id == user.id


def _session_of(db: Session, reg: models.CandidateRegistration) -> Optional[models.RoleReadySession]:
    return db.query(Sess).filter(Sess.registration_id == reg.id).first()


# ------------------------------------------------------------------------------ summaries
def _review_of(db: Session, session: models.RoleReadySession) -> Optional[models.AssessmentReview]:
    return db.query(models.AssessmentReview).filter(models.AssessmentReview.session_id == session.id).first()


def _review_view(review: Optional[models.AssessmentReview]) -> Optional[Dict[str, Any]]:
    if review is None:
        return None
    ts = clock.aware(review.created_at)
    return {"text": review.review_text, "word_count": review.word_count, "submitted_at": ts.isoformat() if ts else None}


def report_blocker(session: models.RoleReadySession) -> Optional[Tuple[int, str, str]]:
    """(status, code, message) explaining why the report data is not available yet, or None when it is."""
    if session.current_state != "COMPLETED":
        if session.current_state == "EVALUATION_PENDING":
            return 409, "EVALUATION_PENDING", "Your assessment is still being evaluated. The report will be available when evaluation finishes."
        return 409, "NOT_COMPLETED", "The report is only available for a completed assessment."
    data = session.final_report_data
    sections = data.get("sections") if isinstance(data, dict) else None
    if not isinstance(sections, dict) or any((sections.get(s.lower()) or {}).get("status") != "EVALUATED" for s in flow.SECTION_ORDER):
        return 409, "REPORT_NOT_READY", "Your report is not ready yet. Please try again shortly."
    return None


def attempt_summary(db: Session, session: models.RoleReadySession) -> Dict[str, Any]:
    review = _review_of(db, session)
    blocker = report_blocker(session)
    return {
        "session_uuid": session.session_uuid,
        "state": session.current_state,
        "completed": session.current_state == "COMPLETED",
        "submitted": session.current_state in REVIEWABLE_STATES,
        "in_progress": session.current_state in flow.IN_PROGRESS_STATES,
        "min_review_words": review_policy.MIN_REVIEW_WORDS,
        "review": _review_view(review),
        "report_ready": blocker is None,
        "report_message": blocker[2] if blocker else None,
        "report_available": blocker is None and review is not None,
    }


# ------------------------------------------------------------------------------ 1. access (no attempt, no timer)
def access(db: Session, user: models.User, share_token: str, retake_token: Optional[str] = None) -> Dict[str, Any]:
    require_student(user)
    job = flow.get_open_job_by_token(db, share_token)          # 404 unknown / 410 expired / 410 closed, exactly like candidates
    _authorize_for_job(db, user, job)
    if retake_token:
        _validate_retake_token(db, user, job, retake_token)
    org = db.query(models.Organization).filter(models.Organization.id == job.organization_id).first()
    name = display_name(db, user)
    profile = _profile(db, user)
    phone = user.phone or (profile.phone if profile else None) or ""
    me = {"name": name, "email": user.email}

    reg = _registration_for(db, job, user)
    if reg is not None and reg.student_user_id not in (None, user.id):
        raise _http(409, "An assessment attempt has already been initiated for this email.")

    if reg is not None and (reg.attempt_session_uuid is not None or reg.status != "REGISTERED"):
        if not _owned(reg, user):
            # a pre-existing accountless registration for this e-mail was already used: single attempt, nothing to hand over
            raise _http(409, "An assessment attempt has already been initiated for this email.")
        session = _session_of(db, reg)
        return {"status": "ATTEMPTED", "student": me, "attempt": attempt_summary(db, session) if session else None}

    token = secrets.token_urlsafe(32)
    try:
        if reg is None:
            reg = Reg(registration_token_hash=flow.sha256_hex(token), job_description_id=job.id, organization_id=job.organization_id,
                      name=name[:150], phone=phone, email=utils.normalize_email(user.email), student_user_id=user.id,
                      blueprint_version=job.blueprint_version or None, status="REGISTERED")
            db.add(reg)
        else:
            # not started yet: hand out a fresh start capability (the previous one stops working) and claim the registration
            reg.registration_token_hash = flow.sha256_hex(token)
            reg.student_user_id = user.id
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _http(409, "Your access is being prepared in another window. Please try again.")
    return {"status": "READY", "student": me, "registration_token": token, "assessment": _assessment_meta(job, org)}


def _assessment_meta(job: models.JobDescription, org: Optional[models.Organization]) -> Dict[str, Any]:
    from routers.public_assessment import _meta   # the same public metadata (sections, time limits, rules): never questions
    return _meta(job, org.name if org else None)


# ------------------------------------------------------------------------------ owner lookups
def owned_session(db: Session, user: models.User, session_uuid: str) -> models.RoleReadySession:
    """The caller's own attempt, or 404. Another student's attempt is indistinguishable from one that does not exist."""
    require_student(user)
    session = db.query(Sess).filter(Sess.session_uuid == session_uuid, Sess.workflow_type == flow.WORKFLOW_TYPE).first()
    reg = db.query(Reg).filter(Reg.id == session.registration_id).first() if session is not None and session.registration_id else None
    if session is None or not _owned(reg, user):
        raise _http(404, "Assessment attempt not found.")
    return session


def result_for_link(db: Session, user: models.User, share_token: str) -> Dict[str, Any]:
    require_student(user)
    job = find_job_any_state(db, share_token)
    reg = _registration_for(db, job, user)
    session = _session_of(db, reg) if _owned(reg, user) else None
    if session is None:
        raise _http(404, "No assessment attempt was found for your account.")
    return {"assessment": {"title": job.title, "role": job.role}, "student": {"name": display_name(db, user), "email": user.email},
            "attempt": attempt_summary(db, session)}


# ------------------------------------------------------------------------------ 2. review
def submit_review(db: Session, user: models.User, session_uuid: str, text: Optional[str]) -> Dict[str, Any]:
    session = owned_session(db, user, session_uuid)
    if session.current_state not in REVIEWABLE_STATES:
        raise _coded(409, "NOT_SUBMITTED", "You can write your review once you have submitted the assessment.")
    problem = review_policy.validation_error(text)
    if problem:
        raise _coded(422, "REVIEW_TOO_SHORT" if text and text.strip() else "REVIEW_EMPTY", problem)
    cleaned = review_policy.clean(text)
    if _review_of(db, session) is not None:
        raise _coded(409, "REVIEW_ALREADY_SUBMITTED", "Your review has already been submitted and cannot be changed.")
    db.add(models.AssessmentReview(session_id=session.id, student_user_id=user.id, review_text=cleaned,
                                   word_count=review_policy.count_words(cleaned)))
    try:
        db.commit()
    except IntegrityError:   # a concurrent duplicate submit lost the UNIQUE(session_id) race
        db.rollback()
        raise _coded(409, "REVIEW_ALREADY_SUBMITTED", "Your review has already been submitted and cannot be changed.")
    return attempt_summary(db, session)


# ------------------------------------------------------------------------------ 3. report
def _pct(v: Any) -> Optional[float]:
    return v if isinstance(v, (int, float)) else None


def _student_section(key: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Whitelist view of one section: scores and personal feedback, never answer keys, source code, transcripts or proctoring data."""
    details = entry.get("details") or {}
    out: Dict[str, Any] = {"key": key, "label": flow.SECTION_LABELS.get(key.upper(), key.title()), "status": entry.get("status"),
                           "score": _pct(entry.get("score")), "time_spent_seconds": entry.get("time_spent_seconds") or 0}
    if key == "aptitude":
        out["summary"] = {"correct": details.get("correct"), "total": details.get("total")}
        out["questions"] = [{"question": q.get("question"), "domain": q.get("domain"), "selected": q.get("selected"),
                             "is_correct": bool(q.get("is_correct"))} for q in details.get("questions") or []]
    elif key == "coding":
        out["problems"] = [{"title": p.get("title"), "language": p.get("language"), "passed_tests": p.get("passed_tests"),
                            "total_tests": p.get("total_tests"), "score": _pct(p.get("score")), "message": p.get("message")}
                           for p in details.get("problems") or []]
    elif key == "interview":
        out["summary"] = details.get("summary")
        out["technical_depth_score"] = _pct(details.get("technical_depth_score"))
        out["communication_score"] = _pct(details.get("communication_score"))
        out["key_strengths"] = list(details.get("key_strengths") or [])
        out["key_areas_for_improvement"] = list(details.get("key_areas_for_improvement") or [])
        out["questions"] = [{"topic": q.get("topic"), "question": q.get("question_text"), "score": _pct(q.get("score")),
                             "status": q.get("status"), "feedback": q.get("explanation"), "strengths": list(q.get("strengths") or []),
                             "gaps": list(q.get("gaps") or [])} for q in details.get("questions") or []]
    return out


def build_student_report(db: Session, user: models.User, session: models.RoleReadySession) -> Dict[str, Any]:
    """The student's own report, derived ONLY from the stored final report of the attempt: nothing is recomputed or invented."""
    data = session.final_report_data
    sections = data["sections"]
    job = db.query(models.JobDescription).filter(models.JobDescription.id == session.job_description_id).first()
    completed = clock.aware(session.completed_at)
    return {
        "assessment": {"title": (job.title if job else session.jd_title), "role": session.target_role, "organization": session.target_company},
        "student": {"name": display_name(db, user), "email": user.email},
        "completed_at": completed.isoformat() if completed else None,
        "overall_score": _pct(data.get("overall_score")),
        "overall_status": data.get("overall_status"),
        "scoring_model": data.get("scoring_model"),
        "sections": [_student_section(s.lower(), sections[s.lower()]) for s in flow.SECTION_ORDER],
    }


def release_report(db: Session, user: models.User, session_uuid: str) -> Dict[str, Any]:
    """Every download precondition, in order. The review check lives here (not in the browser), so no direct call can skip it."""
    session = owned_session(db, user, session_uuid)                  # 1+2: authenticated (dependency) and the attempt's owner
    blocker = report_blocker(session)                                # 3+4: completed, evaluation and report data ready
    if blocker:
        raise _coded(*blocker)
    review = _review_of(db, session)                                 # 5: a valid review (>= 30 words) is saved
    if review is None or review_policy.count_words(review.review_text) < review_policy.MIN_REVIEW_WORDS:
        raise _coded(403, "REVIEW_REQUIRED", f"Submit your exam review (at least {review_policy.MIN_REVIEW_WORDS} words) to download the report.")
    try:
        return build_student_report(db, user, session)
    except Exception:
        logger.exception("Student report generation failed (session %s)", session_uuid)
        raise _coded(503, "REPORT_GENERATION_FAILED", "Your report could not be generated right now. Please try again.")
