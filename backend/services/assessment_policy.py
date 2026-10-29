"""
Canonical timing and scoring policy shared by the Student Platform (RoleReady self-assessment / invitations) and the
Admin Recruitment shared-link assessment.

Single source of truth for:
  * section limits (Aptitude 20, Coding 20, Interview 10 minutes) and the 60-minute overall deadline,
  * the submission arrival window,
  * the equal-weight overall score  (Aptitude % + Coding % + Interview %) / 3,
  * the incomplete-attempt rule (any missing section -> overall is None, never a fabricated zero).

Nothing in here touches the database or the HTTP layer. Both lifecycles (services.roleready_service and
services.assessment_flow_service) import these constants so the two workflows cannot drift apart again.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

SECTION_ORDER = ("APTITUDE", "CODING", "INTERVIEW")

SECTION_MINUTES = 20                       # the default (Aptitude and Coding)
SECTION_MINUTES_BY_SECTION = {"APTITUDE": 20, "CODING": 20, "INTERVIEW": 10}
OVERALL_MINUTES = 60


def section_minutes(section: Optional[str]) -> int:
    """The time limit of one section: the interview is a 10-minute conversation, the other two sections have 20 minutes."""
    return SECTION_MINUTES_BY_SECTION.get(str(section or "").upper(), SECTION_MINUTES)

# A final submission dispatched before a deadline may still arrive up to this many seconds later.
TRANSIT_WINDOW_SECONDS = 10

SCORING_MODEL = "equal_v1"                         # (A + C + I) / 3, stamped on every new result
LEGACY_SCORING_MODEL = "legacy_weighted_25_40_35"  # student results persisted before the standardization


def normalize_pct(value: Any) -> Optional[float]:
    """A section score as a percentage in [0, 100]; None stays None (an unattempted section is not a zero)."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(100.0, number))


def display_pct(value: Any) -> Optional[float]:
    """
    A section percentage as shown in APIs and reports: two decimals. Presentation only: calculation (including the overall
    score) always uses the full-precision value, so rounding a section for display never changes the overall.
    """
    number = normalize_pct(value)
    return None if number is None else round(number, 2)


def overall_score(aptitude: Any, coding: Any, interview: Any) -> Optional[float]:
    """
    Equal-weight overall percentage of the FULL-PRECISION section percentages, rounded once, to two decimals
    (80, 60, 90 -> 76.67; 13.3333, 100, 0 -> 37.78). Returns None unless all three section percentages are present.
    """
    parts = [normalize_pct(aptitude), normalize_pct(coding), normalize_pct(interview)]
    if any(p is None for p in parts):
        return None
    return round(sum(parts) / 3.0, 2)


def overall_deadline(started_at: datetime) -> datetime:
    return started_at + timedelta(minutes=OVERALL_MINUTES)


def section_deadline(section_started_at: datetime, overall_deadline_at: Optional[datetime], section: Optional[str] = None) -> datetime:
    """A section never outlives the overall deadline, and the overall deadline never moves."""
    deadline = section_started_at + timedelta(minutes=section_minutes(section))
    return min(deadline, overall_deadline_at) if overall_deadline_at is not None else deadline


def scoring_model_of(final_report_data: Optional[Dict[str, Any]]) -> str:
    """Which formula produced a persisted result. Rows written before this module existed carry no stamp."""
    stamp = (final_report_data or {}).get("scoring_model") if isinstance(final_report_data, dict) else None
    return stamp or LEGACY_SCORING_MODEL
