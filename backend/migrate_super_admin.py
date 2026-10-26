"""
Idempotent migration to the three-role model (SUPER_ADMIN / ADMIN / STUDENT).

What it does (and ONLY this):
  1. Provisions the initial Super Admin: the account `admin@thirdeyedata.ai` (override with --super-admin-email) becomes SUPER_ADMIN.
     It must already exist and currently be an administrative account (ADMIN or a legacy admin value); it is never created here,
     its password / data / memberships are untouched.
  2. Normalizes LEGACY administrative role values of other accounts to ADMIN (ORGANIZATION_ADMIN, HR, HR_ADMIN, RECRUITER, INTERVIEWER).
     These accounts keep their organization membership and get organization-admin permissions only (never platform scope).
  3. Does NOT guess: a legacy PLATFORM_ADMIN / SUPER_ADMIN value on any other account, and any unknown role value, is REPORTED for
     manual review and left unchanged (a login-incapable value is safer than an invented privilege).
  4. Leaves STUDENT and CANDIDATE (internal candidate-invitation shadow accounts) untouched.
Everything runs in one transaction; a re-run changes nothing. Passwords are never read or reset.

  python migrate_super_admin.py              # dry run: prints the plan and the role counts, writes nothing
  python migrate_super_admin.py --execute    # SQLite: verified backup into backend/backups/, then migrate
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BACKEND_DIR)

LEGACY_ORG_ADMIN = ("ORGANIZATION_ADMIN", "HR", "HR_ADMIN", "RECRUITER", "INTERVIEWER")
LEGACY_PLATFORM = ("PLATFORM_ADMIN", "SUPER_ADMIN")
CANONICAL = ("SUPER_ADMIN", "ADMIN", "STUDENT", "CANDIDATE")


def counts(conn):
    return conn.execute("SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY role").fetchall()


def plan(conn, super_email):
    actions, review = [], []
    sa = conn.execute("SELECT id, email, role FROM users WHERE lower(email)=?", (super_email,)).fetchall()
    if len(sa) != 1:
        raise SystemExit(f"ABORT: expected exactly one account for {super_email}, found {len(sa)}; nothing changed.")
    uid, email, role = sa[0]
    if role not in ("ADMIN", "SUPER_ADMIN") + LEGACY_ORG_ADMIN + LEGACY_PLATFORM:
        raise SystemExit(f"ABORT: {email} has role {role!r}, which is not an administrative account; refusing to elevate it.")
    if role != "SUPER_ADMIN":
        actions.append((uid, email, role, "SUPER_ADMIN"))
    for uid2, email2, role2 in conn.execute("SELECT id, email, role FROM users WHERE id != ? ORDER BY id", (uid,)).fetchall():
        if role2 in LEGACY_ORG_ADMIN:
            actions.append((uid2, email2, role2, "ADMIN"))
        elif role2 in LEGACY_PLATFORM:
            review.append((uid2, email2, role2, "legacy platform-level role on an account that is not the designated Super Admin"))
        elif role2 == "SUPER_ADMIN":
            review.append((uid2, email2, role2, "additional Super Admin that this migration did not designate"))
        elif role2 not in CANONICAL:
            review.append((uid2, email2, role2, "unknown role value"))
    return uid, actions, review


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--super-admin-email", default="admin@thirdeyedata.ai")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--backup-dir", default=None)
    args = p.parse_args(argv)
    import database
    url = database.engine.url
    if url.get_backend_name() != "sqlite" or not url.database:
        print("This script handles the configured SQLite database only; take your own verified backup for other engines and apply the same rules.")
        return 1
    path = os.path.abspath(url.database)
    print("Active database:", path)
    conn = sqlite3.connect(path, timeout=30)
    try:
        print("Role counts BEFORE:", counts(conn))
        super_id, actions, review = plan(conn, args.super_admin_email.strip().lower())
        for uid, email, old, new in actions:
            print(f"  plan: id={uid} {email}: {old} -> {new}")
        for uid, email, role, why in review:
            print(f"  MANUAL REVIEW (unchanged): id={uid} {email} role={role}: {why}")
        if not actions:
            print("  nothing to change (already migrated)")
        if not args.execute:
            print("DRY RUN: nothing written. Re-run with --execute.")
            return 0
        if actions:
            backup_dir = args.backup_dir or os.path.join(BACKEND_DIR, "backups")
            os.makedirs(backup_dir, exist_ok=True)
            target = os.path.join(backup_dir, f"pre_super_admin_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
            src = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
            dst = sqlite3.connect(target)
            src.backup(dst)
            ok = dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok" and dst.execute("SELECT COUNT(*) FROM users").fetchone() == conn.execute("SELECT COUNT(*) FROM users").fetchone()
            dst.close(); src.close()
            print("Backup:", target, "verified" if ok else "NOT VERIFIED")
            if not ok:
                return 1
        conn.isolation_level = None
        conn.execute("BEGIN IMMEDIATE")
        try:
            for uid, _email, old, new in actions:
                conn.execute("UPDATE users SET role=? WHERE id=? AND role=?", (new, uid, old))
                if new == "ADMIN":
                    conn.execute("UPDATE organization_members SET role='ADMIN' WHERE user_id=? AND role IN ('ORGANIZATION_ADMIN','HR','HR_ADMIN','RECRUITER','INTERVIEWER')", (uid,))
            assert conn.execute("SELECT role FROM users WHERE id=?", (super_id,)).fetchone()[0] == "SUPER_ADMIN"
            conn.execute("COMMIT")
        except BaseException as exc:
            conn.execute("ROLLBACK")
            print("ROLLED BACK:", repr(exc))
            return 1
        print("Role counts AFTER:", counts(conn))
        print("integrity_check:", conn.execute("PRAGMA integrity_check").fetchone()[0])
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
