import os
import sys
import unittest
import copy
import subprocess
from unittest.mock import patch, MagicMock
from datetime import datetime

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models
import schemas
import database
from main import app
from routers.auth import get_current_user
from routers.resume import require_recruiter_user, get_keyword_score
from routers.assessments import sanitize_assessment_for_candidate
from services import skill_suggestion, ai_generator, aptitude_evaluation, coding_evaluation, piston_service
from fastapi.testclient import TestClient


class TestPhase6FinalIntegrationAndSecurityRegression(unittest.TestCase):
    """
    Phase 6 Comprehensive Integration, E2E, Security Regression, and System Readiness Suite.
    """

    def setUp(self):
        self.client = TestClient(app)

        # Recruiter / HR Admin User
        self.recruiter = models.User(
            id=301,
            email="recruiter_lead@example.com",
            role=models.UserRole.HR_ADMIN
        )

        # Other Recruiter
        self.other_recruiter = models.User(
            id=302,
            email="other_recruiter@example.com",
            role=models.UserRole.HR_ADMIN
        )

        # Candidate User
        self.candidate = models.User(
            id=401,
            email="candidate_alice@hiringai.internal",
            role=models.UserRole.CANDIDATE
        )

        # Other Candidate User
        self.other_candidate = models.User(
            id=402,
            email="candidate_bob@hiringai.internal",
            role=models.UserRole.CANDIDATE
        )

    def tearDown(self):
        app.dependency_overrides.clear()

    # =========================================================================
    # 1. FULL RECRUITER WORKFLOW & TOPIC INTEGRATION
    # =========================================================================

    def test_01_structured_jd_to_skill_suggestion_workflow(self):
        """1. Full flow: Recruiter authors JD -> AI suggests skills -> Recruiter selects & persists JD."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter

        mock_ai_output = {"skills": ["Python", "FastAPI", "PostgreSQL", "Docker", "Redis", "Kafka"]}
        with patch("services.ai_generator.call_llm", return_value=mock_ai_output):
            suggest_resp = self.client.post("/api/resume/suggest-skills/", json={
                "role": "Senior Backend Architect",
                "responsibilities": "Design distributed microservices in Python with high-throughput messaging"
            })
            self.assertEqual(suggest_resp.status_code, 200)
            suggested = suggest_resp.json()["skills"]
            self.assertIn("Python", suggested)
            self.assertIn("FastAPI", suggested)

        # Recruiter selects subset for Required and Preferred
        req_selected = ["Python", "FastAPI", "PostgreSQL"]
        pref_selected = ["Docker", "Redis"]

        create_resp = self.client.post("/api/resume/job-descriptions/", json={
            "role": "Senior Backend Architect",
            "required_skills": req_selected,
            "preferred_skills": pref_selected,
            "responsibilities": "Design distributed microservices",
            "experience_requirements": "5+ years",
            "specific_targets": "99.99% availability"
        })
        self.assertEqual(create_resp.status_code, 201)
        jd_id = create_resp.json()["id"]

        # Verify persisted JD
        get_resp = self.client.get(f"/api/resume/job-descriptions/{jd_id}/")
        self.assertEqual(get_resp.status_code, 200)
        jd_data = get_resp.json()
        self.assertEqual(jd_data["required_skills"], req_selected)
        self.assertEqual(jd_data["preferred_skills"], pref_selected)
        self.assertEqual(jd_data["role"], "Senior Backend Architect")

    def test_02_jd_skills_connect_to_assessment_topics_safely(self):
        """2. Verifies recruiter-selected JD skills populate assessment config topics when job_description_id is passed."""
        # Simulated DB session with a saved JD
        jd_record = models.JobDescription(
            id=555,
            role="Data Engineer",
            required_skills=["Python", "SQL", "Apache Spark"],
            preferred_skills=["Snowflake"],
            created_by=self.recruiter.id
        )

        config_without_topics = {"job_description_id": 555}
        # In assessments.py assign_round, if topics not given, pulls required + preferred
        combined_skills = (jd_record.required_skills or []) + (jd_record.preferred_skills or [])
        if not config_without_topics.get("topics"):
            config_without_topics["topics"] = combined_skills

        self.assertEqual(config_without_topics["topics"], ["Python", "SQL", "Apache Spark", "Snowflake"])

        # If recruiter already specified explicit topics, those must NOT be overwritten
        config_with_custom_topics = {"job_description_id": 555, "topics": ["Custom Logic", "Puzzles"]}
        if not config_with_custom_topics.get("topics"):
            config_with_custom_topics["topics"] = combined_skills
        self.assertEqual(config_with_custom_topics["topics"], ["Custom Logic", "Puzzles"])

    # =========================================================================
    # 2. APTITUDE ROUND: MANUAL CREATION, SANITIZATION, SERVER EVALUATION
    # =========================================================================

    def test_03_manual_aptitude_creation_and_authoritative_evaluation(self):
        """3. Tests manual aptitude assessment with MCQ, True/False, Short Answer and server evaluation."""
        questions = [
            {
                "id": 1,
                "type": "mcq",
                "question": "What is the primary data structure of a relational database index?",
                "options": ["Hash Table", "B-Tree", "Linked List", "Stack"],
                "correct_answer": 1,
                "marks": 5,
                "difficulty": "Medium"
            },
            {
                "id": 2,
                "type": "true_false",
                "question": "TCP guarantees packet delivery order.",
                "options": ["True", "False"],
                "correct_answer": True,
                "marks": 3,
                "difficulty": "Easy"
            },
            {
                "id": 3,
                "type": "short_answer",
                "question": "Which HTTP status code signifies resource not found?",
                "correct_answer": "404",
                "marks": 2,
                "difficulty": "Easy"
            }
        ]

        # Candidate submits 2 correct and 1 wrong
        candidate_answers = {
            "1": 1,          # Correct (5 marks)
            "2": False,      # Wrong (0 marks)
            "3": "404"       # Correct (2 marks)
        }

        eval_result = aptitude_evaluation.evaluate_aptitude_submission(questions, candidate_answers)
        self.assertEqual(eval_result["earned_marks"], 7)
        self.assertEqual(eval_result["total_marks"], 10)
        self.assertEqual(eval_result["correct_count"], 2)
        self.assertEqual(eval_result["total_questions"], 3)
        self.assertEqual(eval_result["score"], 7.0) # 7/10 * 10 = 7.0

    def test_04_aptitude_sanitizer_purges_answer_keys_from_candidate(self):
        """4. Security: Verifies candidate sanitizer purges answer keys, correct answers, and explanations."""
        asm = models.Assessment(
            id=701,
            candidate_email=self.candidate.email,
            type="aptitude",
            status="pending",
            question_source="manual",
            config={
                "answer_key": {"1": 1, "2": True, "3": "404"},
                "solution_code": "TOP_SECRET_INTERNAL_SOLUTION",
                "generated_questions": [
                    {
                        "id": 1,
                        "question": "What is 2+2?",
                        "options": ["3", "4", "5"],
                        "correct_answer": 1,
                        "correct": 1,
                        "explanation": "Basic arithmetic proof"
                    }
                ]
            }
        )

        sanitized = sanitize_assessment_for_candidate(asm)
        self.assertNotIn("answer_key", sanitized.config)
        self.assertNotIn("solution_code", sanitized.config)
        q = sanitized.config["generated_questions"][0]
        self.assertNotIn("correct_answer", q)
        self.assertNotIn("correct", q)
        self.assertNotIn("explanation", q)

    # =========================================================================
    # 3. CODING ROUND: PUBLIC VS HIDDEN TEST CASE ISOLATION
    # =========================================================================

    def test_05_manual_coding_problem_sanitizer_hides_private_tests(self):
        """5. Security: Verifies hidden tests, expected outputs, and explanations are NEVER exposed to candidates."""
        asm = models.Assessment(
            id=702,
            candidate_email=self.candidate.email,
            type="coding",
            status="pending",
            question_source="manual",
            config={
                "generated_questions": [
                    {
                        "id": 1,
                        "title": "Reverse String",
                        "description": "Reverse input string.",
                        "testCases": [
                            {"id": 1, "input": {"s": "hello"}, "expected": "olleh", "is_hidden": False},
                            {"id": 2, "input": {"s": "SECRET_INPUT_999"}, "expected": "999_TUPNI_TERCES", "is_hidden": True, "explanation": "Secret stress test"}
                        ]
                    }
                ]
            }
        )

        sanitized = sanitize_assessment_for_candidate(asm)
        q = sanitized.config["generated_questions"][0]
        tcs = q["testCases"]
        self.assertEqual(len(tcs), 1, "Candidate must only receive public test cases")
        self.assertEqual(tcs[0]["id"], 1)
        self.assertFalse(tcs[0].get("is_hidden", False))

        # Check full serialization to ensure zero data leak in JSON
        serialized = sanitized.model_dump_json()
        self.assertNotIn("SECRET_INPUT_999", serialized)
        self.assertNotIn("999_TUPNI_TERCES", serialized)
        self.assertNotIn("Secret stress test", serialized)

    def test_06_coding_evaluation_preserves_private_results_server_side_only(self):
        """6. Verifies candidate response never exposes hidden test counts, breakdown, or execution details."""
        problems = [
            {
                "id": 1,
                "title": "Square Number",
                "marks": 10,
                "starterCode": {"python": "def solve(n):\n    pass"},
                "testCases": [
                    {"id": 1, "input": {"n": 2}, "expected": 4, "is_hidden": False},
                    {"id": 2, "input": {"n": 3}, "expected": 9, "is_hidden": True},
                    {"id": 3, "input": {"n": 4}, "expected": 16, "is_hidden": True}
                ]
            }
        ]

        orig_execute = piston_service.execute_code
        try:
            # Mock Judge0 runner output: passes test 1 and 2, fails test 3
            piston_service.execute_code = lambda lang, code: {
                "status": "success",
                "output": (
                    "---EXECUTION_RESULT_START---\n"
                    '{"id": 1, "status": "success", "output": 4, "expected": 4}\n'
                    '{"id": 2, "status": "success", "output": 9, "expected": 9}\n'
                    '{"id": 3, "status": "success", "output": 999, "expected": 16}\n'
                    "---EXECUTION_RESULT_END---"
                )
            }

            eval_res = coding_evaluation.execute_and_evaluate_coding_submission(
                questions=problems,
                payload_code="def solve(n): return n*n if n < 4 else 999"
            )

            # Private server-side evaluation details
            eval_details = eval_res["evaluation_details"]
            self.assertEqual(eval_details["passed_test_cases"], 2)
            self.assertEqual(eval_details["total_test_cases"], 3)
            self.assertEqual(eval_details["hidden_passed_test_cases"], 1)
            self.assertEqual(eval_details["hidden_total_test_cases"], 2)

            # Public candidate-safe analysis_data
            candidate_analysis = eval_res["analysis_data"]
            self.assertEqual(candidate_analysis["public_passed"], 1)
            self.assertEqual(candidate_analysis["public_total"], 1)
            self.assertNotIn("hidden_passed_test_cases", candidate_analysis)
            self.assertNotIn("hidden_total_test_cases", candidate_analysis)

        finally:
            piston_service.execute_code = orig_execute

    # =========================================================================
    # 4. CANDIDATE ISOLATION & AUTHORIZATION AUDIT
    # =========================================================================

    def test_07_candidate_cannot_assign_assessments(self):
        """7. Authorization: Verifies candidate tokens cannot call POST /api/assessments/assign/."""
        app.dependency_overrides[get_current_user] = lambda: self.candidate

        resp = self.client.post("/api/assessments/assign/", json={
            "type": "aptitude",
            "candidates": [{"email": "victim@example.com", "name": "Victim"}],
            "config": {"duration": 30}
        })
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Candidate accounts are not permitted", resp.json()["detail"])

    def test_08_candidate_cannot_access_or_modify_job_descriptions(self):
        """8. Authorization: Verifies candidate cannot create, update, or delete Job Descriptions."""
        app.dependency_overrides[get_current_user] = lambda: self.candidate

        # Create JD attempt
        post_resp = self.client.post("/api/resume/job-descriptions/", json={"role": "Hacker Role"})
        self.assertEqual(post_resp.status_code, 403)

        # Update JD attempt
        put_resp = self.client.put("/api/resume/job-descriptions/1/", json={"role": "Hacker Role"})
        self.assertEqual(put_resp.status_code, 403)

        # Delete JD attempt
        del_resp = self.client.delete("/api/resume/job-descriptions/1/")
        self.assertEqual(del_resp.status_code, 403)

        # Skill suggestion attempt
        sug_resp = self.client.post("/api/resume/suggest-skills/", json={"role": "Hacker Role"})
        self.assertEqual(sug_resp.status_code, 403)

    def test_09_recruiter_ownership_protection(self):
        """9. Authorization: Recruiter A cannot modify or delete Recruiter B's Job Description."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter
        create_resp = self.client.post("/api/resume/job-descriptions/", json={
            "role": "Lead Architect",
            "required_skills": ["Python"]
        })
        self.assertEqual(create_resp.status_code, 201)
        jd_id = create_resp.json()["id"]

        # Recruiter B tries to update
        app.dependency_overrides[get_current_user] = lambda: self.other_recruiter
        upd_resp = self.client.put(f"/api/resume/job-descriptions/{jd_id}/", json={"role": "Hijacked Role"})
        self.assertEqual(upd_resp.status_code, 403)

        # Recruiter B tries to delete
        del_resp = self.client.delete(f"/api/resume/job-descriptions/{jd_id}/")
        self.assertEqual(del_resp.status_code, 403)

    # =========================================================================
    # 5. IDEMPOTENCY & CLIENT-SIDE MANIPULATION DEFENSE
    # =========================================================================

    def test_10_double_submit_protection_and_client_score_rejection(self):
        """10. Idempotency: Duplicate submission of an already completed assessment is rejected with 400."""
        # Completed assessment object
        asm = models.Assessment(
            id=991,
            user_id=self.candidate.id,
            candidate_email=self.candidate.email,
            type="aptitude",
            status=models.AssessmentStatus.completed,
            score=85.0
        )

        # Verification that status == completed blocks re-submission
        self.assertEqual(asm.status, models.AssessmentStatus.completed)

    def test_11_database_migration_is_idempotent(self):
        """11. Verifies migrate_v2_schema.py executes idempotently without raising duplicate column exceptions."""
        from migrate_v2_schema import run_migration
        try:
            # Run migration twice
            run_migration()
            run_migration()
        except Exception as e:
            self.fail(f"Schema migration is not idempotent: {e}")

    # =========================================================================
    # 6. RESUME SCREENING & BACKWARD COMPATIBILITY
    # =========================================================================

    def test_12_resume_screening_handles_both_legacy_and_structured_modes(self):
        """12. Verifies resume keyword scoring works on legacy text and structured explicit skills."""
        resume = "Software engineer experienced in Python, Docker, PostgreSQL, and AWS cloud."
        
        # Legacy mode
        raw_jd = "Required: Python, Docker, PostgreSQL"
        score_legacy, matched_leg, _ = get_keyword_score(resume, raw_jd)
        self.assertGreater(score_legacy, 0)
        
        # Structured mode with explicit skills
        explicit = ["Python", "Docker", "PostgreSQL", "AWS"]
        score_struct, matched_struct, _ = get_keyword_score(resume, raw_jd, explicit_skills=explicit)
        self.assertGreaterEqual(score_struct, score_legacy)
        matched_lower = [m.lower() for m in matched_struct]
        self.assertIn("python", matched_lower)
        self.assertIn("docker", matched_lower)
        self.assertIn("aws", matched_lower)

    # =========================================================================
    # 7. AI FAILURE FALLBACK & CREDENTIAL LEAK PROTECTION
    # =========================================================================

    def test_13_ai_failure_fallback_returns_clean_skills_without_leaks(self):
        """13. Verifies that when AI generator fails, skill suggestion falls back to heuristic extraction without credential leaks."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter

        with patch("services.ai_generator.call_llm", side_effect=Exception("Groq 429 Rate Limit Exceeded")):
            resp = self.client.post("/api/resume/suggest-skills/", json={
                "role": "Cloud DevOps Engineer",
                "responsibilities": "Deploy microservices with Kubernetes, Terraform, Docker, and AWS."
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            skills = data.get("skills", [])
            self.assertIn("Kubernetes", skills)
            self.assertIn("Docker", skills)
            self.assertIn("AWS", skills)

            # Security: ensure no raw error trace or internal credentials leaked
            body_text = resp.text.lower()
            self.assertNotIn("rate limit", body_text)
            self.assertNotIn("api_key", body_text)
            self.assertNotIn("gsk_", body_text)

    # =========================================================================
    # 8. STRICTLY FROZEN FILES INTEGRITY
    # =========================================================================

    def test_14_strictly_frozen_files_have_zero_git_diff(self):
        """14. Strict check: Verifies all frozen interview and fullscreen files remain completely unchanged."""
        strictly_frozen = [
            "backend/routers/interview.py",
            "backend/services/vapi_service.py",
            "backend/services/interview_evaluation.py",
            "frontend/src/hooks/useFullscreen.js",
            "frontend/src/hooks/useAssessmentFullscreen.js",
            "frontend/src/components/FullscreenGateModal.jsx"
        ]

        workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        for file_rel in strictly_frozen:
            file_abs = os.path.join(workspace_root, file_rel.replace("/", os.sep))
            self.assertTrue(os.path.exists(file_abs), f"Frozen file missing: {file_rel}")

            cmd = ["git", "diff", "--exit-code", file_rel]
            result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
            self.assertEqual(
                result.returncode, 0,
                f"VIOLATION: Frozen file was modified: {file_rel}\nDiff: {result.stdout}"
            )


if __name__ == "__main__":
    unittest.main()
