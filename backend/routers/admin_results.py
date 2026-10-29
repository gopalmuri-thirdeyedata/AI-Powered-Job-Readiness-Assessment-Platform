"""
Admin results API (plan Task 8): overview KPIs, paginated roster, candidate dossier, registration reset,
audited infrastructure-outage retake, evaluation retry, and platform incident reconciliation.
Every query is scoped to TenantContext.tenant_id. Candidate contact details are only ever returned here.
"""
import json
import math
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, desc, asc, func, or_
from sqlalchemy.orm import Session

import database
import models
from routers.auth import TenantContext, require_admin_user, require_organization_admin_context, require_platform_admin
from services import assessment_clock as clock
from services import assessment_flow_service as flow
from services import assessment_sweeper_service as sweeper
from services import retest_service as retests
from services import share_link_policy as link_policy

router = APIRouter(prefix="/api/admin/recruitment", tags=["admin-recruitment"])

INCOMPLETE_STATES = ("TIMED_OUT", "ABANDONED", "INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED")
PENDING_REVIEW_STATES = ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED", "EVALUATION_PENDING")
STATUS_FILTERS = {"COMPLETED", "INCOMPLETE", "TIMED_OUT", "ABANDONED", "IN_PROGRESS", "REGISTERED", "EVALUATION_PENDING",
                  "INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED", "REVOKED_RETRIED"}

Reg, Sess, JD = models.CandidateRegistration, models.RoleReadySession, models.JobDescription


def roster_status(session: Optional[models.RoleReadySession]) -> str:
    if session is None:
        return "REGISTERED"
    if session.current_state in flow.IN_PROGRESS_STATES:
        return "IN_PROGRESS"
    return session.current_state


def _iso(dt):
    return clock.aware(dt).isoformat() if dt else None


def _audit(db: Session, ctx: TenantContext, action: str, target: str, details: str):
    db.add(models.ActivityLog(user_id=ctx.user.id, organization_id=ctx.tenant_id, action=action, target=target, details=details))


def _row(reg: models.CandidateRegistration, session: Optional[models.RoleReadySession], job_title: Optional[str]) -> Dict[str, Any]:
    complete = session is not None and session.current_state == "COMPLETED"
    return {
        "id": reg.id,
        "name": reg.name,
        "email": reg.email,
        "phone": reg.phone,
        "job_role_id": reg.job_description_id,
        "job_role_title": job_title,
        "status": roster_status(session),
        "registered_at": _iso(reg.created_at),
        "started_at": _iso(session.started_at) if session else None,
        "finalized_at": _iso(session.finalized_at) if session else None,
        "aptitude_score": flow.policy.display_pct(session.aptitude_score) if session and _has(session, "aptitude") else None,
        "coding_score": flow.policy.display_pct(session.coding_score) if session and _has(session, "coding") else None,
        "interview_score": flow.policy.display_pct(session.interview_score) if session and _has(session, "interview") else None,
        "overall_score": session.overall_readiness_score if complete else None,
        "needs_review": bool(session and session.current_state in PENDING_REVIEW_STATES),
    }


def _has(session: models.RoleReadySession, key: str) -> bool:
    """A section score is meaningful only if that section was evaluated (otherwise it stays null, never a fake 0)."""
    sec = ((session.final_report_data or {}).get("sections") or {}).get(key) or {}
    return sec.get("score") is not None


@router.get("/overview-stats")
def overview_stats(db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    org = ctx.tenant_id
    now_db = clock.naive_utc(clock.now())
    active_jobs = db.query(func.count(JD.id)).filter(
        JD.organization_id == org, JD.is_published.is_(True), JD.status == "PUBLISHED",
        or_(JD.share_link_expires_at.is_(None), JD.share_link_expires_at > now_db)).scalar() or 0
    total_regs = db.query(func.count(Reg.id)).filter(Reg.organization_id == org).scalar() or 0
    by_state = dict(db.query(Sess.current_state, func.count(Sess.id)).filter(
        Sess.organization_id == org, Sess.workflow_type == flow.WORKFLOW_TYPE).group_by(Sess.current_state).all())
    completed = by_state.get("COMPLETED", 0)
    incomplete = sum(by_state.get(s, 0) for s in INCOMPLETE_STATES)
    in_progress = sum(by_state.get(s, 0) for s in flow.IN_PROGRESS_STATES)
    pending_review = sum(by_state.get(s, 0) for s in PENDING_REVIEW_STATES)
    avg = db.query(func.avg(Sess.overall_readiness_score)).filter(
        Sess.organization_id == org, Sess.workflow_type == flow.WORKFLOW_TYPE, Sess.current_state == "COMPLETED").scalar()
    return {
        "active_jobs": active_jobs,
        "total_registrations": total_regs,
        "not_started": max(0, total_regs - sum(by_state.values())),
        "in_progress": in_progress,
        "completed": completed,
        "incomplete": incomplete,
        "pending_review": pending_review,
        "average_score": round(float(avg), 2) if avg is not None else None,
    }


@router.get("/candidates")
def list_candidates(
    search: Optional[str] = Query(None, max_length=100),
    job_role_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    sort: str = Query("date", pattern="^(date|score|name)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(database.get_db),
    ctx: TenantContext = Depends(require_admin_user),
):
    q = db.query(Reg, Sess, JD.title).outerjoin(Sess, Sess.registration_id == Reg.id).join(JD, JD.id == Reg.job_description_id).filter(
        Reg.organization_id == ctx.tenant_id)
    if job_role_id is not None:
        q = q.filter(Reg.job_description_id == job_role_id)
    if search and search.strip():
        term = search.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{term}%"
        q = q.filter(or_(func.lower(Reg.name).like(like, escape="\\"), func.lower(Reg.email).like(like, escape="\\")))
    if status_filter:
        sf = status_filter.strip().upper()
        if sf not in STATUS_FILTERS:
            raise HTTPException(status_code=422, detail=f"Unknown status filter. Use one of: {', '.join(sorted(STATUS_FILTERS))}")
        if sf == "REGISTERED":
            q = q.filter(Sess.id.is_(None))
        elif sf == "IN_PROGRESS":
            q = q.filter(Sess.current_state.in_(flow.IN_PROGRESS_STATES))
        elif sf == "INCOMPLETE":
            q = q.filter(Sess.current_state.in_(INCOMPLETE_STATES))
        else:
            q = q.filter(Sess.current_state == sf)

    total = q.with_entities(func.count(Reg.id)).order_by(None).scalar() or 0
    direction = desc if order == "desc" else asc
    if sort == "score":
        key = case([(Sess.current_state == "COMPLETED", Sess.overall_readiness_score)], else_=-1)
        q = q.order_by(direction(key), desc(Reg.id))
    elif sort == "name":
        q = q.order_by(direction(func.lower(Reg.name)), desc(Reg.id))
    else:
        q = q.order_by(direction(Reg.created_at), direction(Reg.id))
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [_row(r, s, title) for r, s, title in rows],
        "total": total, "page": page, "page_size": page_size, "pages": max(1, math.ceil(total / page_size)),
    }


def _get_registration(db: Session, ctx: TenantContext, reg_id: int) -> models.CandidateRegistration:
    reg = db.query(Reg).filter(Reg.id == reg_id, Reg.organization_id == ctx.tenant_id).first()
    if reg is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    return reg


def _session_for(db: Session, reg: models.CandidateRegistration) -> Optional[models.RoleReadySession]:
    return db.query(Sess).filter(Sess.registration_id == reg.id).first()


@router.get("/candidates/{reg_id}/dossier")
def candidate_dossier(reg_id: int, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    reg = _get_registration(db, ctx, reg_id)
    session = _session_for(db, reg)
    job = db.query(JD).filter(JD.id == reg.job_description_id).first()
    out: Dict[str, Any] = {
        "candidate": {"id": reg.id, "name": reg.name, "email": reg.email, "phone": reg.phone,
                      "registered_at": _iso(reg.created_at), "contact_verified": False},
        "job_role": {"id": job.id, "title": job.title, "company_name": job.company_name or None} if job else None,
        "status": roster_status(session),
        "session": None,
        "report": None,
        "actions": {"can_revoke": session is None and reg.status == "REGISTERED", "can_authorize_retake": False,
                    "can_reject_review": False, "can_retry_evaluation": False},
    }
    if session is None:
        return out
    rounds = flow.get_rounds(db, session.id)
    report = session.final_report_data if session.current_state == "COMPLETED" and session.final_report_data else flow.build_report(session, rounds)
    state = session.current_state
    can_retry = any(r.status == "EVALUATION_PENDING" for r in rounds.values()) and state != "COMPLETED"
    ack = db.query(models.ActivityLog).filter(
        models.ActivityLog.organization_id == ctx.tenant_id,
        models.ActivityLog.action == "ASSESSMENT_RULES_ACKNOWLEDGED",
        models.ActivityLog.target == f"session:{session.session_uuid}",
    ).order_by(models.ActivityLog.id.asc()).first()
    ack_at = None
    if ack is not None:
        try:
            ack_at = json.loads(ack.details or "{}").get("acknowledged_at")
        except ValueError:
            ack_at = None
    out["session"] = {
        "state": state,
        "rules_acknowledged_at": ack_at,
        "started_at": _iso(session.started_at), "overall_deadline_at": _iso(session.overall_deadline_at),
        "finalized_at": _iso(session.finalized_at), "abandoned_at": _iso(session.abandoned_at), "failed_at": _iso(session.failed_at),
        "last_heartbeat_at": _iso(session.last_heartbeat_at), "incident_reference_id": session.incident_reference_id,
    }
    out["report"] = report
    for r in retests.list_for_session(db, session.id):
        retests.settle(db, r.id)
    db.expire_all()
    # History only: the effective (current) scores are `report` above; a retest's own numbers are labelled as past attempts.
    out["retests"] = [retests.history_view(db, r) for r in retests.list_for_session(db, session.id)]
    out["timeline"] = [{"section": n.lower(), "status": rounds[n].status, "started_at": _iso(rounds[n].started_at),
                        "submitted_at": _iso(rounds[n].submitted_at), "time_spent_seconds": rounds[n].time_spent_seconds}
                       for n in flow.SECTION_ORDER if n in rounds]
    out["actions"].update({
        "can_authorize_retake": state in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED") and (ctx.is_platform_admin or (ctx.member and ctx.member.role == "ORGANIZATION_ADMIN")),
        "can_reject_review": state == "MANUAL_REVIEW_REQUIRED",
        "can_retry_evaluation": can_retry,
    })
    return out


# ------------------------------------------------------------------ section retests
class RetestAssignRequest(BaseModel):
    sections: List[str] = Field(default_factory=list, max_length=3)
    reason: Optional[str] = Field(None, max_length=1000)


def _get_retest(db: Session, ctx: TenantContext, retest_uuid: str) -> models.AssessmentRetest:
    row = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.retest_uuid == retest_uuid[:64],
                                                   models.AssessmentRetest.organization_id == ctx.tenant_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Retest not found.")
    return row


@router.get("/candidates/{reg_id}/retests")
def candidate_retests(reg_id: int, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    """The Retest dialog: candidate, role, the effective score of each section, open retests and the retest history."""
    reg = _get_registration(db, ctx, reg_id)
    job = db.query(JD).filter(JD.id == reg.job_description_id).first()
    return retests.overview(db, reg, _session_for(db, reg), job.title if job else None)


@router.post("/candidates/{reg_id}/retests", status_code=status.HTTP_201_CREATED)
def assign_retests(reg_id: int, body: RetestAssignRequest, db: Session = Depends(database.get_db),
                   ctx: TenantContext = Depends(require_admin_user)):
    reg = _get_registration(db, ctx, reg_id)
    return retests.assign(db, admin_user_id=ctx.user.id, reg=reg, sections=body.sections, reason=body.reason)


@router.post("/retests/{retest_uuid}/cancel")
def cancel_retest(retest_uuid: str, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    return retests.cancel(db, _get_retest(db, ctx, retest_uuid), ctx.user.id)


@router.post("/retests/{retest_uuid}/resend-email")
def resend_retest_email(retest_uuid: str, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    """Retry a FAILED candidate e-mail (never creates another assignment, never re-sends a SENT e-mail)."""
    return retests.resend_notification(db, _get_retest(db, ctx, retest_uuid), ctx.user.id)


@router.post("/retests/{retest_uuid}/retry-evaluation")
def retry_retest_evaluation(retest_uuid: str, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    return retests.retry_evaluation(db, _get_retest(db, ctx, retest_uuid))


@router.post("/registrations/{reg_id}/revoke")
def revoke_registration(reg_id: int, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    """Reset an UNSTARTED registration so the candidate can register cleanly again (identity is unverified by design)."""
    reg = _get_registration(db, ctx, reg_id)
    if reg.attempt_session_uuid or reg.status != "REGISTERED" or _session_for(db, reg) is not None:
        raise HTTPException(status_code=409, detail="Only a registration that has not started its attempt can be reset.")
    _audit(db, ctx, "REGISTRATION_REVOKED", f"registration:{reg.id}", f"job_role={reg.job_description_id}")
    db.delete(reg)
    db.commit()
    return {"revoked": True}


class RetakeRequest(BaseModel):
    justification: str = Field(..., min_length=10, max_length=2000)


@router.post("/candidates/{reg_id}/authorize-retake")
def authorize_outage_retake(reg_id: int, body: RetakeRequest, db: Session = Depends(database.get_db),
                            ctx: TenantContext = Depends(require_organization_admin_context)):
    """
    Org-Admin-only, audited retake for a verified platform outage (or a reviewed MANUAL_REVIEW_REQUIRED case).
    The old attempt is archived as REVOKED_RETRIED and the SAME registration receives a fresh single-use token.
    """
    reg = _get_registration(db, ctx, reg_id)
    session = _session_for(db, reg)
    if session is None or session.current_state not in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED"):
        raise HTTPException(status_code=409, detail="A retake can only be authorized for a verified infrastructure failure or a reviewed incident.")
    flow.begin_write(db, "roleready_sessions", session.id)
    session = db.query(Sess).filter(Sess.id == session.id).populate_existing().first()
    if session.current_state not in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED"):
        db.rollback()
        raise HTTPException(status_code=409, detail="The attempt changed state; reload and try again.")
    incident_ref = session.incident_reference_id
    token = secrets.token_urlsafe(32)
    session.current_state = "REVOKED_RETRIED"
    session.registration_id = None  # frees the UNIQUE(registration_id) slot; the archived attempt keeps its data
    session.finalized_at = clock.naive_utc(clock.now())
    reg.attempt_session_uuid = None
    reg.status = "REGISTERED"
    reg.registration_token_hash = flow.sha256_hex(token)
    _audit(db, ctx, "ASSESSMENT_RETAKE_AUTHORIZED", f"registration:{reg.id}",
           f"candidate_id={reg.id}; incident_reference_id={incident_ref}; justification={body.justification.strip()}")
    db.commit()
    job = db.query(JD).filter(JD.id == reg.job_description_id).first()
    return {"registration_token": token, "incident_reference_id": incident_ref,
            "share_token": job.share_token if job and job.is_published and not link_policy.is_expired(job, clock.now()) else None,
            "message": "Retake authorized. Share the single-use link with the candidate; the previous attempt was archived."}


@router.post("/candidates/{reg_id}/reject-review")
def reject_manual_review(reg_id: int, body: RetakeRequest, db: Session = Depends(database.get_db),
                         ctx: TenantContext = Depends(require_organization_admin_context)):
    reg = _get_registration(db, ctx, reg_id)
    session = _session_for(db, reg)
    if session is None or session.current_state != "MANUAL_REVIEW_REQUIRED":
        raise HTTPException(status_code=409, detail="Only an attempt under manual review can be rejected.")
    flow.begin_write(db, "roleready_sessions", session.id)
    session = db.query(Sess).filter(Sess.id == session.id).populate_existing().first()
    if session.current_state != "MANUAL_REVIEW_REQUIRED":
        db.rollback()
        raise HTTPException(status_code=409, detail="The attempt changed state; reload and try again.")
    now = clock.naive_utc(clock.now())
    session.current_state = "ABANDONED"
    session.abandoned_at = now
    session.finalized_at = now
    rounds = flow.get_rounds(db, session.id)
    flow._write_scores(session, rounds, flow.build_report(session, rounds))
    _audit(db, ctx, "ASSESSMENT_REVIEW_REJECTED", f"registration:{reg.id}",
           f"incident_reference_id={session.incident_reference_id}; justification={body.justification.strip()}")
    db.commit()
    return {"state": "ABANDONED"}


@router.post("/candidates/{reg_id}/retry-evaluation")
def retry_evaluation(reg_id: int, db: Session = Depends(database.get_db), ctx: TenantContext = Depends(require_admin_user)):
    reg = _get_registration(db, ctx, reg_id)
    session = _session_for(db, reg)
    if session is None:
        raise HTTPException(status_code=404, detail="No attempt exists for this candidate.")
    result = flow.retry_pending_evaluation(db, session.id)
    _audit(db, ctx, "EVALUATION_RETRIED", f"registration:{reg.id}", f"state={result['state']}")
    db.commit()
    return result


class IncidentRequest(BaseModel):
    outage_start_utc: datetime
    outage_resolved_utc: datetime
    affected_subsystems: List[str] = []
    telemetry_evidence_ref: Optional[str] = Field(None, max_length=255)
    telemetry_complete: bool = True


@router.post("/incidents")
def record_incident(body: IncidentRequest, db: Session = Depends(database.get_db), admin_user: models.User = Depends(require_platform_admin)):
    """Platform-admin only: register a corroborated outage window and reconcile affected in-progress sessions."""
    try:
        incident = sweeper.record_incident(db, body.outage_start_utc, body.outage_resolved_utc, body.affected_subsystems,
                                           body.telemetry_evidence_ref, body.telemetry_complete, created_by=admin_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    totals = sweeper.reconcile_infrastructure_failures(db, incident)
    return {"incident_reference_id": incident.incident_reference_id, "reconciliation": totals}
