"""
Production initialization must never create sample job roles (or any other sample business data).

Two layers:
  * behaviour - the startup provisioning (primary organization, platform admin, relinking orphans) run against an EMPTY database
    creates exactly that and nothing else, and is idempotent;
  * structure - the only code that constructs a JobDescription is a request handler an administrator calls; no startup hook, service,
    migration or script inserts one, no seed script exists, and the container entrypoints do not run tests or seeds.
"""
import os
import re

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

import database
import main
import models

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)

BUSINESS_TABLES = [models.JobDescription, models.JobBlueprintVersion, models.Candidate, models.CandidateRegistration,
                   models.RoleReadySession, models.RoleReadyRoundAttempt, models.StudentProfile, models.CandidateInvitation]


@pytest.fixture()
def empty_db(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'init.db').as_posix()}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", Session)
    yield Session
    engine.dispose()


def counts(Session):
    with Session() as db:
        return {m.__tablename__: db.query(func.count(m.id)).scalar() for m in BUSINESS_TABLES}


def test_startup_provisioning_creates_no_roles_candidates_or_sample_data(empty_db):
    main.ensure_default_platform_admin()
    with empty_db() as db:
        assert db.query(models.Organization).count() == 1
        assert db.query(models.User).count() == 1 and db.query(models.User).first().role == models.UserRole.PLATFORM_ADMIN
        assert db.query(models.OrganizationMember).count() == 1
    assert counts(empty_db) == {m.__tablename__: 0 for m in BUSINESS_TABLES}, "startup must not insert any business data"


def test_startup_provisioning_is_idempotent(empty_db):
    for _ in range(3):
        main.ensure_default_platform_admin()
    with empty_db() as db:
        assert (db.query(models.Organization).count(), db.query(models.User).count(), db.query(models.OrganizationMember).count()) == (1, 1, 1)
    assert sum(counts(empty_db).values()) == 0


def test_startup_does_not_add_roles_to_an_existing_database(empty_db):
    """Existing records are only ever relinked (orphans) - never added to, never removed."""
    with empty_db() as db:
        org = models.Organization(name="Customer Co", slug="customer-co", status="active")
        db.add(org)
        db.commit()
        db.add(models.JobDescription(title="Real Role", role="Real Role", description="x" * 80, organization_id=org.id))
        db.commit()
    before = counts(empty_db)
    main.ensure_default_platform_admin()
    main.ensure_default_platform_admin()
    assert counts(empty_db) == before == {**{m.__tablename__: 0 for m in BUSINESS_TABLES}, "job_descriptions": 1}
    with empty_db() as db:
        assert [r.title for r in db.query(models.JobDescription)] == ["Real Role"]


# ------------------------------------------------------------------------------ structure
def _python_files(root):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ("venv", ".venv", "node_modules", "__pycache__", "tests", "scratch", "backups", "media", "media_backup_before_clean")]
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(base, name)


def test_only_administrator_request_handlers_construct_job_roles():
    constructors = set()
    for path in _python_files(BACKEND):
        text = open(path, encoding="utf-8", errors="ignore").read()
        if re.search(r"\bJobDescription\(", text) and not path.endswith("models.py"):
            constructors.add(os.path.relpath(path, BACKEND).replace("\\", "/"))
    assert constructors == {"routers/job_assessments.py", "routers/resume.py", "routers/roleready.py"}, \
        f"a new place creates job roles - it must be an administrator-triggered request handler, never initialization: {constructors}"


def test_no_startup_hook_migration_or_script_inserts_job_roles():
    for path in _python_files(BACKEND):
        text = open(path, encoding="utf-8", errors="ignore").read()
        assert not re.search(r"insert\s+into\s+job_descriptions", text, re.IGNORECASE), path
    main_src = open(os.path.join(BACKEND, "main.py"), encoding="utf-8").read()
    startup_blocks = re.findall(r"@app\.on_event\(\"startup\"\)\s+(?:async )?def \w+\(.*?\n(?=@app|\n\n# |\nclass )", main_src, re.DOTALL)
    assert startup_blocks, "startup hooks were found"
    for block in startup_blocks:
        assert "JobDescription" not in block and "add(models.Job" not in block


def test_there_is_no_seed_script_and_entrypoints_do_not_run_tests_or_seeds():
    names = [n for n in os.listdir(BACKEND) if n.endswith(".py")]
    assert not [n for n in names if re.search(r"seed|sample|demo|fixture", n, re.IGNORECASE)], names
    for rel in ("Dockerfile", "docker/entrypoint.sh", "docker-compose.yml", "docker-compose.prod.yml", "docker-compose.override.yml", "backend/Dockerfile", "frontend/Dockerfile", "backend/Procfile"):
        path = os.path.join(REPO, rel)
        if os.path.exists(path):
            text = open(path, encoding="utf-8", errors="ignore").read().lower()
            assert "pytest" not in text and "seed" not in text, rel
