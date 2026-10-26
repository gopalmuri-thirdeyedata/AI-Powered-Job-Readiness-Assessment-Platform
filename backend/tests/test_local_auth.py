"""
Local authentication (Clerk removed): login, sessions, CSRF, admin-managed account creation, authorization, abuse protection.

Runs against the throw-away test database (see tests/db_guard.py). Cookie behaviour is exercised through real TestClient cookie jars.
"""
import re
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

import database
import models
import utils
from main import app
from services import local_auth
from tests import recruitment_helpers as rh

PASSWORD = "Str0ng-Passw0rd!"
CLIENT_KW = {"base_url": "http://testserver"}


@pytest.fixture(autouse=True)
def _fresh_limiter():
    local_auth.login_tracker.reset()
    yield
    local_auth.login_tracker.reset()


@pytest.fixture()
def db():
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


def new_client():
    return TestClient(app, **CLIENT_KW)


def tag():
    return uuid.uuid4().hex[:8]


def make_org(db):
    t = tag()
    org = models.Organization(name=f"Auth Org {t}", slug=f"auth-org-{t}", status="active")
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def make_account(db, org, role="ADMIN", password=PASSWORD, active=True, email=None, name="Test Person"):
    t = tag()
    email = email or f"{role.lower()}.{t}@authtest.com"
    user = models.User(email=email, full_name=name, hashed_password=utils.get_password_hash(password), role=role,
                       organization_id=org.id, is_active=active)
    db.add(user)
    db.commit()
    db.refresh(user)
    if role == "ADMIN":
        db.add(models.OrganizationMember(organization_id=org.id, user_id=user.id, role="ADMIN", status="active"))
    elif role == "STUDENT":
        db.add(models.StudentProfile(user_id=user.id, organization_id=org.id, email=email, full_name=name, target_role=""))
    db.commit()
    return user


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login/", json={"email": email, "password": password})


def signed_in(db, role="ADMIN", org=None, **kw):
    """(client with an authenticated cookie jar, csrf headers, user, org)."""
    org = org or make_org(db)
    user = make_account(db, org, role=role, **kw)
    c = new_client()
    res = login(c, user.email)
    assert res.status_code == 200, res.text
    return c, {"X-CSRF-Token": res.json()["csrf_token"]}, user, org


def create_payload(role="STUDENT", **over):
    t = tag()
    body = {"role": role, "full_name": "New Person", "email": f"new.{t}@authtest.com", "password": PASSWORD, "phone": "+91 98765 43210"}
    body.update(over)
    return body


# ------------------------------------------------------------------------------
# Login
# ------------------------------------------------------------------------------
def test_valid_admin_and_student_login_use_server_side_role_and_redirect(db):
    org = make_org(db)
    admin = make_account(db, org, "ADMIN")
    student = make_account(db, org, "STUDENT")
    a, s = new_client(), new_client()
    ra, rs = login(a, admin.email), login(s, student.email)
    assert ra.status_code == rs.status_code == 200
    assert (ra.json()["role"], ra.json()["redirect"]) == ("ADMIN", "/admin/dashboard")
    assert (rs.json()["role"], rs.json()["redirect"]) == ("STUDENT", "/student/dashboard")
    assert "access" not in ra.json() and "token" not in ra.json()      # no bearer secret handed to page JavaScript
    assert a.get("/api/auth/me").json()["role"] == "ADMIN"
    assert s.get("/api/auth/me").json()["role"] == "STUDENT"


def test_login_normalizes_email_case_and_whitespace(db):
    org = make_org(db)
    user = make_account(db, org, "STUDENT")
    res = login(new_client(), f"  {user.email.upper()} ")
    assert res.status_code == 200


def test_client_supplied_role_is_ignored(db):
    org = make_org(db)
    student = make_account(db, org, "STUDENT")
    c = new_client()
    res = c.post("/api/auth/login/", json={"email": student.email, "password": PASSWORD, "role": "ADMIN", "role_intent": "admin"})
    assert res.status_code == 200 and res.json()["role"] == "STUDENT"
    assert c.get("/api/admin/users/").status_code == 403


def test_invalid_password_and_unknown_email_are_indistinguishable(db):
    org = make_org(db)
    user = make_account(db, org, "ADMIN")
    bad = login(new_client(), user.email, "Wrong-Passw0rd!")
    unknown = login(new_client(), f"nobody.{tag()}@authtest.com")
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json() == {"detail": "Invalid email or password."}
    assert "prepwin_session" not in bad.cookies


def test_disabled_account_cannot_login(db):
    org = make_org(db)
    user = make_account(db, org, "STUDENT", active=False)
    res = login(new_client(), user.email)
    assert res.status_code == 403 and "deactivated" in res.json()["detail"]
    # ...and the wrong password for a disabled account stays generic
    assert login(new_client(), user.email, "Wrong-Passw0rd!").status_code == 401


def test_internal_candidate_shadow_accounts_and_placeholder_passwords_cannot_login(db):
    org = make_org(db)
    shadow = models.User(email=f"candidate_{tag()}@hiringai.internal", hashed_password=utils.get_password_hash(PASSWORD),
                         role="CANDIDATE", is_active=True, organization_id=org.id)
    legacy = models.User(email=f"legacy.{tag()}@authtest.com", hashed_password=utils.get_password_hash("clerk_managed_user"),
                         role="ADMIN", is_active=True, organization_id=org.id)
    db.add_all([shadow, legacy])
    db.commit()
    assert login(new_client(), shadow.email).status_code == 401
    assert login(new_client(), legacy.email, "clerk_managed_user").status_code == 401


def test_cookie_is_httponly_scoped_and_not_in_body(db):
    org = make_org(db)
    user = make_account(db, org, "ADMIN")
    res = login(new_client(), user.email)
    header = res.headers["set-cookie"]
    assert header.startswith("prepwin_session=")
    assert "httponly" in header.lower() and "samesite=lax" in header.lower() and "path=/" in header.lower()
    raw = re.match(r"prepwin_session=([^;]+)", header).group(1)
    assert raw not in res.text
    assert res.headers["cache-control"] == "no-store"


def test_password_hash_is_bcrypt_and_never_serialized(db):
    org = make_org(db)
    user = make_account(db, org, "ADMIN")
    assert user.hashed_password.startswith("$2") and user.hashed_password != PASSWORD
    c = new_client()
    body = login(c, user.email).text + c.get("/api/auth/me").text
    assert user.hashed_password not in body and "hashed_password" not in body and PASSWORD not in body


# ------------------------------------------------------------------------------
# Sessions: logout, expiry, rotation, CSRF
# ------------------------------------------------------------------------------
def test_logout_invalidates_the_session_server_side(db):
    c, csrf, user, _ = signed_in(db, "STUDENT")
    stolen = c.cookies.get("prepwin_session")
    assert c.get("/api/auth/me").status_code == 200
    assert c.post("/api/auth/logout/").status_code == 200
    assert c.get("/api/auth/me").status_code == 401
    replay = new_client()
    replay.cookies.set("prepwin_session", stolen)           # a copy of the old cookie value is dead too
    assert replay.get("/api/auth/me").status_code == 401
    row = db.query(models.AuthSession).filter(models.AuthSession.user_id == user.id).first()
    assert row.revoked_at is not None


def test_session_expires_and_idle_sessions_die(db):
    c, _csrf, user, _ = signed_in(db, "ADMIN")
    row = db.query(models.AuthSession).filter(models.AuthSession.user_id == user.id).first()
    row.expires_at = local_auth.utcnow() - timedelta(seconds=1)
    db.commit()
    assert c.get("/api/auth/me").status_code == 401

    c2, _csrf2, user2, _ = signed_in(db, "ADMIN")
    row2 = db.query(models.AuthSession).filter(models.AuthSession.user_id == user2.id).first()
    row2.last_seen_at = local_auth.utcnow() - local_auth.session_idle_timeout() - timedelta(minutes=1)
    db.commit()
    assert c2.get("/api/auth/me").status_code == 401


def test_relogin_rotates_the_session(db):
    org = make_org(db)
    user = make_account(db, org, "STUDENT")
    c = new_client()
    login(c, user.email)
    first = c.cookies.get("prepwin_session")
    login(c, user.email)
    second = c.cookies.get("prepwin_session")
    assert first != second
    old = new_client()
    old.cookies.set("prepwin_session", first)
    assert old.get("/api/auth/me").status_code == 401       # the presented session was revoked at re-login
    assert c.get("/api/auth/me").status_code == 200


def test_deactivating_a_user_kills_the_live_session_immediately(db):
    org = make_org(db)
    admin = make_account(db, org, "ADMIN")
    student = make_account(db, org, "STUDENT")
    s = new_client()
    login(s, student.email)
    a = new_client()
    csrf = {"X-CSRF-Token": login(a, admin.email).json()["csrf_token"]}
    assert a.post(f"/api/admin/users/{student.id}/deactivate", headers=csrf).status_code == 200
    assert s.get("/api/auth/me").status_code == 401
    assert login(new_client(), student.email).status_code == 403


def test_state_changing_cookie_requests_require_the_csrf_token(db):
    c, csrf, _user, _org = signed_in(db, "ADMIN")
    body = create_payload()
    assert c.post("/api/admin/users/", json=body).status_code == 403                                   # no token
    assert c.post("/api/admin/users/", json=body, headers={"X-CSRF-Token": "forged"}).status_code == 403  # wrong token
    assert c.post("/api/admin/users/", json=body, headers=csrf).status_code == 201
    assert c.get("/api/admin/users/").status_code == 200                                               # safe methods need none
    assert c.get("/api/auth/me").json()["csrf_token"] == csrf["X-CSRF-Token"]


def test_csrf_token_of_another_session_is_rejected(db):
    a1, csrf1, _u1, org = signed_in(db, "ADMIN")
    a2, csrf2, _u2, _ = signed_in(db, "ADMIN", org=org)
    assert a1.post("/api/admin/users/", json=create_payload(), headers=csrf2).status_code == 403


def test_bearer_header_takes_precedence_over_the_cookie_and_invalid_bearer_is_rejected(db):
    c, _csrf, _user, _ = signed_in(db, "ADMIN")
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer null"}).status_code == 200   # stringified "no token" == no header


def test_change_password_rotates_session_and_revokes_others(db):
    org = make_org(db)
    user = make_account(db, org, "STUDENT")
    c1, c2 = new_client(), new_client()
    login(c1, user.email)
    login(c2, user.email)
    csrf = {"X-CSRF-Token": c1.get("/api/auth/me").json()["csrf_token"]}
    before = c1.cookies.get("prepwin_session")
    NEW = "An0ther-Str0ng-Pass!"
    assert c1.post("/api/auth/change-password/", json={"current_password": "nope", "new_password": NEW}, headers=csrf).status_code == 400
    assert c1.post("/api/auth/change-password/", json={"current_password": PASSWORD, "new_password": "short"}, headers=csrf).status_code == 422
    ok = c1.post("/api/auth/change-password/", json={"current_password": PASSWORD, "new_password": NEW}, headers=csrf)
    assert ok.status_code == 200
    assert c1.cookies.get("prepwin_session") != before and c1.get("/api/auth/me").status_code == 200
    assert c2.get("/api/auth/me").status_code == 401
    assert login(new_client(), user.email, PASSWORD).status_code == 401
    assert login(new_client(), user.email, NEW).status_code == 200


# ------------------------------------------------------------------------------
# Rate limiting
# ------------------------------------------------------------------------------
def test_login_rate_limiting_blocks_repeated_failures_with_retry_after(db):
    org = make_org(db)
    user = make_account(db, org, "ADMIN")
    c = new_client()
    codes = [login(c, user.email, "Wrong-Passw0rd!").status_code for _ in range(local_auth.login_tracker.pair_limit)]
    assert codes == [401] * local_auth.login_tracker.pair_limit
    blocked = login(c, user.email, "Wrong-Passw0rd!")
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
    assert login(c, user.email, PASSWORD).status_code == 429          # even the right password waits out the lockout


def test_successful_login_clears_the_pair_counter(db):
    org = make_org(db)
    user = make_account(db, org, "ADMIN")
    c = new_client()
    for _ in range(local_auth.login_tracker.pair_limit - 1):
        login(c, user.email, "Wrong-Passw0rd!")
    assert login(c, user.email).status_code == 200
    for _ in range(local_auth.login_tracker.pair_limit - 1):
        assert login(c, user.email, "Wrong-Passw0rd!").status_code == 401


def test_tracker_window_expiry():
    t = local_auth.LoginAttemptTracker(window_seconds=10, pair_limit=2)
    now = [100.0]
    t._clock = lambda: now[0]
    t.record_failure("a@x.com", "1.1.1.1")
    t.record_failure("a@x.com", "1.1.1.1")
    assert t.retry_after("a@x.com", "1.1.1.1") > 0
    now[0] += 11
    assert t.retry_after("a@x.com", "1.1.1.1") == 0


# ------------------------------------------------------------------------------
# Public signup is gone
# ------------------------------------------------------------------------------
@pytest.mark.parametrize("method,path", [
    ("post", "/api/auth/clerk-sync/"),
    ("post", "/api/auth/register"),
    ("post", "/api/auth/register/"),
    ("post", "/api/auth/signup/"),
    ("post", "/api/auth/check-email/"),
    ("post", "/api/student/auth/register"),
    ("post", "/api/student/auth/login"),
])
def test_legacy_public_account_endpoints_no_longer_exist(method, path):
    res = getattr(new_client(), method)(path, json={"email": "x@y.com", "password": PASSWORD, "role": "ADMIN", "role_intent": "admin"})
    assert res.status_code in (404, 405)


def test_unauthenticated_and_student_cannot_create_accounts(db):
    body = create_payload("ADMIN")
    assert new_client().post("/api/admin/users/", json=body).status_code == 401
    c, csrf, _u, _o = signed_in(db, "STUDENT")
    assert c.post("/api/admin/users/", json=body, headers=csrf).status_code == 403
    assert db.query(models.User).filter(models.User.email == body["email"].lower()).first() is None


# ------------------------------------------------------------------------------
# Admin-managed account creation
# ------------------------------------------------------------------------------
def test_admin_creates_student_and_student_can_login_straight_away(db):
    c, csrf, admin, org = signed_in(db, "ADMIN")
    body = create_payload("STUDENT", email=f"  New.Student.{tag()}@AuthTest.com ")
    res = c.post("/api/admin/users/", json=body, headers=csrf)
    assert res.status_code == 201, res.text
    created = res.json()["user"]
    assert created["role"] == "STUDENT" and created["organization_id"] == org.id and created["phone"] == "+91 98765 43210"
    assert created["email"] == body["email"].strip().lower()
    assert PASSWORD not in res.text and "hashed_password" not in res.text and "password" not in created
    row = db.query(models.User).filter(models.User.id == created["id"]).first()
    assert row.hashed_password.startswith("$2") and row.hashed_password != PASSWORD
    profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == row.id).first()
    assert profile and profile.full_name == "New Person" and profile.organization_id == org.id and profile.phone == "+91 98765 43210"
    assert db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == row.id).count() == 0
    s = new_client()
    ok = login(s, created["email"])
    assert ok.status_code == 200 and ok.json()["role"] == "STUDENT" and ok.json()["redirect"] == "/student/dashboard"


def test_admin_creates_another_admin_who_can_use_admin_apis(db):
    c, csrf, admin, org = signed_in(db, "SUPER_ADMIN")            # only a Super Admin creates Admin accounts
    body = create_payload("ADMIN", phone=None)                    # mobile number is optional
    res = c.post("/api/admin/users/", json=body, headers=csrf)
    assert res.status_code == 201, res.text
    new_id = res.json()["user"]["id"]
    assert res.json()["user"]["role"] == "ADMIN" and res.json()["user"]["phone"] is None
    member = db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == new_id).first()
    assert member and member.role == "ADMIN" and member.status == "active" and member.organization_id == org.id
    a2 = new_client()
    r = login(a2, body["email"])
    assert r.status_code == 200 and r.json()["redirect"] == "/admin/dashboard"
    assert a2.get("/api/admin/users/").status_code == 200


@pytest.mark.parametrize("field", ["role", "full_name", "email", "password"])
def test_required_fields_are_validated(db, field):
    c, csrf, *_ = signed_in(db, "ADMIN")
    body = create_payload()
    body.pop(field)
    assert c.post("/api/admin/users/", json=body, headers=csrf).status_code == 422
    body[field] = "   "
    assert c.post("/api/admin/users/", json=body, headers=csrf).status_code == 422


@pytest.mark.parametrize("override", [
    {"role": "SUPERUSER"}, {"role": "PLATFORM_ADMIN"}, {"role": "CANDIDATE"}, {"role": ""},
    {"email": "not-an-email"}, {"email": "a@b"},
    {"phone": "abc"}, {"phone": "123"},
    {"password": "short1A"}, {"password": "alllowercase123"}, {"password": "ALLUPPERCASE123"}, {"password": "NoDigitsHereAtAll"},
    {"password": "x" * 80 + "A1"},
])
def test_invalid_input_is_rejected_and_leaves_no_records(db, override):
    c, csrf, *_ = signed_in(db, "ADMIN")
    body = create_payload(**override)
    before = db.query(models.User).count()
    res = c.post("/api/admin/users/", json=body, headers=csrf)
    assert res.status_code == 422
    assert body["password"] not in res.text                               # validation errors never echo the password
    db.expire_all()
    assert db.query(models.User).count() == before


def test_duplicate_email_is_rejected_case_insensitively(db):
    c, csrf, *_ = signed_in(db, "ADMIN")
    body = create_payload()
    assert c.post("/api/admin/users/", json=body, headers=csrf).status_code == 201
    dup = dict(body, email=body["email"].upper())
    res = c.post("/api/admin/users/", json=dup, headers=csrf)
    assert res.status_code == 409
    assert db.query(models.User).filter(func_lower_email(body["email"])).count() == 1


def func_lower_email(email):
    from sqlalchemy.sql import func
    return func.lower(models.User.email) == email.lower()


def test_failed_creation_leaves_no_partial_records(db, monkeypatch):
    c, csrf, *_ = signed_in(db, "ADMIN")
    body = create_payload("STUDENT")
    original = models.StudentProfile

    class Boom(Exception):
        pass

    def exploding(*a, **k):
        raise Boom("profile failed")

    monkeypatch.setattr(models, "StudentProfile", exploding)
    boom_client = TestClient(app, raise_server_exceptions=False, **CLIENT_KW)
    boom_client.cookies.set("prepwin_session", c.cookies.get("prepwin_session"))
    res = boom_client.post("/api/admin/users/", json=body, headers=csrf)
    monkeypatch.setattr(models, "StudentProfile", original)
    assert res.status_code == 500
    db.expire_all()
    assert db.query(models.User).filter(func_lower_email(body["email"])).count() == 0
    assert c.post("/api/admin/users/", json=body, headers=csrf).status_code == 201          # nothing half-created blocks a retry


def test_internal_domain_and_existing_identities_cannot_be_created_and_email_patterns_confer_no_platform_scope(db):
    c, csrf, admin, org = signed_in(db, "SUPER_ADMIN")
    make_account(db, org, "ADMIN", email="admin@thirdeyedata.ai") if not db.query(models.User).filter_by(email="admin@thirdeyedata.ai").first() else None
    for email in ("admin@thirdeyedata.ai", f"x.{tag()}@hiringai.internal"):
        assert c.post("/api/admin/users/", json=create_payload("ADMIN", email=email), headers=csrf).status_code in (409, 422)
    # platform.* / pa_* addresses are ordinary addresses: an ADMIN with such an e-mail has NO platform scope
    for email in ("platform.root@authtest.com", "pa_ops@authtest.com"):
        email = f"{tag()}.{email}"
        res = c.post("/api/admin/users/", json=create_payload("ADMIN", email=email), headers=csrf)
        assert res.status_code == 201, res.text
        pc = new_client()
        assert login(pc, email).status_code == 200
        assert pc.get("/api/platform/organizations").status_code == 403


# ------------------------------------------------------------------------------
# Listing, search, details, edit, activate/deactivate, password replacement
# ------------------------------------------------------------------------------
def test_list_search_filter_and_pagination(db):
    c, csrf, admin, org = signed_in(db, "ADMIN")
    s1 = make_account(db, org, "STUDENT", name="Zebra Quokka", email=f"zq.{tag()}@authtest.com")
    s2 = make_account(db, org, "STUDENT", name="Other Person", email=f"findme.{tag()}@authtest.com")
    listing = c.get("/api/admin/users/", params={"page_size": 100}).json()
    ids = {u["id"] for u in listing["items"]}
    assert {admin.id, s1.id, s2.id} <= ids and listing["total"] == len(ids)
    assert "hashed_password" not in c.get("/api/admin/users/").text
    assert [u["id"] for u in c.get("/api/admin/users/", params={"q": "quokka"}).json()["items"]] == [s1.id]
    assert [u["id"] for u in c.get("/api/admin/users/", params={"q": "FINDME"}).json()["items"]] == [s2.id]
    assert {u["role"] for u in c.get("/api/admin/users/", params={"role": "student"}).json()["items"]} == {"STUDENT"}
    assert [u["id"] for u in c.get("/api/admin/users/", params={"role": "ADMIN"}).json()["items"]] == [admin.id]
    assert c.get("/api/admin/users/", params={"role": "GOD"}).status_code == 422
    page = c.get("/api/admin/users/", params={"page_size": 1, "page": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert c.get("/api/admin/users/", params={"q": "%"}).json()["total"] == 0          # LIKE wildcards are escaped


def test_user_details_edit_and_profile_sync(db):
    c, csrf, admin, org = signed_in(db, "ADMIN")
    student = make_account(db, org, "STUDENT", name="Old Name")
    detail = c.get(f"/api/admin/users/{student.id}").json()
    assert detail["student_profile"]["is_onboarded"] is False and detail["organization_name"] == org.name
    res = c.patch(f"/api/admin/users/{student.id}", json={"full_name": "  New   Name ", "phone": "+1 (415) 555-0123"}, headers=csrf)
    assert res.status_code == 200 and res.json()["full_name"] == "New Name"
    db.expire_all()
    profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == student.id).first()
    assert profile.full_name == "New Name" and profile.phone == "+1 (415) 555-0123"
    assert c.patch(f"/api/admin/users/{student.id}", json={"phone": None}, headers=csrf).json()["phone"] is None
    assert c.patch(f"/api/admin/users/{student.id}", json={}, headers=csrf).status_code == 422
    # role / e-mail / organization are not editable through this API, whatever the payload says
    c.patch(f"/api/admin/users/{student.id}", json={"full_name": "X Y", "role": "ADMIN", "email": "evil@x.com", "organization_id": 1}, headers=csrf)
    db.expire_all()
    assert db.query(models.User).get(student.id).role == "STUDENT" and db.query(models.User).get(student.id).email != "evil@x.com"


def test_admin_cannot_deactivate_self_or_last_admin_and_can_reactivate(db):
    c, csrf, admin, org = signed_in(db, "SUPER_ADMIN")
    assert c.post(f"/api/admin/users/{admin.id}/deactivate", headers=csrf).status_code == 400
    plain_admin = make_account(db, org, "ADMIN")
    ac = new_client()
    acsrf = {"X-CSRF-Token": login(ac, plain_admin.email).json()["csrf_token"]}
    assert ac.post(f"/api/admin/users/{plain_admin.id}/deactivate", headers=acsrf).status_code in (400, 403)   # an Admin cannot switch itself (or any admin) off
    student = make_account(db, org, "STUDENT")
    assert c.post(f"/api/admin/users/{student.id}/deactivate", headers=csrf).json()["user"]["is_active"] is False
    assert c.post(f"/api/admin/users/{student.id}/activate", headers=csrf).json()["user"]["is_active"] is True
    assert login(new_client(), student.email).status_code == 200


def test_admin_password_replacement_revokes_sessions_and_never_echoes(db):
    c, csrf, admin, org = signed_in(db, "SUPER_ADMIN")
    student = make_account(db, org, "STUDENT")
    sc = new_client()
    login(sc, student.email)
    NEW = "Replacement-Passw0rd!"
    assert c.post(f"/api/admin/users/{student.id}/reset-password", json={"new_password": "weak"}, headers=csrf).status_code == 422
    res = c.post(f"/api/admin/users/{student.id}/reset-password", json={"new_password": NEW}, headers=csrf)
    assert res.status_code == 200 and NEW not in res.text
    assert sc.get("/api/auth/me").status_code == 401
    assert login(new_client(), student.email, PASSWORD).status_code == 401
    assert login(new_client(), student.email, NEW).status_code == 200
    assert c.post(f"/api/admin/users/{admin.id}/reset-password", json={"new_password": NEW}, headers=csrf).status_code == 400


def test_audit_trail_records_actions_without_secrets(db):
    c, csrf, admin, org = signed_in(db, "ADMIN")
    body = create_payload("STUDENT")
    c.post("/api/admin/users/", json=body, headers=csrf)
    rows = db.query(models.ActivityLog).filter(models.ActivityLog.user_id == admin.id, models.ActivityLog.action == "user_created").all()
    assert rows and all(PASSWORD not in (r.details or "") and PASSWORD not in (r.target or "") for r in rows)


# ------------------------------------------------------------------------------
# Authorization
# ------------------------------------------------------------------------------
def test_student_sessions_are_rejected_by_every_user_management_endpoint(db):
    org = make_org(db)
    admin = make_account(db, org, "ADMIN")
    sc, csrf, student, _ = signed_in(db, "STUDENT", org=org)
    for method, path, body in [
        ("get", "/api/admin/users/", None),
        ("post", "/api/admin/users/", create_payload("ADMIN")),
        ("get", f"/api/admin/users/{admin.id}", None),
        ("patch", f"/api/admin/users/{admin.id}", {"full_name": "Hacked"}),
        ("post", f"/api/admin/users/{admin.id}/deactivate", None),
        ("post", f"/api/admin/users/{admin.id}/reset-password", {"new_password": "Replacement-Passw0rd!"}),
    ]:
        res = getattr(sc, method)(path, headers=csrf, **({"json": body} if body is not None else {}))
        assert res.status_code == 403, (method, path, res.status_code)
    db.expire_all()
    assert db.query(models.User).get(admin.id).full_name == "Test Person"


def test_students_cannot_promote_themselves(db):
    sc, csrf, student, _ = signed_in(db, "STUDENT")
    for path, body in [(f"/api/admin/users/{student.id}", {"role": "ADMIN"}), ("/api/auth/me", {"role": "ADMIN"})]:
        sc.patch(path, json=body, headers=csrf)
        sc.put(path, json=body, headers=csrf)
    db.expire_all()
    assert db.query(models.User).get(student.id).role == "STUDENT"
    assert sc.get("/api/auth/me").json()["role"] == "STUDENT"


def test_forged_client_side_role_state_cannot_reach_admin_apis(db):
    sc, csrf, student, org = signed_in(db, "STUDENT")
    sc.headers.update({"X-User-Role": "ADMIN", "X-Role": "ADMIN", "X-Organization-Id": str(org.id)})
    sc.cookies.set("role", "ADMIN")
    assert sc.get("/api/admin/users/").status_code == 403
    assert sc.get("/api/admin/job-roles/").status_code in (401, 403)


def test_tenant_isolation_between_organizations(db):
    c1, csrf1, admin1, org1 = signed_in(db, "ADMIN")
    other_org = make_org(db)
    foreign = make_account(db, other_org, "STUDENT")
    assert foreign.id not in {u["id"] for u in c1.get("/api/admin/users/", params={"page_size": 100}).json()["items"]}
    assert c1.get(f"/api/admin/users/{foreign.id}").status_code == 404
    assert c1.post(f"/api/admin/users/{foreign.id}/deactivate", headers=csrf1).status_code == 404
    assert c1.post(f"/api/admin/users/{foreign.id}/reset-password", json={"new_password": "Replacement-Passw0rd!"}, headers=csrf1).status_code == 404
    # an explicit header naming a foreign org does not widen an org admin's scope
    assert c1.get("/api/admin/users/", headers={"X-Organization-Id": str(other_org.id)}).status_code == 403


def test_platform_admin_accounts_are_protected_from_org_admins(db):
    c, csrf, admin, org = signed_in(db, "ADMIN")
    root = make_account(db, org, "ADMIN", email=f"platform.{tag()}@authtest.com")
    assert c.post(f"/api/admin/users/{root.id}/deactivate", headers=csrf).status_code == 403
    assert c.post(f"/api/admin/users/{root.id}/reset-password", json={"new_password": "Replacement-Passw0rd!"}, headers=csrf).status_code == 403


# ------------------------------------------------------------------------------
# No Clerk dependency at runtime
# ------------------------------------------------------------------------------
def test_authentication_works_with_no_clerk_configuration(db, monkeypatch):
    for name in ("CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "PLATFORM_ADMIN_CLERK_USER_ID", "PLATFORM_ADMIN_CLERK_ID"):
        monkeypatch.delenv(name, raising=False)
    c, csrf, admin, org = signed_in(db, "ADMIN")
    assert c.get("/api/auth/me").status_code == 200
    assert c.post("/api/admin/users/", json=create_payload(), headers=csrf).status_code == 201


def test_no_backend_module_imports_the_clerk_service():
    import pathlib
    root = pathlib.Path(__file__).resolve().parent.parent
    offenders = []
    for path in list(root.glob("routers/*.py")) + list(root.glob("services/*.py")) + [root / "main.py", root / "utils.py"]:
        text = path.read_text(encoding="utf-8")
        if "clerk_service" in text or "api.clerk.com" in text or "CLERK_SECRET_KEY" in text:
            offenders.append(path.name)
    assert offenders == []
    assert not (root / "services" / "clerk_service.py").exists()


# ------------------------------------------------------------------------------
# Endpoints that authenticate on their own (RoleReady session access, proctoring) must honour the cookie session too
# ------------------------------------------------------------------------------
def make_roleready_session(db, org, student):
    profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == student.id).first()
    session = models.RoleReadySession(
        session_uuid=str(uuid.uuid4()), organization_id=org.id, student_profile_id=profile.id, target_role="Engineer",
        current_state=models.RoleReadySessionState.NOT_STARTED,
    )
    db.add(session)
    db.commit()
    return session


def test_student_cookie_session_reaches_own_roleready_session_but_not_anothers(db):
    sc, csrf, student, org = signed_in(db, "STUDENT")
    mine = make_roleready_session(db, org, student)
    other_student = make_account(db, org, "STUDENT")
    theirs = make_roleready_session(db, org, other_student)
    assert sc.get(f"/api/roleready/session/{mine.session_uuid}").status_code == 200
    assert sc.get(f"/api/roleready/session/{theirs.session_uuid}").status_code == 403
    assert new_client().get(f"/api/roleready/session/{mine.session_uuid}").status_code == 401


def test_roleready_session_access_dies_with_logout_deactivation_and_bad_cookie(db):
    sc, csrf, student, org = signed_in(db, "STUDENT")
    mine = make_roleready_session(db, org, student)
    url = f"/api/roleready/session/{mine.session_uuid}"
    forged = new_client()
    forged.cookies.set("prepwin_session", "forged-value")
    assert forged.get(url).status_code == 401
    assert sc.get(url).status_code == 200
    sc.post("/api/auth/logout/")
    assert sc.get(url).status_code == 401


def test_admin_cookie_session_is_tenant_scoped_on_roleready_sessions(db):
    ac, csrf, admin, org = signed_in(db, "ADMIN")
    own_student = make_account(db, org, "STUDENT")
    own = make_roleready_session(db, org, own_student)
    foreign_org = make_org(db)
    foreign = make_roleready_session(db, foreign_org, make_account(db, foreign_org, "STUDENT"))
    assert ac.get(f"/api/roleready/session/{own.session_uuid}").status_code == 200
    assert ac.get(f"/api/roleready/session/{foreign.session_uuid}").status_code == 403


def test_proctoring_accepts_a_cookie_session_and_rejects_unauthenticated(db):
    sc, csrf, *_ = signed_in(db, "STUDENT")
    assert new_client().post("/api/proctor/analyze-frame", json={"image": "x"}).status_code == 401
    res = sc.post("/api/proctor/analyze-frame", json={"image": "x"}, headers=csrf)
    assert res.status_code not in (401, 403)                     # authenticated: it reaches frame validation (400/422), not the auth gate
    assert sc.post("/api/proctor/analyze-frame", json={"image": "x"}).status_code in (401, 403)   # without the CSRF token it is refused
