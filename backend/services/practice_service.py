"""
DSA & Aptitude Topic-Wise Practice Service (Phase 4).
Provides structured problem solving for coding and aptitude topics.
Maintains test case confidentiality (hidden test cases never sent to client).
Evaluates submissions server-side via Judge0/Piston sandbox.
"""

from typing import List, Dict, Any, Optional
import json
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
from services import piston_service

# ==============================================================================
# CURATED STANDARD PRACTICE QUESTION CATALOG
# ==============================================================================

SEED_PRACTICE_QUESTIONS = [
    # DSA: Arrays
    {
        "topic": "Arrays",
        "category": "CODING",
        "difficulty": "Easy",
        "title": "Two Sum Target Check",
        "description": "Given an array of integers and a target number, return whether two numbers add up to the target.\n\nInput Format: First line contains comma-separated numbers. Second line contains the target integer.\nOutput Format: Print 'true' or 'false'.",
        "correct_answer": "true",
        "starter_code": {
            "python": "import sys\n\ndef solution():\n    lines = sys.stdin.read().splitlines()\n    if not lines:\n        return\n    nums = [int(x.strip()) for x in lines[0].split(',') if x.strip()]\n    target = int(lines[1].strip())\n\n    # Your logic here: print 'true' if two numbers add up to target, otherwise 'false'\n\nif __name__ == '__main__':\n    solution()\n",
        },
        "test_cases": [
            {"input": "2,7,11,15\n9", "expected_output": "true", "is_hidden": False},
            {"input": "3,2,4\n6", "expected_output": "true", "is_hidden": False},
            {"input": "3,3\n7", "expected_output": "false", "is_hidden": True},
            {"input": "1,5,9,20,35\n44", "expected_output": "true", "is_hidden": True}
        ],
        "explanation": "Hash Set complement lookup achieves O(N) time and O(N) auxiliary space."
    },

    # DSA: Strings
    {
        "topic": "Strings",
        "category": "CODING",
        "difficulty": "Easy",
        "title": "Valid Palindrome Check",
        "description": "Given a string, print 'true' if it is a palindrome (ignoring non-alphanumeric characters and case), otherwise 'false'.",
        "correct_answer": "true",
        "starter_code": {
            "python": "import sys, re\n\ndef solution():\n    raw = sys.stdin.read().strip()\n    # Your logic here: print 'true' if raw is a palindrome (ignoring case and non-alphanumerics), else 'false'\n\nif __name__ == '__main__':\n    solution()\n",
        },
        "test_cases": [
            {"input": "A man, a plan, a canal: Panama", "expected_output": "true", "is_hidden": False},
            {"input": "race a car", "expected_output": "false", "is_hidden": False},
            {"input": "Madam In Eden, I'm Adam", "expected_output": "true", "is_hidden": True},
            {"input": "No lemon, no melon", "expected_output": "true", "is_hidden": True}
        ],
        "explanation": "Two-pointer verification after stripping punctuation runs in O(N) linear time."
    },

    # DSA: Dynamic Programming
    {
        "topic": "Dynamic Programming",
        "category": "CODING",
        "difficulty": "Medium",
        "title": "Climbing Stairs Ways",
        "description": "You are climbing a staircase. It takes n steps to reach the top. Each time you can climb either 1 or 2 steps. Print in how many distinct ways you can climb to the top.",
        "correct_answer": "output",
        "starter_code": {
            "python": "import sys\n\ndef solution():\n    lines = sys.stdin.read().splitlines()\n    if not lines:\n        return\n    n = int(lines[0].strip())\n    # Your logic here: print the number of distinct ways to climb n stairs (1 or 2 steps at a time)\n\nif __name__ == '__main__':\n    solution()\n"
        },
        "test_cases": [
            {"input": "2", "expected_output": "2", "is_hidden": False},
            {"input": "3", "expected_output": "3", "is_hidden": False},
            {"input": "5", "expected_output": "8", "is_hidden": True},
            {"input": "8", "expected_output": "34", "is_hidden": True}
        ],
        "explanation": "Fibonacci state transition: ways(n) = ways(n-1) + ways(n-2) with O(1) space."
    },

    # Aptitude: Quantitative
    {
        "topic": "Quantitative",
        "category": "APTITUDE",
        "difficulty": "Easy",
        "title": "Time and Work: Combined Rate",
        "description": "Pipe A can fill a tank in 6 hours and Pipe B can fill it in 8 hours. If both pipes are opened together, how long will it take to fill the tank?",
        "options": [
            {"key": "A", "text": "3 hours 25 minutes"},
            {"key": "B", "text": "3 hours 25.7 minutes (24/7 hours)"},
            {"key": "C", "text": "4 hours 10 minutes"},
            {"key": "D", "text": "2 hours 48 minutes"}
        ],
        "correct_answer": "B",
        "explanation": "1/6 + 1/8 = 7/24 of the tank per hour. Total time = 24/7 hours = 3 hours and 25.7 minutes."
    },

    # Aptitude: Logical Reasoning
    {
        "topic": "Logical Reasoning",
        "category": "APTITUDE",
        "difficulty": "Medium",
        "title": "Syllogism: Truth Deductions",
        "description": "Statements:\n1. All engineers are innovators.\n2. Some innovators are developers.\n\nConclusions:\nI. Some developers are innovators.\nII. All engineers are developers.\n\nWhich conclusion(s) logically follow?",
        "options": [
            {"key": "A", "text": "Only conclusion I follows"},
            {"key": "B", "text": "Only conclusion II follows"},
            {"key": "C", "text": "Both I and II follow"},
            {"key": "D", "text": "Neither follows"}
        ],
        "correct_answer": "A",
        "explanation": "Statement 2 ('Some innovators are developers') directly converts to 'Some developers are innovators'. Conclusion II is not guaranteed."
    },

    # Aptitude: Verbal Ability
    {
        "topic": "Verbal Ability",
        "category": "APTITUDE",
        "difficulty": "Easy",
        "title": "Vocabulary in Technical Context",
        "description": "Choose the word closest in meaning to 'RESILIENT' in the context of distributed systems:",
        "options": [
            {"key": "A", "text": "Fragile"},
            {"key": "B", "text": "Fault-tolerant and able to recover quickly"},
            {"key": "C", "text": "Complex and multi-layered"},
            {"key": "D", "text": "Rigid and immutable"}
        ],
        "correct_answer": "B",
        "explanation": "Resilience in distributed architecture refers to high fault-tolerance and rapid self-healing."
    }
]


def ensure_practice_questions_seeded(db: Session) -> None:
    """Seeds the question bank if no questions exist in the database."""
    count = db.query(models.StudentPracticeQuestion).count()
    if count == 0:
        for q in SEED_PRACTICE_QUESTIONS:
            db_q = models.StudentPracticeQuestion(
                topic=q["topic"],
                category=q["category"],
                difficulty=q["difficulty"],
                title=q["title"],
                description=q["description"],
                options=q.get("options"),
                correct_answer=q["correct_answer"],
                starter_code=q.get("starter_code"),
                test_cases=q.get("test_cases"),
                explanation=q.get("explanation")
            )
            db.add(db_q)
        db.commit()
        return

    # Existing databases: refresh student-facing starter code of seeded coding questions so that
    # previously stored starters that exposed full solutions are replaced (no attempts are touched).
    seeded = {q["title"]: q["starter_code"] for q in SEED_PRACTICE_QUESTIONS if q["category"] == "CODING"}
    changed = False
    for row in db.query(models.StudentPracticeQuestion).filter(
        models.StudentPracticeQuestion.category == "CODING",
        models.StudentPracticeQuestion.title.in_(list(seeded))
    ).all():
        if row.starter_code != seeded[row.title]:
            row.starter_code = seeded[row.title]
            changed = True
    if changed:
        db.commit()


def get_topics_overview(student_profile_id: int, db: Session) -> List[Dict[str, Any]]:
    """
    Returns list of practice topics with total questions and student progress stats.
    """
    ensure_practice_questions_seeded(db)

    # Distinct topics
    topics_query = db.query(
        models.StudentPracticeQuestion.topic,
        models.StudentPracticeQuestion.category,
        func.count(models.StudentPracticeQuestion.id)
    ).group_by(
        models.StudentPracticeQuestion.topic,
        models.StudentPracticeQuestion.category
    ).all()

    # Student solved counts
    solved_counts = db.query(
        models.StudentPracticeAttempt.topic,
        func.count(models.StudentPracticeAttempt.id)
    ).filter(
        models.StudentPracticeAttempt.student_profile_id == student_profile_id,
        models.StudentPracticeAttempt.is_correct == True
    ).group_by(models.StudentPracticeAttempt.topic).all()

    solved_map = {topic: count for topic, count in solved_counts}

    result = []
    for topic, category, total_q in topics_query:
        solved = solved_map.get(topic, 0)
        result.append({
            "topic": topic,
            "category": category,
            "total_questions": total_q,
            "solved_count": solved,
            "completion_rate": round((solved / max(total_q, 1)) * 100.0, 1)
        })

    return result


def get_sanitized_questions(
    topic: Optional[str],
    category: Optional[str],
    student_profile_id: int,
    db: Session
) -> List[Dict[str, Any]]:
    """
    Retrieves questions for the requested topic/category.
    CRITICAL: Strips correct_answer and is_hidden test cases!
    """
    ensure_practice_questions_seeded(db)

    query = db.query(models.StudentPracticeQuestion)
    if topic:
        query = query.filter(models.StudentPracticeQuestion.topic == topic)
    if category:
        query = query.filter(models.StudentPracticeQuestion.category == category)

    questions = query.all()

    # Get student solved question IDs
    solved_q_ids = set(
        q_id for (q_id,) in db.query(models.StudentPracticeAttempt.question_id).filter(
            models.StudentPracticeAttempt.student_profile_id == student_profile_id,
            models.StudentPracticeAttempt.is_correct == True
        ).all()
    )

    sanitized = []
    for q in questions:
        # Filter test cases: ONLY expose public test cases to student client
        public_test_cases = []
        if q.test_cases:
            for tc in q.test_cases:
                if not tc.get("is_hidden", False):
                    public_test_cases.append({
                        "input": tc.get("input"),
                        "expected_output": tc.get("expected_output")
                    })

        sanitized.append({
            "id": q.id,
            "topic": q.topic,
            "category": q.category,
            "difficulty": q.difficulty,
            "title": q.title,
            "description": q.description,
            "options": q.options,
            "starter_code": q.starter_code,
            "public_test_cases": public_test_cases,
            "is_solved": q.id in solved_q_ids
        })

    return sanitized


def evaluate_practice_submission(
    profile: models.StudentProfile,
    question_id: int,
    code: Optional[str],
    language: Optional[str],
    selected_option: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """
    Server-side evaluation for coding (Judge0/Piston) or Aptitude (MCQ).
    Never exposes hidden test cases or internal keys.
    """
    question = db.query(models.StudentPracticeQuestion).filter(
        models.StudentPracticeQuestion.id == question_id
    ).first()

    if not question:
        raise ValueError("Question not found.")

    is_correct = False
    tests_passed = 0
    total_tests = 0
    feedback = ""
    public_results = []

    if question.category == "APTITUDE":
        total_tests = 1
        user_choice = (selected_option or "").strip().upper()
        correct_choice = (question.correct_answer or "").strip().upper()

        if user_choice == correct_choice:
            is_correct = True
            tests_passed = 1
            feedback = "Correct! " + (question.explanation or "")
        else:
            is_correct = False
            tests_passed = 0
            feedback = f"Incorrect choice '{user_choice}'. " + (question.explanation or "")

    elif question.category == "CODING":
        if not code or not language:
            raise ValueError("Coding submission requires both code and language.")
        if language.strip().lower() not in ("python", "python3"):
            raise ValueError("Only Python is supported for coding practice.")

        all_tests = question.test_cases or []
        total_tests = len(all_tests)

        # Run test cases against Judge0 sandbox
        for idx, tc in enumerate(all_tests):
            stdin = tc.get("input", "")
            expected = str(tc.get("expected_output", "")).strip()

            exec_res = piston_service.execute_code(
                language_key="python",
                code=code,
                stdin=stdin
            )

            actual = str(exec_res.get("stdout", "")).strip()
            passed = piston_service.outputs_match(exec_res.get("stdout", ""), expected)

            if passed:
                tests_passed += 1

            # Only return output details for PUBLIC test cases
            if not tc.get("is_hidden", False):
                public_results.append({
                    "test_case_number": idx + 1,
                    "input": stdin,
                    "expected_output": expected,
                    "actual_output": actual,
                    "passed": passed,
                    "error": exec_res.get("stderr") or exec_res.get("error")
                })

        is_correct = (tests_passed == total_tests)
        if is_correct:
            feedback = f"Excellent! All {total_tests} public and hidden test cases passed."
        else:
            feedback = f"Passed {tests_passed} of {total_tests} test cases. Check edge cases and input parsing."

    # Record attempt in database
    attempt = models.StudentPracticeAttempt(
        student_profile_id=profile.id,
        organization_id=profile.organization_id,
        question_id=question.id,
        category=question.category,
        topic=question.topic,
        code_submitted=code,
        language=language,
        selected_option=selected_option,
        is_correct=is_correct,
        tests_passed=tests_passed,
        total_tests=total_tests,
        feedback=feedback
    )
    db.add(attempt)
    db.commit()

    return {
        "question_id": question.id,
        "is_correct": is_correct,
        "tests_passed": tests_passed,
        "total_tests": total_tests,
        "feedback": feedback,
        "public_results": public_results,
        "explanation": question.explanation if is_correct else None
    }
