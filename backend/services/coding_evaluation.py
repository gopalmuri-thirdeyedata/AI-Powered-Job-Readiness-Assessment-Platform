import json
import copy
from typing import List, Dict, Any, Optional, Tuple
from services import ai_generator
from services import piston_service

DEFAULT_STARTER_CODE = {
    "python": "def solve(input_data):\n    # return the result\n    pass",
    "java": "class Solution {\n    public Object solve(Object input) {\n        // return the result\n        return null;\n    }\n}"
}

def validate_manual_coding_questions(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Validates and normalizes manual coding questions.
    Ensures required fields, proper types, at least one public test case,
    and valid marks and difficulty.
    """
    if not questions or not isinstance(questions, list):
        raise ValueError("Manual coding assessment requires a non-empty list of questions.")

    validated = []
    valid_difficulties = {"Easy", "Medium", "Hard"}

    for idx, raw_q in enumerate(questions, start=1):
        if not isinstance(raw_q, dict):
            raise ValueError(f"Question at index {idx} must be an object.")

        q = copy.deepcopy(raw_q)

        # 1. Title
        title = q.get("title")
        if not title or not str(title).strip():
            raise ValueError(f"Problem #{idx}: Title cannot be empty.")
        q["title"] = str(title).strip()

        # 2. Description / Problem Statement
        description = q.get("description")
        if not description or not str(description).strip():
            raise ValueError(f"Problem #{idx}: Problem statement/description cannot be empty.")
        q["description"] = str(description).strip()

        # 3. Difficulty
        diff = q.get("difficulty", "Medium")
        if diff not in valid_difficulties:
            diff = "Medium"
        q["difficulty"] = diff

        # 4. Marks
        raw_marks = q.get("marks", 10)
        try:
            marks = int(raw_marks)
            if marks <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError(f"Problem #{idx}: Marks must be a positive integer (got {raw_marks}).")
        q["marks"] = marks

        # 5. Formats & Constraints
        q["input_format"] = str(q.get("input_format") or "").strip()
        q["output_format"] = str(q.get("output_format") or "").strip()

        raw_constraints = q.get("constraints") or []
        if isinstance(raw_constraints, str):
            raw_constraints = [c.strip() for c in raw_constraints.split("\n") if c.strip()]
        elif isinstance(raw_constraints, list):
            raw_constraints = [str(c).strip() for c in raw_constraints if str(c).strip()]
        q["constraints"] = raw_constraints

        # 6. Examples
        raw_examples = q.get("examples") or []
        cleaned_examples = []
        if isinstance(raw_examples, list):
            for ex in raw_examples:
                if isinstance(ex, dict):
                    cleaned_examples.append({
                        "input": ex.get("input", ""),
                        "output": ex.get("output", ""),
                        "explanation": str(ex.get("explanation") or "").strip()
                    })
        q["examples"] = cleaned_examples

        # 7. Starter Code
        starter = q.get("starterCode") or {}
        if not isinstance(starter, dict):
            starter = {}
        merged_starter = {
            "python": starter.get("python") or DEFAULT_STARTER_CODE["python"],
            "java": starter.get("java") or DEFAULT_STARTER_CODE["java"]
        }
        q["starterCode"] = merged_starter

        # 8. Test Cases Validation (Public + Hidden)
        raw_tc_list = q.get("testCases")
        if not raw_tc_list or not isinstance(raw_tc_list, list):
            raise ValueError(f"Problem #{idx}: Must provide at least one test case.")

        cleaned_tcs = []
        has_public = False

        for tc_idx, tc in enumerate(raw_tc_list, start=1):
            if not isinstance(tc, dict):
                raise ValueError(f"Problem #{idx}, Test Case #{tc_idx}: Must be an object.")

            tc_id = tc.get("id", tc_idx)
            tc_input = tc.get("input")
            if tc_input is None:
                tc_input = {}

            tc_expected = tc.get("expected")
            if tc_expected is None and "output" in tc:
                tc_expected = tc.get("output")
            if tc_expected is None:
                raise ValueError(f"Problem #{idx}, Test Case #{tc_idx}: Expected output cannot be empty.")

            is_hidden = bool(tc.get("is_hidden") or tc.get("hidden") or False)
            if not is_hidden:
                has_public = True

            tc_clean = {
                "id": tc_id,
                "input": tc_input,
                "expected": tc_expected,
                "is_hidden": is_hidden
            }
            if tc.get("explanation"):
                tc_clean["explanation"] = str(tc["explanation"]).strip()

            cleaned_tcs.append(tc_clean)

        if not has_public:
            raise ValueError(f"Problem #{idx}: Must include at least one visible/public test case for candidates.")

        q["testCases"] = cleaned_tcs
        q["id"] = q.get("id", idx)

        validated.append(q)

    return validated


def compare_actual_expected(actual: Any, expected: Any) -> bool:
    """
    Normalizes and safely compares candidate execution output against expected output.
    Handles exact types, JSON serialization, numbers, booleans, and string representations.
    """
    if actual == expected:
        return True

    # 1. String stripped equality
    actual_str = str(actual).strip()
    expected_str = str(expected).strip()
    if actual_str == expected_str:
        return True

    # 2. Try JSON parsing if stringified representations exist
    exp_obj = expected
    if isinstance(expected, str):
        try:
            if expected.strip().startswith(('[', '{', '"')):
                exp_obj = json.loads(expected)
        except Exception:
            pass

    act_obj = actual
    if isinstance(actual, str):
        try:
            if actual.strip().startswith(('[', '{', '"')):
                act_obj = json.loads(actual)
        except Exception:
            pass

    if act_obj == exp_obj:
        return True

    # 3. Numeric comparison (e.g. float vs int)
    try:
        if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
            return float(actual) == float(expected)
        # Stringified numeric comparison
        return float(actual_str) == float(expected_str)
    except (ValueError, TypeError):
        pass

    # 4. Boolean normalization
    if isinstance(expected, bool) or expected_str.lower() in ("true", "false"):
        exp_bool = expected if isinstance(expected, bool) else (expected_str.lower() == "true")
        if isinstance(actual, bool):
            return actual == exp_bool
        if actual_str.lower() in ("true", "false"):
            return (actual_str.lower() == "true") == exp_bool

    return False


def extract_candidate_code(
    payload_code: Any,
    answers: Optional[Dict[str, Any]],
    question_index: int,
    question_id: Any,
    default_language: str = "python"
) -> Tuple[str, str]:
    """
    Robustly extracts candidate code and programming language for a given question.
    Supports single code strings, indexed code maps, and nested language objects.
    """
    code_str = ""
    lang = default_language or "python"

    # 1. Determine language from answers or default
    if answers and isinstance(answers, dict):
        if answers.get("selectedLanguage"):
            lang = answers["selectedLanguage"]
        elif answers.get("language"):
            lang = answers["language"]

    # 2. Direct string payload
    if isinstance(payload_code, str):
        code_str = payload_code

    # 3. Dictionary payload (indexed by question_index or question_id)
    elif isinstance(payload_code, dict):
        q_code_entry = None
        for key in [question_index, str(question_index), question_id, str(question_id)]:
            if key in payload_code:
                q_code_entry = payload_code[key]
                break

        if q_code_entry is None:
            # Fallback: check if payload_code itself is { "python": "...", "java": "..." }
            if any(l in payload_code for l in ["python", "java", "javascript", "cpp"]):
                q_code_entry = payload_code

        if isinstance(q_code_entry, str):
            code_str = q_code_entry
        elif isinstance(q_code_entry, dict):
            # Object containing language keys: { python: "...", java: "..." }
            if lang in q_code_entry and q_code_entry[lang]:
                code_str = q_code_entry[lang]
            else:
                # Pick the first non-empty language
                for k, v in q_code_entry.items():
                    if v and isinstance(v, str) and v.strip():
                        code_str = v
                        lang = k
                        break

    # 4. Fallback: check inside answers
    if not code_str and answers and isinstance(answers, dict):
        code_dict = answers.get("code") or answers.get("codeByQuestion")
        if code_dict:
            return extract_candidate_code(code_dict, None, question_index, question_id, default_language=lang)

    return code_str.strip(), lang


def execute_and_evaluate_coding_submission(
    questions: List[Dict[str, Any]],
    payload_code: Any,
    answers: Optional[Dict[str, Any]] = None,
    fallback_result: Optional[Dict[str, Any]] = None,
    language: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes and grades candidate coding submission using the existing Judge0 CE pipeline.
    Runs both public and hidden test cases.
    Evaluates results on the backend without trusting frontend calculations.
    """
    total_possible_marks = 0
    total_earned_marks = 0.0
    total_passed_test_cases = 0
    total_test_cases = 0
    total_public_passed = 0
    total_public_tcs = 0
    total_hidden_passed = 0
    total_hidden_tcs = 0

    question_evaluations = []

    for q_idx, q in enumerate(questions):
        q_id = q.get("id", q_idx + 1)
        q_title = q.get("title", f"Problem #{q_idx + 1}")
        q_marks = int(q.get("marks", 10))
        total_possible_marks += q_marks

        all_tcs = q.get("testCases", [])
        tc_count = len(all_tcs)
        total_test_cases += tc_count

        cand_code, cand_lang = extract_candidate_code(
            payload_code, answers, q_idx, q_id, default_language=language or "python"
        )

        tc_results = []
        q_passed_count = 0
        execution_status = "unattempted"

        if not cand_code:
            # Candidate submitted empty/no code
            for tc in all_tcs:
                tc_results.append({
                    "id": tc.get("id"),
                    "is_hidden": tc.get("is_hidden", False),
                    "status": "failed",
                    "output": "No code submitted",
                    "expected": tc.get("expected")
                })
        else:
            # Generate runner code using existing Judge0 runner generator
            runner_code = ai_generator.generate_runner_code(
                cand_code, cand_lang, all_tcs, question_config=q
            )

            if not runner_code:
                # Safety fallback
                for tc in all_tcs:
                    tc_results.append({
                        "id": tc.get("id"),
                        "is_hidden": tc.get("is_hidden", False),
                        "status": "error",
                        "output": "Failed to generate execution runner",
                        "expected": tc.get("expected")
                    })
            else:
                # Execute on Judge0
                judge_res = piston_service.execute_code(cand_lang, runner_code)

                if judge_res.get("status") == "success":
                    execution_status = "executed"
                    raw_output = judge_res.get("output", "").strip()

                    marker_start = "---EXECUTION_RESULT_START---"
                    marker_end = "---EXECUTION_RESULT_END---"

                    lines = raw_output.split("\n")
                    parsing = False
                    executed_map = {}

                    for line in lines:
                        line = line.strip()
                        if not line:
                            continue
                        if marker_start in line:
                            parsing = True
                            continue
                        if marker_end in line:
                            parsing = False
                            break
                        if parsing:
                            try:
                                res_obj = json.loads(line)
                                if "id" in res_obj:
                                    executed_map[str(res_obj["id"])] = res_obj
                            except Exception:
                                pass

                    # Evaluate each test case
                    for tc in all_tcs:
                        tc_id_str = str(tc.get("id"))
                        exec_item = executed_map.get(tc_id_str)
                        if exec_item:
                            actual = exec_item.get("output")
                            expected = tc.get("expected")
                            passed = (exec_item.get("status") != "error") and compare_actual_expected(actual, expected)
                            if passed:
                                q_passed_count += 1
                            tc_results.append({
                                "id": tc.get("id"),
                                "is_hidden": tc.get("is_hidden", False),
                                "status": "passed" if passed else "failed",
                                "output": actual,
                                "expected": expected
                            })
                        else:
                            # Test case didn't produce an execution entry (e.g. timeout or exception)
                            tc_results.append({
                                "id": tc.get("id"),
                                "is_hidden": tc.get("is_hidden", False),
                                "status": "failed",
                                "output": "Execution did not return result for this test case",
                                "expected": tc.get("expected")
                            })
                else:
                    # Compilation error, runtime error, or service error
                    execution_status = judge_res.get("status", "error")
                    err_msg = judge_res.get("output", "Execution failed")
                    for tc in all_tcs:
                        tc_results.append({
                            "id": tc.get("id"),
                            "is_hidden": tc.get("is_hidden", False),
                            "status": "error",
                            "output": err_msg,
                            "expected": tc.get("expected")
                        })

        # Calculate marks earned for this problem
        if tc_count > 0:
            q_earned_marks = round((q_passed_count / tc_count) * q_marks, 2)
        else:
            q_earned_marks = 0.0

        total_earned_marks += q_earned_marks
        total_passed_test_cases += q_passed_count

        q_public_tcs = [tc for tc in all_tcs if not tc.get("is_hidden") and not tc.get("hidden")]
        q_hidden_tcs = [tc for tc in all_tcs if tc.get("is_hidden") or tc.get("hidden")]
        q_public_passed = len([r for r in tc_results if not r.get("is_hidden") and r.get("status") == "passed"])
        q_hidden_passed = len([r for r in tc_results if r.get("is_hidden") and r.get("status") == "passed"])

        total_public_passed += q_public_passed
        total_public_tcs += len(q_public_tcs)
        total_hidden_passed += q_hidden_passed
        total_hidden_tcs += len(q_hidden_tcs)

        question_evaluations.append({
            "question_id": q_id,
            "title": q_title,
            "marks": q_marks,
            "earned_marks": q_earned_marks,
            "passed_test_cases": q_passed_count,
            "total_test_cases": tc_count,
            "public_passed": q_public_passed,
            "public_total": len(q_public_tcs),
            "hidden_passed": q_hidden_passed,
            "hidden_total": len(q_hidden_tcs),
            "execution_status": execution_status,
            "test_case_results": tc_results
        })

    # Overall score on 0-10 scale
    if total_possible_marks > 0:
        score_out_of_10 = round((total_earned_marks / total_possible_marks) * 10.0, 2)
    else:
        score_out_of_10 = 0.0

    return {
        "score": score_out_of_10,
        "passed_test_cases": total_passed_test_cases,
        "total_test_cases": total_test_cases,
        "public_passed_test_cases": total_public_passed,
        "public_total_test_cases": total_public_tcs,
        "hidden_passed_test_cases": total_hidden_passed,
        "hidden_total_test_cases": total_hidden_tcs,
        "earned_marks": total_earned_marks,
        "total_marks": total_possible_marks,
        "evaluation_details": {
            "questions": question_evaluations,
            "total_marks": total_possible_marks,
            "earned_marks": total_earned_marks,
            "score": score_out_of_10,
            "passed_test_cases": total_passed_test_cases,
            "total_test_cases": total_test_cases,
            "public_passed_test_cases": total_public_passed,
            "public_total_test_cases": total_public_tcs,
            "hidden_passed_test_cases": total_hidden_passed,
            "hidden_total_test_cases": total_hidden_tcs
        },
        "analysis_data": {
            # Candidate-safe metrics (never reveals hidden test execution results or counts)
            "public_passed": total_public_passed,
            "public_total": total_public_tcs,
            "has_hidden_tests": total_hidden_tcs > 0,
            "hidden_status": "Private evaluation" if total_hidden_tcs > 0 else "None",
            "score_percentage": round((score_out_of_10 / 10.0) * 100.0, 2) if total_possible_marks > 0 else 0.0,
            # Recruiter/internal metrics
            "internal_total_passed": total_passed_test_cases,
            "internal_total_tests": total_test_cases
        }
    }
