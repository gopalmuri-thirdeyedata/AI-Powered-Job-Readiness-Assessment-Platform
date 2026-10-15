"""
RoleReady — API Router
Exposes endpoints for:
1. Workflow A: Student Self-Assessment (Initialize, Aptitude, Coding, Interview, Report)
2. Workflow B: Administrator Recruitment (Batches, Bulk Candidate Import, Invitations, Consolidated Reporting)
3. Candidate Invitation Portal: Verification and sequential assessment execution
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query, Header
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import os
import re
import shutil
from pathlib import Path
from jose import jwt, JWTError

import models
import database
import utils
from routers.auth import require_hr_or_admin, get_current_tenant
from routers.student import get_current_student_profile
from services import roleready_service
from services.student_resume_analyzer import extract_resume_text, analyze_student_resume, extract_candidate_name_from_resume, persist_student_resume_version
from services.rag_service import RAGService
import secrets
import uuid
from datetime import timedelta

router = APIRouter(
    prefix="/api/roleready",
    tags=["roleready"]
)

def get_authorized_session(
    session_uuid: str,
    authorization: Optional[str] = Header(None),
    x_invitation_token: Optional[str] = Header(None, alias="X-Invitation-Token"),
    db: Session = Depends(database.get_db)
) -> models.RoleReadySession:
    """
    Enforces strict access control on RoleReady assessment sessions:
    1. Checks candidate invitation token (via X-Invitation-Token or Authorization).
    2. Checks student ownership (student_profile_id matches authenticated student).
    3. Checks recruiter/administrator ownership (organization_id matches or platform admin).
    Fails closed with HTTP 401 if unauthenticated, or HTTP 403 if unauthorized.
    """
    # Fail closed immediately with HTTP 401 if no credentials provided
    invite_token = x_invitation_token
    if not invite_token and authorization and not authorization.startswith("Bearer "):
        invite_token = authorization.strip()

    has_bearer = bool(authorization and authorization.startswith("Bearer "))
    if not invite_token and not has_bearer:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to access this assessment session."
        )

    session = roleready_service.get_session_by_uuid(db, session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="Assessment session not found.")

    # 1. Check invitation token
    if invite_token:
        inv = db.query(models.CandidateInvitation).filter(
            models.CandidateInvitation.invitation_token == invite_token
        ).first()
        if inv:
            if inv.expires_at < datetime.utcnow():
                raise HTTPException(status_code=410, detail="Assessment invitation has expired.")
            if session.invitation_id == inv.id:
                roleready_service.finalize_expired_round(db, session)
                return session
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invitation token is not authorized for this assessment session."
            )

    # 2. Check JWT Bearer token
    if authorization and authorization.startswith("Bearer "):
        token_str = authorization.split(" ", 1)[1].strip()
        try:
            payload = jwt.decode(token_str, utils.SECRET_KEY, algorithms=[utils.ALGORITHM])
            email = payload.get("sub")
            if not email:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")
            
            user = db.query(models.User).filter(models.User.email == email).first()
            if not user:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")

            # Platform Admin always has oversight access
            if getattr(user, "role", None) == models.UserRole.PLATFORM_ADMIN:
                roleready_service.finalize_expired_round(db, session)
                return session

            # If user is a student:
            if getattr(user, "role", None) == models.UserRole.STUDENT or user.student_profile:
                profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
                if profile and session.student_profile_id == profile.id:
                    roleready_service.finalize_expired_round(db, session)
                    return session
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: You do not own this assessment session."
                )

            # If user is admin/hr:
            if getattr(user, "role", None) in [models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR_ADMIN, models.UserRole.HR]:
                if session.organization_id == user.organization_id:
                    roleready_service.finalize_expired_round(db, session)
                    return session
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: You do not have permission to access another organization's assessment session."
                )

            # Any other authenticated role that does not have authorization
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You do not have permission to access this assessment session."
            )

        except JWTError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate authentication credentials."
            )

    # If neither valid invitation token nor valid user token was accepted:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required to access this assessment session."
    )

MEDIA_UPLOAD_DIR = Path("media/roleready")
MEDIA_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ==============================================================================
# PYDANTIC SCHEMAS
# ==============================================================================

class InitStudentSessionSchema(BaseModel):
    target_role: Optional[str] = "Software Engineer"
    target_company: Optional[str] = None
    custom_jd_text: Optional[str] = None

class AptitudeSubmissionSchema(BaseModel):
    answers: Dict[str, str] # { "1": "B", "2": "C" }
    time_spent_seconds: Optional[int] = 0
    proctoring_violations: Optional[List[Dict[str, Any]]] = None

class RunCodeSchema(BaseModel):
    problem_id: str
    code: str
    language: Optional[str] = "python"

class CodingSubmissionSchema(BaseModel):
    solutions: Dict[str, Dict[str, str]] # { "1": {"code": "...", "language": "python"} }
    time_spent_seconds: Optional[int] = 0
    proctoring_violations: Optional[List[Dict[str, Any]]] = None

class InterviewSubmissionSchema(BaseModel):
    answers: Optional[List[Dict[str, Any]]] = None
    transcript: Optional[List[Dict[str, Any]]] = None
    time_spent_seconds: Optional[int] = 0
    proctoring_violations: Optional[List[Dict[str, Any]]] = None

class TerminateSessionSchema(BaseModel):
    reason: Optional[str] = "3/3 Malpractice Violations Recorded"
    proctoring_violations: Optional[List[Dict[str, Any]]] = None
    round_type: Optional[str] = None

class CreateBatchSchema(BaseModel):
    batch_name: str
    job_description_id: Optional[int] = None
    description: Optional[str] = None

class SendInvitationsSchema(BaseModel):
    candidate_ids: List[int]


# ==============================================================================
# WORKFLOW A: STUDENT SELF-ASSESSMENT ENDPOINTS
# ==============================================================================

@router.post("/student/initialize")
def initialize_student_session(
    target_role: Optional[str] = Form("Software Engineer"),
    target_company: Optional[str] = Form(None),
    custom_jd_text: Optional[str] = Form(None),
    resume_file: Optional[UploadFile] = File(None),
    jd_file: Optional[UploadFile] = File(None),
    student_profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Initializes a new RoleReady student self-assessment session.
    Parses resume (uploaded or existing) and Job Description (pasted or uploaded).
    """
    if not target_role or not target_role.strip():
        raise HTTPException(status_code=400, detail="Target job role is required.")

    clean_role = target_role.strip()
    clean_company = target_company.strip() if target_company and target_company.strip() else None

    MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
    saved_resume_path = None
    saved_resume_name = None
    resume_snapshot = None
    resume_raw_text = None

    # Handle uploaded resume file if provided
    if resume_file:
        file_ext = Path(resume_file.filename).suffix.lower()
        if file_ext not in [".pdf", ".docx", ".txt"]:
            raise HTTPException(status_code=400, detail="Invalid resume file format. Allowed: .pdf, .docx, .txt")
        
        resume_file.file.seek(0, os.SEEK_END)
        fsize = resume_file.file.tell()
        resume_file.file.seek(0)
        if fsize > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="Resume file size exceeds maximum limit of 10 MB.")

        filename = f"resume_student_{student_profile.id}_{os.urandom(4).hex()}{file_ext}"
        saved_resume_path = str(MEDIA_UPLOAD_DIR / filename)
        saved_resume_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', os.path.basename(resume_file.filename))
        with open(saved_resume_path, "wb") as buffer:
            shutil.copyfileobj(resume_file.file, buffer)

        extracted_text = extract_resume_text(saved_resume_path)
        if extracted_text:
            resume_raw_text = extracted_text
            cand_name = extract_candidate_name_from_resume(extracted_text)
            if cand_name:
                student_profile.full_name = cand_name
                db.commit()
                db.refresh(student_profile)
            analysis = analyze_student_resume(extracted_text, clean_role)
            if cand_name and isinstance(analysis, dict):
                analysis["candidate_name"] = cand_name
            resume_snapshot = analysis

    # Handle uploaded JD file if provided
    final_jd_text = (custom_jd_text or "").strip()
    if jd_file:
        jd_ext = Path(jd_file.filename).suffix.lower()
        if jd_ext not in [".pdf", ".docx", ".txt"]:
            raise HTTPException(status_code=400, detail="Invalid JD file format. Allowed: .pdf, .docx, .txt")
        
        jd_file.file.seek(0, os.SEEK_END)
        jd_size = jd_file.file.tell()
        jd_file.file.seek(0)
        if jd_size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="Job description file size exceeds maximum limit of 10 MB.")

        jd_filename = f"jd_student_{student_profile.id}_{os.urandom(4).hex()}{jd_ext}"
        saved_jd_path = str(MEDIA_UPLOAD_DIR / jd_filename)
        with open(saved_jd_path, "wb") as buffer:
            shutil.copyfileobj(jd_file.file, buffer)
        file_jd_text = extract_resume_text(saved_jd_path)
        if not file_jd_text or not file_jd_text.strip():
            raise HTTPException(
                status_code=400,
                detail="The uploaded job description document is empty or could not be read. Please provide valid text."
            )
        final_jd_text = file_jd_text.strip()

    # Enforce non-empty Job Description requirement
    if not final_jd_text:
        raise HTTPException(
            status_code=400,
            detail="Job description is required. Please paste the job description or upload a valid document."
        )

    # Check for recent identical session to prevent duplicate creation on rapid retries
    recent_cutoff = datetime.utcnow() - timedelta(seconds=15)
    recent_session = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.student_profile_id == student_profile.id,
        models.RoleReadySession.target_role == clean_role,
        models.RoleReadySession.current_state == models.RoleReadySessionState.NOT_STARTED,
        models.RoleReadySession.created_at >= recent_cutoff
    ).order_by(models.RoleReadySession.id.desc()).first()

    if recent_session:
        return {
            "message": "RoleReady assessment session already initialized.",
            "session_uuid": recent_session.session_uuid,
            "current_state": recent_session.current_state,
            "target_role": recent_session.target_role,
            "target_company": recent_session.target_company,
            "extracted_jd": recent_session.extracted_jd_data
        }

    # Reuse the analysis we just computed as the student's Resume-page version (no second AI call)
    if resume_snapshot and resume_raw_text:
        try:
            persist_student_resume_version(
                db, student_profile, saved_resume_path, saved_resume_name or "resume", resume_raw_text, resume_snapshot
            )
        except Exception as e:
            db.rollback()
            print(f"[RoleReady] Could not sync resume to Resume page: {e}")

    try:
        session = roleready_service.create_student_session(
            db=db,
            student_profile=student_profile,
            target_role=clean_role,
            target_company=clean_company,
            custom_jd_text=final_jd_text,
            resume_file_path=saved_resume_path,
            resume_snapshot=resume_snapshot,
            resume_raw_text=resume_raw_text
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Assessment session initialization failed: {str(e)}"
        )

    return {
        "message": "RoleReady assessment session initialized successfully.",
        "session_uuid": session.session_uuid,
        "current_state": session.current_state,
        "target_role": session.target_role,
        "target_company": session.target_company,
        "resume_match_score": roleready_service.compute_resume_jd_match(session),
        "extracted_jd": session.extracted_jd_data
    }


@router.get("/student/assessments")
@router.get("/student/history")
def get_student_assessment_history(
    student_profile: models.StudentProfile = Depends(get_current_student_profile),
    db: Session = Depends(database.get_db)
):
    """
    Returns complete assessment history, aggregate metrics, round-wise trends,
    and improvement areas strictly for the authenticated student.
    """
    sessions = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.student_profile_id == student_profile.id
    ).order_by(models.RoleReadySession.created_at.desc()).all()

    total_attempted = len(sessions)
    completed_sessions = [s for s in sessions if s.current_state == models.RoleReadySessionState.COMPLETED]
    total_completed = len(completed_sessions)

    # In-progress / unfinished session (most recent if any)
    in_progress = next((s for s in sessions if s.current_state != models.RoleReadySessionState.COMPLETED), None)

    # Format session list
    records = []
    for s in sessions:
        records.append({
            "id": s.id,
            "session_uuid": s.session_uuid,
            "target_role": s.target_role,
            "target_company": s.target_company,
            "current_state": s.current_state,
            "is_completed": s.current_state == models.RoleReadySessionState.COMPLETED,
            "is_disqualified": bool((s.final_report_data or {}).get("is_disqualified")),
            "termination_reason": (s.final_report_data or {}).get("termination_reason"),
            "aptitude_score": round(float(s.aptitude_score or 0.0), 1),
            "coding_score": round(float(s.coding_score or 0.0), 1),
            "interview_score": round(float(s.interview_score or 0.0), 1),
            "overall_readiness_score": round(float(s.overall_readiness_score or 0.0), 1),
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "report_url": f"/assessment/{s.session_uuid}/report" if s.current_state == models.RoleReadySessionState.COMPLETED else None,
            "continue_url": f"/assessment/{s.session_uuid}" if s.current_state != models.RoleReadySessionState.COMPLETED else None,
        })

    # Latest assessment summary
    latest = records[0] if records else None

    # Trends sorted chronologically (oldest to newest)
    trends = []
    for s in reversed(sessions):
        trends.append({
            "date": s.created_at.strftime("%b %d") if s.created_at else "Assessment",
            "full_date": s.created_at.isoformat() if s.created_at else None,
            "role": s.target_role,
            "aptitude": round(float(s.aptitude_score or 0.0), 1),
            "coding": round(float(s.coding_score or 0.0), 1),
            "interview": round(float(s.interview_score or 0.0), 1),
            "overall": round(float(s.overall_readiness_score or 0.0), 1),
        })

    # Compute areas for improvement based on completed scores
    areas_for_improvement = []
    if completed_sessions:
        avg_aptitude = sum(s.aptitude_score or 0.0 for s in completed_sessions) / len(completed_sessions)
        avg_coding = sum(s.coding_score or 0.0 for s in completed_sessions) / len(completed_sessions)
        avg_interview = sum(s.interview_score or 0.0 for s in completed_sessions) / len(completed_sessions)

        if avg_aptitude < 75:
            areas_for_improvement.append({
                "round": "Aptitude Round",
                "score": round(avg_aptitude, 1),
                "topic": "Quantitative & Logical Problem Solving",
                "recommendation": "Focus on numerical agility, data interpretation, and timed reasoning questions."
            })
        if avg_coding < 75:
            areas_for_improvement.append({
                "round": "Coding Challenge",
                "score": round(avg_coding, 1),
                "topic": "Algorithms & Edge Case Handling",
                "recommendation": "Practice dynamic programming, string hashing, and verify edge cases against hidden test cases."
            })
        if avg_interview < 75:
            areas_for_improvement.append({
                "round": "Technical Interview",
                "score": round(avg_interview, 1),
                "topic": "System Design & Technical Communication",
                "recommendation": "Practice STAR-method verbal explanations, architectural tradeoffs, and behavioral clarity."
            })
    elif sessions:
        # Default encouragement if attempts started but not completed
        areas_for_improvement.append({
            "round": "In-Progress Preparation",
            "score": 0.0,
            "topic": "Assessment Completion",
            "recommendation": "Complete all 3 rounds (Aptitude, Coding, Interview) to generate your job-readiness benchmark."
        })

    return {
        "student_id": student_profile.id,
        "student_name": student_profile.full_name,
        "total_attempted": total_attempted,
        "total_completed": total_completed,
        "latest_assessment": latest,
        "active_session": {
            "session_uuid": in_progress.session_uuid,
            "target_role": in_progress.target_role,
            "current_state": in_progress.current_state,
            "continue_url": f"/assessment/{in_progress.session_uuid}"
        } if in_progress else None,
        "assessments": records,
        "trends": trends,
        "areas_for_improvement": areas_for_improvement
    }


@router.get("/session/{session_uuid}")
def get_session_status(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    """Fetches session metadata, current state, and unlocked rounds."""
    # Server-side timer authority: finalize an abandoned round whose deadline has passed.
    roleready_service.finalize_expired_round(db, session)
    coding_unlocked = session.current_state in [
        models.RoleReadySessionState.CODING_UNLOCKED,
        models.RoleReadySessionState.CODING_IN_PROGRESS,
        models.RoleReadySessionState.CODING_SUBMITTED,
        models.RoleReadySessionState.CODING_EVALUATED,
        models.RoleReadySessionState.INTERVIEW_UNLOCKED,
        models.RoleReadySessionState.INTERVIEW_IN_PROGRESS,
        models.RoleReadySessionState.INTERVIEW_SUBMITTED,
        models.RoleReadySessionState.INTERVIEW_EVALUATED,
        models.RoleReadySessionState.COMPLETED
    ]
    interview_unlocked = session.current_state in [
        models.RoleReadySessionState.INTERVIEW_UNLOCKED,
        models.RoleReadySessionState.INTERVIEW_IN_PROGRESS,
        models.RoleReadySessionState.INTERVIEW_SUBMITTED,
        models.RoleReadySessionState.INTERVIEW_EVALUATED,
        models.RoleReadySessionState.COMPLETED
    ]

    return {
        "session_uuid": session.session_uuid,
        "target_role": session.target_role,
        "target_company": session.target_company,
        "current_state": session.current_state,
        "aptitude_score": session.aptitude_score,
        "coding_score": session.coding_score,
        "interview_score": session.interview_score,
        "overall_readiness_score": session.overall_readiness_score,
        "coding_unlocked": coding_unlocked,
        "interview_unlocked": interview_unlocked,
        "is_completed": session.current_state == models.RoleReadySessionState.COMPLETED
    }


# ─── ROUND 1: APTITUDE ────────────────────────────────────────────────────────

@router.post("/session/{session_uuid}/start-aptitude")
def start_aptitude(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    return roleready_service.start_aptitude_round(db, session)


@router.post("/session/{session_uuid}/submit-aptitude")
def submit_aptitude(
    payload: AptitudeSubmissionSchema,
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    return roleready_service.submit_aptitude_round(
        db, 
        session, 
        payload.answers, 
        payload.time_spent_seconds or 0,
        payload.proctoring_violations
    )


# ─── ROUND 2: CODING ──────────────────────────────────────────────────────────

@router.post("/session/{session_uuid}/start-coding")
def start_coding(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    """STRICT BACKEND GATING: Fails with HTTP 403 if aptitude is not completed."""
    return roleready_service.start_coding_round(db, session)


@router.post("/session/{session_uuid}/run-code")
def run_code_test(
    payload: RunCodeSchema,
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    return roleready_service.run_coding_test(
        db, 
        session, 
        payload.problem_id, 
        payload.code, 
        payload.language or "python"
    )


@router.post("/session/{session_uuid}/submit-coding")
def submit_coding(
    payload: CodingSubmissionSchema,
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    return roleready_service.submit_coding_round(
        db,
        session,
        payload.solutions,
        payload.time_spent_seconds or 0,
        payload.proctoring_violations
    )


# ─── ROUND 3: INTERVIEW ───────────────────────────────────────────────────────

@router.post("/session/{session_uuid}/start-interview")
def start_interview(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    """STRICT BACKEND GATING: Fails with HTTP 403 if coding is not completed."""
    return roleready_service.start_interview_round(db, session)


@router.post("/session/{session_uuid}/vapi-init")
def init_vapi_interview(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    """
    STRICT BACKEND GATING: Fails with HTTP 403 if coding is not completed.
    Synthesizes custom questions grounded in Resume + JD and provisions dynamic Vapi assistant.
    """
    return roleready_service.init_vapi_interview_session(db, session)


@router.post("/session/{session_uuid}/submit-interview")
def submit_interview(
    payload: InterviewSubmissionSchema,
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    # Scoring the interview takes a while (one large AI call), so it runs in the background and the
    # report page waits for it. The student is not held on the submit button.
    return roleready_service.start_interview_evaluation(
        db,
        session,
        {"answers": payload.answers or [], "transcript": payload.transcript or []},
        payload.time_spent_seconds or 0,
        payload.proctoring_violations
    )


@router.post("/session/{session_uuid}/retry-interview-evaluation")
def retry_interview_evaluation(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    """Re-runs a failed interview evaluation from the stored submission."""
    return roleready_service.retry_interview_evaluation(db, session)


@router.post("/session/{session_uuid}/terminate")
def terminate_session(
    payload: TerminateSessionSchema,
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    """Fast-path termination: Immediately locks and disqualifies the session on 3 strikes without running heavy AI or compilers."""
    return roleready_service.terminate_malpractice_session(
        db=db,
        session=session,
        reason=payload.reason or "3/3 Malpractice Violations Recorded",
        violations=payload.proctoring_violations,
        round_type=payload.round_type
    )


# ─── FINAL STUDENT REPORT ─────────────────────────────────────────────────────

@router.get("/session/{session_uuid}/report")
def get_student_report(
    session: models.RoleReadySession = Depends(get_authorized_session),
    db: Session = Depends(database.get_db)
):
    return roleready_service.get_student_report(db, session)


# ==============================================================================
# WORKFLOW B: ADMINISTRATOR RECRUITMENT ENDPOINTS
# ==============================================================================

@router.post("/admin/batches")
def create_recruitment_batch(
    payload: CreateBatchSchema,
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Organization context required.")

    batch = roleready_service.create_recruitment_batch(
        db=db,
        org_id=org_id,
        batch_name=payload.batch_name,
        jd_id=payload.job_description_id,
        description=payload.description,
        created_by_user_id=current_user.id
    )
    return {
        "message": "Recruitment batch created successfully.",
        "batch_id": batch.id,
        "batch_name": batch.batch_name
    }


@router.get("/admin/batches")
def list_recruitment_batches(
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    batches = db.query(models.RecruitmentBatch).filter(
        models.RecruitmentBatch.organization_id == org_id
    ).order_by(models.RecruitmentBatch.created_at.desc()).all()

    return [
        {
            "id": b.id,
            "batch_name": b.batch_name,
            "description": b.description,
            "total_candidates": b.total_candidates,
            "created_at": b.created_at.isoformat() if b.created_at else None
        }
        for b in batches
    ]


@router.post("/admin/batches/{batch_id}/invitations")
def send_batch_invitations(
    batch_id: int,
    payload: SendInvitationsSchema,
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    invitations = roleready_service.send_batch_invitations(
        db, org_id, batch_id, payload.candidate_ids
    )
    return {
        "message": f"Successfully sent {len(invitations)} assessment invitations.",
        "invitations_count": len(invitations),
        "tokens": [inv.invitation_token for inv in invitations]
    }


@router.get("/admin/tracking")
def get_admin_candidate_tracking(
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """Returns real-time candidate assessment progression scoped to the admin's organization."""
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    if not org_id:
        return []
    return roleready_service.get_admin_tracking_data(db, org_id)


class CandidateDispatchItem(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    file_path: Optional[str] = None


class DispatchAssessmentPayload(BaseModel):
    batch_name: str
    target_role: Optional[str] = "Software Engineer"
    target_company: Optional[str] = "ThirdEye Data"
    job_description: str
    candidates: List[CandidateDispatchItem]


@router.post("/admin/parse-resumes")
async def parse_admin_resumes(
    files: List[UploadFile] = File(...),
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Step 1: Parses multiple student resumes, extracts candidate details (name, email, phone),
    validates email format, and flags invalid/missing data.
    """
    admin_upload_dir = Path("media/roleready/resumes")
    admin_upload_dir.mkdir(parents=True, exist_ok=True)

    extracted_candidates = []
    for file in files:
        file_uuid = str(uuid.uuid4())
        safe_name = f"{file_uuid}_{file.filename.replace(' ', '_')}"
        saved_path = admin_upload_dir / safe_name

        try:
            with open(saved_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            raw_text = extract_resume_text(str(saved_path))
            cand_info = RAGService.extract_candidate_info(raw_text, file.filename)
            cand_name = cand_info.get("name") or Path(file.filename).stem.replace("_", " ").title()
            cand_email = (cand_info.get("email") or "").strip()
            is_valid = bool(cand_email and utils.is_valid_candidate_email(cand_email))

            extracted_candidates.append({
                "file_id": file_uuid,
                "filename": file.filename,
                "file_path": str(saved_path),
                "name": cand_name,
                "email": cand_email,
                "phone": cand_info.get("phone") or "",
                "is_valid_email": is_valid,
                "status": "VALID" if is_valid else "MISSING_EMAIL",
                "text_snippet": raw_text[:200] if raw_text else ""
            })
        except Exception as e:
            extracted_candidates.append({
                "file_id": file_uuid,
                "filename": file.filename,
                "file_path": str(saved_path) if saved_path.exists() else "",
                "name": Path(file.filename).stem.replace("_", " ").title(),
                "email": "",
                "phone": "",
                "is_valid_email": False,
                "status": "EXTRACTION_FAILED",
                "error": str(e)
            })

    return {
        "message": f"Processed {len(extracted_candidates)} resume files.",
        "candidates": extracted_candidates
    }


@router.post("/admin/dispatch-batch")
def dispatch_batch_assessments(
    payload: DispatchAssessmentPayload,
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Step 3 workflow: Associates candidates with JD, creates batch, generates single-use
    cryptographic tokens, and sends email invitations with safe retry capability.
    """
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Organization context required.")

    if not payload.candidates:
        raise HTTPException(status_code=400, detail="No candidates provided for assessment.")

    # 1. Synthesize / Save Job Description
    target_role = payload.target_role or "Software Engineer"
    target_company = payload.target_company or "ThirdEye Data"

    jd = models.JobDescription(
        title=target_role,
        role=target_role,
        description=payload.job_description,
        organization_id=org_id,
        created_by=current_user.id
    )
    db.add(jd)
    db.flush()

    # 2. Create Recruitment Batch
    batch = roleready_service.create_recruitment_batch(
        db=db,
        org_id=org_id,
        batch_name=payload.batch_name or f"{target_role} Assessment Batch",
        jd_id=jd.id,
        description=f"Assessment batch for {target_role} at {target_company}",
        created_by_user_id=current_user.id
    )

    results = []
    for cand_item in payload.candidates:
        cand_email = cand_item.email.strip().lower()
        if not cand_email or not utils.is_valid_candidate_email(cand_email):
            results.append({
                "name": cand_item.name,
                "email": cand_email,
                "status": "FAILED",
                "error": "Invalid email address."
            })
            continue

        # Look up or create candidate
        cand = db.query(models.Candidate).filter(
            models.Candidate.organization_id == org_id,
            models.Candidate.email == cand_email
        ).first()

        if not cand:
            cand = models.Candidate(
                name=cand_item.name.strip() or "Candidate",
                email=cand_email,
                role=target_role,
                resume_file=cand_item.file_path,
                organization_id=org_id,
                created_by=current_user.id
            )
            db.add(cand)
            db.flush()
        else:
            cand.name = cand_item.name.strip() or cand.name
            cand.role = target_role
            if cand_item.file_path:
                cand.resume_file = cand_item.file_path
            db.flush()

        # Generate single-use secure token
        token = secrets.token_urlsafe(32)
        invitation = models.CandidateInvitation(
            organization_id=org_id,
            job_description_id=jd.id,
            candidate_id=cand.id,
            batch_id=batch.id,
            invitation_token=token,
            status="PENDING",
            expires_at=datetime.utcnow() + timedelta(days=7)
        )
        db.add(invitation)
        db.flush()

        # Send invitation email
        portal_url = f"http://localhost:5173/portal/roleready?token={token}"
        email_subject = f"RoleReady Assessment Invitation: {target_role} at {target_company}"
        email_html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #2e7d32;">RoleReady Assessment Invitation</h2>
            <p>Dear {cand.name},</p>
            <p>You have been invited by <strong>{target_company}</strong> to take an AI-powered job readiness assessment for the <strong>{target_role}</strong> position.</p>
            <p>The assessment consists of three sequential stages:</p>
            <ol>
                <li><strong>Aptitude Assessment</strong> (15 mins)</li>
                <li><strong>Coding Sandbox</strong> (30 mins)</li>
                <li><strong>Technical AI Interview</strong> (15 mins)</li>
            </ol>
            <p style="margin: 30px 0;">
                <a href="{portal_url}" style="background-color: #5d8c2c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                    Start Assessment
                </a>
            </p>
            <p style="font-size: 12px; color: #64748b;">This is a unique single-use link that will expire in 7 days. Do not share this link with anyone else.</p>
        </div>
        """
        email_sent = utils.send_email(cand_email, email_subject, email_html)

        results.append({
            "invitation_id": invitation.id,
            "candidate_id": cand.id,
            "name": cand.name,
            "email": cand.email,
            "token": token,
            "portal_url": portal_url,
            "email_sent": email_sent,
            "status": "SENT" if email_sent else "PENDING"
        })

    batch.total_candidates = len([r for r in results if r.get("status") in ["SENT", "PENDING"]])
    db.commit()

    return {
        "message": f"Successfully created batch and dispatched {len(results)} invitations.",
        "batch_id": batch.id,
        "batch_name": batch.batch_name,
        "total_dispatched": len(results),
        "results": results
    }


@router.post("/admin/invitations/{invitation_id}/retry")
def retry_candidate_invitation_email(
    invitation_id: int,
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Safely retries sending email invitation for an existing candidate without duplicating
    invitation tokens or creating multiple active sessions.
    """
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    invitation = db.query(models.CandidateInvitation).filter(
        models.CandidateInvitation.id == invitation_id,
        models.CandidateInvitation.organization_id == org_id
    ).first()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found.")

    cand = invitation.candidate
    if not cand or not cand.email:
        raise HTTPException(status_code=400, detail="Candidate email is missing.")

    portal_url = f"http://localhost:5173/portal/roleready?token={invitation.invitation_token}"
    role_name = cand.role or "Software Engineer"
    email_subject = f"RoleReady Assessment Invitation: {role_name}"
    email_html = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #2e7d32;">RoleReady Assessment Invitation</h2>
        <p>Dear {cand.name},</p>
        <p>This is a reminder to complete your RoleReady job assessment for the <strong>{role_name}</strong> position.</p>
        <p style="margin: 30px 0;">
            <a href="{portal_url}" style="background-color: #5d8c2c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Start Assessment
            </a>
        </p>
        <p style="font-size: 12px; color: #64748b;">Single-use assessment invitation link.</p>
    </div>
    """
    sent = utils.send_email(cand.email, email_subject, email_html)
    return {
        "message": "Invitation email retry dispatched successfully.",
        "invitation_id": invitation.id,
        "email": cand.email,
        "sent": sent,
        "token": invitation.invitation_token
    }


@router.get("/admin/candidates/{candidate_id}/report")
def get_admin_candidate_report(
    candidate_id: int,
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Returns full individual candidate assessment report dossier.
    Enforces organization tenancy.
    """
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    cand = db.query(models.Candidate).filter(
        models.Candidate.id == candidate_id,
        models.Candidate.organization_id == org_id
    ).first()

    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    session = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.candidate_id == cand.id,
        models.RoleReadySession.organization_id == org_id
    ).order_by(models.RoleReadySession.id.desc()).first()

    final_report = session.final_report_data if session and session.final_report_data else {}

    return {
        "candidate_id": cand.id,
        "name": cand.name,
        "email": cand.email,
        "target_role": session.target_role if session else (cand.role or "Software Engineer"),
        "target_company": session.target_company if session else "RoleReady",
        "jd_title": session.jd_title if session else cand.role,
        "assessment_state": session.current_state if session else "NOT_STARTED",
        "overall_readiness_score": session.overall_readiness_score if session else 0.0,
        "aptitude_score": session.aptitude_score if session else None,
        "coding_score": session.coding_score if session else None,
        "interview_score": session.interview_score if session else None,
        "demonstrated_competencies": final_report.get("demonstrated_competencies", [
            "Technical Problem Solving", "Algorithmic Reasoning", "Professional Communication"
        ]),
        "strengths": final_report.get("strengths", [
            "Clear technical reasoning and structured communication",
            "Proficient in core programming concepts"
        ]),
        "areas_for_improvement": final_report.get("areas_for_improvement", [
            "Practice optimizing algorithmic edge cases",
            "Deepen distributed system architectural patterns"
        ]),
        "final_report": final_report,
        "started_at": session.started_at.isoformat() if session and session.started_at else None,
        "completed_at": session.completed_at.isoformat() if session and session.completed_at else None
    }


@router.get("/admin/batches/{batch_id}/report")
def get_batch_recruitment_report(
    batch_id: int,
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    org_id = current_tenant.id if current_tenant else current_user.organization_id
    return roleready_service.get_admin_batch_report(db, org_id, batch_id)


# ==============================================================================
# CANDIDATE PORTAL INVITATION ENDPOINTS
# ==============================================================================

@router.get("/portal/verify")
def verify_invitation(
    token: str = Query(...),
    db: Session = Depends(database.get_db)
):
    """Validates invitation token and prepares assessment launch."""
    return roleready_service.verify_and_start_invitation(db, token)
