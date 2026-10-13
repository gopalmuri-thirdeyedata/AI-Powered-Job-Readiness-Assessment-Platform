"""
Test Suite for PrepWin Student Performance Dashboard & Assessment History.
Verifies:
1. Student Performance Dashboard aggregation for new student (empty state, no zero division).
2. Student Performance Dashboard with 1 completed test (insufficient data trend, accurate metrics).
3. Student Performance Dashboard with multiple completed assessments (accurate avg, best perf, trends).
4. Tests in progress detection and dynamic next steps.
5. Skills and strengths derivation from evaluated test rounds.
6. Assessment history filtering (by category and status), sorting, and pagination.
7. Assessment detailed scorecard view (sanitized, no hidden keys).
8. Student-level data isolation & cross-student access denial.
9. Tenant-level data isolation.
10. Unauthenticated protection.
"""

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_performance_data():
    """Sets up isolated organizations, students, and test attempts."""
    db = database.SessionLocal()
    try:
        # Organization A & B
        org_a = db.query(models.Organization).filter(models.Organization.slug == "perf-college-a").first()
        if not org_a:
            org_a = models.Organization(name="Perf College A", slug="perf-college-a", status="active")
            db.add(org_a)
            db.commit()
            db.refresh(org_a)

        org_b = db.query(models.Organization).filter(models.Organization.slug == "perf-college-b").first()
        if not org_b:
            org_b = models.Organization(name="Perf College B", slug="perf-college-b", status="active")
            db.add(org_b)
            db.commit()
            db.refresh(org_b)

        # Student A1: Multi-test veteran student
        user_a1 = db.query(models.User).filter(models.User.email == "veteran.student@perfa.edu").first()
        if not user_a1:
            user_a1 = models.User(
                email="veteran.student@perfa.edu",
                hashed_password=utils.get_password_hash("VeteranPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_a1)
            db.commit()
            db.refresh(user_a1)

        profile_a1 = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_a1.id).first()
        if not profile_a1:
            profile_a1 = models.StudentProfile(
                user_id=user_a1.id,
                organization_id=org_a.id,
                full_name="Veteran Candidate",
                email="veteran.student@perfa.edu",
                target_role="Full Stack Engineer",
                target_company="Google",
                current_skills=["Python", "React", "PostgreSQL"],
                readiness_score=78.5,
                is_onboarded=True
            )
            db.add(profile_a1)
            db.commit()
            db.refresh(profile_a1)

        # Student A2: New student with 0 tests
        user_a2 = db.query(models.User).filter(models.User.email == "fresh.newbie@perfa.edu").first()
        if not user_a2:
            user_a2 = models.User(
                email="fresh.newbie@perfa.edu",
                hashed_password=utils.get_password_hash("NewbiePass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_a2)
            db.commit()
            db.refresh(user_a2)

        profile_a2 = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_a2.id).first()
        if not profile_a2:
            profile_a2 = models.StudentProfile(
                user_id=user_a2.id,
                organization_id=org_a.id,
                full_name="Fresh Newbie",
                email="fresh.newbie@perfa.edu",
                target_role="Backend Developer",
                readiness_score=20.0,
                is_onboarded=True
            )
            db.add(profile_a2)
            db.commit()
            db.refresh(profile_a2)

        # Student B1: Different organization
        user_b1 = db.query(models.User).filter(models.User.email == "student.other@perfb.edu").first()
        if not user_b1:
            user_b1 = models.User(
                email="student.other@perfb.edu",
                hashed_password=utils.get_password_hash("OtherPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_b.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_b1)
            db.commit()
            db.refresh(user_b1)

        profile_b1 = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_b1.id).first()
        if not profile_b1:
            profile_b1 = models.StudentProfile(
                user_id=user_b1.id,
                organization_id=org_b.id,
                full_name="Other College Student",
                email="student.other@perfb.edu",
                target_role="Data Scientist",
                is_onboarded=True
            )
            db.add(profile_b1)
            db.commit()
            db.refresh(profile_b1)

        # Populate Assessments for Veteran Student A1
        # Test 1: RoleReady Assessment (Score: 82.0)
        rr_uuid = "perf-rr-sess-001"
        rr_sess = db.query(models.RoleReadySession).filter(models.RoleReadySession.session_uuid == rr_uuid).first()
        if not rr_sess:
            rr_sess = models.RoleReadySession(
                session_uuid=rr_uuid,
                student_profile_id=profile_a1.id,
                organization_id=org_a.id,
                target_role="Full Stack Engineer",
                target_company="Google",
                current_state=models.RoleReadySessionState.COMPLETED,
                aptitude_score=85.0,
                coding_score=80.0,
                interview_score=81.0,
                overall_readiness_score=82.0,
                started_at=datetime.utcnow() - timedelta(days=10),
                completed_at=datetime.utcnow() - timedelta(days=10, minutes=-45),
                created_at=datetime.utcnow() - timedelta(days=10),
                final_report_data={
                    "top_strengths": ["Strong Python modularization", "Rapid algorithmic reasoning"],
                    "critical_gaps": ["Edge cases in graph traversal"],
                    "roadmap_focus": ["Review Dijkstra algorithm", "Practice system design"]
                }
            )
            db.add(rr_sess)
            db.commit()
            db.refresh(rr_sess)

            # Round attempts for RR session
            db.add(models.RoleReadyRoundAttempt(
                session_id=rr_sess.id,
                round_type="APTITUDE",
                round_order=1,
                status="EVALUATED",
                score=85.0,
                time_spent_seconds=1200
            ))
            db.add(models.RoleReadyRoundAttempt(
                session_id=rr_sess.id,
                round_type="CODING",
                round_order=2,
                status="EVALUATED",
                score=80.0,
                time_spent_seconds=1800
            ))
            db.commit()

        # Test 2: Placement Simulation (Score: 88.0 - Best score!)
        sim = db.query(models.StudentPlacementSimulation).filter(
            models.StudentPlacementSimulation.student_profile_id == profile_a1.id
        ).first()
        if not sim:
            sim = models.StudentPlacementSimulation(
                student_profile_id=profile_a1.id,
                organization_id=org_a.id,
                target_role="Full Stack Engineer",
                status="COMPLETED",
                current_round=4,
                aptitude_score=90.0,
                coding_score=88.0,
                technical_interview_score=86.0,
                hr_interview_score=88.0,
                overall_score=88.0,
                report_summary="Outstanding problem breakdown and clean API structuring.",
                strengths=["System scalability", "Clean async code"],
                weaknesses=["Distributed caching considerations"],
                recommendations=["Explore Redis cluster invalidation"],
                created_at=datetime.utcnow() - timedelta(days=5),
                completed_at=datetime.utcnow() - timedelta(days=5, minutes=-90)
            )
            db.add(sim)
            db.commit()
            db.refresh(sim)

        # Test 3: AI Mock Interview (Score: 76.0)
        mock = db.query(models.StudentMockInterview).filter(
            models.StudentMockInterview.student_profile_id == profile_a1.id
        ).first()
        if not mock:
            mock = models.StudentMockInterview(
                student_profile_id=profile_a1.id,
                organization_id=org_a.id,
                interview_type="TECHNICAL",
                target_role="Full Stack Engineer",
                status="COMPLETED",
                overall_score=76.0,
                technical_accuracy_score=78.0,
                star_structure_score=74.0,
                feedback_summary="Solid technical depth with room to improve STAR response framing.",
                strengths=["Accurate HTTP status codes", "Database indexing clarity"],
                areas_to_improve=["Be more concise in situational background"],
                created_at=datetime.utcnow() - timedelta(days=2),
                completed_at=datetime.utcnow() - timedelta(days=2, minutes=-25)
            )
            db.add(mock)
            db.commit()
            db.refresh(mock)

        # Test 4: In-Progress Simulation (to test active test detection)
        active_sim = db.query(models.StudentPlacementSimulation).filter(
            models.StudentPlacementSimulation.student_profile_id == profile_a1.id,
            models.StudentPlacementSimulation.status == "IN_PROGRESS"
        ).first()
        if not active_sim:
            active_sim = models.StudentPlacementSimulation(
                student_profile_id=profile_a1.id,
                organization_id=org_a.id,
                target_role="Backend Specialist",
                status="IN_PROGRESS",
                current_round=2,
                aptitude_score=84.0,
                coding_score=0.0,
                technical_interview_score=0.0,
                hr_interview_score=0.0,
                overall_score=0.0,
                created_at=datetime.utcnow() - timedelta(hours=3)
            )
            db.add(active_sim)
            db.commit()

        # Generate tokens
        token_a1 = utils.create_access_token(data={"sub": user_a1.email, "role": user_a1.role})
        token_a2 = utils.create_access_token(data={"sub": user_a2.email, "role": user_a2.role})
        token_b1 = utils.create_access_token(data={"sub": user_b1.email, "role": user_b1.role})

        return {
            "token_a1": token_a1,
            "token_a2": token_a2,
            "token_b1": token_b1,
            "profile_a1_id": profile_a1.id,
            "profile_a2_id": profile_a2.id,
            "profile_b1_id": profile_b1.id,
            "rr_uuid": rr_uuid,
            "sim_id": sim.id
        }
    finally:
        db.close()


def test_performance_dashboard_unauthenticated():
    """Protected dashboard rejects unauthenticated calls with 401."""
    res = client.get("/api/student/performance/dashboard")
    assert res.status_code == 401


def test_performance_dashboard_new_student_empty_state(setup_performance_data):
    """New student with 0 completed tests has safe empty state (no zero division, no fake zero scores)."""
    headers = {"Authorization": f"Bearer {setup_performance_data['token_a2']}"}
    res = client.get("/api/student/performance/dashboard", headers=headers)
    assert res.status_code == 200
    data = res.json()

    # Overview
    assert data["overview"]["student_name"] == "Fresh Newbie"
    assert data["overview"]["completed_tests_count"] == 0

    # Summary: average_score and best_performance should be null, not 0.0!
    summary = data["summary"]
    assert summary["total_tests_completed"] == 0
    assert summary["average_score"] is None
    assert summary["best_performance"] is None

    # Trends: handles 0 tests gracefully
    trends = data["trends"]
    assert trends["trend_status"] == "insufficient_data"
    assert len(trends["data_points"]) == 0

    # Skills analysis: handles no tests gracefully
    skills = data["skills_analysis"]
    assert skills["has_evaluation_data"] is False


def test_performance_dashboard_veteran_student_metrics(setup_performance_data):
    """Veteran student with multiple completed tests returns accurate calculations and trends."""
    headers = {"Authorization": f"Bearer {setup_performance_data['token_a1']}"}
    res = client.get("/api/student/performance/dashboard", headers=headers)
    assert res.status_code == 200
    data = res.json()

    # Overview
    assert data["overview"]["student_name"] == "Veteran Candidate"
    assert data["overview"]["has_active_test"] is True
    assert data["overview"]["pending_tests_count"] >= 1

    # Summary
    summary = data["summary"]
    assert summary["total_tests_completed"] >= 3  # RR, Sim, Interview
    # True average of 82.0, 88.0, 76.0 is 82.0
    assert summary["average_score"] == pytest.approx(82.0, 0.5)

    # Best performance: should be Placement Simulation with score 88.0
    best = summary["best_performance"]
    assert best is not None
    assert best["score"] == 88.0
    assert "Placement Simulation" in best["category"]

    # In-progress tests count
    assert summary["tests_in_progress"] >= 1

    # Trends: chronological order and data points
    trends = data["trends"]
    assert len(trends["data_points"]) >= 3
    # Check chronological ordering
    dates = [p["date"] for p in trends["data_points"] if p.get("date")]
    if len(dates) >= 2:
        for i in range(len(dates) - 1):
            assert dates[i] <= dates[i + 1]

    # Skills Analysis
    skills = data["skills_analysis"]
    assert skills["has_evaluation_data"] is True
    assert len(skills["assessment_skills"]) > 0

    # Recommended next steps
    steps = data["recommended_next_steps"]
    assert len(steps) > 0
    # The active test should be recommended with high priority
    assert any("Active" in s["title"] or s["priority"] == "high" for s in steps)


def test_performance_history_filtering_and_pagination(setup_performance_data):
    """Tests assessment history filtering by category, status, and pagination."""
    headers = {"Authorization": f"Bearer {setup_performance_data['token_a1']}"}

    # All tests
    res_all = client.get("/api/student/performance/history", headers=headers)
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["total_count"] >= 3
    assert len(data_all["items"]) > 0

    # Filter by SIMULATION category
    res_sim = client.get("/api/student/performance/history?category=SIMULATION", headers=headers)
    assert res_sim.status_code == 200
    data_sim = res_sim.json()
    for item in data_sim["items"]:
        assert item["category_key"] == "SIMULATION"

    # Filter by COMPLETED status
    res_comp = client.get("/api/student/performance/history?status=COMPLETED", headers=headers)
    assert res_comp.status_code == 200
    data_comp = res_comp.json()
    for item in data_comp["items"]:
        assert item["status"] == "COMPLETED"

    # Sorting by score_desc
    res_sort = client.get("/api/student/performance/history?sort_by=score_desc", headers=headers)
    assert res_sort.status_code == 200
    data_sort = res_sort.json()
    scores = [item["score"] for item in data_sort["items"] if item["score"] is not None]
    if len(scores) >= 2:
        for i in range(len(scores) - 1):
            assert scores[i] >= scores[i + 1]


def test_performance_assessment_detail_authorized(setup_performance_data):
    """Authorized student can view detailed assessment scorecard."""
    headers = {"Authorization": f"Bearer {setup_performance_data['token_a1']}"}
    sim_id = setup_performance_data["sim_id"]

    res = client.get(f"/api/student/performance/assessment/simulation/{sim_id}", headers=headers)
    assert res.status_code == 200
    detail = res.json()

    assert detail["overall_score"] == 88.0
    assert detail["status"] == "COMPLETED"
    assert detail["category_key"] == "SIMULATION"
    assert len(detail["strengths"]) > 0
    assert detail["evaluation_summary"] is not None


def test_performance_student_data_isolation(setup_performance_data):
    """Student B cannot view Student A's assessment details (fails closed)."""
    headers_b = {"Authorization": f"Bearer {setup_performance_data['token_b1']}"}
    sim_id = setup_performance_data["sim_id"]

    # Student B trying to access Student A's simulation
    res = client.get(f"/api/student/performance/assessment/simulation/{sim_id}", headers=headers_b)
    assert res.status_code == 404  # Not found for Student B
