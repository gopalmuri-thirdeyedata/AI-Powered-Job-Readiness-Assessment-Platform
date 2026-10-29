"""
End to end through the real HTTP routes, for typed (LeetCode-style) coding problems:
admin generates (offline fixtures, no Gemini) -> publishes -> a candidate registers and starts -> Run on the 2 examples -> Submit grades all 7 tests.

Python always runs here (in a local subprocess). Java, C++ and C run only when PW_RUNNER_URL points at a running code-runner:
    PW_RUNNER_URL=http://127.0.0.1:2358/submissions pytest tests/test_coding_typed_flow.py
"""
import json
import os

import pytest

from services import coding_problem_factory, judge0_service
from tests import recruitment_helpers as h

client = h.client
RUNNER = os.getenv("PW_RUNNER_URL", "").strip()
LANGUAGES = ["python", "java", "cpp", "c"] if RUNNER else ["python"]

PAIR = {   # C1 pairIndices(int[] nums, int target) -> int[]
    "python": "class Solution:\n    def pairIndices(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return []\n",
    "java": "class Solution { public int[] pairIndices(int[] nums, int target) { for (int i = 0; i < nums.length; i++) for (int j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] == target) return new int[]{i, j}; return new int[0]; } }",
    "cpp": "class Solution { public: vector<int> pairIndices(vector<int>& nums, int target) { for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j}; return {}; } };",
    "c": "int* pairIndices(int* nums, int numsSize, int target, int* returnSize) { for (int i = 0; i < numsSize; i++) for (int j = i + 1; j < numsSize; j++) if (nums[i] + nums[j] == target) { int* r = malloc(2 * sizeof(int)); r[0] = i; r[1] = j; *returnSize = 2; return r; } *returnSize = 0; return NULL; }",
}
UNIQUE = {  # C2 longestUniqueSubstring(string s) -> int
    "python": "class Solution:\n    def longestUniqueSubstring(self, s: str) -> int:\n        last, start, best = {}, 0, 0\n        for i, ch in enumerate(s):\n            if ch in last and last[ch] >= start:\n                start = last[ch] + 1\n            last[ch] = i\n            best = max(best, i - start + 1)\n        return best\n",
    "java": "class Solution { public int longestUniqueSubstring(String s) { int[] last = new int[128]; Arrays.fill(last, -1); int start = 0, best = 0; for (int i = 0; i < s.length(); i++) { char c = s.charAt(i); if (last[c] >= start) start = last[c] + 1; last[c] = i; best = Math.max(best, i - start + 1); } return best; } }",
    "cpp": "class Solution { public: int longestUniqueSubstring(string s) { int last[128]; fill(begin(last), end(last), -1); int start = 0, best = 0; for (int i = 0; i < (int)s.size(); i++) { unsigned char c = s[i]; if (last[c] >= start) start = last[c] + 1; last[c] = i; best = max(best, i - start + 1); } return best; } };",
    "c": "int longestUniqueSubstring(char* s) { int last[128]; for (int i = 0; i < 128; i++) last[i] = -1; int start = 0, best = 0; for (int i = 0; s[i]; i++) { unsigned char c = s[i]; if (last[c] >= start) start = last[c] + 1; last[c] = i; if (i - start + 1 > best) best = i - start + 1; } return best; }",
}
WRONG = {   # compiles everywhere, returns an empty answer
    "python": "class Solution:\n    def pairIndices(self, nums: List[int], target: int) -> List[int]:\n        return []\n",
    "java": "class Solution { public int[] pairIndices(int[] nums, int target) { return new int[0]; } }",
    "cpp": "class Solution { public: vector<int> pairIndices(vector<int>& nums, int target) { return {}; } };",
    "c": "int* pairIndices(int* nums, int numsSize, int target, int* returnSize) { *returnSize = 0; return NULL; }",
}
BROKEN = {  # a syntax error in every language
    "python": "class Solution:\n    def pairIndices(self, nums, target)\n        return []\n",
    "java": "class Solution { public int[] pairIndices(int[] nums, int target) { return new int[0] } }",
    "cpp": "class Solution { public: vector<int> pairIndices(vector<int>& nums, int target) { return {} } };",
    "c": "int* pairIndices(int* nums, int numsSize, int target, int* returnSize) { *returnSize = 0 return NULL; }",
}


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def env(db):
    admin = h.make_admin(db)
    job = h.create_job(admin)
    gen = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(admin["token"]))
    assert gen.status_code == 200, gen.text                    # offline fixtures: typed problems, verified by running their reference solutions
    pub = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"])).json()
    yield {"admin": admin, "job": gen.json(), "token": pub["share_token"]}
    h.cleanup_orgs(db, [admin["org"].id])


@pytest.fixture(autouse=True)
def _sandbox(monkeypatch):
    h.reset_public_limiters()
    h.patch_interview_eval(monkeypatch)
    if RUNNER:
        monkeypatch.setenv("CODE_RUNNER_URL", RUNNER)
        monkeypatch.setenv("CODE_EXECUTION_ENGINE", "judge0")
        judge0_service.reset_circuit()
    else:
        monkeypatch.setattr(judge0_service, "execute_batch", coding_problem_factory.local_run_batch)
    yield
    h.reset_public_limiters()


def coding_session(db, env):
    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])}).status_code == 200
    return s


def problems_of(s):
    r = client.post(h.sess_url(s, "start-coding"), headers=h.sh(s))
    assert r.status_code == 200, r.text
    return r.json()["section"]["questions"]       # the browser adapter exposes this as `problems`


def run(s, problem, language, code, custom=None):
    body = {"problem_id": problem, "language": language, "code": code}
    if custom is not None:
        body["custom_input"] = custom
    return client.post(h.sess_url(s, "run-code"), headers=h.sh(s), json=body)


def test_the_blueprint_is_typed_verified_and_has_starter_code_for_every_language(env):
    data = client.get(f"/api/admin/job-roles/{env['job']['id']}", headers=h.auth(env["admin"]["token"])).json()
    assert data["blueprint"]["valid"] is True and data["blueprint"]["coding_count"] == 2
    for problem in data["blueprint_data"]["coding_problems"]:
        assert len(problem["public_test_cases"]) == 2 and len(problem["hidden_test_cases"]) == 5
        assert set(problem["starter_code"]) == {"python", "java", "cpp", "c"} and problem["signature"]["name"] and problem["reference_solution"]


def test_the_candidate_gets_examples_and_starters_but_no_hidden_data(db, env):
    s = coding_session(db, env)
    problems = problems_of(s)
    blob = json.dumps(problems)
    assert [p["id"] for p in problems] == ["C1", "C2"] and problems[0]["languages"] == ["python", "java", "cpp", "c"]
    assert len(problems[0]["public_test_cases"]) == 2 and problems[0]["params"][0] == {"name": "nums", "type": "int[]"}
    for lang in ("python", "java", "cpp", "c"):
        assert "pairIndices" in problems[0]["starter_code"][lang]
    for secret in ("reference_solution", "hidden", "seen[x] = i", "[1,3]", "[2,4]"):
        assert secret not in blob, secret
    state = client.get(h.sess_url(s, "state"), headers=h.sh(s)).text
    assert "reference" not in state and "hidden_test" not in state


@pytest.mark.parametrize("language", LANGUAGES)
def test_run_checks_the_examples_in_each_language(db, env, language):
    s = coding_session(db, env)
    problems_of(s)
    good = run(s, "C1", language, PAIR[language])
    assert good.status_code == 200, good.text
    body = good.json()
    assert body["all_passed"] is True and body["language"] == language and len(body["test_results"]) == 2
    assert body["test_results"][0]["input"] == "nums = [2,7,11,15]\ntarget = 9" and body["test_results"][0]["actual_output"] == "[0,1]"
    assert "hidden" not in good.text.lower()

    wrong = run(s, "C1", language, WRONG[language]).json()
    assert wrong["all_passed"] is False and wrong["test_results"][0]["actual_output"] == "[]" and wrong["test_results"][0]["expected_output"] == "[0,1]"

    broken = run(s, "C1", language, BROKEN[language]).json()
    assert broken["all_passed"] is False and broken["error_type"] in ("Compilation Error", "Runtime Error") and broken["stderr"]


@pytest.mark.parametrize("language", LANGUAGES)
def test_a_custom_testcase_runs_next_to_the_examples(db, env, language):
    s = coding_session(db, env)
    problems_of(s)
    body = run(s, "C1", language, PAIR[language], custom="[1,5,9,14]\n23").json()
    custom = body["test_results"][-1]
    assert custom["custom"] is True and custom["passed"] is None and custom["actual_output"] == "[2,3]" and body["all_passed"] is True


def test_a_testcase_that_does_not_fit_the_parameters_is_explained(db, env):
    s = coding_session(db, env)
    problems_of(s)
    for bad, fragment in (("[1,2,3]", "needs 2 line"), ("abc\n3", "nums"), ("[1,2]\n9.5", "target")):
        r = run(s, "C1", "python", PAIR["python"], custom=bad)
        assert r.status_code == 400 and fragment in r.json()["detail"], r.text
    assert run(s, "C1", "ruby", "puts 1").status_code == 400


@pytest.mark.parametrize("language", LANGUAGES)
def test_submit_grades_all_seven_tests_per_problem(db, env, language):
    s = coding_session(db, env)
    problems_of(s)
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {
        "C1": {"language": language, "code": PAIR[language]}, "C2": {"language": language, "code": UNIQUE[language]}}})
    assert sub.status_code == 200, sub.text
    assert "hidden" not in sub.text.lower() and "[1,3]" not in sub.text
    row = h.session_row(db, s["session_uuid"])
    details = row.final_report_data["sections"]["coding"]["details"]["problems"]
    assert {p["id"]: (p["passed_tests"], p["total_tests"], p["language"]) for p in details} == {"C1": (7, 7, language), "C2": (7, 7, language)}
    assert row.coding_score == 100.0


@pytest.mark.skipif(not RUNNER, reason="needs the real runner for more than one language")
def test_a_mix_of_languages_and_a_wrong_answer_scores_partially(db, env):
    s = coding_session(db, env)
    problems_of(s)
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {
        "C1": {"language": "cpp", "code": WRONG["cpp"]}, "C2": {"language": "java", "code": UNIQUE["java"]}}})
    assert sub.status_code == 200, sub.text
    row = h.session_row(db, s["session_uuid"])
    problems = {p["id"]: p for p in row.final_report_data["sections"]["coding"]["details"]["problems"]}
    assert problems["C2"]["passed_tests"] == 7 and problems["C2"]["language"] == "java"
    assert 0 <= problems["C1"]["passed_tests"] < 7 and problems["C1"]["language"] == "cpp"
    assert 0 < row.coding_score < 100


@pytest.mark.skipif(not RUNNER, reason="needs the real runner")
def test_a_compile_error_in_the_submission_scores_zero_for_that_problem_with_a_message(db, env):
    s = coding_session(db, env)
    problems_of(s)
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {"C1": {"language": "cpp", "code": BROKEN["cpp"]}}})
    assert sub.status_code == 200
    problems = {p["id"]: p for p in h.session_row(db, s["session_uuid"]).final_report_data["sections"]["coding"]["details"]["problems"]}
    assert problems["C1"]["passed_tests"] == 0 and problems["C1"]["classification"] == "COMPILATION_ERROR" and problems["C1"]["message"]


def test_a_sandbox_outage_is_never_scored(db, env, monkeypatch):
    s = coding_session(db, env)
    problems_of(s)
    monkeypatch.setattr(judge0_service, "execute_batch", lambda *a, **k: {"status": "service_error", "output": "connection refused", "retryable": False, "results": []})
    assert run(s, "C1", "python", PAIR["python"]).status_code == 503
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {"C1": {"language": "python", "code": PAIR["python"]}}})
    assert sub.status_code == 503 and sub.json()["detail"]["evaluation_pending"] is True
    assert h.session_row(db, s["session_uuid"]).final_report_data["sections"]["coding"]["score"] is None
