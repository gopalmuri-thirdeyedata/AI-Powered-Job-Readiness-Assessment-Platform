"""
Test Suite for Student Career Platform — Phase 7:
Campus Placement Drive Simulation & Multi-Factor Readiness Scoring
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase7_data():
    """Sets up student user and profile in the database."""
    db = database.SessionLocal()
    try:
        org_a = db.query(models.Organization).filter(models.Organization.slug == "college-alpha").first()
        if not org_a:
            org_a = models.Organization(name="College Alpha", slug="college-alpha", status="active")
            db.add(org_a)
            db.commit()
            db.refresh(org_a)

        org_b = db.query(models.Organization).filter(models.Organization.slug == "college-beta").first()
        if not org_b:
            org_b = models.Organization(name="College Beta", slug="college-beta", status="active")
            db.add(org_b)
            db.commit()
            db.refresh(org_b)

        # Student Alpha
        user_a = db.query(models.User).filter(models.User.email == "student.alpha@college.edu").first()
        if not user_a:
            user_a = models.User(
                email="student.alpha@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_a.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_a)
            db.commit()
            db.refresh(user_a)

        profile_a = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_a.id).first()
        if not profile_a:
            profile_a = models.StudentProfile(
                user_id=user_a.id,
                organization_id=org_a.id,
                full_name="Alice Alpha",
                email="student.alpha@college.edu",
                target_role="Full Stack Developer",
                current_skills=["React", "Python"]
            )
            db.add(profile_a)
            db.commit()
            db.refresh(profile_a)

        # Student Beta (Different org)
        user_b = db.query(models.User).filter(models.User.email == "student.beta@college.edu").first()
        if not user_b:
            user_b = models.User(
                email="student.beta@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org_b.id,
                is_active=True,
                password_changed=True
            )
            db.add(user_b)
            db.commit()
            db.refresh(user_b)

        profile_b = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user_b.id).first()
        if not profile_b:
            profile_b = models.StudentProfile(
                user_id=user_b.id,
                organization_id=org_b.id,
                full_name="Bob Beta",
                email="student.beta@college.edu",
                target_role="Backend Engineer",
                current_skills=["Python", "FastAPI"]
            )
            db.add(profile_b)
            db.commit()
            db.refresh(profile_b)

        token_a = utils.create_access_token({"sub": "student.alpha@college.edu", "role": "STUDENT"})
        token_b = utils.create_access_token({"sub": "student.beta@college.edu", "role": "STUDENT"})

        return {
            "token_a": token_a,
            "profile_a_id": profile_a.id,
            "org_a_id": org_a.id,
            "token_b": token_b,
            "profile_b_id": profile_b.id,
            "org_b_id": org_b.id
        }
    finally:
        db.close()


def test_start_placement_simulation(setup_phase7_data):
    """Verifies starting a simulation creates 4 rounds with proper statuses."""
    data = setup_phase7_data
    response = client.post(
        "/api/student/simulation/start",
        json={"target_role": "Full Stack Developer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert response.status_code == 200, response.text
    sim = response.json()
    assert sim["id"] is not None
    assert sim["status"] == "IN_PROGRESS"
    assert sim["current_round"] == 1
    assert len(sim["rounds"]) == 4

    # Round 1 should be IN_PROGRESS, others PENDING
    assert sim["rounds"][0]["status"] == "IN_PROGRESS"
    assert sim["rounds"][1]["status"] == "PENDING"
    assert sim["rounds"][2]["status"] == "PENDING"
    assert sim["rounds"][3]["status"] == "PENDING"


def test_simulation_data_confidentiality(setup_phase7_data):
    """Verifies correct answers and hidden test cases are stripped from GET output."""
    data = setup_phase7_data
    start_res = client.post(
        "/api/student/simulation/start",
        json={"target_role": "Full Stack Developer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    sim_id = start_res.json()["id"]

    detail_res = client.get(
        f"/api/student/simulation/{sim_id}",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert detail_res.status_code == 200
    sim_data = detail_res.json()
    rounds = sim_data["rounds"]

    # Round 1 Aptitude: correct_answer should NOT be present
    r1_data = rounds[0]["round_data"]
    for q in r1_data.get("questions", []):
        assert "correct_answer" not in q
        assert "explanation" not in q

    # Round 2 Coding: hidden_test_cases should NOT be present
    r2_data = rounds[1]["round_data"]
    assert "hidden_test_cases" not in r2_data


def test_submit_round1_aptitude(setup_phase7_data):
    """Verifies scoring of Round 1 Aptitude answers and transition to Round 2."""
    data = setup_phase7_data
    start_res = client.post(
        "/api/student/simulation/start",
        json={"target_role": "Full Stack Developer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    sim_id = start_res.json()["id"]

    # Submit correct answers for apt_1 (B) and apt_2 (A)
    sub_res = client.post(
        f"/api/student/simulation/{sim_id}/round/1/submit",
        json={"answers": {"apt_1": "B", "apt_2": "A", "apt_3": "A"}},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert sub_res.status_code == 200, sub_res.text
    res = sub_res.json()
    assert res["round_number"] == 1
    assert res["score"] == 100.0
    assert not res["is_simulation_finished"]
    assert res["next_round"] == 2


def test_submit_full_simulation_flow(setup_phase7_data):
    """Verifies full 4-round progression to COMPLETED and readiness score enhancement."""
    data = setup_phase7_data
    start_res = client.post(
        "/api/student/simulation/start",
        json={"target_role": "Backend Engineer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    sim_id = start_res.json()["id"]

    # Round 1: Aptitude
    client.post(
        f"/api/student/simulation/{sim_id}/round/1/submit",
        json={"answers": {"apt_1": "B", "apt_2": "A"}},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )

    # Round 2: Coding
    client.post(
        f"/api/student/simulation/{sim_id}/round/2/submit",
        json={"code": "def two_sum(nums, target):\n    lookup = {}\n    for i, n in enumerate(nums):\n        if target - n in lookup:\n            return [lookup[target-n], i]\n        lookup[n] = i\n"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )

    # Round 3: Technical Interview
    client.post(
        f"/api/student/simulation/{sim_id}/round/3/submit",
        json={"response": "I architected an asynchronous data processing pipeline using FastAPI, Redis caching, and PostgreSQL read-replicas. By implementing write-through cache patterns and database indexing, our average query latency dropped by 45% under 10k concurrent requests."},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )

    # Round 4: HR Interview
    fin_res = client.post(
        f"/api/student/simulation/{sim_id}/round/4/submit",
        json={"response": "During my capstone project, our team faced a severe conflict regarding database architecture under tight deadlines. I took the situation in hand, designed benchmark tests for both MongoDB and Postgres, and demonstrated the action steps clearly. As a result, our team aligned and delivered on time."},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert fin_res.status_code == 200, fin_res.text
    fin_data = fin_res.json()
    assert fin_data["is_simulation_finished"]
    assert fin_data["overall_score"] > 60.0

    # Verify simulation is marked COMPLETED
    detail_res = client.get(
        f"/api/student/simulation/{sim_id}",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["status"] == "COMPLETED"
    assert detail["aptitude_score"] > 0
    assert detail["coding_score"] > 0
    assert detail["technical_interview_score"] > 0
    assert detail["hr_interview_score"] > 0
    assert detail["completed_at"] is not None


def test_simulation_idor_and_isolation(setup_phase7_data):
    """Verifies student B cannot view or submit rounds for student A's simulation."""
    data = setup_phase7_data
    start_res = client.post(
        "/api/student/simulation/start",
        json={"target_role": "Full Stack Developer"},
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    sim_id = start_res.json()["id"]

    # Student B attempts GET
    get_res = client.get(
        f"/api/student/simulation/{sim_id}",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert get_res.status_code == 404

    # Student B attempts submit
    sub_res = client.post(
        f"/api/student/simulation/{sim_id}/round/1/submit",
        json={"answers": {"apt_1": "B"}},
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert sub_res.status_code == 404


def test_simulation_unauthenticated_guard():
    """Verifies that endpoints require authentication."""
    res1 = client.post("/api/student/simulation/start", json={})
    assert res1.status_code == 401

    res2 = client.get("/api/student/simulation/history")
    assert res2.status_code == 401
