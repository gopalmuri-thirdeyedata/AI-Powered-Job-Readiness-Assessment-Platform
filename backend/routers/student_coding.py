"""
Student LeetCode-style coding platform API (Python, Java, C++ and C: the Assessment's languages).
Problem list, problem detail, Run (examples + custom input), Submit (all tests) and submission history.
Hidden test inputs and every expected output stay on the server; only the first failing case of a submission is echoed back.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import database, models
from routers.student import get_current_student_profile
from services import coding_platform_service as platform
from services.rate_limiter import SlidingWindowLimiter
from services.readiness_service import refresh_profile_readiness

router = APIRouter(prefix="/api/student/coding", tags=["student-coding"])

run_limiter = SlidingWindowLimiter(limit=20, window_seconds=60)
submit_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)


class RunRequest(BaseModel):
    code: str = Field(..., max_length=platform.MAX_CODE_CHARS + 1000)
    custom_input: Optional[str] = Field(None, max_length=platform.MAX_CUSTOM_INPUT_CHARS + 1000)
    language: str = Field("python", max_length=20)           # python | java | cpp | c: the Assessment's languages


class SubmitRequest(BaseModel):
    code: str = Field(..., max_length=platform.MAX_CODE_CHARS + 1000)
    language: str = Field("python", max_length=20)


def _fail(exc: platform.CodingPlatformError):
    headers = {"Retry-After": "3"} if exc.status_code == 429 else None
    raise HTTPException(status_code=exc.status_code, detail=exc.message, headers=headers)


@router.get("/problems")
def list_problems(difficulty: Optional[str] = None, tag: Optional[str] = None, status: Optional[str] = None,
                  q: Optional[str] = None, bookmarked: bool = False, profile: models.StudentProfile = Depends(get_current_student_profile),
                  db: Session = Depends(database.get_db)):
    return platform.list_problems(db, profile, difficulty=difficulty, tag=tag, status=status, query=q, bookmarked=bookmarked)


@router.get("/stats")
def stats(profile: models.StudentProfile = Depends(get_current_student_profile), db: Session = Depends(database.get_db)):
    platform.ensure_seeded(db)
    return platform.get_stats(db, profile)


@router.get("/problems/{slug}")
def problem_detail(slug: str, profile: models.StudentProfile = Depends(get_current_student_profile),
                   db: Session = Depends(database.get_db)):
    try:
        return platform.problem_detail(db, profile, slug)
    except platform.CodingPlatformError as exc:
        _fail(exc)


@router.post("/problems/{slug}/bookmark")
def bookmark(slug: str, profile: models.StudentProfile = Depends(get_current_student_profile), db: Session = Depends(database.get_db)):
    try:
        return platform.toggle_bookmark(db, profile, slug)
    except platform.CodingPlatformError as exc:
        _fail(exc)


@router.post("/problems/{slug}/run")
def run(slug: str, payload: RunRequest, profile: models.StudentProfile = Depends(get_current_student_profile),
        db: Session = Depends(database.get_db)):
    if not run_limiter.allow(profile.id):
        raise HTTPException(status_code=429, detail="Too many runs. Please wait a moment.", headers={"Retry-After": "5"})
    try:
        problem = platform.snapshot_for_execution(db, slug)
        return platform.run_code(db, problem, payload.code, payload.custom_input, payload.language)
    except platform.CodingPlatformError as exc:
        _fail(exc)


@router.post("/problems/{slug}/submit")
def submit(slug: str, payload: SubmitRequest, profile: models.StudentProfile = Depends(get_current_student_profile),
           db: Session = Depends(database.get_db)):
    if not submit_limiter.allow(profile.id):
        raise HTTPException(status_code=429, detail="Too many submissions. Please wait a moment.", headers={"Retry-After": "10"})
    try:
        problem = platform.snapshot_for_execution(db, slug)
        result = platform.submit_code(db, profile, problem, payload.code, payload.language)
    except platform.CodingPlatformError as exc:
        _fail(exc)
    if result["verdict"] == platform.ACCEPTED:
        try:
            refresh_profile_readiness(db, profile)       # solved problems feed the practice part of the readiness score
        except Exception as exc:  # noqa: BLE001 - the verdict is already stored; never fail a submission over the score refresh
            db.rollback()
            print(f"[coding] readiness refresh skipped: {type(exc).__name__}")
    return result


@router.get("/problems/{slug}/submissions")
def submissions(slug: str, profile: models.StudentProfile = Depends(get_current_student_profile),
                db: Session = Depends(database.get_db)):
    try:
        return platform.list_submissions(db, profile, slug)
    except platform.CodingPlatformError as exc:
        _fail(exc)


@router.get("/submissions/{submission_id}")
def submission(submission_id: int, profile: models.StudentProfile = Depends(get_current_student_profile),
               db: Session = Depends(database.get_db)):
    try:
        return platform.get_submission(db, profile, submission_id)
    except platform.CodingPlatformError as exc:
        _fail(exc)
