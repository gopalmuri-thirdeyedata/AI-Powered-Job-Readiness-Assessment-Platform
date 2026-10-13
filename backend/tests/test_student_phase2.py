"""
Test Suite for Student Career Platform — Phase 2:
Student Career Profile & Skill Intelligence
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils
from services.skill_gap_service import (
    analyze_skill_gap,
    get_target_role_benchmark,
    TARGET_ROLES_CATALOG
)
from services.skill_suggestion import normalize_skill, deduplicate_and_normalize_skills

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_phase2_data():
    """Sets up student user and profile in the database."""
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "college-alpha").first()
        if not org:
            org = models.Organization(name="College Alpha", slug="college-alpha", status="active")
            db.add(org)
            db.commit()
            db.refresh(org)

        user = db.query(models.User).filter(models.User.email == "student.alpha@college.edu").first()
        if not user:
            user = models.User(
                email="student.alpha@college.edu",
                hashed_password=utils.get_password_hash("StudentPass123!"),
                role=models.UserRole.STUDENT,
                organization_id=org.id,
                is_active=True,
                password_changed=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
        if not profile:
            profile = models.StudentProfile(
                user_id=user.id,
                organization_id=org.id,
                full_name="Alice Alpha",
                email="student.alpha@college.edu",
                target_role="Full Stack Developer",
                target_company="Google",
                current_skills=["React", "JavaScript", "HTML5", "CSS3"]
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
        else:
            profile.target_role = "Full Stack Developer"
            profile.target_company = "Google"
            profile.current_skills = ["React", "JavaScript", "HTML5", "CSS3"]
            db.commit()

        token = utils.create_access_token({"sub": "student.alpha@college.edu", "role": "STUDENT"})

        return {
            "token": token,
            "profile_id": profile.id,
            "org_id": org.id
        }
    finally:
        db.close()


def test_skill_normalization_and_deduplication():
    """Validates that skill normalization cleans, canonicalizes, and deduplicates inputs."""
    raw_skills = ["react.js", "REACT", "python3", "Docker", "good attitude", "REST API", "sql"]
    cleaned = deduplicate_and_normalize_skills(raw_skills)
    
    assert "React" in cleaned
    assert "Python" in cleaned
    assert "SQL" in cleaned
    assert "Docker" in cleaned
    assert "REST APIs" in cleaned
    # "good attitude" must be rejected by disallowed patterns
    assert "Good attitude" not in cleaned
    # "REACT" and "react.js" should deduplicate to single "React"
    assert cleaned.count("React") == 1


def test_get_target_roles_catalog(setup_phase2_data):
    """Validates GET /api/student/target-roles returns all defined roles with skills."""
    headers = {"Authorization": f"Bearer {setup_phase2_data['token']}"}
    response = client.get("/api/student/target-roles", headers=headers)
    assert response.status_code == 200
    roles = response.json()
    assert len(roles) >= 6
    titles = [r["title"] for r in roles]
    assert "Full Stack Developer" in titles
    assert "Backend Engineer" in titles
    assert "Data Scientist / ML Engineer" in titles


def test_get_student_skill_gap(setup_phase2_data):
    """Validates GET /api/student/skill-gap returns structured gap analysis."""
    headers = {"Authorization": f"Bearer {setup_phase2_data['token']}"}
    response = client.get("/api/student/skill-gap", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert data["target_role"] == "Full Stack Developer"
    assert data["target_company"] == "Google"
    assert "match_percentage" in data
    assert isinstance(data["matched_skills"], list)
    assert isinstance(data["missing_required"], list)
    assert isinstance(data["missing_preferred"], list)
    assert "React" in data["matched_skills"]
    assert len(data["recommendations"]) > 0
    assert "career_path_advice" in data


def test_simulate_skill_gap_custom_role(setup_phase2_data):
    """Validates POST /api/student/skill-gap/analyze with hypothetical skills."""
    headers = {"Authorization": f"Bearer {setup_phase2_data['token']}"}
    payload = {
        "target_role": "Backend Engineer",
        "target_company": "Amazon",
        "additional_skills": ["Docker", "PostgreSQL"]
    }
    response = client.post("/api/student/skill-gap/analyze", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert data["target_role"] == "Backend Engineer"
    assert data["target_company"] == "Amazon"
    assert "Docker" in data["matched_skills"]
    assert "PostgreSQL" in data["matched_skills"]


def test_career_paths_ranking(setup_phase2_data):
    """Validates GET /api/student/career-paths ranks roles by fit percentage."""
    headers = {"Authorization": f"Bearer {setup_phase2_data['token']}"}
    response = client.get("/api/student/career-paths", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    assert "recommended_roles" in data
    assert len(data["recommended_roles"]) > 0
    # First recommendation should have higher or equal match percentage than second
    assert data["recommended_roles"][0]["match_percentage"] >= data["recommended_roles"][1]["match_percentage"]


def test_skill_gap_unauthenticated_fails():
    """Validates unauthenticated requests return 401 Unauthorized."""
    response = client.get("/api/student/skill-gap")
    assert response.status_code == 401
