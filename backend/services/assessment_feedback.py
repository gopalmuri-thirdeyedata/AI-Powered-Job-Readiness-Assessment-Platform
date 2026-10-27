"""The feedback a student must write (at least 20 words) before downloading their report or opening the dashboard."""
import re
from typing import Any, Dict

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models

MIN_WORDS = 20
MAX_CHARS = 3000


def count_words(text: str) -> int:
    """A word is a space-separated piece that holds a letter or a digit, so "-- -- --" does not count (same rule as the browser)."""
    return sum(1 for piece in re.split(r"\s+", text or "") if any(ch.isalnum() for ch in piece))


def get_status(db: Session, session: models.RoleReadySession) -> Dict[str, Any]:
    row = db.query(models.AssessmentFeedback).filter(models.AssessmentFeedback.session_id == session.id).first()
    return {"submitted": row is not None, "min_words": MIN_WORDS}


def save_feedback(db: Session, session: models.RoleReadySession, profile_id: int, text: str) -> Dict[str, Any]:
    """Stores the feedback once per attempt. A second submission keeps the first (the gate is already open)."""
    cleaned = (text or "").strip()
    if len(cleaned) > MAX_CHARS:
        raise HTTPException(status_code=422, detail=f"Feedback must be at most {MAX_CHARS} characters.")
    words = count_words(cleaned)
    if words < MIN_WORDS:
        raise HTTPException(status_code=422, detail=f"Please write at least {MIN_WORDS} words ({words} so far).")
    existing = db.query(models.AssessmentFeedback).filter(models.AssessmentFeedback.session_id == session.id).first()
    if existing is None:
        db.add(models.AssessmentFeedback(session_id=session.id, student_profile_id=profile_id, feedback_text=cleaned, word_count=words))
        db.commit()
    return {"submitted": True, "min_words": MIN_WORDS}
