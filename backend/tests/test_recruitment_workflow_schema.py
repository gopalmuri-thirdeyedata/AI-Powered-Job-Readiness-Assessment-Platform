import pytest
from sqlalchemy.exc import IntegrityError
from main import app
import models, database, utils

@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()

def test_job_description_schema_supports_public_workflow(db_session):
    # Verify JobDescription has share_token, is_published, status, blueprint_data
    assert hasattr(models.JobDescription, "share_token")
    assert hasattr(models.JobDescription, "is_published")
    assert hasattr(models.JobDescription, "status")
    assert hasattr(models.JobDescription, "blueprint_data")
    assert hasattr(models.JobDescription, "blueprint_version")

def test_candidate_registration_model_exists(db_session):
    # Verify CandidateRegistration model exists
    assert hasattr(models, "CandidateRegistration")
    assert hasattr(models.CandidateRegistration, "job_description_id")
    assert hasattr(models.CandidateRegistration, "organization_id")
    assert hasattr(models.CandidateRegistration, "name")
    assert hasattr(models.CandidateRegistration, "phone")
    assert hasattr(models.CandidateRegistration, "email")
    assert hasattr(models.CandidateRegistration, "status")

def test_multitenant_candidate_email_composite_constraint(db_session):
    # Ensure two different organizations can have a candidate with the same email
    org1 = db_session.query(models.Organization).filter_by(slug="schema-test-org-1").first()
    if not org1:
        org1 = models.Organization(name="Schema Test Org 1", slug="schema-test-org-1", status="active")
        db_session.add(org1)
        db_session.commit()
        db_session.refresh(org1)

    org2 = db_session.query(models.Organization).filter_by(slug="schema-test-org-2").first()
    if not org2:
        org2 = models.Organization(name="Schema Test Org 2", slug="schema-test-org-2", status="active")
        db_session.add(org2)
        db_session.commit()
        db_session.refresh(org2)

    shared_email = "alex.rivera@example.com"

    cand1 = db_session.query(models.Candidate).filter_by(organization_id=org1.id, email=shared_email).first()
    if not cand1:
        cand1 = models.Candidate(name="Alex Rivera", email=shared_email, role="Dev", organization_id=org1.id)
        db_session.add(cand1)
        db_session.commit()

    # Same email in Org 2 must succeed!
    cand2 = db_session.query(models.Candidate).filter_by(organization_id=org2.id, email=shared_email).first()
    if not cand2:
        cand2 = models.Candidate(name="Alex Rivera", email=shared_email, role="Dev", organization_id=org2.id)
        db_session.add(cand2)
        db_session.commit()

    assert cand1.id != cand2.id
    assert cand1.email == cand2.email
    assert cand1.organization_id != cand2.organization_id


# ==============================================================================
# Migration safety (plan Task 3). Uses throwaway SQLite files built in the LEGACY shape.
# ==============================================================================
import json as _json
import os as _os
import shutil as _shutil
import sqlite3 as _sqlite3
import types as _types

import migrate_recruitment_workflow as mig
from sqlalchemy import create_engine as _create_engine, text as _text


def _make_legacy_db(path):
    """Current schema -> guarded rollback -> the pre-feature shape (global UNIQUE email, no recruitment columns)."""
    eng = _create_engine(f"sqlite:///{path}")
    models.Base.metadata.create_all(bind=eng)
    eng.dispose()
    mig.sqlite_rollback(path)
    conn = _sqlite3.connect(path)
    try:
        assert "candidate_registrations" not in {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
        uniq = mig._sq_unique_indexes(conn, "candidates")
        assert any(cols == ["email"] for _n, _o, cols in uniq), "legacy fixture must have the global UNIQUE(email)"
        assert not any(cols == ["organization_id", "email"] for _n, _o, cols in uniq)
        assert "registration_id" not in mig._sq_columns(conn, "roleready_sessions")
        assert "share_token" not in mig._sq_columns(conn, "job_descriptions")
    finally:
        conn.close()


def _seed_legacy(path, extra_candidates=()):
    eng = _create_engine(f"sqlite:///{path}")
    with eng.begin() as c:
        o1 = c.execute(models.Organization.__table__.insert().values(name="L1", slug="l1", status="active")).inserted_primary_key[0]
        o2 = c.execute(models.Organization.__table__.insert().values(name="L2", slug="l2", status="active")).inserted_primary_key[0]
        cand_t = models.Candidate.__table__
        ids = []
        for org, email in [(o1, "Bob@Legacy.com"), (o1, "carol@legacy.com"), (o2, "dave@legacy.com"), *extra_candidates]:
            ids.append(c.execute(cand_t.insert().values(name="n", email=email, role="r", organization_id=org)).inserted_primary_key[0])
        inv_t = models.CandidateInvitation.__table__
        for cid in ids[:2]:
            c.execute(inv_t.insert().values(organization_id=o1, candidate_id=cid, invitation_token=f"tok-{cid}", expires_at=datetime.utcnow()))
        sess_t = models.RoleReadySession.__table__
        for cid in ids[:2]:
            c.execute(sess_t.insert().values(session_uuid=f"legacy-{cid}", workflow_type="RECRUITER_INVITATION", organization_id=o1,
                                             candidate_id=cid, target_role="r", current_state="COMPLETED"))
    eng.dispose()
    return ids


from datetime import datetime  # noqa: E402


def _dump(path, only=None):
    """{table: sorted row dicts}; `only` restricts each table to the given column names (to compare across added columns)."""
    conn = _sqlite3.connect(path)
    conn.row_factory = _sqlite3.Row
    try:
        out = {}
        for t in ("organizations", "candidates", "candidate_invitations", "roleready_sessions"):
            rows = [dict(r) for r in conn.execute(f'select * from "{t}"')]
            if only is not None:
                rows = [{k: v for k, v in r.items() if k in only[t]} for r in rows]
            out[t] = sorted(rows, key=repr)
        return out
    finally:
        conn.close()


def _cols(dump):
    return {t: set(rows[0].keys()) if rows else set() for t, rows in dump.items()}


def _schema(path):
    conn = _sqlite3.connect(path)
    try:
        return sorted(conn.execute("select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%'").fetchall(), key=repr)
    finally:
        conn.close()


@pytest.fixture
def legacy(tmp_path):
    path = str(tmp_path / "legacy.db")
    _make_legacy_db(path)
    ids = _seed_legacy(path)
    return {"path": path, "url": f"sqlite:///{path}", "ids": ids, "dir": tmp_path}


def _run(legacy, **kw):
    return mig.run(legacy["url"], backup_dir=str(legacy["dir"] / "bk"), conflicts_path=str(legacy["dir"] / "conflicts.json"), **kw)


def test_sqlite_single_atomic_transaction_migration_with_child_fk_fixtures(legacy):
    before = _dump(legacy["path"])
    assert _run(legacy) == 0

    after = _dump(legacy["path"], only=_cols(before))
    assert after == before  # every row (incl. mixed-case historical emails) byte-identical: zero historical mutation
    conn = _sqlite3.connect(legacy["path"])
    try:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert {r[2] for r in conn.execute("PRAGMA foreign_key_list(candidate_invitations)") if r[3] == "candidate_id"} == {"candidates"}
        assert {r[2] for r in conn.execute("PRAGMA foreign_key_list(roleready_sessions)") if r[3] == "candidate_id"} == {"candidates"}
        sql = {r[0]: r[1] for r in conn.execute("select name, sql from sqlite_master where type='index'")}
        assert "lower(trim(email))" in sql["uix_org_cand_norm_email"].lower().replace(" ", "")
        assert "uix_jd_reg_norm_email" in sql and "ix_roleready_sessions_registration_id" in sql and "ix_job_descriptions_share_token" in sql
        assert not any(cols == ["email"] for _n, _o, cols in mig._sq_unique_indexes(conn, "candidates"))
        assert conn.execute("select name, status from _prepwin_migration_history order by id").fetchall() == [
            (mig.PHASE_SCHEMA, "applied"), (mig.PHASE_VERIFIED, "verified")]
        # ON DELETE CASCADE still works end to end after the table rebuild
        conn.execute("PRAGMA foreign_keys = ON")
        cid = legacy["ids"][0]
        conn.execute("delete from candidates where id = ?", (cid,))
        assert conn.execute("select count(*) from candidate_invitations where candidate_id = ?", (cid,)).fetchone()[0] == 0
        assert conn.execute("select count(*) from roleready_sessions where candidate_id = ?", (cid,)).fetchone()[0] == 0
        conn.rollback()
    finally:
        conn.close()
    assert any(f.startswith("legacy.db.bak_") for f in _os.listdir(legacy["dir"] / "bk"))  # verified backup was taken first


@pytest.mark.parametrize("fail_step", [5, 6, 10, 11, 12, 13, 14, 15, 16])
def test_sqlite_migration_rolls_back_100_percent_on_failure(legacy, fail_step):
    schema_before, rows_before = _schema(legacy["path"]), _dump(legacy["path"])

    def boom(step):
        if step == fail_step:
            raise RuntimeError(f"simulated crash at step {step}")

    with pytest.raises(RuntimeError):
        mig.sqlite_migrate(legacy["path"], fail_hook=boom)

    assert _schema(legacy["path"]) == schema_before  # no candidates__new, no new columns, no history table: zero split-brain
    assert _dump(legacy["path"], only=_cols(rows_before)) == rows_before
    assert _run(legacy) == 0  # and a clean re-run from the original state succeeds


def test_preflight_conflict_and_blank_email_detection(tmp_path):
    path = str(tmp_path / "conflict.db")
    _make_legacy_db(path)
    _seed_legacy(path, extra_candidates=[(1, "  alice@legacy.com "), (1, "ALICE@legacy.com"), (2, "   "), (2, None)])
    legacy = {"path": path, "url": f"sqlite:///{path}", "dir": tmp_path}
    schema_before, rows_before = _schema(path), _dump(path)

    with pytest.raises(mig.PreflightConflictError):
        _run(legacy)
    report = _json.loads((tmp_path / "conflicts.json").read_text())
    groups = {g["normalized_email"]: g for g in report["normalized_collisions"]}
    assert "alice@legacy.com" in groups and groups["alice@legacy.com"]["count"] == 2
    assert {r["email"] for r in groups["alice@legacy.com"]["records"]} == {"  alice@legacy.com ", "ALICE@legacy.com"}
    assert len(report["blank_or_null_emails"]) == 2
    assert _schema(path) == schema_before and _dump(path) == rows_before  # zero data altered or renamed
    assert mig.main(["--database-url", legacy["url"], "--backup-dir", str(tmp_path / "bk"), "--conflicts-file", str(tmp_path / "c2.json")]) == 1


def test_blank_email_alone_aborts_migration(tmp_path):
    path = str(tmp_path / "blank.db")
    _make_legacy_db(path)
    _seed_legacy(path, extra_candidates=[(1, "  ")])
    with pytest.raises(mig.PreflightConflictError):
        mig.run(f"sqlite:///{path}", backup_dir=str(tmp_path / "bk"), conflicts_path=str(tmp_path / "c.json"))
    assert _json.loads((tmp_path / "c.json").read_text())["blank_or_null_emails"]


@pytest.fixture
def migrated(legacy):
    assert _run(legacy) == 0
    legacy["engine"] = _create_engine(legacy["url"])
    yield legacy
    legacy["engine"].dispose()


def test_functional_email_normalization_index(migrated):
    eng = migrated["engine"]
    cand = models.Candidate.__table__
    with eng.begin() as c:
        org_a = c.execute(models.Organization.__table__.insert().values(name="A", slug="fa", status="active")).inserted_primary_key[0]
        org_b = c.execute(models.Organization.__table__.insert().values(name="B", slug="fb", status="active")).inserted_primary_key[0]
        c.execute(cand.insert().values(name="x", email="test@example.com", role="r", organization_id=org_a))
        c.execute(cand.insert().values(name="x", email="TEST@example.com", role="r", organization_id=org_b))  # cross-org: allowed
    for variant in ("test@example.com", "TEST@EXAMPLE.COM", "  Test@Example.Com  "):
        with pytest.raises(IntegrityError):
            with eng.begin() as c:
                c.execute(cand.insert().values(name="y", email=variant, role="r", organization_id=org_a))
    # legacy rows with historical casing are found by the authoritative lookup and are never rewritten
    from sqlalchemy import func
    with eng.connect() as c:
        hit = c.execute(_text("select email from candidates where lower(trim(email)) = 'bob@legacy.com'")).fetchall()
        assert hit == [("Bob@Legacy.com",)]
    # ...and the index blocks a new row that collides with that historical value
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            org1 = c.execute(_text("select organization_id from candidates where email = 'Bob@Legacy.com'")).scalar()
            c.execute(cand.insert().values(name="z", email=" bob@legacy.COM", role="r", organization_id=org1))


def test_candidate_registration_uniqueness(migrated):
    eng = migrated["engine"]
    reg = models.CandidateRegistration.__table__
    with eng.begin() as c:
        org = c.execute(models.Organization.__table__.insert().values(name="R", slug="rr", status="active")).inserted_primary_key[0]
        jd1 = c.execute(models.JobDescription.__table__.insert().values(title="j1", description="d", organization_id=org)).inserted_primary_key[0]
        jd2 = c.execute(models.JobDescription.__table__.insert().values(title="j2", description="d", organization_id=org)).inserted_primary_key[0]

        def ins(jd, email, uuid_=None):
            return reg.insert().values(registration_token_hash="h" * 64, job_description_id=jd, organization_id=org, name="n",
                                       phone="+10000000000", email=email, attempt_session_uuid=uuid_)
        c.execute(ins(jd1, "same@example.com"))
        c.execute(ins(jd2, "same@example.com"))  # another assessment: allowed
    for variant in ("same@example.com", " SAME@Example.com "):
        with pytest.raises(IntegrityError):
            with eng.begin() as c:
                c.execute(ins(jd1, variant))
    with eng.begin() as c:
        c.execute(ins(jd1, "u1@example.com", "uuid-1"))
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(ins(jd1, "u2@example.com", "uuid-1"))  # attempt_session_uuid is UNIQUE


def test_single_attempt_db_constraint_enforcement(migrated):
    eng = migrated["engine"]
    sess, reg = models.RoleReadySession.__table__, models.CandidateRegistration.__table__
    with eng.begin() as c:
        org = c.execute(models.Organization.__table__.insert().values(name="S", slug="ss", status="active")).inserted_primary_key[0]
        jd = c.execute(models.JobDescription.__table__.insert().values(title="j", description="d", organization_id=org)).inserted_primary_key[0]
        rid = c.execute(reg.insert().values(registration_token_hash="h" * 64, job_description_id=jd, organization_id=org,
                                            name="n", phone="+10000000000", email="one@example.com")).inserted_primary_key[0]
        c.execute(sess.insert().values(session_uuid="s-1", workflow_type="RECRUITMENT_ASSESSMENT", registration_id=rid, target_role="r", current_state="APTITUDE_IN_PROGRESS"))
        c.execute(sess.insert().values(session_uuid="s-null-1", workflow_type="RECRUITMENT_ASSESSMENT", registration_id=None, target_role="r", current_state="ABANDONED"))
        c.execute(sess.insert().values(session_uuid="s-null-2", workflow_type="RECRUITMENT_ASSESSMENT", registration_id=None, target_role="r", current_state="ABANDONED"))  # NULLs never collide
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(sess.insert().values(session_uuid="s-2", workflow_type="RECRUITMENT_ASSESSMENT", registration_id=rid, target_role="r", current_state="APTITUDE_IN_PROGRESS"))


def test_migration_rerun_idempotency(legacy):
    assert _run(legacy) == 0
    snap = (_schema(legacy["path"]), _dump(legacy["path"]))
    for _ in range(2):
        assert _run(legacy) == 0
    assert (_schema(legacy["path"]), _dump(legacy["path"])) == snap


def test_fresh_database_installation(tmp_path):
    url = f"sqlite:///{tmp_path / 'fresh.db'}"
    assert mig.run(url, backup_dir=str(tmp_path / "bk"), conflicts_path=str(tmp_path / "c.json")) == 0
    conn = _sqlite3.connect(str(tmp_path / "fresh.db"))
    try:
        assert {"candidate_registrations", "job_blueprint_versions", "incident_records"} <= {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
        assert conn.execute(f"select count(*) from {mig.HISTORY_TABLE}").fetchone()[0] == 2
    finally:
        conn.close()
    assert mig.run(url, backup_dir=str(tmp_path / "bk"), conflicts_path=str(tmp_path / "c.json")) == 0  # rerun is a no-op


def test_rollback_blocked_by_collisions_or_live_recruitment_records(migrated):
    eng = migrated["engine"]
    org2 = None
    with eng.begin() as c:
        orgs = [r[0] for r in c.execute(_text("select id from organizations order by id"))]
        c.execute(models.Candidate.__table__.insert().values(name="x", email="carol@legacy.com", role="r", organization_id=orgs[1]))
    with pytest.raises(mig.MigrationError, match="collision"):
        _run(migrated, rollback=True)
    with eng.begin() as c:
        c.execute(_text("delete from candidates where email = 'carol@legacy.com' and organization_id = :o"), {"o": orgs[1]})
        jd = c.execute(models.JobDescription.__table__.insert().values(title="j", description="d", organization_id=orgs[0])).inserted_primary_key[0]
        c.execute(models.CandidateRegistration.__table__.insert().values(
            registration_token_hash="h" * 64, job_description_id=jd, organization_id=orgs[0], name="n", phone="+10000000000", email="live@example.com"))
    with pytest.raises(mig.MigrationError, match="candidate_registrations"):
        _run(migrated, rollback=True)
    assert "candidate_registrations" in {r[0] for r in _sqlite3.connect(migrated["path"]).execute("select name from sqlite_master where type='table'")}


def test_rollback_restores_legacy_shape_when_clean(migrated):
    eng = migrated["engine"]
    rows_before = _dump(migrated["path"])
    eng.dispose()
    assert _run(migrated, rollback=True) == 0
    conn = _sqlite3.connect(migrated["path"])
    try:
        assert any(cols == ["email"] for _n, _o, cols in mig._sq_unique_indexes(conn, "candidates"))
        assert "registration_id" not in mig._sq_columns(conn, "roleready_sessions")
        assert "share_token" not in mig._sq_columns(conn, "job_descriptions")
        assert not ({"candidate_registrations", "job_blueprint_versions", "incident_records"} & {r[0] for r in conn.execute("select name from sqlite_master where type='table'")})
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()
    after = _dump(migrated["path"])
    kept = _cols(after)
    narrowed = {t: sorted([{k: v for k, v in r.items() if k in kept[t]} for r in rows], key=repr) for t, rows in rows_before.items()}
    assert after == narrowed  # data survives; only the added columns are gone
    assert _run(migrated) == 0  # and it can be migrated forward again


# ------------------------------------------------------------------ MySQL protocol (no server available: fakes)
class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def __iter__(self):
        return iter(self.rows)

    def scalar(self):
        return self.rows[0][0] if self.rows else None

    def fetchone(self):
        return self.rows[0] if self.rows else None


class _FakeConn:
    def __init__(self, answers):
        self.answers = answers

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, stmt, params=None):
        sql = str(stmt)
        for key, rows in self.answers.items():
            if key in sql:
                return _Rows(rows)
        return _Rows([])


class _FakeEngine:
    def __init__(self, answers, url="mysql+pymysql://root:S3cr3t%21pw@127.0.0.1:3306/hiringai"):
        from sqlalchemy.engine import make_url
        self.url = make_url(url)
        self.answers = answers

    def connect(self):
        return _FakeConn(self.answers)

    def dispose(self):
        pass


PROD = {"SHOW TABLES": [(t,) for t in ("candidates", "users", "organizations", "candidate_invitations", "roleready_sessions")],
        "MIN(id), MAX(id) FROM `candidates`": [(1, 9)], "MIN(id), MAX(id) FROM `roleready_sessions`": [(1, 5)],
        "SELECT MAX(id) FROM `candidates`": [(9,)], "SELECT MAX(id) FROM `roleready_sessions`": [(5,)],
        "COUNT(*) FROM `candidates`": [(9,)], "COUNT(*) FROM `users`": [(4,)], "COUNT(*) FROM `organizations`": [(2,)],
        "COUNT(*) FROM `candidate_invitations`": [(7,)], "COUNT(*) FROM `roleready_sessions`": [(5,)],
        "LEFT JOIN candidates": [(0,)]}


def _mysql_runner(log, *, dump_rc=0, trailer=True, stderr=b""):
    def runner(cmd, **kw):
        defaults = [a for a in cmd if a.startswith("--defaults-extra-file=")]
        entry = {"cmd": list(cmd), "defaults_exists": bool(defaults) and _os.path.exists(defaults[0].split("=", 1)[1])}
        if defaults and _os.name != "nt":
            entry["mode"] = _os.stat(defaults[0].split("=", 1)[1]).st_mode & 0o777
        if defaults:
            entry["content"] = open(defaults[0].split("=", 1)[1], encoding="utf-8").read()
        log.append(entry)
        if cmd[0] == "mysqldump":
            kw["stdout"].write(b"-- MySQL dump\nCREATE TABLE t (id int);\n" + (b"-- Dump completed on 2026-10-22  9:05:07\n" if trailer else b""))
            return _types.SimpleNamespace(returncode=dump_rc, stderr=stderr)
        return _types.SimpleNamespace(returncode=0, stderr=b"")
    return runner


def test_mysql_backup_password_free_and_restore_verification(tmp_path, monkeypatch):
    prod, restored = _FakeEngine(PROD), _FakeEngine(PROD)
    monkeypatch.setattr("sqlalchemy.create_engine", lambda url, **kw: restored)
    log = []
    out = mig.mysql_backup_and_verify(prod, str(tmp_path), runner=_mysql_runner(log))
    assert out.endswith(".sql.gz") and _os.path.exists(out)
    assert not [f for f in _os.listdir(tmp_path) if f.endswith(".cnf")]  # credentials file removed in finally
    dump = next(e for e in log if e["cmd"][0] == "mysqldump")
    assert dump["cmd"][1].startswith("--defaults-extra-file=")  # first argument, per spec
    assert {"--single-transaction", "--routines", "--triggers", "--events", "--hex-blob", "--quick"} <= set(dump["cmd"])
    assert all("S3cr3t" not in part and "-p" not in part[:2] for e in log for part in e["cmd"])  # never on the command line
    assert 'password = "S3cr3t!pw"' in dump["content"] and dump["defaults_exists"]
    if _os.name != "nt":
        assert dump["mode"] == 0o600
    created = [e["cmd"][-1] for e in log if e["cmd"][0] == "mysql" and "CREATE DATABASE" in e["cmd"][-1]]
    dropped = [e["cmd"][-1] for e in log if e["cmd"][0] == "mysql" and "DROP DATABASE" in e["cmd"][-1]]
    assert created and dropped and created[0].replace("CREATE", "DROP").replace(";", "") .split("`")[1] == dropped[0].split("`")[1]
    assert "prepwin_backup_verify_" in created[0]


@pytest.mark.parametrize("scenario", ["dump_failure", "truncated_dump", "row_count_mismatch"])
def test_mysql_backup_aborts_before_any_schema_change(tmp_path, monkeypatch, scenario):
    prod = _FakeEngine(PROD)
    bad = dict(PROD)
    if scenario == "row_count_mismatch":
        bad["COUNT(*) FROM `candidates`"] = [(8,)]
    restored = _FakeEngine(bad)
    monkeypatch.setattr("sqlalchemy.create_engine", lambda url, **kw: restored)
    log = []
    kwargs = {"dump_failure": dict(dump_rc=2, stderr=b"mysqldump: Got error: Access denied using password S3cr3t!pw"),
              "truncated_dump": dict(trailer=False), "row_count_mismatch": {}}[scenario]
    with pytest.raises(mig.MigrationError) as exc:
        mig.mysql_backup_and_verify(prod, str(tmp_path), runner=_mysql_runner(log, **kwargs))
    assert "S3cr3t" not in str(exc.value)  # sanitized
    assert not [f for f in _os.listdir(tmp_path) if f.endswith(".cnf")]
    if scenario == "row_count_mismatch":
        assert any(e["cmd"][0] == "mysql" and "DROP DATABASE" in e["cmd"][-1] for e in log)  # test DB is always dropped


def test_mysql_version_gate_for_functional_indexes():
    assert mig.mysql_supports_functional_index("8.0.13") and mig.mysql_supports_functional_index("8.4.1")
    assert not mig.mysql_supports_functional_index("8.0.12") and not mig.mysql_supports_functional_index("5.7.44")
    assert not mig.mysql_supports_functional_index("10.11.6-MariaDB")


def test_model_index_ddl_is_valid_for_sqlite_and_mysql():
    from sqlalchemy.dialects import mysql, sqlite
    from sqlalchemy.schema import CreateIndex
    for dialect in (sqlite.dialect(), mysql.dialect()):
        ddl = str(CreateIndex(next(i for i in models.Candidate.__table__.indexes if i.name == "uix_org_cand_norm_email")).compile(dialect=dialect))
        assert "(organization_id, (lower(trim(email))))" in ddl  # MySQL 8.0.13+ needs the extra parentheses around the expression


def test_mysql_trailer_check_accepts_real_mysqldump_formats_and_rejects_truncation():
    import inspect
    import re
    pattern = r"-- Dump completed on \d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}"
    # real mysqldump output: space-padded, non-zero-padded hour (found against a real MySQL 8.0.46 server)
    for line in ("-- Dump completed on 2026-10-22  9:39:18", "-- Dump completed on 2026-10-22 10:39:18", "-- Dump completed on 2026-01-02 00:00:00"):
        assert re.search(pattern, line)
    assert not re.search(pattern, "INSERT INTO t VALUES (1);")
    assert pattern in inspect.getsource(mig.mysql_backup_and_verify), "the production check must use this pattern"


def test_mysql_backup_missing_client_tool_aborts_cleanly_without_partial_files(tmp_path):
    def missing(cmd, **kw):
        raise FileNotFoundError(cmd[0])

    with pytest.raises(mig.MigrationError, match="not found on PATH"):
        mig.mysql_backup_and_verify(_FakeEngine(PROD), str(tmp_path), runner=missing)
    assert _os.listdir(tmp_path) == []  # no credentials file and no empty/partial .sql left behind


def test_post_commit_integrity_failure_is_reported_as_committed_and_recoverable(legacy, monkeypatch):
    """
    Contrast with the mid-transaction crash tests (which roll back 100%): once COMMIT has happened a failing post-commit
    check cannot be undone automatically. The error must say so, the schema stays applied, and a re-run only re-verifies.
    """
    real = mig._fk_violations
    calls = {"n": 0}

    def flaky(conn):
        calls["n"] += 1
        found = set(real(conn))
        if calls["n"] == 3:  # 1 = baseline, 2 = pre-commit step 15, 3 = post-commit step 18
            found.add(("candidates", 999, "organizations", 0))
        return found

    monkeypatch.setattr(mig, "_fk_violations", flaky)
    with pytest.raises(mig.MigrationError, match="COMMITTED") as exc:
        mig.sqlite_migrate(legacy["path"])
    assert "NOT rolled back automatically" in str(exc.value) and "restore" in str(exc.value).lower()

    conn = _sqlite3.connect(legacy["path"])
    try:  # the change really is committed (history row + new schema), unlike a mid-transaction failure
        assert conn.execute(f"select count(*) from {mig.HISTORY_TABLE} where name = ?", (mig.PHASE_SCHEMA,)).fetchone()[0] == 1
        assert "candidate_registrations" in {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    finally:
        conn.close()
    monkeypatch.setattr(mig, "_fk_violations", real)
    assert mig.sqlite_migrate(legacy["path"]) == {"already_applied": True}  # re-run re-verifies only
    assert _run(legacy) == 0 and mig.PHASE_VERIFIED in {r[0] for r in _sqlite3.connect(legacy["path"]).execute(f"select name from {mig.HISTORY_TABLE}")}


def test_failed_post_migration_verification_is_not_recorded_as_verified(legacy, monkeypatch):
    def broken(engine):
        raise mig.MigrationError("Post-migration verification failed: T3 simulated")

    monkeypatch.setattr(mig, "verify_migration", broken)
    with pytest.raises(mig.MigrationError, match="already COMMITTED"):
        _run(legacy)
    names = {r[0] for r in _sqlite3.connect(legacy["path"]).execute(f"select name from {mig.HISTORY_TABLE}")}
    assert names == {mig.PHASE_SCHEMA}  # SUCCESS is only ever recorded after verification passes
