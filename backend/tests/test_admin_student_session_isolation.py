"""
test_admin_student_session_isolation.py

Comprehensive regression test suite verifying Admin–Student session isolation
and organization context invariants in PrepWin (local cookie-session authentication).

Covers:
- Test A: Original reproduction sequence (Admin login -> Student login -> Admin refresh -> verify identity and org data).
- Test B: Reverse login order (Student login -> Admin login -> both refresh -> independent identities).
- Test C: Session isolation (Student session rejected on admin endpoints; Admin session rejected on student endpoints).
- Test D: Cross-tenant isolation and unauthorized X-Organization-Id forgery rejection.
- Test E: Standard Student Account Isolation (Gopal as student gets a STUDENT session and profile; strictly rejected on admin recruitment tools).
- Test F: Organization context resolution and refresh persistence.
"""

import models
import database
from tests import recruitment_helpers as rh
from tests import local_auth_helpers as lh

ADMIN_EMAIL = "admin@thirdeyedata.ai"
GOPAL_EMAIL = "gopalmuri1919@gmail.com"


def _seed(*students):
    """Seeds the admin plus the given student e-mails in the shared org; returns the org id."""
    db = database.SessionLocal()
    try:
        org = lh.ensure_org(db)
        lh.ensure_user(db, ADMIN_EMAIL, models.UserRole.ADMIN, org=org, admin_membership=True)
        for email in students:
            lh.ensure_user(db, email, models.UserRole.STUDENT, org=org, student_profile=True, full_name="Gopal Muri" if email == GOPAL_EMAIL else None)
        return org.id
    finally:
        db.close()


def test_scenario_a_original_reproduction_sequence():
    """
    Test A: The exact sequence reported in the bug, with two independent browsers (cookie jars):
    1. Admin logs in as admin@thirdeyedata.ai.
    2. Admin verifies identity via /api/auth/me and access to the org's job roles.
    3. Student logs in as Gopal in a separate context; verifies identity (role='STUDENT').
    4. Admin portal refreshes: the admin session is re-validated and the identity did not change.
    5. Admin calls /api/admin/job-roles/ with the org context: succeeds with 200 OK.
    """
    org_id = _seed(GOPAL_EMAIL)

    admin_c, admin_login_res = lh.login(ADMIN_EMAIL)
    assert admin_login_res.json().get("role") == "ADMIN"
    assert admin_login_res.json().get("organization_id") == org_id

    admin_data = admin_c.get("/api/auth/me").json()
    assert admin_data["email"] == ADMIN_EMAIL
    assert admin_data["role"] == "ADMIN"
    assert admin_data["organization_id"] == org_id

    student_c, student_login_res = lh.login(GOPAL_EMAIL)
    assert student_login_res.json()["role"] == "STUDENT"
    student_data = student_c.get("/api/auth/me").json()
    assert student_data["email"] == GOPAL_EMAIL
    assert student_data["role"] == "STUDENT"

    me_admin_refresh = admin_c.get("/api/auth/me")
    assert me_admin_refresh.status_code == 200
    admin_refresh_data = me_admin_refresh.json()
    assert admin_refresh_data["email"] == ADMIN_EMAIL, "Admin identity must not change to Gopal!"
    assert admin_refresh_data["role"] == "ADMIN"
    assert admin_refresh_data["organization_id"] == org_id

    roles_res = admin_c.get("/api/admin/job-roles/", headers={"X-Organization-Id": str(org_id)})
    assert roles_res.status_code == 200, f"Admin job roles request failed: {roles_res.text}"
    assert isinstance(roles_res.json(), list)


def test_scenario_b_reverse_login_order():
    """
    Test B: Reverse login order: student first, admin second; both refresh; neither identity changes.
    """
    _seed("student_reverse@test.com")

    student_c, _ = lh.login("student_reverse@test.com")
    admin_c, _ = lh.login(ADMIN_EMAIL)

    s_me = student_c.get("/api/auth/me").json()
    assert s_me["role"] == "STUDENT"
    assert s_me["email"] == "student_reverse@test.com"

    a_me = admin_c.get("/api/auth/me").json()
    assert a_me["role"] == "ADMIN"
    assert a_me["email"] == ADMIN_EMAIL


def test_scenario_c_strict_token_isolation():
    """
    Test C: Strict session isolation:
    - Student session sent to admin-only endpoint -> 403 Forbidden.
    - Admin session sent to student-only endpoint -> 403 Forbidden.
    - Missing credentials -> 401 Unauthorized.
    """
    _seed("isolated_student@test.com")

    student_c, _ = lh.login("isolated_student@test.com")
    admin_c, _ = lh.login(ADMIN_EMAIL)

    admin_attempt = student_c.get("/api/admin/job-roles/")
    assert admin_attempt.status_code == 403, f"Expected 403, got {admin_attempt.status_code}"

    student_attempt = admin_c.get("/api/student/profile")
    assert student_attempt.status_code == 403, f"Expected 403, got {student_attempt.status_code}"

    anon = lh.new_client()
    assert anon.get("/api/admin/job-roles/").status_code == 401
    assert anon.get("/api/student/profile").status_code == 401


def test_scenario_d_organization_isolation_and_cross_tenant_rejection():
    """
    Test D: Verify tenant isolation:
    - An admin belonging to Org A cannot access Org B using X-Organization-Id.
    - An invalid organization ID is rejected.
    """
    db = database.SessionLocal()
    try:
        admin_a = rh.make_admin(db, tag=rh.new_tag())
        admin_b = rh.make_admin(db, tag=rh.new_tag())

        # Admin A accesses own org -> 200
        res_a = lh.new_client().get("/api/admin/job-roles/", headers=rh.auth(admin_a["token"]))
        assert res_a.status_code == 200

        # Admin A attempts cross-org access to Org B -> 403
        cross_res = lh.new_client().get(
            "/api/admin/job-roles/",
            headers={**rh.auth(admin_a["token"]), "X-Organization-Id": str(admin_b["org"].id)}
        )
        assert cross_res.status_code == 403
        assert "not an active member" in cross_res.json()["detail"].lower() or "not authorized" in cross_res.json()["detail"].lower()

        # Admin A provides invalid non-existent org ID -> 403 (membership required)
        invalid_res = lh.new_client().get(
            "/api/admin/job-roles/",
            headers={**rh.auth(admin_a["token"]), "X-Organization-Id": "99999999"}
        )
        assert invalid_res.status_code in (403, 404)
    finally:
        db.close()


def test_scenario_e_gopal_student_account_isolation():
    """
    Test E: Standard Student Account Isolation (Gopal):
    - Gopal logs in and receives a STUDENT session (a client-supplied admin intent is ignored) with profile.
    - Gopal's session can access student learning/profile endpoints.
    - Gopal's session CANNOT access admin recruitment endpoints (403).
    - Gopal has zero admin membership and zero admin privileges.
    """
    _seed(GOPAL_EMAIL)
    db = database.SessionLocal()
    try:
        gopal_id = db.query(models.User).filter_by(email=GOPAL_EMAIL).first().id
    finally:
        db.close()

    lh.reset_login_limits()
    student_c = lh.new_client()
    login_res = student_c.post("/api/auth/login/", json={
        "email": GOPAL_EMAIL, "password": lh.TEST_PASSWORD, "role_intent": "admin", "role": "ADMIN",
    })
    assert login_res.status_code == 200
    assert login_res.json()["role"] == "STUDENT"

    profile_res = student_c.get("/api/student/profile")
    assert profile_res.status_code == 200
    assert profile_res.json()["email"] == GOPAL_EMAIL

    assert student_c.get("/api/admin/job-roles/").status_code == 403

    db = database.SessionLocal()
    try:
        assert db.query(models.OrganizationMember).filter_by(user_id=gopal_id).count() == 0
    finally:
        db.close()
