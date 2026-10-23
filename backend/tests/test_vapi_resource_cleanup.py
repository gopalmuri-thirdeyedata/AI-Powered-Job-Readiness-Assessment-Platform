"""
Vapi resource handling: every interview provisions an ephemeral voice assistant on the Vapi account. A session may own at most
ONE live assistant, a replaced one is deleted, the last one is deleted when the interview closes, cleanup never breaks an
assessment, and the test suite itself never touches the real Vapi API (see the `vapi_http` stub in conftest.py).

MOCKED: all Vapi HTTP. This proves the bookkeeping and the cleanup calls, not the live Vapi service.
"""
import json

import pytest

import models
from services import vapi_service
from tests import recruitment_helpers as h
from tests.test_recruitment_unified_engine import _setup, _to_interview, clk, db, env, started  # noqa: F401
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (student fixtures)

client = h.client


def created(stub):
    return [c for c in stub.calls if c["method"] == "POST"]


def deleted(stub):
    return [c["url"].rsplit("/", 1)[-1] for c in stub.calls if c["method"] == "DELETE"]


def stored_id(db, session_uuid, student=False):
    db.expire_all()
    sess = db.query(models.RoleReadySession).filter_by(session_uuid=session_uuid).first()
    rnd = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=sess.id, round_type="INTERVIEW").first()
    return (rnd.server_keys_payload or {}).get("vapi_assistant_id")


# ------------------------------------------------------------------------------ the low-level calls
def test_the_suite_never_reaches_the_real_vapi_api(vapi_http):
    assert vapi_http is not None and vapi_service.requests is vapi_http


def test_delete_assistant_sends_an_authenticated_delete_with_a_timeout(vapi_http):
    assert vapi_service.delete_assistant("00000000-0000-4000-8000-000000000042") is True
    call = vapi_http.calls[-1]
    assert call["method"] == "DELETE" and call["url"].endswith("/assistant/00000000-0000-4000-8000-000000000042")
    assert call["headers"]["Authorization"].startswith("Bearer ") and call["timeout"] == vapi_service.REQUEST_TIMEOUT_SECONDS


@pytest.mark.parametrize("bad", ["../../call", "abc/def", "id with spaces", "", None, 123, "x" * 100, "00000000-0000-4000-8000-000000000042/../x"])
def test_delete_assistant_rejects_unsafe_ids_without_any_network_call(vapi_http, bad):
    assert vapi_service.delete_assistant(bad) is False
    assert vapi_http.calls == []


def test_delete_assistant_never_raises_and_treats_already_gone_as_success(vapi_http, monkeypatch):
    monkeypatch.setattr(vapi_http, "delete", lambda *a, **k: (_ for _ in ()).throw(TimeoutError("slow")))
    assert vapi_service.delete_assistant("00000000-0000-4000-8000-000000000042") is False
    monkeypatch.setattr(vapi_http, "delete", lambda *a, **k: vapi_http._Response(404, {}))
    assert vapi_service.delete_assistant("00000000-0000-4000-8000-000000000042") is True
    monkeypatch.setattr(vapi_http, "delete", lambda *a, **k: vapi_http._Response(500, {}))
    assert vapi_service.delete_assistant("00000000-0000-4000-8000-000000000042") is False


def test_delete_assistant_without_a_key_makes_no_call(vapi_http, monkeypatch):
    monkeypatch.delenv("VAPI_PRIVATE_KEY", raising=False)
    monkeypatch.setattr(vapi_service, "VAPI_PRIVATE_KEY", None)
    assert vapi_service.delete_assistant("00000000-0000-4000-8000-000000000042") is False and vapi_http.calls == []


def test_assistant_creation_has_a_timeout(vapi_http):
    assert vapi_service.create_ephemeral_assistant("A", "Dev", questions=[{"id": 1, "question": "q"}]) is not None
    assert created(vapi_http)[0]["timeout"] == vapi_service.REQUEST_TIMEOUT_SECONDS


# ------------------------------------------------------------------------------ recruitment sitting
def test_each_sitting_owns_exactly_one_live_assistant_and_it_is_deleted_at_the_end(db, env, clk, vapi_http):
    s = _to_interview(db, env)
    first = client.post(h.sess_url(s, "vapi-init"), headers=h.sh(s)).json()["assistantId"]
    assert len(created(vapi_http)) == 1 and deleted(vapi_http) == [] and stored_id(db, s["session_uuid"]) == first

    second = client.post(h.sess_url(s, "vapi-init"), headers=h.sh(s)).json()["assistantId"]     # the browser retried
    assert second != first and stored_id(db, s["session_uuid"]) == second
    assert deleted(vapi_http) == [first]                                                          # the replaced one is gone
    live = {c for c in (first, second)} - set(deleted(vapi_http))
    assert live == {second}

    r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": [], "transcript": []})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    assert deleted(vapi_http) == [first, second] and stored_id(db, s["session_uuid"]) is None


def test_the_assistant_id_is_server_side_bookkeeping_only(db, env, clk, vapi_http):
    s = _to_interview(db, env)
    assistant = client.post(h.sess_url(s, "vapi-init"), headers=h.sh(s)).json()["assistantId"]    # the one intended hand-over
    state = client.get(h.sess_url(s, "state"), headers=h.sh(s))
    assert assistant not in state.text
    reg = db.query(models.CandidateRegistration).filter_by(attempt_session_uuid=s["session_uuid"]).first()
    client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": [], "transcript": []})
    dossier = client.get(f"/api/admin/recruitment/candidates/{reg.id}/dossier", headers=h.auth(env["admin"]["token"]))
    assert "vapi_assistant_id" not in dossier.text and assistant not in dossier.text


def test_cleanup_failure_never_breaks_the_submission(db, env, clk, vapi_http, monkeypatch):
    s = _to_interview(db, env)
    client.post(h.sess_url(s, "vapi-init"), headers=h.sh(s))
    monkeypatch.setattr(vapi_http, "delete", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("vapi down")))
    r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": [], "transcript": []})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"


def test_sittings_only_ever_delete_their_own_assistant(db, env, clk, vapi_http):
    a, b = _to_interview(db, env), _to_interview(db, env)
    id_a = client.post(h.sess_url(a, "vapi-init"), headers=h.sh(a)).json()["assistantId"]
    id_b = client.post(h.sess_url(b, "vapi-init"), headers=h.sh(b)).json()["assistantId"]
    client.post(h.sess_url(a, "submit-interview"), headers=h.sh(a), json={"answers": [], "transcript": []})
    assert deleted(vapi_http) == [id_a] and stored_id(db, b["session_uuid"]) == id_b


def test_a_failed_provisioning_stores_nothing_and_deletes_nothing(db, env, clk, vapi_http, monkeypatch):
    monkeypatch.setattr(vapi_http, "post", lambda *a, **k: vapi_http._Response(500, {"message": "boom"}))
    s = _to_interview(db, env)
    body = client.post(h.sess_url(s, "vapi-init"), headers=h.sh(s)).json()
    assert body["assistantId"] is None and body["assistantConfig"]["maxDurationSeconds"] > 0      # the browser still gets the inline config
    assert stored_id(db, s["session_uuid"]) is None and deleted(vapi_http) == []


# ------------------------------------------------------------------------------ student sitting
def test_student_interview_follows_the_same_assistant_lifecycle(db_session, setup_test_data, vapi_http):
    from services import roleready_service as rs
    session = rs.create_student_session(db=db_session, student_profile=setup_test_data["student_profile"], target_role="Dev", target_company="X",
                                        custom_jd_text="Python services", resume_snapshot={"skills": ["Python"]})
    session.current_state = models.RoleReadySessionState.INTERVIEW_UNLOCKED
    db_session.commit()
    hdr = setup_test_data["auth_headers"]
    url = f"/api/roleready/session/{session.session_uuid}"
    first = client.post(f"{url}/vapi-init", headers=hdr).json()["assistantId"]
    second = client.post(f"{url}/vapi-init", headers=hdr).json()["assistantId"]
    assert first and second and first != second and deleted(vapi_http) == [first]
    assert stored_id(db_session, session.session_uuid) == second
    r = client.post(f"{url}/submit-interview", headers=hdr, json={"answers": []})
    assert r.status_code == 200 and r.json()["current_state"] == models.RoleReadySessionState.COMPLETED
    assert deleted(vapi_http) == [first, second] and stored_id(db_session, session.session_uuid) is None
    assert second not in json.dumps(client.get(url, headers=hdr).json())                         # never part of a status payload
