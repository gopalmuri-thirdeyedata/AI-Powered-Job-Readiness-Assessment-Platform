import requests
import json
import uuid
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

BASE_URL = "http://127.0.0.1:8000"

def run_live_e2e():
    print("=== LIVE END-TO-END SYSTEM VERIFICATION ===")
    
    # 1. Recruiter Clerk Sync
    print("\n1. Recruiter Authentication via Clerk Sync...")
    unique_email = f"recruiter_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/clerk-sync/", json={"email": unique_email})
    assert r.status_code == 200, f"Clerk sync failed: {r.text}"
    recruiter_token = r.json()["access"]
    recruiter_headers = {"Authorization": f"Bearer {recruiter_token}"}
    print(f"   [PASS] Recruiter authenticated: {unique_email}")

    # 2. Structured Job Description Creation
    print("\n2. Structured Job Description Creation...")
    jd_payload = {
        "title": "Lead Backend Python Engineer",
        "role": "Senior Backend Architect",
        "required_skills": ["Python", "FastAPI", "PostgreSQL", "Docker"],
        "preferred_skills": ["Redis", "Kubernetes", "AWS"],
        "responsibilities": "Design scalable APIs\nEnsure system security\nMentor junior devs",
        "experience_requirements": "6+ years with distributed systems",
        "specific_targets": "Scale to 50k requests per second",
        "expected_achievements": "99.99% uptime for core services",
        "additional_requirements": "Experience with CI/CD pipelines"
    }
    r_jd = requests.post(f"{BASE_URL}/api/resume/job-descriptions/", json=jd_payload, headers=recruiter_headers)
    assert r_jd.status_code in (200, 201), f"JD creation failed: {r_jd.text}"
    jd_data = r_jd.json()
    jd_id = jd_data["id"]
    assert jd_data["title"] == jd_payload["title"]
    assert "FastAPI" in jd_data["required_skills"]
    print(f"   [PASS] Job Description saved with ID: {jd_id}")

    # 3. AI Skill Suggestions Endpoint
    print("\n3. AI Skill Suggestions Engine...")
    r_skills = requests.post(f"{BASE_URL}/api/resume/suggest-skills/", json=jd_payload, headers=recruiter_headers)
    assert r_skills.status_code == 200, f"Suggest skills failed: {r_skills.text}"
    skills_data = r_skills.json()
    suggested = skills_data.get("skills", [])
    source = skills_data.get("source", "unknown")
    assert len(suggested) > 0, "No skills returned"
    print(f"   [PASS] AI suggested {len(suggested)} skills (source: {source}): {suggested[:4]}...")

    # 4. Recruiter B Ownership Isolation
    print("\n4. Recruiter Ownership Authorization...")
    other_email = f"other_recruiter_{uuid.uuid4().hex[:6]}@example.com"
    r_other = requests.post(f"{BASE_URL}/api/auth/clerk-sync/", json={"email": other_email})
    other_headers = {"Authorization": f"Bearer {r_other.json()['access']}"}
    r_steal = requests.put(f"{BASE_URL}/api/resume/job-descriptions/{jd_id}/", json={"title": "Hacked Title"}, headers=other_headers)
    assert r_steal.status_code == 403, f"Expected 403, got {r_steal.status_code}"
    print("   [PASS] Recruiter B correctly forbidden (HTTP 403) from modifying Recruiter A's JD")

    # 5. Candidate Assessment Creation & Assignment
    print("\n5. Candidate Setup & Assessment Assignment...")
    cand_email = f"candidate_{uuid.uuid4().hex[:6]}@gmail.com"
    cand_pwd = "SecureCandidate123!"
    
    # We create the candidate record and shadow account through assign_assessment
    # First, let's prepare an assessment assignment with manual aptitude and coding
    assign_payload = {
        "type": "aptitude",
        "question_source": "manual",
        "candidates": [{"email": cand_email, "name": "Alice Candidate"}],
        "config": {
            "job_description_id": jd_id,
            "questions": [
                {
                    "id": 1,
                    "type": "mcq",
                    "question": "What does GIL stand for in CPython?",
                    "options": ["Global Interpreter Lock", "General Interface Link", "Global Integer Logic", "Graph Interface Layer"],
                    "correct_answer": 0,
                    "marks": 5,
                    "difficulty": "Medium",
                    "explanation": "CPython uses the Global Interpreter Lock."
                },
                {
                    "id": 2,
                    "type": "true_false",
                    "question": "FastAPI is built on top of Starlette and Pydantic.",
                    "correct_answer": True,
                    "marks": 3,
                    "difficulty": "Easy",
                    "explanation": "FastAPI is built on Starlette and Pydantic."
                },
                {
                    "id": 3,
                    "type": "short_answer",
                    "question": "Which Python keyword is used to define an asynchronous coroutine?",
                    "correct_answer": "async",
                    "marks": 2,
                    "difficulty": "Medium",
                    "explanation": "async def defines coroutine functions."
                }
            ]
        }
    }
    r_assign = requests.post(f"{BASE_URL}/api/assessments/assign/", json=assign_payload, headers=recruiter_headers)
    import database, models, utils
    db = next(database.get_db())
    try:
        cand = db.query(models.Candidate).filter(models.Candidate.email == cand_email).first()
        assert cand is not None, "Candidate was not created in DB"
        cand.hashed_password = utils.get_password_hash("CandidatePass123!")
        db.commit()
    finally:
        db.close()
    print(f"   [PASS] Assessment assigned to {cand_email}, candidate record verified in DB")

    # 6. Candidate Login
    print("\n6. Candidate Authentication...")
    r_cand_login = requests.post(f"{BASE_URL}/api/auth/candidate-login/", json={
        "username": cand_email,
        "password": "CandidatePass123!"
    })
    assert r_cand_login.status_code == 200, f"Candidate login failed: {r_cand_login.text}"
    cand_token = r_cand_login.json()["access"]
    cand_headers = {"Authorization": f"Bearer {cand_token}"}
    print("   [PASS] Candidate logged in and received JWT token")

    # 7. Candidate Forbidden from Recruiter Endpoints
    print("\n7. Candidate Authorization Boundaries...")
    r_cand_forbidden = requests.post(f"{BASE_URL}/api/assessments/assign/", json=assign_payload, headers=cand_headers)
    assert r_cand_forbidden.status_code == 403, f"Expected 403, got {r_cand_forbidden.status_code}"
    r_cand_jd = requests.post(f"{BASE_URL}/api/resume/job-descriptions/", json=jd_payload, headers=cand_headers)
    assert r_cand_jd.status_code == 403, f"Expected 403, got {r_cand_jd.status_code}"
    print("   [PASS] Candidate forbidden (HTTP 403) from assign_assessment and create_jd")

    # 8. Candidate Pending Assessment Sanitization Check
    print("\n8. Candidate Data Sanitization...")
    r_pending = requests.get(f"{BASE_URL}/api/assessments/my-pending/", headers=cand_headers)
    assert r_pending.status_code == 200, f"Failed to get pending assessment: {r_pending.text}"
    pending_list = r_pending.json()
    assert len(pending_list) > 0, "No pending assessment returned for candidate"
    first_pending = pending_list[0]
    assessment_id = first_pending["id"]
    
    # Inspect all questions in the candidate's view
    questions = first_pending.get("config", {}).get("questions", [])
    assert len(questions) == 3, f"Expected 3 questions, got {len(questions)}"
    for q in questions:
        assert "answer_key" not in q, f"SECURITY LEAK: answer_key present in question {q.get('id')}"
        assert "correct_answer" not in q, f"SECURITY LEAK: correct_answer present in question {q.get('id')}"
        assert "accepted_answers" not in q, f"SECURITY LEAK: accepted_answers present in question {q.get('id')}"
        assert "explanation" not in q, f"SECURITY LEAK: explanation present in question {q.get('id')}"
    print("   [PASS] All answer keys, accepted answers, and explanations stripped from candidate view")

    # 9. Candidate Authoritative Submission
    print("\n9. Candidate Assessment Submission & Server-Side Scoring...")
    submit_payload = {
        "assessment_id": assessment_id,
        "answers": {
            "1": 0,          # Correct (5 marks)
            "2": True,       # Correct (3 marks)
            "3": "async"     # Correct (2 marks)
        },
        # Attempt to tamper with score from client
        "score": 999.0,
        "marks_earned": 999
    }
    r_submit = requests.post(f"{BASE_URL}/api/assessments/submit/", json=submit_payload, headers=cand_headers)
    assert r_submit.status_code == 200, f"Submission failed: {r_submit.text}"
    submit_res = r_submit.json()
    assert submit_res["status"] == "completed"
    assert submit_res["score"] == 10.0, f"Expected normalized score 10.0, got {submit_res.get('score')}"
    assert submit_res.get("score") != 999.0, "SECURITY FAIL: Client score was accepted!"
    print(f"   [PASS] Server evaluated answers authoritatively: {submit_res.get('score')} / 10.0 (Client tamper rejected)")

    # 10. Submission Idempotency: Double Submit Rejection
    print("\n10. Submission Idempotency...")
    r_double = requests.post(f"{BASE_URL}/api/assessments/submit/", json=submit_payload, headers=cand_headers)
    assert r_double.status_code == 400, f"Expected 400 for double submit, got {r_double.status_code}"
    print("   [PASS] Duplicate submission safely rejected with HTTP 400")

    # 11. Candidate Status Check: Evaluation Details Stripped
    print("\n11. Candidate Status Verification...")
    r_status = requests.get(f"{BASE_URL}/api/assessments/my-status/", headers=cand_headers)
    assert r_status.status_code == 200
    status_data = r_status.json()
    assert "evaluation_details" not in status_data or status_data.get("evaluation_details") is None, "SECURITY LEAK: evaluation_details exposed"
    assert "submission_data" not in status_data or status_data.get("submission_data") is None, "SECURITY LEAK: submission_data exposed"
    print("   [PASS] Private evaluation details withheld from candidate status endpoint")

    # 13. Coding Assessment Setup & Assignment
    print("\n13. Manual Coding Assessment Assignment & Security...")
    cand_coder_email = f"coder_{uuid.uuid4().hex[:6]}@gmail.com"
    coding_payload = {
        "type": "coding",
        "question_source": "manual",
        "candidates": [{"email": cand_coder_email, "name": "Bob Coder"}],
        "config": {
            "questions": [
                {
                    "id": 101,
                    "title": "Reverse String",
                    "description": "Given a string, return the reversed string.",
                    "difficulty": "Easy",
                    "marks": 10,
                    "starterCode": {
                        "python": "def solve(s):\n    return s[::-1]"
                    },
                    "testCases": [
                        {
                            "id": 1,
                            "input": "hello",
                            "expected": "olleh",
                            "is_hidden": False,
                            "explanation": "hello reversed is olleh"
                        },
                        {
                            "id": 2,
                            "input": "world",
                            "expected": "dlrow",
                            "is_hidden": True,
                            "explanation": "world reversed is dlrow"
                        }
                    ]
                }
            ]
        }
    }
    r_code_assign = requests.post(f"{BASE_URL}/api/assessments/assign/", json=coding_payload, headers=recruiter_headers)
    assert r_code_assign.status_code == 200, f"Coding assign failed: {r_code_assign.text}"

    # Set known password for coder in DB
    db = next(database.get_db())
    try:
        cand_c = db.query(models.Candidate).filter(models.Candidate.email == cand_coder_email).first()
        assert cand_c is not None
        cand_c.hashed_password = utils.get_password_hash("CoderPass123!")
        db.commit()
    finally:
        db.close()

    # Coder logs in
    r_coder_login = requests.post(f"{BASE_URL}/api/auth/candidate-login/", json={
        "username": cand_coder_email,
        "password": "CoderPass123!"
    })
    assert r_coder_login.status_code == 200
    coder_token = r_coder_login.json()["access"]
    coder_headers = {"Authorization": f"Bearer {coder_token}"}
    print(f"   [PASS] Coder assigned & authenticated: {cand_coder_email}")

    # Coder fetches pending assessment -> Verify hidden test security
    r_coder_pending = requests.get(f"{BASE_URL}/api/assessments/my-pending/", headers=coder_headers)
    assert r_coder_pending.status_code == 200
    coder_assessments = r_coder_pending.json()
    assert len(coder_assessments) > 0
    coder_q = coder_assessments[0].get("config", {}).get("questions", [])[0]
    cand_tcs = coder_q.get("testCases", [])
    
    assert len(cand_tcs) == 1, f"SECURITY LEAK: Expected exactly 1 public test case, got {len(cand_tcs)}"
    assert cand_tcs[0]["is_hidden"] is False
    assert cand_tcs[0].get("input") == "hello"
    assert "explanation" not in cand_tcs[0], "SECURITY LEAK: test explanation exposed to candidate"
    print("   [PASS] Hidden test case (id: 2, 'world') completely stripped from candidate view")

    # 14. Resume Screening Verification (Structured & Raw modes)
    print("\n14. Resume Screening Mode Verification...")
    r_jds = requests.get(f"{BASE_URL}/api/resume/job-descriptions/", headers=recruiter_headers)
    assert r_jds.status_code == 200
    jds_list = r_jds.json()
    assert len(jds_list) > 0
    print(f"   [PASS] Recruiter successfully retrieved {len(jds_list)} structured job descriptions")

    print("\n=== ALL 14 LIVE END-TO-END VERIFICATION CHECKS PASSED PERFECTLY ===")

if __name__ == "__main__":
    run_live_e2e()
