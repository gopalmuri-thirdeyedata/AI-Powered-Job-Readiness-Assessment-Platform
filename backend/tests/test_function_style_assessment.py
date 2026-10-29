"""
LeetCode structure for the student assessment coding round: the student sees `class Solution` with only the function, the server
keeps the stdin/print plumbing and adds it around the student's code whenever it is run or graded.

The sandbox here is a local Python subprocess (never the application's own code path) so the composed program really executes.
"""
import re
import subprocess
import sys
import tempfile
import time

import pytest

import models
from services import function_style as fs, judge0_service
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (fixtures)
from tests.test_student_unified_timing_scoring import (  # noqa: F401  (fixtures and helpers)
    _clean_limiter, clk, client, correct_answers, new_session, rounds, url)

STARTER = ("import sys\n\ndef top_k_categories(k, labels):\n    # Your logic here\n    pass\n\n"
           "if __name__ == '__main__':\n    lines = sys.stdin.read().splitlines()\n    print(top_k_categories(int(lines[0]), lines[1].split(',')))\n")


# ------------------------------------------------------------------ the conversion itself
def _with_body(starter):
    """The starter with a minimal body written into its empty last line (what the student does)."""
    return starter.rstrip(" \n") + "\n        pass\n"


def test_the_student_sees_only_the_function_and_the_server_keeps_the_plumbing():
    parts = fs.to_function_style(STARTER)
    assert parts["function"] == "top_k_categories"
    student = parts["starter"]
    # exactly LeetCode: the class, the signature, an empty body. No imports, no comments, no scaffolding, nothing to delete.
    assert student == "class Solution:\n    def top_k_categories(self, k, labels):\n        \n"
    compile(_with_body(student), "starter", "exec")                        # with the logic written, it is valid Python
    assert "import sys" in parts["driver"] and "Solution().top_k_categories(" in parts["driver"] and "__main__" in parts["driver"]


def test_composing_keeps_the_students_code_first_so_line_numbers_match_the_editor():
    parts = fs.to_function_style(STARTER)
    code = "class Solution:\n    def top_k_categories(self, k, labels):\n        raise ValueError('boom')\n"
    program = fs.compose(code, parts["driver"])
    hidden, rest = program.split("\n", 1)
    assert hidden == fs.prelude_for(parts["driver"]) and fs.prelude_line_count(parts["driver"]) == 1      # one hidden line: the usual imports
    assert rest.startswith(code.rstrip())
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as handle:
        handle.write(program)
    result = subprocess.run([sys.executable, handle.name], input="2\na,b,a\n", capture_output=True, text=True, timeout=20)
    shown = fs.fix_line_numbers(result.stderr, fs.prelude_line_count(parts["driver"]))
    assert "line 3" in shown and "boom" in shown                          # the student's own line numbers, not shifted by the hidden line


def test_a_signature_with_no_body_and_other_shapes_are_handled():
    bare = fs.to_function_style("def f(a, b: int) -> str:\n\nif __name__ == '__main__':\n    print(f(1, 2))\n")
    compile(_with_body(bare["starter"]), "bare", "exec")
    assert "def f(self, a, b: int) -> str:" in bare["starter"]
    no_args = fs.to_function_style("def f():\n    pass\n\nif __name__ == '__main__':\n    print(f())\n")
    assert "def f(self):" in no_args["starter"]
    multi = fs.to_function_style("def f(a,\n      b):\n    pass\n\nif __name__ == '__main__':\n    print(f(1, 2))\n")
    compile(_with_body(multi["starter"]), "multi", "exec")


@pytest.mark.parametrize("starter", [
    None, "", "def solve():\n    pass\n",                                                  # no main block
    "x = 1\nif __name__ == '__main__':\n    print(x)\n",                                    # no function
    "def solve():\n    pass\n\nif __name__ == '__main__':\n    pass\n",                      # the main block never calls it
    "def f():\n    pass\nX = 5\n\nif __name__ == '__main__':\n    print(f())\n",            # stray top-level code after the function
])
def test_starters_without_the_expected_shape_are_left_alone(starter):
    assert fs.to_function_style(starter) is None
    assert fs.compose("code", None) == "code"


def test_every_offline_problem_in_the_codebase_converts():
    import inspect
    import re
    from services import gemini_mock_fixtures, roleready_service
    pattern = re.compile(r'"python": "((?:[^"\\]|\\.)*)"')
    starters = [s.encode().decode("unicode_escape") for src in (roleready_service, gemini_mock_fixtures) for s in pattern.findall(inspect.getsource(src))]
    real = [s for s in starters if "__main__" in s and "write code" not in s]
    assert len(real) >= 15
    for starter in real:
        parts = fs.to_function_style(starter)
        assert parts is not None, starter[:80]
        compile(_with_body(parts["starter"]), "student", "exec")
        compile(fs.compose(_with_body(parts["starter"]), parts["driver"]), "composed", "exec")
        assert parts["starter"].count("\n") == 3 and "import" not in parts["starter"] and "#" not in parts["starter"]      # signature only


# ------------------------------------------------------------------ in the real round
def _local_sandbox(language_key, code, stdin=""):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as handle:
        handle.write(code)
    started = time.perf_counter()
    done = subprocess.run([sys.executable, handle.name], input=stdin, capture_output=True, text=True, timeout=20)
    ms = (time.perf_counter() - started) * 1000
    if done.returncode == 0:
        return {"status": "success", "output": done.stdout, "stdout": done.stdout, "stderr": "", "compile_output": "",
                "timed_out": False, "execution_time_ms": ms, "raw": {}}
    return {"status": "failed", "output": done.stderr, "stdout": done.stdout, "stderr": done.stderr, "compile_output": "",
            "timed_out": False, "execution_time_ms": ms, "raw": {}}


SOLUTIONS = {
    "Subarray Sum Equals K": ("class Solution:\n    def count_subarrays(self, nums, k):\n        seen, total, count = {0: 1}, 0, 0\n"
                              "        for x in nums:\n            total += x\n            count += seen.get(total - k, 0)\n            seen[total] = seen.get(total, 0) + 1\n"
                              "        return count\n"),
    "Valid Parentheses and Brackets": ("class Solution:\n    def is_valid(self, s):\n        pairs, stack = {')': '(', ']': '[', '}': '{'}, []\n"
                                       "        for c in s:\n            if c in pairs:\n                if not stack or stack.pop() != pairs[c]:\n                    return 'false'\n"
                                       "            else:\n                stack.append(c)\n        return 'true' if not stack else 'false'\n"),
}


def _coding_round(db_session, data, clk, monkeypatch):
    monkeypatch.setattr(judge0_service, "execute_code", _local_sandbox)
    s = new_session(db_session, data)
    h = data["auth_headers"]
    client.post(url(s, "start-aptitude"), headers=h)
    clk.advance(300)
    assert client.post(url(s, "submit-aptitude"), headers=h, json={"answers": {}}).status_code == 200
    clk.advance(60)
    started = client.post(url(s, "start-coding"), headers=h)
    assert started.status_code == 200
    return s, h, started


def test_the_student_gets_class_solution_and_never_the_plumbing_or_the_keys(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    for problem in started.json()["problems"]:
        starter = problem["starter_code"]["python"]
        assert "class Solution:" in starter and "(self" in starter, starter
        assert "stdin" not in starter and "print(" not in starter and "__main__" not in starter
        assert "import" not in starter and "#" not in starter and starter.count("\n") == 3, starter            # signature only
    assert "driver" not in started.text and "hidden_test_cases" not in started.text and "Solution()." not in started.text


def test_run_and_submit_work_with_only_the_function_written(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problems = started.json()["problems"]
    solutions = {}
    for problem in problems:
        code = SOLUTIONS[problem["title"]]
        run = client.post(url(s, "run-code"), headers=h, json={"problem_id": problem["id"], "code": code, "language": "python"})
        assert run.status_code == 200 and run.json()["all_passed"] is True, run.text
        solutions[problem["id"]] = {"code": code, "language": "python"}
    wrong = client.post(url(s, "run-code"), headers=h, json={"problem_id": problems[0]["id"], "language": "python",
                                                             "code": "class Solution:\n    def count_subarrays(self, nums, k):\n        return -1\n"
                                                                     if "Subarray" in problems[0]["title"] else
                                                                     "class Solution:\n    def is_valid(self, s):\n        return 'nope'\n"})
    assert wrong.status_code == 200 and wrong.json()["all_passed"] is False

    submitted = client.post(url(s, "submit-coding"), headers=h, json={"solutions": solutions})
    assert submitted.status_code == 200, submitted.text
    db_session.expire_all()
    coding = rounds(db_session, s)["CODING"]
    assert coding.status == "EVALUATED" and coding.score == 100.0, (coding.status, coding.score)
    for pid, solution in solutions.items():                                                 # the stored submission is what the student wrote
        assert coding.submission_payload[pid]["code"] == solution["code"] and "Solution()." not in coding.submission_payload[pid]["code"]


def test_a_wrong_solution_scores_zero_and_a_crash_is_not_a_pass(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problems = started.json()["problems"]
    crash = "class Solution:\n    def {fn}(self, *args):\n        raise RuntimeError('nope')\n"
    solutions = {p["id"]: {"language": "python", "code": crash.format(fn="count_subarrays" if "Subarray" in p["title"] else "is_valid")} for p in problems}
    assert client.post(url(s, "submit-coding"), headers=h, json={"solutions": solutions}).status_code == 200
    db_session.expire_all()
    assert rounds(db_session, s)["CODING"].score == 0.0


def test_a_session_created_before_this_change_still_runs_a_whole_program(db_session, setup_test_data, clk, monkeypatch):
    """Older sessions have no driver stored: their code runs exactly as written (full stdin program), as before."""
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    coding = rounds(db_session, s)["CODING"]
    keys = {pid: {k: v for k, v in info.items() if k != "driver"} for pid, info in (coding.server_keys_payload or {}).items()}
    coding.server_keys_payload = keys
    db_session.commit()
    problem = next(p for p in started.json()["problems"] if "Valid Parentheses" in p["title"])
    program = ("import sys\nstack, pairs = [], {')': '(', ']': '[', '}': '{'}\nok = True\nfor c in sys.stdin.read().strip():\n    if c in pairs:\n"
               "        ok = bool(stack) and stack.pop() == pairs[c] and ok\n    else:\n        stack.append(c)\nprint('true' if ok and not stack else 'false')\n")
    run = client.post(url(s, "run-code"), headers=h, json={"problem_id": problem["id"], "code": program, "language": "python"})
    assert run.status_code == 200 and run.json()["all_passed"] is True, run.text


def test_an_expired_section_is_graded_from_the_function_only_draft(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    drafts = {p["id"]: {"language": "python", "code": SOLUTIONS[p["title"]]} for p in started.json()["problems"]}
    assert client.put(url(s, "draft"), headers=h, json={"section": "coding", "payload": {"solutions": drafts}}).status_code == 200
    clk.advance(20 * 60 + 11)
    status = client.get(f"/api/roleready/session/{s.session_uuid}", headers=h)
    assert status.status_code == 200
    db_session.expire_all()
    deadline = time.time() + 30
    while rounds(db_session, s)["CODING"].status != "EVALUATED" and time.time() < deadline:
        time.sleep(0.5)
        db_session.expire_all()
    assert rounds(db_session, s)["CODING"].score == 100.0


# ------------------------------------------------------------------ the Practice page's coding questions
PRACTICE_SOLUTIONS = {
    "Two Sum Target Check": ("class Solution:\n    def has_two_sum(self, nums, target):\n        seen = set()\n        for x in nums:\n"
                             "            if target - x in seen:\n                return True\n            seen.add(x)\n        return False\n"),
    "Valid Palindrome Check": ("class Solution:\n    def is_palindrome(self, s):\n        t = [c.lower() for c in s if c.isalnum()]\n        return t == t[::-1]\n"),
    "Climbing Stairs Ways": ("class Solution:\n    def climb_stairs(self, n):\n        a, b = 1, 1\n        for _ in range(n - 1):\n            a, b = b, a + b\n        return b\n"),
}


def test_practice_coding_questions_are_class_solution_and_graded_through_the_driver(db_session, setup_test_data, monkeypatch):
    from services import practice_service
    monkeypatch.setattr(judge0_service, "execute_code", _local_sandbox)
    practice_service.ensure_practice_questions_seeded(db_session)
    profile = setup_test_data["student_profile"]
    questions = [q for q in practice_service.get_sanitized_questions(None, "CODING", profile.id, db_session)
                 if q["title"] in PRACTICE_SOLUTIONS]
    assert {q["title"] for q in questions} == set(PRACTICE_SOLUTIONS)
    for question in questions:
        starter = question["starter_code"]["python"]
        assert "class Solution:" in starter and "(self" in starter and "stdin" not in starter and "print(" not in starter, starter
        right = practice_service.evaluate_practice_submission(profile, question["id"], PRACTICE_SOLUTIONS[question["title"]], "python", None, db_session)
        assert right["is_correct"] is True and right["tests_passed"] == right["total_tests"], (question["title"], right)
        wrong = practice_service.evaluate_practice_submission(profile, question["id"], starter, "python", None, db_session)
        assert wrong["is_correct"] is False                       # the untouched starter solves nothing


def test_existing_practice_databases_are_moved_to_the_new_starters(db_session):
    from services import practice_service
    practice_service.ensure_practice_questions_seeded(db_session)
    row = db_session.query(models.StudentPracticeQuestion).filter_by(title="Climbing Stairs Ways").first()
    row.starter_code = {"python": "import sys\n\ndef solution():\n    pass\n\nif __name__ == '__main__':\n    solution()\n"}
    row.description = "Print the answer."
    db_session.commit()
    practice_service.ensure_practice_questions_seeded(db_session)
    db_session.refresh(row)
    assert "def climb_stairs" in row.starter_code["python"] and row.description.startswith("You are climbing")


# ------------------------------------------------------------------ the student's own testcase (LeetCode "Testcase" box)
def test_run_also_executes_the_students_own_testcase_and_shows_its_output(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problem = next(p for p in started.json()["problems"] if "Valid Parentheses" in p["title"])
    code = SOLUTIONS[problem["title"]]
    run = client.post(url(s, "run-code"), headers=h, json={"problem_id": problem["id"], "code": code, "language": "python", "custom_input": "([)]"})
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["all_passed"] is True                                     # the sample test still decides pass / fail
    mine = [t for t in body["test_results"] if t.get("custom")]
    assert len(mine) == 1 and mine[0]["input"] == "([)]" and mine[0]["actual_output"] == "false" and mine[0]["passed"] is None
    assert mine[0]["expected_output"] is None                              # nothing to compare an invented input against


def test_a_crash_on_the_students_own_input_is_reported_not_hidden(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problem = next(p for p in started.json()["problems"] if "Subarray" in p["title"])
    run = client.post(url(s, "run-code"), headers=h, json={"problem_id": problem["id"], "code": SOLUTIONS[problem["title"]],
                                                           "language": "python", "custom_input": "not-a-number\nalso-bad"})
    assert run.status_code == 200
    mine = [t for t in run.json()["test_results"] if t.get("custom")][0]
    assert mine["error"] and mine["error_type"] == "Runtime Error"


def test_an_oversized_testcase_and_a_blank_one_are_handled(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problem = started.json()["problems"][0]
    base = {"problem_id": problem["id"], "code": SOLUTIONS[problem["title"]], "language": "python"}
    assert client.post(url(s, "run-code"), headers=h, json={**base, "custom_input": "x" * 6000}).status_code == 400
    blank = client.post(url(s, "run-code"), headers=h, json={**base, "custom_input": "   "})
    assert blank.status_code == 200 and not [t for t in blank.json()["test_results"] if t.get("custom")]


# ------------------------------------------------------------------ the usual imports are provided, like LeetCode
def test_standard_imports_are_available_without_writing_them(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problem = next(p for p in started.json()["problems"] if "Subarray" in p["title"])
    code = ("class Solution:\n    def count_subarrays(self, nums: List[int], k: int) -> int:\n        seen = defaultdict(int)\n        seen[0] = 1\n"
            "        total = count = 0\n        for x in nums:\n            total += x\n            count += seen[total - k]\n            seen[total] += 1\n        return count\n")
    assert "import" not in code
    run = client.post(url(s, "run-code"), headers=h, json={"problem_id": problem["id"], "code": code, "language": "python"})
    assert run.status_code == 200 and run.json()["all_passed"] is True, run.text


def test_errors_show_the_students_own_line_numbers_even_though_a_line_is_hidden_above_their_code(db_session, setup_test_data, clk, monkeypatch):
    s, h, started = _coding_round(db_session, setup_test_data, clk, monkeypatch)
    problem = next(p for p in started.json()["problems"] if "Valid Parentheses" in p["title"])
    code = "class Solution:\n    def is_valid(self, s):\n        return 1 // 0\n"                 # the error is on line 3 of the editor
    run = client.post(url(s, "run-code"), headers=h, json={"problem_id": problem["id"], "code": code, "language": "python"})
    error = run.json()["test_results"][0]["error"]
    assert "ZeroDivisionError" in error
    assert re.search(r"line 3\b", error) and "line 4" not in error, error


def test_fix_line_numbers_only_moves_numbers_below_the_hidden_line():
    assert fs.fix_line_numbers('File "x.py", line 4, in f\n  File "x.py", line 1, in <module>', 1) == 'File "x.py", line 3, in f\n  File "x.py", line 1, in <module>'
    assert fs.fix_line_numbers("no numbers here", 1) == "no numbers here" and fs.fix_line_numbers(None, 1) is None
    assert fs.fix_line_numbers("line 9", 0) == "line 9"


DESIGN_STARTER = '''import collections

class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = collections.OrderedDict()

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        self.cache.move_to_end(key)
        return self.cache[key]

    def put(self, key: int, value: int) -> None:
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)

if __name__ == '__main__':
    import sys
    lines = sys.stdin.read().splitlines()
    c = LRUCache(int(lines[0].split()[0]))
    for ln in lines[1:]:
        p = ln.split()
        if p[0] == 'get':
            print(c.get(int(p[1])))
        else:
            c.put(int(p[1]), int(p[2]))
'''


def test_a_design_problem_shows_only_the_class_and_method_signatures():
    """LRU Cache / Median Finder style starters carry a whole solution: the student must see none of it."""
    from services import function_style as fs
    parts = fs.to_function_style(DESIGN_STARTER)
    assert parts["starter"].startswith("class LRUCache:")
    for hidden_bit in ("OrderedDict", "move_to_end", "popitem", "self.capacity", "__main__", "import"):
        assert hidden_bit not in parts["starter"], hidden_bit
    assert "def get(self, key: int) -> int:" in parts["starter"] and "def put(self, key: int, value: int) -> None:" in parts["starter"]
    assert "LRUCache(" in parts["driver"] and "__main__" in parts["driver"]


def test_a_design_problem_runs_with_the_students_own_class():
    import subprocess, sys
    from services import function_style as fs
    parts = fs.to_function_style(DESIGN_STARTER)
    mine = ("class LRUCache:\n    def __init__(self, capacity: int):\n        self.c = capacity\n        self.d = collections.OrderedDict()\n"
            "    def get(self, key: int) -> int:\n        if key not in self.d:\n            return -1\n        self.d.move_to_end(key)\n        return self.d[key]\n"
            "    def put(self, key: int, value: int) -> None:\n        self.d[key] = value\n        self.d.move_to_end(key)\n"
            "        if len(self.d) > self.c:\n            self.d.popitem(last=False)\n")
    out = subprocess.run([sys.executable, "-c", fs.compose(mine, parts["driver"])], input="2\nput 1 1\nput 2 2\nget 1\nput 3 3\nget 2\n",
                         capture_output=True, text=True, timeout=20)
    assert out.stdout.split() == ["1", "-1"], out.stderr


def test_every_problem_shows_two_examples_without_losing_the_graded_case():
    from services import assessment_engine as engine, gemini_mock_fixtures
    import copy
    bp = copy.deepcopy(gemini_mock_fixtures.sample_blueprint())
    bp["coding_problems"][0]["public_test_cases"] = bp["coding_problems"][0]["public_test_cases"][:1]
    client, keys = engine.adapt_blueprint(bp)["CODING"]
    assert len(client[0]["public_test_cases"]) == 2
    assert len(keys[client[0]["id"]]["hidden_test_cases"]) == len(bp["coding_problems"][0]["hidden_test_cases"])
