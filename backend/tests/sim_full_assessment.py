"""
Full simulated assessment, aptitude -> coding -> interview -> admin report, against the REAL code runner (Gemini mock fixtures, no paid calls).
    PW_RUNNER_URL=http://127.0.0.1:2358/submissions GEMINI_MOCK_MODE=true python -m pytest tests/sim_full_assessment.py -s -q
Prints what a student would see for every kind of mistake, in every language.
"""
import os

import pytest

from services import judge0_service
from tests import recruitment_helpers as h
from tests.test_coding_typed_flow import BROKEN, PAIR, UNIQUE, WRONG

client = h.client
RUNNER = os.getenv("PW_RUNNER_URL", "http://127.0.0.1:2358/submissions")
LANGS = ["python", "java", "cpp", "c"]

CRASH = {
    "python": "class Solution:\n    def pairIndices(self, nums: List[int], target: int) -> List[int]:\n        return [nums[99], 0]\n",
    "java": "class Solution { public int[] pairIndices(int[] nums, int target) { return new int[]{nums[99], 0}; } }",
    "cpp": "class Solution { public: vector<int> pairIndices(vector<int>& nums, int target) { int* p = nullptr; return {*p, 0}; } };",
    "c": "int* pairIndices(int* nums, int numsSize, int target, int* returnSize) { int* p = 0; *returnSize = 1; *p = 1; return p; }",
}
LOOP = {
    "python": "class Solution:\n    def pairIndices(self, nums: List[int], target: int) -> List[int]:\n        while True:\n            pass\n",
    "java": "class Solution { public int[] pairIndices(int[] nums, int target) { while (true) {} } }",
    "cpp": "class Solution { public: vector<int> pairIndices(vector<int>& nums, int target) { while (true) {} return {}; } };",
    "c": "int* pairIndices(int* nums, int numsSize, int target, int* returnSize) { while (1) {} return 0; }",
}


@pytest.fixture(scope="module")
def db():
    s = h.new_session()
    yield s
    s.close()


@pytest.fixture(scope="module")
def env(db):
    admin = h.make_admin(db)
    job = h.create_job(admin)
    assert client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=h.auth(admin["token"])).status_code == 200
    pub = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=h.auth(admin["token"])).json()
    yield {"admin": admin, "token": pub["share_token"]}
    h.cleanup_orgs(db, [admin["org"].id])


@pytest.fixture(autouse=True)
def _runner(monkeypatch):
    h.reset_public_limiters()
    monkeypatch.setenv("CODE_RUNNER_URL", RUNNER)
    monkeypatch.setenv("CODE_EXECUTION_ENGINE", "judge0")
    judge0_service.reset_circuit()
    yield
    h.reset_public_limiters()


def run(s, pid, lang, code, custom=None):
    body = {"problem_id": pid, "language": lang, "code": code}
    if custom is not None:
        body["custom_input"] = custom
    return client.post(h.sess_url(s, "run-code"), headers=h.sh(s), json=body)


def show(label, r):
    j = r.json()
    if r.status_code != 200:
        print(f"  {label:34} HTTP {r.status_code}: {j.get('detail')}")
        return j
    first = j["test_results"][0] if j.get("test_results") else {}
    print(f"  {label:34} passed={j.get('all_passed')} error_type={j.get('error_type')!r} "
          f"got={first.get('actual_output')!r} want={first.get('expected_output')!r} stderr={(j.get('stderr') or '')[:70]!r}")
    return j


def test_full_simulation(db, env):
    h.install_local_sandbox  # (not used: the real runner executes everything)
    token, _ = h.register_ok(env["token"], name="Sim Student")
    s = h.start_ok(env["token"], token)

    # ---------------- aptitude: right answers on 11 of 15 (shuffled paper, per-candidate key)
    print("\n== APTITUDE ==")
    answers = h.correct_aptitude_answers(db, s["session_uuid"], 11)
    r = client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": answers})
    assert r.status_code == 200, r.text
    apt = h.session_row(db, s["session_uuid"]).aptitude_score
    print(f"  11/15 correct -> aptitude score {apt}")
    assert 70 <= apt <= 76

    # ---------------- coding
    print("\n== CODING: Run on the examples ==")
    p = client.post(h.sess_url(s, "start-coding"), headers=h.sh(s))
    assert p.status_code == 200
    for lang in LANGS:
        h.reset_public_limiters()
        print(f"[{lang}]")
        good = show("correct solution", run(s, "C1", lang, PAIR[lang]))
        assert good["all_passed"] is True
        bad = show("wrong answer", run(s, "C1", lang, WRONG[lang]))
        assert bad["all_passed"] is False and bad["test_results"][0]["actual_output"] == "[]"
        brk = show("compile / syntax error", run(s, "C1", lang, BROKEN[lang]))
        assert brk["all_passed"] is False and brk["error_type"] in ("Compilation Error", "Runtime Error") and brk["stderr"]
        crash = show("runtime crash", run(s, "C1", lang, CRASH[lang]))
        assert crash["all_passed"] is False and crash["error_type"] != "Compilation Error"
        loop = show("infinite loop (time limit)", run(s, "C1", lang, LOOP[lang]))
        assert loop["all_passed"] is False
        cust = run(s, "C1", lang, PAIR[lang], custom="[1,5,9,14]\n23").json()
        print(f"  {'custom testcase':34} -> {cust['test_results'][-1]['actual_output']!r}")
        assert cust["test_results"][-1]["actual_output"] == "[2,3]"
        c2 = show("problem 2 correct", run(s, "C2", lang, UNIQUE[lang]))
        assert c2["all_passed"] is True
    print("[bad custom input]")
    for bad in ("[1,2,3]", "abc\n3", "[1,2]\n9.5"):
        r = run(s, "C1", "python", PAIR["python"], custom=bad)
        print(f"  {bad!r:14} -> HTTP {r.status_code}: {r.json()['detail']}")
        assert r.status_code == 400
    r = run(s, "C1", "ruby", "puts 1")
    print(f"  language ruby -> HTTP {r.status_code}")
    assert r.status_code == 400

    # ---------------- coding submit: problem 1 in Java (correct), problem 2 in C (correct), mixed languages
    print("\n== CODING: Submit (7 tests per problem, mixed languages) ==")
    h.reset_public_limiters()
    sub = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": {
        "C1": {"language": "java", "code": PAIR["java"]}, "C2": {"language": "c", "code": UNIQUE["c"]}}})
    assert sub.status_code == 200, sub.text
    row = h.session_row(db, s["session_uuid"])
    for q in row.final_report_data["sections"]["coding"]["details"]["problems"]:
        print(f"  {q['id']} {q['language']}: {q['passed_tests']}/{q['total_tests']}")
        assert q["passed_tests"] == 7
    print(f"  coding score {row.coding_score}")
    assert row.coding_score == 100.0

    # ---------------- interview
    print("\n== INTERVIEW ==")
    st = client.post(h.sess_url(s, "start-interview"), headers=h.sh(s))
    assert st.status_code == 200, st.text
    qs = st.json()["section"].get("questions") or []
    print(f"  {len(qs)} questions")
    transcript = []
    for i, q in enumerate(qs, 1):
        transcript.append({"role": "assistant", "text": q.get("question") or q.get("text") or f"Question {i}"})
        transcript.append({"role": "user", "text": "I would profile first, then use an index or a cache, and measure again before and after the change."})
    sub = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={
        "answers": [{"question_id": q.get("id"), "response": "I would profile first, then add an index and measure again.", "follow_ups": []} for q in qs],
        "transcript": transcript})
    assert sub.status_code == 200, sub.text
    assert sub.json()["state"] == "COMPLETED"

    # ---------------- admin report
    print("\n== ADMIN REPORT ==")
    db.expire_all()
    from models import CandidateRegistration  # noqa: WPS433
    reg = db.query(CandidateRegistration).filter_by(email=h.session_row(db, s["session_uuid"]).candidate_email if hasattr(h.session_row(db, s["session_uuid"]), "candidate_email") else None).first() if False else None
    listing = client.get("/api/admin/recruitment/candidates", headers=h.auth(env["admin"]["token"])).json()
    rows = listing.get("candidates") or listing.get("items") or listing
    me = next(c for c in rows if "Sim Student" in str(c))
    d = client.get(f"/api/admin/recruitment/candidates/{me.get('registration_id') or me.get('id')}/dossier", headers=h.auth(env["admin"]["token"])).json()
    rep = d["report"]
    scores = {k: rep["sections"][k]["score"] for k in ("aptitude", "coding", "interview")}
    print(f"  interview source={rep['sections']['interview'].get('details',{}).get('evaluation_source')}"); print(f"  status={d['status']} sections={scores} overall={rep['overall_score']}")
    assert d["status"] == "COMPLETED" and scores["coding"] == 100.0
    assert "hidden_test_cases" not in str(d)
