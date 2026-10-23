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
from routers.auth import TenantContext, require_admin_user
from services import gemini_client
from services import jd_blueprint_service as blueprints
from services import jd_document_service as jd_documents

router = APIRouter(prefix="/api/admin/job-roles", tags=["admin-job-roles"])

SECTIONS = [
    {"key": "aptitude", "label": "Aptitude", "minutes": 20},
    {"key": "coding", "label": "Coding", "minutes": 20},
    {"key": "interview", "label": "AI Technical Interview", "minutes": 20},
]


class JobRoleCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    role: Optional[str] = Field(None, max_length=200)
    description: str = Field(..., min_length=1, max_length=20000)
    required_skills: Optional[List[str]] = None


class JobRoleUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=200)
    role: Optional[str] = Field(None, max_length=200)
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
    out = {
        "id": job.id,
        "title": job.title,
        "role": job.role,
        "description": job.description,
        "required_skills": job.required_skills or [],
        "status": job.status or "DRAFT",
        "is_published": bool(job.is_published),
        "share_token": job.share_token if job.is_published else None,
        "share_path": share_path(job.share_token) if job.is_published else None,
        "share_url": share_url(job.share_token) if job.is_published else None,
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
    job = _get_role(db, tenant_context.tenant_id, role_id)
    try:
        blueprints.validate_blueprint(job.blueprint_data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Cannot publish: {exc}. Generate a valid blueprint (15 aptitude, 2 coding, 5 interview) first.")
    if not job.share_token:
        # 48 random bytes -> exactly 64 URL-safe characters (384 bits of entropy)
        job.share_token = secrets.token_urlsafe(48)
    job.is_published = True
    job.status = "PUBLISHED"
    _audit(db, tenant_context, "JOB_ROLE_PUBLISHED", job.title, f"blueprint_version={job.blueprint_version}")
    db.commit()
    db.refresh(job)
    return serialize_role(job, include_blueprint=True)


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
