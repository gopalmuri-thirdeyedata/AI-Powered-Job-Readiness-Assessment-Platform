"""
Additive, idempotent migration for local authentication (Clerk removal).

  * users.full_name, users.phone, users.created_at, users.last_login_at   (nullable; no existing value is changed)
  * auth_sessions                                                          (server-side session table; created if missing)
  * --neutralize-placeholders: every stored hash of a Clerk-era placeholder secret ("clerk_managed_user", "clerk_student_user")
    is replaced by an unusable random hash. Those literals are public knowledge, so a row that still verifies against one
    would be a login for anybody who knows the e-mail address. (Login refuses the literals regardless; this removes the rows.)

No account is created, deleted or re-roled. The legacy users.clerk_user_id / organizations.clerk_org_id /
organization_members.clerk_user_id columns are intentionally kept (inert, never read); dropping them would be irreversible.

  python migrate_local_auth.py                            # SQLite: verified backup into backend/backups/ first, then migrate
  python migrate_local_auth.py --neutralize-placeholders  # additionally clear placeholder hashes (reports user ids only)
  python migrate_local_auth.py --no-backup

The API also calls `apply()` on startup (nullable ADD COLUMNs are safe; a missing column would break every user query).
"""
import os
import sqlite3
import sys
from datetime import datetime

from sqlalchemy import inspect, text

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

USER_COLUMNS = {
    "full_name": {"sqlite": "VARCHAR(150) NULL", "mysql": "VARCHAR(150) NULL"},
    "phone": {"sqlite": "VARCHAR(50) NULL", "mysql": "VARCHAR(50) NULL"},
    "created_at": {"sqlite": "DATETIME NULL", "mysql": "DATETIME NULL"},
    "last_login_at": {"sqlite": "DATETIME NULL", "mysql": "DATETIME NULL"},
}


def apply(engine=None) -> list:
    """Adds the missing columns and the session table. Returns what was added; a re-run returns []."""
    import database
    import models
    engine = engine or database.engine
    added = []
    insp = inspect(engine)
    if insp.has_table("users"):
        present = {c["name"] for c in insp.get_columns("users")}
        dialect = "mysql" if engine.dialect.name == "mysql" else "sqlite"
        for column, ddl in USER_COLUMNS.items():
            if column in present:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {column} {ddl[dialect]}"))
                added.append(f"users.{column}")
            except Exception:
                # another worker won the race: fine as long as the column exists now
                if column not in {c["name"] for c in inspect(engine).get_columns("users")}:
                    raise
    if not inspect(engine).has_table("auth_sessions"):
        models.AuthSession.__table__.create(bind=engine, checkfirst=True)
        added.append("auth_sessions")
    return added


def neutralize_placeholder_passwords(engine=None) -> list:
    """Replaces hashes of the Clerk-era placeholder secrets with unusable ones. Returns the affected user ids (never any secret)."""
    import database
    import utils
    from sqlalchemy.orm import Session
    engine = engine or database.engine
    cleared = []
    with Session(engine) as db:
        rows = db.execute(text("SELECT id, hashed_password FROM users")).fetchall()
        for user_id, stored in rows:
            if any(utils.verify_password(placeholder, stored) for placeholder in utils.LEGACY_PLACEHOLDER_PASSWORDS):
                db.execute(text("UPDATE users SET hashed_password = :h WHERE id = :i"),
                           {"h": utils.make_unusable_password_hash(), "i": user_id})
                cleared.append(user_id)
        db.commit()
    return cleared


def backup_sqlite(engine, backup_dir=None) -> str:
    """Online SQLite backup + integrity check. Returns the backup path."""
    path = engine.url.database
    backup_dir = backup_dir or os.path.join(BACKEND_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    target = os.path.join(backup_dir, f"pre_local_auth_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
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
    print("Database:", engine.url.render_as_string(hide_password=True))
    if engine.dialect.name == "sqlite" and "--no-backup" not in argv and engine.url.database and os.path.exists(engine.url.database):
        print("Backup written:", backup_sqlite(engine))
    elif engine.dialect.name != "sqlite":
        print("Non-SQLite database: take your own verified backup first (the change adds nullable columns and one table).")
    added = apply(engine)
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    if "--neutralize-placeholders" in argv:
        cleared = neutralize_placeholder_passwords(engine)
        print("Placeholder password hashes replaced for user ids:", cleared if cleared else "none found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
