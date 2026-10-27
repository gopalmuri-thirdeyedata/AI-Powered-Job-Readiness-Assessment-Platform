"""
Additive, idempotent migration for the invited-student assessment workflow:

  * candidate_registrations.student_user_id   INTEGER NULL  (+ index)   the student account an attempt belongs to
  * assessment_reviews                         new table     the mandatory 30-word exam review, one per attempt

No existing student, credential, registration, attempt, score or report row is read or changed. Existing registrations keep
student_user_id = NULL (the accountless candidate workflow). Re-running is a no-op.

  python migrate_student_assessment_access.py

The API also calls `apply()` on startup (a nullable ADD COLUMN plus a new table are safe, and a missing column would otherwise
break every registration query), so running this by hand is optional.
"""
import os
import sys

from sqlalchemy import inspect, text

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "candidate_registrations"
COLUMN = "student_user_id"
INDEX = "ix_candidate_registrations_student_user_id"
REVIEWS = "assessment_reviews"


def apply(engine=None) -> list:
    """Adds the column, its index and the reviews table if missing. Returns what was added; a re-run returns []."""
    import database
    import models
    engine = engine or database.engine
    added = []

    if not inspect(engine).has_table(REVIEWS):
        try:
            models.AssessmentReview.__table__.create(bind=engine, checkfirst=True)
            added.append(REVIEWS)
        except Exception:
            if not inspect(engine).has_table(REVIEWS):  # another worker won the race: fine as long as it exists now
                raise

    insp = inspect(engine)
    if not insp.has_table(TABLE):
        return added  # fresh database: create_all builds the full schema including the column
    if COLUMN not in {c["name"] for c in insp.get_columns(TABLE)}:
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} INTEGER NULL"))
            added.append(f"{TABLE}.{COLUMN}")
        except Exception:
            if COLUMN not in {c["name"] for c in inspect(engine).get_columns(TABLE)}:
                raise
    if INDEX not in {i["name"] for i in inspect(engine).get_indexes(TABLE)}:
        try:
            with engine.begin() as conn:
                conn.execute(text(f"CREATE INDEX {INDEX} ON {TABLE} ({COLUMN})"))
            added.append(INDEX)
        except Exception:
            pass  # an index is only an optimisation; never block startup over it
    return added


def main() -> int:
    added = apply()
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
