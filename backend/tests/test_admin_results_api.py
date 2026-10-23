import json

import pytest

import database
import models
import utils
from services import assessment_flow_service as flow
from tests import recruitment_helpers as h

client = h.client
BASE = "/api/admin/recruitment"


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def world(db):
    mp = pytest.MonkeyPatch()
    a = h.make_admin(db)
    hr = h.make_admin(db, org=a["org"], member_role="HR")
    b = h.make_admin(db)
    job_a = h.create_published_job(a, mp)
    job_a2 = h.create_published_job(a, mp, title="Data Engineer")
    job_b = h.create_published_job(b, mp)
    yield {"a": a, "hr": hr, "b": b, "job_a": job_a, "job_a2": job_a2, "job_b": job_b, "mp": mp}
    mp.undo()
    h.cleanup_orgs(db, [a["org"].id, b["org"].id])


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    yield
    h.reset_public_limiters()


def reg_id(db, email):
    db.expire_all()
    return db.query(models.CandidateRegistration).filter_by(email=email).first().id


def complete_candidate(db, job, name, email, correct=15):
    token, email = h.register_ok(job["share_token"], name=name, email=email)
    s = h.start_ok(job["share_token"], token)
    client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"], correct)})
    client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})
    r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": {f"I{i}": "my answer" for i in range(1, 6)}})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    return s, token, email


@pytest.fixture(scope="module")
def roster(db, world):
    """A fixed, known data set for tenant A (plus one candidate in tenant B)."""
    mp = pytest.MonkeyPatch()
    h.install_local_sandbox(mp)
    h.patch_interview_eval(mp)
    data = {}
    ja, ja2, jb = world["job_a"], world["job_a2"], world["job_b"]
    data["alice"] = complete_candidate(db, ja, "Alice Zephyr", "alice.zephyr@rwtest.example.com", correct=15)
    h.reset_public_limiters()
    data["bob"] = complete_candidate(db, ja, "Bob Quill", "bob.quill@rwtest.example.com", correct=3)
    h.reset_public_limiters()
    tok, email = h.register_ok(ja["share_token"], name="Cara Abandon", email="cara.abandon@rwtest.example.com")
    s = h.start_ok(ja["share_token"], tok)
    # Abandonment is decided from server evidence (heartbeat loss), never from a browser beacon alone
    from services import assessment_flow_service as flow
    assert flow.abandon_session(db, h.session_row(db, s["session_uuid"]).id, "heartbeat_lost")
    data["cara"] = (s, tok, email)
    h.reset_public_limiters()
    tok, email = h.register_ok(ja2["share_token"], name="Dan Pending", email="dan.pending@rwtest.example.com")
    data["dan"] = (None, tok, email)
    h.reset_public_limiters()
    tok, email = h.register_ok(jb["share_token"], name="Eve Othertenant", email="eve.other@rwtest.example.com")
    s = h.start_ok(jb["share_token"], tok)
    data["eve"] = (s, tok, email)
    mp.undo()
    h.reset_public_limiters()
    return data


def get_roster(world, who="a", **params):
    r = client.get(f"{BASE}/candidates", headers=h.auth(world[who]["token"]), params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ KPIs
def test_overview_stats_real_counts(db, world, roster):
    stats = client.get(f"{BASE}/overview-stats", headers=h.auth(world["a"]["token"])).json()
    assert stats["active_jobs"] == 2
    assert stats["total_registrations"] == 4
    assert stats["completed"] == 2 and stats["incomplete"] == 1 and stats["in_progress"] == 0
    assert stats["not_started"] == 1
    rows = db.query(models.RoleReadySession).filter(models.RoleReadySession.organization_id == world["a"]["org"].id,
                                                    models.RoleReadySession.current_state == "COMPLETED").all()
    expected = round(sum(r.overall_readiness_score for r in rows) / len(rows), 2)
    assert stats["average_score"] == expected
    other = client.get(f"{BASE}/overview-stats", headers=h.auth(world["b"]["token"])).json()
    assert other["total_registrations"] == 1 and other["completed"] == 0 and other["in_progress"] == 1 and other["average_score"] is None


# ------------------------------------------------------------------ roster
def test_candidate_search_and_filter(world, roster):
    everyone = get_roster(world)
    assert everyone["total"] == 4
    assert {i["name"] for i in everyone["items"]} == {"Alice Zephyr", "Bob Quill", "Cara Abandon", "Dan Pending"}
    assert get_roster(world, search="zephyr")["items"][0]["name"] == "Alice Zephyr"
    assert get_roster(world, search="BOB.QUILL@")["total"] == 1
    assert get_roster(world, search="%")["total"] == 0 and get_roster(world, search="_")["total"] == 0  # wildcards are escaped
    assert get_roster(world, search="othertenant")["total"] == 0  # never reaches tenant B

    by_status = {s: get_roster(world, status=s)["total"] for s in ("COMPLETED", "INCOMPLETE", "ABANDONED", "TIMED_OUT", "REGISTERED", "IN_PROGRESS")}
    assert by_status == {"COMPLETED": 2, "INCOMPLETE": 1, "ABANDONED": 1, "TIMED_OUT": 0, "REGISTERED": 1, "IN_PROGRESS": 0}
    assert client.get(f"{BASE}/candidates", headers=h.auth(world["a"]["token"]), params={"status": "BOGUS"}).status_code == 422

    only_role2 = get_roster(world, job_role_id=world["job_a2"]["id"])
    assert [i["name"] for i in only_role2["items"]] == ["Dan Pending"]
    assert get_roster(world, job_role_id=world["job_b"]["id"])["total"] == 0  # another tenant's role id yields nothing


def test_roster_sorting_and_pagination(world, roster):
    by_score = get_roster(world, sort="score", order="desc")["items"]
    assert by_score[0]["name"] == "Alice Zephyr" and by_score[1]["name"] == "Bob Quill"
    assert by_score[0]["overall_score"] > by_score[1]["overall_score"]
    assert all(i["overall_score"] is None for i in by_score[2:])  # incomplete attempts never show a fabricated overall
    names = [i["name"] for i in get_roster(world, sort="name", order="asc")["items"]]
    assert names == sorted(names, key=str.lower)

    p1 = get_roster(world, page=1, page_size=3)
    p2 = get_roster(world, page=2, page_size=3)
    assert (p1["total"], p1["pages"], len(p1["items"]), len(p2["items"])) == (4, 2, 3, 1)
    assert not {i["id"] for i in p1["items"]} & {i["id"] for i in p2["items"]}
    assert client.get(f"{BASE}/candidates", headers=h.auth(world["a"]["token"]), params={"page_size": 1000}).status_code == 422


def test_partial_scores_visible_and_null_where_unattempted(world, roster):
    cara = next(i for i in get_roster(world)["items"] if i["name"] == "Cara Abandon")
    assert cara["status"] == "ABANDONED" and cara["overall_score"] is None
    assert cara["coding_score"] is None and cara["interview_score"] is None


def test_hr_member_can_read_roster(world, roster):
    r = client.get(f"{BASE}/candidates", headers=h.auth(world["hr"]["token"]))
    assert r.status_code == 200 and r.json()["total"] == 4


# ------------------------------------------------------------------ dossier
def test_candidate_dossier_complete(db, world, roster):
    rid = reg_id(db, "alice.zephyr@rwtest.example.com")
    r = client.get(f"{BASE}/candidates/{rid}/dossier", headers=h.auth(world["a"]["token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["candidate"]["name"] == "Alice Zephyr" and d["candidate"]["phone"] == "+14155550123"
    assert d["candidate"]["email"] == "alice.zephyr@rwtest.example.com" and d["candidate"]["contact_verified"] is False
    assert d["status"] == "COMPLETED" and d["session"]["state"] == "COMPLETED"
    rep = d["report"]
    assert set(rep["sections"]) == {"aptitude", "coding", "interview"}
    apt, cod, itv = (rep["sections"][k]["score"] for k in ("aptitude", "coding", "interview"))
    assert rep["overall_score"] == pytest.approx(round((apt + cod + itv) / 3, 2))
    assert len(rep["sections"]["aptitude"]["details"]["questions"]) == 15
    assert len(rep["sections"]["interview"]["details"]["questions"]) == 5
    assert [t["section"] for t in d["timeline"]] == ["aptitude", "coding", "interview"]
    assert all(t["started_at"] and t["submitted_at"] for t in d["timeline"])
    assert "hidden_test_cases" not in json.dumps(d) and "expected" not in json.dumps(rep["sections"]["coding"])
    assert d["actions"]["can_revoke"] is False


def test_cross_tenant_dossier_blocked(db, world, roster):
    eve = reg_id(db, "eve.other@rwtest.example.com")
    alice = reg_id(db, "alice.zephyr@rwtest.example.com")
    assert client.get(f"{BASE}/candidates/{eve}/dossier", headers=h.auth(world["a"]["token"])).status_code == 404
    assert client.get(f"{BASE}/candidates/{alice}/dossier", headers=h.auth(world["b"]["token"])).status_code == 404
    assert client.post(f"{BASE}/registrations/{eve}/revoke", headers=h.auth(world["a"]["token"])).status_code == 404
    assert client.get(f"{BASE}/candidates/{eve}/dossier", headers=h.auth(world["b"]["token"])).status_code == 200


def test_admin_endpoints_require_authentication_and_admin_role(db, world, roster):
    for method, path in (("get", "overview-stats"), ("get", "candidates"), ("get", "candidates/1/dossier"), ("post", "registrations/1/revoke")):
        assert getattr(client, method)(f"{BASE}/{path}").status_code == 401
    student = models.User(email=f"stu.{h.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.STUDENT, is_active=True)
    db.add(student)
    db.commit()
    tok = utils.create_access_token(data={"sub": student.email, "role": student.role})
    assert client.get(f"{BASE}/candidates", headers=h.auth(tok)).status_code == 403
    db.delete(student)
    db.commit()


# ------------------------------------------------------------------ revoke unstarted registration
def test_revoke_unstarted_registration_allows_clean_re_registration(db, world, roster):
    rid = reg_id(db, "dan.pending@rwtest.example.com")
    r = client.post(f"{BASE}/registrations/{rid}/revoke", headers=h.auth(world["hr"]["token"]))
    assert r.status_code == 200
    assert db.query(models.CandidateRegistration).filter_by(id=rid).first() is None
    log = db.query(models.ActivityLog).filter_by(action="REGISTRATION_REVOKED", organization_id=world["a"]["org"].id).first()
    assert log is not None and log.user_id == world["hr"]["user"].id
    again, _ = h.register(world["job_a2"]["share_token"], name="Dan Pending", email="dan.pending@rwtest.example.com")
    assert again.status_code == 200  # the stale registration no longer blocks him


def test_started_registration_cannot_be_revoked(db, world, roster):
    rid = reg_id(db, "cara.abandon@rwtest.example.com")
    assert client.post(f"{BASE}/registrations/{rid}/revoke", headers=h.auth(world["a"]["token"])).status_code == 409


# ------------------------------------------------------------------ audited outage retake / manual review
def make_state(db, job, name, state, incident="INCIDENT_TEST_1"):
    token, email = h.register_ok(job["share_token"], name=name)
    s = h.start_ok(job["share_token"], token)
    row = h.session_row(db, s["session_uuid"])
    row.current_state = state
    row.incident_reference_id = incident if state in ("INFRASTRUCTURE_FAILURE", "MANUAL_REVIEW_REQUIRED") else None
    db.commit()
    return s, token, email


def test_org_admin_authorizes_audited_retake_for_infrastructure_failure(db, world):
    h.reset_public_limiters()
    s, old_token, email = make_state(db, world["job_a"], "Frank Outage", "INFRASTRUCTURE_FAILURE")
    rid = reg_id(db, email)
    dossier = client.get(f"{BASE}/candidates/{rid}/dossier", headers=h.auth(world["a"]["token"])).json()
    assert dossier["actions"]["can_authorize_retake"] is True

    body = {"justification": "Verified platform outage INCIDENT_TEST_1; candidate was active."}
    # HR is not an organization owner
    assert client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["hr"]["token"]), json=body).status_code == 403
    assert client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["a"]["token"]), json={"justification": "short"}).status_code == 422
    # another tenant's admin cannot touch it
    assert client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["b"]["token"]), json=body).status_code == 404

    r = client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["a"]["token"]), json=body)
    assert r.status_code == 200, r.text
    new_token = r.json()["registration_token"]
    old = h.session_row(db, s["session_uuid"])
    assert old.current_state == "REVOKED_RETRIED" and old.registration_id is None  # archived, data retained
    log = db.query(models.ActivityLog).filter_by(action="ASSESSMENT_RETAKE_AUTHORIZED", organization_id=world["a"]["org"].id).first()
    assert log.user_id == world["a"]["user"].id and "INCIDENT_TEST_1" in log.details and "Verified platform outage" in log.details

    assert h.start(world["job_a"]["share_token"], old_token).status_code == 403  # the old capability is dead
    fresh = h.start(world["job_a"]["share_token"], new_token)
    assert fresh.status_code == 200 and fresh.json()["session_uuid"] != s["session_uuid"]
    assert h.start(world["job_a"]["share_token"], new_token).status_code == 409  # single-use
    assert client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["a"]["token"]), json=body).status_code == 409


def test_candidate_interrupted_sessions_are_never_retakeable(db, world):
    h.reset_public_limiters()
    for state in ("ABANDONED", "TIMED_OUT", "COMPLETED"):
        s, token, email = make_state(db, world["job_a"], f"Gina {state}", state)
        rid = reg_id(db, email)
        r = client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["a"]["token"]),
                        json={"justification": "please let them retry, thanks"})
        assert r.status_code == 409, state
        assert h.start(world["job_a"]["share_token"], token).status_code == 409
        h.reset_public_limiters()


def test_manual_review_can_be_rejected_without_retake_or_approved(db, world):
    h.reset_public_limiters()
    s, token, email = make_state(db, world["job_a"], "Hal Review", "MANUAL_REVIEW_REQUIRED")
    rid = reg_id(db, email)
    body = {"justification": "No platform evidence found in the server logs."}
    assert client.post(f"{BASE}/candidates/{rid}/reject-review", headers=h.auth(world["hr"]["token"]), json=body).status_code == 403
    r = client.post(f"{BASE}/candidates/{rid}/reject-review", headers=h.auth(world["a"]["token"]), json=body)
    assert r.status_code == 200 and r.json()["state"] == "ABANDONED"
    assert client.post(f"{BASE}/candidates/{rid}/authorize-retake", headers=h.auth(world["a"]["token"]),
                       json={"justification": "second thoughts, retry"}).status_code == 409

    s2, token2, email2 = make_state(db, world["job_a"], "Ida Review", "MANUAL_REVIEW_REQUIRED")
    rid2 = reg_id(db, email2)
    ok = client.post(f"{BASE}/candidates/{rid2}/authorize-retake", headers=h.auth(world["a"]["token"]),
                     json={"justification": "Logs confirm a database failover at that time."})
    assert ok.status_code == 200


def test_retry_evaluation_endpoint(db, world, monkeypatch):
    h.reset_public_limiters()
    h.patch_interview_eval(monkeypatch, source="fallback_default")
    token, email = h.register_ok(world["job_a"]["share_token"], name="Jo Pending")
    s = h.start_ok(world["job_a"]["share_token"], token)
    client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])})
    client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})
    client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": {f"I{i}": "x" for i in range(1, 6)}})
    rid = reg_id(db, email)
    d = client.get(f"{BASE}/candidates/{rid}/dossier", headers=h.auth(world["a"]["token"])).json()
    assert d["status"] == "EVALUATION_PENDING" and d["actions"]["can_retry_evaluation"] is True and d["report"]["overall_score"] is None

    h.patch_interview_eval(monkeypatch, score=70.0)  # Gemini is back
    r = client.post(f"{BASE}/candidates/{rid}/retry-evaluation", headers=h.auth(world["a"]["token"]))
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    d2 = client.get(f"{BASE}/candidates/{rid}/dossier", headers=h.auth(world["a"]["token"])).json()
    assert d2["status"] == "COMPLETED" and d2["report"]["overall_score"] == pytest.approx(round((100 + 100 + 70) / 3, 2))
    # a completed assessment is immutable
    assert client.post(f"{BASE}/candidates/{rid}/retry-evaluation", headers=h.auth(world["a"]["token"])).status_code == 409


# ------------------------------------------------------------------ platform incident registration
def test_incident_endpoint_is_platform_admin_only(db, world):
    body = {"outage_start_utc": "2026-10-22T01:00:00Z", "outage_resolved_utc": "2026-10-22T01:10:00Z", "affected_subsystems": ["database"]}
    assert client.post(f"{BASE}/incidents", headers=h.auth(world["a"]["token"]), json=body).status_code == 403
    pa = models.User(email=f"pa.{h.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.PLATFORM_ADMIN, is_active=True)
    db.add(pa)
    db.commit()
    tok = utils.create_access_token(data={"sub": pa.email, "role": pa.role})
    r = client.post(f"{BASE}/incidents", headers=h.auth(tok), json=body)
    assert r.status_code == 200 and r.json()["incident_reference_id"].startswith("INCIDENT_")
    bad = client.post(f"{BASE}/incidents", headers=h.auth(tok), json={**body, "outage_resolved_utc": "2026-10-22T00:00:00Z"})
    assert bad.status_code == 422
    db.query(models.IncidentRecord).filter(models.IncidentRecord.created_by == pa.id).delete()
    db.delete(pa)
    db.commit()
