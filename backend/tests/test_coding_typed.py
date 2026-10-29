"""
Typed (LeetCode-style) coding problems: signature spec, generated starters and drivers, comparison, the engine's batch grading,
blueprint verification, and (optionally) all four languages against a REAL code runner.

Everything here runs offline with plain Python. The cross-language matrix at the bottom only runs when PW_RUNNER_URL points at a running
code-runner (see the testing guide): `PW_RUNNER_URL=http://127.0.0.1:2358/submissions pytest tests/test_coding_typed.py -k matrix`.
"""
import copy
import json
import os
import re

import pytest

from services import assessment_engine as engine
from services import coding_problem_factory as factory
from services import coding_spec as cs
from services import gemini_mock_fixtures, judge0_service

TWO_SUM = {"name": "twoSum", "params": [{"name": "nums", "type": "int[]"}, {"name": "target", "type": "int"}], "returns": "int[]"}
TWO_SUM_PY = ("class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n"
              "        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n"
              "                return [seen[target - x], i]\n            seen[x] = i\n        return []\n")


# ------------------------------------------------------------------ the signature
def test_signature_is_validated_for_all_languages():
    spec = cs.validate_spec(TWO_SUM)
    assert spec["name"] == "twoSum" and spec["compare"] == "exact"
    for bad in (
        {**TWO_SUM, "name": "class"}, {**TWO_SUM, "name": "two_sum"}, {**TWO_SUM, "name": "main"},
        {**TWO_SUM, "returns": "ListNode"}, {**TWO_SUM, "params": []},
        {**TWO_SUM, "params": [{"name": "a", "type": "int"}, {"name": "A", "type": "int"}]},
        {**TWO_SUM, "params": [{"name": "int", "type": "int"}]},
    ):
        with pytest.raises(ValueError):
            cs.validate_spec(bad)
    assert cs.validate_spec({**TWO_SUM, "compare": "unordered"})["compare"] == "unordered"
    assert cs.validate_spec({**TWO_SUM, "returns": "int", "compare": "unordered"})["compare"] == "exact"      # order is meaningless for a scalar


def test_starter_code_exists_for_every_language_and_shows_only_the_signature():
    starters = cs.all_starters(cs.validate_spec(TWO_SUM))
    assert set(starters) == {"python", "java", "cpp", "c"}
    assert "def twoSum(self, nums: List[int], target: int) -> List[int]:" in starters["python"]
    assert "public int[] twoSum(int[] nums, int target)" in starters["java"]
    assert "vector<int> twoSum(vector<int>& nums, int target)" in starters["cpp"] and starters["cpp"].startswith("class Solution {\npublic:")
    assert "int* twoSum(int* nums, int numsSize, int target, int* returnSize)" in starters["c"]
    for text in starters.values():            # nothing but the signature: no main, no I/O, no helper code, no solution
        code = re.sub(r"/\*.*?\*/", "", text, flags=re.S)                       # the C starter has a doc comment, as LeetCode's does
        assert "main" not in code and "stdin" not in code.lower() and "return" not in code.replace("returnSize", "").replace("returnColumnSizes", "")


def test_every_type_has_a_starter_in_every_language():
    for t in cs.TYPES:
        spec = cs.validate_spec({"name": "f", "params": [{"name": "x", "type": t}], "returns": t})
        for lang in cs.LANGUAGES:
            assert "f(" in cs.starter_code(spec, lang)


# ------------------------------------------------------------------ values and the stdin format
def test_stdin_format_is_one_value_per_line_and_validated():
    spec = cs.validate_spec(TWO_SUM)
    assert cs.encode_input(spec, [[2, 7, 11, 15], 9]) == "4\n2 7 11 15\n9\n"
    assert cs.encode_input(spec, [[], 0]) == "0\n\n0\n"
    for bad in ([[1, "x"], 1], [[1], 1.5], [[1], True], [1], [[1], 2 ** 40]):
        with pytest.raises(ValueError):
            cs.encode_input(spec, bad)
    text = cs.validate_spec({"name": "f", "params": [{"name": "w", "type": "string[]"}, {"name": "g", "type": "int[][]"},
                                                       {"name": "b", "type": "bool"}, {"name": "d", "type": "double"}], "returns": "int"})
    assert cs.encode_input(text, [["ab", ""], [[1, 2], []], True, 2.5]) == "2\nab\n\n2\n2 1 2\n0\n1\n2.5\n"
    with pytest.raises(ValueError):
        cs.encode_input(text, [["a\nb"], [[1]], True, 1.0])           # a string stays on one line


def test_display_and_custom_input():
    spec = cs.validate_spec(TWO_SUM)
    assert cs.display_input(spec, [[2, 7], 9]) == "nums = [2,7]\ntarget = 9"
    assert cs.parse_custom_input(spec, "[1,2,3]\n6") == [[1, 2, 3], 6]
    for bad, fragment in (("[1,2,3]", "needs 2 line"), ("[1,2\n6", "not valid"), ("[1,\"a\"]\n6", "nums"), ("[1]\nsix", "not valid")):
        with pytest.raises(ValueError) as exc:
            cs.parse_custom_input(spec, bad)
        assert fragment in str(exc.value)


def test_compare_modes_and_tolerance():
    exact = cs.validate_spec(TWO_SUM)
    assert cs.compare_values(exact, [0, 1], [0, 1]) and not cs.compare_values(exact, [1, 0], [0, 1])
    unordered = cs.validate_spec({**TWO_SUM, "compare": "unordered"})
    assert cs.compare_values(unordered, [1, 0], [0, 1]) and not cs.compare_values(unordered, [1, 1], [0, 1])
    nested = cs.validate_spec({"name": "f", "params": [{"name": "x", "type": "int"}], "returns": "int[][]", "compare": "unordered_nested"})
    assert cs.compare_values(nested, [[3, 1], [2]], [[2], [1, 3]])
    dbl = cs.validate_spec({"name": "f", "params": [{"name": "x", "type": "int"}], "returns": "double"})
    assert cs.compare_values(dbl, 0.1 + 0.2, 0.3) and cs.compare_values(dbl, 3, 3.0) and not cs.compare_values(dbl, 0.31, 0.3)
    boolean = cs.validate_spec({"name": "f", "params": [{"name": "x", "type": "int"}], "returns": "bool"})
    assert cs.compare_values(boolean, True, True) and not cs.compare_values(boolean, 1, True)
    integer = cs.validate_spec({"name": "f", "params": [{"name": "x", "type": "int"}], "returns": "int"})
    assert cs.compare_values(integer, 3.0, 3) and not cs.compare_values(integer, True, 1) and not cs.compare_values(integer, "3", 3)


def test_result_is_read_from_the_marked_line_and_student_prints_are_kept_apart():
    marker = cs.new_marker()
    found, value, own = cs.parse_result(f"debug 1\ndebug 2\n{marker}[0,1]\n", marker)
    assert (found, value, own) == (True, [0, 1], "debug 1\ndebug 2")
    assert cs.parse_result("[0,1]\n", marker)[0] is False                      # an unmarked line is not an answer
    assert cs.parse_result(f"{marker}[0,\n", marker)[0] is False                # truncated JSON
    assert cs.parse_result(f"{marker}1\n{marker}2\n", marker)[1] == 2           # the LAST marked line wins
    assert cs.new_marker() != cs.new_marker()


# ------------------------------------------------------------------ the program the sandbox runs (Python, locally)
def run_python(program, stdins):
    return factory.local_run_batch("python", program, stdins)


def test_python_program_round_trip_and_hidden_code_is_absent_from_the_starter():
    spec = cs.validate_spec(TWO_SUM)
    marker = cs.new_marker()
    program, shift = cs.compose(spec, "python", TWO_SUM_PY, marker)
    assert shift == 1 and program.index("class Solution") < program.index("_pw_main")
    res = run_python(program, [cs.encode_input(spec, [[2, 7, 11, 15], 9]), cs.encode_input(spec, [[3, 3], 6])])
    assert [cs.parse_result(r["stdout"], marker)[1] for r in res["results"]] == [[0, 1], [0, 1]]


def test_python_error_line_numbers_match_the_editor():
    assert cs.fix_error_lines("python", 'File "main.py", line 4, in twoSum', 1) == 'File "main.py", line 3, in twoSum'
    assert cs.fix_error_lines("java", "Main.java:4", 1) == "Main.java:4"


def test_compose_normalizes_public_java_solution_and_keeps_line_numbers():
    spec = cs.validate_spec(TWO_SUM)
    program, shift = cs.compose(spec, "java", "public class Solution {\n}\n", "@@PWx@@")
    assert program.startswith("import java.util.*; class Solution {") and shift == 0
    cpp, _ = cs.compose(spec, "cpp", "class Solution {};", "@@PWx@@")
    assert cpp.startswith("#include <bits/stdc++.h>") and "#line 1\nclass Solution {};" in cpp
    c, _ = cs.compose(spec, "c", "int* twoSum(){}", "@@PWx@@")
    assert "#line 1\nint* twoSum(){}" in c


# ------------------------------------------------------------------ blueprint verification (the reference solution decides)
def raw_problem(slot=1):
    return copy.deepcopy(gemini_mock_fixtures.sample_coding_problem(slot))


def test_a_correct_generated_problem_is_verified_and_normalized():
    problem = factory.build_problem(raw_problem(1), "C1", factory.local_run_batch)
    assert len(problem["public_test_cases"]) == 2 and len(problem["hidden_test_cases"]) == 5
    assert set(problem["starter_code"]) == {"python", "java", "cpp", "c"} and problem["signature"]["name"] == "pairIndices"
    assert problem["reference_solution"].startswith("class Solution")


def test_a_wrong_hidden_answer_is_dropped_and_too_many_wrong_ones_reject_the_problem():
    raw = raw_problem(1)
    raw["hidden_tests"][0]["expected"] = [9, 9]                              # Gemini's key is wrong; the reference solution is right
    problem = factory.build_problem(raw, "C1", factory.local_run_batch)
    assert len(problem["hidden_test_cases"]) == 5 and [9, 9] not in [h["expected"] for h in problem["hidden_test_cases"]]
    for t in raw["hidden_tests"][:5]:
        t["expected"] = [7, 7]
    with pytest.raises(factory.ProblemRejected, match="hidden"):
        factory.build_problem(raw, "C1", factory.local_run_batch)


def test_a_wrong_example_answer_rejects_the_problem():
    raw = raw_problem(1)
    raw["examples"][0]["expected"] = [1, 0]
    with pytest.raises(factory.ProblemRejected, match="disagrees"):
        factory.build_problem(raw, "C1", factory.local_run_batch)


@pytest.mark.parametrize("mutate,fragment", [
    (lambda r: r.pop("reference_solution"), "reference_solution"),
    (lambda r: r.__setitem__("reference_solution", "class Solution:\n    def pairIndices(self, nums, target):\n        return 1 +\n"), "reference solution"),
    (lambda r: r["signature"].__setitem__("returns", "ListNode"), "signature"),
    (lambda r: r.__setitem__("hidden_tests", r["hidden_tests"][:3]), "hidden"),
    (lambda r: r["examples"][0]["input"].__setitem__("nums", "oops"), "example"),
])
def test_unusable_generated_problems_are_rejected_with_a_reason(mutate, fragment):
    raw = raw_problem(1)
    mutate(raw)
    with pytest.raises(factory.ProblemRejected, match=fragment):
        factory.build_problem(raw, "C1", factory.local_run_batch)


def test_degenerate_tests_are_rejected():
    raw = raw_problem(2)
    for t in raw["examples"] + raw["hidden_tests"]:
        t["input"]["s"] = "x"
        t["expected"] = 1
    for i, t in enumerate(raw["hidden_tests"]):
        t["input"]["s"] = "x" * (i + 1)          # distinct inputs, but the reference answers 1 for every one of them
    raw["examples"][0]["input"]["s"], raw["examples"][1]["input"]["s"] = "y", "z"
    with pytest.raises(factory.ProblemRejected):
        factory.build_problem(raw, "C2", factory.local_run_batch)


# ------------------------------------------------------------------ the engine: adapter, samples, grading
@pytest.fixture(scope="module")
def adapted():
    from services import jd_blueprint_service as jd
    blueprint = jd.generate_jd_blueprint("We need a backend engineer who builds Python services, REST APIs and SQL databases in production.")
    return engine.adapt_blueprint(blueprint.model_dump())["CODING"]


def test_the_browser_gets_signature_examples_and_all_starters_but_no_answers(adapted):
    client, keys = adapted
    problem = client[0]
    blob = json.dumps(client)
    assert problem["params"] == [{"name": "nums", "type": "int[]"}, {"name": "target", "type": "int"}] and problem["languages"] == ["python", "java", "cpp", "c"]
    assert len(problem["public_test_cases"]) == 2 and problem["public_test_cases"][0]["input"] == "nums = [2,7,11,15]\ntarget = 9"
    assert problem["public_test_cases"][0]["args"] == ["[2,7,11,15]", "9"] and problem["public_test_cases"][0]["expected_output"] == "[0,1]"
    for secret in ("reference", "hidden", "class Solution:\n        seen", "[1,3]"):          # [1,3] is a hidden expected value
        assert secret not in blob
    assert len(keys["C1"]["hidden_test_cases"]) == 7 and sum(1 for t in keys["C1"]["hidden_test_cases"] if t["example"]) == 2


def python_sandbox(language, program, stdins):
    assert language == "python"
    return run_python(program, stdins)


def test_run_typed_samples_reports_the_shape_the_ui_renders(adapted):
    client, keys = adapted
    spec = keys["C1"]["spec"]
    good = engine.run_typed_samples(client[0], spec, TWO_SUM_PY.replace("twoSum", "pairIndices"), "python", execute_batch=python_sandbox)
    assert good["all_passed"] is True and [t["passed"] for t in good["test_results"]] == [True, True]
    assert good["test_results"][0]["input"] == "nums = [2,7,11,15]\ntarget = 9" and good["test_results"][0]["actual_output"] == "[0,1]"
    wrong = engine.run_typed_samples(client[0], spec, "class Solution:\n    def pairIndices(self, nums, target):\n        return [0, 0]\n", "python",
                                     execute_batch=python_sandbox, custom_values=[[1, 2], 3])
    assert wrong["all_passed"] is False and wrong["test_results"][-1]["custom"] is True and wrong["test_results"][-1]["passed"] is None
    assert wrong["test_results"][0]["expected_output"] == "[0,1]" and wrong["test_results"][0]["actual_output"] == "[0,0]"
    crash = engine.run_typed_samples(client[0], spec, "class Solution:\n    def pairIndices(self, nums, target):\n        raise ValueError('boom')\n",
                                     "python", execute_batch=python_sandbox)
    assert crash["error_type"] == "Runtime Error" and "boom" in crash["stderr"] and "line 3" in crash["stderr"]     # editor line, not the hidden prelude's
    prints = engine.run_typed_samples(client[0], spec, TWO_SUM_PY.replace("twoSum", "pairIndices").replace("seen = {}", "seen = {}\n        print('hello')"),
                                      "python", execute_batch=python_sandbox)
    assert prints["all_passed"] is True and prints["test_results"][0]["stdout"] == "hello"


def test_a_program_that_returns_nothing_is_a_runtime_error_not_a_pass(adapted):
    client, keys = adapted
    res = engine.run_typed_samples(client[0], keys["C1"]["spec"], "import sys\nclass Solution:\n    def pairIndices(self, nums, target):\n        sys.exit(0)\n",
                                   "python", execute_batch=python_sandbox)
    assert res["all_passed"] is False and res["error_type"] == "Runtime Error" and "did not return" in res["test_results"][0]["error"]


def test_compile_error_is_reported_for_every_case():
    spec = cs.validate_spec(TWO_SUM)
    problem = {"public_test_cases": [{"id": "p1", "args": ["[1,2]", "3"], "expected_output": "[0,1]"}]}

    def compile_failure(language, program, stdins):
        return {"status": "error", "compile_output": "Main.java:3: error: missing return statement", "output": "", "results": []}

    res = engine.run_typed_samples(problem, spec, "class Solution {}", "java", execute_batch=compile_failure)
    assert res["error_type"] == "Compilation Error" and "missing return statement" in res["stderr"] and res["all_passed"] is False


def test_grading_runs_one_batch_per_problem_and_scores_all_seven_tests(adapted):
    client, keys = adapted
    batches = []

    def spy(language, program, stdins):
        batches.append(len(stdins))
        return python_sandbox(language, program, stdins)

    good = {"C1": {"language": "python", "code": TWO_SUM_PY.replace("twoSum", "pairIndices")}}
    result = engine.evaluate_coding(client[:1], keys, good, execute_batch=spy)
    assert batches == [7] and result["score"] == 100.0 and result["problems"][0]["passed_tests"] == 7 == result["problems"][0]["total_tests"]
    assert all(t["passed"] for t in result["problems"][0]["tests"]) and "expected" not in json.dumps(result)
    half = {"C1": {"language": "python", "code": "class Solution:\n    def pairIndices(self, nums, target):\n        return [0, 1]\n"}}
    partial = engine.evaluate_coding(client[:1], keys, half, execute_batch=python_sandbox)
    assert 0 < partial["problems"][0]["passed_tests"] < 7 and partial["problems"][0]["classification"] == judge0_service.OK
    empty = engine.evaluate_coding(client, keys, {}, execute_batch=lambda *a: pytest.fail("an empty solution must not touch the sandbox"))
    assert empty["score"] == 0.0 and {p["classification"] for p in empty["problems"]} == {"NO_SUBMISSION"}


def test_grading_never_scores_a_sandbox_outage(adapted):
    client, keys = adapted
    down = lambda *a: {"status": "service_error", "output": "down", "retryable": False, "results": []}      # noqa: E731
    with pytest.raises(engine.SandboxUnavailable):
        engine.evaluate_coding(client[:1], keys, {"C1": {"language": "python", "code": "class Solution: pass"}}, execute_batch=down)


def test_a_busy_runner_is_waited_out_and_never_penalizes(adapted, monkeypatch):
    client, keys = adapted
    monkeypatch.setattr(engine, "BUSY_RETRY_DELAY", 0)
    state = {"n": 0}

    def flaky(language, program, stdins):
        state["n"] += 1
        if state["n"] < 3:
            return {"status": "service_error", "output": "busy", "retryable": True, "retry_after": 0, "results": []}
        return python_sandbox(language, program, stdins)

    out = engine.evaluate_coding(client[:1], keys, {"C1": {"language": "python", "code": TWO_SUM_PY.replace("twoSum", "pairIndices")}}, execute_batch=flaky)
    assert out["score"] == 100.0 and state["n"] == 3


def test_submission_keeps_the_chosen_language_for_every_supported_language():
    problems = [{"id": "C1"}]
    for lang in ("python", "java", "cpp", "c"):
        kept = engine.normalize_submission("CODING", {"solutions": {"C1": {"language": lang, "code": "x"}}}, problems)
        assert kept["solutions"]["C1"]["language"] == lang
    assert engine.normalize_submission("CODING", {"solutions": {"C1": {"language": "c++", "code": "x"}}}, problems)["solutions"]["C1"]["language"] == "cpp"
    assert engine.normalize_submission("CODING", {"solutions": {"C1": {"language": "ruby", "code": "x"}}}, problems)["solutions"]["C1"]["language"] == "python"


# ------------------------------------------------------------------ batch adapter (judge0_service)
def test_batch_result_shapes_from_the_runner(monkeypatch):
    ok = {"status": {"id": 3}, "compile_output": "", "results": [
        {"stdout": "a", "stderr": "", "time": "0.01", "status": {"id": 3}},
        {"stdout": "", "stderr": "", "time": "6", "status": {"id": 5}},
        {"stdout": "", "stderr": "Segmentation fault", "time": "0.01", "status": {"id": 11}}]}
    out = judge0_service._interpret_batch(ok, 3)
    assert out["status"] == "success" and [judge0_service.classify_execution(r) for r in out["results"]] == [
        judge0_service.OK, judge0_service.TIME_LIMIT_EXCEEDED, judge0_service.RUNTIME_ERROR]
    compile_error = judge0_service._interpret_batch({"status": {"id": 6}, "compile_output": "boom", "results": []}, 3)
    assert compile_error["status"] == "error" and compile_error["compile_output"] == "boom" and compile_error["results"] == []
    assert judge0_service._interpret_batch({"status": {"id": 13, "description": "Internal Error"}}, 3)["status"] == "service_error"
    with pytest.raises(judge0_service._Malformed):
        judge0_service._interpret_batch(ok, 2)             # the runner must answer once per input


def test_without_a_runner_each_test_runs_on_its_own(monkeypatch):
    monkeypatch.delenv("CODE_RUNNER_URL", raising=False)
    seen = []

    def one(language, code, stdin=""):
        seen.append(stdin)
        return {"status": "success", "output": stdin, "stdout": stdin, "stderr": "", "compile_output": "", "timed_out": False, "execution_time_ms": 1.0, "raw": {}}

    monkeypatch.setattr(judge0_service, "execute_code", one)
    out = judge0_service.execute_batch("python", "print(1)", ["a", "b", "c"])
    assert out["status"] == "success" and seen == ["a", "b", "c"] and [r["stdout"] for r in out["results"]] == ["a", "b", "c"]
    monkeypatch.setattr(judge0_service, "execute_code", lambda *a, **k: {"status": "error", "output": "bad", "compile_output": "bad", "stdout": "", "stderr": "",
                                                                          "timed_out": False, "execution_time_ms": None, "raw": {}})
    assert judge0_service.execute_batch("cpp", "x", ["a", "b"])["status"] == "error"


# ------------------------------------------------------------------ all four languages on a REAL runner (opt-in)
# (name, params, returns, compare, [(args, expected)], {language: solution})
MATRIX = [
    ("twoSum", [("nums", "int[]"), ("target", "int")], "int[]", "exact", [([[2, 7, 11, 15], 9], [0, 1]), ([[3, 2, 4], 6], [1, 2]), ([[3, 3], 6], [0, 1])], {
        "python": TWO_SUM_PY,
        "java": "class Solution { public int[] twoSum(int[] nums, int target) { for (int i = 0; i < nums.length; i++) for (int j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] == target) return new int[]{i, j}; return new int[0]; } }",
        "cpp": "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j}; return {}; } };",
        "c": "int* twoSum(int* nums, int numsSize, int target, int* returnSize) { for (int i = 0; i < numsSize; i++) for (int j = i + 1; j < numsSize; j++) if (nums[i] + nums[j] == target) { int* r = malloc(2 * sizeof(int)); r[0] = i; r[1] = j; *returnSize = 2; return r; } *returnSize = 0; return NULL; }"}),
    ("reverseString", [("s", "string")], "string", "exact", [(["abc"], "cba"), ([""], ""), (['say "hi"\\'], '\\"ih" yas')], {
        "python": "class Solution:\n    def reverseString(self, s: str) -> str:\n        return s[::-1]\n",
        "java": "class Solution { public String reverseString(String s) { return new StringBuilder(s).reverse().toString(); } }",
        "cpp": "class Solution { public: string reverseString(string s) { reverse(s.begin(), s.end()); return s; } };",
        "c": "char* reverseString(char* s) { int n = strlen(s); char* r = malloc(n + 1); for (int i = 0; i < n; i++) r[i] = s[n - 1 - i]; r[n] = 0; return r; }"}),
    ("average", [("xs", "double[]")], "double", "exact", [([[1, 2, 3]], 2.0), ([[0.5, 0.25]], 0.375), ([[]], 0.0)], {
        "python": "class Solution:\n    def average(self, xs: List[float]) -> float:\n        return sum(xs) / len(xs) if xs else 0.0\n",
        "java": "class Solution { public double average(double[] xs) { if (xs.length == 0) return 0; double s = 0; for (double x : xs) s += x; return s / xs.length; } }",
        "cpp": "class Solution { public: double average(vector<double>& xs) { if (xs.empty()) return 0; double s = 0; for (double x : xs) s += x; return s / xs.size(); } };",
        "c": "double average(double* xs, int xsSize) { if (xsSize == 0) return 0; double s = 0; for (int i = 0; i < xsSize; i++) s += xs[i]; return s / xsSize; }"}),
    ("allPositive", [("a", "long[]"), ("strict", "bool")], "bool", "exact", [([[1, 2], True], True), ([[0, 5], True], False), ([[0, 5], False], True), ([[4000000000, 1], True], True), ([[], True], True)], {
        "python": "class Solution:\n    def allPositive(self, a: List[int], strict: bool) -> bool:\n        return all((x > 0) if strict else (x >= 0) for x in a)\n",
        "java": "class Solution { public boolean allPositive(long[] a, boolean strict) { for (long x : a) { if (strict ? x <= 0 : x < 0) return false; } return true; } }",
        "cpp": "class Solution { public: bool allPositive(vector<long long>& a, bool strict) { for (long long x : a) { if (strict ? x <= 0 : x < 0) return false; } return true; } };",
        "c": "bool allPositive(long long* a, int aSize, bool strict) { for (int i = 0; i < aSize; i++) { if (strict ? a[i] <= 0 : a[i] < 0) return false; } return true; }"}),
    ("lengths", [("words", "string[]")], "int[]", "exact", [([["a", "bb", ""]], [1, 2, 0]), ([[]], [])], {
        "python": "class Solution:\n    def lengths(self, words: List[str]) -> List[int]:\n        return [len(w) for w in words]\n",
        "java": "class Solution { public int[] lengths(String[] words) { int[] r = new int[words.length]; for (int i = 0; i < r.length; i++) r[i] = words[i].length(); return r; } }",
        "cpp": "class Solution { public: vector<int> lengths(vector<string>& words) { vector<int> r; for (auto& w : words) r.push_back((int)w.size()); return r; } };",
        "c": "int* lengths(char** words, int wordsSize, int* returnSize) { int* r = malloc(sizeof(int) * (wordsSize + 1)); for (int i = 0; i < wordsSize; i++) r[i] = strlen(words[i]); *returnSize = wordsSize; return r; }"}),
    ("transpose", [("m", "int[][]")], "int[][]", "exact", [([[[1, 2, 3], [4, 5, 6]]], [[1, 4], [2, 5], [3, 6]]), ([[[1]]], [[1]])], {
        "python": "class Solution:\n    def transpose(self, m: List[List[int]]) -> List[List[int]]:\n        return [list(r) for r in zip(*m)]\n",
        "java": "class Solution { public int[][] transpose(int[][] m) { int[][] r = new int[m[0].length][m.length]; for (int i = 0; i < m.length; i++) for (int j = 0; j < m[0].length; j++) r[j][i] = m[i][j]; return r; } }",
        "cpp": "class Solution { public: vector<vector<int>> transpose(vector<vector<int>>& m) { vector<vector<int>> r(m[0].size(), vector<int>(m.size())); for (size_t i = 0; i < m.size(); i++) for (size_t j = 0; j < m[0].size(); j++) r[j][i] = m[i][j]; return r; } };",
        "c": "int** transpose(int** m, int mSize, int* mColSize, int* returnSize, int** returnColumnSizes) { int cols = mColSize[0]; int** r = malloc(sizeof(int*) * cols); int* rc = malloc(sizeof(int) * cols); for (int j = 0; j < cols; j++) { r[j] = malloc(sizeof(int) * mSize); rc[j] = mSize; for (int i = 0; i < mSize; i++) r[j][i] = m[i][j]; } *returnSize = cols; *returnColumnSizes = rc; return r; }"}),
    ("sortWords", [("w", "string[]")], "string[]", "exact", [([["b", "a"]], ["a", "b"]), ([[]], [])], {
        "python": "class Solution:\n    def sortWords(self, w: List[str]) -> List[str]:\n        return sorted(w)\n",
        "java": "class Solution { public String[] sortWords(String[] w) { Arrays.sort(w); return w; } }",
        "cpp": "class Solution { public: vector<string> sortWords(vector<string>& w) { sort(w.begin(), w.end()); return w; } };",
        "c": "static int cmpw(const void* a, const void* b) { return strcmp(*(char**)a, *(char**)b); }\nchar** sortWords(char** w, int wSize, int* returnSize) { qsort(w, wSize, sizeof(char*), cmpw); *returnSize = wSize; return w; }"}),
    ("scale", [("flags", "bool[]"), ("k", "double")], "double[]", "exact", [([[True, False], 2.5], [2.5, 0.0])], {
        "python": "class Solution:\n    def scale(self, flags: List[bool], k: float) -> List[float]:\n        return [k if f else 0.0 for f in flags]\n",
        "java": "class Solution { public double[] scale(boolean[] flags, double k) { double[] r = new double[flags.length]; for (int i = 0; i < r.length; i++) r[i] = flags[i] ? k : 0; return r; } }",
        "cpp": "class Solution { public: vector<double> scale(vector<bool>& flags, double k) { vector<double> r; for (size_t i = 0; i < flags.size(); i++) r.push_back(flags[i] ? k : 0); return r; } };",
        "c": "double* scale(bool* flags, int flagsSize, double k, int* returnSize) { double* r = malloc(sizeof(double) * (flagsSize + 1)); for (int i = 0; i < flagsSize; i++) r[i] = flags[i] ? k : 0; *returnSize = flagsSize; return r; }"}),
    ("sumLong", [("a", "long"), ("b", "long")], "long", "exact", [([3000000000, 4000000000], 7000000000), ([-5, 2], -3)], {
        "python": "class Solution:\n    def sumLong(self, a: int, b: int) -> int:\n        return a + b\n",
        "java": "class Solution { public long sumLong(long a, long b) { return a + b; } }",
        "cpp": "class Solution { public: long long sumLong(long long a, long long b) { return a + b; } };",
        "c": "long long sumLong(long long a, long long b) { return a + b; }"}),
]

RUNNER = os.getenv("PW_RUNNER_URL", "").strip()


@pytest.mark.skipif(not RUNNER, reason="set PW_RUNNER_URL to a running code-runner to test the compiled languages")
@pytest.mark.parametrize("language", ["python", "java", "cpp", "c"])
@pytest.mark.parametrize("case", MATRIX, ids=[m[0] for m in MATRIX])
def test_matrix_every_language_and_type_through_the_real_runner(monkeypatch, language, case):
    name, params, returns, compare, tests, solutions = case
    monkeypatch.setenv("CODE_RUNNER_URL", RUNNER)
    monkeypatch.setenv("CODE_EXECUTION_ENGINE", "judge0")
    judge0_service.reset_circuit()
    spec = cs.validate_spec({"name": name, "params": [{"name": n, "type": t} for n, t in params], "returns": returns, "compare": compare})
    marker = cs.new_marker()
    program, _ = cs.compose(spec, language, solutions[language], marker)
    result = judge0_service.execute_batch(language, program, [cs.encode_input(spec, args) for args, _ in tests])
    assert result["status"] == "success", result.get("compile_output") or result.get("output")
    for (args, expected), one in zip(tests, result["results"]):
        assert one["status"] == "success", one.get("stderr")
        found, value, _own = cs.parse_result(one["stdout"], marker)
        assert found and cs.compare_values(spec, value, expected), (language, name, args, one["stdout"])


@pytest.mark.skipif(not RUNNER, reason="set PW_RUNNER_URL to a running code-runner to test the compiled languages")
@pytest.mark.parametrize("language", ["python", "java", "cpp", "c"])
def test_matrix_every_starter_compiles_with_the_hidden_driver_as_a_stub(monkeypatch, language):
    monkeypatch.setenv("CODE_RUNNER_URL", RUNNER)
    monkeypatch.setenv("CODE_EXECUTION_ENGINE", "judge0")
    judge0_service.reset_circuit()
    for t in cs.TYPES:
        spec = cs.validate_spec({"name": "f", "params": [{"name": "x", "type": t}, {"name": "y", "type": "int"}], "returns": t})
        program, _ = cs.compose(spec, language, cs.stub_solution(spec, language), cs.new_marker())
        result = judge0_service.execute_batch(language, program, [])                    # compile only
        assert result["status"] != "error", (language, t, result.get("compile_output"))
