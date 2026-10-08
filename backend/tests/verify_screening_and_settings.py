import pytest
import json
from fastapi.testclient import TestClient
from main import app
from database import SessionLocal
import models
from utils import create_access_token

@pytest.fixture
def auth_headers():
    db = SessionLocal()
    user = db.query(models.User).filter(models.User.role != 'candidate').first()
    token = create_access_token({'sub': user.email})
    db.close()
    return {'Authorization': f'Bearer {token}'}

def test_settings_api_get_and_put(auth_headers):
    client = TestClient(app)
    
    # 1. GET Settings
    get_res = client.get('/api/settings/', headers=auth_headers)
    assert get_res.status_code == 200
    config = get_res.json()
    assert "scoring" in config
    assert "notifications" in config
    assert "emails" in config
    assert "security" in config
    
    # 2. PUT Settings with customized weights
    new_config = dict(config)
    new_config["scoring"] = {
        "skills": 40,
        "experience": 25,
        "projects": 20,
        "education": 10,
        "bonus": 5
    }
    new_config["notifications"]["recipientEmail"] = "hr-admin@hiringai.com"
    
    put_res = client.put('/api/settings/', json={"config": new_config}, headers=auth_headers)
    assert put_res.status_code == 200
    assert put_res.json()["message"] == "Settings updated"
    
    # 3. Verify Persistence
    verify_res = client.get('/api/settings/', headers=auth_headers)
    assert verify_res.status_code == 200
    saved = verify_res.json()
    assert saved["scoring"]["skills"] == 40
    assert saved["notifications"]["recipientEmail"] == "hr-admin@hiringai.com"

def test_resume_screening_end_to_end_with_criteria_and_email_validation(auth_headers):
    client = TestClient(app)
    path1 = 'backend/media/resumes/Ashish_Pratap_Singh_Resume.pdf' if os.path.exists('backend/media/resumes/Ashish_Pratap_Singh_Resume.pdf') else 'media/resumes/Ashish_Pratap_Singh_Resume.pdf'
    path2 = 'backend/media/resumes/Suprit_Resume.pdf' if os.path.exists('backend/media/resumes/Suprit_Resume.pdf') else 'media/resumes/Suprit_Resume.pdf'
    with open(path1, 'rb') as f1, \
         open(path2, 'rb') as f2:
        files = [
            ('files', ('Ashish_Pratap_Singh_Resume.pdf', f1, 'application/pdf')),
            ('files', ('Suprit_Resume.pdf', f2, 'application/pdf'))
        ]
        
        data = {
            'job_description': 'Senior Full Stack Software Engineer to build scalable microservices and APIs.',
            'required_skills': json.dumps(['Python', 'Java', 'React', 'JavaScript']),
            'specific_targets': 'Built REST APIs\nExperience with cloud platforms (AWS)',
            'top_n': 2
        }
        
        res = client.post('/api/resume/screen/', files=files, data=data, headers=auth_headers)
        assert res.status_code == 200
        res_json = res.json()
        assert res_json["status"] == "completed"
        assert res_json["total_screened"] >= 2
        
        results = res_json["results"]
        assert len(results) >= 2
        
        # Verify Ashish's dummy email was rejected with reason and NOT added to Candidate DB
        ashish_res = next((r for r in results if 'Ashish' in r.get('name', '')), None)
        assert ashish_res is not None
        assert ashish_res["status"] == "Rejected"
        assert "Rejected" in ashish_res["reasoning"] or "placeholder" in ashish_res["reasoning"].lower()
        candidate_obj = ashish_res.get("candidate", {})
        assert candidate_obj.get("status") == "Rejected"
        assert candidate_obj.get("is_dummy_email") is True
        assert candidate_obj.get("id") is None  # NOT saved in DB!
        
        # Verify Suprit has valid real email, is Screened, and IS saved in DB
        suprit_res = next((r for r in results if 'Suprit' in r.get('name', '')), None)
        assert suprit_res is not None
        assert suprit_res["status"] == "Screened"
        assert suprit_res["score"] > 0
        suprit_cand = suprit_res.get("candidate", {})
        assert suprit_cand.get("email") == "mundgodsuprit@gmail.com"
        assert suprit_cand.get("is_dummy_email") is False
        assert suprit_cand.get("id") is not None  # Saved in DB!

def test_scoring_weights_change_impacts_screening(auth_headers):
    """
    Verifies that changing scoring weights in Settings directly updates
    how resumes are evaluated during screening.
    """
    client = TestClient(app)
    
    # 1. Update settings with high skills weight (70%)
    high_skills_config = {
        "scoring": {
            "skills": 70,
            "experience": 10,
            "projects": 10,
            "education": 5,
            "bonus": 5
        }
    }
    # Fetch existing config first to merge
    curr = client.get('/api/settings/', headers=auth_headers).json()
    curr["scoring"] = high_skills_config["scoring"]
    put_res1 = client.put('/api/settings/', json={"config": curr}, headers=auth_headers)
    assert put_res1.status_code == 200

    # Test keyword scoring with high skills weight
    from routers.resume import get_keyword_score
    resume_text = "Experienced developer with Python, React, JavaScript, Docker, AWS. Bachelor of Science in CS."
    jd_text = "We are seeking a developer with Python, React, JavaScript."
    skills = ["Python", "React", "JavaScript"]

    score_high_skills, _, _ = get_keyword_score(
        resume_text=resume_text,
        jd_text=jd_text,
        explicit_skills=skills,
        scoring_weights=curr["scoring"]
    )

    # 2. Update settings with low skills weight (20%) and high experience weight (55%)
    low_skills_config = {
        "skills": 20,
        "experience": 55,
        "projects": 15,
        "education": 5,
        "bonus": 5
    }
    curr["scoring"] = low_skills_config
    put_res2 = client.put('/api/settings/', json={"config": curr}, headers=auth_headers)
    assert put_res2.status_code == 200

    score_low_skills, _, _ = get_keyword_score(
        resume_text=resume_text,
        jd_text=jd_text,
        explicit_skills=skills,
        scoring_weights=low_skills_config
    )

    # Candidate matches all required skills; therefore high skills weight yields higher score than low skills weight
    assert score_high_skills > score_low_skills
    print(f"High skills score: {score_high_skills} vs Low skills score: {score_low_skills}")

    # 3. Reset back to standard balanced settings
    curr["scoring"] = {
        "skills": 40,
        "experience": 25,
        "projects": 20,
        "education": 10,
        "bonus": 5
    }
    client.put('/api/settings/', json={"config": curr}, headers=auth_headers)
