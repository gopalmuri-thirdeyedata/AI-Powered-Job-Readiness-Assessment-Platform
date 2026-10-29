"""
Run a student's code against the public sample tests (and their own testcase), for every assessment flow.

One implementation for the self-start assessment and the admin's shared link, so both behave the same: the hidden driver is added around the
student's code, the run waits its turn in the fair line in front of the sandbox, the student's own testcase runs next to the samples, and
error line numbers match what the student sees in the editor.
"""
from typing import Any, Dict, Optional

from services import assessment_engine as engine
from services import coding_spec, function_style, student_sandbox


def run_samples(problem: Dict[str, Any], code: str, language: str, *, driver: Optional[str] = None,
                custom_input: Optional[str] = None, comparison: str = "text", spec: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if spec:
        # Typed (LeetCode-style, any language) problem: the two examples and the student's own testcase run as ONE batch (compile once).
        # A testcase that does not fit the parameters is a ValueError whose message tells the student what to fix.
        custom = coding_spec.parse_custom_input(spec, custom_input) if custom_input is not None and custom_input.strip() else None
        return engine.run_typed_samples(problem, spec, code, language, execute_batch=student_sandbox.run_batch, custom_values=custom)
    program = function_style.compose(code, driver) if language == "python" else code
    result = engine.run_sample_tests(problem, program, language, execute=student_sandbox.run, comparison=comparison)
    if custom_input is not None and custom_input.strip():
        # Same execution and error shaping as a sample test, but nothing to compare against: the student only wants to see the output.
        own = engine.run_sample_tests({"public_test_cases": [{"input": custom_input, "expected_output": ""}]}, program, language,
                                      execute=student_sandbox.run, comparison=comparison)
        ran = (own.get("test_results") or [{}])[0]
        result["test_results"] = (result.get("test_results") or []) + [{
            "id": "custom", "custom": True, "input": custom_input, "expected_output": None, "actual_output": ran.get("actual_output", ""),
            "error": ran.get("error"), "error_type": ran.get("error_type"), "timed_out": ran.get("timed_out", False),
            "execution_time_ms": ran.get("execution_time_ms"), "passed": None}]
    shift = function_style.prelude_line_count(driver) if language == "python" else 0
    if shift:        # the hidden import line is not in the student's editor: keep the line numbers in errors theirs
        result["stderr"] = function_style.fix_line_numbers(result.get("stderr"), shift)
        for item in result.get("test_results") or []:
            item["error"] = function_style.fix_line_numbers(item.get("error"), shift)
    return result
