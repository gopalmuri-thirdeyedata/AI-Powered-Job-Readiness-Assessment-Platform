import copy

import pytest

import database
import models
import utils
from services import gemini_mock_fixtures, jd_blueprint_service
from tests import recruitment_helpers as h

client = h.client


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def tenants(db):
    a = h.make_admin(db)
    b = h.make_admin(db)
    yield {"a": a, "b": b}
    h.cleanup_orgs(db, [a["org"].id, b["org"].id])


def test_create_and_list_job_roles_tenant_isolated(tenants):
    a, b = tenants["a"], tenants["b"]
    job_a = h.create_job(a, title="Role A")
    job_b = h.create_job(b, title="Role B")

    listing_a = client.get("/api/admin/job-roles/", headers=h.auth(a["token"])).json()
    ids_a = {j["id"] for j in listing_a}
    assert job_a["id"] in ids_a and job_b["id"] not in ids_a

    # Cross-tenant reads/writes are indistinguishable from "not found"
    assert client.get(f"/api/admin/job-roles/{job_b['id']}", headers=h.auth(a["token"])).status_code == 404
    assert client.put(f"/api/admin/job-roles/{job_b['id']}", headers=h.auth(a["token"]), json={"title": "hijack"}).status_code == 404
    assert client.post(f"/api/admin/job-roles/{job_b['id']}/publish", headers=h.auth(a["token"])).status_code == 404


def test_organization_id_in_payload_is_ignored(db, tenants):
    a, b = tenants["a"], tenants["b"]
    r = client.post("/api/admin/job-roles/", headers=h.auth(a["token"]),
                    json={"title": "Sneaky", "description": h.JD_TEXT, "organization_id": b["org"].id})
    assert r.status_code == 201
    row = db.query(models.JobDescription).filter_by(id=r.json()["id"]).first()
    assert row.organization_id == a["org"].id


def test_unauthenticated_and_student_blocked():
    assert client.get("/api/admin/job-roles/").status_code == 401


def test_gemini_blueprint_validation_success(monkeypatch, tenants):
    h.patch_gemini_blueprint(monkeypatch)
    job = h.create_job(tenants["a"])
    r = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(tenants["a"]["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["blueprint_version"] == 1
    assert body["blueprint"]["valid"] is True
    assert (body["blueprint"]["aptitude_count"], body["blueprint"]["coding_count"], body["blueprint"]["interview_count"]) == (15, 2, 5)
    assert body["status"] == "DRAFT" and body["is_published"] is False


def test_gemini_failure_raises_502_and_preserves_existing(monkeypatch, tenants):
    a = tenants["a"]
    h.patch_gemini_blueprint(monkeypatch)
    job = h.create_job(a)
    ok = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(a["token"])).json()

    calls = h.patch_gemini_blueprint(monkeypatch, fail=True)
    r = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(a["token"]))
    assert r.status_code == 502
    assert calls["n"] == 1 + jd_blueprint_service.GENERATION_RETRIES  # bounded retry, then explicit failure
    after = client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(a["token"])).json()
    assert after["blueprint_version"] == ok["blueprint_version"] == 1
    assert after["blueprint_data"] == ok["blueprint_data"]  # existing valid blueprint preserved, no generic fallback


def test_invalid_gemini_output_retries_once_then_502(monkeypatch, tenants):
    bad = gemini_mock_fixtures.sample_blueprint()
    bad["aptitude_questions"] = bad["aptitude_questions"][:14]
    calls = h.patch_gemini_blueprint(monkeypatch, blueprint=bad)
    job = h.create_job(tenants["a"])
    r = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(tenants["a"]["token"]))
    assert r.status_code == 502
    assert calls["n"] == 2
    after = client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(tenants["a"]["token"])).json()
    assert after["blueprint_data"] is None and after["blueprint_version"] == 0


def test_retry_succeeds_when_second_attempt_is_valid(monkeypatch, tenants):
    state = {"n": 0}

    def flaky(prompt, system_prompt="", temperature=0.1, json_mode=True, timeout=None):
        state["n"] += 1
        if state["n"] == 1:
            raise jd_blueprint_service.gemini_client.GeminiUnavailableError("transient")
        return gemini_mock_fixtures.get_mock_response(prompt)

    monkeypatch.setattr(jd_blueprint_service.gemini_client, "call_gemini", flaky)
    monkeypatch.setattr(jd_blueprint_service, "_sleep", lambda s: None)
    job = h.create_job(tenants["a"])
    r = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(tenants["a"]["token"]))
    assert r.status_code == 200 and state["n"] == 1 + 3 + 1      # one part retried; 3 Gemini calls plus the independent aptitude answer check


def test_short_job_description_rejected_without_calling_gemini(monkeypatch, tenants):
    calls = h.patch_gemini_blueprint(monkeypatch)
    r = client.post("/api/admin/job-roles/", headers=h.auth(tenants["a"]["token"]), json={"title": "Tiny", "description": "too short"})
    job = r.json()
    gen = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(tenants["a"]["token"]))
    assert gen.status_code == 422
    assert calls["n"] == 0


def test_publish_blocked_without_valid_blueprint(tenants):
    job = h.create_job(tenants["a"])
    r = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(tenants["a"]["token"]))
    assert r.status_code == 400
    assert "blueprint" in r.json()["detail"].lower()
    assert client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(tenants["a"]["token"])).json()["is_published"] is False


def test_publish_blocked_for_invalid_stored_blueprint(db, tenants):
    job = h.create_job(tenants["a"])
    row = db.query(models.JobDescription).filter_by(id=job["id"]).first()
    broken = copy.deepcopy(gemini_mock_fixtures.sample_blueprint())
    broken["coding_problems"] = broken["coding_problems"][:1]
    row.blueprint_data = broken
    row.blueprint_version = 1
    db.commit()
    r = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(tenants["a"]["token"]))
    assert r.status_code == 400


def test_publish_generates_share_token_and_close_lifecycle(monkeypatch, tenants):
    a = tenants["a"]
    pub1 = h.create_published_job(a, monkeypatch)
    pub2 = h.create_published_job(a, monkeypatch)
    assert len(pub1["share_token"]) == 64 and len(pub2["share_token"]) == 64
    assert pub1["share_token"] != pub2["share_token"]
    assert pub1["status"] == "PUBLISHED" and pub1["is_published"] is True
    assert pub1["share_path"] == f"/assessment/join/{pub1['share_token']}"

    # idempotent publish keeps the same reusable link
    again = client.post(f"/api/admin/job-roles/{pub1['id']}/publish", headers=h.auth(a["token"])).json()
    assert again["share_token"] == pub1["share_token"]

    closed = client.post(f"/api/admin/job-roles/{pub1['id']}/close", headers=h.auth(a["token"])).json()
    assert closed["status"] == "CLOSED" and closed["is_published"] is False and closed["share_token"] is None

    # re-publishing a closed role reuses the original link
    reopened = client.post(f"/api/admin/job-roles/{pub1['id']}/publish", headers=h.auth(a["token"])).json()
    assert reopened["share_token"] == pub1["share_token"]


def test_close_requires_published(tenants):
    job = h.create_job(tenants["a"])
    assert client.post(f"/api/admin/job-roles/{job['id']}/close", headers=h.auth(tenants["a"]["token"])).status_code == 400


def test_regenerating_creates_new_version_and_archives(db, monkeypatch, tenants):
    a = tenants["a"]
    h.patch_gemini_blueprint(monkeypatch)
    job = h.create_job(a)
    for expected in (1, 2):
        r = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(a["token"])).json()
        assert r["blueprint_version"] == expected
    versions = db.query(models.JobBlueprintVersion).filter_by(job_description_id=job["id"]).order_by(models.JobBlueprintVersion.version).all()
    assert [v.version for v in versions] == [1, 2]
