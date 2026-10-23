#!/usr/bin/env python
"""
Safe, idempotent migration for the Admin Recruitment Workflow (plan v3.6, section 8).

    python migrate_recruitment_workflow.py                # upgrade (backup -> preflight -> migrate -> verify)
    python migrate_recruitment_workflow.py --rollback     # guarded rollback
    python migrate_recruitment_workflow.py --database-url sqlite:///path/to.db --backup-dir ./backups

Phases
  1. Verified restorable physical backup (SQLite: backup copy + integrity_check + row counts;
     MySQL: mysqldump via a 0600 --defaults-extra-file, trailer check, isolated restore test).
  2. Preflight duplicate / blank-email audit -> backend/migration_conflicts.json, exit code 1, zero data altered.
  3. Constraint & index migration (SQLite: ONE atomic EXCLUSIVE transaction with PRAGMA foreign_keys=OFF set
     outside it; MySQL: guarded idempotent DDL with a functional index or a STORED generated column fallback).
  4. Post-migration verification inside a transaction that is always rolled back. The migration is recorded
     as verified in _prepwin_migration_history only after verification passes.
"""
import argparse
import gzip
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import uuid
from datetime import datetime, timezone

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

HISTORY_TABLE = "_prepwin_migration_history"
PHASE_SCHEMA = "recruitment_workflow_v1:schema"
PHASE_VERIFIED = "recruitment_workflow_v1:verified"
BACKUP_COUNT_TABLES = ("candidates", "candidate_invitations", "roleready_sessions")
DEFAULT_CONFLICTS_FILE = os.path.join(BACKEND_DIR, "migration_conflicts.json")
DEFAULT_BACKUP_DIR = os.path.join(BACKEND_DIR, "backups")
RECRUITMENT_TABLES = ("candidate_registrations", "job_blueprint_versions", "incident_records")

# (column, SQLite DDL, MySQL DDL)
JOB_DESCRIPTION_COLUMNS = [
    ("is_published", "BOOLEAN NOT NULL DEFAULT 0", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("share_token", "VARCHAR(64)", "VARCHAR(64) NULL"),
    ("status", "VARCHAR(30) NOT NULL DEFAULT 'DRAFT'", "VARCHAR(30) NOT NULL DEFAULT 'DRAFT'"),
    ("blueprint_data", "JSON", "JSON NULL"),
    ("blueprint_version", "INTEGER NOT NULL DEFAULT 0", "INT NOT NULL DEFAULT 0"),
    ("updated_at", "DATETIME", "DATETIME NULL"),
]
SESSION_COLUMNS = [
    ("registration_id", "INTEGER REFERENCES candidate_registrations(id) ON DELETE SET NULL", "INT NULL"),
    ("overall_deadline_at", "DATETIME", "DATETIME(6) NULL"),
    ("current_section_deadline_at", "DATETIME", "DATETIME(6) NULL"),
    ("last_heartbeat_at", "DATETIME", "DATETIME(6) NULL"),
    ("session_capability_hash", "VARCHAR(64)", "VARCHAR(64) NULL"),
    ("active_lease_hash", "VARCHAR(64)", "VARCHAR(64) NULL"),
    ("abandoned_at", "DATETIME", "DATETIME(6) NULL"),
    ("finalized_at", "DATETIME", "DATETIME(6) NULL"),
    ("failed_at", "DATETIME", "DATETIME(6) NULL"),
    ("incident_reference_id", "VARCHAR(64)", "VARCHAR(64) NULL"),
    ("sweeper_claimed_at", "DATETIME", "DATETIME(6) NULL"),
    ("sweeper_worker_id", "VARCHAR(64)", "VARCHAR(64) NULL"),
]
SESSION_NEW_INDEXES = ("ix_roleready_sessions_registration_id", "ix_roleready_sessions_session_capability_hash",
                       "ix_roleready_sessions_incident_reference_id")


POST_COMMIT_RECOVERY = (
    "The schema changes were already COMMITTED and are NOT rolled back automatically. Recovery: restore the verified pre-migration backup taken at the start of this run, or fix the reported problem and re-run (a re-run skips the completed schema phase and only re-verifies)."
)


class MigrationError(Exception):
    """Fatal migration problem; nothing further is executed."""


class PreflightConflictError(MigrationError):
    """Duplicate / blank candidate emails block the functional unique index."""


def _log(msg):
    print(f"[migrate_recruitment_workflow] {msg}", flush=True)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")


def sqlite_path_from_url(url):
    if not url.startswith("sqlite:///"):
        raise MigrationError("Not a SQLite URL.")
    path = url[len("sqlite:///"):]
    if path in ("", ":memory:"):
        raise MigrationError("In-memory SQLite databases cannot be migrated.")
    return path


def is_sqlite_url(url):
    return url.startswith("sqlite")


# ==============================================================================
# Phase 1 - backups
# ==============================================================================
def _sqlite_count(conn, table):
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    if not exists:
        return None
    return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]


def sqlite_backup_and_verify(db_path, backup_dir=None):
    """Consistent copy of the live DB (sqlite3 backup API), then integrity + row-count verification."""
    ts = _timestamp()
    if backup_dir:
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, f"{os.path.basename(db_path)}.bak_{ts}")
    else:
        backup_path = f"{db_path}.bak_{ts}"

    live = sqlite3.connect(db_path)
    try:
        live_counts = {t: _sqlite_count(live, t) for t in BACKUP_COUNT_TABLES}
        dest = sqlite3.connect(backup_path)
        try:
            live.backup(dest)
        finally:
            dest.close()
    finally:
        live.close()

    check = sqlite3.connect(backup_path)
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchall()
        if integrity != [("ok",)]:
            raise MigrationError(f"Backup integrity_check failed: {integrity[:3]}")
        for table, expected in live_counts.items():
            actual = _sqlite_count(check, table)
            if actual != expected:
                raise MigrationError(f"Backup row-count mismatch on {table}: live={expected} backup={actual}")
    finally:
        check.close()
    _log(f"SQLite backup verified: {backup_path} (counts={live_counts})")
    return backup_path


def parse_mysql_url(url):
    from sqlalchemy.engine import make_url
    u = make_url(url)
    return {"user": u.username or "root", "password": u.password or "", "host": u.host or "127.0.0.1",
            "port": u.port or 3306, "database": u.database}


def write_mysql_defaults_file(creds, directory, pid=None):
    """Temporary option file (mode 0600) so credentials never appear on a command line or in logs."""
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f".my_dump_creds_{pid or os.getpid()}.cnf")
    escaped = creds["password"].replace("\\", "\\\\").replace('"', '\\"')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("[client]\n")
        fh.write(f"user = {creds['user']}\n")
        fh.write(f'password = "{escaped}"\n')
        fh.write(f"host = {creds['host']}\n")
        fh.write(f"port = {creds['port']}\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path


def _sanitize(raw, creds):
    out = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else (raw or "")
    if creds.get("password"):
        out = out.replace(creds["password"], "****")
    return out[:2000]


def mysql_backup_and_verify(engine, backup_dir=None, runner=subprocess.run):
    """
    mysqldump -> structural trailer check -> isolated restore into prepwin_backup_verify_<ts> ->
    compare against baseline snapshot coordinates captured immediately before the dump -> drop test DB.
    `runner` is injectable so command construction can be unit-tested without a MySQL server.
    """
    from sqlalchemy import create_engine, text
    creds = parse_mysql_url(engine.url.render_as_string(hide_password=False))
    backup_dir = backup_dir or DEFAULT_BACKUP_DIR
    os.makedirs(backup_dir, exist_ok=True)
    ts = _timestamp()
    dump_path = os.path.join(backup_dir, f"backup_{ts}.sql")
    verify_db = f"prepwin_backup_verify_{ts}"
    defaults_path = None

    required_tables = ("candidates", "users", "organizations", "candidate_invitations", "roleready_sessions")
    with engine.connect() as conn:
        existing = {r[0] for r in conn.execute(text("SHOW TABLES"))}
        snapshot = {t: conn.execute(text(f"SELECT COUNT(*) FROM `{t}`")).scalar() for t in required_tables if t in existing}
        bounds = {}
        for t in ("candidates", "roleready_sessions"):
            if t in existing:
                row = conn.execute(text(f"SELECT MIN(id), MAX(id) FROM `{t}`")).fetchone()
                bounds[t] = (row[0], row[1])

    def run_tool(cmd, **kw):
        """Run a MySQL client binary; a missing/unstartable binary is a clean, explained abort (never a traceback)."""
        try:
            return runner(cmd, **kw)
        except FileNotFoundError:
            raise MigrationError(f"'{cmd[0]}' was not found on PATH. Install the MySQL client tools; no schema change was made.")
        except OSError as exc:
            raise MigrationError(f"Could not start '{cmd[0]}': {type(exc).__name__}. No schema change was made.")

    backup_ok = False
    try:
        defaults_path = write_mysql_defaults_file(creds, backup_dir)
        dump_cmd = ["mysqldump", f"--defaults-extra-file={defaults_path}", "--single-transaction", "--routines",
                    "--triggers", "--events", "--hex-blob", "--quick", creds["database"]]
        with open(dump_path, "wb") as out:
            proc = run_tool(dump_cmd, stdout=out, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            raise MigrationError(f"mysqldump failed (exit {proc.returncode}): {_sanitize(proc.stderr, creds)}")
        if not os.path.exists(dump_path) or os.path.getsize(dump_path) == 0:
            raise MigrationError("mysqldump produced an empty file.")
        with open(dump_path, "rb") as fh:
            fh.seek(max(0, os.path.getsize(dump_path) - 512))
            tail = fh.read().decode("utf-8", "replace")
        # mysqldump prints e.g. "-- Dump completed on 2026-10-22  9:39:18" (space-padded, non-zero-padded hour)
        if not re.search(r"-- Dump completed on \d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}", tail):
            raise MigrationError("Dump trailer '-- Dump completed on' missing: the dump is truncated.")

        create = run_tool(["mysql", f"--defaults-extra-file={defaults_path}", "-e", f"CREATE DATABASE `{verify_db}`;"],
                          stderr=subprocess.PIPE)
        if create.returncode != 0:
            raise MigrationError(f"Could not create verification database (exit {create.returncode}): {_sanitize(create.stderr, creds)}")
        try:
            with open(dump_path, "rb") as fh:
                restore = run_tool(["mysql", f"--defaults-extra-file={defaults_path}", verify_db], stdin=fh, stderr=subprocess.PIPE)
            if restore.returncode != 0:
                raise MigrationError(f"Restore test failed (exit {restore.returncode}): {_sanitize(restore.stderr, creds)}")

            verify_engine = create_engine(engine.url.set(database=verify_db))
            try:
                with verify_engine.connect() as vconn:
                    restored = {r[0] for r in vconn.execute(text("SHOW TABLES"))}
                    missing = [t for t in snapshot if t not in restored]
                    if missing:
                        raise MigrationError(f"Restored backup is missing tables: {missing}")
                    for t, expected in snapshot.items():
                        actual = vconn.execute(text(f"SELECT COUNT(*) FROM `{t}`")).scalar()
                        if actual != expected:
                            raise MigrationError(f"Restore row-count mismatch on {t}: snapshot={expected} restored={actual}")
                    for t, (_mn, mx) in bounds.items():
                        actual_max = vconn.execute(text(f"SELECT MAX(id) FROM `{t}`")).scalar()
                        if actual_max != mx:
                            raise MigrationError(f"Restore MAX(id) mismatch on {t}: snapshot={mx} restored={actual_max}")
                    if "candidate_invitations" in restored and "candidates" in restored:
                        orphans = vconn.execute(text(
                            "SELECT COUNT(*) FROM candidate_invitations ci LEFT JOIN candidates c ON ci.candidate_id = c.id WHERE c.id IS NULL"
                        )).scalar()
                        if orphans:
                            raise MigrationError(f"{orphans} orphan candidate_invitations rows in restored backup.")
            finally:
                verify_engine.dispose()
        finally:
            drop = run_tool(["mysql", f"--defaults-extra-file={defaults_path}", "-e", f"DROP DATABASE IF EXISTS `{verify_db}`;"],
                            stderr=subprocess.PIPE)
            if drop.returncode != 0:
                _log(f"WARNING: could not drop temporary database {verify_db}; drop it manually.")

        gz_path = dump_path + ".gz"
        with open(dump_path, "rb") as src, gzip.open(gz_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
        os.remove(dump_path)
        backup_ok = True
        _log(f"MySQL backup verified and archived: {gz_path}")
        return gz_path
    finally:
        if not backup_ok and os.path.exists(dump_path):
            try:
                os.remove(dump_path)  # never leave a partial/unverified dump looking like a backup
            except OSError:
                pass
        if defaults_path and os.path.exists(defaults_path):
            try:
                os.remove(defaults_path)
            except OSError:
                pass


# ==============================================================================
# Phase 2 - preflight audit (engine neutral; named bind parameters)
# ==============================================================================
def preflight_conflicts(fetchall):
    """`fetchall(sql, params_dict)` -> list of rows. Returns a report dict (empty lists when clean)."""
    groups = fetchall(
        "SELECT organization_id, LOWER(TRIM(email)) AS norm_email, COUNT(*) AS n FROM candidates "
        "WHERE email IS NOT NULL AND TRIM(email) <> '' "
        "GROUP BY organization_id, LOWER(TRIM(email)) HAVING COUNT(*) > 1", {})
    collisions = []
    for org_id, norm_email, n in groups:
        if org_id is None:
            rows = fetchall("SELECT id, organization_id, email, created_at FROM candidates "
                            "WHERE organization_id IS NULL AND LOWER(TRIM(email)) = :norm", {"norm": norm_email})
        else:
            rows = fetchall("SELECT id, organization_id, email, created_at FROM candidates "
                            "WHERE organization_id = :org AND LOWER(TRIM(email)) = :norm", {"org": org_id, "norm": norm_email})
        collisions.append({
            "organization_id": org_id, "normalized_email": norm_email, "count": n,
            "records": [{"id": r[0], "organization_id": r[1], "email": r[2], "created_at": str(r[3])} for r in rows],
        })
    blanks = fetchall("SELECT id, organization_id, email, created_at FROM candidates WHERE email IS NULL OR TRIM(email) = ''", {})
    anomalies = [{"id": r[0], "organization_id": r[1], "email": r[2], "created_at": str(r[3])} for r in blanks]
    return {"generated_at": _now_iso(), "normalized_collisions": collisions, "blank_or_null_emails": anomalies}


def run_preflight(fetchall, conflicts_path):
    report = preflight_conflicts(fetchall)
    if report["normalized_collisions"] or report["blank_or_null_emails"]:
        with open(conflicts_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        raise PreflightConflictError(
            f"Preflight found {len(report['normalized_collisions'])} normalized email collision group(s) and "
            f"{len(report['blank_or_null_emails'])} blank/null email row(s). Report: {conflicts_path}. "
            "No data was altered; resolve these manually and re-run."
        )
    _log("Preflight clean: no normalized email collisions and no blank/null emails.")


# ==============================================================================
# Model-driven DDL (single source of truth with models.py)
# ==============================================================================
def _model_ddl(dialect, skip_functional=False):
    """{table: (create_table_sql, {index_name: create_index_sql})} for the recruitment-only tables."""
    import models
    from sqlalchemy.schema import CreateIndex, CreateTable
    out = {}
    for name in RECRUITMENT_TABLES:
        table = models.Base.metadata.tables[name]
        idx_sql = {}
        for ix in table.indexes:
            if skip_functional and ix.name.startswith("uix_") and "norm_email" in ix.name:
                continue
            idx_sql[ix.name] = str(CreateIndex(ix).compile(dialect=dialect)).strip()
        out[name] = (str(CreateTable(table).compile(dialect=dialect)).strip(), idx_sql)
    return out


# ==============================================================================
# SQLite migration (single atomic EXCLUSIVE transaction)
# ==============================================================================
def _sq_tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _sq_columns(conn, table):
    return [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]


def _sq_index_exists(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone() is not None


def _sq_unique_indexes(conn, table):
    """[(index_name, origin, [columns])] for every unique index/constraint (origin: c=index, u=constraint, pk)."""
    found = []
    for row in conn.execute(f'PRAGMA index_list("{table}")').fetchall():
        name, unique, origin = row[1], row[2], row[3]
        if unique:
            cols = [c[2] for c in conn.execute(f'PRAGMA index_info("{name}")')]
            found.append((name, origin, cols))
    return found


def _sq_child_fk_inventory(conn, parent="candidates"):
    inventory = []
    for t in sorted(_sq_tables(conn)):
        if t.startswith("sqlite_"):
            continue
        for fk in conn.execute(f'PRAGMA foreign_key_list("{t}")').fetchall():
            if fk[2] == parent:
                inventory.append({"child_table": t, "column": fk[3], "parent_column": fk[4], "on_delete": fk[6]})
    return inventory


def _q(name):
    return '"' + name + '"'


def _sq_create_table_sql(conn, table, new_name, drop_columns=(), extra_constraints=(), omit_unique_cols=()):
    """Rebuild DDL from live PRAGMA metadata so unknown legacy columns/FKs/unique constraints survive."""
    cols = conn.execute(f'PRAGMA table_info("{table}")').fetchall()  # cid,name,type,notnull,dflt,pk
    pk_cols = [c for c in cols if c[5]]
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    autoinc = bool(row and row[0] and "AUTOINCREMENT" in row[0].upper())
    parts = []
    for _cid, name, ctype, notnull, dflt, pk in cols:
        if name in drop_columns:
            continue
        piece = f"{_q(name)} {ctype or ''}".strip()
        if len(pk_cols) == 1 and pk:
            piece += " PRIMARY KEY" + (" AUTOINCREMENT" if autoinc else "")
        elif notnull:
            piece += " NOT NULL"
        if dflt is not None:
            piece += f" DEFAULT {dflt}"
        parts.append(piece)
    if len(pk_cols) > 1:
        parts.append("PRIMARY KEY (" + ", ".join(_q(c[1]) for c in sorted(pk_cols, key=lambda c: c[5])) + ")")
    # Preserve table-level UNIQUE constraints (autoindexes, origin 'u') other than the ones being replaced.
    for _name, origin, ucols in _sq_unique_indexes(conn, table):
        if origin == "u" and ucols and not any(c in drop_columns for c in ucols) and ucols not in [list(o) for o in omit_unique_cols]:
            parts.append("UNIQUE (" + ", ".join(_q(c) for c in ucols) + ")")
    fks = {}
    for fk in conn.execute(f'PRAGMA foreign_key_list("{table}")').fetchall():
        fks.setdefault(fk[0], []).append(fk)
    for group in fks.values():
        group.sort(key=lambda f: f[1])
        if any(f[3] in drop_columns for f in group):
            continue
        clause = f"FOREIGN KEY ({', '.join(_q(f[3]) for f in group)}) REFERENCES {_q(group[0][2])}"
        if all(f[4] for f in group):
            clause += f" ({', '.join(_q(f[4]) for f in group)})"
        if group[0][6] and group[0][6] != "NO ACTION":
            clause += f" ON DELETE {group[0][6]}"
        if group[0][5] and group[0][5] != "NO ACTION":
            clause += f" ON UPDATE {group[0][5]}"
        parts.append(clause)
    parts.extend(extra_constraints)
    return f"CREATE TABLE {_q(new_name)} (\n  " + ",\n  ".join(parts) + "\n)"


def _sq_recreate_table(conn, table, drop_columns=(), extra_constraints=(), omit_unique_cols=(), index_filter=None):
    """SQLite table rebuild. Caller owns the transaction and has turned foreign_keys OFF. Returns (before, after)."""
    tmp = f"{table}__new"
    saved_indexes = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", (table,)
    ).fetchall()
    conn.execute(f"DROP TABLE IF EXISTS {_q(tmp)}")
    conn.execute(_sq_create_table_sql(conn, table, tmp, drop_columns, extra_constraints, omit_unique_cols))
    keep_cols = [c for c in _sq_columns(conn, table) if c not in drop_columns]
    col_list = ", ".join(_q(c) for c in keep_cols)
    conn.execute(f"INSERT INTO {_q(tmp)} ({col_list}) SELECT {col_list} FROM {_q(table)}")
    before = conn.execute(f"SELECT COUNT(*) FROM {_q(table)}").fetchone()[0]
    after = conn.execute(f"SELECT COUNT(*) FROM {_q(tmp)}").fetchone()[0]
    if before != after:
        raise MigrationError(f"Row count mismatch while rebuilding {table}: {before} != {after}")
    conn.execute(f"DROP TABLE {_q(table)}")
    conn.execute(f"ALTER TABLE {_q(tmp)} RENAME TO {_q(table)}")
    for name, sql in saved_indexes:
        if index_filter is None or index_filter(name, sql):
            conn.execute(sql)
    return before, after


def _sq_add_missing_columns(conn, table, specs):
    existing = set(_sq_columns(conn, table))
    for name, sqlite_ddl, _mysql in specs:
        if name not in existing:
            conn.execute(f"ALTER TABLE {_q(table)} ADD COLUMN {_q(name)} {sqlite_ddl}")


def _sq_ensure_recruitment_tables(conn):
    from sqlalchemy.dialects import sqlite as sqlite_dialect
    ddl = _model_ddl(sqlite_dialect.dialect())
    tables = _sq_tables(conn)
    for name in RECRUITMENT_TABLES:
        create_sql, idx_sql = ddl[name]
        if name not in tables:
            conn.execute(create_sql)
        for idx_name, sql in idx_sql.items():
            if not _sq_index_exists(conn, idx_name):
                conn.execute(sql)


def _sq_ensure_core_indexes(conn):
    from sqlalchemy.dialects import sqlite as sqlite_dialect
    from sqlalchemy.schema import CreateIndex
    import models
    for tname in ("job_descriptions", "roleready_sessions"):
        cols = set(_sq_columns(conn, tname))
        for ix in models.Base.metadata.tables[tname].indexes:
            if all(c.name in cols for c in ix.columns) and not _sq_index_exists(conn, ix.name):
                conn.execute(str(CreateIndex(ix).compile(dialect=sqlite_dialect.dialect())).strip())


OWNED_TABLES = ("candidates", "candidate_invitations", "roleready_sessions", "candidate_registrations")


def _fk_violations(conn):
    """Set of (table, rowid, parent_table, fk_id) from PRAGMA foreign_key_check."""
    return {tuple(r) for r in conn.execute("PRAGMA foreign_key_check").fetchall()}


def _owned(violations):
    return {v for v in violations if v[0] in OWNED_TABLES or v[2] == "candidates"}


def sqlite_migrate(db_path, fail_hook=None):
    """
    The 18-step atomic sequence from plan section 8. `fail_hook(step_number)` is a test seam used to
    simulate a crash mid-transaction; any exception triggers a full ROLLBACK.
    """
    def hook(step):
        if fail_hook:
            fail_hook(step)

    conn = sqlite3.connect(db_path, isolation_level=None)  # manual transaction control
    try:
        tables = _sq_tables(conn)
        if "candidates" not in tables:
            raise MigrationError("candidates table is missing; use the fresh-install path.")

        if HISTORY_TABLE in tables and conn.execute(
                f"SELECT 1 FROM {HISTORY_TABLE} WHERE name = ?", (PHASE_SCHEMA,)).fetchone():
            _log("Schema phase already recorded; running post-commit checks only.")
            if _owned(_fk_violations(conn)):
                raise MigrationError("foreign_key_check reports violations on already-migrated database.")
            if conn.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise MigrationError("integrity_check failed on already-migrated database.")
            return {"already_applied": True}

        # Step 1: pre-check. Violations on the tables this migration owns abort it. Pre-existing dangling
        # references in unrelated tables are reported and become the baseline the migration may not worsen.
        baseline_fk = _fk_violations(conn)
        if _owned(baseline_fk):
            raise MigrationError(f"Pre-migration foreign_key_check found {len(_owned(baseline_fk))} violation(s) on "
                                 f"candidate-related tables; aborting. First: {sorted(_owned(baseline_fk))[:3]}")
        if baseline_fk:
            tables = sorted({v[0] for v in baseline_fk})
            _log(f"WARNING: {len(baseline_fk)} pre-existing foreign-key violation(s) in unrelated tables {tables}; "
                 "they are left untouched and used as the baseline.")
        hook(1)
        # Step 2: child FK inventory
        _log(f"Child foreign keys referencing candidates: {_sq_child_fk_inventory(conn)}")
        hook(2)
        # Step 3: baseline counts
        before_counts = {t: _sqlite_count(conn, t) for t in BACKUP_COUNT_TABLES}
        hook(3)
        # Step 4: foreign keys OFF, strictly outside any transaction
        conn.execute("PRAGMA foreign_keys = OFF")
        hook(4)
        conn.execute("BEGIN EXCLUSIVE TRANSACTION")
        try:
            hook(5)
            conn.execute("DROP TABLE IF EXISTS candidates__new")  # step 5
            unique = _sq_unique_indexes(conn, "candidates")
            legacy_names = {n for n, _o, cols in unique if cols == ["email"]}
            has_composite = any(cols == ["organization_id", "email"] for _n, _o, cols in unique)
            hook(6)
            if legacy_names or not has_composite:  # steps 6-10: rebuild without column-level UNIQUE(email)
                extra = [] if has_composite else ["CONSTRAINT uix_org_candidate_email UNIQUE (organization_id, email)"]
                _sq_recreate_table(
                    conn, "candidates", extra_constraints=extra,
                    omit_unique_cols=[["email"]],
                    index_filter=lambda name, sql: name not in legacy_names and name != "uix_org_cand_norm_email",
                )
            hook(10)
            # Step 11: standard + functional expression indexes
            conn.execute("CREATE INDEX IF NOT EXISTS ix_candidates_email ON candidates(email)")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_candidates_organization_id ON candidates(organization_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_candidates_id ON candidates(id)")
            if not _sq_index_exists(conn, "uix_org_cand_norm_email"):
                conn.execute("CREATE UNIQUE INDEX uix_org_cand_norm_email ON candidates(organization_id, (LOWER(TRIM(email))))")
            hook(11)
            # Step 12: job_descriptions columns
            _sq_add_missing_columns(conn, "job_descriptions", JOB_DESCRIPTION_COLUMNS)
            hook(12)
            # candidate_registrations must exist before roleready_sessions.registration_id references it
            _sq_ensure_recruitment_tables(conn)
            # Step 13: roleready_sessions columns
            _sq_add_missing_columns(conn, "roleready_sessions", SESSION_COLUMNS)
            hook(13)
            # Step 14: remaining tables + unique indexes (share_token, registration_id, norm-email registrations)
            _sq_ensure_core_indexes(conn)
            hook(14)
            # Step 15: intra-transaction FK validation
            bad = _fk_violations(conn) - baseline_fk
            if bad:
                raise MigrationError(f"foreign_key_check found {len(bad)} new violation(s) before commit: {sorted(bad)[:3]}")
            hook(15)
            # Step 16: history
            conn.execute(f"CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} "
                         "(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL, applied_at TEXT NOT NULL)")
            conn.execute(f"INSERT OR IGNORE INTO {HISTORY_TABLE} (name, status, applied_at) VALUES (?, 'applied', ?)",
                         (PHASE_SCHEMA, _now_iso()))
            hook(16)
            for t, expected in before_counts.items():
                actual = _sqlite_count(conn, t)
                if actual != expected:
                    raise MigrationError(f"Row count changed for {t}: {expected} -> {actual}")
            conn.execute("COMMIT")  # step 17
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON")
        # Step 18: post-commit verification
        if _fk_violations(conn) - baseline_fk:
            raise MigrationError("Post-commit foreign_key_check reported new violations. " + POST_COMMIT_RECOVERY)
        if conn.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise MigrationError("Post-commit integrity_check failed. " + POST_COMMIT_RECOVERY)
        return {"already_applied": False, "counts": before_counts}
    finally:
        conn.close()


# ==============================================================================
# MySQL migration (guarded, idempotent DDL; MySQL DDL auto-commits so each step is individually safe)
# ==============================================================================
def parse_mysql_version(version_string):
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", version_string or "")
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def mysql_supports_functional_index(version_string):
    if "mariadb" in (version_string or "").lower():
        return False
    return parse_mysql_version(version_string) >= (8, 0, 13)


def mysql_migrate(engine):
    from sqlalchemy import inspect, text
    from sqlalchemy.dialects import mysql as mysql_dialect
    import models

    with engine.begin() as conn:
        version = conn.execute(text("SELECT VERSION()")).scalar()
        tz = conn.execute(text("SELECT @@session.time_zone")).scalar()
        _log(f"MySQL version {version}; session time_zone={tz}")
    functional = mysql_supports_functional_index(version)

    def stats(conn, table):
        rows = conn.execute(text(
            "SELECT index_name, non_unique, column_name FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = :t ORDER BY index_name, seq_in_index"), {"t": table}).fetchall()
        idx = {}
        for name, non_unique, col in rows:
            entry = idx.setdefault(name, {"unique": not non_unique, "cols": []})
            entry["cols"].append(col)
        return idx

    def ensure_normalized_unique(conn, table, lead_col, index_name):
        if index_name in stats(conn, table):
            return
        if functional:
            conn.execute(text(f"CREATE UNIQUE INDEX {index_name} ON {table} ({lead_col}, ((LOWER(TRIM(email)))))"))
        else:
            cols = {c["name"] for c in inspect(conn).get_columns(table)}
            if "normalized_email" not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN normalized_email VARCHAR(150) "
                                  "GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED"))
            conn.execute(text(f"CREATE UNIQUE INDEX {index_name} ON {table} ({lead_col}, normalized_email)"))

    with engine.begin() as conn:
        for name, info in stats(conn, "candidates").items():
            if info["unique"] and info["cols"] == ["email"] and name != "PRIMARY":
                _log(f"Dropping legacy global unique index {name}")
                conn.execute(text(f"ALTER TABLE candidates DROP INDEX `{name}`"))
        idx = stats(conn, "candidates")
        if "ix_candidates_email" not in idx:
            conn.execute(text("CREATE INDEX ix_candidates_email ON candidates (email)"))
        if "uix_org_candidate_email" not in idx:
            conn.execute(text("ALTER TABLE candidates ADD CONSTRAINT uix_org_candidate_email UNIQUE (organization_id, email)"))
        ensure_normalized_unique(conn, "candidates", "organization_id", "uix_org_cand_norm_email")

    with engine.begin() as conn:
        jd_cols = {c["name"] for c in inspect(conn).get_columns("job_descriptions")}
        for name, _sqlite, mysql_ddl in JOB_DESCRIPTION_COLUMNS:
            if name not in jd_cols:
                conn.execute(text(f"ALTER TABLE job_descriptions ADD COLUMN `{name}` {mysql_ddl}"))

        ddl = _model_ddl(mysql_dialect.dialect(), skip_functional=not functional)
        existing_tables = set(inspect(conn).get_table_names())
        for name in RECRUITMENT_TABLES:
            create_sql, idx_sql = ddl[name]
            if name not in existing_tables:
                conn.execute(text(create_sql))
            have = stats(conn, name)
            for idx_name, sql in idx_sql.items():
                if idx_name not in have:
                    conn.execute(text(sql))
        ensure_normalized_unique(conn, "candidate_registrations", "job_description_id", "uix_jd_reg_norm_email")

        sess_cols = {c["name"] for c in inspect(conn).get_columns("roleready_sessions")}
        for name, _sqlite, mysql_ddl in SESSION_COLUMNS:
            if name not in sess_cols:
                conn.execute(text(f"ALTER TABLE roleready_sessions ADD COLUMN `{name}` {mysql_ddl}"))
        fk_names = {fk.get("name") for fk in inspect(conn).get_foreign_keys("roleready_sessions")}
        if "fk_roleready_sessions_registration" not in fk_names:
            conn.execute(text("ALTER TABLE roleready_sessions ADD CONSTRAINT fk_roleready_sessions_registration "
                              "FOREIGN KEY (registration_id) REFERENCES candidate_registrations (id) ON DELETE SET NULL"))
        from sqlalchemy.schema import CreateIndex
        for tname in ("job_descriptions", "roleready_sessions"):
            have = stats(conn, tname)
            for ix in models.Base.metadata.tables[tname].indexes:
                if ix.name not in have:
                    conn.execute(text(str(CreateIndex(ix).compile(dialect=mysql_dialect.dialect()))))

        conn.execute(text(f"CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} "
                          "(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, status VARCHAR(30) NOT NULL, applied_at VARCHAR(40) NOT NULL)"))
        conn.execute(text(f"INSERT IGNORE INTO {HISTORY_TABLE} (name, status, applied_at) VALUES (:n, 'applied', :t)"),
                     {"n": PHASE_SCHEMA, "t": _now_iso()})


# ==============================================================================
# Phase 4 - post-migration verification (always rolled back)
# ==============================================================================
def verify_migration(engine):
    """
    Runs inside one transaction that is ALWAYS rolled back, so no test rows persist. Returns a list of
    (test_name, passed); raises MigrationError if any test fails.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    import models

    results = []

    def expect_ok(name, fn):
        try:
            fn()
            results.append((name, True))
        except Exception as exc:
            results.append((f"{name}: unexpected {type(exc).__name__}: {exc}", False))

    def expect_integrity(name, fn):
        try:
            fn()
            results.append((f"{name}: expected IntegrityError but the insert succeeded", False))
        except IntegrityError:
            results.append((name, True))

    cand = models.Candidate.__table__
    reg = models.CandidateRegistration.__table__
    sess = models.RoleReadySession.__table__
    org = models.Organization.__table__
    jd = models.JobDescription.__table__
    tag = uuid.uuid4().hex[:8]

    conn = engine.connect()
    trans = conn.begin()
    try:
        org_a = conn.execute(org.insert().values(name=f"verify-a-{tag}", slug=f"verify-a-{tag}", status="active")).inserted_primary_key[0]
        org_b = conn.execute(org.insert().values(name=f"verify-b-{tag}", slug=f"verify-b-{tag}", status="active")).inserted_primary_key[0]
        jd_id = conn.execute(jd.insert().values(title="verify", description="verify", organization_id=org_a)).inserted_primary_key[0]

        def ins_cand(org_id, email):
            conn.execute(cand.insert().values(name="v", email=email, role="x", organization_id=org_id))

        expect_ok("T1 candidate in org A", lambda: ins_cand(org_a, "test@example.com"))
        expect_ok("T2 same email in org B (cross-tenant allowed)", lambda: ins_cand(org_b, "test@example.com"))
        expect_integrity("T3 exact duplicate in org A rejected", lambda: ins_cand(org_a, "test@example.com"))
        expect_integrity("T4 normalized duplicate rejected by functional index", lambda: ins_cand(org_a, "  Test@Example.COM  "))

        def ins_reg(email):
            return conn.execute(reg.insert().values(
                registration_token_hash="t" * 64, job_description_id=jd_id, organization_id=org_a,
                name="v", phone="+10000000000", email=email, status="REGISTERED")).inserted_primary_key[0]

        holder = {}

        def first_reg():
            holder["reg_id"] = ins_reg("reg@example.com")

        expect_ok("T5a registration insert", first_reg)
        expect_integrity("T5b registration normalized duplicate rejected", lambda: ins_reg(" REG@Example.com "))

        def ins_session(suffix):
            conn.execute(sess.insert().values(
                session_uuid=f"verify-{tag}-{suffix}", workflow_type="RECRUITMENT_ASSESSMENT", organization_id=org_a,
                registration_id=holder["reg_id"], target_role="v", current_state="APTITUDE_IN_PROGRESS"))

        expect_ok("T6a first session for registration", lambda: ins_session("a"))
        expect_integrity("T6b second session for the same registration rejected", lambda: ins_session("b"))

        if engine.dialect.name == "sqlite":
            bad = {tuple(r) for r in conn.execute(text("PRAGMA foreign_key_check")).fetchall()}
            results.append(("T7 foreign_key_check clean on candidate-related tables (child FKs intact)", not _owned(bad)))
    finally:
        trans.rollback()
        conn.close()

    failures = [n for n, ok in results if not ok]
    if failures:
        raise MigrationError("Post-migration verification failed: " + "; ".join(failures))
    _log(f"Post-migration verification passed ({len(results)} checks, all rolled back).")
    return results


def record_verified(engine):
    from sqlalchemy import text
    verb = "INSERT OR IGNORE" if engine.dialect.name == "sqlite" else "INSERT IGNORE"
    with engine.begin() as conn:
        conn.execute(text(f"{verb} INTO {HISTORY_TABLE} (name, status, applied_at) VALUES (:n, 'verified', :t)"),
                     {"n": PHASE_VERIFIED, "t": _now_iso()})


# ==============================================================================
# Rollback
# ==============================================================================
def rollback_preconditions(engine):
    """Returns a list of blocking reasons (empty list means rollback is allowed)."""
    from sqlalchemy import inspect, text
    reasons = []
    insp = inspect(engine)
    with engine.connect() as conn:
        collisions = conn.execute(text(
            "SELECT LOWER(TRIM(email)), COUNT(*) FROM candidates GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1")).fetchall()
        if collisions:
            reasons.append(f"{len(collisions)} cross-organization normalized email collision(s) exist; restoring global uniqueness would fail.")
        if insp.has_table("candidate_registrations"):
            n = conn.execute(text("SELECT COUNT(*) FROM candidate_registrations")).scalar()
            if n:
                reasons.append(f"candidate_registrations holds {n} live row(s).")
        if insp.has_table("roleready_sessions"):
            n = conn.execute(text("SELECT COUNT(*) FROM roleready_sessions WHERE workflow_type = 'RECRUITMENT_ASSESSMENT'")).scalar()
            if n:
                reasons.append(f"{n} live RECRUITMENT_ASSESSMENT session(s) exist.")
    return reasons


def sqlite_rollback(db_path):
    conn = sqlite3.connect(db_path, isolation_level=None)
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN EXCLUSIVE TRANSACTION")
        try:
            for ix in ("uix_org_cand_norm_email", "uix_jd_reg_norm_email"):
                conn.execute(f"DROP INDEX IF EXISTS {ix}")
            session_cols = set(_sq_columns(conn, "roleready_sessions"))
            drop_sess = [c for c, _s, _m in SESSION_COLUMNS if c in session_cols]
            if drop_sess:
                _sq_recreate_table(conn, "roleready_sessions", drop_columns=drop_sess,
                                   index_filter=lambda name, sql: name not in SESSION_NEW_INDEXES)
            for t in RECRUITMENT_TABLES:
                conn.execute(f"DROP TABLE IF EXISTS {t}")
            jd_cols = set(_sq_columns(conn, "job_descriptions"))
            drop_jd = [c for c, _s, _m in JOB_DESCRIPTION_COLUMNS if c in jd_cols]
            if drop_jd:
                _sq_recreate_table(conn, "job_descriptions", drop_columns=drop_jd,
                                   index_filter=lambda name, sql: "share_token" not in sql)
            _sq_recreate_table(conn, "candidates", omit_unique_cols=[["organization_id", "email"]],
                               index_filter=lambda name, sql: name not in ("uix_org_cand_norm_email", "ix_candidates_email"))
            conn.execute("CREATE UNIQUE INDEX ix_candidates_email ON candidates(email)")
            if HISTORY_TABLE in _sq_tables(conn):
                conn.execute(f"DELETE FROM {HISTORY_TABLE} WHERE name IN (?, ?)", (PHASE_SCHEMA, PHASE_VERIFIED))
            if _owned(_fk_violations(conn)):
                raise MigrationError("foreign_key_check failed during rollback; rolled back.")
            conn.execute("COMMIT")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON")
    finally:
        conn.close()


def mysql_rollback(engine):
    from sqlalchemy import inspect, text
    with engine.begin() as conn:
        insp = inspect(conn)
        sess_cols = {c["name"] for c in insp.get_columns("roleready_sessions")}
        for fk in insp.get_foreign_keys("roleready_sessions"):
            if "registration_id" in fk["constrained_columns"] and fk.get("name"):
                conn.execute(text(f"ALTER TABLE roleready_sessions DROP FOREIGN KEY `{fk['name']}`"))
        for ix in inspect(conn).get_indexes("roleready_sessions"):
            if set(ix["column_names"]) & {c for c, _s, _m in SESSION_COLUMNS}:
                conn.execute(text(f"ALTER TABLE roleready_sessions DROP INDEX `{ix['name']}`"))
        for col, _s, _m in SESSION_COLUMNS:
            if col in sess_cols:
                conn.execute(text(f"ALTER TABLE roleready_sessions DROP COLUMN `{col}`"))
        for tname in RECRUITMENT_TABLES:
            conn.execute(text(f"DROP TABLE IF EXISTS {tname}"))
        insp = inspect(conn)
        jd_cols = {c["name"] for c in insp.get_columns("job_descriptions")}
        for ix in insp.get_indexes("job_descriptions"):
            if "share_token" in ix["column_names"]:
                conn.execute(text(f"ALTER TABLE job_descriptions DROP INDEX `{ix['name']}`"))
        for col, _s, _m in JOB_DESCRIPTION_COLUMNS:
            if col in jd_cols:
                conn.execute(text(f"ALTER TABLE job_descriptions DROP COLUMN `{col}`"))
        cand_idx = {i["name"] for i in inspect(conn).get_indexes("candidates")}
        for name in ("uix_org_cand_norm_email", "uix_org_candidate_email", "ix_candidates_email"):
            if name in cand_idx:
                conn.execute(text(f"ALTER TABLE candidates DROP INDEX `{name}`"))
        if "normalized_email" in {c["name"] for c in inspect(conn).get_columns("candidates")}:
            conn.execute(text("ALTER TABLE candidates DROP COLUMN normalized_email"))
        conn.execute(text("CREATE UNIQUE INDEX ix_candidates_email ON candidates (email)"))
        conn.execute(text(f"DELETE FROM {HISTORY_TABLE} WHERE name IN (:a, :b)"), {"a": PHASE_SCHEMA, "b": PHASE_VERIFIED})


# ==============================================================================
# Orchestration
# ==============================================================================
def _make_engine(url):
    from sqlalchemy import create_engine
    kwargs = {"connect_args": {"check_same_thread": False}} if is_sqlite_url(url) else {"pool_pre_ping": True}
    return create_engine(url, **kwargs)


def _record_fresh_history(url, engine):
    from sqlalchemy import text
    if is_sqlite_url(url):
        conn = sqlite3.connect(sqlite_path_from_url(url), isolation_level=None)
        try:
            conn.execute(f"CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} "
                         "(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL, applied_at TEXT NOT NULL)")
            conn.execute(f"INSERT OR IGNORE INTO {HISTORY_TABLE} (name, status, applied_at) VALUES (?, 'applied', ?)",
                         (PHASE_SCHEMA, _now_iso()))
        finally:
            conn.close()
    else:
        with engine.begin() as conn:
            conn.execute(text(f"CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} "
                              "(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, status VARCHAR(30) NOT NULL, applied_at VARCHAR(40) NOT NULL)"))
            conn.execute(text(f"INSERT IGNORE INTO {HISTORY_TABLE} (name, status, applied_at) VALUES (:n, 'applied', :t)"),
                         {"n": PHASE_SCHEMA, "t": _now_iso()})


def run(database_url, backup_dir=None, conflicts_path=DEFAULT_CONFLICTS_FILE, rollback=False, mysql_runner=subprocess.run):
    from sqlalchemy import inspect, text
    engine = _make_engine(database_url)
    sqlite_mode = is_sqlite_url(database_url)
    try:
        if rollback:
            reasons = rollback_preconditions(engine)
            if reasons:
                raise MigrationError("Rollback blocked: " + " | ".join(reasons) +
                                     " Recovery: export recruitment data to JSON, quarantine conflicting records, apply forward patches.")
            if sqlite_mode:
                path = sqlite_path_from_url(database_url)
                sqlite_backup_and_verify(path, backup_dir)
                engine.dispose()
                sqlite_rollback(path)
            else:
                mysql_backup_and_verify(engine, backup_dir, mysql_runner)
                mysql_rollback(engine)
            _log("Rollback complete.")
            return 0

        if not inspect(engine).has_table("candidates"):
            import models
            models.Base.metadata.create_all(bind=engine)
            _record_fresh_history(database_url, engine)
            _log("Fresh installation: schema created natively from models.")
        else:
            # Phase 1: backup (strict gate - any failure aborts before the schema is touched)
            if sqlite_mode:
                sqlite_backup_and_verify(sqlite_path_from_url(database_url), backup_dir)
            else:
                mysql_backup_and_verify(engine, backup_dir, mysql_runner)

            # Phase 2: preflight
            def fetchall(sql, params):
                if sqlite_mode:
                    c = sqlite3.connect(sqlite_path_from_url(database_url))
                    try:
                        return c.execute(sql, params).fetchall()
                    finally:
                        c.close()
                with engine.connect() as c:
                    return c.execute(text(sql), params).fetchall()

            run_preflight(fetchall, conflicts_path)

            # Phase 3
            if sqlite_mode:
                engine.dispose()
                sqlite_migrate(sqlite_path_from_url(database_url))
            else:
                mysql_migrate(engine)

        # Phase 4 (the schema is committed by now, so a failure here needs recovery, not an automatic rollback)
        engine.dispose()
        engine = _make_engine(database_url)
        try:
            verify_migration(engine)
        except MigrationError as exc:
            raise MigrationError(f"{exc} {POST_COMMIT_RECOVERY}")
        record_verified(engine)
        _log("Migration SUCCESS (recorded as verified only after verification passed).")
        return 0
    finally:
        engine.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description="PrepWin recruitment workflow migration")
    parser.add_argument("--database-url", default=None, help="Defaults to the application's DATABASE_URL")
    parser.add_argument("--backup-dir", default=None)
    parser.add_argument("--conflicts-file", default=DEFAULT_CONFLICTS_FILE)
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args(argv)

    url = args.database_url
    if not url:
        import database
        url = database.SQLALCHEMY_DATABASE_URL
    try:
        return run(url, backup_dir=args.backup_dir, conflicts_path=args.conflicts_file, rollback=args.rollback)
    except MigrationError as exc:  # includes PreflightConflictError
        print(f"[ABORT] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
