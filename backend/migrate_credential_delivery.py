"""
Additive, idempotent migration for "Share credentials": creates the `credential_deliveries` table when missing.
No existing table, row, account or password hash is read or changed.

  python migrate_credential_delivery.py

The API also calls `apply()` on startup (create_all already builds the table on a fresh database), so running this by hand is optional.
"""
import os
import sys

from sqlalchemy import inspect

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

TABLE = "credential_deliveries"


def apply(engine=None) -> list:
    """Creates the table if missing. Returns what was added; a re-run returns []."""
    import database
    import models
    engine = engine or database.engine
    if inspect(engine).has_table(TABLE):
        return []
    try:
        models.CredentialDelivery.__table__.create(bind=engine, checkfirst=True)
    except Exception:
        if not inspect(engine).has_table(TABLE):   # another worker won the race: fine as long as it exists now
            raise
        return []
    return [TABLE]


def main() -> int:
    added = apply()
    print("Added:", ", ".join(added) if added else "nothing (already migrated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
