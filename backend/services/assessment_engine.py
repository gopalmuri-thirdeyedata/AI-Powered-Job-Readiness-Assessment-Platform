"""
Shared assessment engine: the evaluation and format logic used by BOTH the Student Platform lifecycle
(services.roleready_service) and the Admin Recruitment shared-link lifecycle (services.assessment_flow_service).

What lives here (workflow independent, no database, no HTTP):
  * the student round formats (client-safe payload + server-only keys) and `adapt_blueprint()`, the explicit adapter
    that turns an admin recruitment blueprint into exactly those formats,
  * aptitude scoring, coding execution + hidden-test evaluation, interview evaluation,
  * draft / submission normalization.

What does NOT live here: authentication, session / attempt management, deadlines, interruption handling and
reporting. Those stay with the workflow that owns the candidate's identity.

Confidentiality: expected outputs, hidden tests, answer keys and rubrics only ever exist in the `keys` structures. Only test
INPUTS are sent to the sandbox, one test at a time, and expected outputs are compared here, in the backend.
"""
import ast
import concurrent.futures
import json
import threading
import time
from collections import defaultdict
from typing import Any, Callable, Dict, List, Optional, Tuple

from services import coding_evaluation
from services import interview_evaluation
from services import function_style
from services import judge0_service

# ------------------------------------------------------------------------------
# Limits and supported languages (single definition for both workflows)
# ------------------------------------------------------------------------------
SUPPORTED_LANGUAGES = {"python", "python3", "java"}
UNSUPPORTED_LANGUAGE_DETAIL = "Only Python and Java are supported for coding assessments."
MAX_CODE_BYTES = 64 * 1024
MAX_OUTPUT_CHARS = 10 * 1024
MAX_INTERVIEW_ANSWER_CHARS = 8000
MAX_TRANSCRIPT_ENTRIES = 400
MAX_TRANSCRIPT_TEXT_CHARS = 2000
MAX_FOLLOW_UPS = 12
CODING_TEST_CONCURRENCY = 4
SAMPLE_TESTS_SHOWN = 3
BUSY_RETRIES = 3
BUSY_RETRY_DELAY = 0.4

SandboxBusy = judge0_service.SandboxBusy


class SandboxUnavailable(Exception):
    """The code sandbox itself is unreachable (an infrastructure fault, never a candidate fault and never scored as zero)."""


def normalize_language(language: Optional[str]) -> str:
    lang = (language or "python").strip().lower()
    if lang not in SUPPORTED_LANGUAGES:
        raise ValueError(UNSUPPORTED_LANGUAGE_DETAIL)
    return "python" if lang in ("python", "python3") else "java"


def _trim(text: Optional[str]) -> str:
    return (text or "")[:MAX_OUTPUT_CHARS]


# ------------------------------------------------------------------------------
# Output comparison
# ------------------------------------------------------------------------------
def outputs_equal(actual: str, expected: str, mode: str = "text") -> bool:
    """
    "text": the student platform's exact comparison after whitespace normalization (judge0_service.outputs_match).
    "json": text first, then JSON / numeric equivalence, so `[0, 1]` == `[0,1]` and `true` == `True` for blueprint problems
            whose expected values are JSON documents rather than stdin-style text.
    """
    if judge0_service.outputs_match(actual, expected):
        return True
    if mode != "json":
        return False
    actual_text = judge0_service.normalize_output(actual)
    expected_text = judge0_service.normalize_output(expected)
    try:
        expected_obj = json.loads(expected_text)
    except (ValueError, TypeError):
        expected_obj = expected_text
    if isinstance(expected_obj, str) and actual_text == expected_obj:
        return True   # the candidate printed the bare string rather than its JSON encoding
    actual_obj = _parse_printed_value(actual_text)
    return bool(coding_evaluation.compare_actual_expected(actual_obj, expected_obj))


def _parse_printed_value(text: str) -> Any:
    """A printed value as a Python object: JSON first, then a Python literal (`[True, 1]`, `('a', 2)`), else the raw text."""
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    try:
        value = ast.literal_eval(text)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return text
    return json.loads(json.dumps(value)) if isinstance(value, (list, tuple, dict, str, int, float, bool, type(None))) else text


# ------------------------------------------------------------------------------
# Aptitude
# ------------------------------------------------------------------------------
def evaluate_aptitude(keys: Dict[str, Any], answers: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Percent correct against the secret keys; unanswered and unknown ids score zero. keys = {qid: {correct_key, explanation}}."""
    answers = answers or {}
    total = len(keys)
    correct = 0
    breakdown = []
    for qid, info in keys.items():
        correct_key = str((info or {}).get("correct_key", "")).upper()
        choice = str(answers.get(qid, "")).strip().upper()
        is_correct = bool(correct_key) and choice == correct_key
        correct += 1 if is_correct else 0
        breakdown.append({"question_id": qid, "student_choice": choice, "is_correct": is_correct,
                          "explanation": (info or {}).get("explanation", "")})
    score = (correct / total * 100) if total > 0 else 0.0           # full precision: the overall is computed from this
    return {"score": score, "correct_count": correct, "total_questions": total, "breakdown": breakdown}


# ------------------------------------------------------------------------------
# Coding
# ------------------------------------------------------------------------------
Execute = Callable[[str, str, str], Dict[str, Any]]


def _default_execute(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    # Looked up at call time so a replaced judge0_service.execute_code (tests, alternative runner) is honoured.
    return judge0_service.execute_code(language, code, stdin=stdin)


def _run_with_retry(execute: Execute, language: str, code: str, stdin: str) -> Dict[str, Any]:
    """
    A saturated sandbox is waited out briefly, never penalized. A sandbox failure is retried ONCE, and only when the adapter
    says nothing was submitted (`retryable`: connection refused, 429 / 502 / 503 / 504). A read timeout or a malformed answer
    is never resubmitted, because the code may already have run (no duplicate submissions, no retry storms).
    """
    last: Dict[str, Any] = {}
    for attempt in range(BUSY_RETRIES):
        try:
            res = execute(language, code, stdin)
            if res.get("status") == "service_error" and res.get("retryable"):
                time.sleep(min(float(res.get("retry_after") or 0.5), 2.0))
                res = execute(language, code, stdin)
            return res
        except SandboxBusy:
            if attempt == BUSY_RETRIES - 1:
                raise SandboxUnavailable("sandbox saturated")
            time.sleep(BUSY_RETRY_DELAY)
    return last


def run_sample_tests(problem: Dict[str, Any], code: str, language: str, *, execute: Optional[Execute] = None,
                     comparison: str = "text") -> Dict[str, Any]:
    """
    Ephemeral run against the problem's PUBLIC sample test(s). No state is changed. Raises SandboxUnavailable when the
    sandbox is down. Returns the response shape the shared coding UI renders.
    """
    execute = execute or _default_execute
    lang = normalize_language(language)
    results = []
    for test in (problem.get("public_test_cases") or [])[:SAMPLE_TESTS_SHOWN]:
        stdin = test.get("input", "")
        expected = str(test.get("expected_output", "")).strip()
        try:
            res = execute(lang, code, stdin)
        except SandboxBusy:
            raise
        if res.get("status") == "service_error":
            raise SandboxUnavailable(res.get("output") or "sandbox unavailable")
        stdout = _trim(res.get("stdout")).strip()
        compile_err = _trim(res.get("compile_output"))
        runtime_err = _trim(res.get("stderr"))
        error = compile_err or runtime_err or (res.get("output") if res.get("status") in ("error", "failed") else None)
        error_type = None
        if compile_err or res.get("status") == "error":
            error_type = "Compilation Error"
        elif runtime_err or res.get("status") == "failed":
            error_type = "Runtime Error" if not res.get("timed_out") else "Time Limit Exceeded"
        results.append({
            "id": test.get("id"),
            "input": stdin, "expected_output": expected, "actual_output": stdout, "error": error,
            "error_type": error_type, "timed_out": bool(res.get("timed_out")),
            "execution_time_ms": res.get("execution_time_ms"),
            "passed": outputs_equal(stdout, expected, comparison),
        })
    all_passed = all(r["passed"] for r in results) if results else False
    first = results[0] if results else {}
    return {
        "status": "success", "language": lang, "all_passed": all_passed, "sample_test_passed": all_passed,
        "stdout": first.get("actual_output", ""), "stderr": first.get("error") or "", "error_type": first.get("error_type"),
        "execution_time_ms": first.get("execution_time_ms"), "expected_output": first.get("expected_output", ""),
        "actual_output": first.get("actual_output", ""), "test_results": results,
    }


def evaluate_coding(problems: List[Dict[str, Any]], hidden_keys: Dict[str, Any], solutions: Optional[Dict[str, Any]], *,
                    execute: Optional[Execute] = None, concurrency: int = CODING_TEST_CONCURRENCY) -> Dict[str, Any]:
    """
    Evaluate submitted solutions against the confidential hidden tests (the student platform's section logic):
    the section score is hidden tests passed / hidden tests total, as a percentage. An empty solution scores zero
    without touching the sandbox. Raises SandboxUnavailable if the sandbox cannot be reached (nothing is scored).

    problems    = the client-safe problem list (ids, titles)
    hidden_keys = {pid: {"hidden_test_cases": [{"input", "expected_output"}], "comparison": "text"|"json"}}
    solutions   = {pid: {"code": str, "language": "python"|"java"}}
    """
    execute = execute or _default_execute
    solutions = solutions or {}
    jobs: List[Tuple[int, str, str, str, str, str]] = []   # (problem index, expected, mode, language, code, stdin)
    plans: List[Tuple[Dict[str, Any], str, str, int]] = []
    total_hidden = 0
    for prob in problems or []:
        pid = str(prob.get("id"))
        sol = solutions.get(pid) or {}
        code = sol.get("code", "") or ""
        lang = normalize_language(sol.get("language"))
        info = hidden_keys.get(pid) or {}
        hidden = info.get("hidden_test_cases", [])
        mode = info.get("comparison", "text")
        plans.append((prob, pid, lang, len(hidden)))
        total_hidden += len(hidden)
        if code.strip():
            for case in hidden:
                jobs.append((len(plans) - 1, (case.get("expected_output", "") or "").strip(), mode, lang, code, case.get("input", "")))

    outage = threading.Event()   # once the sandbox is known to be down no further submissions are issued

    def _one(job):
        _, _, _, lang, code, stdin = job
        if outage.is_set():
            return {"status": "service_error", "output": "sandbox unavailable"}
        try:
            res = _run_with_retry(execute, lang, code, stdin)
        except SandboxUnavailable:
            outage.set()
            raise
        if res.get("status") == "service_error":
            outage.set()
        return res

    passed_by_problem: Dict[int, int] = defaultdict(int)
    worst: Dict[int, str] = {}
    message: Dict[int, str] = {}
    if jobs:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(concurrency, len(jobs)))) as pool:
            results = list(pool.map(_one, jobs))
        for job, res in zip(jobs, results):
            if res.get("status") == "service_error":
                raise SandboxUnavailable(res.get("output") or "sandbox unavailable")
            idx = job[0]
            stdout = _trim(res.get("stdout")).strip()
            if outputs_equal(stdout, job[1], job[2]):
                passed_by_problem[idx] += 1
            cls = judge0_service.classify_execution(res)
            if cls != judge0_service.OK and worst.get(idx) in (None, judge0_service.OK):
                worst[idx] = cls
                message[idx] = (_trim(res.get("compile_output")) or _trim(res.get("stderr")) or _trim(res.get("output")))[:2048]

    problem_results = []
    passed_total = 0
    for idx, (prob, pid, lang, prob_total) in enumerate(plans):
        passed = passed_by_problem[idx]
        passed_total += passed
        code_present = any(j[0] == idx for j in jobs)
        problem_results.append({
            "problem_id": pid, "title": prob.get("title"), "language": lang,
            "passed_tests": passed, "total_tests": prob_total,
            "score": (passed / prob_total * 100) if prob_total > 0 else 0.0,
            "classification": worst.get(idx, judge0_service.OK if code_present else "NO_SUBMISSION"),
            "message": message.get(idx, ""),
        })
    score = (passed_total / total_hidden * 100) if total_hidden > 0 else 0.0     # pooled hidden tests, full precision
    return {"score": score, "problems": problem_results, "total_hidden_tests": total_hidden, "passed_hidden_tests": passed_total}


# ------------------------------------------------------------------------------
# Interview
# ------------------------------------------------------------------------------
def evaluate_interview(questions: List[Dict[str, Any]], answers: Optional[List[Dict[str, Any]]], *, role: str,
                       jd_summary: str = "", resume_summary: str = "", transcript: Optional[List[Dict[str, Any]]] = None,
                       evaluate_fn: Optional[Callable[..., Dict[str, Any]]] = None,
                       call_gemini_fn: Optional[Callable[..., Any]] = None) -> Dict[str, Any]:
    """
    Interview section result as a 0-100 percentage plus the qualitative breakdown (the student platform's rules): no
    responses score zero without an AI call; otherwise the evaluator's overall score (clamped) is the section score.
    """
    answers = answers or []
    if not answers:
        feedback = "No interview responses were submitted."
        return {"score": 0.0, "qualitative_feedback": feedback, "summary": feedback, "evaluation_source": "no_answers",
                "technical_depth_score": 0.0, "communication_score": 0.0, "key_strengths": [],
                "key_areas_for_improvement": [], "question_evaluations": []}
    evaluate = evaluate_fn or interview_evaluation.evaluate_five_technical_questions
    kwargs: Dict[str, Any] = {"questions": questions, "answers": answers, "role": role, "jd_summary": jd_summary,
                              "resume_summary": resume_summary, "transcript": transcript or []}
    if call_gemini_fn is not None:
        kwargs["call_gemini_fn"] = call_gemini_fn
    res = evaluate(**kwargs)
    score = max(0.0, min(100.0, float(res.get("score", 0.0))))
    feedback = res.get("summary") or res.get("qualitative_feedback") or "Evaluation completed."
    return {
        "score": score,
        "qualitative_feedback": feedback,
        "summary": feedback,
        "evaluation_source": res.get("evaluation_source", "ai"),
        "technical_depth_score": res.get("technical_depth_score", score),
        "communication_score": res.get("communication_score", score),
        "key_strengths": res.get("key_strengths", []),
        "key_areas_for_improvement": res.get("key_areas_for_improvement", []),
        "question_evaluations": res.get("question_evaluations", []),
    }


# ------------------------------------------------------------------------------
# Draft / submission normalization (autosaved partial work, scored if the sitting ends)
# ------------------------------------------------------------------------------
def normalize_submission(section: str, payload: Optional[Dict[str, Any]], questions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Reduce client-supplied work to the canonical submission for `section`, dropping anything that is not part of the
    round (unknown ids, invalid choices). Raises ValueError for oversized code.
      APTITUDE  -> {"answers": {qid: "A".."D"}}
      CODING    -> {"solutions": {pid: {"language": "python"|"java", "code": str}}}
      INTERVIEW -> {"answers": [{"question_id", "response", "follow_ups"}], "transcript": [{"role","text"}]}
    """
    payload = payload if isinstance(payload, dict) else {}
    valid_ids = {str(q.get("id")) for q in (questions or [])}
    if section == "APTITUDE":
        answers = {}
        for qid, val in (payload.get("answers") or {}).items():
            val = str(val).strip().upper()
            if str(qid) in valid_ids and val in ("A", "B", "C", "D"):
                answers[str(qid)] = val
        return {"answers": answers}
    if section == "CODING":
        solutions = {}
        for pid, sol in (payload.get("solutions") or {}).items():
            if str(pid) not in valid_ids or not isinstance(sol, dict):
                continue
            code = str(sol.get("code") or "")
            if len(code.encode("utf-8")) > MAX_CODE_BYTES:
                raise ValueError("Code exceeds the 64 KB submission limit.")
            try:
                lang = normalize_language(sol.get("language"))
            except ValueError:
                lang = "python"
            solutions[str(pid)] = {"language": lang, "code": code}
        return {"solutions": solutions}

    # INTERVIEW: accept a list of segmented answers (voice flow) or a {question_id: text} map (typed fallback)
    raw = payload.get("answers")
    entries: List[Dict[str, Any]] = []
    if isinstance(raw, dict):
        raw = [{"question_id": k, "response": v} for k, v in raw.items()]
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        qid = str(item.get("question_id", ""))
        if qid not in valid_ids:
            continue
        follow_ups = []
        for fu in (item.get("follow_ups") or [])[:MAX_FOLLOW_UPS]:
            if isinstance(fu, dict):
                follow_ups.append({"follow_up_question": str(fu.get("follow_up_question") or "")[:MAX_TRANSCRIPT_TEXT_CHARS],
                                   "response": str(fu.get("response") or "")[:MAX_INTERVIEW_ANSWER_CHARS]})
        entries.append({"question_id": item.get("question_id"), "response": str(item.get("response") or "")[:MAX_INTERVIEW_ANSWER_CHARS],
                        "follow_ups": follow_ups})
    transcript = []
    for turn in (payload.get("transcript") or [])[:MAX_TRANSCRIPT_ENTRIES]:
        if isinstance(turn, dict) and turn.get("text"):
            transcript.append({"role": "ai" if str(turn.get("role")) in ("ai", "assistant") else "user",
                               "text": str(turn.get("text"))[:MAX_TRANSCRIPT_TEXT_CHARS]})
    return {"answers": entries, "transcript": transcript}


# ------------------------------------------------------------------------------
# Admin recruitment blueprint -> student round formats (the explicit adapter)
# ------------------------------------------------------------------------------
def _solve_params(problem: Dict[str, Any]) -> List[str]:
    """Parameter names of `solve` in declaration order (JSON object key order is not reliable in every database)."""
    starter = (problem.get("starter_code") or {}).get("python") or ""
    try:
        for node in ast.walk(ast.parse(starter)):
            if isinstance(node, ast.FunctionDef) and node.name == "solve":
                return [a.arg for a in node.args.args]
    except SyntaxError:
        pass
    first = ((problem.get("public_test_cases") or [{}])[0]).get("input")
    return list(first.keys()) if isinstance(first, dict) else []


def _stdin_for(case_input: Any, params: List[str]) -> str:
    """One JSON-encoded value per line, in `solve` parameter order."""
    if isinstance(case_input, dict):
        names = params if params and set(params) <= set(case_input) else list(case_input.keys())
        values = [case_input[n] for n in names]
    elif isinstance(case_input, list):
        values = case_input
    else:
        values = [case_input]
    return "\n".join(json.dumps(v) for v in values) + "\n"


def _expected_text(expected: Any) -> str:
    return json.dumps(expected)


def _python_starter(problem: Dict[str, Any], params: List[str]) -> str:
    base = ((problem.get("starter_code") or {}).get("python") or "").rstrip()
    if "def solve" not in base:
        base = f"def solve({', '.join(params)}):\n    pass"
    if "sys.stdin" in base or "input(" in base:
        return base + "\n"
    return (base + "\n\n\nif __name__ == \"__main__\":\n"
            "    import json, sys\n"
            "    _args = [json.loads(line) for line in sys.stdin.read().splitlines() if line.strip()]\n"
            "    print(json.dumps(solve(*_args)))\n")


def _java_starter(params: List[str]) -> str:
    order = ", ".join(params) if params else "the inputs"
    return ("import java.util.*;\n\npublic class Main {\n"
            f"    // Standard input: one JSON-encoded value per line, in this order: {order}\n"
            "    public static void main(String[] args) {\n"
            "        Scanner scanner = new Scanner(System.in);\n"
            "        // Read the inputs, solve the problem, and print the JSON-encoded result on one line.\n"
            "    }\n}\n")


def adapt_blueprint(bp: Dict[str, Any]) -> Dict[str, Tuple[List[Dict[str, Any]], Dict[str, Any]]]:
    """
    Convert a validated recruitment blueprint into the student round formats, so the shared components and evaluators
    consume it unchanged. Returns {SECTION: (client_safe_payload, server_only_keys)}.
    Answer keys, hidden tests and the interview rubric stay in the server-only half.
    """
    apt_client: List[Dict[str, Any]] = []
    apt_keys: Dict[str, Any] = {}
    for q in bp["aptitude_questions"]:
        qid = str(q["id"])
        apt_client.append({"id": qid, "topic": q.get("domain") or "General Reasoning", "difficulty": q.get("difficulty"),
                           "question": q["question"],
                           "options": [{"key": k, "text": q["options"][k]} for k in ("A", "B", "C", "D")]})
        apt_keys[qid] = {"correct_key": str(q["correct_key"]).strip().upper(), "explanation": q.get("explanation", "")}

    code_client: List[Dict[str, Any]] = []
    code_keys: Dict[str, Any] = {}
    for p in bp["coding_problems"]:
        pid = str(p["id"])
        params = _solve_params(p)
        public = [{"id": f"{pid}-p{i + 1}", "input": _stdin_for(c["input"], params), "expected_output": _expected_text(c["expected"])}
                  for i, c in enumerate(p["public_test_cases"])]
        hidden = [{"id": f"{pid}-h{i + 1}", "input": _stdin_for(c["input"], params), "expected_output": _expected_text(c["expected"])}
                  for i, c in enumerate(p["hidden_test_cases"])]
        if len(public) < 2 and hidden:                         # two examples, like LeetCode (this case also stays in the graded set)
            public.append({**hidden[0], "id": f"{pid}-p{len(public) + 1}"})
        lines = len(params) or 1
        names = ", ".join(f"`{n}`" for n in params)
        # LeetCode structure (Python only): the student sees `class Solution` with just the signature; the server keeps the input / output driver
        starter = _python_starter(p, params)
        parts = function_style.to_function_style(starter)
        if parts:
            input_format = (f"Your function receives the parameter(s): {names}." if names else "Your function takes no parameters.")
            output_format = "Return the result."
        else:
            input_format = (f"Standard input has {lines} line(s); each line is the JSON-encoded value of a parameter"
                            + (f", in this order: {names}." if names else "."))
            output_format = "Print the JSON-encoded return value on a single line."
        code_client.append({
            "id": pid, "title": p["title"], "difficulty": p.get("difficulty", "Medium"), "description": p["description"],
            "input_format": input_format, "output_format": output_format,
            "constraints": "",
            "starter_code": {"python": parts["starter"] if parts else starter},
            "public_test_cases": public,
        })
        code_keys[pid] = {"hidden_test_cases": hidden, "comparison": "json", **({"driver": parts["driver"]} if parts else {})}

    int_client: List[Dict[str, Any]] = []
    int_questions: List[Dict[str, Any]] = []
    for q in bp["interview_questions"]:
        qid = str(q["id"])
        category = q.get("topic") or q.get("competency") or "Technical Defense"
        int_client.append({"id": qid, "category": category, "question": q["question_text"]})
        int_questions.append({"id": qid, "category": category, "question": q["question_text"],
                              "evaluation_criteria": "; ".join(q.get("evaluation_criteria") or []) or "Technical depth, accuracy, trade-offs.",
                              "expected_technical_concepts": q.get("expected_technical_concepts", [])})
    return {"APTITUDE": (apt_client, apt_keys), "CODING": (code_client, code_keys),
            "INTERVIEW": (int_client, {"questions": int_questions})}
