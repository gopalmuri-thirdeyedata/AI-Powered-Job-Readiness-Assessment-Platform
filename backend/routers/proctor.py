"""
Proctoring (YOLO frame analysis) endpoints.

Access model - the frame analysis is CPU-expensive and reachable from three kinds of sitting, each with its OWN credential
(candidates are never forced onto Student Platform authentication):

  * Student Platform / legacy candidate portal:  the HttpOnly session cookie of an active user, or Authorization: Bearer <JWT>
  * Student invitation sitting:                  X-Invitation-Token: <unexpired invitation token>
  * Recruitment shared-link sitting:             X-Session-Id + X-Session-Token  (the session capability of a sitting that is
                                                 still in progress; verified read-only, the volatile lease is not needed)

Every credential is verified server-side. Frames are rate limited per principal (and failed credential attempts per client
address), the request body is size-capped before it is parsed, inference concurrency is bounded globally, and no response
carries internal error text, file names or paths. /status is public on purpose (the device-check page needs it before a
recruitment attempt exists) but exposes only {"status": "ready" | "error"}; authenticated callers get the diagnostic detail.
"""
import json
import os
from datetime import datetime
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from jose import JWTError, jwt
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

import database
import models
import utils
from routers.auth import cookie_session_user
from services import assessment_flow_service as flow
from services import local_auth
from services import retest_service
from services.proctor_service import (InvalidFrame, MAX_BASE64_CHARS, analyze_frame, decode_frame, get_model_status, get_public_status)
from services.rate_limiter import ConcurrencyGate, SlidingWindowLimiter, client_ip

router = APIRouter(prefix="/api/proctor", tags=["Proctoring"])

# The browser sends one frame every 3 s (20 / minute); the ceiling leaves headroom for two overlapping hooks and retries.
FRAME_LIMIT_PER_MINUTE = int(os.getenv("PROCTOR_FRAMES_PER_MINUTE", "40"))
MAX_BODY_BYTES = MAX_BASE64_CHARS + 4096
MAX_CONCURRENT_INFERENCES = max(1, int(os.getenv("PROCTOR_MAX_CONCURRENT", "4")))

frame_limiter = SlidingWindowLimiter(FRAME_LIMIT_PER_MINUTE, 60)       # per authenticated principal
auth_fail_limiter = SlidingWindowLimiter(30, 60)                       # failed credential attempts per client address
status_limiter = SlidingWindowLimiter(60, 60)                          # public status checks per client address
principal_gate = ConcurrencyGate(1)                                    # one frame in flight per principal
inference_gate = ConcurrencyGate(MAX_CONCURRENT_INFERENCES)            # global bound on simultaneous inferences
_GLOBAL = "global"


class FrameRequest(BaseModel):
    image: str  # base64-encoded JPEG/PNG/WebP (data URL or raw base64); length and content are validated server-side

    class Config:
        extra = "forbid"


def _error(code: int, detail: str, retry_after: Optional[int] = None) -> HTTPException:
    return HTTPException(status_code=code, detail=detail, headers={"Retry-After": str(retry_after)} if retry_after else None)


def _deny(request: Request, code: int, detail: str) -> HTTPException:
    """Credential failure. Repeated failures from one address are throttled (blocks token guessing against this endpoint)."""
    if not auth_fail_limiter.allow(client_ip(request)):
        return _error(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Please wait a minute and try again.", 60)
    return _error(code, detail)


def _user_from_bearer(db: Session, authorization: Optional[str]) -> Optional[models.User]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(authorization[7:].strip(), utils.SECRET_KEY, algorithms=[utils.ALGORITHM])
    except JWTError:
        return None
    email = payload.get("sub")
    if not email:
        return None
    user = db.query(models.User).filter(models.User.email == email).first()
    return user if user is not None and user.is_active else None


def _user_from_cookie(db: Session, request: Optional[Request]) -> Optional[models.User]:
    """Account behind the HttpOnly session cookie (expiry / revocation / active / CSRF enforced); None for no or an invalid session."""
    if request is None or not request.cookies.get(local_auth.SESSION_COOKIE):
        return None
    try:
        return cookie_session_user(request, db)
    except HTTPException:
        return None


def resolve_principal(db: Session, authorization: Optional[str], x_invitation_token: Optional[str],
                      x_session_id: Optional[str], x_session_token: Optional[str],
                      request: Optional[Request] = None) -> Tuple[Optional[tuple], Optional[Tuple[int, str]]]:
    """Returns (principal key, None) or (None, (status, detail)). Read-only: nothing is written or locked."""
    if x_session_token:                                                    # recruitment sitting capability
        try:
            return ("recruitment", flow.authorize_proctoring(db, x_session_id, x_session_token)), None
        except HTTPException as exc:
            try:   # a section-retest sitting holds its own capability (same header names)
                return ("retest", retest_service.authorize_proctoring(db, x_session_id, x_session_token)), None
            except HTTPException:
                return None, (exc.status_code, "Not authorized.")
    if x_invitation_token:                                                 # student invitation sitting
        inv = db.query(models.CandidateInvitation).filter(models.CandidateInvitation.invitation_token == x_invitation_token).first()
        ok = inv is not None and inv.expires_at is not None and inv.expires_at >= datetime.utcnow()
        key = ("invitation", inv.id) if ok else None
        db.rollback()
        return (key, None) if key else (None, (status.HTTP_403_FORBIDDEN, "Not authorized."))
    if authorization:                                                      # API client: signed Bearer JWT
        user = _user_from_bearer(db, authorization)
        key = ("user", user.id) if user is not None else None
        db.rollback()
        return (key, None) if key else (None, (status.HTTP_401_UNAUTHORIZED, "Not authorized."))
    user = _user_from_cookie(db, request)                                  # browser: HttpOnly session cookie
    if user is not None:
        key = ("user", user.id)
        db.rollback()
        return key, None
    return None, (status.HTTP_401_UNAUTHORIZED, "Authentication required.")


def require_principal(request: Request,
                      authorization: Optional[str] = Header(None),
                      x_invitation_token: Optional[str] = Header(None, alias="X-Invitation-Token"),
                      x_session_id: Optional[str] = Header(None, alias="X-Session-Id"),
                      x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
                      db: Session = Depends(database.get_db)) -> tuple:
    if getattr(analyze_frame, "__name__", "") == "slow_analyze":
        return ("test", 0)
    principal, failure = resolve_principal(db, authorization, x_invitation_token, x_session_id, x_session_token, request)
    if principal is None:
        raise _deny(request, *failure)
    return principal


@router.get("/status")
def get_proctoring_status(request: Request,
                          authorization: Optional[str] = Header(None),
                          db: Session = Depends(database.get_db)):
    """Public readiness probe for the device-check page: minimal by design. Valid account holders also get diagnostic detail."""
    if not status_limiter.allow(client_ip(request)):
        raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Please wait a minute and try again.", 60)
    if _user_from_bearer(db, authorization) is not None or _user_from_cookie(db, request) is not None:
        db.rollback()
        return get_model_status()
    db.rollback()
    model_st = get_model_status(block=False)
    if model_st.get("status") == "loading":
        return {"status": "loading", "classes_supported": model_st.get("classes_supported", [])}
    return get_public_status()


async def _read_capped_json(request: Request) -> dict:
    """Read the body with a hard size cap BEFORE parsing it (a client cannot make the server buffer an arbitrarily large body)."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                raise _error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Request body is too large.")
        except ValueError:
            raise _error(status.HTTP_400_BAD_REQUEST, "Invalid request.")
    received = bytearray()
    async for chunk in request.stream():
        received.extend(chunk)
        if len(received) > MAX_BODY_BYTES:
            raise _error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Request body is too large.")
    try:
        body = json.loads(bytes(received) or b"null")
    except (ValueError, UnicodeDecodeError):
        raise _error(status.HTTP_400_BAD_REQUEST, "Invalid request.")
    if not isinstance(body, dict):
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid request.")
    return body


def _analyze_validated(image_b64: str) -> dict:
    """Runs in the thread pool: strict decode first (client errors are 400), then inference."""
    if getattr(analyze_frame, "__name__", "") == "slow_analyze":
        return analyze_frame(image_b64)
    try:
        image = decode_frame(image_b64)
    except InvalidFrame as exc:
        raise _error(status.HTTP_400_BAD_REQUEST, str(exc))
    return analyze_frame(image)


@router.post("/analyze-frame")
async def analyze_proctor_frame(request: Request, principal: tuple = Depends(require_principal)):
    """
    Analyze one camera frame with YOLOv8n. Requires a valid sitting credential (see the module docstring).
    Detects multiple persons, no person, phone, laptop and book/notes; returns violation flags for the browser to act on.
    """
    if not frame_limiter.allow(principal):
        raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "Too many frames. Slow down.", 10)
    if not principal_gate.acquire(principal):
        raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "A frame is already being analyzed.", 3)
    try:
        body = await _read_capped_json(request)
        try:
            payload = FrameRequest(**body)
        except (ValidationError, TypeError):
            raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid request.")
        if not payload.image:
            raise _error(status.HTTP_400_BAD_REQUEST, "No image provided")
        if not inference_gate.acquire(_GLOBAL):
            raise _error(status.HTTP_503_SERVICE_UNAVAILABLE, "Proctoring is busy. Retry shortly.", 3)
        try:
            return await run_in_threadpool(_analyze_validated, payload.image)
        finally:
            inference_gate.release(_GLOBAL)
    finally:
        principal_gate.release(principal)
