"""
Shows a student the assessment they wrote through the admin's shared link.

A shared-link attempt belongs to a candidate registration (name + e-mail typed on the link page), not to a student account, so the
student's dashboard, history and skill gap never saw it. When a student loads their pages, their FINISHED link attempts are matched
to their account by e-mail and attached to their profile; every existing student page then reads them like any other assessment.

Safety: only attempts that have scores (COMPLETED / TIMED_OUT), only the same organization (or an attempt with none), only attempts
nobody owns yet. In-progress attempts are never attached, and nothing is created, re-scored or deleted.
"""
import time
from threading import Lock
from typing import Dict

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
from services import readiness_service

FINISHED_STATES = ("COMPLETED", "TIMED_OUT")
LINK_WORKFLOW = "RECRUITMENT_ASSESSMENT"
CHECK_INTERVAL_SECONDS = 20          # a profile is re-checked at most this often: the match is one cheap query, not one per request

_last_checked: Dict[int, float] = {}
_lock = Lock()


def _due(profile_id: int) -> bool:
    now = time.monotonic()
    with _lock:
        if now - _last_checked.get(profile_id, 0.0) < CHECK_INTERVAL_SECONDS:
            return False
        _last_checked[profile_id] = now
        return True


def reset_throttle() -> None:
    with _lock:
        _last_checked.clear()


def attach_finished_link_assessments(db: Session, profile: models.StudentProfile, email: str, *, force: bool = False) -> int:
    """Attach this student's finished link attempts to their profile. Returns how many were attached. Never raises."""
    email = (email or "").strip().lower()
    if not email or profile is None or (not force and not _due(profile.id)):
        return 0
    try:
        rows = db.query(models.RoleReadySession).join(
            models.CandidateRegistration, models.CandidateRegistration.id == models.RoleReadySession.registration_id
        ).filter(
            models.RoleReadySession.workflow_type == LINK_WORKFLOW,
            models.RoleReadySession.student_profile_id.is_(None),
            models.RoleReadySession.current_state.in_(FINISHED_STATES),
            func.lower(func.trim(models.CandidateRegistration.email)) == email,
            or_(models.RoleReadySession.organization_id.is_(None), models.RoleReadySession.organization_id == profile.organization_id),
        ).all()
        if not rows:
            return 0
        for session in rows:
            session.student_profile_id = profile.id
        db.commit()
        readiness_service.refresh_profile_readiness(db, profile)
        return len(rows)
    except Exception as exc:  # the student's pages must load even if the match fails
        db.rollback()
        print(f"[student_link_results] match skipped: {type(exc).__name__}")
        return 0
