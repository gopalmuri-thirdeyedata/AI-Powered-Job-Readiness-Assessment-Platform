"""
Public (unauthenticated) candidate endpoints for the shared-link assessment workflow (plan Tasks 5-7).

Access is capability based: share_token (link), registration token (start), session token + volatile lease (sitting).
No endpoint ever returns internal integer ids, answer keys, hidden tests, interview rubrics or other candidates' data.
The sections are delivered, executed and scored by the shared assessment engine (services.assessment_engine); only the
authentication and attempt management here differ from the Student Platform.
"""
import json
import secrets
from typing import Any, Dict, List, Optional

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import database
import models
import utils
from services import assessment_flow_service as flow
from services import assessment_policy as policy
from services import assessment_rules
from services import elevenlabs_service
from services.rate_limiter import SlidingWindowLimiter, client_ip

SECTIONS = [
    {"key": "aptitude", "label": "Aptitude", "minutes": policy.SECTION_MINUTES},
    {"key": "coding", "label": "Coding", "minutes": policy.SECTION_MINUTES},
    {"key": "interview", "label": "AI Technical Interview", "minutes": policy.SECTION_MINUTES},
]
# Candidate-facing Rules of Assessment: grouped, generated from the enforcing modules' constants (services/assessment_rules.py).
RULES = assessment_rules.candidate_rules()

register_limiter = SlidingWindowLimiter(limit=5, window_seconds=60)
start_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)
meta_limiter = SlidingWindowLimiter(limit=60, window_seconds=60)


def _no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


router = APIRouter(prefix="/api/public/assessment", tags=["public-assessment"], dependencies=[Depends(_no_store)])


def _rate_limit(limiter: SlidingWindowLimiter, request: Request):
    if not limiter.allow(client_ip(request)):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests. Please wait a minute and try again.",
                            headers={"Retry-After": "60"})


class RegisterRequest(BaseModel):
    name: str = ""
    phone: str = ""
    email: str = ""


class DraftRequest(BaseModel):
    section: str
    payload: Dict[str, Any] = {}
    violations: Optional[List[Dict[str, Any]]] = None


class StartRequest(BaseModel):
    acknowledged: bool = False


class SubmitRequest(BaseModel):
    # aptitude: {qid: "A".."D"}; coding: solutions {pid: {code, language}}; interview: answers [{question_id, response, follow_ups}]
    answers: Optional[Any] = None
    solutions: Optional[Dict[str, Any]] = None
    transcript: Optional[List[Dict[str, Any]]] = None
    violations: Optional[List[Dict[str, Any]]] = None


class RunCodeRequest(BaseModel):
    problem_id: str
    language: Optional[str] = "python"
    code: str = ""


def _meta(job: models.JobDescription, org_name: Optional[str]) -> Dict[str, Any]:
    snippet = " ".join((job.description or "").split())[:280]
    return {
        "title": job.title,
        "role": job.role,
        "organization_name": org_name,
        "description_snippet": snippet,
        "sections": SECTIONS,
        "total_duration_minutes": policy.OVERALL_MINUTES,
        "rules": RULES,
    }


@router.get("/{share_token}")
def get_assessment_metadata(share_token: str, request: Request, db: Session = Depends(database.get_db)):
    _rate_limit(meta_limiter, request)
    job = flow.get_open_job_by_token(db, share_token)
    org = db.query(models.Organization).filter(models.Organization.id == job.organization_id).first()
    return _meta(job, org.name if org else None)


@router.post("/{share_token}/register")
def register_candidate(share_token: str, payload: RegisterRequest, request: Request, db: Session = Depends(database.get_db)):
    _rate_limit(register_limiter, request)
    job = flow.get_open_job_by_token(db, share_token)

    name = " ".join((payload.name or "").split())
    if len(name) < 2 or len(name) > 150:
        raise HTTPException(status_code=422, detail="Full name must be between 2 and 150 characters.")
    phone = utils.normalize_phone_e164(payload.phone)
    if not phone:
        raise HTTPException(status_code=422, detail="Enter a valid phone number including the country code (for example +14155550123).")
    try:
        validate_email((payload.email or "").strip(), check_deliverability=False)
    except EmailNotValidError:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    normalized_email = utils.normalize_email(payload.email)
    if len(normalized_email) > 150:
        raise HTTPException(status_code=422, detail="Email address is too long.")

    existing = db.query(models.CandidateRegistration).filter(
        models.CandidateRegistration.job_description_id == job.id,
        func.lower(func.trim(models.CandidateRegistration.email)) == normalized_email,
    ).first()
    if existing is not None:
        # Never reveal or re-issue the capability token, and never reveal who registered.
        if existing.attempt_session_uuid:
            raise HTTPException(status_code=409, detail="An assessment attempt has already been initiated for this email.")
        raise HTTPException(status_code=409, detail="This email is already registered for this assessment. If you closed your window, please use your original session or contact the hiring team.")

    token = secrets.token_urlsafe(32)
    reg = models.CandidateRegistration(
        registration_token_hash=flow.sha256_hex(token),
        job_description_id=job.id,
        organization_id=job.organization_id,
        name=name,
        phone=phone,
        email=normalized_email,
        blueprint_version=job.blueprint_version or None,
        status="REGISTERED",
    )
    try:
        db.add(reg)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This email is already registered for this assessment. If you closed your window, please use your original session or contact the hiring team.")
    org = db.query(models.Organization).filter(models.Organization.id == job.organization_id).first()
    return {"registration_token": token, "message": "Registration successful", "assessment": _meta(job, org.name if org else None)}


@router.post("/{share_token}/start")
def start_assessment(share_token: str, request: Request, body: Optional[StartRequest] = None,
                     x_registration_token: Optional[str] = Header(None, alias="X-Registration-Token"),
                     db: Session = Depends(database.get_db)):
    _rate_limit(start_limiter, request)
    return flow.start_assessment(db, share_token, x_registration_token, acknowledged=bool(body and body.acknowledged))


# ------------------------------------------------------------------------------
# Session endpoints: X-Session-Token (capability) + X-Session-Lease (volatile, in-memory on the client)
# ------------------------------------------------------------------------------
def _session_headers(x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
                     x_session_lease: Optional[str] = Header(None, alias="X-Session-Lease")):
    return x_session_token, x_session_lease


@router.get("/session/{session_uuid}/state")
def get_session_state(session_uuid: str, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease, allow_terminal=True)
    return flow.get_state(db, session)


@router.post("/session/{session_uuid}/heartbeat")
def heartbeat(session_uuid: str, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.record_heartbeat(db, session)


@router.put("/session/{session_uuid}/draft")
def save_draft(session_uuid: str, body: DraftRequest, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.save_draft(db, session, body.section, body.payload, violations=body.violations)


@router.post("/session/{session_uuid}/submit-aptitude")
def submit_aptitude(session_uuid: str, body: SubmitRequest, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.submit_section(db, session, "APTITUDE", {"answers": body.answers if isinstance(body.answers, dict) else {}}
                               if body.answers is not None else None, violations=body.violations)


@router.post("/session/{session_uuid}/start-coding")
def start_coding(session_uuid: str, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.start_section(db, session, "CODING")


@router.post("/session/{session_uuid}/run-code")
def run_code(session_uuid: str, body: RunCodeRequest, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.run_code(db, session, body.problem_id, body.language, body.code)


@router.post("/session/{session_uuid}/submit-coding")
def submit_coding(session_uuid: str, body: SubmitRequest, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.submit_section(db, session, "CODING", {"solutions": body.solutions or {}} if body.solutions is not None else None,
                               violations=body.violations)


@router.post("/session/{session_uuid}/start-interview")
def start_interview(session_uuid: str, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.start_section(db, session, "INTERVIEW")


@router.post("/session/{session_uuid}/voice-init")
def voice_init(session_uuid: str, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    """Defines the voice interview (same builder as the Student Platform). Needs the capability + lease and an active interview."""
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    return flow.voice_init(db, session)


@router.post("/session/{session_uuid}/voice-turn")
def voice_turn(session_uuid: str, audio: Optional[UploadFile] = File(None), history: str = Form("[]"), opening: bool = Form(False),
               headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    """One spoken exchange: the candidate's recording in, the interviewer's text and speech out."""
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    audio_bytes = audio.file.read(elevenlabs_service.MAX_AUDIO_BYTES + 1) if audio is not None else None
    try:
        parsed_history = json.loads(history or "[]")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation history.")
    return flow.voice_turn(db, session, audio_bytes, (audio.content_type if audio is not None else None) or elevenlabs_service.AUDIO_WEBM,
                           parsed_history, opening)


@router.post("/session/{session_uuid}/submit-interview")
def submit_interview(session_uuid: str, body: SubmitRequest, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease)
    payload = None
    if body.answers is not None or body.transcript is not None:
        payload = {"answers": body.answers if body.answers is not None else [], "transcript": body.transcript or []}
    return flow.submit_section(db, session, "INTERVIEW", payload, violations=body.violations)


@router.post("/session/{session_uuid}/finalize")
def finalize(session_uuid: str, headers=Depends(_session_headers), db: Session = Depends(database.get_db)):
    token, lease = headers
    session = flow.load_session(db, session_uuid, token, lease, require_lease=False, allow_terminal=True)
    return flow.finalize(db, session)


@router.post("/session/{session_uuid}/abandon")
async def abandon(session_uuid: str, request: Request, x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
                  db: Session = Depends(database.get_db)):
    """
    Accepts the capability from the header or, for navigator.sendBeacon (which cannot set headers), from a small
    JSON/text body: {"session_token": "..."}. Only the tab that holds the in-memory lease registers the beacon.
    """
    token = x_session_token
    if not token:
        try:
            raw = await request.body()
            if raw and len(raw) < 4096:
                token = (json.loads(raw.decode("utf-8")) or {}).get("session_token")
        except (ValueError, UnicodeDecodeError, AttributeError):
            token = None
    return await run_in_threadpool(flow.abandon_by_token, db, session_uuid, token)
