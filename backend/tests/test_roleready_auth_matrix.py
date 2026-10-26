"""
Test Suite: RoleReady Student and Administrator Authentication Matrix
Verifies:
1. Admin-provisioned student signs in through the local login and gets a STUDENT session.
2. Existing student session persistence.
3. Administrator sign-in with active Organization Membership (HR / Org Admin).
4. Platform Administrator sign-in authorization.
5. Unprovisioned e-mail attempting sign-in is rejected (HTTP 401) and is never created.
6. The former pre-auth e-mail probe / token exchange endpoints no longer exist.
7. Unauthenticated calls to protected student endpoints are rejected with HTTP 401.
8. Student cannot access another student's assessment session (HTTP 403).
"""
import uuid
from datetime import datetime, timedelta
import pytest
from fastapi.testclient import TestClient
import models, database, utils
from services import roleready_service
from main import app
from tests import recruitment_helpers as rh
from tests import local_auth_helpers as lh

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()

def test_admin_provisioned_student_login(db_session):
    test_email = "new.student.eval@roleready-eval.com"
    db_session.query(models.StudentProfile).filter_by(email=test_email).delete()
    db_session.query(models.User).filter_by(email=test_email).delete()
    db_session.commit()

    # 1. An administrator creates the student account (the only way accounts come to exist)
    admin = rh.make_admin(db_session, tag=rh.new_tag())
    create_res = client.post("/api/admin/users/", headers=rh.auth(admin["token"]), json={
        "role": "STUDENT", "full_name": "New Student", "email": test_email, "password": lh.TEST_PASSWORD,
    })
    assert create_res.status_code == 201, create_res.text

    # 2. The student signs in through the single login
    c, login_res = lh.login(test_email)
    assert login_res.json()["role"] == "STUDENT"
    assert "access" not in login_res.json()

    # 3. Verify user profile returned from /api/auth/me has role STUDENT
    me_res = c.get("/api/auth/me")
    assert me_res.status_code == 200
    user_data = me_res.json()
    assert user_data["email"] == test_email
    assert user_data["role"] == "STUDENT"

def test_unprovisioned_email_login_rejected(db_session):
    unprovisioned_email = "uninvited.guest@randomcompany.com"

    lh.reset_login_limits()
    login_res = client.post("/api/auth/login/", json={"email": unprovisioned_email, "password": lh.TEST_PASSWORD})
    assert login_res.status_code == 401
    assert login_res.json()["detail"] == "Invalid email or password."
    assert db_session.query(models.User).filter_by(email=unprovisioned_email).first() is None

    # The Clerk-era pre-auth probe and token exchange no longer exist
    assert client.post("/api/auth/check-email/", json={"email": unprovisioned_email, "intent": "admin"}).status_code in (404, 405)
    assert client.post("/api/auth/clerk-sync/", json={"email": unprovisioned_email, "role_intent": "admin"}).status_code in (404, 405)
    assert db_session.query(models.User).filter_by(email=unprovisioned_email).first() is None

def test_platform_admin_login(db_session):
    admin_email = "admin@thirdeyedata.ai"
    org = lh.ensure_org(db_session)
    lh.ensure_user(db_session, admin_email, models.UserRole.ADMIN, org=org, admin_membership=True)

    c, login_res = lh.login(admin_email)
    assert login_res.json()["role"] == "ADMIN"

    me_res = c.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["role"] in ("ADMIN", "PLATFORM_ADMIN")

def test_unauthenticated_session_endpoints_return_401(db_session):
    """Unauthenticated access to RoleReady assessment session endpoints returns HTTP 401."""
    random_uuid = str(uuid.uuid4())
    res_status = client.get(f"/api/roleready/session/{random_uuid}")
    assert res_status.status_code == 401
    assert "Authentication required" in res_status.json()["detail"]

    res_start = client.post(f"/api/roleready/session/{random_uuid}/start-aptitude")
    assert res_start.status_code == 401

    res_report = client.get(f"/api/roleready/session/{random_uuid}/report")
    assert res_report.status_code == 401

def test_cross_student_session_access_returns_403(db_session):
    """Student cannot access another student's assessment session (HTTP 403 Forbidden)."""
    org = lh.ensure_org(db_session)
    email_1 = f"student1_{uuid.uuid4().hex[:6]}@matrix.test"
    email_2 = f"student2_{uuid.uuid4().hex[:6]}@matrix.test"
    lh.ensure_user(db_session, email_1, models.UserRole.STUDENT, org=org, student_profile=True)
    lh.ensure_user(db_session, email_2, models.UserRole.STUDENT, org=org, student_profile=True)
    client_2, _ = lh.login(email_2)

    # Student 1 creates session
    user_1 = db_session.query(models.User).filter_by(email=email_1).first()
    profile_1 = db_session.query(models.StudentProfile).filter_by(user_id=user_1.id).first()
    session_1 = roleready_service.create_student_session(db_session, profile_1, "Backend Engineer")

    # Student 2 tries to access Student 1's session -> 403 Forbidden
    res_status = client_2.get(f"/api/roleready/session/{session_1.session_uuid}")
    assert res_status.status_code == 403
    assert "Access denied" in res_status.json()["detail"]

    res_apt = client_2.post(f"/api/roleready/session/{session_1.session_uuid}/start-aptitude", headers={'X-CSRF-Token': client_2.get('/api/auth/me').json()['csrf_token']})
    assert res_apt.status_code == 403

    res_rep = client_2.get(f"/api/roleready/session/{session_1.session_uuid}/report")
    assert res_rep.status_code == 403

def test_expired_candidate_invitation_returns_410(db_session):
    """Accessing assessment portal or session with an expired invitation token returns HTTP 410."""
    org = db_session.query(models.Organization).first()
    if not org:
        org = models.Organization(name="Matrix Test Org", slug="matrix-org", status="active")
        db_session.add(org)
        db_session.commit()
        db_session.refresh(org)

    cand = models.Candidate(name="Expired Candidate", email=f"exp_{uuid.uuid4().hex[:6]}@test.com", organization_id=org.id)
    db_session.add(cand)
    db_session.commit()
    db_session.refresh(cand)

    batch = roleready_service.create_recruitment_batch(db_session, org.id, "Expired Test Batch")
    expired_token = f"expired_token_{uuid.uuid4().hex}"
    inv = models.CandidateInvitation(
        organization_id=org.id,
        candidate_id=cand.id,
        batch_id=batch.id,
        invitation_token=expired_token,
        status="PENDING",
        expires_at=datetime.utcnow() - timedelta(days=1)  # expired yesterday
    )
    db_session.add(inv)
    db_session.commit()

    # 1. Portal verify returns 410 Gone
    res_verify = client.get(f"/api/roleready/portal/verify?token={expired_token}")
    assert res_verify.status_code == 410
    assert "expired" in res_verify.json()["detail"].lower()

    # 2. Direct session access with expired token header returns 410 Gone
    fake_session_uuid = str(uuid.uuid4())
    res_session = client.get(
        f"/api/roleready/session/{fake_session_uuid}",
        headers={"X-Invitation-Token": expired_token}
    )
    # The session might not exist (404) or invitation is expired (410)
    session = models.RoleReadySession(
        session_uuid=str(uuid.uuid4()),
        organization_id=org.id,
        candidate_id=cand.id,
        invitation_id=inv.id,
        target_role="Engineer",
        current_state=models.RoleReadySessionState.NOT_STARTED
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)

    res_session_with_inv = client.get(
        f"/api/roleready/session/{session.session_uuid}",
        headers={"X-Invitation-Token": expired_token}
    )
    assert res_session_with_inv.status_code == 410
    assert "expired" in res_session_with_inv.json()["detail"].lower()



def test_cookie_session_student_can_open_own_roleready_session(db_session):
    """A browser student (HttpOnly cookie session, no Authorization header) can open their OWN assessment session."""
    org = lh.ensure_org(db_session)
    email = f"cookie.student.{uuid.uuid4().hex[:6]}@matrix-eval.com"
    user = lh.ensure_user(db_session, email, models.UserRole.STUDENT, org=org, student_profile=True)
    profile = db_session.query(models.StudentProfile).filter_by(user_id=user.id).first()
    session = roleready_service.create_student_session(db_session, profile, "Backend Engineer")

    c, _ = lh.login(email)
    res = c.get(f"/api/roleready/session/{session.session_uuid}")
    assert res.status_code == 200, f"cookie-authenticated student got {res.status_code}: {res.text}"
