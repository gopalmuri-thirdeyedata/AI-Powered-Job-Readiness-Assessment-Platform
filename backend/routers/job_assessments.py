"""
Admin job roles, Gemini blueprint generation and publish/close lifecycle (plan Task 4).
Every query is scoped to the request's TenantContext; there is no client-supplied organization id.
"""
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import database
import models
import utils
from routers.auth import TenantContext, require_admin_user
from routers.users import _tenant_users
from services import assessment_clock as clock
from services import assessment_invitation_service as invitations
from services import email_service
from services import gemini_client
from services import jd_blueprint_service as blueprints
from services import jd_document_service as jd_documents
from services import share_link_policy as link_policy

router = APIRouter(prefix="/api/admin/job-roles", tags=["admin-job-roles"])

SECTIONS = [
    {"key": "aptitude", "label": "Aptitude", "minutes": 20},
    {"key": "coding", "label": "Coding", "minutes": 20},
    {"key": "interview", "label": "AI Technical Interview", "minutes": 20},
]


class JobRoleCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    role: Optional[str] = Field(None, max_length=200)
    company_name: Optional[str] = Field(None, max_length=200)          # optional: never required
    description: str = Field(..., min_length=1, max_length=20000)
    required_skills: Optional[List[str]] = None


class InvitationRequest(BaseModel):
    student_ids: List[int] = Field(..., min_length=1, max_length=invitations.MAX_RECIPIENTS_PER_REQUEST)


class JobRoleUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=200)
    role: Optional[str] = Field(None, max_length=200)
    company_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, min_length=1, max_length=20000)
    required_skills: Optional[List[str]] = None


def share_path(token: Optional[str]) -> Optional[str]:
    return f"/assessment/join/{token}" if token else None


def share_url(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    base = (os.getenv("FRONTEND_URL", "http://localhost:5173") or "").rstrip("/")
    return f"{base}{share_path(token)}"


def _blueprint_summary(job: models.JobDescription) -> Optional[Dict[str, Any]]:
    data = job.blueprint_data
    if not isinstance(data, dict):
        return None
    try:
        blueprints.validate_blueprint(data)
        valid = True
    except ValueError:
        valid = False
    generation = data.get("generation") if isinstance(data.get("generation"), dict) else {}
    return {
        "version": job.blueprint_version,
        "valid": valid,
        # where the content came from: "gemini" | "offline_fixture" (dev mode); None for older blueprints
        "source": generation.get("source"),
        "role_title": data.get("role_title"),
        "seniority_level": data.get("seniority_level"),
        "required_technical_skills": data.get("required_technical_skills", []),
        "aptitude_count": len(data.get("aptitude_questions") or []),
        "coding_count": len(data.get("coding_problems") or []),
        "interview_count": len(data.get("interview_questions") or []),
    }


def serialize_role(job: models.JobDescription, include_blueprint: bool = False, registrations: Optional[int] = None) -> Dict[str, Any]:
    # Evaluated on the server clock for every response; the browser never decides whether a link is live.
    state = link_policy.link_state(job, clock.now())
    live = bool(job.is_published) and state == link_policy.ACTIVE
    expiry = link_policy.expires_at(job)
    out = {
        "id": job.id,
        "title": job.title,
        "role": job.role,
        "company_name": job.company_name or None,
        "description": job.description,
        "required_skills": job.required_skills or [],
        "status": job.status or "DRAFT",
        "is_published": bool(job.is_published),
        "share_token": job.share_token if live else None,
        "share_path": share_path(job.share_token) if live else None,
        "share_url": share_url(job.share_token) if live else None,
        # ACTIVE | EXPIRED | CLOSED | null (never had a link); expires_at is null only for legacy links without an expiry
        "share_link_state": state,
        "share_link_expires_at": expiry.isoformat() if expiry else None,
        "blueprint_version": job.blueprint_version or 0,
        "blueprint": _blueprint_summary(job),
        "sections": SECTIONS,
        "created_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }
    if registrations is not None:
        out["registration_count"] = registrations
    if include_blueprint:
        out["blueprint_data"] = job.blueprint_data
    return out


def _get_role(db: Session, tenant_id: int, role_id: int) -> models.JobDescription:
    job = db.query(models.JobDescription).filter(
        models.JobDescription.id == role_id,
        models.JobDescription.organization_id == tenant_id,
    ).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found.")
    return job


_EXPIRED_REOPEN_MESSAGE = "This shared link has expired and cannot be reopened. Create a new link instead."


def _new_token() -> str:
    # 48 random bytes -> exactly 64 URL-safe characters (384 bits of entropy)
    return secrets.token_urlsafe(48)


def _require_valid_blueprint(job: models.JobDescription) -> None:
    try:
        blueprints.validate_blueprint(job.blueprint_data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Cannot publish: {exc}. Generate a valid blueprint (15 aptitude, 2 coding, 5 interview) first.")


def _audit(db: Session, ctx: TenantContext, action: str, target: str, details: str = ""):
    db.add(models.ActivityLog(user_id=ctx.user.id, organization_id=ctx.tenant_id, action=action, target=target, details=details))


@router.post("/extract-description")
async def extract_description_from_file(file: UploadFile = File(...), tenant_context: TenantContext = Depends(require_admin_user)):
    """
    "Upload File" option of the New Job Role form: returns the plain text of a .pdf / .docx / .txt job description so the admin can
    review and edit it before creating the role. Stateless: the document is processed in memory, never stored or executed, and
    nothing is created or generated here (no job role, no blueprint, no publication).
    """
    data = await file.read(jd_documents.MAX_UPLOAD_BYTES + 1)
    await file.close()
    try:
        doc = await run_in_threadpool(jd_documents.extract_job_description, file.filename, data)
    except jd_documents.DocumentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except Exception:  # never leak parser internals / stack traces to the browser
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This document could not be read. Paste the description manually instead.")
    return {"text": doc.text, "filename": jd_documents.safe_filename(file.filename), "file_type": doc.file_type,
            "pages": doc.pages, "characters": len(doc.text), "size_bytes": len(data)}


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_job_role(payload: JobRoleCreate, db: Session = Depends(database.get_db),
                    tenant_context: TenantContext = Depends(require_admin_user)):
    job = models.JobDescription(
        title=payload.title.strip(),
        role=(payload.role or payload.title).strip(),
        company_name=(payload.company_name or "").strip() or None,
        description=payload.description.strip(),
        required_skills=payload.required_skills,
        organization_id=tenant_context.tenant_id,
        created_by=tenant_context.user.id,
        status="DRAFT",
        is_published=False,
        blueprint_version=0,
    )
    db.add(job)
    _audit(db, tenant_context, "JOB_ROLE_CREATED", payload.title.strip())
    db.commit()
    db.refresh(job)
    return serialize_role(job)


@router.get("/")
def list_job_roles(db: Session = Depends(database.get_db), tenant_context: TenantContext = Depends(require_admin_user)):
    jobs = db.query(models.JobDescription).filter(
        models.JobDescription.organization_id == tenant_context.tenant_id
    ).order_by(models.JobDescription.id.desc()).all()
    counts = {}
    if jobs:
        from sqlalchemy import func
        rows = db.query(models.CandidateRegistration.job_description_id, func.count(models.CandidateRegistration.id)).filter(
            models.CandidateRegistration.organization_id == tenant_context.tenant_id
        ).group_by(models.CandidateRegistration.job_description_id).all()
        counts = {r[0]: r[1] for r in rows}
    return [serialize_role(j, registrations=counts.get(j.id, 0)) for j in jobs]


@router.get("/{role_id}")
def get_job_role(role_id: int, db: Session = Depends(database.get_db),
                 tenant_context: TenantContext = Depends(require_admin_user)):
    return serialize_role(_get_role(db, tenant_context.tenant_id, role_id), include_blueprint=True)


@router.put("/{role_id}")
def update_job_role(role_id: int, payload: JobRoleUpdate, db: Session = Depends(database.get_db),
                    tenant_context: TenantContext = Depends(require_admin_user)):
    job = _get_role(db, tenant_context.tenant_id, role_id)
    data = payload.dict(exclude_unset=True)
    # Editing never silently rewrites the blueprint candidates are sitting on; regenerate to create version N+1.
    for key in ("title", "role", "description"):
        if key in data and data[key] is not None:
            setattr(job, key, data[key].strip())
    if "company_name" in data:                      # empty / blank clears it; it is never required
        job.company_name = (data["company_name"] or "").strip() or None
    if "required_skills" in data:
        job.required_skills = data["required_skills"]
    _audit(db, tenant_context, "JOB_ROLE_UPDATED", job.title)
    db.commit()
    db.refresh(job)
    return serialize_role(job, include_blueprint=True)


@router.post("/{role_id}/generate-blueprint")
def generate_blueprint(role_id: int, db: Session = Depends(database.get_db),
                       tenant_context: TenantContext = Depends(require_admin_user)):
    job = _get_role(db, tenant_context.tenant_id, role_id)
    try:
        blueprint = blueprints.generate_jd_blueprint(job.description or "", role_title=job.role or job.title)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except blueprints.BlueprintGenerationError as exc:
        # Existing blueprint (if any) is untouched; publication stays blocked for DRAFT roles.
        # `code` lets the UI tell configuration / quota / outage problems apart; the provider's own response is only in the server log
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail={"code": exc.kind, "message": str(exc)})

    # Provenance (outside the validated schema): lets the UI say where the content came from and never mislabel it.
    source = "offline_fixture" if gemini_client.is_mock_mode_enabled() else "gemini"
    generation = {"source": source, "label": "Gemini" if source == "gemini" else "Offline test data",
                  "model": gemini_client.get_model_name() if source == "gemini" else None,
                  "generated_at": datetime.now(timezone.utc).isoformat()}
    return _store_blueprint(db, job, tenant_context, blueprint, generation, "BLUEPRINT_GENERATED")


def _store_blueprint(db: Session, job: models.JobDescription, tenant_context: TenantContext, blueprint, generation: Dict[str, Any], audit_action: str):
    """Persist a VALIDATED blueprint as the next version (the previous version stays in the history). Never publishes."""
    new_version = (job.blueprint_version or 0) + 1
    blueprint.blueprint_version = new_version
    data = blueprint.model_dump()
    data["generation"] = generation
    try:
        db.add(models.JobBlueprintVersion(job_description_id=job.id, version=new_version, blueprint_data=data))
        job.blueprint_data = data
        job.blueprint_version = new_version
        if job.required_skills in (None, []):
            job.required_skills = data.get("required_technical_skills") or None
        _audit(db, tenant_context, audit_action, job.title, f"version={new_version}; source={generation.get('source')}")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Another blueprint generation is in progress. Retry in a moment.")
    db.refresh(job)
    return serialize_role(job, include_blueprint=True)


@router.post("/{role_id}/publish")
def publish_job_role(role_id: int, db: Session = Depends(database.get_db),
                     tenant_context: TenantContext = Depends(require_admin_user)):
    """
    First publication issues the shared link (24 h window). On a role that already has a link this is "reopen": the same URL
    comes back with its ORIGINAL expiry. An expired link is never revived here (410); use POST /{id}/new-link for a fresh one.
    """
    job = _get_role(db, tenant_context.tenant_id, role_id)
    now = clock.now()
    if job.share_token and link_policy.is_expired(job, now):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail=_EXPIRED_REOPEN_MESSAGE)
    _require_valid_blueprint(job)
    if not job.share_token:
        job.share_token = _new_token()
        job.share_link_expires_at = clock.naive_utc(link_policy.new_expiry(now))
    elif job.share_link_expires_at is None and job.status != "PUBLISHED":
        # Legacy closed link (issued before expiry existed): an explicit reopen gives it a 24 h window, same URL.
        job.share_link_expires_at = clock.naive_utc(link_policy.new_expiry(now))
    job.is_published = True
    job.status = "PUBLISHED"
    _audit(db, tenant_context, "JOB_ROLE_PUBLISHED", job.title, f"blueprint_version={job.blueprint_version}")
    db.commit()
    db.refresh(job)
    return serialize_role(job, include_blueprint=True)


@router.post("/{role_id}/new-link")
def create_new_share_link(role_id: int, db: Session = Depends(database.get_db),
                          tenant_context: TenantContext = Depends(require_admin_user)):
    """
    Issues a brand-new shared link (new URL, its own 24 h window) for a role whose current link has expired. The expired link is
    kept in the history and keeps answering 410; registrations, attempts and reports stay attached to the role untouched.
    """
    job = _get_role(db, tenant_context.tenant_id, role_id)
    now = clock.now()
    if not job.share_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Publish this assessment first to get its shared link.")
    if not link_policy.is_expired(job, now):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="The current link has not expired. Close and reopen it, or wait until it expires, to get a new link.")
    _require_valid_blueprint(job)
    try:
        db.add(models.JobShareLinkHistory(job_description_id=job.id, share_token=job.share_token, expires_at=job.share_link_expires_at))
        job.share_token = _new_token()
        job.share_link_expires_at = clock.naive_utc(link_policy.new_expiry(now))
        job.is_published = True
        job.status = "PUBLISHED"
        _audit(db, tenant_context, "JOB_ROLE_SHARE_LINK_CREATED", job.title, f"blueprint_version={job.blueprint_version}")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The link was already renewed. Reload to see it.")
    db.refresh(job)
    return serialize_role(job, include_blueprint=True)


# ------------------------------------------------------------------------------
# Optional: e-mail the shared link to existing students (copying the link by hand is unaffected and needs none of this)
# ------------------------------------------------------------------------------
INVITABLE_STUDENT_LIMIT = 500
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")


def _invitable_students(db: Session, tenant_id: int):
    """Active Student accounts of the caller's organization: the only people an administrator may invite."""
    return _tenant_users(db, tenant_id).filter(models.User.role == models.UserRole.STUDENT.value, models.User.is_active.is_(True))


def _invitation_link(job: models.JobDescription) -> str:
    url = share_url(job.share_token)
    host = url.split("://", 1)[-1].split("/", 1)[0].split(":")[0] if url else ""
    if utils.is_production() and (host in _LOCAL_HOSTS or not url):
        # an e-mailed link to localhost would be useless to every recipient
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="The public application URL (FRONTEND_URL) is not configured for production, so invitation links would not work.")
    return url


@router.get("/{role_id}/share-students")
def list_share_students(role_id: int, q: Optional[str] = None, db: Session = Depends(database.get_db),
                        tenant_context: TenantContext = Depends(require_admin_user)):
    """Students the caller may invite to this assessment, with the tracked invitation status of its current link."""
    from sqlalchemy import func, or_
    job = _get_role(db, tenant_context.tenant_id, role_id)
    query = _invitable_students(db, tenant_context.tenant_id)
    if q and q.strip():
        needle = q.strip().lower()[:100]
        profile_ids = db.query(models.StudentProfile.user_id).filter(func.lower(models.StudentProfile.full_name).contains(needle, autoescape=True))
        query = query.filter(or_(
            func.lower(models.User.email).contains(needle, autoescape=True),
            func.lower(func.coalesce(models.User.full_name, "")).contains(needle, autoescape=True),
            models.User.id.in_(profile_ids),
        ))
    total = query.count()
    rows = query.order_by(func.lower(models.User.email)).limit(INVITABLE_STUDENT_LIMIT).all()
    tracked = invitations.current_invitations(db, job, [u.id for u in rows])
    problem = invitations.link_problem(job)
    expiry = link_policy.expires_at(job)
    return {
        "items": [{"id": u.id, "name": invitations.student_display_name(db, u), "email": u.email,
                   "invitation": invitations.invitation_summary(tracked.get(u.id))} for u in rows],
        "total": total,
        "truncated": total > len(rows),
        "can_send": problem is None,
        "cannot_send_reason": problem["message"] if problem else None,
        "email_configured": email_service.is_configured(),
        "link_expires_at": expiry.isoformat() if expiry else None,
    }


@router.post("/{role_id}/invitations")
def send_assessment_invitations(role_id: int, payload: InvitationRequest, db: Session = Depends(database.get_db),
                                tenant_context: TenantContext = Depends(require_admin_user)):
    """
    E-mails the job's current shared link to the selected students and reports the outcome PER RECIPIENT (sent / failed / skipped).
    "sent" means the mail server accepted the message, not that it reached an inbox. Repeating the request never re-sends a
    "sent" invitation; sending again for "failed" ones is the safe retry. Nothing is created for the student: no account,
    registration or attempt, and the link, its 24 h expiry and the publish state are untouched.
    """
    job = _get_role(db, tenant_context.tenant_id, role_id)
    problem = invitations.link_problem(job)
    if problem:
        raise HTTPException(status_code=problem["status"], detail=problem["message"])
    link_url = _invitation_link(job)

    ids = list(dict.fromkeys(payload.student_ids))  # a repeated id in one request is still one e-mail
    students = _invitable_students(db, tenant_context.tenant_id).filter(models.User.id.in_(ids)).all()
    if len(students) != len(ids):
        # outside the caller's organization, not a student, or deactivated: never revealed which, nothing is sent
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="One or more selected students are not available. Reload the student list and try again.")
    by_id = {s.id: s for s in students}
    ordered = [by_id[i] for i in ids]

    try:
        results = invitations.send_invitations(
            db, job=job, students=ordered, link_url=link_url,
            organization_name=tenant_context.organization.name, invited_by=tenant_context.user.id)
    except email_service.EmailNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    summary = {key: sum(1 for r in results if r["status"] == key) for key in ("sent", "failed", "skipped")}
    _audit(db, tenant_context, "JOB_ROLE_INVITATIONS_SENT", job.title,
           f"sent={summary['sent']}; failed={summary['failed']}; skipped={summary['skipped']}")
    db.commit()
    return {"results": results, "summary": summary}


@router.post("/{role_id}/close")
def close_job_role(role_id: int, db: Session = Depends(database.get_db),
                   tenant_context: TenantContext = Depends(require_admin_user)):
    job = _get_role(db, tenant_context.tenant_id, role_id)
    if (job.status or "DRAFT") == "DRAFT" and not job.is_published:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only a published assessment can be closed.")
    job.is_published = False
    job.status = "CLOSED"
    _audit(db, tenant_context, "JOB_ROLE_CLOSED", job.title)
    db.commit()
    db.refresh(job)
    return serialize_role(job)
