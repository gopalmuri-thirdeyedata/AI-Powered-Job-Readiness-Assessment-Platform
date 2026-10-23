"""
Job roles are shown, changed and counted only inside the organization they belong to.

The Job Roles & Blueprints page and Shared Links read the same list endpoint, so these tests cover both.
Tenant resolution (see routers/auth.py): explicit X-Organization-Id header -> the user's own organization anchor -> a single
membership. Only a platform administrator may name an arbitrary organization.
"""
import pytest

import models
from tests import recruitment_helpers as h

client = h.client
JD = "We are hiring an engineer to build Python and FastAPI services backed by SQL databases and own reliability in production."


@pytest.fixture()
def db():
    s = h.new_session()
    yield s
    s.close()


@pytest.fixture()
def tenants(db):
    a = h.make_admin(db)
    b = h.make_admin(db)
    hr_a = h.make_admin(db, org=a["org"], member_role="HR", user_role=models.UserRole.HR)
    platform = h.make_admin(db, org=a["org"], user_role=models.UserRole.PLATFORM_ADMIN)
    yield {"a": a, "b": b, "hr_a": hr_a, "platform": platform}
    h.cleanup_orgs(db, [a["org"].id, b["org"].id])


def create(who, title, org_header=None, **extra):
    headers = h.auth(who["token"], org_header)
    r = client.post("/api/admin/job-roles/", headers=headers, json={"title": title, "description": JD, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def listing(who, org_header=None):
    r = client.get("/api/admin/job-roles/", headers=h.auth(who["token"], org_header))
    assert r.status_code == 200, r.text
    return r.json()


def titles(rows):
    return sorted(r["title"] for r in rows)


def test_each_organization_sees_only_its_own_roles(tenants):
    create(tenants["a"], "Alpha Engineer")
    create(tenants["a"], "Shared Title")
    create(tenants["b"], "Beta Engineer")
    create(tenants["b"], "Shared Title")
    assert titles(listing(tenants["a"])) == ["Alpha Engineer", "Shared Title"]
    assert titles(listing(tenants["b"])) == ["Beta Engineer", "Shared Title"]
    assert not {r["id"] for r in listing(tenants["a"])} & {r["id"] for r in listing(tenants["b"])}
    assert titles(listing(tenants["hr_a"])) == ["Alpha Engineer", "Shared Title"], "a colleague in the same organization sees the same roles"


def test_a_role_cannot_be_read_changed_generated_published_or_closed_from_another_organization(tenants, monkeypatch):
    h.patch_gemini_blueprint(monkeypatch)
    role = create(tenants["a"], "Alpha Engineer")
    rid = role["id"]
    other = h.auth(tenants["b"]["token"])
    assert client.get(f"/api/admin/job-roles/{rid}", headers=other).status_code == 404
    assert client.put(f"/api/admin/job-roles/{rid}", headers=other, json={"title": "Hijacked"}).status_code == 404
    assert client.post(f"/api/admin/job-roles/{rid}/generate-blueprint", headers=other).status_code == 404
    assert client.post(f"/api/admin/job-roles/{rid}/publish", headers=other).status_code == 404
    assert client.post(f"/api/admin/job-roles/{rid}/close", headers=other).status_code == 404
    mine = client.get(f"/api/admin/job-roles/{rid}", headers=h.auth(tenants["a"]["token"])).json()
    assert mine["title"] == "Alpha Engineer" and mine["status"] == "DRAFT" and mine["blueprint_version"] == 0, "nothing changed"


def test_an_organization_header_only_works_for_organizations_you_belong_to(tenants):
    create(tenants["b"], "Beta Engineer")
    a_to_b = h.auth(tenants["hr_a"]["token"], tenants["b"]["org"].id)
    assert client.get("/api/admin/job-roles/", headers=a_to_b).status_code == 403
    assert client.get("/api/admin/job-roles/", headers=h.auth(tenants["a"]["token"], tenants["b"]["org"].id)).status_code == 403
    assert client.post("/api/admin/job-roles/", headers=a_to_b, json={"title": "Injected", "description": JD}).status_code == 403
    assert client.get("/api/admin/job-roles/").status_code == 401
    assert "Injected" not in titles(listing(tenants["b"]))


def test_a_body_cannot_choose_the_organization_of_a_new_role(tenants, db):
    role = create(tenants["a"], "Alpha Engineer", organization_id=tenants["b"]["org"].id)
    stored = db.query(models.JobDescription).filter_by(id=role["id"]).first()
    assert stored.organization_id == tenants["a"]["org"].id
    assert "Alpha Engineer" not in titles(listing(tenants["b"]))


def test_a_platform_administrator_sees_the_organization_they_name_and_nothing_else(tenants):
    create(tenants["a"], "Alpha Engineer")
    create(tenants["b"], "Beta Engineer")
    p = tenants["platform"]
    assert titles(listing(p)) == ["Alpha Engineer"], "no header: the administrator's own organization anchor"
    assert titles(listing(p, tenants["a"]["org"].id)) == ["Alpha Engineer"]
    assert titles(listing(p, tenants["b"]["org"].id)) == ["Beta Engineer"]
    assert client.get("/api/admin/job-roles/", headers=h.auth(p["token"], 99999999)).status_code == 404


def test_a_platform_administrator_creates_roles_in_the_named_organization_only(tenants, db):
    p = tenants["platform"]
    role = create(p, "Created For Beta", org_header=tenants["b"]["org"].id)
    assert db.query(models.JobDescription).filter_by(id=role["id"]).first().organization_id == tenants["b"]["org"].id
    assert "Created For Beta" in titles(listing(tenants["b"]))
    assert "Created For Beta" not in titles(listing(tenants["a"]))


def test_registration_counts_and_candidate_results_stay_inside_the_organization(tenants, monkeypatch):
    h.reset_public_limiters()
    pub = h.create_published_job(tenants["a"], monkeypatch)
    for _ in range(2):
        assert h.register(pub["share_token"])[0].status_code == 200
    a_row = next(r for r in listing(tenants["a"]) if r["id"] == pub["id"])
    assert a_row["registration_count"] == 2
    assert pub["id"] not in {r["id"] for r in listing(tenants["b"])}
    assert client.get("/api/admin/recruitment/candidates", headers=h.auth(tenants["b"]["token"])).json()["total"] == 0
    assert client.get("/api/admin/recruitment/candidates", headers=h.auth(tenants["a"]["token"])).json()["total"] == 2


def test_the_legacy_job_description_endpoint_is_tenant_scoped_too(tenants):
    r = client.post("/api/resume/job-descriptions/", headers=h.auth(tenants["hr_a"]["token"]), json={"role": "Legacy Created", "required_skills": ["Python"]})
    assert r.status_code == 201, r.text
    assert "Legacy Created" in titles(listing(tenants["a"]))
    assert "Legacy Created" not in titles(listing(tenants["b"]))
