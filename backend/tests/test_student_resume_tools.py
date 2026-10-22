import pytest
from fastapi.testclient import TestClient
from main import app
import models
from services import gemini_client
from services import student_resume_tools as tools
from tests.test_roleready_pipeline import db_session, setup_test_data

client = TestClient(app)

RESUME_TEXT = """Jane Doe
jane.doe@example.com | +91 98765 43210 | github.com/janedoe

Summary
Final-year student who enjoys building web applications.

Skills
Python, React, SQL, Docker, Git

Experience
Backend Intern
Acme Corp
Jun 2025 - Aug 2025
- Built REST APIs with FastAPI
- Wrote SQL queries for reporting

Projects
Portfolio Site
- Built with React and Tailwind

Education
B.Tech Computer Science
Sample University
2022 - 2026

Certifications
- AWS Cloud Practitioner
"""

JD_TEXT = (
    "We are hiring a backend engineer with strong Python, FastAPI, Docker, Kubernetes and PostgreSQL "
    "experience to build scalable services."
)


@pytest.fixture(autouse=True)
def no_ai(monkeypatch):
    monkeypatch.setattr(gemini_client, "is_ai_available", lambda: False)


def _upload(name="resume.txt", content=RESUME_TEXT.encode(), mime="text/plain"):
    return {"file": (name, content, mime)}


# ---- service-level ----------------------------------------------------------

def test_fallback_jd_match_lists_matched_and_missing_skills():
    res = tools.analyze_resume_against_jd(RESUME_TEXT, JD_TEXT)
    assert res["ai_generated"] is False
    assert "Python" in res["matched_skills"] and "Docker" in res["matched_skills"]
    assert "Kubernetes" in res["missing_skills"]
    assert 0 <= res["match_score"] <= 100
    assert res["fit_verdict"] in tools.FIT_VERDICTS


def test_ai_jd_match_is_validated_and_clamped(monkeypatch):
    monkeypatch.setattr(gemini_client, "is_ai_available", lambda: True)
    monkeypatch.setattr(gemini_client, "call_gemini", lambda **kw: {
        "match_score": 250, "fit_verdict": "Amazing", "matched_skills": ["Python", "Python", None],
        "missing_skills": "not-a-list", "strengths": ["a"], "weaknesses": ["b"], "recommendations": ["c"],
    })
    res = tools.analyze_resume_against_jd(RESUME_TEXT, JD_TEXT)
    assert res["ai_generated"] is True
    assert res["match_score"] == 100.0
    assert res["fit_verdict"] == "Strong"  # invalid verdict replaced from score
    assert res["matched_skills"] == ["Python"]
    assert res["missing_skills"] == []


def test_ai_failure_falls_back(monkeypatch):
    monkeypatch.setattr(gemini_client, "is_ai_available", lambda: True)

    def boom(**kw):
        raise gemini_client.GeminiUnavailableError("down")

    monkeypatch.setattr(gemini_client, "call_gemini", boom)
    assert tools.analyze_resume_against_jd(RESUME_TEXT, JD_TEXT)["ai_generated"] is False
    assert tools.extract_structured_resume(RESUME_TEXT)["ai_generated"] is False


def test_heuristic_structured_extraction():
    data = tools.extract_structured_resume(RESUME_TEXT)
    assert data["name"] == "Jane Doe"
    assert data["contact"]["email"] == "jane.doe@example.com"
    assert "Python" in data["skills"] and "Docker" in data["skills"]
    assert data["experience"][0]["title"] == "Backend Intern"
    assert data["experience"][0]["company"] == "Acme Corp"
    assert "Built REST APIs with FastAPI" in data["experience"][0]["bullets"]
    assert data["projects"][0]["name"] == "Portfolio Site"
    assert data["education"][0]["degree"] == "B.Tech Computer Science"
    assert data["certifications"] == ["AWS Cloud Practitioner"]


def test_structured_never_invents_missing_sections():
    data = tools.extract_structured_resume("John Smith\njohn@example.com\nSkills\nPython, Go\n" + "x " * 30)
    assert data["experience"] == [] and data["projects"] == [] and data["education"] == []


# ---- endpoints --------------------------------------------------------------

def test_analyze_jd_with_upload(db_session, setup_test_data):
    res = client.post(
        "/api/student/resume/analyze-jd",
        headers=setup_test_data["auth_headers"],
        data={"job_description": JD_TEXT},
        files=_upload(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "Kubernetes" in body["missing_skills"]
    assert body["fit_verdict"] in tools.FIT_VERDICTS


def test_analyze_jd_rejects_short_jd(db_session, setup_test_data):
    res = client.post(
        "/api/student/resume/analyze-jd",
        headers=setup_test_data["auth_headers"],
        data={"job_description": "too short"},
        files=_upload(),
    )
    assert res.status_code == 400


def test_requires_exactly_one_resume_source(db_session, setup_test_data):
    headers = setup_test_data["auth_headers"]
    neither = client.post("/api/student/resume/format", headers=headers)
    assert neither.status_code == 400
    both = client.post("/api/student/resume/format", headers=headers, data={"resume_id": "1"}, files=_upload())
    assert both.status_code == 400


@pytest.mark.parametrize("name,content,code", [
    ("resume.exe", b"MZ" + b"a" * 100, 400),
    ("resume.txt", b"", 400),
    ("resume.txt", b"tiny", 400),
])
def test_format_rejects_bad_files(db_session, setup_test_data, name, content, code):
    res = client.post(
        "/api/student/resume/format",
        headers=setup_test_data["auth_headers"],
        files=_upload(name, content),
    )
    assert res.status_code == code


def test_format_returns_structured_resume(db_session, setup_test_data):
    res = client.post("/api/student/resume/format", headers=setup_test_data["auth_headers"], files=_upload())
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "Jane Doe"


def test_saved_resume_source_and_ownership(db_session, setup_test_data):
    headers = setup_test_data["auth_headers"]
    profile = setup_test_data["student_profile"]
    mine = models.StudentResume(
        student_profile_id=profile.id, version=1, file_path="x", file_name="mine.txt", full_text=RESUME_TEXT
    )
    db_session.add(mine)
    db_session.commit()

    ok = client.post("/api/student/resume/format", headers=headers, data={"resume_id": str(mine.id)})
    assert ok.status_code == 200 and ok.json()["name"] == "Jane Doe"

    missing = client.post("/api/student/resume/format", headers=headers, data={"resume_id": "999999"})
    assert missing.status_code == 404


def test_endpoints_require_auth():
    assert client.post("/api/student/resume/format", files=_upload()).status_code in (401, 403)
    assert client.post(
        "/api/student/resume/analyze-jd", data={"job_description": JD_TEXT}, files=_upload()
    ).status_code in (401, 403)


# ---------------------------------------------------------------------------
# Real entries instead of placeholders, richer JD match, and round time limits
# ---------------------------------------------------------------------------

REALISTIC_JD = """Full Stack Developer - ThirdEye Data
Company: ThirdEye Data
Experience: 0-2 years
Responsibilities
- Develop and maintain REST APIs using Python and Django
- Build responsive user interfaces with React and JavaScript
- Work with SQL and NoSQL databases like MySQL and MongoDB
Qualification
- Bachelor's degree in Computer Science / Engineering or related field
- Strong problem-solving and communication skills
Role Type
- Full-Time / Internship (based on requirement)
"""


def test_fallback_analysis_returns_real_entries_not_placeholders():
    from services.student_resume_analyzer import _fallback_heuristic_analysis

    a = _fallback_heuristic_analysis(RESUME_TEXT)
    assert a["projects"][0]["title"] == "Portfolio Site"
    assert {"React", "Tailwind"} <= set(a["projects"][0]["technologies"])
    assert a["education"][0]["degree"] == "B.Tech Computer Science"
    assert a["education"][0]["institution"] == "Sample University"
    assert a["education"][0]["graduation_year"] == "2026"
    assert a["experience"][0]["role"] == "Backend Intern"
    assert a["experience"][0]["company"] == "Acme Corp"
    assert "2025" in a["experience"][0]["duration"]
    assert a["certifications"] == ["AWS Cloud Practitioner"]


def test_skill_names_use_proper_casing():
    from services.student_resume_analyzer import format_skill_name

    assert format_skill_name("node.js") == "Node.js"
    assert format_skill_name("aws") == "AWS"
    assert format_skill_name("sql") == "SQL"
    assert format_skill_name("mysql") == "MySQL"
    assert format_skill_name("spring boot") == "Spring Boot"


def test_refresh_placeholder_entries_repairs_old_saved_analysis():
    from services.student_resume_analyzer import refresh_placeholder_entries

    stale = {
        "projects": [{"title": "Projects Section", "description": "Hands-on projects detected in resume"}],
        "education": [{"degree": "Academic Degree", "status": "Detected"}],
        "experience": [{"role": "Internship / Experience", "status": "Detected"}],
        "certifications": ["Certifications present"],
        "technical_skills": ["Python"],
    }
    fixed = refresh_placeholder_entries(stale, RESUME_TEXT)
    assert fixed["projects"][0]["title"] == "Portfolio Site"
    assert fixed["certifications"] == ["AWS Cloud Practitioner"]
    assert fixed["technical_skills"] == ["Python"]  # untouched fields are preserved
    assert stale["certifications"] == ["Certifications present"]  # input is not mutated

    good = {"projects": [{"title": "Real"}], "education": [], "experience": [], "certifications": ["X"]}
    assert refresh_placeholder_entries(good, RESUME_TEXT) is good


def test_jd_fallback_extracts_role_company_experience_and_fit():
    from services.student_resume_tools import _fallback_jd_match

    r = _fallback_jd_match(RESUME_TEXT, REALISTIC_JD)
    assert r["job_title"] == "Full Stack Developer"
    assert r["company"] == "ThirdEye Data"
    assert r["required_experience"] == "0-2 years"
    assert "Python" in r["matched_skills"] and "React" in r["matched_skills"]
    assert "Django" in r["missing_skills"] and "NoSQL" in r["missing_skills"]
    assert "MySQL" in r["missing_skills"]
    assert r["experience_fit"] and r["qualification_fit"]
    assert 0 <= r["match_score"] <= 100
    assert r["fit_verdict"] in ("Strong", "Good", "Partial", "Weak")
    # employment-type bullets are not treated as job requirements
    assert not any("Full-Time" in w for w in r["weaknesses"])
    # no invented strengths: every matched skill really is in the resume
    assert all(s.lower() in RESUME_TEXT.lower() for s in r["matched_skills"])


def test_jd_fallback_handles_experienced_role_and_no_degree():
    from services.student_resume_tools import _fallback_jd_match

    jd = "Senior Backend Engineer\nWe need 5+ years of experience building Python and Django services on AWS."
    r = _fallback_jd_match(RESUME_TEXT, jd)
    assert r["required_experience"] == "5+ years"
    assert "below" in r["experience_fit"]
    assert any("below" in w for w in r["weaknesses"])
    assert "does not state a specific degree" in r["qualification_fit"]


def test_round_time_limits_are_single_source_of_truth():
    from services import roleready_service

    assert roleready_service.ROUND_TIME_LIMITS_MINUTES == {"APTITUDE": 15, "CODING": 30, "INTERVIEW": 15}


from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: E402,F401


def test_new_session_rounds_use_advertised_time_limits(db_session, setup_test_data):
    import models
    from services import roleready_service

    session = roleready_service.create_student_session(
        db=db_session,
        student_profile=setup_test_data["student_profile"],
        target_role="Full Stack Engineer",
        target_company="ThirdEye Data",
        custom_jd_text="Python and React developer with SQL experience.",
    )
    rounds = {
        r.round_type: r.time_limit_minutes
        for r in db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id).all()
    }
    assert rounds == {"APTITUDE": 15, "CODING": 30, "INTERVIEW": 15}
    assert session.target_company == "ThirdEye Data"
