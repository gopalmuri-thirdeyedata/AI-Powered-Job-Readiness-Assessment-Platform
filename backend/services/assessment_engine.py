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
import random
import re
import threading
import time
from collections import defaultdict
from typing import Any, Callable, Dict, List, Optional, Tuple

from services import coding_evaluation
from services import coding_spec
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


ExecuteBatch = Callable[[str, str, List[str]], Dict[str, Any]]


def run_typed_samples(problem: Dict[str, Any], spec: Dict[str, Any], code: str, language: str, *,
                      execute_batch: Optional[ExecuteBatch] = None, custom_values: Optional[List[Any]] = None) -> Dict[str, Any]:
    """
    Ephemeral run of a typed problem against its PUBLIC examples (and the student's own testcase): one batch, compile once. Nothing is stored
    or scored. Raises SandboxBusy / SandboxUnavailable like run_sample_tests. The response has the shape the shared coding UI renders.
    """
    execute_batch = execute_batch or _default_execute_batch
    lang = coding_spec.normalize_language(language)
    cases: List[Dict[str, Any]] = []
    for example in (problem.get("public_test_cases") or [])[:SAMPLE_TESTS_SHOWN]:
        args = [json.loads(a) for a in example.get("args") or []]
        cases.append({"id": example.get("id"), "values": args, "expected": json.loads(example.get("expected_output")), "custom": False})
    if custom_values is not None:
        cases.append({"id": "custom", "values": custom_values, "expected": None, "custom": True})
    for case in cases:
        case["stdin"] = coding_spec.encode_input(spec, case["values"])
        case["input"] = coding_spec.display_input(spec, case["values"])

    marker = coding_spec.new_marker()
    program, shift = coding_spec.compose(spec, lang, code, marker)
    res = _batch_with_retry(execute_batch, lang, program, [c["stdin"] for c in cases])
    compile_error = res.get("status") == "error"
    compile_text = _typed_error_text(lang, res, code, spec, shift) if compile_error else ""
    outputs = res.get("results") or []
    results = []
    for index, case in enumerate(cases):
        one = outputs[index] if index < len(outputs) else {}
        entry = {"id": case["id"], "input": case["input"], "expected_output": None if case["custom"] else json.dumps(case["expected"], separators=(",", ":")),
                 "actual_output": "", "error": None, "error_type": None, "timed_out": bool(one.get("timed_out")),
                 "execution_time_ms": one.get("execution_time_ms"), "passed": None if case["custom"] else False, "stdout": ""}
        if case["custom"]:
            entry["custom"] = True
        if compile_error:
            entry.update(error=compile_text, error_type="Compilation Error")
        else:
            cls = judge0_service.classify_execution(one)
            raw = _trim(one.get("stdout"))
            if cls == judge0_service.OK:
                found, value, own = coding_spec.parse_result(raw, marker)
                entry["stdout"] = own
                if found:
                    entry["actual_output"] = json.dumps(value, separators=(",", ":"))
                    if not case["custom"]:
                        entry["passed"] = coding_spec.compare_values(spec, value, case["expected"])
                else:
                    entry.update(error="The program did not return a result. Make sure your function returns its answer and does not exit early.",
                                 error_type="Runtime Error")
            else:
                text = coding_spec.fix_error_lines(lang, _trim(one.get("stderr")) or _trim(one.get("output")), shift)
                _, _, own = coding_spec.parse_result(raw, marker)
                entry.update(stdout=own, error=text or None, error_type="Time Limit Exceeded" if cls == judge0_service.TIME_LIMIT_EXCEEDED else "Runtime Error")
        results.append(entry)

    graded = [r for r in results if not r.get("custom")]
    all_passed = bool(graded) and all(r["passed"] for r in graded)
    first = results[0] if results else {}
    return {
        "status": "success", "language": lang, "all_passed": all_passed, "sample_test_passed": all_passed,
        "stdout": first.get("actual_output", ""), "stderr": first.get("error") or "", "error_type": first.get("error_type"),
        "execution_time_ms": first.get("execution_time_ms"), "expected_output": first.get("expected_output", ""),
        "actual_output": first.get("actual_output", ""), "test_results": results,
    }


def _default_execute_batch(language: str, code: str, stdins: List[str]) -> Dict[str, Any]:
    return judge0_service.execute_batch(language, code, stdins)


def _batch_with_retry(execute_batch: ExecuteBatch, language: str, program: str, stdins: List[str]) -> Dict[str, Any]:
    """
    One batch (compile + every test). A saturated sandbox is waited out briefly, never penalized; a failure that says nothing was
    submitted (`retryable`) is retried; anything else that is a sandbox fault raises SandboxUnavailable (nothing is scored).
    Returns a result whose status is "success" (per-test results) or "error" (the code did not compile).
    """
    for attempt in range(BUSY_RETRIES):
        last = attempt == BUSY_RETRIES - 1
        try:
            res = execute_batch(language, program, stdins)
        except SandboxBusy:
            if last:
                raise SandboxUnavailable("sandbox saturated")
            time.sleep(BUSY_RETRY_DELAY)
            continue
        if res.get("status") == "service_error":
            if res.get("retryable") and not last:
                time.sleep(min(float(res.get("retry_after") or 0.5), 2.0))
                continue
            raise SandboxUnavailable(res.get("output") or "sandbox unavailable")
        return res
    raise SandboxUnavailable("sandbox saturated")


run_batch_with_retry = _batch_with_retry     # public name for the blueprint verifier (services.coding_problem_factory)


def _typed_error_text(language: str, res: Dict[str, Any], code: str, spec: Dict[str, Any], shift: int) -> str:
    raw = _trim(res.get("compile_output")) or _trim(res.get("stderr")) or _trim(res.get("output"))
    return coding_spec.friendly_compile_error(language, coding_spec.fix_error_lines(language, raw, shift), code, spec) or ""


def _grade_typed(spec: Dict[str, Any], language: str, code: str, tests: List[Dict[str, Any]], execute_batch: ExecuteBatch) -> Dict[str, Any]:
    """Run one student solution over every graded test with a single batch; returns {passed, classification, message, tests: [...]}."""
    marker = coding_spec.new_marker()
    program, shift = coding_spec.compose(spec, language, code, marker)
    res = _batch_with_retry(execute_batch, language, program, [t["input"] for t in tests])
    if res.get("status") == "error":
        message = _typed_error_text(language, res, code, spec, shift)[:2048]
        return {"passed": 0, "classification": judge0_service.COMPILATION_ERROR, "message": message,
                "tests": [{"id": t.get("id"), "passed": False, "example": bool(t.get("example")), "status": judge0_service.COMPILATION_ERROR} for t in tests]}
    passed, worst, message, detail = 0, judge0_service.OK, "", []
    for test, one in zip(tests, res.get("results") or []):
        cls = judge0_service.classify_execution(one)
        ok = False
        text = ""
        if cls == judge0_service.OK:
            found, value, _ = coding_spec.parse_result(_trim(one.get("stdout")), marker)
            if found:
                ok = coding_spec.compare_values(spec, value, test["expected"])
            else:
                cls, text = judge0_service.RUNTIME_ERROR, "The program did not return a result."
        else:
            text = _trim(one.get("stderr")) or _trim(one.get("output"))
        passed += 1 if ok else 0
        if cls != judge0_service.OK and worst == judge0_service.OK:
            worst, message = cls, coding_spec.fix_error_lines(language, text, shift)[:2048]
        detail.append({"id": test.get("id"), "passed": ok, "example": bool(test.get("example")), "status": cls})
    return {"passed": passed, "classification": worst, "message": message, "tests": detail}


def evaluate_coding(problems: List[Dict[str, Any]], hidden_keys: Dict[str, Any], solutions: Optional[Dict[str, Any]], *,
                    execute: Optional[Execute] = None, concurrency: int = CODING_TEST_CONCURRENCY,
                    execute_batch: Optional[ExecuteBatch] = None) -> Dict[str, Any]:
    """
    Evaluate submitted solutions against the confidential tests (the student platform's section logic):
    the section score is tests passed / tests total, as a percentage. An empty solution scores zero
    without touching the sandbox. Raises SandboxUnavailable if the sandbox cannot be reached (nothing is scored).

    problems    = the client-safe problem list (ids, titles)
    hidden_keys = {pid: {"hidden_test_cases": [...], "comparison": "text"|"json"}} for stdin/stdout problems, or
                  {pid: {"spec": <coding_spec signature>, "hidden_test_cases": [{"input": <stdin>, "expected": <value>, "example": bool}]}}
                  for typed (LeetCode-style, any language) problems: those run as ONE batch (compile once) per problem.
    solutions   = {pid: {"code": str, "language": "python"|"java"|"cpp"|"c"}}
    """
    execute = execute or _default_execute
    execute_batch = execute_batch or _default_execute_batch
    solutions = solutions or {}
    jobs: List[Tuple[int, str, str, str, str, str]] = []   # (problem index, expected, mode, language, code, stdin)
    typed_jobs: List[Tuple[int, Dict[str, Any], str, str, List[Dict[str, Any]]]] = []   # (problem index, spec, language, code, tests)
    plans: List[Tuple[Dict[str, Any], str, str, int]] = []
    total_hidden = 0
    for prob in problems or []:
        pid = str(prob.get("id"))
        sol = solutions.get(pid) or {}
        code = sol.get("code", "") or ""
        info = hidden_keys.get(pid) or {}
        hidden = info.get("hidden_test_cases", [])
        spec = info.get("spec")
        if spec:
            try:
                lang = coding_spec.normalize_language(sol.get("language"))
            except ValueError:
                lang = "python"
            plans.append((prob, pid, lang, len(hidden)))
            total_hidden += len(hidden)
            if code.strip():
                typed_jobs.append((len(plans) - 1, spec, lang, code, hidden))
            continue
        try:
            lang = normalize_language(sol.get("language"))
        except ValueError:
            lang = "python"        # a language this problem does not offer is graded as Python, as the draft normalization does
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

    # Typed problems: one batch per problem (compile once, run every test). Problems run side by side; each batch takes one sandbox turn.
    typed_results: Dict[int, Dict[str, Any]] = {}
    if typed_jobs:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(concurrency, len(typed_jobs)))) as pool:
            outcomes = list(pool.map(lambda j: _grade_typed(j[1], j[2], j[3], j[4], execute_batch), typed_jobs))
        for job, outcome in zip(typed_jobs, outcomes):
            typed_results[job[0]] = outcome

    problem_results = []
    passed_total = 0
    for idx, (prob, pid, lang, prob_total) in enumerate(plans):
        typed = typed_results.get(idx)
        passed = typed["passed"] if typed else passed_by_problem[idx]
        passed_total += passed
        code_present = typed is not None or any(j[0] == idx for j in jobs)
        classification = typed["classification"] if typed else worst.get(idx, judge0_service.OK if code_present else "NO_SUBMISSION")
        item = {
            "problem_id": pid, "title": prob.get("title"), "language": lang,
            "passed_tests": passed, "total_tests": prob_total,
            "score": (passed / prob_total * 100) if prob_total > 0 else 0.0,
            "classification": classification,
            "message": typed["message"] if typed else message.get(idx, ""),
        }
        if typed:
            item["tests"] = typed["tests"]       # pass / fail per test (ids and verdicts only: never inputs or expected values)
        problem_results.append(item)
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
                lang = coding_spec.normalize_language(sol.get("language"))       # python | java | cpp | c (a problem decides which it offers)
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


def _adapt_typed_problem(p: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    A v2 blueprint problem (typed signature, 2 examples + 5 hidden tests) -> (what the browser gets, what stays on the server).
    The browser gets the starter code of EVERY language, the signature, and only the 2 examples. The server keeps the spec and all 7
    graded tests (the 2 examples and the 5 hidden ones); expected values and the reference solution never leave it.
    """
    pid = str(p["id"])
    spec = coding_spec.validate_spec({**p["signature"], "compare": p.get("compare")})
    names = [prm["name"] for prm in spec["params"]]

    def values_of(case: Dict[str, Any]) -> List[Any]:
        data = case["input"]
        return [data[n] for n in names] if isinstance(data, dict) else list(data)

    public, graded = [], []
    explanations = p.get("examples") or []
    for i, case in enumerate(p["public_test_cases"]):
        values = coding_spec.check_args(spec, values_of(case))
        expected = coding_spec.check_value(case["expected"], spec["returns"], "expected")
        explanation = (case.get("explanation") or (explanations[i].get("explanation") if i < len(explanations) and isinstance(explanations[i], dict) else "")) or ""
        public.append({"id": f"{pid}-p{i + 1}", "input": coding_spec.display_input(spec, values), "args": coding_spec.display_values(spec, values),
                       "expected_output": json.dumps(expected, separators=(",", ":")), "explanation": explanation})
        graded.append({"id": f"{pid}-p{i + 1}", "input": coding_spec.encode_input(spec, values), "expected": expected, "example": True})
    for i, case in enumerate(p["hidden_test_cases"]):
        values = coding_spec.check_args(spec, values_of(case))
        expected = coding_spec.check_value(case["expected"], spec["returns"], "expected")
        graded.append({"id": f"{pid}-h{i + 1}", "input": coding_spec.encode_input(spec, values), "expected": expected, "example": False})
    constraints = p.get("constraints") or []
    client = {
        "id": pid, "title": p["title"], "difficulty": p.get("difficulty", "Medium"), "description": p["description"],
        "input_format": "", "output_format": "",
        "constraints": "\n".join(constraints) if isinstance(constraints, list) else str(constraints),
        "function_name": spec["name"], "params": spec["params"], "returns": spec["returns"],
        "languages": list(coding_spec.LANGUAGES), "starter_code": coding_spec.all_starters(spec),
        "public_test_cases": public,
    }
    return client, {"spec": spec, "comparison": "typed", "hidden_test_cases": graded}


# An option that points at other options ("both A and B", "all of the above", "option C") stops being true when the options are reordered.
_OPTION_REFERENCE = re.compile(r"\b(?i:all|none|both|neither)\s+(?i:of)\s+(?i:the\s+)?(?i:above|these|them|those)\b|\b(?i:both|and|or|option|choice|answer)\s+\(?[A-D]\)?(?![A-Za-z])|(?<![A-Za-z])[A-D]\s+(?i:and|or)\s+[A-D](?![A-Za-z])|(?<![A-Za-z])[A-D]\s*&\s*[A-D](?![A-Za-z])")


def shuffle_aptitude(client: List[Dict[str, Any]], keys: Dict[str, Any], rng=None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    A different aptitude paper for every candidate: the questions come in a random order and each question's options in a random order
    (relabelled A-D in the order shown), and the server-side answer key is remapped to match, so scoring is unchanged. Candidates sitting
    side by side or sharing answers in a chat cannot match "question 3 is C". A question whose options refer to each other keeps its option order.
    """
    rng = rng or random.SystemRandom()
    questions = [dict(q) for q in client]
    new_keys = {qid: dict(info) for qid, info in keys.items()}
    for q in questions:
        options = list(q.get("options") or [])
        qid = str(q.get("id"))
        if len(options) != 4 or qid not in new_keys or any(_OPTION_REFERENCE.search(str(o.get("text", ""))) for o in options):
            continue
        order = list(range(4))
        rng.shuffle(order)
        original_correct = str(new_keys[qid].get("correct_key", "")).strip().upper()
        shuffled, new_correct = [], original_correct
        for position, source in enumerate(order):
            letter = "ABCD"[position]
            shuffled.append({"key": letter, "text": options[source]["text"]})
            if options[source]["key"] == original_correct:
                new_correct = letter
        q["options"] = shuffled
        new_keys[qid]["correct_key"] = new_correct
    rng.shuffle(questions)
    return questions, new_keys


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
        if p.get("signature"):
            client, keys = _adapt_typed_problem(p)
            code_client.append(client)
            code_keys[pid] = keys
            continue
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
        parts = function_style.rename_function(function_style.to_function_style(starter), p["title"])
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
