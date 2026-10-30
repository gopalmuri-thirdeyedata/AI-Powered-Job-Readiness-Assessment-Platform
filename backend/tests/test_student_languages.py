"""
Student Coding and Practice offer the SAME languages as the Assessment coding round (Python3, Java, C++, C).

The Assessment (`coding_spec.LANGUAGES`) is the one source of truth: these tests pin that the two student features add no language list,
starter generator or driver of their own, that every offered language is sent to the sandbox with the right language key, that verdicts
are mapped like the Python path, and that a problem that cannot be typed (linked lists, trees ...) offers Python alone.
Real Python and Java programs are run when a JDK is installed; the sandbox is faked for the wiring checks.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

import database
import models
import utils
from main import app
from routers import student as student_router, student_coding
from services import assessment_engine as engine
from services import coding_platform_service as cps, coding_problem_bank, coding_spec, judge0_service, practice_service, student_sandbox, student_typed

client = TestClient(app)


@pytest.fixture(autouse=True)
def _limits():
    student_coding.run_limiter.reset()
    student_coding.submit_limiter.reset()
    student_router.practice_submit_limiter.reset()


@pytest.fixture(scope="module")
def student():
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "languages-org").first()
        if not org:
            org = models.Organization(name="Languages Org", slug="languages-org", status="active")
            db.add(org)
            db.commit()
            db.refresh(org)
        user = db.query(models.User).filter(models.User.email == "poly@languages.edu").first()
        if not user:
            user = models.User(email="poly@languages.edu", hashed_password=utils.get_password_hash("PolyPass123!"),
                               role=models.UserRole.STUDENT, organization_id=org.id, is_active=True, password_changed=True)
            db.add(user)
            db.commit()
            db.refresh(user)
        profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
        if not profile:
            profile = models.StudentProfile(user_id=user.id, organization_id=org.id, full_name="Poly", email=user.email,
                                            target_role="Backend Developer", current_skills=["Python"])
            db.add(profile)
            db.commit()
            db.refresh(profile)
        token = utils.create_access_token({"sub": user.email, "role": "STUDENT"})
        return {"headers": {"Authorization": f"Bearer {token}"}, "profile_id": profile.id}
    finally:
        db.close()


def _seeded_tests(slug):
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        return cps.snapshot_for_execution(db, slug).test_cases
    finally:
        db.close()


class FakeSandbox:
    """Stands in for student_sandbox.run_batch: answers every case with the value `answer(index)` behind the program's own marker."""

    def __init__(self, monkeypatch, answer=None, compile_error=None, timed_out=False):
        self.calls = []
        self.answer, self.compile_error, self.timed_out = answer, compile_error, timed_out
        monkeypatch.setattr(student_sandbox, "run_batch", self)

    def __call__(self, language, code, stdins):
        stdins = list(stdins)
        self.calls.append({"language": language, "program": code, "stdins": stdins})
        if self.compile_error:
            return {"status": "error", "output": self.compile_error, "compile_output": self.compile_error, "results": [], "raw": {}}
        marker = re.search(r"@@PW[0-9a-f]+@@", code).group(0)
        results = []
        for index in range(len(stdins)):
            if self.timed_out:
                results.append({"status": "failed", "stdout": "", "stderr": "", "timed_out": True, "execution_time_ms": None})
            else:
                results.append({"status": "success", "stdout": f"\n{marker}{json.dumps(self.answer(index))}\n", "stderr": "", "timed_out": False, "execution_time_ms": 3})
        return {"status": "success", "results": results, "raw": {}}


# ------------------------------------------------------------------ the list itself ------------------------------------------------------------------
def test_the_language_list_is_the_assessments_and_nothing_else():
    assert student_typed.LANGUAGES is coding_spec.LANGUAGES == ("python", "java", "cpp", "c")
    assert [coding_spec.LANGUAGE_LABELS[l] for l in student_typed.LANGUAGES] == ["Python3", "Java", "C++", "C"]
    assert judge0_service.LANGUAGE_MAP["python"]["language_id"] == 71 and judge0_service.LANGUAGE_MAP["java"]["language_id"] == 62
    assert judge0_service.LANGUAGE_MAP["cpp"]["language_id"] == 54 and judge0_service.LANGUAGE_MAP["c"]["language_id"] == 50
    src = open(student_typed.__file__, encoding="utf-8").read()
    assert "LANGUAGES = coding_spec.LANGUAGES" in src and '("python", "java"' not in src, "no language list of its own"
    with pytest.raises(ValueError):
        student_typed.normalize("javascript")
    assert student_typed.normalize("C++") == "cpp" and student_typed.normalize("python3") == "python"


def test_most_coding_problems_offer_all_four_languages_and_the_rest_only_python():
    typed, python_only = [], []
    for p in coding_problem_bank.PROBLEMS:
        (typed if student_typed.coding_spec_for(p["slug"], _seeded_tests(p["slug"])) else python_only).append(p["slug"])
    assert "two-sum" in typed and "climbing-stairs" in typed
    for slug in ("reverse-linked-list", "invert-binary-tree", "validate-binary-search-tree", "add-two-numbers"):
        assert slug in python_only, f"{slug}: ListNode / TreeNode cannot be expressed in the Assessment's typed form"
    assert len(typed) + len(python_only) == len(coding_problem_bank.PROBLEMS) and len(typed) >= 50


def test_the_starters_are_the_assessments_generator_and_python_keeps_the_pages_own():
    tests = _seeded_tests("two-sum")
    spec = student_typed.coding_spec_for("two-sum", tests)
    starters = student_typed.starters(spec, "PY-STARTER")
    assert list(starters) == ["python", "java", "cpp", "c"] and starters["python"] == "PY-STARTER"
    for language in ("java", "cpp", "c"):
        assert starters[language] == coding_spec.starter_code(spec, language)
    assert "public int[] twoSum(int[] nums, int target)" in starters["java"] and "vector<int> twoSum(vector<int>& nums, int target)" in starters["cpp"]
    assert student_typed.offered_languages(None) == ["python"] and student_typed.starters(None, "PY") == {"python": "PY"}


def test_big_values_become_long_and_untypable_data_falls_back_to_python():
    spec = student_typed.coding_spec_for("two-sum", _seeded_tests("two-sum"))
    assert [p["type"] for p in spec["params"]] in (["int[]", "int"], ["long[]", "int"], ["int[]", "long"], ["long[]", "long"])
    assert student_typed._build_coding_spec(coding_problem_bank.PROBLEMS[0], [{"args": [["x" * 6000], 1], "expected": [0, 1]}]) is None


# ------------------------------------------------------------------ Coding endpoints ------------------------------------------------------------------
def test_problem_detail_lists_languages_and_one_starter_each(student):
    body = client.get("/api/student/coding/problems/two-sum", headers=student["headers"]).json()
    assert body["languages"] == ["python", "java", "cpp", "c"] and list(body["starters"]) == ["python", "java", "cpp", "c"]
    assert body["starters"]["python"] == body["starter_code"], "the Python starter is unchanged"
    only = client.get("/api/student/coding/problems/reverse-linked-list", headers=student["headers"]).json()
    assert only["languages"] == ["python"] and list(only["starters"]) == ["python"]


@pytest.mark.parametrize("language,key", [("java", "java"), ("cpp", "cpp"), ("c", "c"), ("C++", "cpp")])
def test_run_and_submit_send_each_language_to_the_sandbox_and_judge_like_python(student, monkeypatch, language, key):
    tests = _seeded_tests("two-sum")
    sandbox = FakeSandbox(monkeypatch, answer=lambda i: tests[i]["expected"])
    run = client.post("/api/student/coding/problems/two-sum/run", json={"code": "class Solution {}", "language": language}, headers=student["headers"])
    assert run.status_code == 200, run.text
    assert run.json()["verdict"] == "ACCEPTED" and run.json()["passed"] == run.json()["total"] > 0
    assert sandbox.calls[-1]["language"] == key
    sandbox.calls.clear()
    sub = client.post("/api/student/coding/problems/two-sum/submit", json={"code": "class Solution {}", "language": language}, headers=student["headers"])
    assert sub.status_code == 200, sub.text
    assert sub.json()["verdict"] == "ACCEPTED" and sub.json()["passed"] == sub.json()["total"] == len(tests)
    assert len(sandbox.calls) == 1 and sandbox.calls[0]["language"] == key and len(sandbox.calls[0]["stdins"]) == len(tests), "one batch, every test"
    stored = client.get("/api/student/coding/problems/two-sum/submissions", headers=student["headers"]).json()
    assert stored[0]["language"] == key
    detail = client.get("/api/student/coding/problems/two-sum", headers=student["headers"]).json()
    assert detail["last_language"] == key


def test_verdicts_map_like_the_python_path(student, monkeypatch):
    tests = _seeded_tests("two-sum")
    FakeSandbox(monkeypatch, answer=lambda i: [9, 9])
    wrong = client.post("/api/student/coding/problems/two-sum/submit", json={"code": "x", "language": "java"}, headers=student["headers"]).json()
    assert wrong["verdict"] == "WRONG_ANSWER" and wrong["passed"] == 0 and wrong["failed_case"]["input"] and wrong["failed_case"]["expected"]
    FakeSandbox(monkeypatch, compile_error="Main.java:3: error: ';' expected")
    compile_failure = client.post("/api/student/coding/problems/two-sum/run", json={"code": "x", "language": "java"}, headers=student["headers"]).json()
    assert compile_failure["verdict"] == "COMPILE_ERROR" and "expected" in compile_failure["message"]
    FakeSandbox(monkeypatch, timed_out=True)
    slow = client.post("/api/student/coding/problems/two-sum/submit", json={"code": "x", "language": "cpp"}, headers=student["headers"]).json()
    assert slow["verdict"] == "TIME_LIMIT_EXCEEDED"
    assert len(tests) > 1


def test_a_bad_language_and_an_untypable_problem_are_refused_clearly(student, monkeypatch):
    sandbox = FakeSandbox(monkeypatch, answer=lambda i: 0)
    bad = client.post("/api/student/coding/problems/two-sum/run", json={"code": "x", "language": "javascript"}, headers=student["headers"])
    assert bad.status_code == 400 and "Python, Java, C++ and C" in bad.json()["detail"]
    linked = client.post("/api/student/coding/problems/reverse-linked-list/run", json={"code": "x", "language": "java"}, headers=student["headers"])
    assert linked.status_code == 400 and "only available in Python" in linked.json()["detail"]
    assert sandbox.calls == [], "nothing reached the sandbox"


def test_python_is_unchanged_and_still_uses_the_original_harness(student, monkeypatch):
    sandbox = FakeSandbox(monkeypatch, answer=lambda i: 0)

    def local(language_key, code, stdin=""):
        p = subprocess.run([sys.executable, "-I", "-c", code], input=stdin, capture_output=True, text=True, timeout=15)
        return {"status": "success" if p.returncode == 0 else "failed", "stdout": p.stdout, "stderr": p.stderr, "timed_out": False,
                "classification": judge0_service.OK if p.returncode == 0 else judge0_service.RUNTIME_ERROR}
    monkeypatch.setattr(student_sandbox, "execute", local)
    solution = next(p for p in coding_problem_bank.PROBLEMS if p["slug"] == "two-sum")["solution"]
    default = client.post("/api/student/coding/problems/two-sum/submit", json={"code": solution}, headers=student["headers"]).json()      # no language field at all
    explicit = client.post("/api/student/coding/problems/two-sum/submit", json={"code": solution, "language": "python"}, headers=student["headers"]).json()
    assert default["verdict"] == explicit["verdict"] == "ACCEPTED"
    assert sandbox.calls == [], "Python never goes through the typed driver"


# ------------------------------------------------------------------ Practice ------------------------------------------------------------------
def _practice_question(title):
    db = database.SessionLocal()
    try:
        practice_service.ensure_practice_questions_seeded(db)
        q = db.query(models.StudentPracticeQuestion).filter(models.StudentPracticeQuestion.title == title).one()
        return q.id, [dict(t) for t in q.test_cases]
    finally:
        db.close()


def test_practice_questions_list_their_languages_and_starters(student):
    rows = client.get("/api/student/practice/questions?category=CODING", headers=student["headers"]).json()
    assert len(rows) >= 3
    for q in rows:
        assert q["languages"] == ["python", "java", "cpp", "c"] and list(q["starter_code"]) == ["python", "java", "cpp", "c"], q["title"]
    aptitude = client.get("/api/student/practice/questions?category=APTITUDE", headers=student["headers"]).json()
    assert aptitude and all(q["languages"] is None for q in aptitude)
    assert not any("hidden" in json.dumps(q).lower() and "is_hidden" in json.dumps(q) for q in rows)


@pytest.mark.parametrize("language", ["java", "cpp", "c"])
def test_practice_submit_runs_every_test_in_each_language(student, monkeypatch, language):
    qid, tests = _practice_question("Two Sum Target Check")
    sandbox = FakeSandbox(monkeypatch, answer=lambda i: tests[i]["expected_output"] == "true")
    res = client.post("/api/student/practice/submit", json={"question_id": qid, "code": "class Solution {}", "language": language}, headers=student["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["is_correct"] and body["tests_passed"] == body["total_tests"] == len(tests)
    assert sandbox.calls[0]["language"] == language and len(sandbox.calls[0]["stdins"]) == len(tests)
    assert all(not r.get("is_hidden") for r in body["public_results"]) and len(body["public_results"]) == sum(1 for t in tests if not t["is_hidden"])
    assert all(r["actual_output"] in ("true", "false") for r in body["public_results"]), "bool answers read like the Python ones"


def test_practice_wrong_compile_and_unknown_language(student, monkeypatch):
    qid, tests = _practice_question("Climbing Stairs Ways")
    FakeSandbox(monkeypatch, answer=lambda i: -1)
    wrong = client.post("/api/student/practice/submit", json={"question_id": qid, "code": "x", "language": "cpp"}, headers=student["headers"]).json()
    assert not wrong["is_correct"] and wrong["tests_passed"] == 0 and "Passed 0 of" in wrong["feedback"]
    FakeSandbox(monkeypatch, compile_error="main.cpp(3): error C2143")
    failed = client.post("/api/student/practice/submit", json={"question_id": qid, "code": "x", "language": "c"}, headers=student["headers"]).json()
    assert not failed["is_correct"] and "error" in failed["public_results"][0]["error"].lower()
    bad = client.post("/api/student/practice/submit", json={"question_id": qid, "code": "x", "language": "ruby"}, headers=student["headers"])
    assert bad.status_code == 400 and "Python, Java, C++ and C" in bad.json()["detail"]
    saved = None
    db = database.SessionLocal()
    try:
        saved = db.query(models.StudentPracticeAttempt).filter(models.StudentPracticeAttempt.question_id == qid).order_by(models.StudentPracticeAttempt.id.desc()).first()
        assert saved.language in ("c", "cpp"), "the attempt records the language"
    finally:
        db.close()


# ------------------------------------------------------------------ real programs ------------------------------------------------------------------
def _real_batch(language, code, stdins):
    """Python and Java for real (JDK needed), with the Judge0 runner's batch contract."""
    work = tempfile.mkdtemp(prefix="lang_test_")
    try:
        if language == "java":
            src = os.path.join(work, "Main.java")
            open(src, "w", encoding="utf-8").write(code)
            c = subprocess.run(["javac", "-d", work, src], capture_output=True, text=True, timeout=120)
            if c.returncode != 0:
                return {"status": "error", "output": c.stderr, "compile_output": c.stderr, "results": [], "raw": {}}
            command = ["java", "-cp", work, "Main"]
        else:
            src = os.path.join(work, "main.py")
            open(src, "w", encoding="utf-8").write(code)
            command = [sys.executable, "-I", src]
        results = []
        for stdin in stdins:
            p = subprocess.run(command, input=stdin, capture_output=True, text=True, timeout=30)
            results.append({"status": "success" if p.returncode == 0 else "failed", "stdout": p.stdout, "stderr": p.stderr, "output": p.stdout or p.stderr,
                            "timed_out": False, "execution_time_ms": 1.0})
        return {"status": "success", "results": results, "raw": {}}
    finally:
        shutil.rmtree(work, ignore_errors=True)


@pytest.mark.skipif(shutil.which("javac") is None or shutil.which("java") is None, reason="needs a JDK")
@pytest.mark.parametrize("language,solution", [
    ("python", "class Solution:\n    def twoSum(self, nums, target):\n        for i in range(len(nums)):\n            for j in range(i + 1, len(nums)):\n"
               "                if nums[i] + nums[j] == target:\n                    return [i, j]\n        return []\n"),
    ("java", "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        for (int i = 0; i < nums.length; i++) for (int j = i + 1; j < nums.length; j++)\n"
             "            if (nums[i] + nums[j] == target) return new int[]{i, j};\n        return new int[0];\n    }\n}\n"),
])
def test_real_programs_are_graded_through_the_coding_endpoints(student, monkeypatch, language, solution):
    monkeypatch.setattr(student_sandbox, "run_batch", _real_batch)
    # the typed Python driver is the Assessment's; the page itself keeps using the original Python harness for language "python"
    spec = student_typed.coding_spec_for("two-sum", _seeded_tests("two-sum"))
    tests = _seeded_tests("two-sum")
    out = student_typed.run_cases(spec, language, solution, [t["args"] for t in tests])
    assert not out.get("compile_error"), out
    assert all(c["status"] == "ok" for c in out["cases"])
    assert all(coding_spec.compare_values(spec, c["value"], t["expected"]) for c, t in zip(out["cases"], tests))
    if language == "java":
        failing = client.post("/api/student/coding/problems/two-sum/submit", json={"code": solution.replace("return new int[]{i, j}", "return new int[]{i, i}"), "language": "java"},
                              headers=student["headers"]).json()
        assert failing["verdict"] == "WRONG_ANSWER"
        passing = client.post("/api/student/coding/problems/two-sum/submit", json={"code": solution, "language": "java"}, headers=student["headers"]).json()
        assert passing["verdict"] == "ACCEPTED", passing
        broken = client.post("/api/student/coding/problems/two-sum/run", json={"code": solution.replace("return new int[0];", "return new int[0]"), "language": "java"},
                             headers=student["headers"]).json()
        assert broken["verdict"] == "COMPILE_ERROR"


def test_the_assessment_engine_is_untouched_by_this_feature():
    assert engine.SUPPORTED_LANGUAGES == {"python", "python3", "java"}, "the assessment's own rules did not move"
    assert student_typed.engine is engine and student_typed.coding_spec is coding_spec
