"""
Single injectable UTC clock for the recruitment assessment engine.

Every deadline decision calls `now()` through this module so tests can freeze/advance time deterministically
(`monkeypatch.setattr(assessment_clock, "now", lambda: fake)`). Production always uses the server clock.
"""
from datetime import datetime, timezone


def now() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt):
    """Treat naive datetimes read back from SQLite/MySQL as UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def naive_utc(dt):
    """UTC wall-clock value without tzinfo, matching how the DB drivers persist DateTime columns."""
    return aware(dt).replace(tzinfo=None)
