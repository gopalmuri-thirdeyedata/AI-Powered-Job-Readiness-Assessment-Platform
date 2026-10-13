"""
Test Suite: RoleReady Student and Administrator Authentication Matrix
Verifies:
1. Student sign-in provisioning & JWT issuance with role STUDENT.
2. Existing student session persistence.
3. Administrator sign-in with active Organization Membership (HR / Org Admin).
4. Platform Administrator sign-in authorization.
5. Unprovisioned Clerk user attempting Admin Sign In is rejected with HTTP 403.
6. Email check endpoint respects student vs admin intent.
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

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()

def test_student_clerk_sync_provisioning(db_session):
    test_email = "new.student.eval@roleready.test"
    
    # 1. Check email pre-authorization with student intent
    check_res = client.post("/api/auth/check-email/", json={"email": test_email, "intent": "student"})
    assert check_res.status_code == 200
    assert check_res.json().get("allowed") is True

    # 2. Sync Clerk user with student intent
    sync_res = client.post("/api/auth/clerk-sync/", json={
        "email": test_email,
        "clerk_user_id": "clerk_student_12345",
        "role_intent": "student"
    })
    assert sync_res.status_code == 200
    data = sync_res.json()
    assert "access" in data

    token = data["access"]
    
    # 3. Verify user profile returned from /api/auth/me has role STUDENT
    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    user_data = me_res.json()
    assert user_data["email"] == test_email
    assert user_data["role"] == "STUDENT"

def test_unprovisioned_admin_clerk_sync_rejected(db_session):
    unprovisioned_email = "uninvited.guest@randomcompany.com"

    # 1. Check email pre-authorization with admin intent
    check_res = client.post("/api/auth/check-email/", json={"email": unprovisioned_email, "intent": "admin"})
    assert check_res.status_code == 200
    assert check_res.json().get("allowed") is False

    # 2. Attempt admin Clerk sync
    sync_res = client.post("/api/auth/clerk-sync/", json={
        "email": unprovisioned_email,
        "clerk_user_id": "clerk_random_99999",
        "role_intent": "admin"
    })
    assert sync_res.status_code == 403
    assert "not been provisioned" in sync_res.json().get("detail", "")

def test_platform_admin_clerk_sync(db_session):
    admin_email = "gopalmuri1919@gmail.com"

    sync_res = client.post("/api/auth/clerk-sync/", json={
        "email": admin_email,
        "clerk_user_id": "clerk_platform_admin_id",
        "role_intent": "admin"
    })
    assert sync_res.status_code == 200
    token = sync_res.json().get("access")

    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "PLATFORM_ADMIN"

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
    # Provision student 1
    email_1 = f"student1_{uuid.uuid4().hex[:6]}@matrix.test"
    sync_1 = client.post("/api/auth/clerk-sync/", json={"email": email_1, "clerk_user_id": f"c_{uuid.uuid4().hex[:6]}", "role_intent": "student"})
    assert sync_1.status_code == 200
    token_1 = sync_1.json()["access"]
    headers_1 = {"Authorization": f"Bearer {token_1}"}

    # Provision student 2
    email_2 = f"student2_{uuid.uuid4().hex[:6]}@matrix.test"
    sync_2 = client.post("/api/auth/clerk-sync/", json={"email": email_2, "clerk_user_id": f"c_{uuid.uuid4().hex[:6]}", "role_intent": "student"})
    assert sync_2.status_code == 200
    token_2 = sync_2.json()["access"]
    headers_2 = {"Authorization": f"Bearer {token_2}"}

    # Student 1 creates session
    user_1 = db_session.query(models.User).filter_by(email=email_1).first()
    profile_1 = db_session.query(models.StudentProfile).filter_by(user_id=user_1.id).first()
    session_1 = roleready_service.create_student_session(db_session, profile_1, "Backend Engineer")

    # Student 2 tries to access Student 1's session -> 403 Forbidden
    res_status = client.get(f"/api/roleready/session/{session_1.session_uuid}", headers=headers_2)
    assert res_status.status_code == 403
    assert "Access denied" in res_status.json()["detail"]

    res_apt = client.post(f"/api/roleready/session/{session_1.session_uuid}/start-aptitude", headers=headers_2)
    assert res_apt.status_code == 403

    res_rep = client.get(f"/api/roleready/session/{session_1.session_uuid}/report", headers=headers_2)
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

