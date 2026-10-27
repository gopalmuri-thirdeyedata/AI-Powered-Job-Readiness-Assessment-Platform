"""
Additive, idempotent migration for e-mail assessment invitations: creates the `assessment_invitations` table when missing.
No existing table, row, link, registration, attempt or score is read or changed.

  python migrate_assessment_invitations.py

The API also calls `apply()` on startup (create_all already builds the table on a fresh database), so running this by hand is optional.
"""
import os
import sys

from sqlalchemy import inspect

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "assessment_invitations"


def apply(engine=None) -> list:
    """Creates the table if missing. Returns what was added; a re-run returns []."""
    import database
    import models
    engine = engine or database.engine
    if inspect(engine).has_table(TABLE):
        return []
    try:
        models.AssessmentInvitation.__table__.create(bind=engine, checkfirst=True)
    except Exception:
        # another worker won the race: fine as long as the table exists now
        if not inspect(engine).has_table(TABLE):
            raise
        return []
    return [TABLE]


def main() -> int:
    added = apply()
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
