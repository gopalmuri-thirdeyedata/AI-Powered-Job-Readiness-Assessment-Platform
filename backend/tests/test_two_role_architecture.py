"""
Comprehensive Regression Test Suite for PrepWin Two-Role Architecture:
Verifies:
1. Canonical UserRole Enum: exactly ADMIN and STUDENT (with transparent backward-compat aliases).
2. Primary Login Entry Points:
   - Student Login provisions/issues strictly STUDENT tokens.
   - Admin Login rejects unauthorized non-admin accounts and issues ADMIN tokens.
3. Strict API Authorization:
   - Students are strictly forbidden (403) from accessing admin and recruitment endpoints.
   - Admins cannot be inadvertently auto-provisioned as students.
4. Multi-Role Account Isolation:
   - Test accounts provisioned with multiple roles receive role strictly matching role_intent.
5. Multi-Tenant Isolation under Two-Role Architecture:
   - Tenant Admins are restricted strictly to their assigned organization.
   - Cross-organization header (X-Organization-Id) is strictly forbidden for tenant admins.
   - Unanchored system administrators can target tenants explicitly via X-Organization-Id.
6. Candidate capability assessments remain functional.
"""

import uuid
import pytest
from fastapi.testclient import TestClient
import models
import database
import utils
from main import app
from tests import recruitment_helpers as rh
from tests import local_auth_helpers as lh

client = TestClient(app)


def test_01_user_role_canonical_enum():
    """Verify the three canonical roles (SUPER_ADMIN, ADMIN, STUDENT) and that legacy aliases keep their meaning."""
    assert models.UserRole.SUPER_ADMIN.value == "SUPER_ADMIN"
    assert models.UserRole.ADMIN.value == "ADMIN"
    assert models.UserRole.STUDENT.value == "STUDENT"
    assert len({models.UserRole.SUPER_ADMIN, models.UserRole.ADMIN, models.UserRole.STUDENT}) == 3
    # The legacy platform role is the Super Admin; the legacy organization-level roles are ordinary ADMIN accounts
    assert models.UserRole.PLATFORM_ADMIN == models.UserRole.SUPER_ADMIN
    assert models.UserRole.PLATFORM_ADMIN != models.UserRole.ADMIN
    for legacy in ("ORGANIZATION_ADMIN", "HR", "RECRUITER", "HR_ADMIN", "INTERVIEWER"):
        assert getattr(models.UserRole, legacy) == models.UserRole.ADMIN, legacy


def test_02_student_login_issues_student_role():
    """Verify the single login issues a strictly STUDENT session for a student account (client intent ignored)."""
    tag = uuid.uuid4().hex[:8]
    student_email = f"student_{tag}@testrole.com"
    db = database.SessionLocal()
    try:
        org = lh.ensure_org(db)
        lh.ensure_user(db, student_email, models.UserRole.STUDENT, org=org, student_profile=True, full_name="Test Student")
    finally:
        db.close()

    c, login_res = lh.login(student_email)
    assert login_res.json()["role"] == "STUDENT"

    me_res = c.get("/api/auth/me")
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["role"] == "STUDENT"
    assert me_data["email"] == student_email

    # Asking for an admin session at login changes nothing
    lh.reset_login_limits()
    c2 = lh.new_client()
    res = c2.post("/api/auth/login/", json={"email": student_email, "password": lh.TEST_PASSWORD, "role_intent": "admin", "role": "ADMIN"})
    assert res.status_code == 200 and res.json()["role"] == "STUDENT"
    assert c2.get("/api/auth/me").json()["role"] == "STUDENT"


def test_03_admin_login_rejects_unprovisioned_users():
    """Verify the login rejects unknown accounts, and the removed Clerk provisioning endpoint cannot create one."""
    tag = uuid.uuid4().hex[:8]
    random_email = f"stranger_{tag}@testrole.com"

    lh.reset_login_limits()
    login_res = client.post("/api/auth/login/", json={
        "email": random_email,
        "password": "wrongpassword"
    })
    assert login_res.status_code == 401
    assert login_res.json()["detail"] == "Invalid email or password."

    # No unauthenticated endpoint provisions an account for an unknown e-mail
    sync_res = client.post("/api/auth/clerk-sync/", json={
        "email": random_email,
        "clerk_user_id": f"clerk_un_{tag}",
        "role_intent": "admin"
    })
    assert sync_res.status_code in (404, 405)
    db = database.SessionLocal()
    try:
        assert db.query(models.User).filter(models.User.email == random_email).count() == 0
    finally:
        db.close()


def test_04_student_cannot_access_admin_apis():
    """Verify Student token receives 403 Forbidden on all administrative and recruitment endpoints."""
    db = database.SessionLocal()
    try:
        tag = uuid.uuid4().hex[:8]
        org = models.Organization(name=f"Org {tag}", slug=f"org-{tag}", status="active")
        db.add(org)
        db.commit()

        user = models.User(email=f"stu_{tag}@testrole.com", hashed_password="x", role=models.UserRole.STUDENT, organization_id=org.id)
        db.add(user)
        db.commit()
        token = utils.create_access_token(data={"sub": user.email, "role": user.role})
        headers = {"Authorization": f"Bearer {token}"}

        # Attempt to access admin routes
        assert client.get("/api/admin/job-roles/", headers=headers).status_code == 403
        assert client.get("/api/admin/recruitment/overview-stats", headers=headers).status_code == 403
        assert client.get("/api/admin/recruitment/candidates", headers=headers).status_code == 403
        assert client.put("/api/settings/", headers=headers, json={"config": {}}).status_code == 403
        assert client.get("/api/platform/organizations", headers=headers).status_code == 403
    finally:
        db.close()


def test_05_admin_cannot_access_student_assessment_endpoints():
    """Verify Admin token receives 403 Forbidden on student assessment endpoints and is not auto-provisioned."""
    db = database.SessionLocal()
    try:
        admin = rh.make_admin(db, tag=rh.new_tag())
        token = admin["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Student assessment endpoints reject admin token
        assert client.get("/api/roleready/student/assessments", headers=headers).status_code == 403
        assert client.get("/api/roleready/student/history", headers=headers).status_code == 403

        # Admin must NOT have a StudentProfile created
        db.expire_all()
        assert db.query(models.StudentProfile).filter(models.StudentProfile.user_id == admin["user"].id).count() == 0

        # Profile remains ADMIN
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["role"] == "ADMIN"
    finally:
        db.close()


def test_06_dual_identity_support():
    """Verify an admin account's role is the stored role: a client-supplied student intent neither downgrades nor leaks sessions."""
    db = database.SessionLocal()
    try:
        tag = uuid.uuid4().hex[:8]
        dual_email = f"dual_{tag}@testrole.com"

        org = models.Organization(name=f"Dual Org {tag}", slug=f"dual-org-{tag}", status="active")
        db.add(org)
        db.commit()
        lh.ensure_user(db, dual_email, models.UserRole.ADMIN, org=org, admin_membership=True)
        org_id = org.id
    finally:
        db.close()

    # Even when the client asks for a student session, the stored ADMIN role decides (and there is no student profile side effect)
    lh.reset_login_limits()
    c1 = lh.new_client()
    res1 = c1.post("/api/auth/login/", json={"email": dual_email, "password": lh.TEST_PASSWORD, "role_intent": "student"})
    assert res1.status_code == 200 and res1.json()["role"] == "ADMIN"
    me1 = c1.get("/api/auth/me").json()
    assert me1["role"] == "ADMIN"
    assert me1["organization_id"] == org_id

    # A second independent login yields an independent session with the same stored identity
    c2, res2 = lh.login(dual_email)
    assert res2.json()["role"] == "ADMIN"
    assert c1.cookies.get("prepwin_session") != c2.cookies.get("prepwin_session")
    assert c2.get("/api/auth/me").json()["organization_id"] == org_id

    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == dual_email).first()
        assert db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).count() == 0
    finally:
        db.close()


def test_07_tenant_isolation_under_two_roles():
    """Verify tenant isolation: Admin of Org A cannot access Org B, and cannot forge X-Organization-Id."""
    db = database.SessionLocal()
    try:
        admin_a = rh.make_admin(db, tag=rh.new_tag())
        admin_b = rh.make_admin(db, tag=rh.new_tag())

        # Admin A accesses own org
        res_a = client.get("/api/admin/job-roles/", headers=rh.auth(admin_a["token"]))
        assert res_a.status_code == 200

        # Admin A attempts to access Org B via X-Organization-Id header -> 403 Forbidden
        forge_res = client.get(
            "/api/admin/job-roles/",
            headers={**rh.auth(admin_a["token"]), "X-Organization-Id": str(admin_b["org"].id)}
        )
        assert forge_res.status_code == 403
        assert any(phrase in forge_res.json()["detail"].lower() for phrase in ("not authorized", "not an active member"))
    finally:
        db.close()


def test_08_unanchored_platform_admin_with_header():
    """Verify an unanchored SUPER_ADMIN (platform scope comes from the role, not the e-mail) can manage a tenant explicitly via X-Organization-Id."""
    db = database.SessionLocal()
    try:
        target_org = models.Organization(name=f"Target {rh.new_tag()}", slug=f"target-{rh.new_tag()}", status="active")
        db.add(target_org)
        db.commit()

        plat_email = f"platform.{rh.new_tag()}@rwtest.com"
        plat_user = models.User(email=plat_email, hashed_password="x", role=models.UserRole.SUPER_ADMIN, is_active=True)
        db.add(plat_user)
        db.commit()
        plat_tok = utils.create_access_token(data={"sub": plat_user.email, "role": plat_user.role})

        # Missing header -> 400 Bad Request
        res_no_header = client.get("/api/admin/job-roles/", headers=rh.auth(plat_tok))
        assert res_no_header.status_code == 400
        assert "X-Organization-Id" in res_no_header.json()["detail"]

        # Valid header -> 200 OK
        res_with_header = client.get(
            "/api/admin/job-roles/",
            headers={**rh.auth(plat_tok), "X-Organization-Id": str(target_org.id)}
        )
        assert res_with_header.status_code == 200
    finally:
        db.close()
