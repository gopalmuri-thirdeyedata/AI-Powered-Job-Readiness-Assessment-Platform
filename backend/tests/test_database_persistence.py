"""Saved data must outlive restarts: the SQLite file sits on a persistent volume and can be shared by the
server workers without 'database is locked' failures."""
import sqlite3
import threading
from pathlib import Path

import pytest

import database

ROOT = Path(__file__).resolve().parent.parent.parent


def test_sqlite_is_configured_for_concurrent_workers():
    if not database.SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
        pytest.skip("not running on SQLite")
    with database.engine.connect() as conn:
        raw = conn.connection
        assert raw.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert raw.execute("PRAGMA busy_timeout").fetchone()[0] >= 5000


def test_concurrent_writers_queue_instead_of_failing(tmp_path):
    """Four writers hammering one WAL database with the same settings the app uses must all succeed."""
    db_file = tmp_path / "shared.db"
    setup = sqlite3.connect(db_file, timeout=30)
    setup.execute("PRAGMA journal_mode=WAL")
    setup.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, who INTEGER)")
    setup.commit()
    setup.close()

    errors = []

    def writer(n):
        try:
            conn = sqlite3.connect(db_file, timeout=30)
            conn.execute("PRAGMA busy_timeout=30000")
            for _ in range(40):
                conn.execute("INSERT INTO t (who) VALUES (?)", (n,))
                conn.commit()
            conn.close()
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []
    check = sqlite3.connect(db_file)
    assert check.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 160
    check.close()


def test_compose_keeps_the_database_on_a_persistent_volume():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "DATABASE_URL=sqlite:////app/data/PrepWin.db" in compose
    assert "backend_data:/app/data" in compose
    top_level = compose[compose.rindex("\nvolumes:"):]
    assert "backend_data:" in top_level


def test_image_creates_the_data_folder_owned_by_the_app_user():
    dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    mkdir = dockerfile.index("mkdir -p media/resumes data")
    chown = dockerfile.index("chown -R appuser:appuser /app")
    user = dockerfile.index("USER appuser")
    assert mkdir < chown < user, "data/ must exist and be chowned before switching to the non-root user"


def test_foreign_key_behaviour_is_not_changed():
    """Persistence work must not silently turn on constraint enforcement for the whole app."""
    source = (ROOT / "backend" / "database.py").read_text(encoding="utf-8")
    assert "foreign_keys" not in source
