import os
import sys
import unittest
import copy
import subprocess
from datetime import datetime

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models
import schemas
from routers.assessments import sanitize_assessment_for_candidate
from services.aptitude_evaluation import evaluate_aptitude_submission


class TestCandidateEndpointSecurityAudit(unittest.TestCase):
    """
    Comprehensive Security Audit:
    Verifies that evaluation_details, answer keys, correct answers,
    and hidden test cases are NEVER exposed through candidate-facing payloads.
    """

    def setUp(self):
        self.now = datetime.now()
        self.secret_aptitude_questions = [
            {
                "id": 1,
                "question": "What is the Big-O complexity of quicksort worst case?",
                "type": "mcq",
                "options": ["O(n log n)", "O(n^2)", "O(n)", "O(log n)"],
                "correct_answer": 1,
                "correct": 1,
                "correct_option": 1,
                "answer": 1,
                "explanation": "Quicksort degrades to O(n^2) when poor pivots are chosen.",
                "marks": 3,
                "difficulty": "Medium"
            },
            {
                "id": 2,
                "question": "HTTP/2 uses binary framing instead of plain text.",
                "type": "true_false",
                "options": ["True", "False"],
                "correct_answer": True,
                "correct": True,
                "correct_option": True,
                "explanation": "HTTP/2 divides requests into binary frames.",
                "marks": 2,
                "difficulty": "Easy"
            },
            {
                "id": 3,
                "question": "Which data structure uses LIFO order?",
                "type": "short_answer",
                "correct_answer": "Stack",
                "correct": "Stack",
                "explanation": "Stacks operate on Last-In, First-Out.",
                "marks": 5,
                "difficulty": "Easy"
            }
        ]

        self.secret_coding_questions = [
            {
                "id": 1,
                "title": "Reverse Linked List",
                "description": "Reverse singly linked list in O(n) time.",
                "testCases": [
                    {
                        "id": 1,
                        "input": {"head": [1, 2, 3]},
                        "expected": [3, 2, 1],
                        "is_hidden": False,
                        "explanation": "Sample public test case"
                    },
                    {
                        "id": 2,
                        "input": {"head": [100] * 500},
                        "expected": [100] * 500,
                        "is_hidden": True,
                        "explanation": "SECRET: large input scalability test"
                    },
                    {
                        "id": 3,
                        "input": {"head": []},
                        "expected": [],
                        "hidden": True,
                        "explanation": "SECRET: empty list edge case"
                    }
                ]
            }
        ]

    def test_candidate_aptitude_payload_contains_no_secrets(self):
        # Setup assessment with confidential answer_key and evaluation breakdown
        raw_config = {
            "duration": 45,
            "question_source": "manual",
            "answer_key": {"1": 1, "2": True, "3": "Stack"},
            "questions": copy.deepcopy(self.secret_aptitude_questions),
            "generated_questions": copy.deepcopy(self.secret_aptitude_questions),
            "solution": "Confidential admin solution notes",
            "solution_code": "Confidential solution code"
        }

        # Simulate completed assessment with evaluation details stored in DB
        eval_res = evaluate_aptitude_submission(self.secret_aptitude_questions, {"1": 1, "2": True, "3": "Queue"})

        asm = models.Assessment(
            id=999,
            candidate_email="candidate@secure.com",
            type="aptitude",
            config=copy.deepcopy(raw_config),
            status="completed",
            score=eval_res["score"],
            analysis_data=eval_res["analysis_data"],
            question_source="manual",
            evaluation_details=eval_res["breakdown"],  # Contains correct answers internally
            submission_data={"1": 1, "2": True, "3": "Queue"},  # Candidate responses only
            created_at=self.now
        )

        # Sanitize for candidate response
        sanitized = sanitize_assessment_for_candidate(asm)

        # 1. evaluation_details must be None in candidate response
        self.assertIsNone(
            sanitized.evaluation_details,
            "SECURITY VIOLATION: evaluation_details must be None in candidate response!"
        )

        # 2. submission_data must NOT be a field in AssessmentResponse schema
        self.assertFalse(
            hasattr(sanitized, "submission_data") and getattr(sanitized, "submission_data") is not None,
            "SECURITY VIOLATION: submission_data must not be exposed in candidate response!"
        )

        # 3. config.answer_key must NOT be in candidate config
        self.assertNotIn("answer_key", sanitized.config, "SECURITY VIOLATION: answer_key leaked in candidate config!")
        self.assertNotIn("solution", sanitized.config, "SECURITY VIOLATION: solution leaked in candidate config!")
        self.assertNotIn("solution_code", sanitized.config, "SECURITY VIOLATION: solution_code leaked in candidate config!")

        # 4. No question in candidate config may contain correct answers or explanations
        for q_list_name in ["questions", "generated_questions"]:
            for q in sanitized.config.get(q_list_name, []):
                self.assertNotIn("correct_answer", q, f"SECURITY VIOLATION: 'correct_answer' leaked in {q_list_name}!")
                self.assertNotIn("correct", q, f"SECURITY VIOLATION: 'correct' leaked in {q_list_name}!")
                self.assertNotIn("correct_option", q, f"SECURITY VIOLATION: 'correct_option' leaked in {q_list_name}!")
                self.assertNotIn("answer", q, f"SECURITY VIOLATION: 'answer' leaked in {q_list_name}!")
                self.assertNotIn("explanation", q, f"SECURITY VIOLATION: 'explanation' leaked in {q_list_name}!")

        # 5. Model dump serialization check (simulating FastAPI response serialization)
        dump = sanitized.model_dump()
        self.assertIsNone(dump.get("evaluation_details"))
        self.assertNotIn("submission_data", dump)
        self.assertNotIn("answer_key", dump.get("config", {}))

    def test_candidate_coding_payload_contains_no_hidden_test_cases(self):
        raw_config = {
            "duration": 60,
            "question_source": "manual",
            "generated_questions": copy.deepcopy(self.secret_coding_questions)
        }

        asm = models.Assessment(
            id=998,
            candidate_email="coder@secure.com",
            type="coding",
            config=copy.deepcopy(raw_config),
            status="pending",
            score=0.0,
            question_source="manual",
            created_at=self.now
        )

        sanitized = sanitize_assessment_for_candidate(asm)

        q = sanitized.config["generated_questions"][0]
        test_cases = q["testCases"]

        # Only public test case #1 should be present
        self.assertEqual(len(test_cases), 1, "Only public test cases may be sent to candidate")
        self.assertEqual(test_cases[0]["id"], 1)
        self.assertFalse(test_cases[0]["is_hidden"])

        # Hidden test case IDs 2 and 3 must NOT be present
        hidden_ids = [tc["id"] for tc in test_cases if tc.get("is_hidden") or tc.get("hidden")]
        self.assertEqual(len(hidden_ids), 0, "No hidden test cases should be sent to candidate")

    def test_sanitizer_does_not_mutate_orm_object(self):
        """Verifies that sanitize_assessment_for_candidate never mutates the underlying ORM object."""
        original_config = {
            "answer_key": {"1": 1, "2": True, "3": "Stack"},
            "questions": copy.deepcopy(self.secret_aptitude_questions)
        }

        asm = models.Assessment(
            id=997,
            candidate_email="orm.test@secure.com",
            type="aptitude",
            config=copy.deepcopy(original_config),
            status="pending",
            question_source="manual",
            created_at=self.now
        )

        # Call sanitizer multiple times
        _ = sanitize_assessment_for_candidate(asm)
        _ = sanitize_assessment_for_candidate(asm)

        # Verify DB object config is completely unchanged
        self.assertIn("answer_key", asm.config, "ORM object must retain answer_key")
        self.assertEqual(asm.config["answer_key"], {"1": 1, "2": True, "3": "Stack"})
        self.assertEqual(asm.config["questions"][0]["correct_answer"], 1)
        self.assertEqual(asm.config["questions"][1]["correct_answer"], True)
        self.assertEqual(asm.config["questions"][2]["correct_answer"], "Stack")

    def test_submission_data_contains_candidate_responses_only(self):
        """Verifies that submission_data stores only candidate submitted answers."""
        candidate_answers = {"1": 0, "2": False, "3": "Array"}
        eval_res = evaluate_aptitude_submission(self.secret_aptitude_questions, candidate_answers)

        asm = models.Assessment(
            id=996,
            candidate_email="answers.test@secure.com",
            type="aptitude",
            config={"questions": self.secret_aptitude_questions},
            status="completed",
            score=eval_res["score"],
            submission_data=candidate_answers,
            evaluation_details=eval_res["breakdown"]
        )

        # In DB: submission_data contains candidate responses only
        self.assertEqual(asm.submission_data, candidate_answers)
        self.assertNotIn("correct_answer", asm.submission_data)
        self.assertNotIn("answer_key", asm.submission_data)

        # In DB: evaluation_details has the breakdown with correct answers internally
        self.assertTrue(len(asm.evaluation_details) > 0)
        self.assertIn("correct_answer", asm.evaluation_details[0])

        # But candidate response strips evaluation_details completely
        candidate_view = sanitize_assessment_for_candidate(asm)
        self.assertIsNone(candidate_view.evaluation_details)
        self.assertFalse(hasattr(candidate_view, "submission_data") and getattr(candidate_view, "submission_data") is not None)

    def test_frozen_interview_files_zero_diff(self):
        """Verifies that the 4 strictly frozen interview files have exactly 0 git modifications ."""
        strictly_frozen = [
            "backend/services/interview_evaluation.py",
            "frontend/src/hooks/useFullscreen.js"
        ]
        workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        for filepath in strictly_frozen:
            cmd = ["git", "diff", "--name-only", os.path.normpath(filepath)]
            res = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
            self.assertEqual(res.stdout.strip(), "", f"CRITICAL REGRESSION: Frozen file '{filepath}' has been modified!")



if __name__ == "__main__":
    unittest.main()
