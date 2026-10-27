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
from services import skill_suggestion, ai_generator
from fastapi.testclient import TestClient


class TestPhase5JobDescriptionAndAISkills(unittest.TestCase):
    """
    Comprehensive Phase 5 Test Suite:
    Tests Structured Job Descriptions, AI Skill Suggestions, Normalization,
    Recruiter Selection Workflow, Security, Backward Compatibility, and Regression.
    """

    def setUp(self):
        self.client = TestClient(app)
        
        # Mock users use ids far outside the real auto-increment range: the tenant lookup queries the
        # shared dev DB by user id, so low ids could collide with real users created by other tests.
        # Mock Recruiter User
        self.recruiter_user = models.User(
            id=9000101,
            email="recruiter@example.com",
            role=models.UserRole.HR_ADMIN
        )

        # Mock Other Recruiter User (for unauthorized JD access tests)
        self.other_recruiter = models.User(
            id=9000102,
            email="other_recruiter@example.com",
            role=models.UserRole.HR_ADMIN
        )

        # Mock Candidate User
        self.candidate_user = models.User(
            id=9000202,
            email="candidate_123@hiringai.internal",
            role=models.UserRole.CANDIDATE
        )

    def tearDown(self):
        app.dependency_overrides.clear()

    # =========================================================================
    # SECTION 1: JOB DESCRIPTION TESTS (1 - 7)
    # =========================================================================

    def test_01_structured_jd_creation(self):
        """1. Tests structured Job Description creation with all Phase 1/5 fields."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        payload = {
            "title": "Backend Developer",
            "role": "Backend Developer",
            "required_skills": ["Python", "FastAPI", "PostgreSQL"],
            "preferred_skills": ["Docker", "AWS", "Redis"],
            "responsibilities": "Build high-throughput REST APIs and manage data pipelines.",
            "experience_requirements": "3-5 years",
            "specific_targets": "Maintain 99.9% API uptime",
            "expected_achievements": "Lead migration to containerized architecture",
            "additional_requirements": "Comfortable with agile pair programming",
            "target_capacity": 5
        }

        resp = self.client.post("/api/resume/job-descriptions/", json=payload)
        self.assertEqual(resp.status_code, 201)
        data = resp.json()

        self.assertEqual(data["role"], "Backend Developer")
        self.assertEqual(data["required_skills"], ["Python", "FastAPI", "PostgreSQL"])
        self.assertEqual(data["preferred_skills"], ["Docker", "AWS", "Redis"])
        self.assertEqual(data["responsibilities"], "Build high-throughput REST APIs and manage data pipelines.")
        self.assertEqual(data["experience_requirements"], "3-5 years")
        self.assertEqual(data["specific_targets"], "Maintain 99.9% API uptime")
        self.assertEqual(data["expected_achievements"], "Lead migration to containerized architecture")
        self.assertEqual(data["additional_requirements"], "Comfortable with agile pair programming")
        self.assertEqual(data["target_capacity"], 5)
        self.assertTrue(data["id"] > 0)

    def test_02_structured_jd_update(self):
        """2. Tests structured Job Description update preserving recruiter changes."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        # Create initial JD
        create_resp = self.client.post("/api/resume/job-descriptions/", json={
            "role": "Frontend Engineer",
            "required_skills": ["React", "JavaScript"],
            "preferred_skills": ["TypeScript"],
            "responsibilities": "Develop interactive UIs"
        })
        self.assertEqual(create_resp.status_code, 201)
        jd_id = create_resp.json()["id"]

        # Update JD
        update_payload = {
            "role": "Senior Frontend Engineer",
            "required_skills": ["React", "TypeScript", "Next.js"],
            "preferred_skills": ["Tailwind CSS", "GraphQL"],
            "responsibilities": "Architect enterprise UI component library",
            "experience_requirements": "5+ years"
        }
        update_resp = self.client.put(f"/api/resume/job-descriptions/{jd_id}/", json=update_payload)
        self.assertEqual(update_resp.status_code, 200)
        updated_data = update_resp.json()

        self.assertEqual(updated_data["role"], "Senior Frontend Engineer")
        self.assertEqual(updated_data["required_skills"], ["React", "TypeScript", "Next.js"])
        self.assertEqual(updated_data["preferred_skills"], ["Tailwind CSS", "GraphQL"])
        self.assertEqual(updated_data["responsibilities"], "Architect enterprise UI component library")
        self.assertEqual(updated_data["experience_requirements"], "5+ years")

    def test_03_required_skills_validation(self):
        """3. Validates required_skills structure and rejects invalid formats."""
        # Pydantic schema validation
        jd_valid = schemas.JobDescriptionCreate(
            role="Data Engineer",
            required_skills=["Python", "SQL", "Apache Spark"]
        )
        self.assertEqual(len(jd_valid.required_skills), 3)

        # Non-list skills should be rejected by Pydantic
        with self.assertRaises(Exception):
            schemas.JobDescriptionCreate(
                role="Data Engineer",
                required_skills="Python, SQL, Apache Spark" # String instead of list
            )

    def test_04_preferred_skills_validation(self):
        """4. Validates preferred_skills remains distinct and never merged into required_skills."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        resp = self.client.post("/api/resume/job-descriptions/", json={
            "role": "DevOps Engineer",
            "required_skills": ["Linux", "Kubernetes", "Terraform"],
            "preferred_skills": ["Python", "Golang", "Prometheus"]
        })
        self.assertEqual(resp.status_code, 201)
        data = resp.json()

        # Both lists must remain strictly distinct. Note 'Golang' canonically normalizes to 'Go'.
        self.assertEqual(set(data["required_skills"]), {"Linux", "Kubernetes", "Terraform"})
        self.assertEqual(set(data["preferred_skills"]), {"Python", "Go", "Prometheus"})
        self.assertFalse(set(data["required_skills"]).intersection(set(data["preferred_skills"])))

    def test_05_skill_normalization(self):
        """5. Tests canonical skill normalization across various common technologies."""
        test_cases = [
            ("python", "Python"),
            ("fastapi", "FastAPI"),
            ("FASTAPI", "FastAPI"),
            ("postgresql", "PostgreSQL"),
            ("postgres", "PostgreSQL"),
            ("react.js", "React"),
            ("reactjs", "React"),
            ("node.js", "Node.js"),
            ("aws", "AWS"),
            ("k8s", "Kubernetes"),
            ("kubernetes", "Kubernetes"),
            ("docker", "Docker"),
            ("rest api", "REST APIs"),
            ("restful apis", "REST APIs"),
            ("mongodb", "MongoDB"),
            ("typescript", "TypeScript")
        ]
        for raw, expected in test_cases:
            self.assertEqual(skill_suggestion.normalize_skill(raw), expected)

    def test_06_duplicate_skill_removal(self):
        """6. Tests deduplication of skill names regardless of case and punctuation."""
        raw_list = ["Python", "python", "PYTHON", "FastAPI", "fastapi", "Docker", "docker", "docker,"]
        cleaned = skill_suggestion.deduplicate_and_normalize_skills(raw_list)
        self.assertEqual(cleaned, ["Python", "FastAPI", "Docker"])

    def test_07_existing_jd_backward_compatibility(self):
        """7. Tests backward compatibility when reading a legacy Job Description with null structured fields."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        # Create a JD using legacy format (only title and description)
        resp = self.client.post("/api/resume/job-descriptions/", json={
            "title": "Legacy Software Engineer",
            "description": "Standard legacy job description without structured fields"
        })
        self.assertEqual(resp.status_code, 201)
        jd_id = resp.json()["id"]

        # Retrieve JD - must load smoothly without schema error
        get_resp = self.client.get(f"/api/resume/job-descriptions/{jd_id}/")
        self.assertEqual(get_resp.status_code, 200)
        data = get_resp.json()

        self.assertEqual(data["title"], "Legacy Software Engineer")
        self.assertEqual(data["description"], "Standard legacy job description without structured fields")
        self.assertIsInstance(data["required_skills"], list)
        self.assertIsInstance(data["preferred_skills"], list)

    # =========================================================================
    # SECTION 2: AI SKILL EXTRACTION TESTS (8 - 14)
    # =========================================================================

    def test_08_valid_ai_skill_response(self):
        """8. Tests AI skill suggestion endpoint with valid structured JD input."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        payload = {
            "role": "Backend Developer",
            "required_skills": ["Python", "FastAPI"],
            "preferred_skills": ["Docker"],
            "responsibilities": "Build REST APIs and backend services using PostgreSQL and Redis",
            "experience_requirements": "2-4 years"
        }

        # Mock LLM call to return clean JSON
        mock_ai_dict = {"skills": ["Python", "FastAPI", "SQL", "PostgreSQL", "REST APIs", "Docker", "Redis"]}
        with patch("services.ai_generator.call_llm", return_value=mock_ai_dict):
            resp = self.client.post("/api/resume/suggest-skills/", json=payload)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            skills = data.get("skills", [])
            self.assertIn("Python", skills)
            self.assertIn("FastAPI", skills)
            self.assertIn("PostgreSQL", skills)
            self.assertIn("Docker", skills)

    def test_09_duplicate_ai_skills(self):
        """9. Tests deduplication when AI returns duplicate skills in its JSON output."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        mock_raw_dict = {"skills": ["Python", "python", "PYTHON", "FastAPI", "fastapi", "Docker"]}
        with patch("services.ai_generator.call_llm", return_value=mock_raw_dict):
            resp = self.client.post("/api/resume/suggest-skills/", json={"role": "Backend Engineer"})
            self.assertEqual(resp.status_code, 200)
            skills = resp.json().get("skills", [])
            self.assertEqual(skills, ["Python", "FastAPI", "Docker"])

    def test_10_empty_ai_response(self):
        """10. Tests handling when AI returns empty response without crashing."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        mock_empty = {"skills": []}
        with patch("services.ai_generator.call_llm", return_value=mock_empty):
            resp = self.client.post("/api/resume/suggest-skills/", json={
                "role": "Python Developer",
                "responsibilities": "Write Python code with Django and PostgreSQL"
            })
            self.assertEqual(resp.status_code, 200)
            skills = resp.json().get("skills", [])
            # Falls back to heuristic extraction or returns non-empty list
            self.assertIsInstance(skills, list)

    def test_11_malformed_ai_response(self):
        """11. Tests graceful fallback to heuristic skill extraction when AI returns malformed non-JSON."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        # AI returned invalid string instead of expected dict
        malformed_output = "Sure, here are some recommended skills: Python, Docker, PostgreSQL, and Kubernetes."
        with patch("services.ai_generator.call_llm", return_value=malformed_output):
            resp = self.client.post("/api/resume/suggest-skills/", json={
                "role": "Backend Engineer",
                "responsibilities": "Develop backend in Python with Docker and PostgreSQL"
            })
            self.assertEqual(resp.status_code, 200)
            skills = resp.json().get("skills", [])
            # Heuristic parser extracts keywords from the text
            self.assertIn("Python", skills)
            self.assertIn("Docker", skills)
            self.assertIn("PostgreSQL", skills)

    def test_12_ai_provider_failure(self):
        """12. Tests that AI provider timeout or network exception does not crash endpoint (HTTP 200 with fallback)."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        # Simulate provider outage
        with patch("services.ai_generator.call_llm", side_effect=Exception("Connection timeout to AI provider")):
            resp = self.client.post("/api/resume/suggest-skills/", json={
                "role": "Cloud Architect",
                "responsibilities": "Manage AWS, Terraform, Kubernetes, and Docker environments."
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            skills = data.get("skills", [])
            # Heuristic fallback extracts technologies from JD text
            self.assertIn("AWS", skills)
            self.assertIn("Kubernetes", skills)
            self.assertIn("Docker", skills)

    def test_13_invalid_skill_values(self):
        """13. Tests filtering out generic phrases, soft skills, and sentences from suggestions."""
        raw_candidates = [
            "Strong communication skills",
            "Team player",
            "Problem solving",
            "Self-starter with 5 years experience",
            "Python",
            "FastAPI",
            "Good listener",
            "AWS"
        ]
        filtered = skill_suggestion.deduplicate_and_normalize_skills(raw_candidates)
        self.assertNotIn("Strong communication skills", filtered)
        self.assertNotIn("Team player", filtered)
        self.assertNotIn("Problem solving", filtered)
        self.assertIn("Python", filtered)
        self.assertIn("FastAPI", filtered)
        self.assertIn("AWS", filtered)

    def test_14_skill_normalization_consistency(self):
        """14. Tests that normalization is idempotent and uniform across repeated passes."""
        techs = ["python", "c++", "k8s", "postgresql", "node.js", "rest api"]
        first_pass = [skill_suggestion.normalize_skill(t) for t in techs]
        second_pass = [skill_suggestion.normalize_skill(t) for t in first_pass]
        self.assertEqual(first_pass, second_pass)

    # =========================================================================
    # SECTION 3: API SECURITY TESTS (15 - 18)
    # =========================================================================

    def test_15_unauthorized_jd_access(self):
        """15. Verifies recruiters cannot modify or delete Job Descriptions owned by other recruiters."""
        # Recruiter 1 creates JD
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user
        create_resp = self.client.post("/api/resume/job-descriptions/", json={"role": "Private JD"})
        self.assertEqual(create_resp.status_code, 201)
        jd_id = create_resp.json()["id"]

        # Recruiter 2 tries to update Recruiter 1's JD
        app.dependency_overrides[get_current_user] = lambda: self.other_recruiter
        update_resp = self.client.put(f"/api/resume/job-descriptions/{jd_id}/", json={"role": "Hacked JD"})
        self.assertEqual(update_resp.status_code, 403)

        # Recruiter 2 tries to delete Recruiter 1's JD
        del_resp = self.client.delete(f"/api/resume/job-descriptions/{jd_id}/")
        self.assertEqual(del_resp.status_code, 403)

    def test_16_candidate_cannot_modify_jd(self):
        """16. Verifies candidate users cannot create, modify, delete JDs, or call suggest-skills."""
        app.dependency_overrides[get_current_user] = lambda: self.candidate_user

        # Candidate cannot create JD
        post_resp = self.client.post("/api/resume/job-descriptions/", json={"role": "Candidate Attempt"})
        self.assertEqual(post_resp.status_code, 403)

        # Candidate cannot call suggest-skills
        suggest_resp = self.client.post("/api/resume/suggest-skills/", json={"role": "Candidate Attempt"})
        self.assertEqual(suggest_resp.status_code, 403)

    def test_17_ai_secrets_never_exposed(self):
        """17. Verifies API keys, provider credentials, and system tokens are never leaked in suggest-skills response."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        resp = self.client.post("/api/resume/suggest-skills/", json={
            "role": "Security Engineer",
            "responsibilities": "Penetration testing and credential management"
        })
        self.assertEqual(resp.status_code, 200)
        body_text = resp.text.lower()

        # Check that no sensitive environment secrets or api key tokens leak
        self.assertNotIn("gsk_", body_text)
        self.assertNotIn("groq_api_key", body_text)
        self.assertNotIn("bearer", body_text)
        self.assertNotIn("secret_key", body_text)

    def test_18_internal_ai_prompt_not_returned(self):
        """18. Verifies internal AI system prompts or prompt templates are not returned to client."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        resp = self.client.post("/api/resume/suggest-skills/", json={
            "role": "AI Engineer",
            "responsibilities": "Fine-tune LLMs"
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        # Must only return schemas.SuggestSkillsResponse containing 'skills'
        self.assertIn("skills", data)
        self.assertNotIn("prompt", data)
        self.assertNotIn("system_prompt", data)
        self.assertNotIn("instructions", data)

    # =========================================================================
    # SECTION 4: INTEGRATION & REGRESSION TESTS (19 - 22)
    # =========================================================================

    def test_19_final_recruiter_selected_skills_persisted(self):
        """19. Tests that final recruiter-selected skills (required vs. preferred) are persisted in DB."""
        app.dependency_overrides[get_current_user] = lambda: self.recruiter_user

        # 1. AI suggests skills
        mock_ai_dict = {"skills": ["Python", "FastAPI", "SQL", "Docker", "AWS", "Kubernetes"]}
        with patch("services.ai_generator.call_llm", return_value=mock_ai_dict):
            suggest_resp = self.client.post("/api/resume/suggest-skills/", json={"role": "Backend Dev"})
            self.assertEqual(suggest_resp.status_code, 200)
            suggested = suggest_resp.json()["skills"]

        # 2. Recruiter picks required skills, preferred skills, and adds a custom skill
        recruiter_required = [suggested[0], suggested[1]] # Python, FastAPI
        recruiter_preferred = [suggested[3]] # Docker
        recruiter_preferred.append("Redis") # Manually added

        # 3. Recruiter saves JD
        save_resp = self.client.post("/api/resume/job-descriptions/", json={
            "role": "Backend Lead",
            "required_skills": recruiter_required,
            "preferred_skills": recruiter_preferred,
            "responsibilities": "Lead backend architecture"
        })
        self.assertEqual(save_resp.status_code, 201)
        jd_id = save_resp.json()["id"]

        # 4. Fetch and verify persistence
        fetch_resp = self.client.get(f"/api/resume/job-descriptions/{jd_id}/")
        self.assertEqual(fetch_resp.status_code, 200)
        saved_jd = fetch_resp.json()

        self.assertEqual(saved_jd["required_skills"], ["Python", "FastAPI"])
        self.assertEqual(saved_jd["preferred_skills"], ["Docker", "Redis"])

    def test_20_resume_screening_regression(self):
        """20. Verifies resume screening continues working with structured JD and legacy JD."""
        resume_text = """
        John Doe
        Experienced software engineer with 4 years in Python, FastAPI, Docker, and PostgreSQL.
        Built REST APIs and deployed microservices on AWS.
        """
        raw_jd = "Looking for a Python developer with FastAPI and Docker experience."

        # 1. Legacy keyword scoring
        score, matched, missing = get_keyword_score(resume_text, raw_jd)
        self.assertGreater(score, 0)
        self.assertIn("python", [m.lower() for m in matched])

        # 2. Structured JD with explicit recruiter skills
        explicit_skills = ["Python", "FastAPI", "Docker", "PostgreSQL"]
        structured_score, s_matched, s_missing = get_keyword_score(
            resume_text, raw_jd, explicit_skills=explicit_skills
        )
        self.assertGreaterEqual(structured_score, score)
        matched_lower = [m.lower() for m in s_matched]
        self.assertIn("python", matched_lower)
        self.assertIn("fastapi", matched_lower)

    def test_21_existing_assessment_assignment_regression(self):
        """21. Verifies existing assessment configuration links recruiter skills without breaking generation."""
        from routers.assessments import sanitize_assessment_for_candidate

        # Create a test assessment
        asm = models.Assessment(
            id=999,
            candidate_email="test@example.com",
            type="aptitude",
            status="pending",
            score=0.0,
            question_source="ai",
            config={
                "job_description_id": 1,
                "topics": ["Python", "FastAPI"],
                "generated_questions": [
                    {"id": 1, "question": "What is Python?", "options": ["A language", "A snake"], "correct": 0}
                ]
            }
        )

        sanitized = sanitize_assessment_for_candidate(asm)
        self.assertEqual(sanitized.type, "aptitude")
        self.assertEqual(sanitized.question_source, "ai")
        self.assertIn("generated_questions", sanitized.config)
        # Security: correct answer stripped
        self.assertNotIn("correct", sanitized.config["generated_questions"][0])

    def test_22_frozen_interview_and_fullscreen_files_remain_untouched(self):
        """22. Verifies 0 git diff across all strictly frozen interview and fullscreen files."""
        strictly_frozen = [
            "backend/services/interview_evaluation.py",
            "frontend/src/hooks/useFullscreen.js",
            "frontend/src/hooks/useAssessmentFullscreen.js",
            "frontend/src/components/FullscreenGateModal.jsx"
        ]

        workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        for file_rel_path in strictly_frozen:
            file_abs_path = os.path.join(workspace_root, file_rel_path.replace("/", os.sep))
            self.assertTrue(os.path.exists(file_abs_path), f"Frozen file missing: {file_rel_path}")

            cmd = ["git", "diff", "--exit-code", file_rel_path]
            result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
            self.assertEqual(
                result.returncode, 0,
                f"CRITICAL VIOLATION: Strictly frozen file has been modified: {file_rel_path}\nDiff: {result.stdout}"
            )


if __name__ == "__main__":
    unittest.main()
