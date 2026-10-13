"""
Exact output comparison, reference-solution verification of every fallback/practice problem, and
a regression guard that student-facing starter code never contains a working solution.
Reference solutions live here (test infrastructure), never in student-facing payloads.
"""
import bisect
import json
import subprocess
import sys
from collections import Counter

import pytest

from services import piston_service, practice_service, roleready_service
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (fixtures)
from fastapi.testclient import TestClient
from main import app
import models

client = TestClient(app)
ROLES = ["Frontend Developer", "Data Analyst", "DevOps Engineer", "ML Engineer", "Backend Engineer", "Full Stack Engineer"]


# ─── Output comparison policy ─────────────────────────────────────────────────

@pytest.mark.parametrize("actual,expected,ok", [
    ("1", "1", True),
    ("10", "1", False),                       # prefix collision
    ("1", "10", False),                       # reverse prefix
    ("21", "1", False),                       # suffix collision
    ("true\nextra", "true", False),           # extra output
    ("", "true", False),                      # missing output
    ("true\n", "true", True),                 # trailing newline
    ("true  \r\n", "true", True),             # CRLF + trailing spaces
    ("\n\ntrue\n\n", "true", True),           # surrounding blank lines
    ("a b", "a  b", False),                   # internal whitespace matters
    ("True", "true", False),                  # case matters
    ("1\n2\n3", "1\n2\n3", True),             # multi-line exact
    ("1\r\n2\r\n3\r\n", "1\n2\n3", True),     # multi-line CRLF
    ("1\n3\n2", "1\n2\n3", False),            # line order matters
    ("1\n2", "1\n2\n3", False),               # missing line
    ("1\n\n2", "1\n2", False),                # extra internal blank line
    ("wrong", "right", False),
])
def test_outputs_match_policy(actual, expected, ok):
    assert piston_service.outputs_match(actual, expected) is ok


def _patch_sandbox(monkeypatch, fn):
    monkeypatch.setattr(piston_service, "execute_code", lambda lang, code, stdin="": {
        "status": "success", "output": "", "stdout": fn(stdin), "stderr": "", "compile_output": "",
        "timed_out": False, "execution_time_ms": 1.0, "raw": {}})


def _coding_session(db_session, setup_test_data):
    session = roleready_service.create_student_session(
        db=db_session, student_profile=setup_test_data["student_profile"], target_role="Backend Engineer")
    h = setup_test_data["auth_headers"]
    base = f"/api/roleready/session/{session.session_uuid}"
    client.post(f"{base}/start-aptitude", headers=h)
    client.post(f"{base}/submit-aptitude", headers=h, json={"answers": {}})
    client.post(f"{base}/start-coding", headers=h)
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="CODING").first()
    expected = {t["input"]: t["expected_output"] for v in rnd.server_keys_payload.values() for t in v["hidden_test_cases"]}
    return session, h, base, expected


def _submit(base, h):
    return client.post(f"{base}/submit-coding", headers=h,
                       json={"solutions": {"1": {"code": "print()", "language": "python"},
                                           "2": {"code": "print()", "language": "python"}}})


def test_submission_with_prefix_collision_scores_zero(db_session, setup_test_data, monkeypatch):
    session, h, base, expected = _coding_session(db_session, setup_test_data)
    _patch_sandbox(monkeypatch, lambda stdin: expected[stdin] + "0")      # "6" -> "60"
    res = _submit(base, h)
    assert res.status_code == 200 and res.json()["score"] == 0.0


def test_submission_with_extra_output_scores_zero(db_session, setup_test_data, monkeypatch):
    session, h, base, expected = _coding_session(db_session, setup_test_data)
    _patch_sandbox(monkeypatch, lambda stdin: "debug\n" + expected[stdin])
    assert _submit(base, h).json()["score"] == 0.0


def test_submission_with_exact_output_and_whitespace_noise_scores_full(db_session, setup_test_data, monkeypatch):
    session, h, base, expected = _coding_session(db_session, setup_test_data)
    _patch_sandbox(monkeypatch, lambda stdin: expected[stdin].replace("\n", "\r\n") + "  \r\n")
    res = _submit(base, h)
    assert res.json()["score"] == 100.0


def test_each_hidden_case_is_scored_independently(db_session, setup_test_data, monkeypatch):
    session, h, base, expected = _coding_session(db_session, setup_test_data)
    wrong_for = {sorted(expected)[0]}
    _patch_sandbox(monkeypatch, lambda stdin: "WRONG" if stdin in wrong_for else expected[stdin])
    body = _submit(base, h).json()
    total = sum(e["total_tests"] for e in body["problem_evaluations"])
    passed = sum(e["passed_tests"] for e in body["problem_evaluations"])
    assert passed == total - 1
    assert body["score"] == round(passed / total * 100, 1)


def test_run_code_sample_uses_exact_match(db_session, setup_test_data, monkeypatch):
    session, h, base, _ = _coding_session(db_session, setup_test_data)
    rnd = db_session.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id, round_type="CODING").first()
    sample = rnd.questions_payload[0]["public_test_cases"][0]
    _patch_sandbox(monkeypatch, lambda stdin: sample["expected_output"] + "0")
    res = client.post(f"{base}/run-code", headers=h, json={"problem_id": "1", "code": "x", "language": "python"})
    assert res.json()["sample_test_passed"] is False
    _patch_sandbox(monkeypatch, lambda stdin: sample["expected_output"])
    res = client.post(f"{base}/run-code", headers=h, json={"problem_id": "1", "code": "x", "language": "python"})
    assert res.json()["sample_test_passed"] is True


# ─── Reference solutions (server/test side only) ──────────────────────────────

def _longest_unique(s):
    seen, best, left = {}, 0, 0
    for i, t in enumerate(s.split()):
        if t in seen and seen[t] >= left:
            left = seen[t] + 1
        seen[t] = i
        best = max(best, i - left + 1)
    return str(best)


def _top_k(s):
    k, items = s.split("\n")
    ranked = sorted(Counter(items.split(",")).items(), key=lambda kv: (-kv[1], kv[0]))
    return " ".join(n for n, _ in ranked[:int(k)])


def _merge(s):
    out = []
    for a, b in sorted(tuple(map(int, p.split("-"))) for p in s.strip().split(",")):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return ",".join(f"{a}-{b}" for a, b in out)


def _lis(s):
    t = []
    for x in map(int, s.strip().split(",")):
        i = bisect.bisect_left(t, x)
        t.append(x) if i == len(t) else t.__setitem__(i, x)
    return str(len(t))


def _subarrays(s):
    nums, k = s.split("\n")
    nums, k, pref, tot, cnt = list(map(int, nums.split(","))), int(k), {0: 1}, 0, 0
    for n in nums:
        tot += n
        cnt += pref.get(tot - k, 0)
        pref[tot] = pref.get(tot, 0) + 1
    return str(cnt)


def _tags(s):
    stack = []
    for t in s.strip().split():
        if t.startswith("</") and t.endswith(">"):
            if not stack or stack[-1] != t[2:-1]:
                return "false"
            stack.pop()
        elif t.startswith("<") and t.endswith(">"):
            stack.append(t[1:-1])
    return "true" if not stack else "false"


def _join(s):
    a, b = [l.strip() for l in s.splitlines() if l.strip()][:2]
    left = {int(i.split(":", 1)[0]): i.split(":", 1)[1].strip() for i in a.split(",") if ":" in i}
    res = sorted((int(i.split(":", 1)[0]), left[int(i.split(":", 1)[0])], i.split(":", 1)[1].strip())
                 for i in b.split(",") if ":" in i and int(i.split(":", 1)[0]) in left)
    return " ".join(f"{k}:{x}:{y}" for k, x, y in res) if res else "EMPTY"


def _logs(s):
    c = [0, 0, 0]
    for t in s.split():
        if t.isdigit():
            n = int(t)
            c[0] += 200 <= n <= 299
            c[1] += 400 <= n <= 499
            c[2] += 500 <= n <= 599
    return f"2XX:{c[0]} 4XX:{c[1]} 5XX:{c[2]}"


def _minmax(s):
    nums = [float(x) for x in s.strip().split(",") if x.strip()]
    lo, hi = min(nums), max(nums)
    return " ".join(["0.00"] * len(nums)) if hi == lo else " ".join(f"{(x - lo) / (hi - lo):.2f}" for x in nums)


def _brackets(s):
    st, m = [], {")": "(", "}": "{", "]": "["}
    for ch in s.strip():
        if ch in m:
            if (st.pop() if st else "#") != m[ch]:
                return "false"
        else:
            st.append(ch)
    return "true" if not st else "false"


def _two_sum_bool(s):
    nums, target = s.split("\n")
    nums, target, seen = [int(x) for x in nums.split(",") if x.strip()], int(target), set()
    for n in nums:
        if target - n in seen:
            return "true"
        seen.add(n)
    return "false"


def _palindrome(s):
    import re
    c = re.sub(r"[^a-zA-Z0-9]", "", s.strip()).lower()
    return "true" if c == c[::-1] else "false"


def _stairs(s):
    n = int(s.strip())
    a, b = 1, 2
    if n <= 2:
        return str(n)
    for _ in range(3, n + 1):
        a, b = b, a + b
    return str(b)


ASSESSMENT_REFERENCES = {
    "Longest Run of Unique CSS Classes": _longest_unique, "Top-K Frequent Categories": _top_k,
    "Merge Overlapping Maintenance Windows": _merge, "Longest Improving Validation Streak": _lis,
    "Subarray Sum Equals K": _subarrays, "HTML & JSX Component Tag Balancer": _tags,
    "In-Memory Dataset Equi-Join by ID": _join, "Server Log Status Code Frequency Aggregator": _logs,
    "Feature Matrix Min-Max Normalizer": _minmax, "Valid Parentheses and Brackets": _brackets,
}
PRACTICE_REFERENCES = {"Two Sum Target Check": _two_sum_bool, "Valid Palindrome Check": _palindrome,
                       "Climbing Stairs Ways": _stairs}


def _all_fallback_problems():
    found = {}
    for role in ROLES:
        client_safe, keys = roleready_service.generate_coding_problems({"role_title": role, "required_skills": ["x"]}, 2)
        for p in client_safe:
            tests = [(t["input"], t["expected_output"]) for t in p["public_test_cases"]]
            tests += [(t["input"], t["expected_output"]) for t in keys[p["id"]]["hidden_test_cases"]]
            found[p["title"]] = (p["starter_code"]["python"], tests)
    return found


def test_every_fallback_problem_has_a_reference_and_expected_outputs_are_correct():
    problems = _all_fallback_problems()
    assert set(problems) == set(ASSESSMENT_REFERENCES)
    for title, (_, tests) in problems.items():
        for stdin, expected in tests:
            assert ASSESSMENT_REFERENCES[title](stdin) == expected, (title, stdin)


def test_practice_seed_expected_outputs_match_reference_solutions():
    coding = [q for q in practice_service.SEED_PRACTICE_QUESTIONS if q["category"] == "CODING"]
    assert {q["title"] for q in coding} == set(PRACTICE_REFERENCES)
    for q in coding:
        for tc in q["test_cases"]:
            assert PRACTICE_REFERENCES[q["title"]](tc["input"]) == tc["expected_output"], (q["title"], tc["input"])


# ─── Starter code must not solve the problem ──────────────────────────────────

def _run_starter(code, stdin):
    r = subprocess.run([sys.executable, "-I", "-c", code], input=stdin, capture_output=True, text=True, timeout=10)
    return r.stdout


def test_assessment_starters_are_skeletons_that_solve_nothing():
    for title, (starter, tests) in _all_fallback_problems().items():
        assert "def " in starter, f"{title}: starter lost its function signature"
        passed = [stdin for stdin, expected in tests if piston_service.outputs_match(_run_starter(starter, stdin), expected)]
        assert passed == [], f"{title}: starter already passes {len(passed)} test(s)"


def test_practice_starters_are_skeletons_that_solve_nothing():
    for q in practice_service.SEED_PRACTICE_QUESTIONS:
        if q["category"] != "CODING":
            continue
        assert list(q["starter_code"]) == ["python"]
        starter = q["starter_code"]["python"]
        assert "def solution" in starter
        passed = [tc["input"] for tc in q["test_cases"]
                  if piston_service.outputs_match(_run_starter(starter, tc["input"]), tc["expected_output"])]
        assert passed == [], f"{q['title']}: starter already passes {len(passed)} test(s)"


def test_existing_practice_rows_get_sanitized_starters(db_session):
    q = db_session.query(models.StudentPracticeQuestion).filter_by(title="Climbing Stairs Ways").first()
    if q is None:
        pytest.skip("practice questions not seeded in this database")
    practice_service.ensure_practice_questions_seeded(db_session)
    db_session.refresh(q)
    assert q.starter_code["python"] == [s for s in practice_service.SEED_PRACTICE_QUESTIONS
                                        if s["title"] == "Climbing Stairs Ways"][0]["starter_code"]["python"]
    assert "a, b = b, a + b" not in q.starter_code["python"]


def test_ai_coding_prompt_forbids_solution_in_starter():
    import inspect
    assert "must NOT contain the solution" in inspect.getsource(roleready_service.generate_coding_problems)
