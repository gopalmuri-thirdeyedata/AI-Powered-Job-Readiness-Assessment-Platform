"""
Blueprint generation (Gemini) -> review -> publish, and the complete candidate path on top of it.

The "Use Demo Template" feature is GONE: there is no endpoint, no availability payload and no template content. A job role
gets a blueprint only from Gemini (or, in dev mode, the offline mock fixture, which is labelled as such). When Gemini is
unavailable the request fails visibly (HTTP 502) and nothing is stored or replaced.

Test doubles, stated plainly: Gemini is replaced by a deterministic stub (so none of this proves live Gemini behaviour), the coding
sandbox by a LOCAL subprocess that runs the real adapter output (so test cases and scoring are real), and the interview scorer by
a fixed-score stub. Aptitude scoring and result aggregation run unmodified.
"""
import json as jsonlib

import httpx
import pytest

import models
import utils
from services import gemini_client, gemini_mock_fixtures
from tests import recruitment_helpers as h

client = h.client
JD = ("We are hiring a Full Stack Engineer to build React front ends and Python FastAPI services backed by SQL databases, "
      "design REST APIs and own authentication in production.")


@pytest.fixture()
def db():
    s = h.new_session()
    yield s
    s.close()


@pytest.fixture()
def admin(db):
    a = h.make_admin(db)
    yield a
    h.cleanup_orgs(db, [a["org"].id])


def role(admin, title="Full Stack Engineer"):
    return h.create_job(admin, title=title, description=JD)


def get(admin, job):
    return client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(admin["token"])).json()


def generate(admin, job):
    return client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(admin["token"]))


# ------------------------------------------------------------------ the demo template no longer exists
def test_the_demo_template_endpoint_and_payload_are_gone(admin):
    job = role(admin)
    assert client.post(f"/api/admin/job-roles/{job['id']}/apply-demo-template", headers=h.auth(admin["token"]), json={}).status_code in (404, 405)
    payload = get(admin, job)
    assert "demo_template" not in payload and "template_name" not in (payload["blueprint"] or {})
    assert "demo_template" not in str(client.get("/api/admin/job-roles/", headers=h.auth(admin["token"])).json())


def test_there_is_no_template_module_or_template_source_label():
    with pytest.raises(ImportError):
        from services import blueprint_templates  # noqa: F401


def test_a_new_role_has_no_blueprint_until_gemini_generates_one(admin):
    job = role(admin)
    assert job["blueprint_version"] == 0 and get(admin, job)["blueprint_data"] is None
    assert client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"])).status_code == 400   # nothing to publish


# ------------------------------------------------------------------ Gemini generation and review/publish behaviour (unchanged)
def test_generation_stores_a_validated_blueprint_and_never_publishes(monkeypatch, admin):
    h.patch_gemini_blueprint(monkeypatch)
    job = role(admin)
    r = generate(admin, job)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["blueprint_version"] == 1 and body["blueprint"]["valid"] is True
    assert (body["blueprint"]["aptitude_count"], body["blueprint"]["coding_count"], body["blueprint"]["interview_count"]) == (15, 2, 5)
    assert body["status"] == "DRAFT" and body["is_published"] is False and body["share_path"] is None
    pub = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"]))
    assert pub.status_code == 200 and pub.json()["status"] == "PUBLISHED" and pub.json()["share_path"].startswith("/assessment/join/")


def test_regeneration_creates_a_new_version_and_keeps_the_history(monkeypatch, admin):
    h.patch_gemini_blueprint(monkeypatch)
    job = role(admin)
    assert generate(admin, job).json()["blueprint_version"] == 1
    assert generate(admin, job).json()["blueprint_version"] == 2
    db = h.new_session()
    try:
        versions = [v.version for v in db.query(models.JobBlueprintVersion).filter_by(job_description_id=job["id"]).order_by(models.JobBlueprintVersion.version)]
        assert versions == [1, 2], "the replaced version stays in the history"
    finally:
        db.close()


def test_gemini_generation_is_labelled_gemini(monkeypatch, admin):
    job = role(admin)
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE0123456789")

    def post(url, json, headers, timeout):
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": jsonlib.dumps(gemini_mock_fixtures.sample_blueprint())}]}}]})

    monkeypatch.setattr(gemini_client.httpx, "post", post)
    r = generate(admin, job)
    assert r.status_code == 200, r.text
    assert r.json()["blueprint"]["source"] == "gemini" and r.json()["blueprint_data"]["generation"]["label"] == "Gemini"


def test_offline_mock_mode_is_not_labelled_gemini(monkeypatch, admin):
    job = role(admin)
    monkeypatch.setenv("GEMINI_MOCK_MODE", "true")
    r = generate(admin, job)
    assert r.status_code == 200 and r.json()["blueprint"]["source"] == "offline_fixture"


# ------------------------------------------------------------------ Gemini unavailable: a visible failure, nothing implied, nothing replaced
def test_gemini_unavailable_fails_visibly_and_stores_nothing(monkeypatch, admin):
    h.patch_gemini_blueprint(monkeypatch, fail=True)
    job = role(admin)
    r = generate(admin, job)
    assert r.status_code == 502
    assert r.json()["detail"], "the admin is told why"
    after = get(admin, job)
    assert after["blueprint_data"] is None and after["blueprint_version"] == 0 and not (after["blueprint"] or {}).get("valid")
    assert client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"])).status_code == 400   # cannot publish nothing


def test_quota_exhaustion_is_reported_as_unavailable_not_success(monkeypatch, admin):
    job = role(admin)
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE0123456789")
    calls = {"n": 0}

    def post(url, json, headers, timeout):
        calls["n"] += 1
        return httpx.Response(402, json={"error": {"status": "RESOURCE_EXHAUSTED", "message": "Your prepayment credits are depleted."}})

    monkeypatch.setattr(gemini_client.httpx, "post", post)
    monkeypatch.setattr("services.jd_blueprint_service._sleep", lambda s: None)
    r = generate(admin, job)
    assert r.status_code == 502 and ("quota" in r.text.lower() or "credit" in r.text.lower())
    assert calls["n"] <= 2, "a depleted account is not hammered with retries"
    assert get(admin, job)["blueprint_data"] is None


def test_a_failed_regeneration_preserves_the_existing_blueprint(monkeypatch, admin):
    job = role(admin)
    h.patch_gemini_blueprint(monkeypatch)
    assert generate(admin, job).status_code == 200
    before = get(admin, job)
    h.patch_gemini_blueprint(monkeypatch, fail=True)
    assert generate(admin, job).status_code == 502
    after = get(admin, job)
    assert after["blueprint_data"] == before["blueprint_data"] and after["blueprint_version"] == before["blueprint_version"]


# ------------------------------------------------------------------ access control and tenant isolation
def test_access_control_and_tenant_isolation(monkeypatch, db, admin):
    h.patch_gemini_blueprint(monkeypatch)
    job = role(admin)
    other = h.make_admin(db)
    try:
        assert generate(other, job).status_code == 404                         # another tenant cannot touch it
        assert get(admin, job)["blueprint_data"] is None
        assert client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint").status_code == 401
        student = models.User(email=f"stu.{h.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.STUDENT, organization_id=admin["org"].id)
        db.add(student)
        db.commit()
        tok = utils.create_access_token(data={"sub": student.email, "role": student.role})
        assert client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(tok)).status_code in (401, 403)
        assert generate(admin, job).status_code == 200
        assert client.get(f"/api/admin/job-roles/{job['id']}", headers=h.auth(other["token"])).status_code == 404
    finally:
        h.cleanup_orgs(db, [other["org"].id])


# ------------------------------------------------------------------ complete candidate path on a Gemini-path blueprint
def sit(db, pub, *, aptitude_correct=15, coding=None, name="Pipeline Candidate"):
    reg, _ = h.register(pub["share_token"], name=name)
    assert reg.status_code == 200, reg.text
    started = h.start_ok(pub["share_token"], reg.json()["registration_token"])
    answers = {"answers": h.correct_aptitude_answers(db, started["session_uuid"], aptitude_correct)}
    s1 = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=answers).json()
    assert s1["state"] == "CODING_IN_PROGRESS"
    client.post(h.sess_url(started, "start-coding"), headers=h.sh(started))
    r2 = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": coding or h.GOOD_SOLUTIONS})
    s2 = r2.json()["detail"] if r2.status_code == 503 else r2.json()      # sandbox down: 503 carries the already-advanced state
    assert s2["state"] == "INTERVIEW_IN_PROGRESS", s2
    client.post(h.sess_url(started, "start-interview"), headers=h.sh(started))
    qs = client.get(h.sess_url(started, "state"), headers=h.sh(started)).json()["section"]["questions"]
    s3 = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started),
                     json={"answers": {q["id"]: "I would explain the concept, the trade-offs and the edge cases, then verify the fix with a test." for q in qs}}).json()
    return started, qs, s3


def test_candidate_completes_all_three_sections_and_results_use_the_existing_pipeline(db, admin, monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch, score=70.0)
    pub = h.create_published_job(admin, monkeypatch)
    meta = client.get(f"/api/public/assessment/{pub['share_token']}").json()
    assert [s["minutes"] for s in meta["sections"]] == [20, 20, 20] and meta["total_duration_minutes"] == 60
    started, qs, s3 = sit(db, pub, aptitude_correct=12)
    assert s3["state"] == "COMPLETED"
    assert len(qs) == 5 and all(set(q) == {"id", "category", "question"} for q in qs), "rubrics stay server side"
    row = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"]), params={"search": "pipeline candidate"}).json()["items"][0]
    row_apt = 12 * 100 / 15
    assert row["status"] == "COMPLETED"
    assert row["aptitude_score"] == round(row_apt, 2)
    assert row["coding_score"] == 100.0
    assert row["interview_score"] == 70.0
    assert row["overall_score"] == round((row_apt + 100.0 + 70.0) / 3, 2)
    dossier = client.get(f"/api/admin/recruitment/candidates/{row['id']}/dossier", headers=h.auth(admin["token"])).json()
    assert dossier["report"]["sections"]["coding"]["score"] == 100.0


def test_wrong_answers_and_wrong_code_lower_the_scores(db, admin, monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch, score=50.0)
    pub = h.create_published_job(admin, monkeypatch)
    half_right = {"C1": h.GOOD_SOLUTIONS["C1"], "C2": {"language": "python", "code": h.program("def solve(s):\n    return '__never__'\n")}}
    sit(db, pub, aptitude_correct=0, coding=half_right, name="Partial Candidate")
    row = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"]), params={"search": "partial candidate"}).json()["items"][0]
    assert row["aptitude_score"] == 0.0
    assert 0.0 < row["coding_score"] < 100.0, "one problem fully right, the other wrong"
    assert row["overall_score"] == round((row["aptitude_score"] + row["coding_score"] + 50.0) / 3, 2)


def test_without_a_sandbox_or_gemini_scores_stay_pending_not_invented(db, admin, monkeypatch):
    """The honest outcome during an outage: aptitude is scored; coding and interview wait for their (external) evaluators."""
    h.reset_public_limiters()
    pub = h.create_published_job(admin, monkeypatch)
    h.install_local_sandbox(monkeypatch, fail=True)       # sandbox unreachable
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: None)
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: False)

    def unavailable(*a, **k):                                # publishing patched call_gemini with the blueprint stub; undo that
        raise gemini_client.GeminiUnavailableError("simulated outage")

    monkeypatch.setattr(gemini_client, "call_gemini", unavailable)
    started, qs, s3 = sit(db, pub, name="Offline Candidate")
    row = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"]), params={"search": "offline candidate"}).json()["items"][0]
    assert row["status"] == "EVALUATION_PENDING" and row["needs_review"] is True
    assert row["aptitude_score"] == 100.0
    assert row["coding_score"] is None and row["interview_score"] is None and row["overall_score"] is None, "no fabricated scores or overall"
