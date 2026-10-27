"""
Additive, idempotent migration for the admin-controlled student assessment access switch:

  * student_profiles.assessment_access_enabled     BOOLEAN NOT NULL DEFAULT FALSE   (every existing student starts LOCKED)
  * student_profiles.assessment_access_updated_at  DATETIME NULL
  * student_profiles.assessment_access_updated_by  INTEGER  NULL                   (id of the administrator who last changed it)

No existing student, session, attempt, score or report row is read or changed beyond receiving the default. Re-running is a no-op.

  python migrate_student_assessment_toggle.py

The API also calls `apply()` on startup (a missing column would break every student-profile query), so running this by hand is optional.
"""
import os
import sys

from sqlalchemy import inspect, text

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "student_profiles"
COLUMNS = {
    "assessment_access_enabled": {"sqlite": "BOOLEAN NOT NULL DEFAULT 0", "mysql": "TINYINT(1) NOT NULL DEFAULT 0"},
    "assessment_access_updated_at": {"sqlite": "DATETIME NULL", "mysql": "DATETIME NULL"},
    "assessment_access_updated_by": {"sqlite": "INTEGER NULL", "mysql": "INT NULL"},
}


def apply(engine=None) -> list:
    """Adds the missing columns. Returns what was added; a re-run returns []."""
    import database
    engine = engine or database.engine
    added = []
    insp = inspect(engine)
    if not insp.has_table(TABLE):
        return added  # fresh database: create_all builds the full schema including the columns
    present = {c["name"] for c in insp.get_columns(TABLE)}
    dialect = "mysql" if engine.dialect.name == "mysql" else "sqlite"
    for column, ddl in COLUMNS.items():
        if column in present:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {column} {ddl[dialect]}"))
            added.append(f"{TABLE}.{column}")
        except Exception:
            # another worker won the race: fine as long as the column exists now
            if column not in {c["name"] for c in inspect(engine).get_columns(TABLE)}:
                raise
    return added


def main() -> int:
    added = apply()
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
