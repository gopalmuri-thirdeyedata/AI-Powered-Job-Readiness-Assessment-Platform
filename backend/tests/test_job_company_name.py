"""
Optional company name on a job role (assessment): stored in its own nullable column, never required, never mixed up with the
role / team value, and absent (not "null") wherever it was not provided. Existing rows keep NULL.
"""
import pytest
from sqlalchemy import create_engine, inspect, text

import models
from tests import recruitment_helpers as h

client = h.client
ROLES = "/api/admin/job-roles"


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def admin(db):
    a = h.make_admin(db)
    yield a
    h.cleanup_orgs(db, [a["org"].id])


def create(admin, **extra):
    body = {"title": "Backend Engineer", "description": h.JD_TEXT, **extra}
    return client.post(f"{ROLES}/", headers=h.auth(admin["token"]), json=body)


def fetch(admin, role_id):
    r = client.get(f"{ROLES}/{role_id}", headers=h.auth(admin["token"]))
    assert r.status_code == 200, r.text
    return r.json()


def test_a_company_name_is_saved_and_returned_by_create_get_and_list(db, admin):
    r = create(admin, company_name="  Infosys  ")
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["company_name"] == "Infosys", "trimmed"
    assert fetch(admin, job["id"])["company_name"] == "Infosys"
    listed = {j["id"]: j for j in client.get(f"{ROLES}/", headers=h.auth(admin["token"])).json()}
    assert listed[job["id"]]["company_name"] == "Infosys"
    db.expire_all()
    assert db.query(models.JobDescription.company_name).filter_by(id=job["id"]).scalar() == "Infosys"


@pytest.mark.parametrize("extra", [{}, {"company_name": ""}, {"company_name": "   "}, {"company_name": None}])
def test_the_company_name_is_optional(db, admin, extra):
    r = create(admin, **extra)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["company_name"] is None, "absent, never an empty string"
    assert job["title"] == "Backend Engineer" and job["role"] == "Backend Engineer", "role keeps its existing default (the title)"
    db.expire_all()
    assert db.query(models.JobDescription.company_name).filter_by(id=job["id"]).scalar() is None


def test_the_company_name_never_overwrites_or_is_mixed_with_the_role_team(db, admin):
    job = create(admin, company_name="Google", role="Platform Engineering").json()
    assert (job["company_name"], job["role"]) == ("Google", "Platform Engineering")
    plain = create(admin, company_name="Microsoft").json()
    assert plain["role"] == "Backend Engineer" and plain["company_name"] == "Microsoft", "the company is not written into role"
    assert create(admin, company_name="x" * 201).status_code == 422, "the length limit is the only validation"


def test_the_company_name_can_be_added_changed_and_cleared_without_touching_anything_else(db, admin):
    job = create(admin, role="Data Platform").json()
    url = f"{ROLES}/{job['id']}"
    r = client.put(url, headers=h.auth(admin["token"]), json={"company_name": "Acme Corp"})
    assert r.status_code == 200 and r.json()["company_name"] == "Acme Corp"
    assert (r.json()["title"], r.json()["role"], r.json()["description"]) == (job["title"], "Data Platform", job["description"])
    assert client.put(url, headers=h.auth(admin["token"]), json={"description": h.JD_TEXT + " More."}).json()["company_name"] == "Acme Corp", "editing the JD keeps it"
    cleared = client.put(url, headers=h.auth(admin["token"]), json={"company_name": "  "}).json()
    assert cleared["company_name"] is None
    assert fetch(admin, job["id"])["role"] == "Data Platform"


def test_an_existing_job_role_without_a_company_name_still_loads_and_is_not_reinterpreted(db, admin):
    job = create(admin, role="Platform Engineering").json()
    db.query(models.JobDescription).filter_by(id=job["id"]).update({"company_name": None})     # what every pre-existing row looks like
    db.commit()
    loaded = fetch(admin, job["id"])
    assert loaded["company_name"] is None and loaded["role"] == "Platform Engineering"
    assert any(j["id"] == job["id"] for j in client.get(f"{ROLES}/", headers=h.auth(admin["token"])).json())


def test_the_company_name_reaches_the_public_metadata_the_dossier_and_the_retest_page_only_when_given(db, admin, monkeypatch):
    with_company = h.create_published_job(admin, monkeypatch)
    client.put(f"{ROLES}/{with_company['id']}", headers=h.auth(admin["token"]), json={"company_name": "Microsoft"})
    without = h.create_published_job(admin, monkeypatch, title="Data Engineer")
    meta = client.get(f"/api/public/assessment/{with_company['share_token']}").json()
    assert meta["company_name"] == "Microsoft" and meta["title"] == "Backend Engineer" and meta["role"] == "Backend Engineer"
    plain = client.get(f"/api/public/assessment/{without['share_token']}").json()
    assert plain["company_name"] is None and plain["title"] == "Data Engineer"

    token, email = h.register_ok(with_company["share_token"])
    reg = db.query(models.CandidateRegistration).filter_by(email=email).one()
    dossier = client.get(f"/api/admin/recruitment/candidates/{reg.id}/dossier", headers=h.auth(admin["token"])).json()
    assert dossier["job_role"]["company_name"] == "Microsoft" and dossier["job_role"]["title"] == "Backend Engineer"
    token2, email2 = h.register_ok(without["share_token"])
    reg2 = db.query(models.CandidateRegistration).filter_by(email=email2).one()
    assert client.get(f"/api/admin/recruitment/candidates/{reg2.id}/dossier", headers=h.auth(admin["token"])).json()["job_role"]["company_name"] is None


def test_publishing_links_and_registration_are_unaffected(db, admin, monkeypatch):
    job = h.create_published_job(admin, monkeypatch)
    client.put(f"{ROLES}/{job['id']}", headers=h.auth(admin["token"]), json={"company_name": "Acme"})
    again = fetch(admin, job["id"])
    assert again["status"] == "PUBLISHED" and again["share_token"] == job["share_token"] and again["share_link_expires_at"] == job["share_link_expires_at"]
    token, email = h.register_ok(job["share_token"])
    started = h.start_ok(job["share_token"], token)
    assert started["session_uuid"]


def test_the_migration_adds_one_nullable_column_and_changes_no_existing_row(tmp_path):
    import migrate_job_company_name as mig
    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE job_descriptions (id INTEGER PRIMARY KEY, title VARCHAR(200), role VARCHAR(200), description TEXT)"))
        conn.execute(text("INSERT INTO job_descriptions (id, title, role, description) VALUES (1, 'Backend Engineer', 'Platform Engineering', 'jd text')"))
    assert mig.apply(engine) == ["job_descriptions.company_name"]
    col, = [c for c in inspect(engine).get_columns("job_descriptions") if c["name"] == "company_name"]
    assert col["nullable"] is True
    with engine.connect() as conn:
        row = conn.execute(text("SELECT title, role, description, company_name FROM job_descriptions")).one()
    assert tuple(row) == ("Backend Engineer", "Platform Engineering", "jd text", None), "role / team is preserved and NOT copied into the company name"
    assert mig.apply(engine) == [], "idempotent"
    assert mig.apply(create_engine(f"sqlite:///{(tmp_path / 'empty.db').as_posix()}")) == [], "a fresh database is left to create_all"
