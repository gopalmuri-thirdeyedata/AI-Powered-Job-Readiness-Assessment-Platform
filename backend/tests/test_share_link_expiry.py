"""
24-hour expiry of Admin Recruitment shared links. Time is the controllable server clock (services.assessment_clock);
nothing waits and no browser value is ever consulted. The RoleReady invitation system is covered by its own suites.
"""
from datetime import datetime, timedelta, timezone

import pytest

import models
from services import assessment_clock
from services import share_link_policy as policy
from tests import recruitment_helpers as h

client = h.client
ROLES = "/api/admin/job-roles"
HOUR = 3600


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


@pytest.fixture
def clock(monkeypatch):
    fake = h.FakeClock(datetime(2030, 1, 15, 9, 0, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(assessment_clock, "now", fake.now)
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    yield fake
    h.reset_public_limiters()


def get_role(admin, role_id):
    r = client.get(f"{ROLES}/{role_id}", headers=h.auth(admin["token"]))
    assert r.status_code == 200, r.text
    return r.json()


def reopen(admin, role_id):
    return client.post(f"{ROLES}/{role_id}/publish", headers=h.auth(admin["token"]))


def close(admin, role_id):
    return client.post(f"{ROLES}/{role_id}/close", headers=h.auth(admin["token"]))


def new_link(admin, role_id):
    return client.post(f"{ROLES}/{role_id}/new-link", headers=h.auth(admin["token"]))


def iso(dt):
    return dt.isoformat()


# ---------------------------------------------------------------- 1-3: the 24 h window on the server clock
def test_new_link_expires_exactly_24_hours_after_creation(monkeypatch, tenants, clock):
    created = clock.now()
    job = h.create_published_job(tenants["a"], monkeypatch)
    assert job["share_link_expires_at"] == iso(created + timedelta(hours=24))
    assert job["share_link_state"] == "ACTIVE" and job["share_token"]


def test_link_valid_before_and_expired_at_the_exact_timestamp(monkeypatch, tenants, clock):
    created = clock.now()
    job = h.create_published_job(tenants["a"], monkeypatch)
    token = job["share_token"]
    clock.set(created + timedelta(hours=24) - timedelta(microseconds=1))
    assert client.get(f"/api/public/assessment/{token}").status_code == 200
    assert h.register(token)[0].status_code == 200
    clock.set(created + timedelta(hours=24))          # server_now >= expires_at -> expired
    r = client.get(f"/api/public/assessment/{token}")
    assert r.status_code == 410 and "expired" in r.json()["detail"].lower()
    assert get_role(tenants["a"], job["id"])["share_link_state"] == "EXPIRED"


# ---------------------------------------------------------------- 4-5: registration and start are refused with 410
def test_expired_link_cannot_register_or_start(monkeypatch, tenants, clock):
    job = h.create_published_job(tenants["a"], monkeypatch)
    token = job["share_token"]
    reg_token, _ = h.register_ok(token)               # registered while the link was valid
    clock.advance(24 * HOUR)
    r, _ = h.register(token)
    assert r.status_code == 410 and "expired" in r.json()["detail"].lower()
    s = h.start(token, reg_token)
    assert s.status_code == 410 and "expired" in s.json()["detail"].lower()


# ---------------------------------------------------------------- 6: the browser clock is irrelevant
def test_client_supplied_time_cannot_bypass_expiry(monkeypatch, tenants, clock):
    job = h.create_published_job(tenants["a"], monkeypatch)
    token = job["share_token"]
    clock.advance(25 * HOUR)
    past = (clock.now() - timedelta(days=3)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    forged = {"Date": past, "X-Client-Time": iso(clock.now() - timedelta(days=3)), "X-Forwarded-Date": past}
    assert client.get(f"/api/public/assessment/{token}", headers=forged).status_code == 410
    r = client.post(f"/api/public/assessment/{token}/register", headers=forged,
                    json={"name": "Time Traveller", "phone": "+14155550123", "email": f"tt.{h.new_tag()}@example.com"})
    assert r.status_code == 410
    r = client.post(f"/api/public/assessment/{token}/start", headers={**forged, "X-Registration-Token": "x"}, json={"acknowledged": True})
    assert r.status_code == 410


# ---------------------------------------------------------------- 7: nothing resets or extends the window
def test_refresh_registration_and_republish_never_reset_expiry(monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    original = job["share_link_expires_at"]
    clock.advance(2 * HOUR)
    for _ in range(3):                                                    # page refreshes / reopening the URL
        assert client.get(f"/api/public/assessment/{job['share_token']}").status_code == 200
        assert client.get(f"{ROLES}/", headers=h.auth(admin["token"])).status_code == 200
    h.register_ok(job["share_token"])                                     # candidate registration
    again = reopen(admin, job["id"]).json()                               # idempotent publish of a live link
    assert again["share_token"] == job["share_token"] and again["share_link_expires_at"] == original
    assert get_role(admin, job["id"])["share_link_expires_at"] == original


# ---------------------------------------------------------------- 8: hidden from the active list
def test_expired_link_is_not_listed_as_active_and_exposes_no_url(monkeypatch, tenants, clock):
    admin = tenants["a"]
    stale = h.create_published_job(admin, monkeypatch, title="Stale Role")
    clock.advance(24 * HOUR)
    fresh = h.create_published_job(admin, monkeypatch, title="Fresh Role")
    rows = {r["id"]: r for r in client.get(f"{ROLES}/", headers=h.auth(admin["token"])).json()}
    assert rows[fresh["id"]]["share_link_state"] == "ACTIVE" and rows[fresh["id"]]["share_url"]
    assert rows[stale["id"]]["share_link_state"] == "EXPIRED"
    assert rows[stale["id"]]["status"] == "PUBLISHED"                     # the stored lifecycle is untouched; only the link is dead
    assert rows[stale["id"]]["share_token"] is None and rows[stale["id"]]["share_path"] is None and rows[stale["id"]]["share_url"] is None
    stats = client.get("/api/admin/recruitment/overview-stats", headers=h.auth(admin["token"])).json()
    active_ids = [r["id"] for r in rows.values() if r["share_link_state"] == "ACTIVE"]
    assert fresh["id"] in active_ids and stale["id"] not in active_ids
    assert stats["active_jobs"] == len([1 for r in rows.values() if r["share_link_state"] == "ACTIVE"])


# ---------------------------------------------------------------- 9-11: close / reopen
def test_closed_link_cannot_be_used_and_reopening_restores_the_same_url(monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    token, expiry = job["share_token"], job["share_link_expires_at"]
    closed = close(admin, job["id"]).json()
    assert closed["share_link_state"] == "CLOSED" and closed["share_token"] is None
    r = client.get(f"/api/public/assessment/{token}")
    assert r.status_code == 410 and "closed" in r.json()["detail"].lower()
    assert h.register(token)[0].status_code == 410

    clock.advance(5 * HOUR)
    back = reopen(admin, job["id"])
    assert back.status_code == 200
    assert back.json()["share_token"] == token                           # same URL
    assert back.json()["share_link_expires_at"] == expiry                # ORIGINAL window, not extended
    assert client.get(f"/api/public/assessment/{token}").status_code == 200


def test_reopening_an_expired_link_does_not_reactivate_it(monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    token, expiry = job["share_token"], job["share_link_expires_at"]
    close(admin, job["id"])
    clock.advance(24 * HOUR)
    r = reopen(admin, job["id"])
    assert r.status_code == 410 and "expired" in r.json()["detail"].lower()
    after = get_role(admin, job["id"])
    assert after["share_link_state"] == "EXPIRED" and after["status"] == "CLOSED" and after["share_link_expires_at"] == expiry
    assert client.get(f"/api/public/assessment/{token}").status_code == 410


# ---------------------------------------------------------------- 12: a new link has its own window
def test_creating_a_new_link_starts_a_new_window_and_keeps_the_old_one_dead(db, monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    old_token, old_expiry = job["share_token"], job["share_link_expires_at"]
    reg_token, email = h.register_ok(old_token)

    assert new_link(admin, job["id"]).status_code == 409                  # still active: no silent replacement
    assert get_role(admin, job["id"])["share_token"] == old_token

    clock.advance(30 * HOUR)
    renewed_at = clock.now()
    r = new_link(admin, job["id"])
    assert r.status_code == 200, r.text
    fresh = r.json()
    assert fresh["share_token"] != old_token and len(fresh["share_token"]) == 64
    assert fresh["share_link_expires_at"] == iso(renewed_at + timedelta(hours=24))
    assert fresh["share_link_state"] == "ACTIVE" and fresh["id"] == job["id"]

    old = client.get(f"/api/public/assessment/{old_token}")               # old URL: expired, not 404, not revived
    assert old.status_code == 410 and "expired" in old.json()["detail"].lower()
    assert h.register(old_token)[0].status_code == 410
    assert client.get(f"/api/public/assessment/{fresh['share_token']}").status_code == 200
    hist = db.query(models.JobShareLinkHistory).filter_by(job_description_id=job["id"]).all()
    assert [x.share_token for x in hist] == [old_token]
    assert assessment_clock.aware(hist[0].expires_at) == datetime.fromisoformat(old_expiry)

    # a candidate who registered on the old link keeps their registration and can start through the new link
    assert h.start(fresh["share_token"], reg_token).status_code == 200
    # the new link expires 24 h after ITS creation, not the old one's
    clock.advance(24 * HOUR)
    assert client.get(f"/api/public/assessment/{fresh['share_token']}").status_code == 410


def test_new_link_requires_a_published_role_and_a_valid_blueprint(monkeypatch, tenants, clock):
    admin = tenants["a"]
    draft = h.create_job(admin)
    assert new_link(admin, draft["id"]).status_code == 400


# ---------------------------------------------------------------- 13: historical data survives expiry
def test_expiry_keeps_registrations_attempts_and_results(db, monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    token = job["share_token"]
    done_reg, done_email = h.register_ok(token)
    done = h.start_ok(token, done_reg)
    client.post(h.sess_url(done, "submit-aptitude"), headers=h.sh(done), json={"answers": h.correct_aptitude_answers(db, done["session_uuid"])})
    client.post(h.sess_url(done, "submit-coding"), headers=h.sh(done), json={"solutions": h.GOOD_SOLUTIONS})
    r = client.post(h.sess_url(done, "submit-interview"), headers=h.sh(done), json={"answers": {f"I{i}": "answer" for i in range(1, 6)}})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    unstarted_reg, _ = h.register_ok(token)

    def snapshot():
        db.expire_all()
        regs = db.query(models.CandidateRegistration).filter_by(job_description_id=job["id"]).count()
        sessions = db.query(models.RoleReadySession).filter_by(job_description_id=job["id"]).count()
        sess = h.session_row(db, done["session_uuid"])
        return regs, sessions, sess.current_state, sess.overall_readiness_score

    before = snapshot()
    listing_before = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"])).json()
    clock.advance(48 * HOUR)
    assert client.get(f"/api/public/assessment/{token}").status_code == 410
    assert snapshot() == before and before[:3] == (2, 1, "COMPLETED")
    listing_after = client.get("/api/admin/recruitment/candidates", headers=h.auth(admin["token"])).json()
    assert listing_after == listing_before
    assert db.query(models.JobDescription).filter_by(id=job["id"]).first() is not None
    # the completed attempt's report is still served through its own session capability
    assert client.get(h.sess_url(done, "state"), headers=h.sh(done)).status_code == 200
    # an unstarted registration can no longer start through the expired link
    assert h.start(token, unstarted_reg).status_code == 410


def test_link_expiry_does_not_end_a_running_attempt_and_the_60_minute_deadline_still_applies(db, monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    token = job["share_token"]
    reg_token, _ = h.register_ok(token)
    clock.advance(23 * HOUR + 50 * 60)                                    # 10 min before the link expires
    started = h.start_ok(token, reg_token)
    clock.advance(15 * 60)                                                # link expired 5 min ago, attempt is 15 min in
    assert client.get(f"/api/public/assessment/{token}").status_code == 410
    r = client.get(h.sess_url(started, "state"), headers=h.sh(started))
    assert r.status_code == 200
    assert h.session_row(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"
    clock.advance(50 * 60)                                                # 65 min in: past the attempt's own 60-minute deadline
    r = client.get(h.sess_url(started, "state"), headers=h.sh(started))
    assert r.status_code in (200, 408, 409, 410)
    assert h.session_row(db, started["session_uuid"]).current_state == "TIMED_OUT"


# ---------------------------------------------------------------- 14: tenant isolation and authorization
def test_new_link_is_tenant_scoped_and_requires_an_admin(monkeypatch, tenants, clock):
    a, b = tenants["a"], tenants["b"]
    job = h.create_published_job(a, monkeypatch)
    clock.advance(25 * HOUR)
    assert new_link(b, job["id"]).status_code == 404                      # other tenant: indistinguishable from "not found"
    assert reopen(b, job["id"]).status_code == 404
    assert client.post(f"{ROLES}/{job['id']}/new-link").status_code == 401
    assert get_role(a, job["id"])["share_link_state"] == "EXPIRED"        # untouched by the foreign attempts
    mine = new_link(a, job["id"])
    assert mine.status_code == 200 and mine.json()["share_link_state"] == "ACTIVE"
    assert all(r["id"] != job["id"] for r in client.get(f"{ROLES}/", headers=h.auth(b["token"])).json())


# ---------------------------------------------------------------- legacy links (no expiry) are never expired by the change
def test_legacy_link_without_expiry_keeps_working_and_gets_a_window_when_reopened(db, monkeypatch, tenants, clock):
    admin = tenants["a"]
    job = h.create_published_job(admin, monkeypatch)
    row = db.query(models.JobDescription).filter_by(id=job["id"]).first()
    row.share_link_expires_at = None                                      # a link issued before this feature existed
    db.commit()
    clock.advance(400 * 24 * HOUR)
    assert client.get(f"/api/public/assessment/{job['share_token']}").status_code == 200
    legacy = get_role(admin, job["id"])
    assert legacy["share_link_state"] == "ACTIVE" and legacy["share_link_expires_at"] is None
    assert reopen(admin, job["id"]).json()["share_link_expires_at"] is None          # live legacy link: untouched
    close(admin, job["id"])
    back = reopen(admin, job["id"]).json()                                # explicit reopen => 24 h window, same URL
    assert back["share_token"] == job["share_token"]
    assert back["share_link_expires_at"] == iso(clock.now() + timedelta(hours=24))


# ---------------------------------------------------------------- 15: RoleReady invitations are a separate policy
def test_roleready_invitation_policy_is_untouched():
    import inspect
    from routers import roleready
    src = inspect.getsource(roleready)
    assert "share_link_policy" not in src and "share_link_expires_at" not in src
    assert "timedelta(days=7)" in src                                      # invitation lifetime unchanged
    assert policy.SHARE_LINK_TTL == timedelta(hours=24)


def test_policy_helpers_follow_the_server_clock_only():
    class J:  # minimal stand-in for a job row
        share_token = "t"
        is_published = True
        status = "PUBLISHED"
        share_link_expires_at = datetime(2030, 1, 1, 12, 0, 0)            # naive, as read back from the database (UTC)

    now = datetime(2030, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    assert policy.is_expired(J, now) is True and policy.link_state(J, now) == "EXPIRED"
    assert policy.link_state(J, now - timedelta(seconds=1)) == "ACTIVE"
