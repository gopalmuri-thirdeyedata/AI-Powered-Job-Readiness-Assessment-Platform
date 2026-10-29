"""
Authenticated endpoints of the invited-student assessment workflow (the student signs in with the account an administrator created):

    POST /api/student-assessment/{share_token}/access          registration from the account (no attempt, no timer)
    GET  /api/student-assessment/{share_token}/result          where the student's attempt stands (survives link expiry)
    POST /api/student-assessment/attempts/{session_uuid}/review   the mandatory review (>= 30 words), once
    GET  /api/student-assessment/attempts/{session_uuid}/report   the student's own report, only after the review is saved

Authentication is the normal PrepWin session (HttpOnly cookie + CSRF, or Bearer); the student's identity and role are always the
stored account's. The assessment itself still runs on /api/public/assessment/*.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import database
import models
from routers.auth import get_current_user
from services import retest_service
from services import student_assessment_service as service
from services.rate_limiter import SlidingWindowLimiter, client_ip


def _no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


router = APIRouter(prefix="/api/student-assessment", tags=["student-assessment"], dependencies=[Depends(_no_store)])

access_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)


class ReviewRequest(BaseModel):
    # hard cap well above the 5000-character policy limit, so an oversized body is refused before it is even read into the policy check
    review: str = Field("", max_length=20000)


class AccessRequest(BaseModel):
    # the single-use token of an administrator-authorised retake link (optional; validated and bound to the account on the server)
    retake_token: Optional[str] = Field(None, max_length=200)


@router.post("/{share_token}/access")
def student_access(share_token: str, request: Request, body: Optional[AccessRequest] = None,
                   user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if not access_limiter.allow(f"{user.id}:{client_ip(request)}"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests. Please wait a minute and try again.",
                            headers={"Retry-After": "60"})
    return service.access(db, user, share_token, retake_token=body.retake_token if body else None)


@router.get("/retests")
def student_retests(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """The signed-in student's own open section retests (assigned by an administrator); nothing of anyone else's."""
    service.require_student(user)
    return {"retests": retest_service.list_for_student(db, user)}


@router.get("/{share_token}/result")
def student_result(share_token: str, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    return service.result_for_link(db, user, share_token)


@router.post("/attempts/{session_uuid}/review")
def submit_review(session_uuid: str, body: ReviewRequest, user: models.User = Depends(get_current_user),
                  db: Session = Depends(database.get_db)):
    return service.submit_review(db, user, session_uuid, body.review)


@router.get("/attempts/{session_uuid}/report")
def download_report(session_uuid: str, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    return service.release_report(db, user, session_uuid)
