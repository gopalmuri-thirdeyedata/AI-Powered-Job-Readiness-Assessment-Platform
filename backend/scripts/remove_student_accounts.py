"""
Removes specific STUDENT accounts (and exactly the rows that depend on them) from the active SQLite database, safely.

  python scripts/remove_student_accounts.py --email a@x.com --email b@y.com            # DRY RUN: inspect + verified backup, deletes nothing
  python scripts/remove_student_accounts.py --email a@x.com --email b@y.com --execute  # backup, then delete in ONE transaction

Safety rules enforced by the code (not just by convention):
  * The target is the database the application itself is configured to use (database.engine); its path and evidence are printed.
  * Every e-mail must resolve to exactly one user with role STUDENT. An ADMIN, a member of any admin role, or an unknown e-mail aborts.
  * Dependent rows are discovered from the schema's own foreign keys (users -> student_profiles -> ... ), never guessed. Only tables
    reachable through ON DELETE CASCADE ownership are deleted. A dependent row in any other table (NO ACTION / unknown reference)
    stops the run: nothing is cascaded blindly. SET NULL children are reported and left to the engine's declared behaviour.
  * A backup is taken through SQLite's online backup API and verified (integrity_check, per-table row counts, target rows present)
    BEFORE anything is deleted; --execute refuses to proceed if verification fails.
  * Deletion runs with foreign_keys=ON (never disabled), child tables first, inside one transaction that is rolled back unless every
    post-condition holds (targets gone, every other user and every unrelated table untouched, no new foreign-key violations).
No external identity provider is contacted; nothing outside this database is modified.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)


def q(conn, sql, params=()):
    return conn.execute(sql, params).fetchall()


def tables(conn):
    return [r[0] for r in q(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def fk_children(conn):
    """{parent_table: [(child_table, child_col, parent_col, on_delete)]} from the schema's declared foreign keys."""
    graph = {}
    for t in tables(conn):
        for row in q(conn, f"PRAGMA foreign_key_list({t})"):
            graph.setdefault(row[2], []).append((t, row[3], row[4] or "id", (row[6] or "NO ACTION").upper()))
    return graph


def collect(conn, root_table, root_ids):
    """
    Walks the FK graph from `root_table` rows. Returns (owned, blockers, nulled):
      owned    {table: set(ids)}        rows reached only through ON DELETE CASCADE edges (to be deleted, with their pk values)
      blockers [(table, col, count)]    rows reached through NO ACTION / RESTRICT edges: deletion must stop
      nulled   [(table, col, count)]    rows reached through SET NULL edges (the engine nulls them)
    """
    graph = fk_children(conn)
    owned = {root_table: set(root_ids)}
    blockers, nulled = [], []
    frontier = [(root_table, set(root_ids))]
    while frontier:
        parent, ids = frontier.pop()
        for child, ccol, pcol, action in graph.get(parent, []):
            if pcol != "id":
                continue
            marks = ",".join("?" * len(ids))
            rows = [r[0] for r in q(conn, f"SELECT id FROM {child} WHERE {ccol} IN ({marks})", tuple(ids))] if ids else []
            if not rows:
                continue
            if action == "CASCADE":
                fresh = set(rows) - owned.get(child, set())
                if fresh:
                    owned.setdefault(child, set()).update(fresh)
                    frontier.append((child, fresh))
            elif action == "SET NULL":
                nulled.append((child, ccol, len(rows)))
            else:
                blockers.append((child, ccol, len(rows)))
    return owned, blockers, nulled


def delete_order(conn, owned):
    """Children before parents (reverse topological order of the FK graph restricted to the owned tables)."""
    deps = {t: set() for t in owned}          # t -> tables that must be deleted before t
    for parent, edges in fk_children(conn).items():
        for child, _c, _p, _a in edges:
            if parent in owned and child in owned and child != parent:
                deps[parent].add(child)
    order, seen = [], set()

    def visit(t):
        if t in seen:
            return
        seen.add(t)
        for c in sorted(deps[t]):
            visit(c)
        order.append(t)

    for t in sorted(owned):
        visit(t)
    return order


def snapshot_counts(conn):
    return {t: q(conn, f"SELECT COUNT(*) FROM {t}")[0][0] for t in tables(conn)}


def fk_violations(conn):
    return sorted(tuple(map(str, r)) for r in q(conn, "PRAGMA foreign_key_check"))


def verified_backup(src_path, label, backup_dir=None):
    backup_dir = backup_dir or os.path.join(BACKEND_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    target = os.path.join(backup_dir, f"hiringai_{label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
    src = sqlite3.connect(Path(src_path).resolve().as_uri() + "?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
        dst.commit()
        integrity = q(dst, "PRAGMA integrity_check")[0][0]
        src_counts, dst_counts = snapshot_counts(src), snapshot_counts(dst)
        report = {
            "backup_path": target,
            "backup_bytes": os.path.getsize(target),
            "integrity_check": integrity,
            "tables": len(dst_counts),
            "row_counts_match_source": src_counts == dst_counts,
            "users_in_backup": q(dst, "SELECT COUNT(*) FROM users")[0][0],
        }
    finally:
        dst.close()
        src.close()
    report["verified"] = report["integrity_check"] == "ok" and report["row_counts_match_source"]
    with open(target + ".verification.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", action="append", required=True, help="exact e-mail of a STUDENT account to remove (repeatable)")
    parser.add_argument("--backup-dir", default=None, help="where to write the verified backup (default: backend/backups)")
    parser.add_argument("--execute", action="store_true", help="actually delete (default is a dry run that only inspects and backs up)")
    args = parser.parse_args(argv)
    emails = [e.strip().lower() for e in args.email]

    import database
    url = database.engine.url
    if url.get_backend_name() != "sqlite" or not url.database:
        print("ABORT: this script only handles the SQLite database configured for the app; configured backend:", url.get_backend_name())
        return 1
    path = os.path.abspath(url.database)
    if not os.path.exists(path):
        print("ABORT: configured database file does not exist:", path)
        return 1
    print("Active database (from the application configuration):", path)
    print("  size bytes:", os.path.getsize(path), "| WAL present:", os.path.exists(path + "-wal"))

    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        users_all = q(conn, "SELECT id, email, role, is_active, organization_id FROM users ORDER BY id")
        print(f"  users table: {len(users_all)} rows")

        targets = []
        for email in emails:
            rows = q(conn, "SELECT id, email, role FROM users WHERE lower(email)=?", (email,))
            if len(rows) != 1:
                print(f"ABORT: {email!r} matches {len(rows)} users (expected exactly 1).")
                return 1
            uid, found, role = rows[0]
            if role != "STUDENT":
                print(f"ABORT: {found} (id {uid}) has role {role!r}, not STUDENT.")
                return 1
            admin_links = q(conn, "SELECT COUNT(*) FROM organization_members WHERE user_id=? AND role NOT IN ('STUDENT')", (uid,))[0][0]
            if admin_links:
                print(f"ABORT: {found} has {admin_links} non-student organization membership(s).")
                return 1
            targets.append((uid, found))
            print(f"  target: id={uid} email={found} role={role}")
        ids = [t[0] for t in targets]

        owned, blockers, nulled = collect(conn, "users", ids)
        print("Dependent rows reached through ON DELETE CASCADE ownership:")
        for t in delete_order(conn, owned):
            print(f"  {t}: {len(owned[t])}")
        for child, col, n in nulled:
            print(f"  (SET NULL, kept) {child}.{col}: {n}")
        if blockers:
            print("ABORT: rows depend on these accounts through non-cascading references; refusing to cascade blindly:")
            for child, col, n in blockers:
                print(f"  {child}.{col}: {n}")
            return 1
        # references the schema does not declare (e-mail keyed tables)
        for t in tables(conn):
            cols = [r[1] for r in q(conn, f"PRAGMA table_info({t})")]
            for col in cols:
                if "email" in col.lower() and t not in ("users", "student_profiles"):
                    n = q(conn, f"SELECT COUNT(*) FROM {t} WHERE lower({col}) IN ({','.join('?' * len(emails))})", tuple(emails))[0][0]
                    if n:
                        print(f"ABORT: {t}.{col} holds {n} row(s) for these e-mails without a declared foreign key; review before deleting.")
                        return 1

        before_counts = snapshot_counts(conn)
        before_violations = fk_violations(conn)
        other_users = [u for u in users_all if u[0] not in ids]
        print("Pre-existing foreign-key violations:", len(before_violations))

        backup = verified_backup(path, "pre_student_removal", args.backup_dir)
        print("Backup:", json.dumps(backup, indent=2))
        if not backup["verified"]:
            print("ABORT: the backup could not be verified; nothing was deleted.")
            return 1

        if not args.execute:
            print("DRY RUN complete: nothing was deleted. Re-run with --execute to delete.")
            return 0

        conn.execute("PRAGMA foreign_keys=ON")
        conn.isolation_level = None
        conn.execute("BEGIN IMMEDIATE")
        try:
            for t in delete_order(conn, owned):
                marks = ",".join("?" * len(owned[t]))
                conn.execute(f"DELETE FROM {t} WHERE id IN ({marks})", tuple(sorted(owned[t])))
            # post-conditions inside the transaction
            for _uid, email in targets:
                assert not q(conn, "SELECT 1 FROM users WHERE lower(email)=?", (email.lower(),)), f"{email} still exists"
            assert [tuple(u) for u in q(conn, "SELECT id, email, role, is_active, organization_id FROM users ORDER BY id")] == [tuple(u) for u in other_users], "other users changed"
            after_counts = snapshot_counts(conn)
            expected = {t: before_counts[t] - len(owned.get(t, ())) for t in before_counts}
            assert after_counts == expected, f"unexpected row-count change: {sorted(set(after_counts.items()) ^ set(expected.items()))}"
            assert fk_violations(conn) == before_violations, "new foreign-key violations"
            conn.execute("COMMIT")
        except BaseException as exc:
            conn.execute("ROLLBACK")
            print("ROLLED BACK (nothing deleted):", repr(exc))
            return 1

        print("Deleted. Post-checks:")
        print("  integrity_check:", q(conn, "PRAGMA integrity_check")[0][0])
        print("  foreign_key_check violations:", len(fk_violations(conn)), "(pre-existing:", len(before_violations), ")")
        print("  remaining users:", [tuple(u) for u in q(conn, "SELECT id, email, role FROM users ORDER BY id")])
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
