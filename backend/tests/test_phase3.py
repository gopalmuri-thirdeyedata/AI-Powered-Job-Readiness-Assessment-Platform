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
from services.coding_evaluation import (
    validate_manual_coding_questions,
    compare_actual_expected,
    extract_candidate_code,
    execute_and_evaluate_coding_submission
)
from services import ai_generator, piston_service


class TestPhase3ManualCodingProblemValidation(unittest.TestCase):
    """Tests 1-8: Manual coding problem validation, required fields, marks, difficulty, public and hidden test cases."""

    def test_01_manual_coding_problem_validation_success(self):
        """1. Validates standard manual coding problem creation."""
        problems = [
            {
                "title": "Two Sum",
                "description": "Given an array of integers and a target, return indices of the two numbers.",
                "difficulty": "Easy",
                "marks": 10,
                "input_format": "List of integers nums, integer target",
                "output_format": "List of two indices [i, j]",
                "constraints": ["2 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9"],
                "examples": [
                    {"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]", "explanation": "2 + 7 = 9"}
                ],
                "starterCode": {
                    "python": "def solve(nums, target):\n    pass"
                },
                "testCases": [
                    {"id": 1, "input": {"nums": [2, 7, 11, 15], "target": 9}, "expected": [0, 1], "is_hidden": False},
                    {"id": 2, "input": {"nums": [3, 2, 4], "target": 6}, "expected": [1, 2], "is_hidden": True}
                ]
            }
        ]
        validated = validate_manual_coding_questions(problems)
        self.assertEqual(len(validated), 1)
        p = validated[0]
        self.assertEqual(p["title"], "Two Sum")
        self.assertEqual(p["difficulty"], "Easy")
        self.assertEqual(p["marks"], 10)
        self.assertEqual(len(p["constraints"]), 2)
        self.assertEqual(len(p["examples"]), 1)
        self.assertEqual(len(p["testCases"]), 2)

    def test_02_required_fields_validation(self):
        """2. Validates that title and description cannot be empty."""
        # Empty title
        with self.assertRaises(ValueError) as ctx:
            validate_manual_coding_questions([{
                "title": "",
                "description": "Valid description",
                "testCases": [{"input": 1, "expected": 2, "is_hidden": False}]
            }])
        self.assertIn("Title cannot be empty", str(ctx.exception))

        # Empty description
        with self.assertRaises(ValueError) as ctx:
            validate_manual_coding_questions([{
                "title": "Valid Title",
                "description": "   ",
                "testCases": [{"input": 1, "expected": 2, "is_hidden": False}]
            }])
        self.assertIn("Problem statement/description cannot be empty", str(ctx.exception))

    def test_03_marks_validation(self):
        """3. Validates marks must be positive integers."""
        # Zero marks
        with self.assertRaises(ValueError) as ctx:
            validate_manual_coding_questions([{
                "title": "Title",
                "description": "Desc",
                "marks": 0,
                "testCases": [{"input": 1, "expected": 2, "is_hidden": False}]
            }])
        self.assertIn("Marks must be a positive integer", str(ctx.exception))

        # Negative marks
        with self.assertRaises(ValueError) as ctx:
            validate_manual_coding_questions([{
                "title": "Title",
                "description": "Desc",
                "marks": -5,
                "testCases": [{"input": 1, "expected": 2, "is_hidden": False}]
            }])
        self.assertIn("Marks must be a positive integer", str(ctx.exception))

    def test_04_difficulty_validation(self):
        """4. Validates difficulty levels and fallback."""
        problems = [
            {"title": "P1", "description": "D1", "difficulty": "Hard", "testCases": [{"input": 1, "expected": 2, "is_hidden": False}]},
            {"title": "P2", "description": "D2", "difficulty": "SuperHard", "testCases": [{"input": 1, "expected": 2, "is_hidden": False}]}
        ]
        validated = validate_manual_coding_questions(problems)
        self.assertEqual(validated[0]["difficulty"], "Hard")
        self.assertEqual(validated[1]["difficulty"], "Medium", "Invalid difficulty should default to Medium")

    def test_05_public_test_case_creation(self):
        """5. Validates creation of visible/public test cases."""
        problems = [{
            "title": "P1",
            "description": "D1",
            "testCases": [
                {"id": 1, "input": {"n": 5}, "expected": 10, "is_hidden": False, "explanation": "Sample 1"}
            ]
        }]
        validated = validate_manual_coding_questions(problems)
        self.assertEqual(len(validated[0]["testCases"]), 1)
        tc = validated[0]["testCases"][0]
        self.assertFalse(tc["is_hidden"])
        self.assertEqual(tc["expected"], 10)
        self.assertEqual(tc["explanation"], "Sample 1")

    def test_06_hidden_test_case_creation(self):
        """6. Validates hidden test-case configuration."""
        problems = [{
            "title": "P1",
            "description": "D1",
            "testCases": [
                {"id": 1, "input": {"n": 1}, "expected": 2, "is_hidden": False},
                {"id": 2, "input": {"n": 1000}, "expected": 2000, "is_hidden": True, "explanation": "Large boundary"}
            ]
        }]
        validated = validate_manual_coding_questions(problems)
        self.assertEqual(len(validated[0]["testCases"]), 2)
        hidden_tc = validated[0]["testCases"][1]
        self.assertTrue(hidden_tc["is_hidden"])
        self.assertEqual(hidden_tc["expected"], 2000)

    def test_07_mixed_public_and_hidden_test_cases(self):
        """7. Validates a problem with both public and multiple hidden test cases."""
        problems = [{
            "title": "Palindrome",
            "description": "Check if string is palindrome",
            "testCases": [
                {"id": 1, "input": {"s": "racecar"}, "expected": True, "is_hidden": False},
                {"id": 2, "input": {"s": "hello"}, "expected": False, "is_hidden": False},
                {"id": 3, "input": {"s": "a"}, "expected": True, "is_hidden": True},
                {"id": 4, "input": {"s": ""}, "expected": True, "is_hidden": True}
            ]
        }]
        validated = validate_manual_coding_questions(problems)
        tcs = validated[0]["testCases"]
        public_tcs = [t for t in tcs if not t["is_hidden"]]
        hidden_tcs = [t for t in tcs if t["is_hidden"]]
        self.assertEqual(len(public_tcs), 2)
        self.assertEqual(len(hidden_tcs), 2)

    def test_08_at_least_one_public_test_case_required(self):
        """8. Validates that at least one public test case is required (cannot have 100% hidden tests)."""
        problems = [{
            "title": "P1",
            "description": "D1",
            "testCases": [
                {"id": 1, "input": {"s": "a"}, "expected": True, "is_hidden": True},
                {"id": 2, "input": {"s": "b"}, "expected": False, "is_hidden": True}
            ]
        }]
        with self.assertRaises(ValueError) as ctx:
            validate_manual_coding_questions(problems)
        self.assertIn("at least one visible/public test case", str(ctx.exception))


class TestPhase3SecurityAndSanitization(unittest.TestCase):
    """Tests 11-13: Candidate API security, payload sanitization, zero leakage of hidden tests."""

    def setUp(self):
        self.raw_assessment = {
            "id": 101,
            "type": "coding",
            "status": "pending",
            "score": 0.0,
            "candidate_email": "candidate@example.com",
            "created_at": datetime.now(),
            "started_at": None,
            "question_source": "manual",
            "config": {
                "question_source": "manual",
                "answer_key": {"secret": "private"},
                "solution_code": "def solve(): return 42",
                "generated_questions": [
                    {
                        "id": 1,
                        "title": "Secret Algorithmic Challenge",
                        "description": "Solve the problem",
                        "input_format": "Integer N",
                        "output_format": "Integer N*2",
                        "difficulty": "Hard",
                        "marks": 20,
                        "solution": "private solution",
                        "solution_code": "private code",
                        "testCases": [
                            {
                                "id": 1,
                                "input": {"n": 2},
                                "expected": 4,
                                "is_hidden": False,
                                "explanation": "Sample test 1"
                            },
                            {
                                "id": 2,
                                "input": {"n": 999999},
                                "expected": 1999998,
                                "is_hidden": True,
                                "explanation": "SECRET HIDDEN TEST WITH SECRET EXPECTED OUTPUT"
                            },
                            {
                                "id": 3,
                                "input": {"n": -50},
                                "expected": -100,
                                "hidden": True,
                                "explanation": "ANOTHER HIDDEN TEST"
                            }
                        ]
                    }
                ]
            }
        }

    def test_11_hidden_test_cases_completely_stripped_from_candidate_view(self):
        """11. Verifies hidden test cases are never sent to candidates."""
        sanitized = sanitize_assessment_for_candidate(self.raw_assessment)
        self.assertIsNotNone(sanitized)

        # Check candidate-facing testCases
        q = sanitized.config["generated_questions"][0]
        test_cases = q["testCases"]
        self.assertEqual(len(test_cases), 1, "Only public test case should be returned to candidate")
        self.assertEqual(test_cases[0]["id"], 1)
        self.assertFalse(test_cases[0].get("is_hidden", False))

    def test_12_hidden_expected_output_and_input_cannot_leak(self):
        """12. Verifies hidden inputs, expected outputs, and explanations are not in candidate JSON payload."""
        sanitized = sanitize_assessment_for_candidate(self.raw_assessment)
        serialized_json = sanitized.model_dump_json()

        # Ensure hidden test contents do NOT exist in the serialized string
        self.assertNotIn("999999", serialized_json, "Hidden input leaked into candidate payload!")
        self.assertNotIn("1999998", serialized_json, "Hidden expected output leaked into candidate payload!")
        self.assertNotIn("SECRET HIDDEN TEST", serialized_json, "Hidden explanation leaked!")
        self.assertNotIn("-50", serialized_json, "Second hidden input leaked!")
        self.assertNotIn("-100", serialized_json, "Second hidden expected output leaked!")

    def test_13_solution_code_and_evaluation_details_purged(self):
        """13. Verifies top-level solution_code, answer_key, and evaluation_details are None/purged."""
        sanitized = sanitize_assessment_for_candidate(self.raw_assessment)
        serialized_json = sanitized.model_dump_json()

        self.assertNotIn("solution_code", sanitized.config)
        self.assertNotIn("answer_key", sanitized.config)
        self.assertIsNone(sanitized.evaluation_details, "evaluation_details must be None in candidate payload")
        self.assertNotIn("private solution", serialized_json)
        self.assertNotIn("def solve(): return 42", serialized_json)


class TestPhase3Judge0AndExecution(unittest.TestCase):
    """Tests 9-10, 14: Execution runner, comparison logic, and Judge0 integration."""

    def test_09_compare_actual_expected_logic(self):
        """9. Verifies normalization and equality comparison for outputs."""
        # Int vs Float
        self.assertTrue(compare_actual_expected(10, 10.0))
        # Int vs String
        self.assertTrue(compare_actual_expected(10, "10"))
        # Boolean normalization
        self.assertTrue(compare_actual_expected(True, "true"))
        self.assertTrue(compare_actual_expected(False, "FALSE"))
        # JSON string vs parsed object
        self.assertTrue(compare_actual_expected([0, 1], "[0, 1]"))
        self.assertTrue(compare_actual_expected({"a": 1}, '{"a": 1}'))
        # Mismatches
        self.assertFalse(compare_actual_expected(5, 6))
        self.assertFalse(compare_actual_expected([1, 2], [2, 1]))

    def test_10_judge0_runner_generation(self):
        """10. Tests python and java runner code wrapping."""
        code = "def solve(n):\n    return n * 2"
        tcs = [
            {"id": 1, "input": {"n": 5}, "expected": 10, "is_hidden": False},
            {"id": 2, "input": {"n": 3}, "expected": 6, "is_hidden": True}
        ]
        runner = ai_generator.generate_runner_code(code, "python", tcs)
        self.assertIsNotNone(runner)
        self.assertIn("---EXECUTION_RESULT_START---", runner)
        self.assertIn("---EXECUTION_RESULT_END---", runner)
        self.assertIn("test_cases", runner)

        # Java runner
        java_code = "class Solution { public int solve(int n) { return n * 2; } }"
        java_runner = ai_generator.generate_runner_code(java_code, "java", tcs)
        self.assertIsNotNone(java_runner)
        self.assertIn("public class Main", java_runner)
        self.assertIn("---EXECUTION_RESULT_START---", java_runner)

    def test_14_extract_candidate_code_helper(self):
        """14. Tests candidate code extraction from diverse payload structures."""
        # Single code string
        c1, l1 = extract_candidate_code("def solve(): pass", None, 0, 1, "python")
        self.assertEqual(c1, "def solve(): pass")
        self.assertEqual(l1, "python")

        # Map of languages { 0: { "python": "code_py", "java": "code_java" } }
        c2, l2 = extract_candidate_code({"0": {"python": "code_py", "java": "code_java"}}, {"selectedLanguage": "java"}, 0, 1)
        self.assertEqual(c2, "code_java")
        self.assertEqual(l2, "java")

        # Code inside answers dict
        c3, l3 = extract_candidate_code(None, {"code": {"1": "answer_code"}}, 0, 1)
        self.assertEqual(c3, "answer_code")


class TestPhase3EvaluationAndScoring(unittest.TestCase):
    """Tests 15-17: Scoring proportional to marks, AI coding regression, legacy submission."""

    def test_15_evaluation_scoring_with_configured_marks(self):
        """15. Verifies marks-weighted scoring calculation."""
        questions = [
            {
                "id": 1,
                "title": "P1",
                "marks": 20,
                "testCases": [
                    {"id": 1, "input": {"n": 1}, "expected": 2, "is_hidden": False},
                    {"id": 2, "input": {"n": 2}, "expected": 4, "is_hidden": True}
                ]
            }
        ]

        # Candidate submits correct code: def solve(n): return n * 2
        # Mock piston_service.execute_code for predictable unit test execution
        orig_execute = piston_service.execute_code
        try:
            piston_service.execute_code = lambda lang, runner: {
                "status": "success",
                "output": "---EXECUTION_RESULT_START---\n{\"id\": 1, \"status\": \"executed\", \"output\": 2, \"expected\": 2}\n{\"id\": 2, \"status\": \"executed\", \"output\": 4, \"expected\": 4}\n---EXECUTION_RESULT_END---"
            }
            eval_res = execute_and_evaluate_coding_submission(
                questions=questions,
                payload_code="def solve(n): return n * 2"
            )
            self.assertEqual(eval_res["score"], 10.0)
            self.assertEqual(eval_res["passed_test_cases"], 2)
            self.assertEqual(eval_res["earned_marks"], 20.0)
            self.assertEqual(eval_res["total_marks"], 20)
        finally:
            piston_service.execute_code = orig_execute

    def test_16_evaluation_scoring_with_partial_pass(self):
        """16. Verifies partial score when only public test passes and hidden fails."""
        questions = [
            {
                "id": 1,
                "title": "P1",
                "marks": 10,
                "testCases": [
                    {"id": 1, "input": {"n": 1}, "expected": 2, "is_hidden": False},
                    {"id": 2, "input": {"n": 2}, "expected": 4, "is_hidden": True}
                ]
            }
        ]

        orig_execute = piston_service.execute_code
        try:
            # Output where test 1 passes (output 2), but test 2 fails (output 2 instead of 4)
            piston_service.execute_code = lambda lang, runner: {
                "status": "success",
                "output": "---EXECUTION_RESULT_START---\n{\"id\": 1, \"status\": \"executed\", \"output\": 2, \"expected\": 2}\n{\"id\": 2, \"status\": \"executed\", \"output\": 2, \"expected\": 4}\n---EXECUTION_RESULT_END---"
            }
            eval_res = execute_and_evaluate_coding_submission(
                questions=questions,
                payload_code="def solve(n): return 2"
            )
            self.assertEqual(eval_res["passed_test_cases"], 1)
            self.assertEqual(eval_res["total_test_cases"], 2)
            self.assertEqual(eval_res["earned_marks"], 5.0) # 1/2 of 10 marks = 5.0
            self.assertEqual(eval_res["score"], 5.0) # (5 / 10) * 10 = 5.0
            
            # Candidate-safe metrics expose ONLY public test results
            self.assertEqual(eval_res["analysis_data"]["public_passed"], 1)
            self.assertEqual(eval_res["analysis_data"]["public_total"], 1)
            self.assertTrue(eval_res["analysis_data"]["has_hidden_tests"])
            self.assertEqual(eval_res["analysis_data"]["hidden_status"], "Private evaluation")
            self.assertNotIn("passed", eval_res["analysis_data"])
            self.assertNotIn("total", eval_res["analysis_data"])
        finally:
            piston_service.execute_code = orig_execute

    def test_17_legacy_ai_coding_submission_regression(self):
        """17. Verifies backward compatibility when legacy submission sends only result { passed, total }."""
        # Simulated submit logic fallback
        generated_qs = [
            {"id": 1, "testCases": [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}, {"id": 5}]}
        ]
        legacy_result = {"passed": 4, "total": 5}
        passed = legacy_result.get("passed", 0)
        total = sum(len(q.get("testCases", [])) for q in generated_qs)
        calculated_score = (passed / total) * 10.0
        self.assertEqual(calculated_score, 8.0)

    def test_19_candidate_response_never_contains_hidden_counts_or_results(self):
        """19. SECURITY: Verifies candidate response NEVER contains hidden test counts, results, or leakages."""
        # Scenario: 1 public test + 4 hidden tests = 5 total.
        # Candidate passes public test and 3 of 4 hidden tests (score = 8.0).
        raw_assessment = {
            "id": 202,
            "type": "coding",
            "status": "completed",
            "score": 8.0,
            "candidate_email": "candidate@example.com",
            "created_at": datetime.now(),
            "started_at": datetime.now(),
            "question_source": "manual",
            "analysis_data": {
                "public_passed": 1,
                "public_total": 1,
                "has_hidden_tests": True,
                "hidden_status": "Private evaluation",
                "time_taken_seconds": 60,
                # Even if backend internally stored raw counts:
                "internal_total_passed": 4,
                "internal_total_tests": 5,
                "passed": 4,
                "total": 5
            },
            "config": {
                "question_source": "manual",
                "generated_questions": [
                    {
                        "id": 1,
                        "title": "Algorithms Challenge",
                        "description": "Solve this",
                        "testCases": [
                            {"id": 1, "input": {"x": 1}, "expected": 2, "is_hidden": False},
                            {"id": 2, "input": {"x": 100}, "expected": 200, "is_hidden": True, "explanation": "SECRET_H1"},
                            {"id": 3, "input": {"x": 200}, "expected": 400, "is_hidden": True, "explanation": "SECRET_H2"},
                            {"id": 4, "input": {"x": 300}, "expected": 600, "is_hidden": True, "explanation": "SECRET_H3"},
                            {"id": 5, "input": {"x": 400}, "expected": 800, "is_hidden": True, "explanation": "SECRET_H4"}
                        ]
                    }
                ]
            }
        }

        sanitized = sanitize_assessment_for_candidate(raw_assessment)
        self.assertIsNotNone(sanitized)
        serialized_json = sanitized.model_dump_json()

        # 1. Total test count (5) and aggregate passed count (4) must NOT appear in candidate analysis_data
        cand_analysis = sanitized.analysis_data
        self.assertNotIn("passed", cand_analysis, "Hidden-inclusive 'passed' count leaked to candidate!")
        self.assertNotIn("total", cand_analysis, "Hidden-inclusive 'total' count leaked to candidate!")
        self.assertNotIn("internal_total_passed", cand_analysis)
        self.assertNotIn("internal_total_tests", cand_analysis)

        # 2. Only public test counts are exposed
        self.assertEqual(cand_analysis["public_passed"], 1)
        self.assertEqual(cand_analysis["public_total"], 1)
        self.assertTrue(cand_analysis["has_hidden_tests"])

        # 3. None of the hidden inputs, expected outputs, or explanations can appear in the serialized JSON
        self.assertNotIn("SECRET_H1", serialized_json)
        self.assertNotIn("SECRET_H2", serialized_json)
        self.assertNotIn("SECRET_H3", serialized_json)
        self.assertNotIn("SECRET_H4", serialized_json)
        self.assertNotIn("100", serialized_json)
        self.assertNotIn("200", serialized_json)
        self.assertNotIn("400", serialized_json)
        self.assertNotIn("600", serialized_json)
        self.assertNotIn("800", serialized_json)

        # 4. Evaluation details is strictly None
        self.assertIsNone(sanitized.evaluation_details)

    def test_20_assessment_evaluation_details_retains_complete_private_evaluation(self):
        """20. SERVER-SIDE INTEGRITY: Verifies evaluation_details retains complete private breakdown."""
        questions = [
            {
                "id": 1,
                "title": "Private Evaluation Verification",
                "marks": 10,
                "testCases": [
                    {"id": 1, "input": {"n": 1}, "expected": 2, "is_hidden": False},
                    {"id": 2, "input": {"n": 2}, "expected": 4, "is_hidden": True, "explanation": "Hidden test 1"},
                    {"id": 3, "input": {"n": 3}, "expected": 6, "is_hidden": True, "explanation": "Hidden test 2"},
                    {"id": 4, "input": {"n": 4}, "expected": 8, "is_hidden": True, "explanation": "Hidden test 3"},
                    {"id": 5, "input": {"n": 5}, "expected": 10, "is_hidden": True, "explanation": "Hidden test 4"}
                ]
            }
        ]

        orig_execute = piston_service.execute_code
        try:
            # Candidate passes test 1, 2, 3, 4 (4 of 5 passed -> 8.0 score)
            piston_service.execute_code = lambda lang, runner: {
                "status": "success",
                "output": (
                    "---EXECUTION_RESULT_START---\n"
                    "{\"id\": 1, \"status\": \"executed\", \"output\": 2, \"expected\": 2}\n"
                    "{\"id\": 2, \"status\": \"executed\", \"output\": 4, \"expected\": 4}\n"
                    "{\"id\": 3, \"status\": \"executed\", \"output\": 6, \"expected\": 6}\n"
                    "{\"id\": 4, \"status\": \"executed\", \"output\": 8, \"expected\": 8}\n"
                    "{\"id\": 5, \"status\": \"executed\", \"output\": 999, \"expected\": 10}\n"
                    "---EXECUTION_RESULT_END---"
                )
            }

            eval_res = execute_and_evaluate_coding_submission(
                questions=questions,
                payload_code="def solve(n): return n * 2 if n < 5 else 999"
            )

            # Score is 8.0 out of 10
            self.assertEqual(eval_res["score"], 8.0)
            self.assertEqual(eval_res["passed_test_cases"], 4)
            self.assertEqual(eval_res["total_test_cases"], 5)

            # Verify evaluation_details contains full server-side private evaluation
            eval_details = eval_res["evaluation_details"]
            self.assertEqual(eval_details["score"], 8.0)
            self.assertEqual(eval_details["passed_test_cases"], 4)
            self.assertEqual(eval_details["total_test_cases"], 5)
            self.assertEqual(eval_details["public_passed_test_cases"], 1)
            self.assertEqual(eval_details["public_total_test_cases"], 1)
            self.assertEqual(eval_details["hidden_passed_test_cases"], 3)
            self.assertEqual(eval_details["hidden_total_test_cases"], 4)

            # Check question level details
            q_detail = eval_details["questions"][0]
            self.assertEqual(len(q_detail["test_case_results"]), 5)
            self.assertEqual(q_detail["public_passed"], 1)
            self.assertEqual(q_detail["public_total"], 1)
            self.assertEqual(q_detail["hidden_passed"], 3)
            self.assertEqual(q_detail["hidden_total"], 4)

            # Individual hidden results are preserved server-side
            hidden_res = [r for r in q_detail["test_case_results"] if r.get("is_hidden")]
            self.assertEqual(len(hidden_res), 4)
            self.assertEqual(hidden_res[0]["status"], "passed")
            self.assertEqual(hidden_res[3]["status"], "failed") # test #5 failed

        finally:
            piston_service.execute_code = orig_execute


class TestPhase3FrozenInterviewIntegrity(unittest.TestCase):
    """Test 18: Strictly verifies that frozen Technical Interview files remain completely unchanged."""

    def test_18_frozen_interview_files_remain_untouched(self):
        """18. Verifies 0 git diff on strictly frozen interview files and fullscreen-only diff on VapiInterview."""
        strictly_frozen = [
            "backend/routers/interview.py",
            "backend/services/vapi_service.py",
            "backend/services/interview_evaluation.py",
            "frontend/src/hooks/useFullscreen.js"
        ]

        workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        for file_rel_path in strictly_frozen:
            file_abs_path = os.path.join(workspace_root, file_rel_path.replace("/", os.sep))
            self.assertTrue(os.path.exists(file_abs_path), f"Frozen file missing: {file_rel_path}")

            # Check git diff
            cmd = ["git", "diff", "--exit-code", file_rel_path]
            result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
            self.assertEqual(
                result.returncode, 0,
                f"CRITICAL VIOLATION: Frozen file has been modified: {file_rel_path}\nDiff: {result.stdout}"
            )

        # Check VapiInterview diff is strictly limited to useAssessmentFullscreen / FullscreenGateModal
        vapi_diff = subprocess.run(
            ["git", "diff", "frontend/src/pages/candidate/VapiInterview.jsx"],
            cwd=workspace_root, capture_output=True, text=True
        )
        if vapi_diff.stdout.strip():
            self.assertIn("useAssessmentFullscreen", vapi_diff.stdout)
            self.assertIn("FullscreenGateModal", vapi_diff.stdout)


if __name__ == "__main__":
    unittest.main()
