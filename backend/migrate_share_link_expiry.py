"""
Additive, idempotent migration for Recruitment Shared Link expiry (24 h).

  * job_descriptions.share_link_expires_at  DATETIME NULL   (UTC, server clock)
  * job_share_link_history                   (superseded links; created by create_all, ensured here too)

Existing-data policy (explicit): links that already exist get NO expiry (NULL = legacy, never auto-expired by this migration).
They keep working exactly as before until an administrator closes them; reopening a legacy link then stamps a 24 h window.
No candidate, registration, attempt, score or report row is read or written.

  python migrate_share_link_expiry.py            # SQLite: verified copy into backend/backups/ first, then migrate
  python migrate_share_link_expiry.py --no-backup

The API also calls `apply()` on startup (a nullable ADD COLUMN is safe and a missing column would otherwise break every
job-role query), so running this script by hand is optional but recommended for a backup.
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

from sqlalchemy import inspect, text

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "job_descriptions"
COLUMN = "share_link_expires_at"
DDL = {"sqlite": "DATETIME NULL", "mysql": "DATETIME(6) NULL"}


def apply(engine=None) -> list:
    """Adds the column (and the history table) if missing. Returns what was added; a re-run returns []."""
    import database
    import models
    engine = engine or database.engine
    added = []
    models.JobShareLinkHistory.__table__.create(bind=engine, checkfirst=True)
    insp = inspect(engine)
    if not insp.has_table(TABLE):
        return added  # fresh database: create_all builds the full schema including the column
    if COLUMN in {c["name"] for c in insp.get_columns(TABLE)}:
        return added
    ddl = DDL["mysql"] if engine.dialect.name == "mysql" else DDL["sqlite"]
    try:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} {ddl}"))
        added.append(f"{TABLE}.{COLUMN}")
    except Exception:
        # another worker won the race: fine as long as the column exists now
        if COLUMN not in {c["name"] for c in inspect(engine).get_columns(TABLE)}:
            raise
    return added


def backup_sqlite(engine, backup_dir=None) -> str:
    """Online SQLite backup + integrity check. Returns the backup path."""
    path = engine.url.database
    backup_dir = backup_dir or os.path.join(BACKEND_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    target = os.path.join(backup_dir, f"pre_share_link_expiry_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
    src = sqlite3.connect(path)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError(f"backup integrity check failed: {target}")
    finally:
        dst.close()
        src.close()
    return target


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    import database
    engine = database.engine
    if engine.dialect.name == "sqlite" and "--no-backup" not in argv and engine.url.database and os.path.exists(engine.url.database):
        print("Backup written:", backup_sqlite(engine))
    elif engine.dialect.name != "sqlite":
        print("Non-SQLite database: take your own verified backup first (the change is one nullable ADD COLUMN).")
    added = apply(engine)
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
