"""
Student Career & Placement Platform API Router (Phase 1).
Provides endpoints for Student Profile, Resume Upload & Analysis, Target Role/Company, Placement Readiness Score, and Dashboard.
"""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List, Optional
import os
import re
import tempfile
from pathlib import Path
from datetime import datetime

import schemas, models, database, utils
from routers.auth import get_current_user
from services.student_resume_analyzer import extract_resume_text, analyze_student_resume, refresh_placeholder_entries
from services.student_resume_tools import (
    MIN_JD_CHARS, MIN_RESUME_CHARS, analyze_resume_against_jd, extract_structured_resume
)
from services.readiness_service import calculate_placement_readiness, refresh_profile_readiness
from services.skill_gap_service import TARGET_ROLES_CATALOG, analyze_skill_gap
from services.roadmap_service import generate_or_update_roadmap, get_roadmap_details
from services.practice_service import get_topics_overview, get_sanitized_questions, evaluate_practice_submission
from services.student_interview_service import (
    start_mock_interview,
    process_interview_turn,
    finalize_mock_interview
)
from services.project_analyzer_service import analyze_student_project
from services import project_rules, github_repo_service
from services.placement_simulation_service import (
    start_placement_simulation,
    submit_simulation_round,
    sanitize_round_data
)
from services.copilot_service import (
    send_copilot_message,
    get_copilot_history,
    clear_copilot_history,
    assemble_student_context
)
from services import college_service
from services import onboarding_service
from services import student_performance_service

router = APIRouter(
    prefix="/api/student",
    tags=["student"]
)

# Ensure upload directory exists
STUDENT_MEDIA_DIR = Path("media/student_resumes")
STUDENT_MEDIA_DIR.mkdir(parents=True, exist_ok=True)


# ==============================================================================
# DEPENDENCY & SECURITY HELPERS
# ==============================================================================

def get_current_student_profile(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.StudentProfile:
    """
    Resolves the authenticated user's StudentProfile.
    Enforces student ownership and tenant isolation.
    Fails closed if the student user is not associated with an organization.
    """
    if getattr(current_user, "email", "").endswith(".internal"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidate interviewees are not authorized to access student career features."
        )

    # Strictly require STUDENT role - deny administrator and unauthorized roles
    active_role = getattr(current_user, "_token_role", None) or current_user.role
    if active_role != models.UserRole.STUDENT or current_user.role != models.UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student authorization required."
        )

    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student user is not provisioned with a valid organization."
        )

    profile = db.query(models.StudentProfile).filter(
        models.StudentProfile.user_id == current_user.id
    ).first()

    if not profile:
        profile = models.StudentProfile(
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            full_name=current_user.email.split('@')[0].replace('.', ' ').replace('_', ' ').title(),
            email=current_user.email,
            target_role="",
            current_skills=[],
            readiness_score=15.0,
            readiness_breakdown={
                "resume": 0.0,
                "technical_skills": 20.0,
                "projects": 0.0,
                "experience": 0.0,
                "education": 50.0,
                "ats_quality": 0.0
            }
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    return profile


def verify_student_tenant_access(
    profile: models.StudentProfile,
    current_user: models.User
) -> None:
    """
    Strict security check:
    1. Student can only access their own profile.
    2. Org Admins / HR can only access students within their own organization.
    3. Org A can NEVER access Org B students.
    """
    if current_user.id == profile.user_id:
        return  # Student accessing own profile

    # Platform Admin cross-org check
    if getattr(current_user, "role", None) == models.UserRole.PLATFORM_ADMIN:
        return

    # Organization Admin / HR check within same organization
    if getattr(current_user, "role", None) in (models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR):
        if current_user.organization_id and current_user.organization_id == profile.organization_id:
            return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Cross-tenant or unauthorized access denied. You cannot access another student's data."
    )


# ==============================================================================
# STUDENT AUTHENTICATION
# Students sign in through the single login (POST /api/auth/login/). There is no public registration: accounts are created by an
# administrator (POST /api/admin/users). The former /auth/register and /auth/login endpoints were removed with the Clerk migration.
# ==============================================================================

# ==============================================================================
# 1. STUDENT PROFILE APIS
# ==============================================================================

@router.get("/profile", response_model=schemas.StudentProfileResponse)
def get_student_profile(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """Retrieves authenticated student's profile."""
    # Fetch latest resume if available
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_summary = None
    if latest_resume:
        resume_summary = {
            "id": latest_resume.id,
            "version": latest_resume.version,
            "file_name": latest_resume.file_name,
            "overall_score": latest_resume.overall_score,
            "ats_score": latest_resume.ats_score,
            "created_at": latest_resume.created_at
        }

    return schemas.StudentProfileResponse(
        id=profile.id,
        user_id=profile.user_id,
        organization_id=profile.organization_id,
        full_name=profile.full_name,
        email=profile.email,
        phone=profile.phone,
        college_name=profile.college_name,
        branch=profile.branch,
        graduation_year=profile.graduation_year,
        cgpa=profile.cgpa,
        target_role=profile.target_role,
        target_company=profile.target_company,
        current_skills=profile.current_skills or [],
        readiness_score=profile.readiness_score,
        readiness_breakdown=profile.readiness_breakdown or {},
        latest_resume=resume_summary,
        is_onboarded=profile.is_onboarded,
        onboarding_step=profile.onboarding_step,
        created_at=profile.created_at
    )


@router.get("/profile/{profile_id}", response_model=schemas.StudentProfileResponse)
def get_student_profile_by_id(
    profile_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """Retrieves a specific student profile subject to strict ownership & tenant isolation."""
    target_profile = db.query(models.StudentProfile).filter(
        models.StudentProfile.id == profile_id
    ).first()
    if not target_profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student profile not found.")

    verify_student_tenant_access(target_profile, current_user)

    # Fetch latest resume if available
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == target_profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_summary = None
    if latest_resume:
        resume_summary = {
            "id": latest_resume.id,
            "version": latest_resume.version,
            "file_name": latest_resume.file_name,
            "overall_score": latest_resume.overall_score,
            "ats_score": latest_resume.ats_score,
            "created_at": latest_resume.created_at
        }

    return schemas.StudentProfileResponse(
        id=target_profile.id,
        user_id=target_profile.user_id,
        organization_id=target_profile.organization_id,
        full_name=target_profile.full_name,
        email=target_profile.email,
        phone=target_profile.phone,
        college_name=target_profile.college_name,
        branch=target_profile.branch,
        graduation_year=target_profile.graduation_year,
        cgpa=target_profile.cgpa,
        target_role=target_profile.target_role,
        target_company=target_profile.target_company,
        current_skills=target_profile.current_skills or [],
        readiness_score=target_profile.readiness_score,
        readiness_breakdown=target_profile.readiness_breakdown or {},
        latest_resume=resume_summary,
        is_onboarded=target_profile.is_onboarded,
        onboarding_step=target_profile.onboarding_step,
        created_at=target_profile.created_at
    )


@router.put("/profile", response_model=schemas.StudentProfileResponse)
def update_student_profile(
    update_data: schemas.StudentProfileUpdate,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """Updates target role, company, skills and education. Only the fields sent are changed; null clears one."""
    sent = getattr(update_data, "model_fields_set", set())

    def text_or_none(value):
        value = (value or "").strip()
        return value or None

    # Required text fields: a blank value is ignored instead of wiping the field
    if "full_name" in sent and (update_data.full_name or "").strip():
        profile.full_name = update_data.full_name.strip()
    if "target_role" in sent and (update_data.target_role or "").strip():
        profile.target_role = update_data.target_role.strip()

    # Optional fields: a value saves it, null or blank clears it
    if "phone" in sent:
        profile.phone = text_or_none(update_data.phone)
    if "college_name" in sent:
        profile.college_name = text_or_none(update_data.college_name)
    if "target_company" in sent:
        profile.target_company = text_or_none(update_data.target_company)
    if "graduation_year" in sent:
        profile.graduation_year = update_data.graduation_year
    if "cgpa" in sent:
        profile.cgpa = update_data.cgpa

    # "Degree & Branch": `education` wins over the legacy `branch` key
    if "education" in sent:
        profile.branch = text_or_none(update_data.education)
    elif "branch" in sent:
        profile.branch = text_or_none(update_data.branch)

    if update_data.current_skills is not None:
        seen, skills = set(), []
        for raw in update_data.current_skills:
            skill = (raw or "").strip()[:60]
            if skill and skill.lower() not in seen:
                seen.add(skill.lower())
                skills.append(skill)
        profile.current_skills = skills

    # Recalculate readiness with updated profile attributes
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    readiness = calculate_placement_readiness(profile, latest_resume)
    profile.readiness_score = readiness["overall_score"]
    profile.readiness_breakdown = readiness["breakdown"]

    db.commit()
    db.refresh(profile)

    resume_summary = None
    if latest_resume:
        resume_summary = {
            "id": latest_resume.id,
            "version": latest_resume.version,
            "file_name": latest_resume.file_name,
            "overall_score": latest_resume.overall_score,
            "ats_score": latest_resume.ats_score,
            "created_at": latest_resume.created_at
        }

    return schemas.StudentProfileResponse(
        id=profile.id,
        user_id=profile.user_id,
        organization_id=profile.organization_id,
        full_name=profile.full_name,
        email=profile.email,
        phone=profile.phone,
        college_name=profile.college_name,
        branch=profile.branch,
        graduation_year=profile.graduation_year,
        cgpa=profile.cgpa,
        target_role=profile.target_role,
        target_company=profile.target_company,
        current_skills=profile.current_skills or [],
        readiness_score=profile.readiness_score,
        readiness_breakdown=profile.readiness_breakdown or {},
        latest_resume=resume_summary,
        is_onboarded=profile.is_onboarded,
        onboarding_step=profile.onboarding_step,
        created_at=profile.created_at
    )


# ==============================================================================
# 2 & 3. RESUME UPLOAD & AI RESUME ANALYSIS
# ==============================================================================

@router.post("/resume/upload", response_model=schemas.StudentResumeAnalysisResponse)
async def upload_student_resume(
    file: UploadFile = File(...),
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Uploads a student resume, extracts text, computes structured 9-dimension analysis,
    stores version (V1, V2, V3...), and refreshes placement readiness score.
    """
    if not file.filename or "\x00" in file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename supplied."
        )

    # Sanitize basename and prevent directory traversal
    base_name = os.path.basename(file.filename)
    safe_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', base_name)
    ext = Path(safe_name).suffix.lower()

    allowed_exts = {".pdf", ".docx", ".doc", ".txt"}
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Please upload a PDF, DOCX, or TXT resume."
        )

    # Enforce file size limit (10 MB maximum, 1 byte minimum)
    MAX_RESUME_SIZE = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_RESUME_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds maximum allowed limit of 10 MB."
        )
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded resume file cannot be empty."
        )

    # Determine next version
    latest_existing = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    next_version = (latest_existing.version + 1) if latest_existing else 1

    # Save file safely
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    clean_filename = f"student_{profile.user_id}_v{next_version}_{timestamp}_{safe_name}"
    dest_path = STUDENT_MEDIA_DIR / clean_filename

    with open(dest_path, "wb") as buffer:
        buffer.write(content)

    # Extract text using existing RAG infrastructure
    raw_text = extract_resume_text(str(dest_path))

    # Perform AI resume analysis without hallucination
    analysis = analyze_student_resume(raw_text, target_role=profile.target_role)

    # Persist versioned student resume
    student_resume = models.StudentResume(
        student_profile_id=profile.id,
        version=next_version,
        file_path=str(dest_path),
        file_name=safe_name,
        full_text=raw_text,
        overall_score=analysis["overall_score"],
        ats_score=analysis["ats_score"],
        analysis_data=analysis,
        strengths=analysis["strengths"],
        weaknesses=analysis["weaknesses"],
        missing_information=analysis["missing_information"],
        recommendations=analysis["recommendations"]
    )
    db.add(student_resume)

    # Sync extracted technical skills to student profile
    existing_skills = set(profile.current_skills or [])
    new_skills = set(analysis.get("technical_skills") or [])
    merged_skills = list(existing_skills.union(new_skills))
    profile.current_skills = merged_skills

    # Recalculate Placement Readiness Score
    readiness = calculate_placement_readiness(profile, student_resume)
    profile.readiness_score = readiness["overall_score"]
    profile.readiness_breakdown = readiness["breakdown"]

    db.commit()
    db.refresh(student_resume)

    return schemas.StudentResumeAnalysisResponse(
        id=student_resume.id,
        version=student_resume.version,
        file_name=student_resume.file_name,
        overall_score=student_resume.overall_score,
        ats_score=student_resume.ats_score,
        technical_skills=analysis.get("technical_skills", []),
        soft_skills=analysis.get("soft_skills", []),
        projects=analysis.get("projects", []),
        education=analysis.get("education", []),
        experience=analysis.get("experience", []),
        certifications=analysis.get("certifications", []),
        dsa_indicators=analysis.get("dsa_indicators", {}),
        ats_compatibility=analysis.get("ats_compatibility", {}),
        resume_quality=analysis.get("resume_quality", {}),
        strengths=student_resume.strengths or [],
        weaknesses=student_resume.weaknesses or [],
        missing_information=student_resume.missing_information or [],
        recommendations=student_resume.recommendations or [],
        created_at=student_resume.created_at
    )


async def _resolve_resume_text(
    file: Optional[UploadFile],
    resume_id: Optional[int],
    profile: models.StudentProfile,
    db: Session
) -> str:
    """
    Returns resume text from exactly one source: a fresh upload (not persisted) or one of the
    caller's own saved resume versions.
    """
    if (file is None) == (resume_id is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either a resume file or a saved resume_id."
        )

    if resume_id is not None:
        saved = db.query(models.StudentResume).filter(
            models.StudentResume.id == resume_id,
            models.StudentResume.student_profile_id == profile.id
        ).first()
        if not saved:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved resume not found.")
        text = saved.full_text or ""
        if not text.strip() and saved.file_path and os.path.exists(saved.file_path):
            text = extract_resume_text(saved.file_path)
    else:
        if not file.filename or "\x00" in file.filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename supplied.")
        ext = Path(os.path.basename(file.filename)).suffix.lower()
        if ext not in {".pdf", ".docx", ".doc", ".txt"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file format '{ext}'. Please upload a PDF, DOCX, or TXT resume."
            )
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded resume file cannot be empty.")
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File size exceeds maximum allowed limit of 10 MB."
            )
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            text = extract_resume_text(tmp_path)
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    if len((text or "").strip()) < MIN_RESUME_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read enough text from this resume. If it is a scanned image, upload a text-based PDF or DOCX."
        )
    return text


@router.post("/resume/analyze-jd")
async def analyze_resume_with_job_description(
    job_description: str = Form(...),
    file: Optional[UploadFile] = File(None),
    resume_id: Optional[int] = Form(None),
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """Analyzes a resume against a job description. Nothing is stored."""
    jd_text = (job_description or "").strip()
    if len(jd_text) < MIN_JD_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Please paste a fuller job description (at least {MIN_JD_CHARS} characters)."
        )
    resume_text = await _resolve_resume_text(file, resume_id, profile, db)
    return analyze_resume_against_jd(resume_text, jd_text)


@router.post("/resume/format")
async def format_resume_structure(
    file: Optional[UploadFile] = File(None),
    resume_id: Optional[int] = Form(None),
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """Extracts a resume into structured data for the three ATS templates. Nothing is stored."""
    resume_text = await _resolve_resume_text(file, resume_id, profile, db)
    return extract_structured_resume(resume_text)


@router.get("/resume", response_model=Optional[schemas.StudentResumeAnalysisResponse])
def get_student_resume(
    resume_id: Optional[int] = None,
    version: Optional[int] = None,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """Retrieves student's resume by latest, version, or specific resume_id (with ownership verification)."""
    if resume_id is not None:
        target_resume = db.query(models.StudentResume).filter(
            models.StudentResume.id == resume_id
        ).first()
        if not target_resume:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")

        target_profile = db.query(models.StudentProfile).filter(
            models.StudentProfile.id == target_resume.student_profile_id
        ).first()
        if not target_profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume profile not found.")

        verify_student_tenant_access(target_profile, current_user)
        resume_to_return = target_resume
    elif version is not None:
        target_resume = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == profile.id,
            models.StudentResume.version == version
        ).first()
        if not target_resume:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Resume version V{version} not found.")
        resume_to_return = target_resume
    else:
        resume_to_return = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == profile.id
        ).order_by(models.StudentResume.version.desc()).first()

    if not resume_to_return:
        return None

    analysis = refresh_placeholder_entries(resume_to_return.analysis_data or {}, resume_to_return.full_text or "")
    return schemas.StudentResumeAnalysisResponse(
        id=resume_to_return.id,
        version=resume_to_return.version,
        file_name=resume_to_return.file_name,
        overall_score=resume_to_return.overall_score,
        ats_score=resume_to_return.ats_score,
        technical_skills=analysis.get("technical_skills", []),
        soft_skills=analysis.get("soft_skills", []),
        projects=analysis.get("projects", []),
        education=analysis.get("education", []),
        experience=analysis.get("experience", []),
        certifications=analysis.get("certifications", []),
        dsa_indicators=analysis.get("dsa_indicators", {}),
        ats_compatibility=analysis.get("ats_compatibility", {}),
        resume_quality=analysis.get("resume_quality", {}),
        strengths=resume_to_return.strengths or [],
        weaknesses=resume_to_return.weaknesses or [],
        missing_information=resume_to_return.missing_information or [],
        recommendations=resume_to_return.recommendations or [],
        created_at=resume_to_return.created_at
    )


@router.get("/resume/download")
def download_current_student_resume(
    resume_id: Optional[int] = None,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """Securely downloads student resume file with ownership/tenant verification."""
    if resume_id is not None:
        target_resume = db.query(models.StudentResume).filter(
            models.StudentResume.id == resume_id
        ).first()
        if not target_resume:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")
        target_profile = db.query(models.StudentProfile).filter(
            models.StudentProfile.id == target_resume.student_profile_id
        ).first()
        if not target_profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume profile not found.")
        verify_student_tenant_access(target_profile, current_user)
        resume_to_download = target_resume
    else:
        resume_to_download = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == profile.id
        ).order_by(models.StudentResume.version.desc()).first()

    if not resume_to_download or not resume_to_download.file_path or not os.path.exists(resume_to_download.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume file not found on disk.")

    return FileResponse(
        resume_to_download.file_path,
        filename=resume_to_download.file_name or os.path.basename(resume_to_download.file_path),
        media_type="application/octet-stream"
    )


@router.get("/resume/{resume_id}/download")
def download_resume_by_id(
    resume_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """Securely downloads a specific student resume by ID with tenant verification."""
    target_resume = db.query(models.StudentResume).filter(
        models.StudentResume.id == resume_id
    ).first()
    if not target_resume:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")

    target_profile = db.query(models.StudentProfile).filter(
        models.StudentProfile.id == target_resume.student_profile_id
    ).first()
    if not target_profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume profile not found.")

    verify_student_tenant_access(target_profile, current_user)

    if not target_resume.file_path or not os.path.exists(target_resume.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume file not found on disk.")

    return FileResponse(
        target_resume.file_path,
        filename=target_resume.file_name or os.path.basename(target_resume.file_path),
        media_type="application/octet-stream"
    )


@router.get("/resume/{resume_id}", response_model=schemas.StudentResumeAnalysisResponse)
def get_resume_by_id(
    resume_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """Retrieves a specific student resume by ID with strict ownership verification."""
    target_resume = db.query(models.StudentResume).filter(
        models.StudentResume.id == resume_id
    ).first()
    if not target_resume:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")

    target_profile = db.query(models.StudentProfile).filter(
        models.StudentProfile.id == target_resume.student_profile_id
    ).first()
    if not target_profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume profile not found.")

    verify_student_tenant_access(target_profile, current_user)

    analysis = target_resume.analysis_data or {}
    return schemas.StudentResumeAnalysisResponse(
        id=target_resume.id,
        version=target_resume.version,
        file_name=target_resume.file_name,
        overall_score=target_resume.overall_score,
        ats_score=target_resume.ats_score,
        technical_skills=analysis.get("technical_skills", []),
        soft_skills=analysis.get("soft_skills", []),
        projects=analysis.get("projects", []),
        education=analysis.get("education", []),
        experience=analysis.get("experience", []),
        certifications=analysis.get("certifications", []),
        dsa_indicators=analysis.get("dsa_indicators", {}),
        ats_compatibility=analysis.get("ats_compatibility", {}),
        resume_quality=analysis.get("resume_quality", {}),
        strengths=target_resume.strengths or [],
        weaknesses=target_resume.weaknesses or [],
        missing_information=target_resume.missing_information or [],
        recommendations=target_resume.recommendations or [],
        created_at=target_resume.created_at
    )


# ==============================================================================
# 5. PLACEMENT READINESS SCORE API
# ==============================================================================

@router.get("/readiness", response_model=schemas.PlacementReadinessResponse)
def get_readiness_indicator(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns modular Placement Readiness Indicator score, disclaimer, breakdown,
    strengths, and areas to improve.
    """
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    readiness = calculate_placement_readiness(profile, latest_resume)
    return schemas.PlacementReadinessResponse(
        indicator_title=readiness["indicator_title"],
        disclaimer=readiness["disclaimer"],
        overall_score=readiness["overall_score"],
        breakdown=readiness["breakdown"],
        strengths=readiness["strengths"],
        areas_to_improve=readiness["areas_to_improve"]
    )


# ==============================================================================
# 6. STUDENT DASHBOARD API
# ==============================================================================

@router.get("/dashboard", response_model=schemas.StudentDashboardResponse)
def get_student_dashboard(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns unified data for the Student Dashboard:
    Placement Readiness Score, Resume Score, Target Role, Strengths, Areas to Improve, Recommendations.
    """
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    readiness = calculate_placement_readiness(profile, latest_resume)

    resume_score = float(latest_resume.overall_score) if latest_resume else 0.0
    recommendations = latest_resume.recommendations if latest_resume else [
        "Upload your resume to receive AI-powered ATS analysis and recommendations",
        "Set your target company and technical role to customize your preparation plan"
    ]

    return schemas.StudentDashboardResponse(
        student_name=profile.full_name,
        readiness_score=readiness["overall_score"],
        resume_score=resume_score,
        target_role=profile.target_role,
        target_company=profile.target_company,
        strengths=readiness["strengths"],
        areas_to_improve=readiness["areas_to_improve"],
        resume_recommendations=recommendations,
        latest_resume_version=latest_resume.version if latest_resume else None,
        readiness_breakdown=readiness["breakdown"]
    )


# ==============================================================================
# PHASE 2: SKILL GAP & TARGET ROLES API
# ==============================================================================

@router.get("/target-roles", response_model=List[schemas.TargetRoleInfo])
def get_target_roles():
    """
    Returns list of standard supported target roles with their required and preferred skills,
    core competencies, and typical interview rounds.
    """
    roles = []
    for role_name, data in TARGET_ROLES_CATALOG.items():
        roles.append(
            schemas.TargetRoleInfo(
                title=data["title"],
                description=data["description"],
                required_skills=data["required_skills"],
                preferred_skills=data["preferred_skills"],
                core_competencies=data.get("core_competencies", []),
                typical_interview_rounds=data.get("typical_interview_rounds", [])
            )
        )
    return roles


@router.get("/skill-gap", response_model=schemas.SkillGapAnalysisResponse)
def get_student_skill_gap(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Computes skill gap analysis for the authenticated student against their target role.
    Compares profile skills and latest resume skills against standard benchmarks.
    """
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_skills = []
    if latest_resume and latest_resume.analysis_data:
        resume_skills = latest_resume.analysis_data.get("technical_skills", [])

    gap_data = analyze_skill_gap(
        student_skills=profile.current_skills or [],
        resume_skills=resume_skills,
        target_role=profile.target_role or "Software Engineer",
        target_company=profile.target_company
    )

    return schemas.SkillGapAnalysisResponse(**gap_data)


@router.post("/skill-gap/analyze", response_model=schemas.SkillGapAnalysisResponse)
def simulate_skill_gap(
    payload: schemas.SkillGapAnalyzeRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Simulates skill gap against any custom target role or company without modifying the profile.
    Can optionally include additional hypothetical skills.
    """
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_skills = []
    if latest_resume and latest_resume.analysis_data:
        resume_skills = latest_resume.analysis_data.get("technical_skills", [])

    combined_student_skills = list(set((profile.current_skills or []) + (payload.additional_skills or [])))

    gap_data = analyze_skill_gap(
        student_skills=combined_student_skills,
        resume_skills=resume_skills,
        target_role=payload.target_role,
        target_company=payload.target_company or profile.target_company
    )

    return schemas.SkillGapAnalysisResponse(**gap_data)


@router.get("/career-paths")
def get_career_path_recommendations(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns career path progression recommendations, matching roles, and fit scores.
    """
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_skills = []
    if latest_resume and latest_resume.analysis_data:
        resume_skills = latest_resume.analysis_data.get("technical_skills", [])

    # Evaluate fit across all catalog roles to suggest strongest alignments
    role_fits = []
    for role_name in TARGET_ROLES_CATALOG.keys():
        gap = analyze_skill_gap(
            student_skills=profile.current_skills or [],
            resume_skills=resume_skills,
            target_role=role_name
        )
        role_fits.append({
            "role": role_name,
            "match_percentage": gap["match_percentage"],
            "fit_level": gap["career_path_advice"]["current_fit_level"],
            "missing_count": len(gap["missing_required"]),
            "is_current_target": (role_name.lower() == (profile.target_role or "").lower())
        })

    role_fits.sort(key=lambda x: x["match_percentage"], reverse=True)

    return {
        "current_target_role": profile.target_role,
        "recommended_roles": role_fits[:4],
        "all_role_fits": role_fits
    }


# ==============================================================================
# PHASE 3: ROADMAP & DAILY PREPARATION PLAN API
# ==============================================================================

@router.get("/roadmap", response_model=schemas.RoadmapResponse)
def get_student_roadmap(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves the student's active preparation roadmap with weekly tasks and progress.
    If no active roadmap exists, automatically generates a personalized one.
    """
    active_roadmap = db.query(models.StudentRoadmap).filter(
        models.StudentRoadmap.student_profile_id == profile.id,
        models.StudentRoadmap.status == "ACTIVE"
    ).first()

    if not active_roadmap:
        active_roadmap = generate_or_update_roadmap(
            profile=profile,
            target_role=profile.target_role or "Software Engineer",
            db=db,
            regenerate=False
        )

    return schemas.RoadmapResponse(**get_roadmap_details(active_roadmap, db))


@router.post("/roadmap/generate", response_model=schemas.RoadmapResponse)
def generate_student_roadmap(
    payload: schemas.GenerateRoadmapRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Generates or regenerates a preparation roadmap for the student.
    Preserves completed tasks to ensure student progress is never lost.
    """
    target_role = payload.target_role or profile.target_role or "Software Engineer"
    roadmap = generate_or_update_roadmap(
        profile=profile,
        target_role=target_role,
        db=db,
        regenerate=payload.regenerate
    )

    return schemas.RoadmapResponse(**get_roadmap_details(roadmap, db))


@router.patch("/daily-tasks/{task_id}", response_model=schemas.DailyTaskResponse)
def update_daily_task_status(
    task_id: int,
    payload: schemas.UpdateDailyTaskStatusRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Updates the status of a specific daily task (PENDING, IN_PROGRESS, COMPLETED, SKIPPED).
    Strictly verifies student ownership and tenant isolation.
    """
    task = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.id == task_id,
        models.StudentDailyTask.student_profile_id == profile.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Daily task not found or unauthorized access."
        )

    valid_statuses = {"PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"}
    norm_status = payload.status.upper()
    if norm_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task status. Allowed: {valid_statuses}"
        )

    task.status = norm_status
    if norm_status == "COMPLETED":
        task.completed_at = datetime.utcnow()
    else:
        task.completed_at = None

    db.commit()
    db.refresh(task)
    refresh_profile_readiness(db, profile)

    return schemas.DailyTaskResponse(
        id=task.id,
        week_number=task.week_number,
        day_number=task.day_number,
        title=task.title,
        description=task.description,
        category=task.category,
        why_recommended=task.why_recommended,
        estimated_minutes=task.estimated_minutes,
        status=task.status,
        completed_at=task.completed_at
    )


# ==============================================================================
# PHASE 4: DSA, APTITUDE & TOPIC-WISE PRACTICE API
# ==============================================================================

@router.get("/practice/topics", response_model=List[schemas.PracticeTopicOverview])
def get_practice_topics_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns list of practice topics with total questions and student completion metrics.
    """
    return get_topics_overview(student_profile_id=profile.id, db=db)


@router.get("/practice/questions", response_model=List[schemas.PracticeQuestionPublicResponse])
def get_practice_questions_endpoint(
    topic: Optional[str] = None,
    category: Optional[str] = None,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns practice questions for a topic.
    CONFIDENTIALITY GUARANTEE: correct_answer and hidden test cases are stripped!
    """
    return get_sanitized_questions(
        topic=topic,
        category=category,
        student_profile_id=profile.id,
        db=db
    )


@router.post("/practice/submit", response_model=schemas.PracticeSubmissionResponse)
def submit_practice_attempt_endpoint(
    payload: schemas.PracticeSubmissionRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Executes and scores practice submission (Judge0 coding execution or aptitude evaluation).
    Evaluates all test cases server-side without leaking hidden cases to client.
    """
    try:
        result = evaluate_practice_submission(
            profile=profile,
            question_id=payload.question_id,
            code=payload.code,
            language=payload.language,
            selected_option=payload.selected_option,
            db=db
        )
        refresh_profile_readiness(db, profile)
        return schemas.PracticeSubmissionResponse(**result)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==============================================================================
# PHASE 5: AI MOCK INTERVIEW & COMMUNICATION EVALUATION API
# ==============================================================================

@router.post("/mock-interview/start", response_model=schemas.MockInterviewDetailResponse)
def start_mock_interview_endpoint(
    payload: schemas.MockInterviewStartRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Initializes a new mock interview session and returns the interview with the first question turn.
    """
    interview = start_mock_interview(
        profile=profile,
        interview_type=payload.interview_type,
        target_role=payload.target_role,
        db=db
    )
    turns = db.query(models.StudentMockInterviewTurn).filter(
        models.StudentMockInterviewTurn.mock_interview_id == interview.id
    ).order_by(models.StudentMockInterviewTurn.turn_number.asc()).all()

    turn_details = [
        schemas.MockInterviewTurnDetail(
            id=t.id,
            turn_number=t.turn_number,
            question_text=t.question_text,
            student_response=t.student_response,
            feedback=t.feedback,
            turn_score=t.turn_score,
            created_at=t.created_at
        )
        for t in turns
    ]

    return schemas.MockInterviewDetailResponse(
        id=interview.id,
        interview_type=interview.interview_type,
        target_role=interview.target_role,
        status=interview.status,
        overall_score=interview.overall_score,
        star_structure_score=interview.star_structure_score,
        technical_accuracy_score=interview.technical_accuracy_score,
        feedback_summary=interview.feedback_summary,
        strengths=interview.strengths or [],
        areas_to_improve=interview.areas_to_improve or [],
        created_at=interview.created_at,
        completed_at=interview.completed_at,
        turns=turn_details
    )


@router.post("/mock-interview/{interview_id}/turn", response_model=schemas.MockInterviewTurnResponse)
def submit_mock_interview_turn_endpoint(
    interview_id: int,
    payload: schemas.MockInterviewTurnRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Submits answer for active turn, performs STAR evaluation, and provides next question.
    Strict tenant and ownership isolation.
    """
    interview = db.query(models.StudentMockInterview).filter(
        models.StudentMockInterview.id == interview_id,
        models.StudentMockInterview.student_profile_id == profile.id
    ).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview session not found or unauthorized access."
        )

    if interview.status != "IN_PROGRESS":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot submit turn to an interview that is already completed or abandoned."
        )

    result = process_interview_turn(
        interview=interview,
        student_response=payload.student_response,
        db=db
    )
    return schemas.MockInterviewTurnResponse(**result)


@router.post("/mock-interview/{interview_id}/complete", response_model=schemas.MockInterviewDetailResponse)
def complete_mock_interview_endpoint(
    interview_id: int,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Concludes a mock interview session and computes cumulative STAR/technical scores.
    """
    interview = db.query(models.StudentMockInterview).filter(
        models.StudentMockInterview.id == interview_id,
        models.StudentMockInterview.student_profile_id == profile.id
    ).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview session not found or unauthorized access."
        )

    if interview.status != "COMPLETED":
        interview = finalize_mock_interview(interview, db)
        refresh_profile_readiness(db, profile)

    turns = db.query(models.StudentMockInterviewTurn).filter(
        models.StudentMockInterviewTurn.mock_interview_id == interview.id
    ).order_by(models.StudentMockInterviewTurn.turn_number.asc()).all()

    turn_details = [
        schemas.MockInterviewTurnDetail(
            id=t.id,
            turn_number=t.turn_number,
            question_text=t.question_text,
            student_response=t.student_response,
            feedback=t.feedback,
            turn_score=t.turn_score,
            created_at=t.created_at
        )
        for t in turns
    ]

    return schemas.MockInterviewDetailResponse(
        id=interview.id,
        interview_type=interview.interview_type,
        target_role=interview.target_role,
        status=interview.status,
        overall_score=interview.overall_score,
        star_structure_score=interview.star_structure_score,
        technical_accuracy_score=interview.technical_accuracy_score,
        feedback_summary=interview.feedback_summary,
        strengths=interview.strengths or [],
        areas_to_improve=interview.areas_to_improve or [],
        created_at=interview.created_at,
        completed_at=interview.completed_at,
        turns=turn_details
    )


@router.get("/mock-interview/history", response_model=List[schemas.MockInterviewSummaryResponse])
def get_mock_interview_history_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves student's previous mock interview sessions.
    """
    interviews = db.query(models.StudentMockInterview).filter(
        models.StudentMockInterview.student_profile_id == profile.id
    ).order_by(models.StudentMockInterview.created_at.desc()).all()

    results = []
    for interview in interviews:
        count = db.query(models.StudentMockInterviewTurn).filter(
            models.StudentMockInterviewTurn.mock_interview_id == interview.id,
            models.StudentMockInterviewTurn.student_response != None
        ).count()
        results.append(schemas.MockInterviewSummaryResponse(
            id=interview.id,
            interview_type=interview.interview_type,
            target_role=interview.target_role,
            status=interview.status,
            overall_score=interview.overall_score,
            created_at=interview.created_at,
            completed_at=interview.completed_at,
            turns_count=count
        ))

    return results


@router.get("/mock-interview/{interview_id}", response_model=schemas.MockInterviewDetailResponse)
def get_mock_interview_detail_endpoint(
    interview_id: int,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves comprehensive mock interview session details with all turn feedbacks.
    """
    interview = db.query(models.StudentMockInterview).filter(
        models.StudentMockInterview.id == interview_id,
        models.StudentMockInterview.student_profile_id == profile.id
    ).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview session not found or unauthorized access."
        )

    turns = db.query(models.StudentMockInterviewTurn).filter(
        models.StudentMockInterviewTurn.mock_interview_id == interview.id
    ).order_by(models.StudentMockInterviewTurn.turn_number.asc()).all()

    turn_details = [
        schemas.MockInterviewTurnDetail(
            id=t.id,
            turn_number=t.turn_number,
            question_text=t.question_text,
            student_response=t.student_response,
            feedback=t.feedback,
            turn_score=t.turn_score,
            created_at=t.created_at
        )
        for t in turns
    ]

    return schemas.MockInterviewDetailResponse(
        id=interview.id,
        interview_type=interview.interview_type,
        target_role=interview.target_role,
        status=interview.status,
        overall_score=interview.overall_score,
        star_structure_score=interview.star_structure_score,
        technical_accuracy_score=interview.technical_accuracy_score,
        feedback_summary=interview.feedback_summary,
        strengths=interview.strengths or [],
        areas_to_improve=interview.areas_to_improve or [],
        created_at=interview.created_at,
        completed_at=interview.completed_at,
        turns=turn_details
    )


# ==============================================================================
# PHASE 6: STUDENT PROJECTS & ARCHITECTURAL ANALYZER API
# ==============================================================================

def _best_effort_repo_summary(github_url: Optional[str]):
    """
    Repository facts for a project that is already saved. Never raises: an older project may have no (or an odd)
    link, and a repository that has since disappeared or a GitHub outage simply means no repository evidence.
    """
    if not github_url:
        return None
    try:
        owner, repo, _ = github_repo_service.parse_github_repo_url(github_url)
        return github_repo_service.fetch_repo_summary(owner, repo)
    except (ValueError, github_repo_service.RepoNotFound, github_repo_service.RepoUnavailable):
        return None


@router.get("/projects", response_model=List[schemas.StudentProjectResponse])
def get_student_projects_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Lists all portfolio projects belonging to the student.
    Strict tenant and student isolation.
    """
    projects = db.query(models.StudentProject).filter(
        models.StudentProject.student_profile_id == profile.id
    ).order_by(models.StudentProject.created_at.desc()).all()
    return projects


@router.post("/projects", response_model=schemas.StudentProjectResponse, status_code=status.HTTP_201_CREATED)
def create_student_project_endpoint(
    payload: schemas.StudentProjectCreateRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Creates a new student portfolio project and automatically computes the analysis.

    The title and a proper description are mandatory. The GitHub repository link is optional; when given it
    is checked on GitHub and its real contents (languages, README, activity) feed the review.
    """
    title = project_rules.clean_title(payload.title)
    description = project_rules.clean_description(payload.description)
    repo = project_rules.clean_github_url(payload.github_url) if (payload.github_url or "").strip() else None
    live_url = project_rules.clean_live_url(payload.live_url)
    repo_summary = project_rules.load_repo(repo) if repo else None  # 422 when a given repository does not exist
    tech_stack = project_rules.clean_tech_stack(payload.tech_stack) or project_rules.stack_from_repo(repo_summary)

    analysis = analyze_student_project(
        title=title,
        description=description,
        tech_stack=tech_stack,
        github_url=repo["url"] if repo else None,
        live_url=live_url,
        repo_summary=repo_summary
    )

    project = models.StudentProject(
        student_profile_id=profile.id,
        organization_id=profile.organization_id,
        title=title,
        description=description,
        tech_stack=tech_stack,
        github_url=repo["url"] if repo else None,
        live_url=live_url,
        architecture_review=analysis["architecture_review"],
        completeness_score=analysis["completeness_score"],
        suggested_interview_questions=analysis["suggested_interview_questions"],
        recommendations=analysis["recommendations"],
        bullet_point_improvements=analysis["bullet_point_improvements"]
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=schemas.StudentProjectResponse)
def get_student_project_endpoint(
    project_id: int,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves project details with architectural critique and interview preparation hints.
    """
    project = db.query(models.StudentProject).filter(
        models.StudentProject.id == project_id,
        models.StudentProject.student_profile_id == profile.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student project not found or unauthorized access."
        )
    return project


@router.put("/projects/{project_id}", response_model=schemas.StudentProjectResponse)
def update_student_project_endpoint(
    project_id: int,
    payload: schemas.StudentProjectUpdateRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Updates student project attributes and re-analyzes architectural signals.
    """
    project = db.query(models.StudentProject).filter(
        models.StudentProject.id == project_id,
        models.StudentProject.student_profile_id == profile.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student project not found or unauthorized access."
        )

    # Validate every change before anything is applied; a rejected edit leaves the project untouched
    if payload.title is not None:
        project.title = project_rules.clean_title(payload.title)
    if payload.description is not None:
        project.description = project_rules.clean_description(payload.description)
    if payload.tech_stack is not None:
        project.tech_stack = project_rules.clean_tech_stack(payload.tech_stack)
    if payload.github_url is not None:
        project.github_url = project_rules.clean_github_url(payload.github_url)["url"] if payload.github_url.strip() else None
    if payload.live_url is not None:
        project.live_url = project_rules.clean_live_url(payload.live_url)

    repo_summary = None
    if payload.github_url is not None and project.github_url:
        repo_summary = project_rules.load_repo(project_rules.clean_github_url(project.github_url))  # 422 if not found
    else:
        repo_summary = _best_effort_repo_summary(project.github_url)
    if not project.tech_stack:
        project.tech_stack = project_rules.stack_from_repo(repo_summary)

    analysis = analyze_student_project(
        title=project.title,
        description=project.description,
        tech_stack=project.tech_stack or [],
        github_url=project.github_url,
        live_url=project.live_url,
        repo_summary=repo_summary
    )
    project.architecture_review = analysis["architecture_review"]
    project.completeness_score = analysis["completeness_score"]
    project.suggested_interview_questions = analysis["suggested_interview_questions"]
    project.recommendations = analysis["recommendations"]
    project.bullet_point_improvements = analysis["bullet_point_improvements"]

    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}")
def delete_student_project_endpoint(
    project_id: int,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Deletes a student project.
    """
    project = db.query(models.StudentProject).filter(
        models.StudentProject.id == project_id,
        models.StudentProject.student_profile_id == profile.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student project not found or unauthorized access."
        )

    db.delete(project)
    db.commit()
    return {"message": "Project deleted successfully", "id": project_id}


@router.post("/projects/{project_id}/analyze", response_model=schemas.StudentProjectAnalysisResponse)
def analyze_student_project_endpoint(
    project_id: int,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Triggers explicit AI re-analysis of a project's architecture, interview questions, and resume bullet points.
    """
    project = db.query(models.StudentProject).filter(
        models.StudentProject.id == project_id,
        models.StudentProject.student_profile_id == profile.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student project not found or unauthorized access."
        )

    analysis = analyze_student_project(
        title=project.title,
        description=project.description,
        tech_stack=project.tech_stack or [],
        github_url=project.github_url,
        live_url=project.live_url,
        repo_summary=_best_effort_repo_summary(project.github_url)
    )
    project.architecture_review = analysis["architecture_review"]
    project.completeness_score = analysis["completeness_score"]
    project.suggested_interview_questions = analysis["suggested_interview_questions"]
    project.recommendations = analysis["recommendations"]
    project.bullet_point_improvements = analysis["bullet_point_improvements"]

    db.commit()
    db.refresh(project)

    return schemas.StudentProjectAnalysisResponse(
        id=project.id,
        title=project.title,
        completeness_score=project.completeness_score,
        architecture_review=project.architecture_review,
        suggested_interview_questions=project.suggested_interview_questions or [],
        recommendations=project.recommendations or [],
        bullet_point_improvements=project.bullet_point_improvements or []
    )


# ==============================================================================
# PHASE 7: PLACEMENT SIMULATION & MULTI-FACTOR READINESS API
# ==============================================================================

def _format_simulation_response(sim: models.StudentPlacementSimulation) -> schemas.SimulationDetailResponse:
    round_details = []
    for r in sim.rounds:
        clean_data = sanitize_round_data(r.round_type, r.round_data)
        round_details.append(schemas.SimulationRoundDetail(
            id=r.id,
            round_number=r.round_number,
            round_type=r.round_type,
            status=r.status,
            score=r.score,
            round_data=clean_data,
            feedback=r.feedback,
            completed_at=r.completed_at
        ))

    return schemas.SimulationDetailResponse(
        id=sim.id,
        student_profile_id=sim.student_profile_id,
        organization_id=sim.organization_id,
        target_role=sim.target_role,
        status=sim.status,
        current_round=sim.current_round,
        aptitude_score=sim.aptitude_score,
        coding_score=sim.coding_score,
        technical_interview_score=sim.technical_interview_score,
        hr_interview_score=sim.hr_interview_score,
        overall_score=sim.overall_score,
        report_summary=sim.report_summary,
        strengths=sim.strengths or [],
        weaknesses=sim.weaknesses or [],
        recommendations=sim.recommendations or [],
        rounds=round_details,
        created_at=sim.created_at,
        completed_at=sim.completed_at
    )


@router.post("/simulation/start", response_model=schemas.SimulationDetailResponse)
def start_simulation_endpoint(
    payload: schemas.SimulationStartRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Initializes a new 4-round campus placement drive simulation for the student.
    Strict tenant and student isolation.
    """
    sim = start_placement_simulation(
        profile=profile,
        target_role=payload.target_role,
        db=db
    )
    return _format_simulation_response(sim)


@router.get("/simulation/active", response_model=Optional[schemas.SimulationDetailResponse])
def get_active_simulation_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves the currently in-progress simulation for the student, or null if none.
    """
    sim = db.query(models.StudentPlacementSimulation).filter(
        models.StudentPlacementSimulation.student_profile_id == profile.id,
        models.StudentPlacementSimulation.status == "IN_PROGRESS"
    ).order_by(models.StudentPlacementSimulation.created_at.desc()).first()

    if not sim:
        return None
    return _format_simulation_response(sim)


@router.get("/simulation/history", response_model=List[schemas.SimulationDetailResponse])
def get_simulation_history_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Lists all past simulation drives for this student.
    """
    sims = db.query(models.StudentPlacementSimulation).filter(
        models.StudentPlacementSimulation.student_profile_id == profile.id
    ).order_by(models.StudentPlacementSimulation.created_at.desc()).all()

    return [_format_simulation_response(s) for s in sims]


@router.get("/simulation/{simulation_id}", response_model=schemas.SimulationDetailResponse)
def get_simulation_detail_endpoint(
    simulation_id: int,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves full scorecard and rounds detail for a specific simulation.
    Confidential answer keys and hidden test cases are stripped.
    """
    sim = db.query(models.StudentPlacementSimulation).filter(
        models.StudentPlacementSimulation.id == simulation_id,
        models.StudentPlacementSimulation.student_profile_id == profile.id
    ).first()

    if not sim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Placement simulation not found or unauthorized access."
        )
    return _format_simulation_response(sim)


@router.post("/simulation/{simulation_id}/round/{round_number}/submit", response_model=schemas.SimulationRoundSubmitResponse)
def submit_simulation_round_endpoint(
    simulation_id: int,
    round_number: int,
    payload: schemas.SimulationRoundSubmitRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Evaluates submission for the specified round and advances the candidate.
    """
    sim = db.query(models.StudentPlacementSimulation).filter(
        models.StudentPlacementSimulation.id == simulation_id,
        models.StudentPlacementSimulation.student_profile_id == profile.id
    ).first()

    if not sim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Placement simulation not found or unauthorized access."
        )

    if sim.status != "IN_PROGRESS":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot submit to an inactive or completed placement simulation."
        )

    try:
        result = submit_simulation_round(
            simulation=sim,
            round_number=round_number,
            submission_payload=payload.dict(),
            profile=profile,
            db=db
        )
        return schemas.SimulationRoundSubmitResponse(**result)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==============================================================================
# PHASE 8: CAREER COPILOT & UNIFIED DASHBOARD API
# ==============================================================================

@router.post("/copilot/chat", response_model=schemas.CopilotMessageResponse)
def copilot_chat_endpoint(
    payload: schemas.CopilotChatRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Submits student question to Career Copilot, grounded in profile and preparation metrics.
    """
    if not payload.content or not payload.content.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty."
        )

    assistant_msg = send_copilot_message(
        profile=profile,
        user_content=payload.content,
        db=db
    )

    return schemas.CopilotMessageResponse(
        id=assistant_msg.id,
        role=assistant_msg.role,
        content=assistant_msg.content,
        intent=assistant_msg.intent,
        created_at=assistant_msg.created_at
    )


@router.get("/copilot/history", response_model=schemas.CopilotHistoryResponse)
def get_copilot_history_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves message history and dynamic starter suggestions for the student.
    """
    history_data = get_copilot_history(profile, db)
    formatted_messages = [
        schemas.CopilotMessageResponse(
            id=m.id,
            role=m.role,
            content=m.content,
            intent=m.intent,
            created_at=m.created_at
        )
        for m in history_data["messages"]
    ]

    return schemas.CopilotHistoryResponse(
        messages=formatted_messages,
        suggestions=history_data["suggestions"]
    )


@router.delete("/copilot/history")
def clear_copilot_history_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Clears Copilot conversation history for the current student.
    """
    count = clear_copilot_history(profile, db)
    return {"message": "Copilot history cleared successfully", "deleted_count": count}


@router.get("/dashboard/unified")
def get_unified_dashboard_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns complete multi-phase aggregated metrics for the Student Career Hub.
    """
    ctx = assemble_student_context(profile, db)
    history_data = get_copilot_history(profile, db)

    return {
        "student_name": profile.full_name,
        "target_role": ctx["target_role"],
        "target_company": ctx["target_company"],
        "readiness_score": ctx["readiness_score"],
        "readiness_breakdown": profile.readiness_breakdown or {},
        "resume": {
            "score": ctx["resume_score"],
            "ats_score": ctx["ats_score"]
        },
        "roadmap": {
            "completed_tasks": ctx["roadmap_completed"],
            "total_tasks": ctx["roadmap_total"]
        },
        "practice": {
            "solved_count": ctx["practice_solved"]
        },
        "mock_interviews": {
            "completed_sessions": ctx["mock_interviews_count"],
            "avg_score": ctx["avg_interview_score"]
        },
        "projects": {
            "total_projects": ctx["projects_count"]
        },
        "placement_simulation": {
            "score": ctx["simulation_score"]
        },
        "copilot_suggestions": history_data["suggestions"]
    }


# ==============================================================================
# PHASE 9: STUDENT PLACEMENT DRIVES ACCESS API
# ==============================================================================

@router.get("/drives", response_model=List[schemas.PlacementDriveResponse])
def get_student_available_drives_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Lists on-campus placement drives available to this student from their college,
    annotating eligibility and whether the student has already applied.
    """
    return college_service.get_student_available_drives(
        student_profile=profile,
        db=db
    )


@router.post("/drives/{drive_id}/apply", response_model=schemas.DriveApplicationResponse, status_code=status.HTTP_201_CREATED)
def apply_to_placement_drive_endpoint(
    drive_id: int,
    notes: Optional[str] = None,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Submits student's application to a college placement drive.
    Validates minimum CGPA and checks duplicate prevention.
    """
    try:
        app_data = college_service.apply_student_to_drive(
            student_profile=profile,
            drive_id=drive_id,
            notes=notes,
            db=db
        )
        return schemas.DriveApplicationResponse(
            id=app_data["id"],
            drive_id=app_data["drive_id"],
            student_profile_id=app_data["student_profile_id"],
            organization_id=app_data["organization_id"],
            status=app_data["status"],
            notes=app_data["notes"],
            applied_at=app_data["applied_at"],
            student_name=profile.full_name,
            student_email=profile.email,
            student_branch=profile.branch,
            student_cgpa=profile.cgpa,
            student_readiness_score=profile.readiness_score,
            student_skills=profile.current_skills or [],
            company_name=app_data["company_name"],
            role_title=app_data["role_title"]
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/drives/applications", response_model=List[schemas.DriveApplicationResponse])
def get_student_drive_applications_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Lists all placement drive applications submitted by the authenticated student.
    """
    applications = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.student_profile_id == profile.id
    ).order_by(models.PlacementDriveApplication.applied_at.desc()).all()

    results = []
    for app in applications:
        drive = app.drive
        results.append(schemas.DriveApplicationResponse(
            id=app.id,
            drive_id=app.drive_id,
            student_profile_id=app.student_profile_id,
            organization_id=app.organization_id,
            status=app.status,
            notes=app.notes,
            applied_at=app.applied_at,
            student_name=profile.full_name,
            student_email=profile.email,
            student_branch=profile.branch,
            student_cgpa=profile.cgpa,
            student_readiness_score=profile.readiness_score,
            student_skills=profile.current_skills or [],
            company_name=drive.company_name if drive else None,
            role_title=drive.role_title if drive else None
        ))
    return results


# ==============================================================================
# PHASE 10: STUDENT ENROLLMENT, ONBOARDING & ROLE-BASED UX API
# ==============================================================================

@router.get("/onboarding/status", response_model=schemas.OnboardingStatusResponse)
def get_student_onboarding_status_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns student onboarding completion status, active step, and recommended actions.
    """
    status_data = onboarding_service.get_student_onboarding_status(profile, db)
    return schemas.OnboardingStatusResponse(**status_data)


@router.post("/onboarding/step", response_model=schemas.StudentProfileResponse)
def update_onboarding_step_endpoint(
    payload: schemas.OnboardingStepUpdateRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Persists incremental progress through the 4-step guided onboarding wizard.
    """
    updated_profile = onboarding_service.process_onboarding_step(
        profile=profile,
        step_data=payload.dict(exclude_unset=True),
        db=db
    )

    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == updated_profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_summary = None
    if latest_resume:
        resume_summary = {
            "id": latest_resume.id,
            "version": latest_resume.version,
            "file_name": latest_resume.file_name,
            "overall_score": latest_resume.overall_score,
            "ats_score": latest_resume.ats_score,
            "created_at": latest_resume.created_at
        }

    return schemas.StudentProfileResponse(
        id=updated_profile.id,
        user_id=updated_profile.user_id,
        organization_id=updated_profile.organization_id,
        full_name=updated_profile.full_name,
        email=updated_profile.email,
        phone=updated_profile.phone,
        college_name=updated_profile.college_name,
        branch=updated_profile.branch,
        graduation_year=updated_profile.graduation_year,
        cgpa=updated_profile.cgpa,
        target_role=updated_profile.target_role,
        target_company=updated_profile.target_company,
        current_skills=updated_profile.current_skills or [],
        readiness_score=updated_profile.readiness_score,
        readiness_breakdown=updated_profile.readiness_breakdown or {},
        latest_resume=resume_summary,
        is_onboarded=updated_profile.is_onboarded,
        onboarding_step=updated_profile.onboarding_step,
        created_at=updated_profile.created_at
    )


@router.post("/onboarding/complete", response_model=schemas.StudentProfileResponse)
def complete_onboarding_endpoint(
    payload: schemas.OnboardingCompleteRequest,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Marks the student onboarding as complete and computes baseline placement readiness.
    """
    updated_profile = onboarding_service.finalize_onboarding(
        profile=profile,
        complete_data=payload.dict(),
        db=db
    )

    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == updated_profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    resume_summary = None
    if latest_resume:
        resume_summary = {
            "id": latest_resume.id,
            "version": latest_resume.version,
            "file_name": latest_resume.file_name,
            "overall_score": latest_resume.overall_score,
            "ats_score": latest_resume.ats_score,
            "created_at": latest_resume.created_at
        }

    return schemas.StudentProfileResponse(
        id=updated_profile.id,
        user_id=updated_profile.user_id,
        organization_id=updated_profile.organization_id,
        full_name=updated_profile.full_name,
        email=updated_profile.email,
        phone=updated_profile.phone,
        college_name=updated_profile.college_name,
        branch=updated_profile.branch,
        graduation_year=updated_profile.graduation_year,
        cgpa=updated_profile.cgpa,
        target_role=updated_profile.target_role,
        target_company=updated_profile.target_company,
        current_skills=updated_profile.current_skills or [],
        readiness_score=updated_profile.readiness_score,
        readiness_breakdown=updated_profile.readiness_breakdown or {},
        latest_resume=resume_summary,
        is_onboarded=updated_profile.is_onboarded,
        onboarding_step=updated_profile.onboarding_step,
        created_at=updated_profile.created_at
    )


# ==============================================================================
# PHASE 11: STUDENT PERFORMANCE DASHBOARD & ASSESSMENT HISTORY API
# ==============================================================================

@router.get("/performance/dashboard", response_model=schemas.StudentPerformanceDashboardResponse)
def get_student_performance_dashboard_endpoint(
    profile: models.StudentProfile = Depends(get_current_student_profile),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Returns unified student performance metrics:
    - Overview & active test alerts
    - Summary Cards (Total Completed, True Average, Best Performance, In Progress)
    - Chronological Performance Trends (Recharts ready)
    - Evaluated Skills Proficiency vs Resume Estimates
    - Actionable Recommended Next Steps
    - Real Activity Stream
    """
    return student_performance_service.get_student_performance_dashboard(
        db=db,
        profile=profile,
        current_user=current_user
    )


@router.get("/performance/history", response_model=schemas.StudentAssessmentHistoryResponse)
def get_student_assessment_history_endpoint(
    category: Optional[str] = "ALL",
    status: Optional[str] = "ALL",
    sort_by: Optional[str] = "date_desc",
    page: int = 1,
    page_size: int = 10,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Returns filtered, sorted, paginated assessment history for the authenticated student.
    Enforces student-level ownership and tenant isolation.
    """
    return student_performance_service.get_student_assessment_history(
        db=db,
        profile=profile,
        current_user=current_user,
        category=category,
        status=status,
        sort_by=sort_by,
        page=page,
        page_size=page_size
    )


@router.get("/performance/assessment/{assessment_type}/{assessment_id}", response_model=schemas.StudentAssessmentDetailResponse)
def get_student_assessment_detail_endpoint(
    assessment_type: str,
    assessment_id: str,
    profile: models.StudentProfile = Depends(get_current_student_profile),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Returns sanitized detailed assessment results for an authorized student.
    Strictly strips hidden test cases, server secret keys, and internal evaluation prompts.
    """
    try:
        return student_performance_service.get_student_assessment_detail(
            db=db,
            profile=profile,
            assessment_type=assessment_type,
            assessment_id=assessment_id
        )
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )







