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
from services.aptitude_evaluation import (
    normalize_boolean,
    normalize_text,
    validate_manual_aptitude_questions,
    evaluate_aptitude_submission
)


class TestPhase2ManualQuestionValidation(unittest.TestCase):
    """Tests manual aptitude question creation and validation across all types."""

    def test_manual_mcq_creation(self):
        questions = [
            {
                "question": "What is the primary key in a relational database?",
                "type": "mcq",
                "options": ["Unique identifier", "Foreign key", "View index", "Cache entry"],
                "correct_answer": 0,
                "marks": 2,
                "difficulty": "Easy"
            }
        ]
        validated = validate_manual_aptitude_questions(questions)
        self.assertEqual(len(validated), 1)
        q = validated[0]
        self.assertEqual(q["type"], "mcq")
        self.assertEqual(q["correct_answer"], 0)
        self.assertEqual(q["correct"], 0)
        self.assertEqual(q["marks"], 2)
        self.assertEqual(q["difficulty"], "Easy")
        self.assertEqual(len(q["options"]), 4)

    def test_manual_true_false_creation(self):
        questions = [
            {
                "question": "TCP is a connection-oriented protocol.",
                "type": "true_false",
                "correct_answer": True,
                "marks": 1,
                "difficulty": "Easy"
            },
            {
                "question": "UDP guarantees packet delivery.",
                "type": "true_false",
                "correct_answer": "false",
                "marks": 3,
                "difficulty": "Medium"
            }
        ]
        validated = validate_manual_aptitude_questions(questions)
        self.assertEqual(len(validated), 2)
        self.assertIs(validated[0]["correct_answer"], True)
        self.assertIs(validated[1]["correct_answer"], False)
        self.assertEqual(validated[0]["options"], ["True", "False"])
        self.assertEqual(validated[1]["options"], ["True", "False"])
        self.assertEqual(validated[1]["marks"], 3)

    def test_manual_short_answer_creation(self):
        questions = [
            {
                "question": "Name the protocol used to securely transfer web pages.",
                "type": "short_answer",
                "correct_answer": "HTTPS",
                "marks": 4,
                "difficulty": "Hard"
            }
        ]
        validated = validate_manual_aptitude_questions(questions)
        self.assertEqual(len(validated), 1)
        q = validated[0]
        self.assertEqual(q["type"], "short_answer")
        self.assertEqual(q["correct_answer"], "HTTPS")
        self.assertIsNone(q["options"])
        self.assertEqual(q["marks"], 4)
        self.assertEqual(q["difficulty"], "Hard")

    def test_invalid_questions_raise_validation_error(self):
        # 1. Empty questions list
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([])

        # 2. Missing question text
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"type": "mcq", "options": ["A", "B"], "correct_answer": 0}])

        # 3. Invalid question type
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"question": "Q1", "type": "essay"}])

        # 4. MCQ with fewer than 2 options
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"question": "Q1", "type": "mcq", "options": ["Only one"], "correct_answer": 0}])

        # 5. MCQ with out-of-bounds correct answer index
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"question": "Q1", "type": "mcq", "options": ["A", "B"], "correct_answer": 5}])

        # 6. True/False with non-boolean answer
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"question": "Q1", "type": "true_false", "correct_answer": "maybe"}])

        # 7. Short Answer with empty answer
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"question": "Q1", "type": "short_answer", "correct_answer": "   "}])

        # 8. Negative or zero marks
        with self.assertRaises(ValueError):
            validate_manual_aptitude_questions([{"question": "Q1", "type": "short_answer", "correct_answer": "ans", "marks": 0}])

    def test_difficulty_and_marks_defaults(self):
        questions = [
            {
                "question": "What is Python?",
                "type": "short_answer",
                "correct_answer": "Programming language"
            }
        ]
        validated = validate_manual_aptitude_questions(questions)
        self.assertEqual(validated[0]["marks"], 1, "Default marks should be 1")
        self.assertEqual(validated[0]["difficulty"], "Medium", "Default difficulty should be Medium")


class TestPhase2EvaluationLogic(unittest.TestCase):
    """Tests evaluation logic for MCQ, True/False, Short Answer, variable marks, and scores."""

    def test_mcq_evaluation(self):
        questions = [
            {
                "id": 1,
                "type": "mcq",
                "question": "Select 1",
                "options": ["A", "B", "C"],
                "correct_answer": 1,
                "marks": 2
            }
        ]

        # Correct answer
        res_correct = evaluate_aptitude_submission(questions, {"1": 1})
        self.assertEqual(res_correct["earned_marks"], 2)
        self.assertEqual(res_correct["correct_count"], 1)
        self.assertEqual(res_correct["score"], 10.0)
        self.assertTrue(res_correct["breakdown"][0]["is_correct"])

        # Incorrect answer
        res_wrong = evaluate_aptitude_submission(questions, {"1": 0})
        self.assertEqual(res_wrong["earned_marks"], 0)
        self.assertEqual(res_wrong["correct_count"], 0)
        self.assertEqual(res_wrong["score"], 0.0)
        self.assertFalse(res_wrong["breakdown"][0]["is_correct"])

    def test_true_false_evaluation(self):
        questions = [
            {
                "id": 1,
                "type": "true_false",
                "question": "Earth is round",
                "correct_answer": True,
                "marks": 3
            },
            {
                "id": 2,
                "type": "true_false",
                "question": "2 + 2 = 5",
                "correct_answer": False,
                "marks": 2
            }
        ]

        # Both correct with varied formats (bool and string)
        res = evaluate_aptitude_submission(questions, {"1": "true", "2": False})
        self.assertEqual(res["earned_marks"], 5)
        self.assertEqual(res["correct_count"], 2)
        self.assertEqual(res["score"], 10.0)

        # One correct, one incorrect
        res2 = evaluate_aptitude_submission(questions, {"1": False, "2": "false"})
        self.assertEqual(res2["earned_marks"], 2) # Only Q2 correct
        self.assertEqual(res2["correct_count"], 1)
        self.assertEqual(res2["score"], 4.0) # (2/5) * 10 = 4.0

    def test_short_answer_evaluation(self):
        questions = [
            {
                "id": 1,
                "type": "short_answer",
                "question": "Binary search time complexity?",
                "correct_answer": "O(log n)|O(logn)",
                "marks": 5
            }
        ]

        # Case-insensitive and trimmed match
        res_match1 = evaluate_aptitude_submission(questions, {"1": "  o(log n)  "})
        self.assertTrue(res_match1["breakdown"][0]["is_correct"])
        self.assertEqual(res_match1["earned_marks"], 5)

        # Alternate pipe-separated match
        res_match2 = evaluate_aptitude_submission(questions, {"1": "O(logn)"})
        self.assertTrue(res_match2["breakdown"][0]["is_correct"])
        self.assertEqual(res_match2["earned_marks"], 5)

        # Incorrect answer
        res_wrong = evaluate_aptitude_submission(questions, {"1": "O(n)"})
        self.assertFalse(res_wrong["breakdown"][0]["is_correct"])
        self.assertEqual(res_wrong["earned_marks"], 0)

    def test_variable_marks_weighted_score_calculation(self):
        # 3 questions with marks 2, 3, 5 -> Total marks = 10
        questions = [
            {"id": 1, "type": "mcq", "correct_answer": 0, "marks": 2},
            {"id": 2, "type": "true_false", "correct_answer": True, "marks": 3},
            {"id": 3, "type": "short_answer", "correct_answer": "FastAPI", "marks": 5}
        ]

        # Candidate gets Q1 and Q2 right, Q3 wrong
        answers = {"1": 0, "2": True, "3": "Django"}
        res = evaluate_aptitude_submission(questions, answers)

        self.assertEqual(res["total_marks"], 10)
        self.assertEqual(res["earned_marks"], 5) # 2 + 3 = 5
        self.assertEqual(res["correct_count"], 2)
        self.assertEqual(res["total_questions"], 3)
        self.assertEqual(res["score"], 5.0) # (5 / 10) * 10 = 5.0
        self.assertEqual(res["analysis_data"]["score_percentage"], 50.0)

    def test_existing_ai_aptitude_regression(self):
        """Regression test: AI-generated MCQs (legacy format with only 'correct' and no 'type') evaluate accurately."""
        ai_generated_questions = [
            {
                "id": 1,
                "question": "What is 10 + 20?",
                "options": ["10", "20", "30", "40"],
                "correct": 2 # Index 2 = "30"
            },
            {
                "id": 2,
                "question": "What is 5 * 5?",
                "options": ["20", "25", "30", "35"],
                "correct": 1 # Index 1 = "25"
            }
        ]

        # Candidate answers Q1 right (2), Q2 wrong (0)
        answers = {"1": 2, "2": 0}
        res = evaluate_aptitude_submission(ai_generated_questions, answers)

        self.assertEqual(res["correct_count"], 1)
        self.assertEqual(res["total_questions"], 2)
        self.assertEqual(res["earned_marks"], 1)
        self.assertEqual(res["total_marks"], 2)
        self.assertEqual(res["score"], 5.0) # (1/2) * 10 = 5.0


class TestPhase2CandidateSecurity(unittest.TestCase):
    """Verifies that candidate APIs NEVER expose answer keys or correct answers for manual aptitude questions."""

    def test_candidate_receives_zero_evaluation_secrets(self):
        manual_questions = [
            {
                "id": 1,
                "question": "Which sorting algorithm has O(n log n) worst-case time?",
                "type": "mcq",
                "options": ["Merge Sort", "Quick Sort", "Bubble Sort", "Insertion Sort"],
                "correct_answer": 0,
                "correct": 0,
                "explanation": "Merge sort always runs in O(n log n).",
                "marks": 3,
                "difficulty": "Medium"
            },
            {
                "id": 2,
                "question": "A stack is a FIFO data structure.",
                "type": "true_false",
                "options": ["True", "False"],
                "correct_answer": False,
                "correct": False,
                "explanation": "A stack is LIFO.",
                "marks": 2,
                "difficulty": "Easy"
            },
            {
                "id": 3,
                "question": "What does SQL stand for?",
                "type": "short_answer",
                "correct_answer": "Structured Query Language",
                "correct": "Structured Query Language",
                "explanation": "SQL is Structured Query Language.",
                "marks": 5,
                "difficulty": "Easy"
            }
        ]

        raw_config = {
            "duration": 45,
            "question_source": "manual",
            "answer_key": {"1": 0, "2": False, "3": "Structured Query Language"},
            "questions": copy.deepcopy(manual_questions),
            "generated_questions": copy.deepcopy(manual_questions)
        }

        asm = models.Assessment(
            id=201,
            candidate_email="test.candidate@domain.com",
            type="aptitude",
            config=copy.deepcopy(raw_config),
            status="pending",
            question_source="manual",
            created_at=datetime.now()
        )

        sanitized = sanitize_assessment_for_candidate(asm)

        # Candidate config must NOT contain answer_key
        self.assertNotIn("answer_key", sanitized.config)

        # Check all questions in candidate response
        for q_list_key in ["questions", "generated_questions"]:
            candidate_qs = sanitized.config.get(q_list_key, [])
            for q in candidate_qs:
                self.assertNotIn("correct_answer", q, f"Secret 'correct_answer' found in {q_list_key}!")
                self.assertNotIn("correct", q, f"Secret 'correct' found in {q_list_key}!")
                self.assertNotIn("answer", q, f"Secret 'answer' found in {q_list_key}!")
                self.assertNotIn("explanation", q, f"Secret 'explanation' found in {q_list_key}!")

                # Ensure candidate still receives questions, options, marks, difficulty
                self.assertIn("question", q)
                self.assertIn("type", q)
                self.assertIn("marks", q)
                self.assertIn("difficulty", q)

        # Verify DB object retained full answer keys
        self.assertIn("answer_key", asm.config)
        self.assertEqual(asm.config["questions"][0]["correct_answer"], 0)
        self.assertEqual(asm.config["questions"][1]["correct_answer"], False)
        self.assertEqual(asm.config["questions"][2]["correct_answer"], "Structured Query Language")


class TestPhase2FrozenInterviewIntegrity(unittest.TestCase):
    """Verifies that all frozen interview files have exactly 0 git diff modifications."""

    def test_frozen_interview_files_are_untouched(self):
        """Verifies that the 4 strictly frozen interview files have 0 git changes and VapiInterview has only fullscreen changes."""
        strictly_frozen_files = [
            "backend/routers/interview.py",
            "backend/services/vapi_service.py",
            "backend/services/interview_evaluation.py",
            "frontend/src/hooks/useFullscreen.js"
        ]

        workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        for filepath in strictly_frozen_files:
            rel_path = os.path.normpath(filepath)
            cmd = ["git", "diff", "--name-only", rel_path]
            result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
            self.assertEqual(
                result.stdout.strip(),
                "",
                f"VIOLATION: Frozen file '{filepath}' has been modified!"
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
