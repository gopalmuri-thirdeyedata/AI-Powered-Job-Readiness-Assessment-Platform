"""
DSA & Aptitude Topic-Wise Practice Service (Phase 4).
Provides structured problem solving for coding and aptitude topics.
Maintains test case confidentiality (hidden test cases never sent to client).
Evaluates submissions server-side via Judge0 sandbox.
"""

from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
from services import function_style, judge0_service, student_sandbox, student_typed

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
        "description": "Given an array of integers `nums` and an integer `target`, return `True` if two different numbers in the array add up to the target, otherwise `False`.",
        "correct_answer": "true",
        "starter_code": {
            "python": "import sys\n\ndef has_two_sum(nums, target):\n    # Your logic here: return True if two numbers add up to target, otherwise False\n    pass\n\nif __name__ == '__main__':\n    lines = sys.stdin.read().splitlines()\n    nums = [int(x.strip()) for x in lines[0].split(',') if x.strip()]\n    target = int(lines[1].strip())\n    print(str(has_two_sum(nums, target)).lower())\n",
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
        "description": "Given a string `s`, return `True` if it is a palindrome (ignoring non-alphanumeric characters and case), otherwise `False`.",
        "correct_answer": "true",
        "starter_code": {
            "python": "import sys\n\ndef is_palindrome(s):\n    # Your logic here: return True if s is a palindrome (ignoring case and non-alphanumerics), else False\n    pass\n\nif __name__ == '__main__':\n    print(str(is_palindrome(sys.stdin.read().strip())).lower())\n",
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
        "description": "You are climbing a staircase. It takes n steps to reach the top. Each time you can climb either 1 or 2 steps. Return in how many distinct ways you can climb to the top.",
        "correct_answer": "output",
        "starter_code": {
            "python": "import sys\n\ndef climb_stairs(n):\n    # Your logic here: return the number of distinct ways to climb n stairs (1 or 2 steps at a time)\n    pass\n\nif __name__ == '__main__':\n    print(climb_stairs(int(sys.stdin.read().split()[0])))\n"
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
    seeded = {q["title"]: q for q in SEED_PRACTICE_QUESTIONS if q["category"] == "CODING"}
    changed = False
    for row in db.query(models.StudentPracticeQuestion).filter(
        models.StudentPracticeQuestion.category == "CODING",
        models.StudentPracticeQuestion.title.in_(list(seeded))
    ).all():
        if row.starter_code != seeded[row.title]["starter_code"]:
            row.starter_code = seeded[row.title]["starter_code"]
            changed = True
        if row.description != seeded[row.title]["description"]:
            row.description = seeded[row.title]["description"]
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


def _student_starter(starter_code):
    """LeetCode structure: the student sees `class Solution` with only the function; the stdin/print driver stays on the server."""
    python = (starter_code or {}).get("python")
    converted = function_style.to_function_style(python)
    return {**starter_code, "python": converted["starter"]} if converted else starter_code


def _student_starters(question, spec) -> Any:
    """What the editor starts with, per language: the question's own Python starter (as before) plus the Assessment's generated starters."""
    base = _student_starter(question.starter_code)
    if question.category != "CODING" or not isinstance(base, dict):
        return base
    return {**base, **student_typed.starters(spec, base.get("python"))}


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

        spec = student_typed.practice_spec_for(q)         # None: Python only (not a coding question, or its tests do not fit a typed signature)
        sanitized.append({
            "id": q.id,
            "topic": q.topic,
            "category": q.category,
            "difficulty": q.difficulty,
            "title": q.title,
            "description": q.description,
            "options": q.options,
            "starter_code": _student_starters(q, spec),
            "languages": student_typed.offered_languages(spec) if q.category == "CODING" else None,
            "public_test_cases": public_test_cases,
            "is_solved": q.id in solved_q_ids
        })

    return sanitized


def _evaluate_typed(question, language: str, code: str):
    """Java / C++ / C: one batch through the Assessment's driver; returns (tests_passed, public results) like the Python loop below."""
    spec = student_typed.practice_spec_for(question)
    if spec is None:
        raise ValueError("This question is only available in Python.")
    tests = question.test_cases or []
    cases = student_typed.practice_cases(spec, question)
    try:
        run = student_typed.run_cases(spec, language, code, [args for args, _ in cases])
    except (student_typed.SandboxUnavailable, student_typed.SandboxBusy):
        raise judge0_service.SandboxBusy("The code runner is busy right now.")
    passed_count, public = 0, []
    for idx, (tc, (_, expected)) in enumerate(zip(tests, cases)):
        error, actual, passed = None, "", False
        if run.get("compile_error"):
            error = run["compile_error"]
        else:
            one = run["cases"][idx]
            if one["status"] == "ok":
                actual = student_typed.compact(one["value"])
                passed = student_typed.coding_spec.compare_values(spec, one["value"], expected)
            else:
                error = "Time Limit Exceeded" if one["status"] == "tle" else one["error"]
        passed_count += 1 if passed else 0
        if not tc.get("is_hidden", False):
            public.append({"test_case_number": idx + 1, "input": tc.get("input", ""), "expected_output": str(tc.get("expected_output", "")).strip(),
                           "actual_output": actual, "passed": passed, "error": error})
    return passed_count, public


def evaluate_practice_submission(
    profile: models.StudentProfile,
    question_id: int,
    code: Optional[str],
    language: Optional[str],
    selected_option: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """
    Server-side evaluation for coding (Judge0) or Aptitude (MCQ).
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
        try:
            chosen = student_typed.normalize(language)           # the Assessment's languages: python | java | cpp | c
        except ValueError as exc:
            raise ValueError(str(exc))

        all_tests = question.test_cases or []
        total_tests = len(all_tests)
        driver = (function_style.to_function_style((question.starter_code or {}).get("python")) or {}).get("driver")
        program = function_style.compose(code, driver) if chosen == "python" else ""

        if chosen != "python":
            tests_passed, public_results = _evaluate_typed(question, chosen, code)
            all_tests = []                                          # judged above; the Python loop below has nothing left to do

        # Run test cases against Judge0 sandbox
        for idx, tc in enumerate(all_tests):
            stdin = tc.get("input", "")
            expected = str(tc.get("expected_output", "")).strip()

            exec_res = student_sandbox.run("python", program, stdin)

            actual = str(exec_res.get("stdout", "")).strip()
            passed = judge0_service.outputs_match(exec_res.get("stdout", ""), expected)

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
                    "error": function_style.fix_line_numbers(exec_res.get("stderr") or exec_res.get("error"), function_style.prelude_line_count(driver))
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
