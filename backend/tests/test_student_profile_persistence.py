"""Student profile: education saves, any field can be cleared, bad values are rejected, and the data is still
there after a fresh login."""
import pytest
from fastapi.testclient import TestClient

import models
import utils
from main import app
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401

client = TestClient(app)
EMAIL = "profile.persist@roleready.com"


@pytest.fixture
def student(db_session, setup_test_data):
    """A dedicated student with an empty profile, so these tests never disturb the shared fixtures."""
    org = setup_test_data["org"]
    user = db_session.query(models.User).filter_by(email=EMAIL).first()
    if not user:
        user = models.User(email=EMAIL, hashed_password="x", role=models.UserRole.STUDENT, organization_id=org.id)
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
    profile = db_session.query(models.StudentProfile).filter_by(user_id=user.id).first()
    if not profile:
        profile = models.StudentProfile(user_id=user.id, organization_id=org.id, full_name="Persist Tester", email=EMAIL,
                                        target_role="Software Engineer")
        db_session.add(profile)
        db_session.commit()
        db_session.refresh(profile)
    # start every test from a blank slate
    profile.college_name = profile.branch = profile.graduation_year = profile.cgpa = profile.target_company = profile.phone = None
    profile.current_skills = []
    profile.target_role = "Software Engineer"
    profile.full_name = "Persist Tester"
    db_session.commit()
    return user


def login(user):
    """A brand-new token, as a fresh sign-in would issue."""
    return {"Authorization": f"Bearer {utils.create_access_token(data={'sub': user.email, 'role': user.role})}"}


def put(user, **body):
    return client.put("/api/student/profile", headers=login(user), json=body)


def get(user):
    res = client.get("/api/student/profile", headers=login(user))
    assert res.status_code == 200, res.text
    return res.json()


def test_education_is_saved_returned_and_read_back(student, db_session):
    res = put(student, education="B.E. Computer Science and Engineering", college_name="KLS VDIT",
              graduation_year=2026, cgpa=8.2)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["education"] == "B.E. Computer Science and Engineering"
    assert body["college_name"] == "KLS VDIT" and body["graduation_year"] == 2026 and body["cgpa"] == 8.2

    again = get(student)
    assert again["education"] == "B.E. Computer Science and Engineering"
    assert again["college_name"] == "KLS VDIT" and again["graduation_year"] == 2026 and again["cgpa"] == 8.2

    db_session.expire_all()
    stored = db_session.query(models.StudentProfile).filter_by(user_id=student.id).first()
    assert stored.branch == "B.E. Computer Science and Engineering"  # degree text lives in the existing column


def test_data_is_still_there_after_logging_out_and_back_in(student):
    assert put(student, education="B.Tech IT", graduation_year=2027, cgpa=9.1, current_skills=["Python", "SQL"],
               target_company="Google", target_role="Backend Developer").status_code == 200
    # "logout": the old token is simply discarded; "login": a new token and a brand-new client
    fresh = TestClient(app).get("/api/student/profile", headers=login(student)).json()
    assert fresh["education"] == "B.Tech IT" and fresh["graduation_year"] == 2027 and fresh["cgpa"] == 9.1
    assert fresh["current_skills"] == ["Python", "SQL"]
    assert fresh["target_company"] == "Google" and fresh["target_role"] == "Backend Developer"


def test_only_the_fields_sent_change(student):
    put(student, education="B.Sc Physics", graduation_year=2025, cgpa=7.5, target_company="Acme")
    res = put(student, cgpa=8.0)
    body = res.json()
    assert body["cgpa"] == 8.0
    assert body["education"] == "B.Sc Physics" and body["graduation_year"] == 2025 and body["target_company"] == "Acme"


def test_a_field_can_be_cleared_by_sending_null_or_blank(student):
    put(student, education="B.Sc Physics", college_name="City College", graduation_year=2025, cgpa=7.5, target_company="Acme")
    body = put(student, education=None, college_name="   ", graduation_year=None, cgpa=None, target_company=None).json()
    assert body["education"] is None and body["college_name"] is None
    assert body["graduation_year"] is None and body["cgpa"] is None and body["target_company"] is None
    again = get(student)
    assert again["education"] is None and again["cgpa"] is None and again["target_company"] is None


def test_required_fields_are_never_wiped_by_a_blank(student):
    body = put(student, full_name="   ", target_role="").json()
    assert body["full_name"] == "Persist Tester" and body["target_role"] == "Software Engineer"
    body = put(student, full_name="  New Name  ").json()
    assert body["full_name"] == "New Name"


@pytest.mark.parametrize("payload", [
    {"graduation_year": 1800}, {"graduation_year": 2300}, {"cgpa": 150}, {"cgpa": -1},
    {"education": "x" * 101}, {"college_name": "x" * 201}, {"target_company": "x" * 101},
])
def test_invalid_values_are_rejected_and_nothing_is_saved(student, payload):
    put(student, education="Safe value", cgpa=8.0)
    res = put(student, **payload)
    assert res.status_code == 422
    after = get(student)
    assert after["education"] == "Safe value" and after["cgpa"] == 8.0


def test_legacy_branch_key_still_works_and_education_wins(student):
    assert put(student, branch="Mechanical").json()["education"] == "Mechanical"
    assert put(student, branch="Civil", education="Electronics").json()["education"] == "Electronics"


def test_skills_are_trimmed_deduplicated_and_kept_in_order(student):
    body = put(student, current_skills=["  Python ", "python", "React", "", "SQL", "react"]).json()
    assert body["current_skills"] == ["Python", "React", "SQL"]
    assert put(student, current_skills=[]).json()["current_skills"] == []


def test_students_cannot_see_or_change_each_others_profile(student, db_session, setup_test_data):
    put(student, education="Private degree")
    other = db_session.query(models.User).filter_by(email="student.test@roleready.com").first()
    other_view = get(other)
    assert other_view["education"] != "Private degree"
    assert other_view["email"] == "student.test@roleready.com"


def test_unauthenticated_requests_are_rejected():
    assert client.get("/api/student/profile").status_code in (401, 403)
    assert client.put("/api/student/profile", json={"education": "x"}).status_code in (401, 403)
