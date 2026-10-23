"""
Keeps the automated tests away from the configured (development / production) database.

Why this exists: most legacy tests create rows through the API (job roles such as "Lead Architect" and "Senior Backend Architect",
organizations, users, ...) and never clean them up, and several use fixture user ids (301, 302, 401, 402) that collide with real
accounts. Run against the configured database they silently filled the Job Roles & Blueprints page of the real platform admin
with test data (17 duplicate "Lead Architect" drafts and 150 other fixture roles in one development database).

Rule: unless the invoker EXPLICITLY points the tests at a different database (DATABASE_URL set to something other than what the
application would use anyway), the tests run on a throw-away SQLite file. Deliberately testing against the configured database
needs the explicit opt-in PREPWIN_TESTS_USE_CONFIGURED_DB=1.

Pure functions only (no imports of the application) so this can run before `database` is imported and be unit tested.
"""
import os
import tempfile
from typing import Mapping, Optional, Tuple

OPT_IN = "PREPWIN_TESTS_USE_CONFIGURED_DB"


def read_env_file_value(path: str, key: str = "DATABASE_URL") -> Optional[str]:
    """The value `database.py` would pick up from backend/.env (python-dotenv semantics, simple KEY=VALUE lines)."""
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                if name.strip() == key:
                    return value.strip().strip('"').strip("'")
    except OSError:
        return None
    return None


def choose_test_database(environ: Mapping[str, str], env_file_url: Optional[str], temp_dir: str) -> Tuple[Optional[str], str]:
    """
    Returns (database_url_to_force or None, reason).
    None means "leave the environment alone": the invoker chose a database explicitly or opted in.
    """
    if environ.get(OPT_IN, "").strip().lower() in ("1", "true", "yes"):
        return None, "explicit opt-in: tests run on the configured database"
    explicit = (environ.get("DATABASE_URL") or "").strip()
    if explicit and explicit != (env_file_url or "").strip():
        return None, "DATABASE_URL was set explicitly to a database other than the configured one"
    forced = "sqlite:///" + os.path.join(temp_dir, "prepwin-tests.db").replace("\\", "/")
    return forced, "no explicit test database: using a throw-away SQLite file instead of the configured database"


def apply_guard(environ: dict, env_file: str) -> Tuple[Optional[str], str]:
    """Called once, by conftest, before the application (and therefore `database`) is imported."""
    forced, reason = choose_test_database(environ, read_env_file_value(env_file), tempfile.mkdtemp(prefix="prepwin-tests-"))
    if forced:
        environ["DATABASE_URL"] = forced
    return forced, reason
