"""
Expiry policy of the Admin Recruitment shared link (NOT the RoleReady invitation system, which has its own policy).

  * A link lives for exactly 24 hours from the moment it is issued: expires_at = issued_at + 24 h, stamped on the server clock.
  * A link is expired when server_now >= expires_at. Nothing here ever extends an expiry; a new window needs a NEW link.
  * NULL expires_at marks a legacy link issued before expiry existed: it keeps working until an admin closes it (reopening it
    stamps a 24 h window). Existing links are never expired by a migration.
All "now" values come from services.assessment_clock so tests can move the server clock; the browser clock is never consulted.
"""
from datetime import datetime, timedelta
from typing import Optional

from services import assessment_clock as clock

SHARE_LINK_TTL = timedelta(hours=24)

ACTIVE = "ACTIVE"
EXPIRED = "EXPIRED"
CLOSED = "CLOSED"

EXPIRED_MESSAGE = "This assessment link has expired and no longer accepts candidates. Please contact the hiring team for a new link."
CLOSED_MESSAGE = "This assessment is closed and no longer accepts candidates."


def new_expiry(now: Optional[datetime] = None) -> datetime:
    """Aware UTC expiry for a link issued at `now` (default: the server clock)."""
    return (now or clock.now()) + SHARE_LINK_TTL


def expires_at(job) -> Optional[datetime]:
    return clock.aware(job.share_link_expires_at)


def is_expired(job, now: Optional[datetime] = None) -> bool:
    exp = expires_at(job)
    return exp is not None and (now or clock.now()) >= exp


def link_state(job, now: Optional[datetime] = None) -> Optional[str]:
    """ACTIVE / EXPIRED / CLOSED for a job that has a link, None for a job that never had one (DRAFT)."""
    if not job.share_token:
        return None
    if is_expired(job, now):
        return EXPIRED
    if job.is_published and job.status == "PUBLISHED":
        return ACTIVE
    return CLOSED
