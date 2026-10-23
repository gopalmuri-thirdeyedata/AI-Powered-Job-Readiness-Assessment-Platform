"""
When a shared assessment link accepts candidates, and what happens to everything else when it stops.

Facts this file pins down (they are the CURRENT behaviour; the data model has no link-expiry timestamp, and the finalized plan
says links "do not expire ... they remain active as long as the assessment is published and open"):
  * the only way a link stops working is an admin closing the role (status CLOSED, is_published False); reopening restores the
    SAME link;
  * every public entry point (metadata, registration, start) goes through one server-side check, so a retained URL cannot be
    used for a new registration or a new attempt once the role is closed;
  * closing never touches candidates already sitting, and never deletes or rewrites registrations, attempts or results;
  * a link never ages out by itself, however old it is.
"""
from datetime import datetime, timezone

import pytest

import models
from tests import recruitment_helpers as h

client = h.client


@pytest.fixture()
def db():
    s = h.new_session()
    yield s
    s.close()


@pytest.fixture()
def env(db, monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    admin = h.make_admin(db)
    job = h.create_published_job(admin, monkeypatch)
    yield {"admin": admin, "job": job, "token": job["share_token"]}
    h.cleanup_orgs(db, [admin["org"].id])


def roles(admin):
    return client.get("/api/admin/job-roles/", headers=h.auth(admin["token"])).json()


def role(admin, job):
    return next(r for r in roles(admin) if r["id"] == job["id"])


def close(env):
    return client.post(f"/api/admin/job-roles/{env['job']['id']}/close", headers=h.auth(env["admin"]["token"]))


def reopen(env):
    return client.post(f"/api/admin/job-roles/{env['job']['id']}/publish", headers=h.auth(env["admin"]["token"]))


def public_get(token):
    return client.get(f"/api/public/assessment/{token}")


# ------------------------------------------------------------------ active links
def test_an_active_link_is_listed_with_its_link_and_accepts_candidates(env):
    listed = role(env["admin"], env["job"])
    assert listed["status"] == "PUBLISHED" and listed["is_published"] is True
    assert listed["share_token"] == env["token"] and listed["share_path"].endswith(env["token"])
    assert public_get(env["token"]).status_code == 200
    reg, _ = h.register(env["token"])
    assert reg.status_code == 200
    assert h.start(env["token"], reg.json()["registration_token"]).status_code == 200


def test_a_link_never_ages_out_by_itself(db, env):
    """No expiry exists: an assessment published years ago behaves exactly like one published a minute ago."""
    long_ago = datetime(2019, 1, 1, tzinfo=timezone.utc)
    db.query(models.JobDescription).filter_by(id=env["job"]["id"]).update({"uploaded_at": long_ago, "updated_at": long_ago})
    db.commit()
    assert public_get(env["token"]).status_code == 200
    reg, _ = h.register(env["token"])
    assert reg.status_code == 200
    assert h.start(env["token"], reg.json()["registration_token"]).status_code == 200
    assert role(env["admin"], env["job"])["status"] == "PUBLISHED"


# ------------------------------------------------------------------ closed links
def test_a_closed_link_is_not_usable_by_new_candidates_even_with_the_retained_url(env):
    pending_reg, _ = h.register(env["token"])                              # registered while the link was open, not started yet
    assert pending_reg.status_code == 200
    assert close(env).status_code == 200

    assert public_get(env["token"]).status_code == 410                     # metadata
    new_reg, _ = h.register(env["token"])
    assert new_reg.status_code == 410                                      # new registration
    started = h.start(env["token"], pending_reg.json()["registration_token"])
    assert started.status_code == 410                                      # new attempt, even with a capability issued earlier
    for variant in (env["token"].upper(), env["token"][:-1], f" {env['token']}", env["token"] + "x"):
        assert public_get(variant).status_code in (404, 410), variant      # no look-alike URL reaches the assessment


def test_the_admin_list_reports_a_closed_role_as_closed_and_never_as_active(env):
    assert close(env).status_code == 200
    listed = role(env["admin"], env["job"])
    assert listed["status"] == "CLOSED" and listed["is_published"] is False
    assert listed["share_token"] is None and listed["share_url"] is None and listed["share_path"] is None   # the URL is not handed out
    again = role(env["admin"], env["job"])                                  # a refresh / a direct list call changes nothing
    assert again["status"] == "CLOSED"
    assert client.get(f"/api/admin/job-roles/{env['job']['id']}", headers=h.auth(env["admin"]["token"])).json()["status"] == "CLOSED"


def test_reopening_restores_the_same_link(env):
    assert close(env).status_code == 200
    assert public_get(env["token"]).status_code == 410
    assert reopen(env).status_code == 200
    assert public_get(env["token"]).status_code == 200
    assert role(env["admin"], env["job"])["share_token"] == env["token"]


def test_closing_does_not_disturb_candidates_already_sitting(db, env):
    reg, _ = h.register(env["token"])
    started = h.start_ok(env["token"], reg.json()["registration_token"])
    assert close(env).status_code == 200
    assert client.get(h.sess_url(started, "state"), headers=h.sh(started)).status_code == 200
    answers = h.correct_aptitude_answers(db, started["session_uuid"])
    r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": answers})
    assert r.status_code == 200 and r.json()["state"] == "CODING_IN_PROGRESS"


# ------------------------------------------------------------------ history is never touched
def test_closing_keeps_every_registration_attempt_and_result_readable(db, env, monkeypatch):
    h.patch_interview_eval(monkeypatch, score=80.0)
    reg, email = h.register(env["token"])
    started = h.start_ok(env["token"], reg.json()["registration_token"])
    client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": h.correct_aptitude_answers(db, started["session_uuid"])})
    client.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS})
    done = client.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": {}, "transcript": []})
    assert done.status_code == 200 and done.json()["state"] == "COMPLETED"
    quiet = h.register(env["token"], name="Never Started")[0]
    assert quiet.status_code == 200

    def snapshot():
        db.expire_all()
        sess = db.query(models.RoleReadySession).filter_by(session_uuid=started["session_uuid"]).first()
        rows = db.query(models.CandidateRegistration).filter_by(job_description_id=env["job"]["id"]).count()
        return (rows, sess.current_state, sess.aptitude_score, sess.coding_score, sess.interview_score, sess.overall_readiness_score, str(sess.final_report_data))

    before = snapshot()
    items_before = client.get("/api/admin/recruitment/candidates", headers=h.auth(env["admin"]["token"]), params={"page_size": 100}).json()["items"]
    assert close(env).status_code == 200
    assert snapshot() == before, "closing the link changed no stored record"

    items = client.get("/api/admin/recruitment/candidates", headers=h.auth(env["admin"]["token"]), params={"page_size": 100}).json()["items"]
    assert items == items_before and len(items) == 2
    completed = next(i for i in items if i["email"] == email)
    assert completed["status"] == "COMPLETED" and completed["overall_score"] is not None
    dossier = client.get(f"/api/admin/recruitment/candidates/{completed['id']}/dossier", headers=h.auth(env["admin"]["token"]))
    assert dossier.status_code == 200 and dossier.json()["report"]["overall_score"] == completed["overall_score"]


def test_another_organization_cannot_close_reopen_or_see_this_link(db, env):
    other = h.make_admin(db)
    try:
        assert client.post(f"/api/admin/job-roles/{env['job']['id']}/close", headers=h.auth(other["token"])).status_code == 404
        assert env["job"]["id"] not in [r["id"] for r in roles(other)]
        assert public_get(env["token"]).status_code == 200, "a foreign close attempt did not affect the link"
    finally:
        h.cleanup_orgs(db, [other["org"].id])
