"""
Additive, idempotent migration for the optional company name of a job role (assessment):

  * job_descriptions.company_name  VARCHAR(200) NULL

Existing-data policy (explicit): every existing row keeps NULL. The role / team value in `job_descriptions.role` is NOT copied or
reinterpreted as a company name. No candidate, registration, attempt, score or report row is read or written.

  python migrate_job_company_name.py

The API also calls `apply()` on startup (a nullable ADD COLUMN is safe, and a missing column would break every job-role query), so
running this by hand is optional.
"""
import os
import sys

from sqlalchemy import inspect, text

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "job_descriptions"
COLUMN = "company_name"
DDL = "VARCHAR(200) NULL"


def apply(engine=None) -> list:
    """Adds the column if missing. Returns what was added; a re-run returns []."""
    import database
    engine = engine or database.engine
    insp = inspect(engine)
    if not insp.has_table(TABLE):
        return []  # fresh database: create_all builds the full schema including the column
    if COLUMN in {c["name"] for c in insp.get_columns(TABLE)}:
        return []
    try:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} {DDL}"))
    except Exception:
        # another worker won the race: fine as long as the column exists now
        if COLUMN not in {c["name"] for c in inspect(engine).get_columns(TABLE)}:
            raise
        return []
    return [f"{TABLE}.{COLUMN}"]


def main() -> int:
    added = apply()
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
