"""
Additive, idempotent migration for section retests: creates the `assessment_retests` table when missing and, on a table created by an
earlier version, adds the candidate-notification columns. No existing row, account or password hash is read or changed.

  python migrate_assessment_retests.py

The API also calls `apply()` on startup (create_all already builds the table on a fresh database), so running this by hand is optional.
"""
import os
import sys

from sqlalchemy import inspect, text

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "assessment_retests"
# columns added after the first release of the table (sqlite DDL, mysql DDL)
LATER_COLUMNS = {
    "notify_batch": ("VARCHAR(64) NULL", "VARCHAR(64) NULL"),
    "email_status": ("VARCHAR(12) NOT NULL DEFAULT 'PENDING'", "VARCHAR(12) NOT NULL DEFAULT 'PENDING'"),
    "email_attempts": ("INTEGER NOT NULL DEFAULT 0", "INT NOT NULL DEFAULT 0"),
    "email_claimed_at": ("DATETIME NULL", "DATETIME(6) NULL"),
    "email_sent_at": ("DATETIME NULL", "DATETIME(6) NULL"),
    "email_last_error": ("VARCHAR(255) NULL", "VARCHAR(255) NULL"),
    "email_recipient": ("VARCHAR(150) NULL", "VARCHAR(150) NULL"),
}


def apply(engine=None) -> list:
    """Creates the table if missing, otherwise adds the missing columns. Returns what was added; a re-run returns []."""
    import database
    import models
    engine = engine or database.engine
    if not inspect(engine).has_table(TABLE):
        try:
            models.AssessmentRetest.__table__.create(bind=engine, checkfirst=True)
        except Exception:
            if not inspect(engine).has_table(TABLE):   # another worker won the race: fine as long as it exists now
                raise
            return []
        return [TABLE]
    added = []
    present = {c["name"] for c in inspect(engine).get_columns(TABLE)}
    mysql = engine.dialect.name == "mysql"
    for column, (sqlite_ddl, mysql_ddl) in LATER_COLUMNS.items():
        if column in present:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {column} {mysql_ddl if mysql else sqlite_ddl}"))
            added.append(f"{TABLE}.{column}")
        except Exception:
            if column not in {c["name"] for c in inspect(engine).get_columns(TABLE)}:   # lost a race: fine if it exists now
                raise
    return added


def main() -> int:
    added = apply()
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
