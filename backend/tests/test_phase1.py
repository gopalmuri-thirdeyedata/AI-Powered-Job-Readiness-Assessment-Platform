import os
import sys
import unittest
import copy
from datetime import datetime

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models
import schemas
from routers.assessments import sanitize_assessment_for_candidate


class TestPhase1DatabaseModels(unittest.TestCase):
    """Verifies that all Phase 1 columns exist on SQLAlchemy models."""

    def test_assessment_model_v2_columns(self):
        assessment_cols = [c.name for c in models.Assessment.__table__.columns]
        self.assertIn("question_source", assessment_cols)
        self.assertIn("submission_data", assessment_cols)
        self.assertIn("evaluation_details", assessment_cols)

    def test_job_description_model_v2_columns(self):
        jd_cols = [c.name for c in models.JobDescription.__table__.columns]
        self.assertIn("role", jd_cols)
        self.assertIn("required_skills", jd_cols)
        self.assertIn("preferred_skills", jd_cols)
        self.assertIn("responsibilities", jd_cols)
        self.assertIn("experience_requirements", jd_cols)
        self.assertIn("specific_targets", jd_cols)
        self.assertIn("expected_achievements", jd_cols)
        self.assertIn("additional_requirements", jd_cols)

    def test_assessment_instance_defaults(self):
        # Column level default check
        self.assertEqual(models.Assessment.question_source.default.arg, "ai")
        asm = models.Assessment(
            candidate_email="test@candidate.com",
            type="aptitude",
            config={"duration": 30},
            question_source="ai"
        )
        self.assertEqual(asm.question_source, "ai")
        self.assertIsNone(asm.submission_data)
        self.assertIsNone(asm.evaluation_details)


class TestPhase1PydanticSchemas(unittest.TestCase):
    """Verifies that Phase 1 Pydantic V2 schemas validate correctly."""

    def test_manual_aptitude_question_mcq(self):
        q = schemas.ManualAptitudeQuestion(
            id=1,
            question="What is an index in MySQL?",
            type="mcq",
            options=["A B-Tree structure", "A log file", "A table backup", "A server port"],
            correct_answer=0,
            marks=2,
            difficulty="Medium",
            explanation="Indexes use B-trees for fast lookups."
        )
        self.assertEqual(q.id, 1)
        self.assertEqual(q.type, "mcq")
        self.assertEqual(q.marks, 2)
        self.assertEqual(len(q.options), 4)
        self.assertEqual(q.correct_answer, 0)

    def test_manual_aptitude_question_true_false(self):
        q = schemas.ManualAptitudeQuestion(
            id=2,
            question="HTTP is a stateful protocol.",
            type="true_false",
            correct_answer=False,
            marks=1,
            difficulty="Easy"
        )
        self.assertEqual(q.type, "true_false")
        self.assertIs(q.correct_answer, False)
        self.assertEqual(q.marks, 1)

    def test_manual_aptitude_question_short_answer(self):
        q = schemas.ManualAptitudeQuestion(
            id=3,
            question="What is the average time complexity of quicksort?",
            type="short_answer",
            correct_answer="O(n log n)",
            marks=3,
            difficulty="Hard"
        )
        self.assertEqual(q.type, "short_answer")
        self.assertEqual(q.correct_answer, "O(n log n)")
        self.assertEqual(q.marks, 3)

    def test_coding_test_case_public_and_hidden(self):
        tc_pub = schemas.CodingTestCase(
            id=1,
            input={"nums": [2, 7, 11, 15], "target": 9},
            expected="[0, 1]",
            is_hidden=False
        )
        self.assertFalse(tc_pub.is_hidden)
        self.assertEqual(tc_pub.expected, "[0, 1]")

        tc_hid = schemas.CodingTestCase(
            id=2,
            input={"nums": [3, 2, 4], "target": 6},
            expected="[1, 2]",
            is_hidden=True
        )
        self.assertTrue(tc_hid.is_hidden)

    def test_manual_coding_question(self):
        coding_q = schemas.ManualCodingQuestion(
            id=1,
            title="Two Sum",
            description="Find indices of two numbers that add up to target.",
            difficulty="Easy",
            marks=10,
            constraints=["2 <= nums.length <= 10^4"],
            examples=[{"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]"}],
            testCases=[
                schemas.CodingTestCase(id=1, input={"nums": [2, 7], "target": 9}, expected="[0, 1]", is_hidden=False),
                schemas.CodingTestCase(id=2, input={"nums": [3, 2, 4], "target": 6}, expected="[1, 2]", is_hidden=True),
            ],
            starterCode={"python": "def two_sum(nums, target):\n    pass"}
        )
        self.assertEqual(coding_q.title, "Two Sum")
        self.assertEqual(len(coding_q.testCases), 2)
        self.assertEqual(coding_q.marks, 10)

    def test_structured_job_description_schemas(self):
        jd = schemas.JobDescriptionCreate(
            title="Senior Python Backend Engineer",
            role="Backend Engineer",
            description="Build scalable APIs and microservices",
            required_skills=["Python", "FastAPI", "PostgreSQL", "Docker"],
            preferred_skills=["Redis", "Kubernetes", "AWS"],
            responsibilities="Design APIs, write automated tests, lead architecture",
            experience_requirements="3-5 years",
            specific_targets="Deliver multi-tenant auth in Q1",
            expected_achievements="Achieve 99.9% uptime",
            additional_requirements="Excellent communication",
            target_capacity=25
        )
        self.assertEqual(jd.role, "Backend Engineer")
        self.assertEqual(len(jd.required_skills), 4)
        self.assertEqual(len(jd.preferred_skills), 3)
        self.assertEqual(jd.target_capacity, 25)

    def test_skill_detection_schemas(self):
        req = schemas.ExtractSkillsRequest(
            job_description="Seeking a React frontend developer with TypeScript and TailwindCSS experience.",
            role="Frontend Developer"
        )
        self.assertEqual(req.role, "Frontend Developer")

        res = schemas.ExtractedSkillsResponse(
            required_skills=["React", "TypeScript"],
            preferred_skills=["TailwindCSS", "Next.js"]
        )
        self.assertEqual(len(res.required_skills), 2)
        self.assertEqual(len(res.preferred_skills), 2)

    def test_submission_payload_accepts_various_answer_types(self):
        # MCQ (int), True/False (bool), Short Answer (str)
        payload = schemas.SubmissionPayload(
            answers={"1": 0, "2": False, "3": "O(log n)"},
            status="Submitted: 3/3"
        )
        self.assertEqual(payload.answers["1"], 0)
        self.assertIs(payload.answers["2"], False)
        self.assertEqual(payload.answers["3"], "O(log n)")


class TestPhase1CandidateSanitizer(unittest.TestCase):
    """Verifies that sanitize_assessment_for_candidate strictly prevents secret leakage."""

    def setUp(self):
        self.now = datetime.now()

    def test_sanitize_aptitude_removes_answers_and_preserves_orm(self):
        raw_config = {
            "duration": 30,
            "answer_key": {"1": 1, "2": 3, "3": False, "4": "O(n)"},
            "generated_questions": [
                {
                    "id": 1,
                    "question": "What is 2 + 2?",
                    "type": "mcq",
                    "options": ["3", "4", "5", "6"],
                    "correct": 1,
                    "correct_answer": 1,
                    "answer": 1,
                    "explanation": "2 + 2 equals 4.",
                    "marks": 2,
                    "difficulty": "Easy"
                },
                {
                    "id": 2,
                    "question": "Python is compiled directly to machine code.",
                    "type": "true_false",
                    "correct": False,
                    "correct_answer": False,
                    "answer": False,
                    "explanation": "Python compiles to bytecode executed by CPython VM.",
                    "marks": 1,
                    "difficulty": "Easy"
                }
            ]
        }

        # Create mock ORM Assessment
        asm = models.Assessment(
            id=101,
            candidate_email="candidate@example.com",
            type="aptitude",
            config=copy.deepcopy(raw_config),
            status="pending",
            score=0.0,
            question_source="manual",
            created_at=self.now
        )

        sanitized = sanitize_assessment_for_candidate(asm)

        # 1. Output verification
        self.assertIsInstance(sanitized, schemas.AssessmentResponse)
        self.assertEqual(sanitized.id, 101)
        self.assertEqual(sanitized.type, "aptitude")
        self.assertEqual(sanitized.question_source, "manual")

        # 2. Secret leakage verification
        out_cfg = sanitized.config
        self.assertNotIn("answer_key", out_cfg, "Candidate config must not have answer_key!")
        
        qs = out_cfg["generated_questions"]
        self.assertEqual(len(qs), 2)
        for q in qs:
            self.assertNotIn("correct", q, "Candidate question must not have 'correct'!")
            self.assertNotIn("correct_answer", q, "Candidate question must not have 'correct_answer'!")
            self.assertNotIn("answer", q, "Candidate question must not have 'answer'!")
            self.assertNotIn("explanation", q, "Candidate question must not have 'explanation'!")
            # Verify safe fields remain intact
            self.assertIn("id", q)
            self.assertIn("question", q)
            self.assertIn("marks", q)
            self.assertIn("difficulty", q)

        # 3. Database ORM isolation verification: ORM object MUST NOT be mutated!
        self.assertIn("answer_key", asm.config, "Original DB config must keep answer_key!")
        self.assertIn("correct", asm.config["generated_questions"][0], "Original DB config must keep correct index!")
        self.assertEqual(asm.config["generated_questions"][0]["correct"], 1)

    def test_sanitize_coding_removes_hidden_test_cases(self):
        raw_config = {
            "duration": 60,
            "generated_questions": [
                {
                    "id": 1,
                    "title": "Reverse String",
                    "description": "Reverse given string in place.",
                    "testCases": [
                        {
                            "id": 1,
                            "input": {"s": "hello"},
                            "expected": "olleh",
                            "is_hidden": False,
                            "explanation": "Sample test case"
                        },
                        {
                            "id": 2,
                            "input": {"s": "Hannah"},
                            "expected": "hannaH",
                            "is_hidden": True,
                            "explanation": "Secret edge case with capitalization"
                        },
                        {
                            "id": 3,
                            "input": {"s": "a" * 1000},
                            "expected": "a" * 1000,
                            "hidden": True
                        }
                    ]
                }
            ]
        }

        asm = models.Assessment(
            id=102,
            candidate_email="coder@example.com",
            type="coding",
            config=copy.deepcopy(raw_config),
            status="pending",
            score=0.0,
            question_source="manual",
            created_at=self.now
        )

        sanitized = sanitize_assessment_for_candidate(asm)

        out_tcs = sanitized.config["generated_questions"][0]["testCases"]
        # Only public test case should remain
        self.assertEqual(len(out_tcs), 1, "Only public test cases should be visible to candidate")
        self.assertEqual(out_tcs[0]["id"], 1)
        self.assertEqual(out_tcs[0]["input"], {"s": "hello"})
        self.assertEqual(out_tcs[0]["expected"], "olleh")

        # Hidden test cases must remain safe in original DB object
        self.assertEqual(len(asm.config["generated_questions"][0]["testCases"]), 3)

    def test_sanitize_dict_input_fallback(self):
        dict_asm = {
            "id": 103,
            "candidate_email": "dict@example.com",
            "type": "aptitude",
            "config": {
                "answer_key": {"1": 2},
                "questions": [
                    {"id": 1, "question": "Q1", "correct": 2}
                ]
            },
            "status": "pending",
            "score": 0.0,
            "created_at": self.now,
            "question_source": "ai"
        }

        sanitized = sanitize_assessment_for_candidate(dict_asm)
        self.assertNotIn("answer_key", sanitized.config)
        self.assertNotIn("correct", sanitized.config["questions"][0])
        self.assertIn("answer_key", dict_asm["config"], "Source dictionary must not be mutated")

    def test_sanitize_none_returns_none(self):
        self.assertIsNone(sanitize_assessment_for_candidate(None))


class TestPhase1LiveDatabase(unittest.TestCase):
    """Verifies that the live MySQL database has the migrated Phase 1 columns."""

    def test_live_mysql_columns(self):
        from sqlalchemy import inspect
        import database

        try:
            inspector = inspect(database.engine)
            # Verify job_descriptions columns
            jd_cols = {c["name"] for c in inspector.get_columns("job_descriptions")}
            for expected in [
                "role", "required_skills", "preferred_skills", "responsibilities",
                "experience_requirements", "specific_targets", "expected_achievements",
                "additional_requirements"
            ]:
                self.assertIn(expected, jd_cols, f"Column '{expected}' missing from live job_descriptions table")

            # Verify assessments columns
            asm_cols = {c["name"] for c in inspector.get_columns("assessments")}
            for expected in ["question_source", "submission_data", "evaluation_details"]:
                self.assertIn(expected, asm_cols, f"Column '{expected}' missing from live assessments table")
        except Exception as e:
            self.skipTest(f"Live database not available: {e}")


if __name__ == "__main__":
    unittest.main()

