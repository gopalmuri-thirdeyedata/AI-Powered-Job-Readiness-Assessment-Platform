"""Four server workers booting on a brand-new database must not crash each other."""
import threading

import pytest
from sqlalchemy.exc import OperationalError

import main


def _op_error(message):
    return OperationalError("CREATE TABLE x", {}, Exception(message))


def test_a_lost_table_creation_race_is_retried_and_succeeds(monkeypatch):
    calls = []

    def flaky_create_all(bind=None):
        calls.append(1)
        if len(calls) < 3:
            raise _op_error("table organizations already exists" if len(calls) == 1 else "database schema has changed")

    monkeypatch.setattr(main.models.Base.metadata, "create_all", flaky_create_all)
    main.create_tables_with_retry()
    assert len(calls) == 3


def test_a_locked_database_is_retried(monkeypatch):
    calls = []

    def locked_once(bind=None):
        calls.append(1)
        if len(calls) == 1:
            raise _op_error("database is locked")

    monkeypatch.setattr(main.models.Base.metadata, "create_all", locked_once)
    main.create_tables_with_retry()
    assert len(calls) == 2


def test_a_real_error_is_not_swallowed(monkeypatch):
    def broken(bind=None):
        raise _op_error("disk I/O error")

    monkeypatch.setattr(main.models.Base.metadata, "create_all", broken)
    with pytest.raises(OperationalError):
        main.create_tables_with_retry()


def test_it_gives_up_after_the_last_attempt(monkeypatch):
    calls = []

    def always_exists(bind=None):
        calls.append(1)
        raise _op_error("table x already exists")

    monkeypatch.setattr(main.models.Base.metadata, "create_all", always_exists)
    with pytest.raises(OperationalError):
        main.create_tables_with_retry(attempts=3)
    assert len(calls) == 3


def test_four_workers_creating_tables_on_an_empty_database_all_succeed(tmp_path):
    """The real thing: four threads, one empty SQLite file, the same engine settings the app uses."""
    from sqlalchemy import create_engine, event

    import models

    engine = create_engine(f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    errors = []
    barrier = threading.Barrier(4)

    def worker():
        try:
            barrier.wait()
            for attempt in range(8):
                try:
                    models.Base.metadata.create_all(bind=engine)
                    return
                except OperationalError as exc:
                    if not any(t in str(exc).lower() for t in ("already exists", "schema has changed", "locked")):
                        raise
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []
    with engine.connect() as conn:
        tables = {row[0] for row in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "organizations", "student_profiles", "roleready_sessions"} <= tables


def test_the_server_uses_the_retrying_version():
    source = open(main.__file__, encoding="utf-8").read()
    assert "create_tables_with_retry()" in source
    assert "\nmodels.Base.metadata.create_all(bind=database.engine)\n" not in source
