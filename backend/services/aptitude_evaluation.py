from typing import List, Dict, Any, Optional


def normalize_boolean(val: Any) -> Optional[bool]:
    """
    Normalizes various boolean representations to a Python bool.
    Returns None if the value cannot be recognized as boolean.
    """
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    if isinstance(val, str):
        v = val.strip().lower()
        if v in ("true", "t", "yes", "y", "1"):
            return True
        if v in ("false", "f", "no", "n", "0"):
            return False
    return None


def normalize_text(val: Any) -> str:
    """
    Normalizes free-form text by trimming, lowercasing, and collapsing whitespace.
    """
    if val is None:
        return ""
    # Strip leading/trailing whitespace, lowercase, and collapse multiple spaces
    return " ".join(str(val).strip().lower().split())


def validate_manual_aptitude_questions(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Validates and standardizes a list of manual aptitude questions.
    Raises ValueError with a descriptive message if any question is invalid.
    """
    if not isinstance(questions, list) or len(questions) == 0:
        raise ValueError("Manual aptitude questions must be a non-empty list.")

    validated = []
    for idx, item in enumerate(questions, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Question #{idx} must be a dictionary object.")

        q_text = str(item.get("question", "")).strip()
        if not q_text:
            raise ValueError(f"Question #{idx} is missing required 'question' text.")

        raw_type = str(item.get("type", "mcq")).strip().lower()
        if raw_type not in ("mcq", "true_false", "short_answer"):
            raise ValueError(
                f"Question #{idx} has invalid type '{raw_type}'. Supported types: 'mcq', 'true_false', 'short_answer'."
            )

        # Marks validation (must be positive integer, default 1)
        raw_marks = item.get("marks", 1)
        try:
            marks = int(raw_marks)
            if marks <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError(f"Question #{idx} must have positive integer 'marks' (got {raw_marks}).")

        # Difficulty validation
        difficulty = str(item.get("difficulty", "Medium")).strip().capitalize()
        if difficulty not in ("Easy", "Medium", "Hard"):
            difficulty = "Medium"

        q_id = item.get("id") or idx

        question_record = {
            "id": q_id,
            "question": q_text,
            "type": raw_type,
            "marks": marks,
            "difficulty": difficulty,
            "explanation": item.get("explanation") or ""
        }

        # Type-specific validation
        if raw_type == "mcq":
            options = item.get("options")
            if not isinstance(options, list) or len(options) < 2:
                raise ValueError(f"MCQ Question #{idx} must have at least 2 options.")
            cleaned_options = [str(opt).strip() for opt in options]
            if any(len(opt) == 0 for opt in cleaned_options):
                raise ValueError(f"MCQ Question #{idx} contains empty options.")

            # Correct answer can be index (int/str) or option text
            correct_ans = item.get("correct_answer")
            if correct_ans is None:
                correct_ans = item.get("correct")

            if correct_ans is None:
                raise ValueError(f"MCQ Question #{idx} requires a 'correct_answer' index.")

            correct_idx = None
            try:
                c_int = int(correct_ans)
                if 0 <= c_int < len(cleaned_options):
                    correct_idx = c_int
            except (ValueError, TypeError):
                # Try matching by text
                norm_target = normalize_text(correct_ans)
                for opt_i, opt_val in enumerate(cleaned_options):
                    if normalize_text(opt_val) == norm_target:
                        correct_idx = opt_i
                        break

            if correct_idx is None:
                raise ValueError(
                    f"MCQ Question #{idx} has invalid 'correct_answer': {correct_ans} (must be index between 0 and {len(cleaned_options) - 1})."
                )

            question_record["options"] = cleaned_options
            question_record["correct_answer"] = correct_idx
            # Also set legacy 'correct' for backwards compatibility
            question_record["correct"] = correct_idx

        elif raw_type == "true_false":
            correct_ans = item.get("correct_answer")
            if correct_ans is None:
                correct_ans = item.get("correct")

            bool_val = normalize_boolean(correct_ans)
            if bool_val is None:
                raise ValueError(
                    f"True/False Question #{idx} requires a boolean 'correct_answer' (got {correct_ans})."
                )

            question_record["options"] = ["True", "False"]
            question_record["correct_answer"] = bool_val
            question_record["correct"] = bool_val

        elif raw_type == "short_answer":
            correct_ans = item.get("correct_answer")
            if correct_ans is None:
                correct_ans = item.get("correct")

            if not correct_ans or not str(correct_ans).strip():
                raise ValueError(f"Short Answer Question #{idx} requires a non-empty 'correct_answer' string.")

            question_record["options"] = None
            question_record["correct_answer"] = str(correct_ans).strip()
            question_record["correct"] = str(correct_ans).strip()

        validated.append(question_record)

    return validated


def evaluate_aptitude_submission(
    questions: List[Dict[str, Any]],
    answers: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Evaluates candidate answers against questions (supporting both AI and manual questions).
    Computes earned marks, breakdown, and scaled score (0.0 to 10.0).
    """
    if not questions:
        return {
            "score": 0.0,
            "earned_marks": 0,
            "total_marks": 0,
            "correct_count": 0,
            "total_questions": 0,
            "breakdown": [],
            "analysis_data": {
                "correct": 0,
                "total": 0,
                "incorrect": 0,
                "marks_earned": 0,
                "total_marks": 0,
                "score_percentage": 0.0
            }
        }

    # Normalize candidate answers map to string keys
    user_answers = {str(k): v for k, v in (answers or {}).items()}

    breakdown = []
    total_earned_marks = 0
    total_possible_marks = 0
    correct_count = 0

    for idx, q in enumerate(questions, start=1):
        q_id = str(q.get("id", idx))
        q_type = str(q.get("type", "mcq")).lower()
        marks = int(q.get("marks", 1))
        if marks <= 0:
            marks = 1

        total_possible_marks += marks

        # Retrieve expected answer
        expected = q.get("correct_answer")
        if expected is None:
            expected = q.get("correct")

        # Retrieve candidate's answer
        user_ans = user_answers.get(q_id)

        is_correct = False

        if user_ans is not None and expected is not None:
            if q_type == "mcq":
                # Option index comparison (handles int, stringified int, or exact option text)
                try:
                    is_correct = int(user_ans) == int(expected)
                except (ValueError, TypeError):
                    is_correct = normalize_text(user_ans) == normalize_text(expected)

            elif q_type == "true_false":
                user_bool = normalize_boolean(user_ans)
                expected_bool = normalize_boolean(expected)
                if user_bool is not None and expected_bool is not None:
                    is_correct = (user_bool == expected_bool)

            elif q_type == "short_answer":
                user_norm = normalize_text(user_ans)
                expected_norm = normalize_text(expected)
                # Support pipe-separated alternative valid answers e.g. "O(log n)|O(logn)"
                valid_options = [normalize_text(alt) for alt in str(expected).split("|") if alt.strip()]
                is_correct = (user_norm in valid_options) or (user_norm == expected_norm)

            else:
                # Fallback to string comparison
                is_correct = str(user_ans).strip() == str(expected).strip()

        earned = marks if is_correct else 0
        total_earned_marks += earned
        if is_correct:
            correct_count += 1

        breakdown.append({
            "question_id": q.get("id", idx),
            "question": q.get("question", ""),
            "type": q_type,
            "marks": marks,
            "earned_marks": earned,
            "is_correct": is_correct,
            "user_answer": user_ans,
            "correct_answer": expected
        })

    # Scaled to 0.0 - 10.0 scale used by the platform
    scaled_score = (total_earned_marks / total_possible_marks * 10.0) if total_possible_marks > 0 else 0.0
    score_percentage = (total_earned_marks / total_possible_marks * 100.0) if total_possible_marks > 0 else 0.0

    return {
        "score": round(scaled_score, 2),
        "earned_marks": total_earned_marks,
        "total_marks": total_possible_marks,
        "correct_count": correct_count,
        "total_questions": len(questions),
        "breakdown": breakdown,
        "analysis_data": {
            "correct": correct_count,
            "total": len(questions),
            "incorrect": len(questions) - correct_count,
            "marks_earned": total_earned_marks,
            "total_marks": total_possible_marks,
            "score_percentage": round(score_percentage, 2)
        }
    }
