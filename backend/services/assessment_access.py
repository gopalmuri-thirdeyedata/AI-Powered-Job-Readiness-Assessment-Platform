"""
Admin-controlled access to the NORMAL student assessment (the self-assessment workflow: aptitude, coding, AI interview).

The switch lives on the student's profile (`student_profiles.assessment_access_enabled`, default locked) and is changed only by
Admin / Super Admin through User Management. It gates the two ways a student starts a new attempt:

  * creating a session            POST /api/roleready/student/initialize
  * the first start of a session  POST /api/roleready/session/{uuid}/start-aptitude   (NOT_STARTED -> APTITUDE_IN_PROGRESS)

An attempt that is already in progress is never touched: revoking access does not end it, and its later rounds, drafts,
submissions, report and the student's history stay reachable. Recruitment (shared-link) sessions, recruiter invitation sessions
and every other student feature do not call this module.
"""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import models

LOCKED_CODE = "ASSESSMENT_ACCESS_LOCKED"
LOCKED_MESSAGE = "Your assessment access is locked. Please contact your admin to unlock it."


def is_granted(profile: Optional[models.StudentProfile]) -> bool:
    return bool(profile is not None and getattr(profile, "assessment_access_enabled", False))


def require_access(profile: Optional[models.StudentProfile]) -> None:
    """Raises 403 ASSESSMENT_ACCESS_LOCKED unless an administrator has granted this student access."""
    if not is_granted(profile):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": LOCKED_CODE, "message": LOCKED_MESSAGE},
        )


def require_access_to_start(db: Session, session: models.RoleReadySession) -> None:
    """
    Guard for the first start of a student self-assessment session. Only a NOT_STARTED self-assessment is gated; a session that is
    already running (or finished) passes untouched, as does every other workflow type.
    """
    if session.workflow_type != "SELF_ASSESSMENT" or session.current_state != models.RoleReadySessionState.NOT_STARTED:
        return
    profile = db.query(models.StudentProfile).filter(models.StudentProfile.id == session.student_profile_id).first()
    require_access(profile)


def set_access(profile: models.StudentProfile, granted: bool, admin_user_id: Optional[int]) -> bool:
    """Updates the switch (the caller commits). Returns True when the value actually changed."""
    changed = bool(profile.assessment_access_enabled) != bool(granted)
    profile.assessment_access_enabled = bool(granted)
    profile.assessment_access_updated_at = datetime.utcnow()
    profile.assessment_access_updated_by = admin_user_id
    return changed
