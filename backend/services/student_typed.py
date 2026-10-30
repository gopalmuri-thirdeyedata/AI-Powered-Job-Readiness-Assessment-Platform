"""
Python / Java / C++ / C for the student Coding page and the student Practice page.

The Assessment coding round is the reference for which languages exist: `coding_spec.LANGUAGES` (Python3, Java, C++, C). This module adds no
language list, no starter generator and no driver of its own. It only describes each Coding / Practice problem as the typed signature
`coding_spec` already understands, and then runs it with the same pieces the Assessment uses (`coding_spec.compose` for the program,
`student_sandbox.run_batch` for the fair line in front of the sandbox, `coding_spec.parse_result` / `compare_values` for the verdict).

Python keeps its existing execution path in both features (the Python harness / stdin driver), so nothing that works today changes.
A problem whose data cannot be expressed in the typed form (linked lists, trees, nested string lists ...) simply offers Python alone,
exactly as an Assessment problem offers only the languages it has starters for.
"""
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from services import assessment_engine as engine
from services import coding_problem_bank, coding_spec, judge0_service, student_sandbox

LANGUAGES = coding_spec.LANGUAGES
SandboxUnavailable = engine.SandboxUnavailable
SandboxBusy = judge0_service.SandboxBusy

# Python annotation (as written in the Coding bank) -> coding_spec type
_PY_TO_SPEC = {"int": "int", "float": "double", "bool": "bool", "str": "string", "List[int]": "int[]", "List[float]": "double[]",
               "List[bool]": "bool[]", "List[str]": "string[]", "List[List[int]]": "int[][]"}
_WIDEN = {"int": "long", "int[]": "long[]"}
_INT32 = (-2 ** 31, 2 ** 31 - 1)


def normalize(language: Optional[str]) -> str:
    """'python' | 'java' | 'cpp' | 'c' (ValueError with the Assessment's own message otherwise)."""
    return coding_spec.normalize_language(language)


def _split_top_level(text: str) -> List[str]:
    parts, depth, current = [], 0, ""
    for ch in text:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current)
    return [p.strip() for p in parts]


def _numbers(value: Any):
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _numbers(item)


def _fits_every_test(spec: Dict[str, Any], tests: List[Tuple[List[Any], Any]]) -> bool:
    try:
        for args, expected in tests:
            coding_spec.check_args(spec, list(args))
            coding_spec.check_value(expected, spec["returns"], "expected")
    except ValueError:
        return False
    return True


# ------------------------------------------------------------------------------
# Coding page: the bank problem -> a typed signature
# ------------------------------------------------------------------------------
_coding_specs: Dict[str, Optional[Dict[str, Any]]] = {}


def coding_spec_for(slug: str, test_cases: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    The typed signature of a bank problem (its test cases are the seeded `{"args", "expected"}` rows), or None when the problem can only be
    Python: linked lists, trees, unsupported types, or test data that does not fit the typed form. Worked out once per problem.
    """
    if slug not in _coding_specs:
        problem = next((p for p in coding_problem_bank.PROBLEMS if p["slug"] == slug), None)
        _coding_specs[slug] = _build_coding_spec(problem, test_cases) if problem else None
    return _coding_specs[slug]


def _build_coding_spec(problem: Dict[str, Any], test_cases: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if any(problem.get("argtypes") or []) or (problem.get("rettype") not in (None, "plain")):
        return None                       # ListNode / TreeNode problems
    params = []
    for part in _split_top_level(problem["sig"]):
        name, _, annotation = part.partition(":")
        spec_type = _PY_TO_SPEC.get(annotation.strip())
        if spec_type is None:
            return None
        params.append({"name": name.strip(), "type": spec_type})
    returns = _PY_TO_SPEC.get(str(problem["ret"]).strip())
    if returns is None:
        return None
    cases = [(c["args"], c["expected"]) for c in test_cases]
    # An `int` that holds a value beyond 32 bits is a `long` in the other languages
    for index, param in enumerate(params):
        if param["type"] in _WIDEN and any(not (_INT32[0] <= n <= _INT32[1]) for args, _ in cases for n in _numbers(args[index])):
            param["type"] = _WIDEN[param["type"]]
    if returns in _WIDEN and any(not (_INT32[0] <= n <= _INT32[1]) for _, expected in cases for n in _numbers(expected)):
        returns = _WIDEN[returns]
    try:
        spec = coding_spec.validate_spec({"name": problem["fn"], "params": params, "returns": returns,
                                          "compare": problem.get("compare") if problem.get("compare") in coding_spec.COMPARE_MODES else "exact"})
    except ValueError:
        return None
    return spec if _fits_every_test(spec, cases) else None


# ------------------------------------------------------------------------------
# Practice page: stdin-style questions -> a typed signature
# ------------------------------------------------------------------------------
# A Practice question gives its tests as the text a Python `main` reads (arrays comma-separated on one line, one parameter per line).
# This table names the typed signature of each question by its Python function; a question that is not listed (or whose test text does not
# read back into that signature) stays Python-only.
PRACTICE_SIGNATURES: Dict[str, Dict[str, Any]] = {
    "has_two_sum": {"name": "hasTwoSum", "params": [{"name": "nums", "type": "int[]"}, {"name": "target", "type": "int"}], "returns": "bool"},
    "is_palindrome": {"name": "isPalindrome", "params": [{"name": "s", "type": "string"}], "returns": "bool"},
    "climb_stairs": {"name": "climbStairs", "params": [{"name": "n", "type": "int"}], "returns": "int"},
}


def _practice_function(question) -> Optional[str]:
    match = re.search(r"^def (\w+)\(", ((question.starter_code or {}).get("python") or ""), re.M)
    return match.group(1) if match else None


def parse_practice_input(spec: Dict[str, Any], text: str) -> List[Any]:
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    params = spec["params"]
    if len(lines) != len(params):
        raise ValueError("the test input does not match the signature")
    values = []
    for line, param in zip(lines, params):
        if param["type"] in ("int", "long"):
            values.append(int(line.strip()))
        elif param["type"] in ("int[]", "long[]"):
            values.append([int(x) for x in line.split(",") if x.strip()])
        elif param["type"] == "string":
            values.append(line)
        else:
            raise ValueError("unsupported type")
    return values


def parse_practice_expected(spec: Dict[str, Any], text: Any) -> Any:
    raw = str(text).strip()
    if spec["returns"] == "bool":
        if raw.lower() not in ("true", "false"):
            raise ValueError("bad expected value")
        return raw.lower() == "true"
    if spec["returns"] in ("int", "long"):
        return int(raw)
    if spec["returns"] == "string":
        return raw
    raise ValueError("unsupported type")


def practice_cases(spec: Dict[str, Any], question) -> List[Tuple[List[Any], Any]]:
    return [(parse_practice_input(spec, tc.get("input", "")), parse_practice_expected(spec, tc.get("expected_output", "")))
            for tc in (question.test_cases or [])]


def practice_spec_for(question) -> Optional[Dict[str, Any]]:
    """The typed signature of a CODING practice question, or None (Python only)."""
    if getattr(question, "category", None) != "CODING":
        return None
    entry = PRACTICE_SIGNATURES.get(_practice_function(question) or "")
    if not entry:
        return None
    try:
        spec = coding_spec.validate_spec(entry)
        cases = practice_cases(spec, question)
    except (ValueError, TypeError):
        return None
    return spec if cases and _fits_every_test(spec, cases) else None


# ------------------------------------------------------------------------------
# What both pages send to the editor
# ------------------------------------------------------------------------------
def offered_languages(spec: Optional[Dict[str, Any]]) -> List[str]:
    return list(LANGUAGES) if spec else ["python"]


def starters(spec: Optional[Dict[str, Any]], python_starter: Any) -> Dict[str, str]:
    """{language: starter code}. Python keeps the page's own starter; the other languages come from the Assessment's generator."""
    result = {"python": python_starter}
    if spec:
        for language in LANGUAGES:
            if language != "python":
                result[language] = coding_spec.starter_code(spec, language)
    return result


# ------------------------------------------------------------------------------
# Running
# ------------------------------------------------------------------------------
def run_cases(spec: Dict[str, Any], language: str, code: str, inputs: List[List[Any]]) -> Dict[str, Any]:
    """
    One batch (compile once, one process per case) in the student sandbox's fair line. Returns either {"compile_error": text} or
    {"cases": [{"status": "ok" | "error" | "tle", "value", "prints", "error", "ms"}]} in the order of `inputs`.
    Raises ValueError for an input that does not fit the signature and SandboxUnavailable when the sandbox is down or saturated.
    """
    lang = normalize(language)
    marker = coding_spec.new_marker()
    program, shift = coding_spec.compose(spec, lang, code, marker)
    stdins = [coding_spec.encode_input(spec, values) for values in inputs]
    res = engine.run_batch_with_retry(student_sandbox.run_batch, lang, program, stdins)
    if res.get("status") == "error":
        raw = (res.get("compile_output") or res.get("stderr") or res.get("output") or "")[:engine.MAX_OUTPUT_CHARS]
        return {"compile_error": coding_spec.friendly_compile_error(lang, coding_spec.fix_error_lines(lang, raw, shift), code, spec) or "Compile error"}
    outputs = res.get("results") or []
    cases = []
    for index in range(len(inputs)):
        one = outputs[index] if index < len(outputs) else {}
        entry = {"status": "ok", "value": None, "prints": "", "error": None, "ms": one.get("execution_time_ms")}
        classification = judge0_service.classify_execution(one)
        stdout = (one.get("stdout") or "")[:engine.MAX_OUTPUT_CHARS]
        if classification == judge0_service.OK:
            found, value, own = coding_spec.parse_result(stdout, marker)
            entry["prints"] = own
            if found:
                entry["value"] = value
            else:
                entry.update(status="error", error="The program did not return a result. Make sure your function returns its answer and does not exit early.")
        elif classification == judge0_service.TIME_LIMIT_EXCEEDED:
            entry.update(status="tle", prints=coding_spec.parse_result(stdout, marker)[2])
        else:
            text = coding_spec.fix_error_lines(lang, (one.get("stderr") or one.get("output") or "")[:engine.MAX_OUTPUT_CHARS], shift)
            entry.update(status="error", error=text or "Runtime Error", prints=coding_spec.parse_result(stdout, marker)[2])
        cases.append(entry)
    return {"cases": cases}


def compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))
