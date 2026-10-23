"""
The automated tests must never write to the configured (development / production) database.

History: tests that create job roles through the API ("Lead Architect", "Senior Backend Architect", ...) without cleanup, run against
the configured database, filled a real admin's Job Roles & Blueprints page with duplicate drafts (see tests/db_guard.py).
"""
import hashlib
import os
import subprocess
import sys
import textwrap

import pytest

from tests import db_guard

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIGURED = "sqlite:///hiringai.db"


# ------------------------------------------------------------------------------ the decision rule
def test_no_explicit_database_means_a_throwaway_one(tmp_path):
    forced, reason = db_guard.choose_test_database({}, CONFIGURED, str(tmp_path))
    assert forced and forced.startswith("sqlite:///") and str(tmp_path).replace("\\", "/") in forced and "hiringai.db" not in forced
    assert "throw-away" in reason


def test_database_url_equal_to_the_configured_one_is_still_redirected(tmp_path):
    """Exporting the very URL the app uses anyway is not an explicit choice of a test database."""
    forced, _ = db_guard.choose_test_database({"DATABASE_URL": CONFIGURED}, CONFIGURED, str(tmp_path))
    assert forced is not None


def test_a_different_explicit_database_is_respected(tmp_path):
    for url in ("sqlite:////tmp/scratch/test.db", "mysql://user:pw@localhost/prepwin_test", "sqlite:///C:/scratch/x.db"):
        assert db_guard.choose_test_database({"DATABASE_URL": url}, CONFIGURED, str(tmp_path))[0] is None, url


def test_opting_in_to_the_configured_database_must_be_explicit(tmp_path):
    for value in ("1", "true", "YES"):
        forced, reason = db_guard.choose_test_database({db_guard.OPT_IN: value}, CONFIGURED, str(tmp_path))
        assert forced is None and "opt-in" in reason
    assert db_guard.choose_test_database({db_guard.OPT_IN: "0"}, CONFIGURED, str(tmp_path))[0] is not None
    assert db_guard.choose_test_database({db_guard.OPT_IN: ""}, CONFIGURED, str(tmp_path))[0] is not None


def test_a_missing_env_file_does_not_disable_the_guard(tmp_path):
    assert db_guard.read_env_file_value(str(tmp_path / "nope.env")) is None
    assert db_guard.choose_test_database({}, None, str(tmp_path))[0] is not None


def test_env_file_parsing(tmp_path):
    f = tmp_path / ".env"
    f.write_text("# comment\nOTHER=1\nDATABASE_URL='sqlite:///hiringai.db'\nGEMINI_API_KEY=abc\n", encoding="utf-8")
    assert db_guard.read_env_file_value(str(f)) == "sqlite:///hiringai.db"


def test_apply_guard_sets_the_environment_only_when_it_redirects(tmp_path):
    env = {}
    forced, _ = db_guard.apply_guard(env, str(tmp_path / ".env"))
    assert env["DATABASE_URL"] == forced
    env = {"DATABASE_URL": "sqlite:////tmp/mine.db"}
    assert db_guard.apply_guard(env, str(tmp_path / ".env"))[0] is None and env["DATABASE_URL"] == "sqlite:////tmp/mine.db"


# ------------------------------------------------------------------------------ this very test session
def test_this_test_session_is_not_running_on_the_configured_database():
    import database
    configured_file = os.path.join(BACKEND, "hiringai.db").replace("\\", "/")
    opted_in = os.environ.get(db_guard.OPT_IN, "").lower() in ("1", "true", "yes")
    assert opted_in or database.SQLALCHEMY_DATABASE_URL.replace("\\", "/") != f"sqlite:///{configured_file}", database.SQLALCHEMY_DATABASE_URL


# ------------------------------------------------------------------------------ a fresh pytest run, no DATABASE_URL at all
PROBE = textwrap.dedent('''
    import os
    def test_probe_reports_the_database_the_run_would_use():
        print("PROBE_DATABASE_URL=" + os.environ.get("DATABASE_URL", ""))
''')


def _run_probe(tmp_path, extra_env):
    probe_dir = tmp_path / "probe"
    probe_dir.mkdir()
    for name in ("conftest.py", "db_guard.py"):
        (probe_dir / name).write_text(open(os.path.join(BACKEND, "tests", name), encoding="utf-8").read(), encoding="utf-8")
    (probe_dir / "test_probe.py").write_text(PROBE, encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", db_guard.OPT_IN)}
    env.update(extra_env)
    env["PYTHONPATH"] = BACKEND
    out = subprocess.run([sys.executable, "-m", "pytest", str(probe_dir), "-q", "-s", "-p", "no:cacheprovider", "--rootdir", str(probe_dir)],
                         cwd=str(tmp_path), env=env, capture_output=True, text=True, timeout=180)
    assert out.returncode == 0, out.stdout[-2000:] + out.stderr[-2000:]
    return next(line.split("=", 1)[1] for line in out.stdout.splitlines() if line.startswith("PROBE_DATABASE_URL="))


def _md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest() if os.path.exists(path) else None


def test_a_bare_pytest_run_is_redirected_and_the_configured_database_is_untouched(tmp_path):
    real = os.path.join(BACKEND, "hiringai.db")
    before = _md5(real)
    url = _run_probe(tmp_path, {})
    assert url.startswith("sqlite:///") and "prepwin-tests" in url and "hiringai.db" not in url
    assert _md5(real) == before


def test_an_explicit_database_is_left_alone_by_a_fresh_run(tmp_path):
    mine = "sqlite:///" + str(tmp_path / "mine.db").replace("\\", "/")
    assert _run_probe(tmp_path, {"DATABASE_URL": mine}) == mine


def test_the_opt_in_really_uses_the_configured_database_setting(tmp_path):
    configured = db_guard.read_env_file_value(os.path.join(BACKEND, ".env"))
    url = _run_probe(tmp_path, {db_guard.OPT_IN: "1"})
    assert "prepwin-tests" not in url                                 # nothing is forced ...
    assert url in ("", configured)                                    # ... the application keeps whatever it is configured with
