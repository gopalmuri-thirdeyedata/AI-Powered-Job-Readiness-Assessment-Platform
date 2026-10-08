import pytest
from utils import is_valid_candidate_email
from routers.resume import get_keyword_score, _skill_in_text
from services.rag_service import RAGService

def test_is_valid_candidate_email_rejects_dummies():
    # Obvious placeholders and dummy emails
    assert not is_valid_candidate_email("xxxx@gmail.com")
    assert not is_valid_candidate_email("xxx@gmail.com")
    assert not is_valid_candidate_email("xx@gmail.com")
    assert not is_valid_candidate_email("test@example.com")
    assert not is_valid_candidate_email("dummy@gmail.com")
    assert not is_valid_candidate_email("sample@domain.com")
    assert not is_valid_candidate_email("user@example.org")
    assert not is_valid_candidate_email("john.doe@test.com")
    assert not is_valid_candidate_email("candidate@gmail.com")
    assert not is_valid_candidate_email("a@gmail.com")
    assert not is_valid_candidate_email(None)
    assert not is_valid_candidate_email("")

def test_is_valid_candidate_email_accepts_valid():
    assert is_valid_candidate_email("mundgodsuprit@gmail.com")
    assert is_valid_candidate_email("gopalmuri2004@gmail.com")
    assert is_valid_candidate_email("krabhishek27@gmail.com")
    assert is_valid_candidate_email("ashish.pratap@outlook.com")
    assert is_valid_candidate_email("jane.smith@company.org")

def test_extract_candidate_info_dummy_email_handling():
    # Text with dummy email and github handle
    dummy_text = """
    Ashish Pratap Singh
    xxx@gmail.com | XXX-XXX-XXX
    github.com/ashishps1 | linkedin.com/in/ashishps1
    Skills: Java, Python, React, SQL
    """
    info = RAGService.extract_candidate_info(dummy_text, "Ashish_Resume.pdf")
    assert info["is_dummy_email"] is True
    assert info["original_dummy_email"] == "xxx@gmail.com"
    assert info["email"] == "ashishps1@candidate.hiringai.internal"
    assert info["name"] == "Ashish Pratap Singh"

def test_extract_candidate_info_valid_email_with_spaces():
    # Spaced email artifact from PDF
    valid_text = """
    Suprit R Mundagod
    mundgodsuprit @gmail.com
    +91-7795051561
    Java Full Stack Developer
    """
    info = RAGService.extract_candidate_info(valid_text, "Suprit_Resume.pdf")
    assert info["is_dummy_email"] is False
    assert info["email"] == "mundgodsuprit@gmail.com"

def test_keyword_scoring_with_required_skills_and_specific_targets():
    resume_text = """
    Senior Software Engineer with 5 years experience.
    Proficient in Python, Java, React, and JavaScript.
    Built production RESTful APIs and integrated payment gateways handling 50k requests daily.
    Strong AWS and database optimization skills.
    """
    
    score, matched, missing = get_keyword_score(
        resume_text=resume_text,
        jd_text="Looking for a Full Stack Developer with experience in web applications",
        explicit_skills=["Python", "Java", "React", "JavaScript"],
        specific_targets="Built production RESTful APIs\nIntegrated payment gateways"
    )
    
    assert set(matched) == {"Python", "Java", "React", "JavaScript"}
    assert missing == []
    assert score >= 75.0
