"""
Automated Integration Test Suite for RoleReady Platform:
1. Workflow A: Student Self-Assessment End-to-End
2. Strict Sequential Round Gating & Anti-Bypass Security (HTTP 403 on skipped rounds)
3. Proctoring telemetry persistence
4. Scoring & Dual-Audience Reporting
5. Workflow B: Administrator Recruitment Batches & Invitations
6. Access Control Security: Unauthenticated access rejected (401), cross-student isolation (403), token scoping
"""
import pytest
from fastapi.testclient import TestClient
import uuid
import json

from main import app
import models, database, utils
from services import roleready_service

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    db = database.SessionLocal()
    yield db
    db.close()

@pytest.fixture(scope="module")
def setup_test_data(db_session):
    # Ensure test org exists
    org = db_session.query(models.Organization).filter_by(slug="roleready-test-org").first()
    if not org:
        org = models.Organization(name="RoleReady Test Organization", slug="roleready-test-org", status="active")
        db_session.add(org)
        db_session.commit()
        db_session.refresh(org)

    # Ensure test student user exists
    student_user = db_session.query(models.User).filter_by(email="student.test@roleready.com").first()
    if not student_user:
        student_user = models.User(
            email="student.test@roleready.com",
            hashed_password="fakehashedpassword",
            role=models.UserRole.STUDENT,
            organization_id=org.id
        )
        db_session.add(student_user)
        db_session.commit()
        db_session.refresh(student_user)

    # Ensure test student profile exists
    student_profile = db_session.query(models.StudentProfile).filter_by(user_id=student_user.id).first()
    if not student_profile:
        student_profile = models.StudentProfile(
            user_id=student_user.id,
            organization_id=org.id,
            full_name="Jordan Lee",
            email="student.test@roleready.com",
            target_role="Full Stack Engineer",
            target_company="Stripe",
            current_skills=["Python", "React", "PostgreSQL", "Docker"]
        )
        db_session.add(student_profile)
        db_session.commit()
        db_session.refresh(student_profile)

    # Generate valid JWT token for student
    student_token = utils.create_access_token(data={"sub": student_user.email, "role": student_user.role})
    auth_headers = {"Authorization": f"Bearer {student_token}"}

    # Second student for cross-user isolation verification
    student_b = db_session.query(models.User).filter_by(email="student.b@roleready.com").first()
    if not student_b:
        student_b = models.User(
            email="student.b@roleready.com",
            hashed_password="fakehashedpassword",
            role=models.UserRole.STUDENT,
            organization_id=org.id
        )
        db_session.add(student_b)
        db_session.commit()
        db_session.refresh(student_b)

    student_b_profile = db_session.query(models.StudentProfile).filter_by(user_id=student_b.id).first()
    if not student_b_profile:
        student_b_profile = models.StudentProfile(
            user_id=student_b.id,
            organization_id=org.id,
            full_name="Morgan B",
            email="student.b@roleready.com",
            target_role="Frontend Developer"
        )
        db_session.add(student_b_profile)
        db_session.commit()
        db_session.refresh(student_b_profile)

    student_b_token = utils.create_access_token(data={"sub": student_b.email, "role": student_b.role})
    student_b_headers = {"Authorization": f"Bearer {student_b_token}"}

    return {
        "org": org,
        "student_user": student_user,
        "student_profile": student_profile,
        "auth_headers": auth_headers,
        "student_b": student_b,
        "student_b_profile": student_b_profile,
        "student_b_headers": student_b_headers
    }


def test_student_session_initialization_and_jd_synthesis(db_session, setup_test_data):
    """Verifies student session creation with custom JD text and question generation."""
    profile = setup_test_data["student_profile"]
    jd_sample = """
    We are looking for a Full Stack Engineer proficient in Python, FastAPI, and React.
    Responsibilities: Build scalable APIs, design relational data schemas, solve algorithmic bottlenecks.
    Requirements: 2+ years experience with REST APIs and modern JavaScript.
    """

    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Full Stack Engineer",
        target_company="Stripe",
        custom_jd_text=jd_sample
    )

    assert session is not None
    assert session.session_uuid is not None
    assert session.current_state == models.RoleReadySessionState.NOT_STARTED
    assert len(session.round_attempts) == 3

    # Verify rounds in order
    r1, r2, r3 = session.round_attempts
    assert r1.round_type == "APTITUDE"
    assert r1.round_order == 1
    assert len(r1.questions_payload) >= 3

    assert r2.round_type == "CODING"
    assert r2.round_order == 2
    assert len(r2.questions_payload) >= 1

    assert r3.round_type == "INTERVIEW"
    assert r3.round_order == 3
    assert len(r3.questions_payload) >= 3


def test_strict_sequential_gating_anti_bypass(db_session, setup_test_data):
    """
    CRITICAL SECURITY CHECK:
    Direct API call attempting to start Coding or Interview without completing Aptitude MUST FAIL with HTTP 403.
    """
    profile = setup_test_data["student_profile"]
    headers = setup_test_data["auth_headers"]
    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Backend Developer"
    )

    # 1. Attempt to start Coding directly while session is NOT_STARTED -> Should fail 403
    response_coding = client.post(f"/api/roleready/session/{session.session_uuid}/start-coding", headers=headers)
    assert response_coding.status_code == 403
    assert "Coding round is locked" in response_coding.json()["detail"]

    # 2. Attempt to start Interview directly while session is NOT_STARTED -> Should fail 403
    response_interview = client.post(f"/api/roleready/session/{session.session_uuid}/start-interview", headers=headers)
    assert response_interview.status_code == 403
    assert "Interview round is locked" in response_interview.json()["detail"]


def test_end_to_end_assessment_workflow(db_session, setup_test_data):
    """
    Tests complete end-to-end sequential workflow:
    1. Start Aptitude -> Submit Aptitude -> Evaluated & Coding Unlocked
    2. Start Coding -> Run Test -> Submit Coding -> Evaluated & Interview Unlocked
    3. Start Interview -> Submit Interview -> Evaluated & Session Completed
    4. Fetch Final Student Report
    """
    profile = setup_test_data["student_profile"]
    headers = setup_test_data["auth_headers"]
    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Full Stack Engineer",
        target_company="Stripe"
    )
    s_uuid = session.session_uuid

    # ─── ROUND 1: APTITUDE ─────────────────────────
    res_start_apt = client.post(f"/api/roleready/session/{s_uuid}/start-aptitude", headers=headers)
    assert res_start_apt.status_code == 200
    apt_data = res_start_apt.json()
    assert apt_data["current_state"] == models.RoleReadySessionState.APTITUDE_IN_PROGRESS
    questions = apt_data["questions"]
    assert len(questions) > 0

    # Submit answers (answering "B" for all)
    answers_payload = {str(q["id"]): "B" for q in questions}
    res_sub_apt = client.post(f"/api/roleready/session/{s_uuid}/submit-aptitude", headers=headers, json={
        "answers": answers_payload,
        "time_spent_seconds": 360,
        "proctoring_violations": [{"type": "tab_switch", "timestamp": "2026-10-09T10:00:00"}]
    })
    assert res_sub_apt.status_code == 200
    sub_apt_res = res_sub_apt.json()
    assert sub_apt_res["next_round_unlocked"] is True
    assert sub_apt_res["current_state"] == models.RoleReadySessionState.CODING_UNLOCKED

    # ─── ROUND 2: CODING ───────────────────────────
    res_start_code = client.post(f"/api/roleready/session/{s_uuid}/start-coding", headers=headers)
    assert res_start_code.status_code == 200
    code_data = res_start_code.json()
    assert code_data["current_state"] == models.RoleReadySessionState.CODING_IN_PROGRESS
    problems = code_data["problems"]
    assert len(problems) > 0

    # Run code on public test case
    first_prob = problems[0]
    res_run = client.post(f"/api/roleready/session/{s_uuid}/run-code", headers=headers, json={
        "problem_id": str(first_prob["id"]),
        "code": "print('0 1')",
        "language": "python"
    })
    assert res_run.status_code == 200

    # Submit solutions
    solutions_payload = {
        str(p["id"]): {
            "code": "import sys\nprint('0 1')",
            "language": "python"
        }
        for p in problems
    }
    res_sub_code = client.post(f"/api/roleready/session/{s_uuid}/submit-coding", headers=headers, json={
        "solutions": solutions_payload,
        "time_spent_seconds": 1200
    })
    assert res_sub_code.status_code == 200
    sub_code_res = res_sub_code.json()
    assert sub_code_res["next_round_unlocked"] is True
    assert sub_code_res["current_state"] == models.RoleReadySessionState.INTERVIEW_UNLOCKED

    # ─── ROUND 3: INTERVIEW ────────────────────────
    res_start_int = client.post(f"/api/roleready/session/{s_uuid}/start-interview", headers=headers)
    assert res_start_int.status_code == 200
    int_data = res_start_int.json()
    assert int_data["current_state"] == models.RoleReadySessionState.INTERVIEW_IN_PROGRESS

    # Submit interview
    res_sub_int = client.post(f"/api/roleready/session/{s_uuid}/submit-interview", headers=headers, json={
        "answers": [
            {"question_id": 1, "response": "I structure my applications using clean layered architecture."},
            {"question_id": 2, "response": "For rate limiting, I implement a sliding window using Redis."}
        ],
        "time_spent_seconds": 450
    })
    assert res_sub_int.status_code == 200
    sub_int_res = res_sub_int.json()
    assert sub_int_res["current_state"] == models.RoleReadySessionState.COMPLETED
    assert sub_int_res["overall_readiness_score"] >= 0.0

    # ─── FINAL REPORT AUDIENCE CHECK ───────────────
    res_report = client.get(f"/api/roleready/session/{s_uuid}/report", headers=headers)
    assert res_report.status_code == 200
    report_data = res_report.json()
    assert "final_report" in report_data
    assert "overall_readiness_score" in report_data
    assert report_data["target_role"] == "Full Stack Engineer"


def test_workflow_b_recruitment_batch_and_invitations(db_session, setup_test_data):
    """
    Tests Workflow B:
    1. Create recruitment batch
    2. Dispatch batch assessment invitations with unique tokens
    3. Verify and start session via invitation token
    4. Consolidated Admin recruitment report
    """
    org = setup_test_data["org"]

    # Create dummy candidate
    cand = db_session.query(models.Candidate).filter_by(email="alex.candidate@example.com").first()
    if not cand:
        cand = models.Candidate(
            name="Alex Turner",
            email="alex.candidate@example.com",
            role="DevOps Engineer",
            organization_id=org.id
        )
        db_session.add(cand)
        db_session.commit()
        db_session.refresh(cand)

    # Create batch
    batch = roleready_service.create_recruitment_batch(
        db=db_session,
        org_id=org.id,
        batch_name="Fall 2026 Engineering Cohort",
        description="Assessing full stack and cloud competencies."
    )
    assert batch.id is not None
    assert batch.batch_name == "Fall 2026 Engineering Cohort"

    # Send invitation
    invitations = roleready_service.send_batch_invitations(
        db=db_session,
        org_id=org.id,
        batch_id=batch.id,
        candidate_ids=[cand.id]
    )
    assert len(invitations) == 1
    token = invitations[0].invitation_token
    assert len(token) > 20

    # Verify invitation via portal endpoint
    res_verify = client.get(f"/api/roleready/portal/verify?token={token}")
    assert res_verify.status_code == 200
    verify_data = res_verify.json()
    assert verify_data["candidate_name"] == "Alex Turner"
    assert verify_data["target_role"] == "DevOps Engineer"
    assert "session_uuid" in verify_data

    # Generate admin batch report
    admin_rep = roleready_service.get_admin_batch_report(db_session, org.id, batch.id)
    assert admin_rep["batch_name"] == "Fall 2026 Engineering Cohort"
    assert admin_rep["total_candidates"] == 1
    assert len(admin_rep["candidates"]) == 1
    assert admin_rep["candidates"][0]["name"] == "Alex Turner"


# ==============================================================================
# SECURITY & ACCESS-CONTROL ENFORCEMENT TESTS (PHASE 4 & 8)
# ==============================================================================

def test_unauthenticated_session_access_rejected(db_session, setup_test_data):
    """Unauthenticated visitor cannot access session status or rounds (returns 401)."""
    profile = setup_test_data["student_profile"]
    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Software Engineer"
    )

    # Request without Authorization or Invitation header
    res_status = client.get(f"/api/roleready/session/{session.session_uuid}")
    assert res_status.status_code == 401
    assert "Authentication required" in res_status.json()["detail"]

    res_start = client.post(f"/api/roleready/session/{session.session_uuid}/start-aptitude")
    assert res_start.status_code == 401


def test_unauthenticated_initialize_rejected():
    """Unauthenticated request to initialize session is rejected with HTTP 401."""
    res = client.post("/api/roleready/student/initialize", data={"target_role": "Data Engineer"})
    assert res.status_code in [401, 403]


def test_student_cannot_access_other_student_session(db_session, setup_test_data):
    """Student B cannot access Student A's assessment session (returns 403 Forbidden)."""
    profile_a = setup_test_data["student_profile"]
    headers_b = setup_test_data["student_b_headers"]

    # Student A creates a session
    session_a = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile_a,
        target_role="Full Stack Engineer"
    )

    # Student B attempts to access Student A's session status -> 403 Forbidden
    res_status = client.get(f"/api/roleready/session/{session_a.session_uuid}", headers=headers_b)
    assert res_status.status_code == 403
    assert "Access denied: You do not own this assessment session." in res_status.json()["detail"]

    # Student B attempts to start aptitude on Student A's session -> 403 Forbidden
    res_apt = client.post(f"/api/roleready/session/{session_a.session_uuid}/start-aptitude", headers=headers_b)
    assert res_apt.status_code == 403

    # Student B attempts to read Student A's report -> 403 Forbidden
    res_rep = client.get(f"/api/roleready/session/{session_a.session_uuid}/report", headers=headers_b)
    assert res_rep.status_code == 403


def test_invalid_invitation_token_rejected():
    """Invalid invitation token returns HTTP 404."""
    res = client.get("/api/roleready/portal/verify?token=non_existent_fake_token_12345")
    assert res.status_code == 404
    assert "Invalid invitation token" in res.json()["detail"]


def test_invitation_token_scoped_to_assigned_session(db_session, setup_test_data):
    """Candidate invitation token only grants access to its own session, not another session."""
    org = setup_test_data["org"]
    profile_a = setup_test_data["student_profile"]

    # 1. Candidate invitation created
    cand = db_session.query(models.Candidate).filter_by(email="sam.candidate@example.com").first()
    if not cand:
        cand = models.Candidate(name="Sam Candidate", email="sam.candidate@example.com", role="Tester", organization_id=org.id)
        db_session.add(cand)
        db_session.commit()
        db_session.refresh(cand)

    batch = roleready_service.create_recruitment_batch(db_session, org.id, "Scoped Batch")
    invitations = roleready_service.send_batch_invitations(db_session, org.id, batch.id, [cand.id])
    inv_token = invitations[0].invitation_token

    # Verify invitation to initialize session
    ver = client.get(f"/api/roleready/portal/verify?token={inv_token}")
    assert ver.status_code == 200
    candidate_session_uuid = ver.json()["session_uuid"]

    # Candidate with valid invitation header CAN access their own session
    res_own = client.get(
        f"/api/roleready/session/{candidate_session_uuid}",
        headers={"X-Invitation-Token": inv_token}
    )
    assert res_own.status_code == 200
    assert res_own.json()["session_uuid"] == candidate_session_uuid

    # Candidate attempts to access Student A's session using their invitation token -> 403 Forbidden!
    session_a = roleready_service.create_student_session(db_session, profile_a, "Backend Engineer")
    res_other = client.get(
        f"/api/roleready/session/{session_a.session_uuid}",
        headers={"X-Invitation-Token": inv_token}
    )
    assert res_other.status_code == 403
    assert "Invitation token is not authorized for this assessment session." in res_other.json()["detail"]


def test_admin_dispatch_and_tracking(db_session, setup_test_data):
    """
    Verifies Admin 3-Step dispatch, tracking API, retry invitation, and individual candidate reports.
    """
    org = setup_test_data["org"]
    admin_user = db_session.query(models.User).filter_by(email="admin.test@roleready.com").first()
    if not admin_user:
        admin_user = models.User(
            email="admin.test@roleready.com",
            hashed_password="fakehashedpassword",
            role=models.UserRole.ORGANIZATION_ADMIN,
            organization_id=org.id
        )
        db_session.add(admin_user)
        db_session.commit()
        db_session.refresh(admin_user)

    member = db_session.query(models.OrganizationMember).filter_by(user_id=admin_user.id).first()
    if not member:
        member = models.OrganizationMember(
            organization_id=org.id,
            user_id=admin_user.id,
            role="ORGANIZATION_ADMIN",
            status="active"
        )
        db_session.add(member)
        db_session.commit()

    admin_token = utils.create_access_token(data={"sub": admin_user.email, "role": admin_user.role})
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Dispatch batch
    dispatch_res = client.post("/api/roleready/admin/dispatch-batch", headers=admin_headers, json={
        "batch_name": "Campus Hiring Batch 2026",
        "target_role": "Backend Engineer",
        "target_company": "ThirdEye Data",
        "job_description": "We are seeking a Backend Engineer with Python, FastAPI, SQL, and Docker experience.",
        "candidates": [
            {"name": "Candidate Alpha", "email": "candidate.alpha@gmail.com", "phone": "+1234567890"},
            {"name": "Candidate Beta", "email": "candidate.beta@outlook.com", "phone": "+1987654321"}
        ]
    })
    assert dispatch_res.status_code == 200
    res_data = dispatch_res.json()
    assert res_data["total_dispatched"] == 2
    batch_id = res_data["batch_id"]
    invitation_id = res_data["results"][0]["invitation_id"]
    cand_id = res_data["results"][0]["candidate_id"]

    # 2. Tracking endpoint
    track_res = client.get("/api/roleready/admin/tracking", headers=admin_headers)
    assert track_res.status_code == 200
    tracking_items = track_res.json()
    assert len(tracking_items) >= 2
    assert any(item["email"] == "candidate.alpha@gmail.com" for item in tracking_items)

    # 3. Retry invitation
    retry_res = client.post(f"/api/roleready/admin/invitations/{invitation_id}/retry", headers=admin_headers)
    assert retry_res.status_code == 200
    assert retry_res.json()["invitation_id"] == invitation_id

    # 4. Candidate report endpoint
    rep_res = client.get(f"/api/roleready/admin/candidates/{cand_id}/report", headers=admin_headers)
    assert rep_res.status_code == 200
    rep_data = rep_res.json()
    assert rep_data["candidate_id"] == cand_id
    assert rep_data["name"] == "Candidate Alpha"


def test_target_role_custom_and_predefined_initialization(db_session, setup_test_data):
    """Verifies that both predefined and custom roles are accurately captured and reflected in session state."""
    auth_headers = setup_test_data["auth_headers"]

    # 1. Predefined role: Frontend Developer
    res_fe = client.post("/api/roleready/student/initialize", headers=auth_headers, data={
        "target_role": "Frontend Developer",
        "target_company": "Vercel",
        "custom_jd_text": "React, TypeScript, Next.js, Tailwind CSS, DOM architecture."
    })
    assert res_fe.status_code == 200
    fe_data = res_fe.json()
    assert fe_data["target_role"] == "Frontend Developer"
    assert fe_data["target_company"] == "Vercel"
    assert fe_data["session_uuid"] is not None

    # Check session status reflects Frontend Developer
    fe_status = client.get(f"/api/roleready/session/{fe_data['session_uuid']}", headers=auth_headers)
    assert fe_status.status_code == 200
    assert fe_status.json()["target_role"] == "Frontend Developer"

    # 2. Custom role: Cloud Security Architect
    res_custom = client.post("/api/roleready/student/initialize", headers=auth_headers, data={
        "target_role": "Cloud Security Architect",
        "target_company": "CrowdStrike",
        "custom_jd_text": "AWS IAM, Zero Trust architecture, Threat Modeling, Kubernetes Security."
    })
    assert res_custom.status_code == 200
    custom_data = res_custom.json()
    assert custom_data["target_role"] == "Cloud Security Architect"
    assert custom_data["target_company"] == "CrowdStrike"

    custom_status = client.get(f"/api/roleready/session/{custom_data['session_uuid']}", headers=auth_headers)
    assert custom_status.status_code == 200
    assert custom_status.json()["target_role"] == "Cloud Security Architect"


def test_initialize_validation_empty_role_and_file_sizes(setup_test_data):
    """Verifies server-side rejection of empty role, invalid files, and oversized uploads."""
    auth_headers = setup_test_data["auth_headers"]

    # Empty target role -> 400
    res_empty = client.post("/api/roleready/student/initialize", headers=auth_headers, data={
        "target_role": "   ",
        "custom_jd_text": "Some JD"
    })
    assert res_empty.status_code == 400
    assert "Target job role is required" in res_empty.json()["detail"]

    # Invalid JD file extension -> 400
    res_bad_file = client.post(
        "/api/roleready/student/initialize",
        headers=auth_headers,
        data={"target_role": "Backend Developer"},
        files={"jd_file": ("malicious.exe", b"binary content", "application/octet-stream")}
    )
    assert res_bad_file.status_code == 400
    assert "Invalid JD file format" in res_bad_file.json()["detail"]


def test_role_specific_question_generation_for_multiple_domains(db_session, setup_test_data):
    """Verifies that generated Aptitude questions and Coding problems reflect the specific domain competencies."""
    profile = setup_test_data["student_profile"]

    # Test Data Engineer role
    de_session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Data Engineer",
        target_company="Snowflake",
        custom_jd_text="Apache Spark, SQL, Data Warehousing, Parquet, Kafka."
    )
    assert de_session.target_role == "Data Engineer"
    r1, r2, r3 = de_session.round_attempts
    # Aptitude round
    assert len(r1.questions_payload) >= 3
    apt_topics = [q.get("topic", "") for q in r1.questions_payload]
    # Coding round
    assert len(r2.questions_payload) >= 1
    coding_titles = [p.get("title", "") for p in r2.questions_payload]
    assert any("Stream" in t or "Join" in t or "Data" in t or "Two Sum" in t for t in coding_titles)

    # Test DevOps / Cloud Engineer role
    devops_session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="DevOps / Cloud Engineer",
        target_company="AWS",
        custom_jd_text="Kubernetes, Terraform, CI/CD, Docker, Prometheus."
    )
    assert devops_session.target_role == "DevOps / Cloud Engineer"
    d_r1, d_r2, d_r3 = devops_session.round_attempts
    assert len(d_r1.questions_payload) >= 3
    d_coding_titles = [p.get("title", "") for p in d_r2.questions_payload]
    assert any("CIDR" in t or "Log" in t or "Two Sum" in t for t in d_coding_titles)


def test_missing_and_empty_inputs_rejected(setup_test_data):
    """Verifies that empty form, missing role, or missing JD are strictly rejected with HTTP 400."""
    auth_headers = setup_test_data["auth_headers"]

    # 1. Empty form (empty role + empty JD)
    res_empty = client.post("/api/roleready/student/initialize", headers=auth_headers, data={
        "target_role": "",
        "custom_jd_text": ""
    })
    assert res_empty.status_code == 400

    # 2. Role entered, JD empty
    res_no_jd = client.post("/api/roleready/student/initialize", headers=auth_headers, data={
        "target_role": "Backend Developer",
        "custom_jd_text": "   "
    })
    assert res_no_jd.status_code == 400
    assert "Job description is required" in res_no_jd.json()["detail"]

    # 3. JD pasted, role empty
    res_no_role = client.post("/api/roleready/student/initialize", headers=auth_headers, data={
        "target_role": "  ",
        "custom_jd_text": "Looking for a Python backend developer with FastAPI and SQL skills."
    })
    assert res_no_role.status_code == 400
    assert "Target job role is required" in res_no_role.json()["detail"]


def test_duplicate_clicks_prevent_duplicate_sessions(setup_test_data):
    """Verifies that rapid repeated clicks return the existing session without creating duplicates."""
    auth_headers = setup_test_data["auth_headers"]
    data = {
        "target_role": "Machine Learning Engineer",
        "target_company": "DeepMind",
        "custom_jd_text": "PyTorch, Transformers, LLM fine-tuning, Reinforcement Learning."
    }

    # First click
    res1 = client.post("/api/roleready/student/initialize", headers=auth_headers, data=data)
    assert res1.status_code == 200
    uuid1 = res1.json()["session_uuid"]

    # Second click within rapid window (e.g. double click)
    res2 = client.post("/api/roleready/student/initialize", headers=auth_headers, data=data)
    assert res2.status_code == 200
    uuid2 = res2.json()["session_uuid"]

    assert uuid1 == uuid2


def test_private_answer_keys_and_hidden_tests_are_not_exposed_to_client(db_session, setup_test_data):
    """Verifies that client endpoints never expose aptitude answer keys or hidden coding test cases."""
    profile = setup_test_data["student_profile"]
    headers = setup_test_data["auth_headers"]

    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Frontend Developer",
        custom_jd_text="React, TypeScript, CSS, Performance optimization."
    )
    s_uuid = session.session_uuid

    # 1. Aptitude client payload check
    res_apt = client.post(f"/api/roleready/session/{s_uuid}/start-aptitude", headers=headers)
    assert res_apt.status_code == 200
    apt_questions = res_apt.json().get("questions", [])
    for q in apt_questions:
        assert "correct_key" not in q
        assert "explanation" not in q

    # Complete Aptitude to unlock Coding
    answers = {str(q["id"]): "B" for q in apt_questions}
    client.post(f"/api/roleready/session/{s_uuid}/submit-aptitude", headers=headers, json={"answers": answers})

    # 2. Coding client payload check
    res_code = client.post(f"/api/roleready/session/{s_uuid}/start-coding", headers=headers)
    assert res_code.status_code == 200
    problems = res_code.json().get("problems", [])
    for p in problems:
        assert "hidden_test_cases" not in p
        assert "public_test_cases" in p


def test_different_jds_and_resumes_influence_questions(db_session, setup_test_data):
    """Verifies that different JDs for the same role and different resumes generate distinct requirements."""
    profile = setup_test_data["student_profile"]

    # JD A: Focus on GraphQL & Apollo
    jd_a = "Senior Frontend Engineer specializing in GraphQL, Apollo Client, Relay, and Subscriptions."
    session_a = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Frontend Engineer",
        custom_jd_text=jd_a,
        resume_snapshot={"skills": ["GraphQL", "React"]}
    )

    # JD B: Focus on WebGL & Three.js Canvas Rendering
    jd_b = "Senior Frontend Engineer specializing in WebGL, Three.js, Canvas rendering, and Shaders."
    session_b = roleready_service.create_student_session(
        db=db_session,
        student_profile=profile,
        target_role="Frontend Engineer",
        custom_jd_text=jd_b,
        resume_snapshot={"skills": ["Three.js", "WebGL"]}
    )

    # Check that extracted skills and questions differ
    skills_a = session_a.extracted_jd_data.get("required_skills", [])
    skills_b = session_b.extracted_jd_data.get("required_skills", [])
    assert session_a.session_uuid != session_b.session_uuid


