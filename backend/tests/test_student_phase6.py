"""
Test Suite for Student Career Platform — Phase 6:
Resume Improvement & Technical Project Analyzer
"""

import pytest
from fastapi.testclient import TestClient

from main import app
import models
import database
import utils
from services import github_repo_service

client = TestClient(app)

VALID_DESCRIPTION = (
    "An asynchronous in-memory caching engine built with FastAPI and Redis. It implements LRU eviction, "
    "distributed locking through Redlock and exposes Prometheus metrics for high-throughput microservices."
)
FAKE_REPO = {
    "full_name": "alice/project", "url": "https://github.com/alice/project", "description": "Cache engine",
    "primary_language": "Python", "languages": {"Python": 92.0, "Dockerfile": 8.0}, "topics": ["cache"],
    "stars": 3, "forks": 1, "open_issues": 0, "default_branch": "main", "created_at": "2026-01-01T00:00:00Z",
    "pushed_at": "2026-10-01T00:00:00Z", "archived": False, "is_fork": False, "size_kb": 120,
    "has_readme": True, "readme_words": 220, "readme_excerpt": "A cache engine",
}


def project_payload(**overrides):
    """A project that satisfies every rule: real title, a proper description and a GitHub repository link."""
    payload = {
        "title": "CloudScale Distributed Cache",
        "description": VALID_DESCRIPTION,
        "tech_stack": ["Python", "FastAPI", "Redis"],
        "github_url": "https://github.com/alice/cloudscale-cache",
    }
    payload.update(overrides)
    return payload


@pytest.fixture(autouse=True)
def stub_github(monkeypatch):
    """These tests never call the real GitHub; every repository 'exists'."""
    monkeypatch.setattr(
        github_repo_service, "fetch_repo_summary",
        lambda owner, repo: {**FAKE_REPO, "full_name": f"{owner}/{repo}", "url": f"https://github.com/{owner}/{repo}"},
    )


@pytest.fixture(scope="module")
def setup_phase6_data():
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


def test_create_and_get_student_project(setup_phase6_data):
    """Verifies creating a project automatically computes architectural signals & retrieval works."""
    data = setup_phase6_data
    create_res = client.post(
        "/api/student/projects",
        json={
            "title": "CloudScale Distributed Cache",
            "description": "An asynchronous in-memory caching engine built with FastAPI and Redis. Implements LRU eviction, distributed locking via Redlock, and Prometheus telemetry metrics for high-throughput microservices.",
            "tech_stack": ["Python", "FastAPI", "Redis", "Docker", "Prometheus"],
            "github_url": "https://github.com/alice/cloudscale-cache",
            "live_url": "https://cloudscale-demo.app"
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert create_res.status_code == 201, create_res.text
    proj = create_res.json()
    assert proj["id"] is not None
    assert proj["title"] == "CloudScale Distributed Cache"
    assert proj["completeness_score"] >= 75.0
    assert len(proj["architecture_review"]) > 50
    assert len(proj["suggested_interview_questions"]) >= 3
    assert len(proj["recommendations"]) >= 1
    assert len(proj["bullet_point_improvements"]) >= 3

    # Fetch list
    list_res = client.get(
        "/api/student/projects",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert list_res.status_code == 200
    items = list_res.json()
    assert any(p["id"] == proj["id"] for p in items)

    # Fetch detail
    detail_res = client.get(
        f"/api/student/projects/{proj['id']}",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert detail_res.status_code == 200
    assert detail_res.json()["id"] == proj["id"]


def test_update_student_project(setup_phase6_data):
    """Verifies updating project attributes triggers re-evaluation."""
    data = setup_phase6_data
    # Create initial project
    create_res = client.post(
        "/api/student/projects",
        json=project_payload(
            title="Basic Note App",
            description="A simple notes application where a signed in user can create, edit and delete short text notes and see them in a list.",
            tech_stack=["React"],
        ),
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    proj_id = create_res.json()["id"]
    initial_score = create_res.json()["completeness_score"]

    # Update with deep details
    update_res = client.put(
        f"/api/student/projects/{proj_id}",
        json={
            "title": "Enterprise Collaboration & Notes Suite",
            "description": "Scalable full-stack collaborative real-time document editing platform using React, FastAPI, PostgreSQL and WebSockets with optimistic UI updates, presence indicators and version history.",
            "tech_stack": ["React", "FastAPI", "PostgreSQL", "WebSockets", "Docker"],
            "github_url": "https://github.com/alice/collab-notes",
            "live_url": "https://notes-collab.io"
        },
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert update_res.status_code == 200, update_res.text
    updated = update_res.json()
    assert updated["completeness_score"] > initial_score
    assert "PostgreSQL" in updated["architecture_review"] or "database" in updated["architecture_review"].lower()


def test_analyze_student_project_endpoint(setup_phase6_data):
    """Verifies explicit trigger of POST /api/student/projects/{id}/analyze."""
    data = setup_phase6_data
    create_res = client.post(
        "/api/student/projects",
        json=project_payload(
            title="FinTech Payment Gateway Simulator",
            description="Idempotent payment processing engine that simulates Stripe webhook retries, transaction reconciliation and double-entry ledger recording for a small online store, with a test suite.",
            tech_stack=["Node.js", "Express", "MySQL", "Redis"],
        ),
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    proj_id = create_res.json()["id"]

    analyze_res = client.post(
        f"/api/student/projects/{proj_id}/analyze",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert analyze_res.status_code == 200, analyze_res.text
    res_data = analyze_res.json()
    assert res_data["id"] == proj_id
    assert res_data["completeness_score"] > 0
    assert len(res_data["architecture_review"]) > 20
    assert len(res_data["suggested_interview_questions"]) > 0
    assert len(res_data["bullet_point_improvements"]) > 0


def test_delete_student_project(setup_phase6_data):
    """Verifies deletion of a student project."""
    data = setup_phase6_data
    create_res = client.post(
        "/api/student/projects",
        json=project_payload(title="Temporary Project"),
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    proj_id = create_res.json()["id"]

    del_res = client.delete(
        f"/api/student/projects/{proj_id}",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert del_res.status_code == 200

    # Ensure 404
    get_res = client.get(
        f"/api/student/projects/{proj_id}",
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    assert get_res.status_code == 404


def test_project_idor_and_tenant_isolation(setup_phase6_data):
    """Verifies student B cannot access or mutate student A's project."""
    data = setup_phase6_data
    create_res = client.post(
        "/api/student/projects",
        json=project_payload(title="Alice's Secret Project"),
        headers={"Authorization": f"Bearer {data['token_a']}"}
    )
    proj_id = create_res.json()["id"]

    # Student B attempts GET
    get_res = client.get(
        f"/api/student/projects/{proj_id}",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert get_res.status_code == 404

    # Student B attempts PUT
    put_res = client.put(
        f"/api/student/projects/{proj_id}",
        json={"title": "Hacked Title"},
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert put_res.status_code == 404

    # Student B attempts ANALYZE
    analyze_res = client.post(
        f"/api/student/projects/{proj_id}/analyze",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert analyze_res.status_code == 404

    # Student B attempts DELETE
    del_res = client.delete(
        f"/api/student/projects/{proj_id}",
        headers={"Authorization": f"Bearer {data['token_b']}"}
    )
    assert del_res.status_code == 404


def test_project_unauthenticated_guard():
    """Verifies unauthenticated access is rejected."""
    res = client.get("/api/student/projects")
    assert res.status_code == 401
    res2 = client.post("/api/student/projects", json={"title": "Test", "description": "Desc"})
    assert res2.status_code == 401
