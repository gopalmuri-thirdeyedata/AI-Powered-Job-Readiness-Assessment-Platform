"""End-to-end: Admin creates role -> Gemini blueprint -> publish -> candidate link -> register -> 60-min sitting -> admin dossier."""
import json

import pytest

import database
import models
from tests import recruitment_helpers as h

client = h.client


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


def test_full_recruitment_lifecycle_through_real_backend_and_database(db, monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch, score=84.0)
    admin = h.make_admin(db)
    try:
        # --- Admin: create role, generate and review the blueprint, publish
        h.patch_gemini_blueprint(monkeypatch)
        job = h.create_job(admin, title="Senior Backend Engineer")
        gen = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(admin["token"])).json()
        assert gen["blueprint"]["valid"] and gen["status"] == "DRAFT"
        pub = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"])).json()
        link = pub["share_path"]
        assert link.startswith("/assessment/join/") and pub["share_token"] in link

        # --- Candidate: open the shared link, register (3 fields only), accept the rules, start
        meta = client.get(f"/api/public/assessment{link[len('/assessment/join'):]}").json()
        assert meta["title"] == "Senior Backend Engineer" and meta["total_duration_minutes"] == 60
        reg, email = h.register(pub["share_token"], name="Priya Sharma", phone="+91 98765 43210", email=" Priya.Sharma@Example.COM ")
        assert reg.status_code == 200 and set(reg.json()) == {"registration_token", "message", "assessment"}
        started = h.start_ok(pub["share_token"], reg.json()["registration_token"])
        assert started["state"]["section"]["key"] == "aptitude"

        # roster shows the sitting live, before it ends
        live = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"]), params={"status": "IN_PROGRESS"}).json()
        assert [i["name"] for i in live["items"]] == ["Priya Sharma"]

        # --- Section 1: Aptitude (autosave a draft, then submit)
        answers = {"answers": h.correct_aptitude_answers(db, started["session_uuid"], 12)}
        assert client.put(h.sess_url(started, "draft"), headers=h.sh(started), json={"section": "aptitude", "payload": answers}).status_code == 200
        assert client.post(h.sess_url(started, "heartbeat"), headers=h.sh(started)).status_code == 200
        s1 = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json=answers).json()
        assert s1["state"] == "CODING_IN_PROGRESS"

        # --- Section 2: Coding (public run, then graded submission)
        assert client.post(h.sess_url(started, "start-coding"), headers=h.sh(started)).status_code == 200
        run = client.post(h.sess_url(started, "run-code"), headers=h.sh(started), json={"problem_id": "C1", "code": h.GOOD_SOLUTIONS["C1"]["code"]}).json()
        assert run["all_passed"] is True
        s2 = client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS}).json()
        assert s2["state"] == "INTERVIEW_IN_PROGRESS"

        # --- Section 3: AI technical interview (student interview format; rubric never sent to the candidate)
        assert client.post(h.sess_url(started, "start-interview"), headers=h.sh(started)).status_code == 200
        qs = client.get(h.sess_url(started, "state"), headers=h.sh(started)).json()["section"]["questions"]
        assert len(qs) == 5 and all(set(q) == {"id", "category", "question"} for q in qs)
        s3 = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started),
                         json={"answers": {q["id"]: f"My structured answer to {q['id']}" for q in qs}}).json()
        assert s3["state"] == "COMPLETED"
        fin = client.post(h.sess_url(started, "finalize"), headers=h.sh(started))
        assert fin.status_code == 200 and fin.json()["state"] == "COMPLETED"
        assert "score" not in json.dumps(fin.json()).lower().replace("evaluation_pending", "")  # candidates never see scores

        # --- Admin: roster + dossier from the real database
        roster = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"]), params={"search": "priya"}).json()
        assert roster["total"] == 1
        row = roster["items"][0]
        assert row["status"] == "COMPLETED" and row["email"] == "priya.sharma@example.com" and row["phone"] == "+919876543210"
        apt = round(12 * 100 / 15, 2)
        assert row["aptitude_score"] == apt and row["coding_score"] == 100.0 and row["interview_score"] == 84.0
        assert row["overall_score"] == round((apt + 100.0 + 84.0) / 3, 2)

        dossier = client.get(f"/api/admin/recruitment/candidates/{row['id']}/dossier", headers=h.auth(admin["token"])).json()
        assert dossier["report"]["overall_score"] == row["overall_score"] and dossier["report"]["complete"] is True
        assert dossier["session"]["state"] == "COMPLETED" and dossier["session"]["finalized_at"]
        stats = client.get("/api/admin/recruitment/overview-stats", headers=h.auth(admin["token"])).json()
        assert stats["completed"] == 1 and stats["average_score"] == row["overall_score"] and stats["total_registrations"] == 1

        # --- One attempt only: no restart, no second registration with the same email
        assert h.start(pub["share_token"], reg.json()["registration_token"]).status_code == 409
        again, _ = h.register(pub["share_token"], email="priya.sharma@example.com")
        assert again.status_code == 409 and "registration_token" not in again.text
    finally:
        h.cleanup_orgs(db, [admin["org"].id])


def test_existing_student_and_recruiter_modules_still_serve():
    """Regression guard: the shared models/auth changes must not break unrelated routers."""
    assert client.get("/").status_code == 200
    assert client.get("/health/live").json()["status"] == "alive"
    assert client.get("/api/student/profile").status_code in (401, 403)  # still auth-protected, route intact
    assert client.get("/api/resume/candidates/").status_code == 401
    assert client.get("/api/roleready/student/assessments").status_code in (401, 403)


def test_recruitment_sessions_stay_out_of_legacy_views_and_endpoints(db, monkeypatch):
    """Legacy student/invitation modules must neither list nor operate on shared-link recruitment sittings."""
    from services import roleready_service
    h.reset_public_limiters()
    admin = h.make_admin(db)
    try:
        job = h.create_published_job(admin, monkeypatch)
        token, _ = h.register_ok(job["share_token"])
        started = h.start_ok(job["share_token"], token)

        rows = roleready_service.get_admin_tracking_data(db, admin["org"].id)
        assert started["session_uuid"] not in {r.get("session_uuid") for r in rows}

        for method, path in (("get", f"/api/roleready/session/{started['session_uuid']}"),
                             ("post", f"/api/roleready/session/{started['session_uuid']}/start-aptitude")):
            r = getattr(client, method)(path, headers=h.auth(admin["token"]))
            assert r.status_code in (403, 404), (path, r.status_code)
        row = h.session_row(db, started["session_uuid"])
        assert row.current_state == "APTITUDE_IN_PROGRESS"  # untouched by the legacy attempt
    finally:
        h.cleanup_orgs(db, [admin["org"].id])
