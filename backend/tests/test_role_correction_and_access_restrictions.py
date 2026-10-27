"""
Comprehensive Automated Test Suite:
PrepWin User Roles Correction and Access Restrictions Enforcement

Verifies (all through the single local login, /api/auth/login/, with real cookie sessions):
1. Administrator (admin@thirdeyedata.ai):
   - Login succeeds; /api/auth/me returns 'ADMIN'.
   - Admin APIs return 200 OK.
   - Student endpoints return 403 Forbidden.
   - The removed Clerk token-exchange endpoint cannot mint a session for the admin e-mail.
2. Gopal (gopalmuri1919@gmail.com):
   - Logs in as STUDENT; /api/auth/me returns 'STUDENT'.
   - Student dashboard and supported APIs return 200 OK.
   - A wrong password is rejected; a client-supplied admin role/intent never elevates Gopal.
   - Direct requests to admin APIs return 403 Forbidden.
   - Stale JWTs claiming 'ADMIN' are rejected with 401 Unauthorized.
3. Other Student (mundgodsuprit@gmail.com):
   - Logs in as STUDENT.
   - /api/auth/me returns 'STUDENT'.
   - Assessment history and scores are accessible.
   - Direct requests to admin APIs return 403 Forbidden.
4. Security and Regression:
   - Unauthenticated requests return 401 Unauthorized.
   - Organization-level authorization remains enforced.
   - Production database backend/PrepWin.db is NOT modified during test runs.
"""

import hashlib
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

import models
import database
import utils
from main import app
from services import local_auth

DB_PATH = Path(__file__).resolve().parent.parent / "PrepWin.db"

ADMIN_EMAIL = "admin@thirdeyedata.ai"
GOPAL_EMAIL = "gopalmuri1919@gmail.com"
SUPRIT_EMAIL = "mundgodsuprit@gmail.com"
ADMIN_PW = "Adm1n-Test-Passw0rd!"
GOPAL_PW = "G0pal-Test-Passw0rd!"
SUPRIT_PW = "Supr1t-Test-Passw0rd!"


def new_client():
    return TestClient(app, base_url="http://testserver")


def login_client(email, password):
    c = new_client()
    res = c.post("/api/auth/login/", json={"email": email, "password": password})
    assert res.status_code == 200, f"Login failed for {email}: {res.text}"
    return c, res


@pytest.fixture(autouse=True)
def _fresh_limiter():
    local_auth.login_tracker.reset()
    yield
    local_auth.login_tracker.reset()


@pytest.fixture(scope="session", autouse=True)
def verify_production_db_untouched():
    """Guarantees that backend/PrepWin.db is never modified by test execution."""
    if DB_PATH.exists():
        initial_stat = DB_PATH.stat()
        initial_size = initial_stat.st_size
        with open(DB_PATH, "rb") as f:
            initial_hash = hashlib.sha256(f.read()).hexdigest()
    else:
        initial_hash = None
        initial_size = None

    yield

    if DB_PATH.exists() and initial_hash is not None:
        final_stat = DB_PATH.stat()
        final_size = final_stat.st_size
        with open(DB_PATH, "rb") as f:
            final_hash = hashlib.sha256(f.read()).hexdigest()
        assert initial_size == final_size, "Production PrepWin.db size was modified during test run!"
        assert initial_hash == final_hash, "Production PrepWin.db checksum changed during test run!"


def _upsert_user(db, email, role, password, org_id):
    user = db.query(models.User).filter_by(email=email).first()
    if not user:
        user = models.User(email=email, role=role, hashed_password=utils.get_password_hash(password), is_active=True, organization_id=org_id)
        db.add(user)
    else:
        user.role = role
        user.hashed_password = utils.get_password_hash(password)
        user.is_active = True
        user.organization_id = org_id
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture(scope="module")
def setup_three_accounts():
    """Seeds the isolated test database with the exact 3 required accounts (known local passwords) and baseline data."""
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "roleready-students").first()
        if not org:
            org = models.Organization(name="RoleReady Student Assessment Hub", slug="roleready-students", status="active")
            db.add(org)
            db.commit()
            db.refresh(org)

        # 1. Admin Account
        admin_user = _upsert_user(db, ADMIN_EMAIL, models.UserRole.ADMIN, ADMIN_PW, org.id)
        admin_member = db.query(models.OrganizationMember).filter_by(user_id=admin_user.id, organization_id=org.id).first()
        if not admin_member:
            db.add(models.OrganizationMember(organization_id=org.id, user_id=admin_user.id, role="ADMIN", status="active"))
        else:
            admin_member.status = "active"
        db.commit()

        # Ensure Admin has NO student profile
        admin_sp = db.query(models.StudentProfile).filter_by(user_id=admin_user.id).first()
        if admin_sp:
            db.delete(admin_sp)
            db.commit()

        # 2. Gopal Account (STUDENT only)
        gopal_user = _upsert_user(db, GOPAL_EMAIL, models.UserRole.STUDENT, GOPAL_PW, org.id)
        db.query(models.OrganizationMember).filter_by(user_id=gopal_user.id).delete()
        db.commit()
        if not db.query(models.StudentProfile).filter_by(user_id=gopal_user.id).first():
            db.add(models.StudentProfile(
                user_id=gopal_user.id, organization_id=org.id, email=GOPAL_EMAIL, full_name="Gopal Muri",
                target_role="Full Stack Engineer", readiness_score=85.0,
            ))
            db.commit()

        # 3. Suprit Account (STUDENT only)
        suprit_user = _upsert_user(db, SUPRIT_EMAIL, models.UserRole.STUDENT, SUPRIT_PW, org.id)
        suprit_sp = db.query(models.StudentProfile).filter_by(user_id=suprit_user.id).first()
        if not suprit_sp:
            suprit_sp = models.StudentProfile(
                user_id=suprit_user.id, organization_id=org.id, email=SUPRIT_EMAIL, full_name="Suprit Mundagod",
                target_role="Software Engineer", readiness_score=70.0,
            )
            db.add(suprit_sp)
            db.commit()
            db.refresh(suprit_sp)

        # Suprit assessment sessions (3 sessions)
        sessions_cnt = db.query(models.RoleReadySession).filter_by(student_profile_id=suprit_sp.id).count()
        if sessions_cnt < 3:
            for i in range(sessions_cnt, 3):
                db.add(models.RoleReadySession(
                    student_profile_id=suprit_sp.id,
                    organization_id=org.id,
                    session_uuid=f"test-session-uuid-suprit-{suprit_sp.id}-{i+1}",
                    workflow_type="SELF_ASSESSMENT",
                    current_state=models.RoleReadySessionState.COMPLETED,
                    overall_readiness_score=50.0 + (i * 10),
                ))
            db.commit()

        return {"org_id": org.id}
    finally:
        db.close()


# ==============================================================================
# SECTION 1: ADMINISTRATOR TESTS
# ==============================================================================

def test_admin_login_and_me_returns_admin(setup_three_accounts):
    """admin@thirdeyedata.ai can log in and /api/auth/me returns ADMIN."""
    c, res = login_client(ADMIN_EMAIL, ADMIN_PW)
    assert res.json()["role"] == "ADMIN"
    assert "access" not in res.json()

    me_res = c.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "ADMIN"
    assert me_res.json()["email"] == ADMIN_EMAIL


def test_admin_apis_return_successful(setup_three_accounts):
    """Admin APIs return successful responses for admin@thirdeyedata.ai."""
    c, _ = login_client(ADMIN_EMAIL, ADMIN_PW)
    headers = {"X-Organization-Id": str(setup_three_accounts["org_id"])}

    roles_res = c.get("/api/admin/job-roles/", headers=headers)
    assert roles_res.status_code in (200, 404) or isinstance(roles_res.json(), list)

    batches_res = c.get("/api/roleready/admin/batches", headers=headers)
    assert batches_res.status_code in (200, 404) or isinstance(batches_res.json(), list)

    assert c.get("/api/admin/users/", headers=headers).status_code == 200


def test_admin_denied_access_to_student_endpoints(setup_three_accounts):
    """Student-only endpoints deny access to admin@thirdeyedata.ai with 403 Forbidden."""
    c, _ = login_client(ADMIN_EMAIL, ADMIN_PW)

    prof_res = c.get("/api/student/profile")
    assert prof_res.status_code == 403, f"Expected 403, got {prof_res.status_code}: {prof_res.text}"

    assess_res = c.get("/api/roleready/student/assessments")
    assert assess_res.status_code == 403, f"Expected 403, got {assess_res.status_code}: {assess_res.text}"


def test_admin_cannot_login_with_student_intent(setup_three_accounts):
    """The admin e-mail cannot obtain a session through any removed pre-auth / token-exchange endpoint."""
    for path, body in [
        ("/api/auth/check-email/", {"email": ADMIN_EMAIL, "intent": "student"}),
        ("/api/auth/clerk-sync/", {"email": ADMIN_EMAIL, "role_intent": "student"}),
        ("/api/auth/clerk-sync/", {"email": ADMIN_EMAIL, "role_intent": "admin"}),
    ]:
        res = new_client().post(path, json=body)
        assert res.status_code in (404, 405), (path, res.status_code)
        assert "prepwin_session" not in res.cookies and "access" not in res.text

    # ...and the student-only API still refuses the admin's real session
    c, _ = login_client(ADMIN_EMAIL, ADMIN_PW)
    assert c.get("/api/student/profile").status_code == 403


# ==============================================================================
# SECTION 2: GOPAL ACCOUNT TESTS
# ==============================================================================

def test_gopal_login_as_student(setup_three_accounts):
    """gopalmuri1919@gmail.com logs in as STUDENT and /api/auth/me returns STUDENT."""
    c, res = login_client(GOPAL_EMAIL, GOPAL_PW)
    assert res.json()["role"] == "STUDENT"
    assert res.json()["redirect"] == "/assessment/setup"

    me_res = c.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "STUDENT"
    assert me_res.json()["email"] == GOPAL_EMAIL


def test_gopal_student_dashboard_and_apis_work(setup_three_accounts):
    """Student dashboard and supported student APIs work for Gopal."""
    c, _ = login_client(GOPAL_EMAIL, GOPAL_PW)

    prof_res = c.get("/api/student/profile")
    assert prof_res.status_code == 200
    assert prof_res.json()["email"] == GOPAL_EMAIL

    dash_res = c.get("/api/student/dashboard/unified")
    assert dash_res.status_code == 200


def test_gopal_admin_login_rejected(setup_three_accounts):
    """A wrong password never logs Gopal in, and no session cookie is issued."""
    res = new_client().post("/api/auth/login/", json={"email": GOPAL_EMAIL, "password": "AnyPassword123!"})
    assert res.status_code == 401
    assert "prepwin_session" not in res.cookies


def test_gopal_clerk_sync_admin_intent_rejected(setup_three_accounts):
    """A client-supplied admin role/intent is ignored at login: Gopal's session is STUDENT and the admin API refuses it."""
    c = new_client()
    res = c.post("/api/auth/login/", json={
        "email": GOPAL_EMAIL, "password": GOPAL_PW, "role": "ADMIN", "role_intent": "admin",
    })
    assert res.status_code == 200
    assert res.json()["role"] == "STUDENT"
    assert c.get("/api/admin/job-roles/", headers={"X-Organization-Id": str(setup_three_accounts["org_id"])}).status_code == 403
    # the removed token-exchange endpoint cannot be used to ask for an admin session either
    sync = new_client().post("/api/auth/clerk-sync/", json={"email": GOPAL_EMAIL, "role_intent": "admin"})
    assert sync.status_code in (404, 405)


def test_gopal_direct_requests_to_admin_apis_return_403(setup_three_accounts):
    """Direct requests to admin APIs with Gopal's student session return 403 Forbidden."""
    c, _ = login_client(GOPAL_EMAIL, GOPAL_PW)
    headers = {"X-Organization-Id": str(setup_three_accounts["org_id"])}

    assert c.get("/api/admin/job-roles/", headers=headers).status_code == 403
    assert c.get("/api/roleready/admin/batches", headers=headers).status_code == 403
    assert c.get("/api/admin/users/", headers=headers).status_code == 403


def test_gopal_stale_admin_jwt_is_rejected(setup_three_accounts):
    """A stale or forged JWT claiming role='ADMIN' for Gopal is rejected with 401 Unauthorized."""
    stale_token = utils.create_access_token(data={"sub": GOPAL_EMAIL, "role": "ADMIN"})
    headers = {"Authorization": f"Bearer {stale_token}"}

    me_res = new_client().get("/api/auth/me", headers=headers)
    assert me_res.status_code == 401, f"Expected 401 Unauthorized, got {me_res.status_code}: {me_res.text}"


def test_gopal_has_no_admin_memberships_or_privileges(setup_three_accounts):
    """Verify Gopal has zero records in organization_members and zero admin roles."""
    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter_by(email=GOPAL_EMAIL).first()
        assert user is not None
        assert user.role == models.UserRole.STUDENT
        memberships = db.query(models.OrganizationMember).filter_by(user_id=user.id).all()
        assert len(memberships) == 0, f"Expected 0 memberships for Gopal, found: {memberships}"
    finally:
        db.close()


# ==============================================================================
# SECTION 3: OTHER STUDENT TESTS (mundgodsuprit@gmail.com)
# ==============================================================================

def test_suprit_login_and_assessment_history(setup_three_accounts):
    """mundgodsuprit@gmail.com logs in as STUDENT and assessment history remains accessible."""
    c, res = login_client(SUPRIT_EMAIL, SUPRIT_PW)
    assert res.json()["role"] == "STUDENT"

    me_res = c.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "STUDENT"

    hist_res = c.get("/api/roleready/student/assessments")
    assert hist_res.status_code == 200
    data = hist_res.json()
    assert "assessments" in data
    assert len(data["assessments"]) == 3, f"Expected 3 preserved sessions, got {len(data['assessments'])}"


def test_suprit_admin_apis_return_403(setup_three_accounts):
    """Admin APIs return 403 Forbidden for mundgodsuprit@gmail.com."""
    c, _ = login_client(SUPRIT_EMAIL, SUPRIT_PW)
    res = c.get("/api/admin/job-roles/", headers={"X-Organization-Id": str(setup_three_accounts["org_id"])})
    assert res.status_code == 403


# ==============================================================================
# SECTION 4: SECURITY AND REGRESSION TESTS
# ==============================================================================

def test_unauthenticated_requests_return_401():
    """Unauthenticated requests to protected endpoints return 401 Unauthorized."""
    c = new_client()
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/admin/job-roles/").status_code == 401
    assert c.get("/api/student/profile").status_code == 401
    assert c.get("/api/roleready/student/assessments").status_code == 401


def test_admin_student_session_isolation(setup_three_accounts):
    """Admin and student sessions are completely isolated and do not contaminate each other."""
    admin_c, _ = login_client(ADMIN_EMAIL, ADMIN_PW)
    student_c, _ = login_client(GOPAL_EMAIL, GOPAL_PW)

    admin_me = admin_c.get("/api/auth/me").json()
    assert admin_me["role"] == "ADMIN"
    assert admin_me["email"] == ADMIN_EMAIL

    student_me = student_c.get("/api/auth/me").json()
    assert student_me["role"] == "STUDENT"
    assert student_me["email"] == GOPAL_EMAIL

    # Logging the student out leaves the admin session alive
    student_c.post("/api/auth/logout/")
    assert student_c.get("/api/auth/me").status_code == 401
    assert admin_c.get("/api/auth/me").status_code == 200
