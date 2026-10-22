"""The rule-based resume parser on text shaped like real PDF extraction: wrapped bullets, link arrows,
inline bullet lists, an ACHIEVEMENTS section and 'real -time' spacing."""
from services import student_resume_tools as tools

ARROW = "↗"
BULLET = "•"
EN_DASH = "–"

RESUME = f"""Gopal Muri
gopalmuri2004@gmail.com | 89042 68972
SUMMARY
Motivated and detail -oriented Computer Science Engineering student with a strong foundation in Java, Data
Structures, and Web Technologies. Passionate about building real -world software solutions.
SKILLS
Programming Skills : Java, Python, Object -oriented programming, Django, HTML 5, CSS 3 and Bootstrap,
Visual Studio Code, Git, GitHub, SQL (My SQL, Oracle ), Mongo DB (Mongo Shell, MongoDB Compass )
PROJECTS
A Real -Time System for Crowd Analytics [GitHub {ARROW}] {EN_DASH} Python | Flask | OpenCV | MobileNetSSD | Caffe DNN Jul 2025
{BULLET} Developed a real -time AI -powered crowd monitoring system using OpenCV and MobileNetSSD for person detection,
tracking, crowd density estimation, and gender classification from live video feeds .
{BULLET} Integrated a Flask -based dashboard for real -time visualization with gender -targeted advertising, alerts, and analytics,
enabling automated public safety management and smart ad deployment.
AI Document Assistant (RAG) [GitHub {ARROW}] - Python/Django/ChromaDB/MySQL Nov 2025
{BULLET} Developed a Django -based RAG PDF Q&A app with text extraction/chunking, 384 -dim embeddings, ChromaDB vector
storage, and TF -IDF + cosine re -ranking to deliver citation -grounded answers.
{BULLET} Implemented PDF.js chat interface with low -latency in -memory caching, MySQL authentication, and a startup pipeline
pre-loading server PDFs .
15-Puzzle Game [GitHub {ARROW}] - Java Dec 2023
{BULLET} Developed a console -based 15 -puzzle game using arrays in Java. Implemented logic for shuffling tiles, validating
moves, and checking win conditions, enhancing problem -solving skills and grasp of array -based data structures .
EDUCATION
Bachelor of Engineering in Computer Science Dec 2022 {EN_DASH} Apr 2026 (Expected) CGPA : 9.00
KLS Vishwanathrao Deshpande Institute of Technology Haliyal, Karnataka
CERTIFICATIONS
{BULLET} Python Full Stack Virtual Internship - Certificate {ARROW} {BULLET} Infosys UI Developer Program - Certificate {ARROW}
{BULLET} Avinya -2024 (Hackathon) - Certificate {ARROW} {BULLET} Hackfusion - 2K25 (Hackathon) - Certificate {ARROW}
ACHIEVEMENTS
{BULLET} Top Performer - ThirdEye Data Learning Path Program (Jan 2025)
"""


def parsed():
    return tools._heuristic_structured(tools._clean_resume_text(RESUME))


def test_wrapped_bullet_lines_are_not_new_projects():
    projects = parsed()["projects"]
    assert [p["name"] for p in projects] == [
        "A Real -Time System for Crowd Analytics".replace(" -T", "-T"), "AI Document Assistant (RAG)", "15-Puzzle Game",
    ]
    assert [len(p["bullets"]) for p in projects] == [2, 2, 1]
    # the wrapped half stays attached to its bullet instead of becoming its own bold heading
    assert projects[0]["bullets"][0].endswith("live video feeds .")
    assert "tracking, crowd density estimation" in projects[0]["bullets"][0]
    assert projects[1]["bullets"][1].endswith("pre-loading server PDFs .")


def test_project_title_is_split_into_name_technologies_and_date():
    first, second, third = parsed()["projects"]
    assert first["tech"] == ["Python", "Flask", "OpenCV", "MobileNetSSD", "Caffe DNN"]
    assert first["dates"] == "Jul 2025"
    assert second["tech"] == ["Python", "Django", "ChromaDB", "MySQL"] and second["dates"] == "Nov 2025"
    assert third["tech"] == ["Java"] and third["dates"] == "Dec 2023"
    for p in (first, second, third):
        assert "GitHub" not in p["name"] and ARROW not in p["name"]


def test_hyphen_spacing_from_pdf_extraction_is_repaired():
    data = parsed()
    assert "detail-oriented" in data["summary"] and "real-world" in data["summary"]
    assert "real-time" in " ".join(data["projects"][0]["bullets"])
    assert "Object-oriented programming" in data["skills"]


def test_skills_drop_the_label_and_keep_bracketed_groups_together():
    skills = parsed()["skills"]
    assert not any("Programming Skills" in s for s in skills)
    assert "Java" in skills and "Python" in skills and "Git" in skills
    assert "SQL (My SQL, Oracle )" in skills
    assert "Mongo DB (Mongo Shell, MongoDB Compass )" in skills


def test_certifications_are_one_item_each_without_link_arrows():
    certs = parsed()["certifications"]
    assert certs == [
        "Python Full Stack Virtual Internship - Certificate",
        "Infosys UI Developer Program - Certificate",
        "Avinya-2024 (Hackathon) - Certificate",
        "Hackfusion - 2K25 (Hackathon) - Certificate",
    ]
    assert all(ARROW not in c and BULLET not in c for c in certs)


def test_achievements_get_their_own_section_instead_of_leaking_into_certifications():
    data = parsed()
    assert data["achievements"] == ["Top Performer - ThirdEye Data Learning Path Program (Jan 2025)"]
    assert not any("ACHIEVEMENTS" in c or "Top Performer" in c for c in data["certifications"])


def test_education_splits_degree_dates_and_cgpa():
    edu = parsed()["education"][0]
    assert edu["degree"] == "Bachelor of Engineering in Computer Science"
    assert edu["dates"] == f"Dec 2022 {EN_DASH} Apr 2026 (Expected)"
    assert edu["details"] == "CGPA: 9.00"
    assert edu["institution"].startswith("KLS Vishwanathrao")


def test_education_without_dates_or_cgpa_is_left_alone():
    text = "Jane Doe\nEDUCATION\nB.Sc Physics\nCity College"
    edu =tools._heuristic_structured(text)["education"][0]
    assert edu["degree"] == "B.Sc Physics" and edu["institution"] == "City College"
    assert edu["dates"] == "" and edu["details"] == ""


def test_a_real_new_entry_after_a_finished_bullet_is_still_a_new_entry():
    text = f"""Jane Doe
EXPERIENCE
Backend Intern
Acme Corp
{BULLET} Built REST APIs with FastAPI.
Frontend Intern
Beta Labs
{BULLET} Built dashboards in React."""
    data = tools._heuristic_structured(tools._clean_resume_text(text))
    assert [e["title"] for e in data["experience"]] == ["Backend Intern", "Frontend Intern"]


def test_achievements_survive_validation_and_the_extraction_entry_point(monkeypatch):
    monkeypatch.setattr(tools.gemini_client, "is_ai_available", lambda: False)
    result = tools.extract_structured_resume(RESUME)
    assert result["achievements"] and result["projects"][0]["tech"]
    validated = tools._validate_structured({"skills": ["x"], "experience": [], "achievements": ["Won a hackathon"]}, RESUME)
    assert validated["achievements"] == ["Won a hackathon"]
    assert "dates" in tools._dict_list([{"name": "P", "dates": "Jan 2025"}], {"name": "", "dates": ""})[0]
