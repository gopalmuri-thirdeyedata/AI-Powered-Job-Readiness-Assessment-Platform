"""
Three-role hierarchy (SUPER_ADMIN > ADMIN > STUDENT) enforced by the SERVER on every protected API.

Permission matrix under test
    SUPER_ADMIN  creates Student / Admin / Super Admin; manages every account; platform (Super Admin) APIs
    ADMIN        creates Student only; manages Students only; no platform APIs; cannot promote anyone
    STUDENT      creates nothing; no administrative API
Runs on the throw-away test database (tests/db_guard.py).
"""
import os
import sqlite3
import subprocess
import sys
import uuid

import pytest
from fastapi.testclient import TestClient

import database
import models
import utils
from main import app
from services import local_auth

PASSWORD = "Str0ng-Passw0rd!"
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _fresh_limiter():
    local_auth.login_tracker.reset()
    yield
    local_auth.login_tracker.reset()


@pytest.fixture()
def db():
    s = database.SessionLocal()
    try:
        yield s
    finally:
        s.close()


def tag():
    return uuid.uuid4().hex[:8]


def new_client():
    return TestClient(app, base_url="http://testserver")


def make_org(db):
    t = tag()
    org = models.Organization(name=f"Role Org {t}", slug=f"role-org-{t}", status="active")
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def make_account(db, org, role, email=None, active=True):
    email = email or f"{role.lower()}.{tag()}@roletest.com"
    user = models.User(email=email, full_name=f"{role.title()} Person", hashed_password=utils.get_password_hash(PASSWORD),
                       role=role, organization_id=org.id, is_active=active)
    db.add(user)
    db.commit()
    db.refresh(user)
    if role == "ADMIN":
        db.add(models.OrganizationMember(organization_id=org.id, user_id=user.id, role="ADMIN", status="active"))
    elif role == "STUDENT":
        db.add(models.StudentProfile(user_id=user.id, organization_id=org.id, email=email, full_name="Student Person", target_role=""))
    db.commit()
    return user


def session_for(db, role, org=None, **kw):
    org = org or make_org(db)
    user = make_account(db, org, role, **kw)
    c = new_client()
    res = c.post("/api/auth/login/", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return c, {"X-CSRF-Token": res.json()["csrf_token"]}, user, org, res.json()


def payload(role, **over):
    body = {"role": role, "full_name": "New Person", "email": f"new.{tag()}@roletest.com", "password": PASSWORD, "phone": None}
    body.update(over)
    return body


# ------------------------------------------------------------------------------ model
def test_three_canonical_roles_and_honest_aliases():
    assert {r.value for r in (models.UserRole.SUPER_ADMIN, models.UserRole.ADMIN, models.UserRole.STUDENT)} == {"SUPER_ADMIN", "ADMIN", "STUDENT"}
    assert models.UserRole.SUPER_ADMIN != models.UserRole.ADMIN                       # no longer collapsed into one value
    assert models.UserRole.PLATFORM_ADMIN == models.UserRole.SUPER_ADMIN              # legacy name keeps its platform meaning
    for legacy in ("ORGANIZATION_ADMIN", "HR", "RECRUITER", "HR_ADMIN", "INTERVIEWER"):
        assert getattr(models.UserRole, legacy) == models.UserRole.ADMIN
    assert models.is_admin_role("ADMIN") and models.is_admin_role("SUPER_ADMIN")
    assert not models.is_admin_role("STUDENT") and not models.is_admin_role("CANDIDATE") and not models.is_admin_role(None)
    assert models.is_super_admin_role("SUPER_ADMIN") and not models.is_super_admin_role("ADMIN")


@pytest.mark.parametrize("role,redirect", [("SUPER_ADMIN", "/admin/dashboard"), ("ADMIN", "/admin/dashboard"), ("STUDENT", "/student/dashboard")])
def test_each_role_logs_in_with_its_own_stored_role(db, role, redirect):
    c, _csrf, user, _org, body = session_for(db, role)
    assert body["role"] == role and body["redirect"] == redirect and body["user"]["role"] == role
    assert c.get("/api/auth/me").json()["role"] == role


# ------------------------------------------------------------------------------ creation matrix
MATRIX = [
    ("SUPER_ADMIN", "STUDENT", 201), ("SUPER_ADMIN", "ADMIN", 201), ("SUPER_ADMIN", "SUPER_ADMIN", 201),
    ("ADMIN", "STUDENT", 201), ("ADMIN", "ADMIN", 403), ("ADMIN", "SUPER_ADMIN", 403),
    ("STUDENT", "STUDENT", 403), ("STUDENT", "ADMIN", 403), ("STUDENT", "SUPER_ADMIN", 403),
]


@pytest.mark.parametrize("caller,target,expected", MATRIX)
def test_account_creation_permission_matrix(db, caller, target, expected):
    c, csrf, _u, _o, _b = session_for(db, caller)
    body = payload(target)
    res = c.post("/api/admin/users/", json=body, headers=csrf)
    assert res.status_code == expected, res.text
    db.expire_all()
    created = db.query(models.User).filter(models.User.email == body["email"]).first()
    assert (created is not None) == (expected == 201)
    if expected == 201:
        assert created.role == target
        assert PASSWORD not in res.text and "hashed_password" not in res.text
        login = new_client().post("/api/auth/login/", json={"email": body["email"], "password": PASSWORD})
        assert login.status_code == 200 and login.json()["role"] == target       # usable straight away with the assigned role


def test_unauthenticated_cannot_create_any_role(db):
    for role in ("STUDENT", "ADMIN", "SUPER_ADMIN"):
        body = payload(role)
        assert new_client().post("/api/admin/users/", json=body).status_code == 401
        assert db.query(models.User).filter(models.User.email == body["email"]).first() is None


def test_super_admin_created_records_are_correct_per_role(db):
    c, csrf, _u, org, _b = session_for(db, "SUPER_ADMIN")
    ids = {}
    for role in ("STUDENT", "ADMIN", "SUPER_ADMIN"):
        ids[role] = c.post("/api/admin/users/", json=payload(role, phone="+91 98765 43210"), headers=csrf).json()["user"]["id"]
    db.expire_all()
    assert db.query(models.StudentProfile).filter_by(user_id=ids["STUDENT"]).count() == 1
    assert db.query(models.OrganizationMember).filter_by(user_id=ids["ADMIN"], role="ADMIN", status="active").count() == 1
    assert db.query(models.OrganizationMember).filter_by(user_id=ids["SUPER_ADMIN"]).count() == 0     # platform scope, no tenant membership
    assert db.query(models.StudentProfile).filter_by(user_id=ids["ADMIN"]).count() == 0


def test_forged_role_in_payload_or_headers_changes_nothing(db):
    c, csrf, admin, org, _b = session_for(db, "ADMIN")
    body = payload("STUDENT", is_super_admin=True, role_intent="SUPER_ADMIN", organization_id=999)
    res = c.post("/api/admin/users/", json=body, headers={**csrf, "X-User-Role": "SUPER_ADMIN", "X-Role": "SUPER_ADMIN"})
    assert res.status_code == 201 and res.json()["user"]["role"] == "STUDENT" and res.json()["user"]["organization_id"] == org.id
    assert c.post("/api/admin/users/", json=payload("super_admin"), headers=csrf).status_code == 403      # case games do not help


def test_signed_token_cannot_claim_a_higher_role_than_the_database_row(db):
    _c, _csrf, admin, _o, _b = session_for(db, "ADMIN")
    forged = utils.create_access_token(data={"sub": admin.email, "role": "SUPER_ADMIN"})
    assert TestClient(app).get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    student = make_account(db, make_org(db), "STUDENT")
    forged2 = utils.create_access_token(data={"sub": student.email, "role": "ADMIN"})
    assert TestClient(app).get("/api/auth/me", headers={"Authorization": f"Bearer {forged2}"}).status_code == 401
    honest = utils.create_access_token(data={"sub": admin.email, "role": "ADMIN"})
    assert TestClient(app).get("/api/auth/me", headers={"Authorization": f"Bearer {honest}"}).json()["role"] == "ADMIN"


# ------------------------------------------------------------------------------ management matrix
def test_admin_manages_students_only_and_nobody_can_promote(db):
    c, csrf, admin, org, _b = session_for(db, "ADMIN")
    student = make_account(db, org, "STUDENT")
    other_admin = make_account(db, org, "ADMIN")
    sa = make_account(db, org, "SUPER_ADMIN")
    ok = c.patch(f"/api/admin/users/{student.id}", json={"full_name": "Renamed Student"}, headers=csrf)
    assert ok.status_code == 200 and ok.json()["full_name"] == "Renamed Student"
    assert c.post(f"/api/admin/users/{student.id}/deactivate", headers=csrf).status_code == 200
    assert c.post(f"/api/admin/users/{student.id}/activate", headers=csrf).status_code == 200
    assert c.post(f"/api/admin/users/{student.id}/reset-password", json={"new_password": "Replacement-Passw0rd!"}, headers=csrf).status_code == 200
    for target in (other_admin, sa):
        assert c.patch(f"/api/admin/users/{target.id}", json={"full_name": "Hacked"}, headers=csrf).status_code == 403
        assert c.post(f"/api/admin/users/{target.id}/deactivate", headers=csrf).status_code == 403
        assert c.post(f"/api/admin/users/{target.id}/activate", headers=csrf).status_code == 403
        assert c.post(f"/api/admin/users/{target.id}/reset-password", json={"new_password": "Replacement-Passw0rd!"}, headers=csrf).status_code == 403
    # role is not editable anywhere: payload keys are ignored, nothing changes
    for who in (student, admin):
        c.patch(f"/api/admin/users/{who.id}", json={"full_name": "Same Name", "role": "SUPER_ADMIN"}, headers=csrf)
    db.expire_all()
    assert db.query(models.User).get(student.id).role == "STUDENT" and db.query(models.User).get(admin.id).role == "ADMIN"
    assert db.query(models.User).get(other_admin.id).is_active and db.query(models.User).get(sa.id).is_active


def test_super_admin_manages_every_role_but_not_itself_into_lockout(db):
    c, csrf, me, org, _b = session_for(db, "SUPER_ADMIN")
    admin = make_account(db, org, "ADMIN")
    assert c.post(f"/api/admin/users/{admin.id}/deactivate", headers=csrf).status_code == 200
    assert c.post(f"/api/admin/users/{admin.id}/activate", headers=csrf).status_code == 200
    assert c.post(f"/api/admin/users/{admin.id}/reset-password", json={"new_password": "Replacement-Passw0rd!"}, headers=csrf).status_code == 200
    assert c.post(f"/api/admin/users/{me.id}/deactivate", headers=csrf).status_code == 400          # not self
    second = make_account(db, org, "SUPER_ADMIN")
    assert c.post(f"/api/admin/users/{second.id}/deactivate", headers=csrf).status_code == 200      # another one may be switched off...
    second_client = new_client()
    assert second_client.post("/api/auth/login/", json={"email": second.email, "password": PASSWORD}).status_code == 403


# ------------------------------------------------------------------------------ Super Admin APIs
def test_platform_apis_are_super_admin_only(db):
    sa = session_for(db, "SUPER_ADMIN")[0]
    ad = session_for(db, "ADMIN")[0]
    st = session_for(db, "STUDENT")[0]
    assert sa.get("/api/platform/organizations").status_code == 200
    assert ad.get("/api/platform/organizations").status_code == 403
    assert st.get("/api/platform/organizations").status_code == 403
    assert new_client().get("/api/platform/organizations").status_code == 401


def test_platform_scope_comes_from_the_role_never_from_an_email_pattern(db):
    for local in ("platform.root", "platform_ops", "pa.boss", "pa_x", "admin"):
        c, *_ = session_for(db, "ADMIN", email=f"{local}.{tag()}@roletest.com")
        assert c.get("/api/platform/organizations").status_code == 403, local


def test_admin_dashboard_apis_work_for_both_admin_roles_and_not_students(db):
    org = make_org(db)
    for role, expected in (("SUPER_ADMIN", 200), ("ADMIN", 200), ("STUDENT", 403)):
        c, *_ = session_for(db, role, org=org)
        assert c.get("/api/admin/job-roles/").status_code == expected, role
        assert c.get("/api/admin/users/").status_code == expected, role


def test_organization_isolation_still_holds_for_admins_and_super_admin_headers(db):
    c, csrf, admin, org, _b = session_for(db, "ADMIN")
    other = make_org(db)
    foreign = make_account(db, other, "STUDENT")
    assert c.get(f"/api/admin/users/{foreign.id}").status_code == 404
    assert c.get("/api/admin/users/", headers={"X-Organization-Id": str(other.id)}).status_code == 403
    sc, *_ = session_for(db, "SUPER_ADMIN", org=org)
    assert sc.get("/api/admin/users/", headers={"X-Organization-Id": str(other.id)}).status_code == 200   # explicit platform targeting


# ------------------------------------------------------------------------------ legacy organization endpoints obey the same rules
def test_org_invite_and_member_endpoints_respect_the_hierarchy(db):
    c, csrf, admin, org, _b = session_for(db, "ADMIN")
    assert c.post("/api/organization/users/invite", json={"email": f"x.{tag()}@roletest.com", "role": "ADMIN", "password": PASSWORD}, headers=csrf).status_code == 403
    assert c.post("/api/organization/users/invite", json={"email": f"y.{tag()}@roletest.com", "role": "HR", "password": PASSWORD}, headers=csrf).status_code == 403
    ok = c.post("/api/organization/users/invite", json={"email": f"z.{tag()}@roletest.com", "role": "STUDENT", "password": PASSWORD}, headers=csrf)
    assert ok.status_code == 200, ok.text
    own_member = db.query(models.OrganizationMember).filter_by(user_id=admin.id).first()
    other_admin = make_account(db, org, "ADMIN")
    other_member = db.query(models.OrganizationMember).filter_by(user_id=other_admin.id).first()
    assert c.patch(f"/api/organization/users/{own_member.id}", json={"role": "ORGANIZATION_ADMIN"}, headers=csrf).status_code == 403
    assert c.patch(f"/api/organization/users/{other_member.id}", json={"status": "deactivated"}, headers=csrf).status_code == 403
    assert c.delete(f"/api/organization/users/{other_member.id}", headers=csrf).status_code == 403
    db.expire_all()
    assert db.query(models.User).get(other_admin.id).is_active and db.query(models.User).get(admin.id).role == "ADMIN"
    sc, scsrf, _sa, _o, _b2 = session_for(db, "SUPER_ADMIN", org=org)
    assert sc.post("/api/organization/users/invite", json={"email": f"w.{tag()}@roletest.com", "role": "ADMIN", "password": PASSWORD}, headers=scsrf).status_code == 200
    # a role patch labels the membership but never rewrites the account's own stored role to a non-canonical value
    assert sc.patch(f"/api/organization/users/{other_member.id}", json={"role": "HR"}, headers=scsrf).status_code == 200
    db.expire_all()
    assert db.query(models.User).get(other_admin.id).role == "ADMIN"


def test_student_cannot_reach_any_account_or_platform_endpoint(db):
    c, csrf, *_ = session_for(db, "STUDENT")
    for method, path, body in [("post", "/api/admin/users/", payload("STUDENT")), ("get", "/api/admin/users/", None),
                               ("get", "/api/platform/organizations", None),
                               ("post", "/api/organization/users/invite", {"email": "a@b.co", "role": "STUDENT"})]:
        res = getattr(c, method)(path, headers=csrf, **({"json": body} if body is not None else {}))
        assert res.status_code == 403, (path, res.status_code)


# ------------------------------------------------------------------------------ migration
def _make_db(path, rows):
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, hashed_password TEXT, role TEXT, is_active BOOLEAN);
        CREATE TABLE organization_members (id INTEGER PRIMARY KEY, organization_id INT, user_id INT, role TEXT, status TEXT);
    """)
    for i, (email, role) in enumerate(rows, start=1):
        conn.execute("INSERT INTO users VALUES (?,?,?,?,1)", (i, email, "$2b$12$hash" + str(i), role))
        conn.execute("INSERT INTO organization_members VALUES (?,?,?,?, 'active')", (i, 1, i, role))
    conn.commit()
    conn.close()


def _migrate(path, *extra):
    env = dict(os.environ, DATABASE_URL=f"sqlite:///{path}", PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run([sys.executable, "migrate_super_admin.py", "--backup-dir", os.path.dirname(path), *extra],
                          cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)


def test_migration_provisions_super_admin_classifies_legacy_roles_and_is_idempotent(tmp_path):
    path = str(tmp_path / "m.db")
    _make_db(path, [("admin@thirdeyedata.ai", "PLATFORM_ADMIN"), ("hr@c.com", "HR"), ("oa@c.com", "ORGANIZATION_ADMIN"),
                    ("old.platform@c.com", "PLATFORM_ADMIN"), ("s@c.com", "STUDENT"), ("candidate_1@hiringai.internal", "CANDIDATE"), ("weird@c.com", "SOMETHING")])
    dry = _migrate(path)
    assert dry.returncode == 0 and "DRY RUN" in dry.stdout
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT role FROM users WHERE id=1").fetchone()[0] == "PLATFORM_ADMIN"        # dry run wrote nothing
    run = _migrate(path, "--execute")
    assert run.returncode == 0, run.stdout + run.stderr
    conn.close()
    conn = sqlite3.connect(path)
    roles = dict(conn.execute("SELECT email, role FROM users").fetchall())
    assert roles["admin@thirdeyedata.ai"] == "SUPER_ADMIN"
    assert roles["hr@c.com"] == roles["oa@c.com"] == "ADMIN"
    assert roles["old.platform@c.com"] == "PLATFORM_ADMIN" and roles["weird@c.com"] == "SOMETHING"    # reported for manual review, not guessed
    assert roles["s@c.com"] == "STUDENT" and roles["candidate_1@hiringai.internal"] == "CANDIDATE"
    assert conn.execute("SELECT role FROM organization_members WHERE user_id=2").fetchone()[0] == "ADMIN"
    assert "MANUAL REVIEW" in run.stdout and "old.platform@c.com" in run.stdout
    assert conn.execute("SELECT hashed_password FROM users WHERE id=1").fetchone()[0] == "$2b$12$hash1"    # passwords untouched
    before = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
    again = _migrate(path, "--execute")
    assert again.returncode == 0 and "already migrated" in again.stdout
    assert conn.execute("SELECT * FROM users ORDER BY id").fetchall() == before
    conn.close()


def test_migration_refuses_to_elevate_a_non_admin_or_missing_account(tmp_path):
    path = str(tmp_path / "n.db")
    _make_db(path, [("admin@thirdeyedata.ai", "STUDENT"), ("a@c.com", "ADMIN")])
    res = _migrate(path, "--execute")
    assert res.returncode != 0 and "refusing to elevate" in (res.stdout + res.stderr)
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT role FROM users WHERE id=1").fetchone()[0] == "STUDENT"
    path2 = str(tmp_path / "o.db")
    _make_db(path2, [("a@c.com", "ADMIN")])
    assert _migrate(path2, "--execute").returncode != 0
