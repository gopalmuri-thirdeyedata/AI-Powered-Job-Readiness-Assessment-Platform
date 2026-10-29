"""
LeetCode-style coding platform: the bank is self-consistent, the harness grades real programs, and the API keeps answers server side.
The sandbox is replaced by a local Python subprocess (same stdin/stdout contract as Judge0 / the in-house runner).
"""
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

import database
import models
import utils
from main import app
from routers import student_coding
from services import coding_platform_service as cps, student_sandbox
from services import coding_problem_bank, judge0_service

client = TestClient(app)


def _local_sandbox(language_key, code, stdin=""):
    try:
        p = subprocess.run([sys.executable, "-I", "-c", code], input=stdin, capture_output=True, text=True, timeout=12)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "stdout": "", "stderr": "", "timed_out": True, "classification": judge0_service.TIME_LIMIT_EXCEEDED}
    ok = p.returncode == 0
    return {"status": "success" if ok else "failed", "stdout": p.stdout, "stderr": p.stderr, "timed_out": False,
            "classification": judge0_service.OK if ok else judge0_service.RUNTIME_ERROR}


@pytest.fixture(autouse=True)
def sandbox(monkeypatch):
    monkeypatch.setattr(student_sandbox, "execute", _local_sandbox)
    student_coding.run_limiter.reset()
    student_coding.submit_limiter.reset()


@pytest.fixture(scope="module")
def student():
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "coding-platform-org").first()
        if not org:
            org = models.Organization(name="Coding Platform Org", slug="coding-platform-org", status="active")
            db.add(org)
            db.commit()
            db.refresh(org)
        user = db.query(models.User).filter(models.User.email == "coder@coding-platform.edu").first()
        if not user:
            user = models.User(email="coder@coding-platform.edu", hashed_password=utils.get_password_hash("CoderPass123!"),
                               role=models.UserRole.STUDENT, organization_id=org.id, is_active=True, password_changed=True)
            db.add(user)
            db.commit()
            db.refresh(user)
        profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
        if not profile:
            profile = models.StudentProfile(user_id=user.id, organization_id=org.id, full_name="Coder", email=user.email,
                                            target_role="Backend Developer", current_skills=["Python"])
            db.add(profile)
            db.commit()
            db.refresh(profile)
        token = utils.create_access_token({"sub": user.email, "role": "STUDENT"})
        return {"headers": {"Authorization": f"Bearer {token}"}, "profile_id": profile.id}
    finally:
        db.close()


def _two_sum_problem(db):
    cps.ensure_seeded(db)
    return db.query(models.CodingProblem).filter(models.CodingProblem.slug == "two-sum").one()


def _profile(student_fixture, db):
    return db.query(models.StudentProfile).filter(models.StudentProfile.id == student_fixture["profile_id"]).one()


# ------------------------------------------------------------------ the bank ------------------------------------------------------------------
def test_the_bank_is_self_consistent():
    """Every reference solution reproduces the answer printed in its own statement; payloads fit the sandbox stdin; >= 6 tests each."""
    assert cps.verify_bank() == []
    assert len(coding_problem_bank.PROBLEMS) >= 30


def test_every_reference_solution_is_accepted_by_the_real_harness(student):
    """End to end through harness + sandbox + digest comparison, for all problems (this is what proves grading, not the unit pieces)."""
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        profile = _profile(student, db)
        for p in coding_problem_bank.PROBLEMS:
            problem = db.query(models.CodingProblem).filter(models.CodingProblem.slug == p["slug"]).one()
            result = cps.submit_code(db, profile, problem, p["solution"])
            assert result["verdict"] == cps.ACCEPTED, (p["slug"], result)
            assert result["passed"] == result["total"] > 0
    finally:
        db.close()


def test_seeding_is_idempotent_and_hides_nothing_it_should_not():
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        before = db.query(models.CodingProblem).count()
        cps.ensure_seeded(db)
        assert db.query(models.CodingProblem).count() == before == len(coding_problem_bank.PROBLEMS)
    finally:
        db.close()


# --------------------------------------------------------------- verdicts via the service ---------------------------------------------------------------
@pytest.mark.parametrize("code,verdict", [
    ("class Solution:\n    def twoSum(self, nums, target):\n        return [0, 0]\n", cps.WRONG_ANSWER),
    ("class Solution:\n    def twoSum(self, nums, target):\n        return nums[99999]\n", cps.RUNTIME_ERROR),
    ("class Solution:\n    def twoSum(self, nums, target)\n        return []\n", cps.COMPILE_ERROR),
    ("def twoSum(nums, target):\n    return []\n", cps.COMPILE_ERROR),
    ("class Solution:\n    def other(self, nums, target):\n        return []\n", cps.COMPILE_ERROR),
])
def test_verdicts(student, code, verdict):
    db = database.SessionLocal()
    try:
        result = cps.submit_code(db, _profile(student, db), _two_sum_problem(db), code)
        assert result["verdict"] == verdict, result
        assert result["runtime_ms"] is None                      # only accepted runs carry a runtime
        if verdict in (cps.WRONG_ANSWER, cps.RUNTIME_ERROR):
            assert result["failed_case"]["input"]
    finally:
        db.close()


def test_an_infinite_loop_is_time_limit_exceeded(student, monkeypatch):
    monkeypatch.setattr(cps, "PER_CASE_SECONDS", 1.0)
    monkeypatch.setattr(student_sandbox, "execute",
                        lambda *a, **k: {"status": "failed", "stdout": "", "stderr": "", "timed_out": True,
                                         "classification": judge0_service.TIME_LIMIT_EXCEEDED})
    db = database.SessionLocal()
    try:
        result = cps.submit_code(db, _profile(student, db), _two_sum_problem(db), "class Solution:\n    def twoSum(self, n, t):\n        while True: pass\n")
        assert result["verdict"] == cps.TIME_LIMIT_EXCEEDED
    finally:
        db.close()


@pytest.mark.skipif(not hasattr(__import__("signal"), "setitimer"), reason="per-case alarm needs POSIX")
def test_a_slow_case_is_cut_off_individually(student, monkeypatch):
    monkeypatch.setattr(cps, "PER_CASE_SECONDS", 0.5)
    db = database.SessionLocal()
    try:
        result = cps.submit_code(db, _profile(student, db), _two_sum_problem(db),
                                 "class Solution:\n    def twoSum(self, n, t):\n        while True: pass\n")
        assert result["verdict"] == cps.TIME_LIMIT_EXCEEDED and result["passed"] == 0
    finally:
        db.close()


def test_candidate_code_cannot_forge_a_passing_result(student):
    """Printing a result line (even with a guessed prefix) must not turn a wrong solution into an accepted one."""
    forged = ("import sys, json\nprint('@@LC-forged@@' + json.dumps({'results': [{'s': 'ok', 'ms': 1, 'd': 'x', 'o': None, 'e': None, 'p': None}] * 20, 'mem_kb': 1}))\n"
              "sys.__stdout__.write('@@LC-forged@@{}\\n')\n"
              "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 0]\n")
    db = database.SessionLocal()
    try:
        result = cps.submit_code(db, _profile(student, db), _two_sum_problem(db), forged)
        assert result["verdict"] != cps.ACCEPTED
    finally:
        db.close()


def test_hidden_expected_values_are_not_in_the_program_or_stdin():
    db = database.SessionLocal()
    try:
        problem = _two_sum_problem(db)
        program = cps.build_program("class Solution:\n    pass\n")
        assert "expected" not in program
        # the sandbox only ever receives inputs
        seen = {}
        orig = student_sandbox.execute

        def spy(lang, code, stdin=""):
            seen["stdin"] = stdin
            return orig(lang, code, stdin)
        student_sandbox.execute = spy
        try:
            cps._execute(problem, "class Solution:\n    def twoSum(self, n, t):\n        return []\n", [c["args"] for c in problem.test_cases], False)
        finally:
            student_sandbox.execute = orig
        assert '"expected"' not in seen["stdin"]
    finally:
        db.close()


def test_comparison_modes():
    d = cps._digest
    assert d([1, 0], "unordered") == d([0, 1], "unordered")
    assert d([1, 0], "exact") != d([0, 1], "exact")
    assert d([["b", "a"], ["c"]], "unordered_nested") == d([["c"], ["a", "b"]], "unordered_nested")
    assert d(2.0, "exact") == d(2, "exact")
    assert d(True, "exact") != d(1, "exact")
    assert d(0.1 + 0.2, "exact") == d(0.3, "exact")


# ----------------------------------------------------------------------- API -----------------------------------------------------------------------
def test_api_requires_a_student_session():
    assert client.get("/api/student/coding/problems").status_code in (401, 403)
    assert client.post("/api/student/coding/problems/two-sum/submit", json={"code": "x"}).status_code in (401, 403)


def test_list_and_detail_never_leak_answers(student):
    listing = client.get("/api/student/coding/problems", headers=student["headers"])
    assert listing.status_code == 200
    body = listing.json()
    assert len(body["problems"]) == len(coding_problem_bank.PROBLEMS) and {"Easy", "Medium", "Hard"} <= set(body["stats"]["by_difficulty"])
    detail = client.get("/api/student/coding/problems/two-sum", headers=student["headers"]).json()
    text = str(detail)
    assert "test_cases" not in detail and "hidden" not in text.lower()
    assert detail["starter_code"] == "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        \n"      # LeetCode's starter
    assert detail["examples"][0]["output"] == "[0,1]"
    assert client.get("/api/student/coding/problems/nope", headers=student["headers"]).status_code == 404


def test_run_checks_examples_and_a_custom_case(student):
    good = "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n"
    r = client.post("/api/student/coding/problems/two-sum/run", headers=student["headers"],
                    json={"code": good, "custom_input": "[1,2,3,4]\n7"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "ACCEPTED" and body["passed"] == body["total"] == 3
    custom = body["cases"][-1]
    assert custom["custom"] and custom["status"] == "ran" and custom["actual"] == "[2,3]"
    bad = client.post("/api/student/coding/problems/two-sum/run", headers=student["headers"], json={"code": good, "custom_input": "[1,2]"})
    assert bad.status_code == 400 and "line" in bad.json()["detail"].lower()
    bad = client.post("/api/student/coding/problems/two-sum/run", headers=student["headers"], json={"code": good, "custom_input": "[1,2\n5"})
    assert bad.status_code == 400 and "json" in bad.json()["detail"].lower()


def test_submit_stores_history_unlocks_the_solution_and_feeds_readiness(student):
    good = coding_problem_bank.PROBLEMS[0]["solution"]
    wrong = "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 0]\n"
    h = student["headers"]
    assert client.post("/api/student/coding/problems/two-sum/submit", headers=h, json={"code": wrong}).json()["verdict"] == "WRONG_ANSWER"
    before = client.get("/api/student/coding/problems/two-sum", headers=h).json()
    assert before["status"] in ("attempted", "solved")
    r = client.post("/api/student/coding/problems/two-sum/submit", headers=h, json={"code": good}).json()
    assert r["verdict"] == "ACCEPTED" and r["runtime_ms"] is not None and r["memory_kb"] != 0
    after = client.get("/api/student/coding/problems/two-sum", headers=h).json()
    assert after["status"] == "solved" and after["solution"]["code"].startswith("class Solution") and after["last_code"] == good
    history = client.get("/api/student/coding/problems/two-sum/submissions", headers=h).json()
    assert history[0]["verdict"] == "ACCEPTED" and any(x["verdict"] == "WRONG_ANSWER" for x in history)
    one = client.get(f"/api/student/coding/submissions/{history[0]['id']}", headers=h).json()
    assert one["code"] == good
    stats = client.get("/api/student/coding/stats", headers=h).json()
    assert stats["solved"] >= 1 and stats["streak_days"] >= 1


def test_the_solution_is_locked_until_the_student_solves_it():
    """A fresh student who never solved anything must not see a solution."""
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "coding-platform-org").one()
        user = models.User(email="fresh@coding-platform.edu", hashed_password=utils.get_password_hash("FreshPass123!"),
                           role=models.UserRole.STUDENT, organization_id=org.id, is_active=True, password_changed=True)
        db.add(user)
        db.commit()
        token = utils.create_access_token({"sub": user.email, "role": "STUDENT"})
    finally:
        db.close()
    detail = client.get("/api/student/coding/problems/two-sum", headers={"Authorization": f"Bearer {token}"}).json()
    assert detail["solution"] is None and detail["status"] == "todo" and detail["last_code"] is None


def test_submissions_belong_to_their_owner(student):
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "coding-platform-org").one()
        user = models.User(email="other@coding-platform.edu", hashed_password=utils.get_password_hash("OtherPass123!"),
                           role=models.UserRole.STUDENT, organization_id=org.id, is_active=True, password_changed=True)
        db.add(user)
        db.commit()
        token = utils.create_access_token({"sub": user.email, "role": "STUDENT"})
    finally:
        db.close()
    mine = client.get("/api/student/coding/problems/two-sum/submissions", headers=student["headers"]).json()
    if mine:
        assert client.get(f"/api/student/coding/submissions/{mine[0]['id']}", headers={"Authorization": f"Bearer {token}"}).status_code == 404


def test_a_busy_sandbox_is_a_429_and_a_down_runner_is_a_503(student, monkeypatch):
    def busy(*a, **k):
        raise judge0_service.SandboxBusy("full")
    monkeypatch.setattr(student_sandbox, "execute", busy)
    r = client.post("/api/student/coding/problems/two-sum/submit", headers=student["headers"], json={"code": "class Solution:\n    pass\n"})
    assert r.status_code == 429 and r.headers.get("Retry-After")
    monkeypatch.setattr(student_sandbox, "execute", lambda *a, **k: {"classification": judge0_service.INFRASTRUCTURE_ERROR})
    r = client.post("/api/student/coding/problems/two-sum/submit", headers=student["headers"], json={"code": "class Solution:\n    pass\n"})
    assert r.status_code == 503


def test_empty_and_oversized_code_are_rejected(student):
    h = student["headers"]
    assert client.post("/api/student/coding/problems/two-sum/submit", headers=h, json={"code": "  "}).status_code == 400
    assert client.post("/api/student/coding/problems/two-sum/submit", headers=h, json={"code": "x" * (cps.MAX_CODE_CHARS + 1)}).status_code == 400


def test_submissions_are_rate_limited(student):
    h = student["headers"]
    codes = [client.post("/api/student/coding/problems/two-sum/submit", headers=h, json={"code": "class Solution:\n    pass\n"}).status_code
             for _ in range(12)]
    assert 429 in codes


# ------------------------------------------------------------------ linked lists and trees ------------------------------------------------------------------
def _submit_slug(student_fixture, slug, code):
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        problem = db.query(models.CodingProblem).filter(models.CodingProblem.slug == slug).one()
        return cps.submit_code(db, _profile(student_fixture, db), problem, code)
    finally:
        db.close()


def test_linked_list_and_tree_problems_use_leetcodes_node_classes(student):
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        lst = db.query(models.CodingProblem).filter(models.CodingProblem.slug == "reverse-linked-list").one()
        tree = db.query(models.CodingProblem).filter(models.CodingProblem.slug == "invert-binary-tree").one()
        assert lst.param_types == ["list"] and lst.return_type == "list" and tree.return_type == "tree"
        assert "class ListNode" in lst.starter_code and "Optional[ListNode]" in lst.starter_code      # the node definition as a comment, like LeetCode
        assert "import" not in lst.starter_code.replace("# Definition", "")                              # and no imports: they are provided
        assert "class TreeNode" in tree.starter_code and "class ListNode" not in tree.starter_code
    finally:
        db.close()
    reverse = "class Solution:\n    def reverseList(self, head):\n        prev = None\n        while head:\n            head.next, prev, head = prev, head, head.next\n        return prev\n"
    assert _submit_slug(student, "reverse-linked-list", reverse)["verdict"] == cps.ACCEPTED
    # a hand-built list (not a mutation of the input) is accepted too
    rebuild = ("class Solution:\n    def reverseList(self, head):\n        vals = []\n        while head:\n            vals.append(head.val)\n            head = head.next\n"
               "        out = None\n        for v in vals:\n            out = ListNode(v, out)\n        return out\n")
    assert _submit_slug(student, "reverse-linked-list", rebuild)["verdict"] == cps.ACCEPTED
    wrong = "class Solution:\n    def reverseList(self, head):\n        return head\n"
    assert _submit_slug(student, "reverse-linked-list", wrong)["verdict"] == cps.WRONG_ANSWER
    returns_int = "class Solution:\n    def reverseList(self, head):\n        return 5\n"
    result = _submit_slug(student, "reverse-linked-list", returns_int)
    assert result["verdict"] == cps.RUNTIME_ERROR and result["message"]
    swap = "class Solution:\n    def invertTree(self, root):\n        if root:\n            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n        return root\n"
    assert _submit_slug(student, "invert-binary-tree", swap)["verdict"] == cps.ACCEPTED


def test_node_conversions_round_trip():
    to_in, from_out = cps._to_input, cps._from_output
    assert from_out(to_in([1, 2, 3], "list"), "list") == [1, 2, 3]
    assert from_out(to_in([], "list"), "list") == []
    assert from_out(to_in([1, None, 2, 3], "tree"), "tree") == [1, None, 2, 3]
    assert from_out(to_in([], "tree"), "tree") == []
    assert from_out(to_in([5, 4, 6, None, None, 3, 7], "tree"), "tree") == [5, 4, 6, None, None, 3, 7]
    assert to_in([1, 2], "plain") == [1, 2] and from_out(7, None) == 7
    node = to_in([1, 2], "list")
    node.next.next = node                                  # a cycle is reported, never an endless loop
    with pytest.raises(ValueError):
        from_out(node, "list")


def test_the_bank_has_every_kind_of_problem():
    kinds = {(p.get("argtypes") or [None])[0] for p in coding_problem_bank.PROBLEMS}
    assert {"list", "tree", None} <= kinds
    assert len(coding_problem_bank.PROBLEMS) >= 70
    assert {p["difficulty"] for p in coding_problem_bank.PROBLEMS} == {"Easy", "Medium", "Hard"}


# ------------------------------------------------------------------ bookmarks, daily problem, activity ------------------------------------------------------------------
def test_bookmarks_toggle_and_filter(student):
    h = student["headers"]
    first = client.post("/api/student/coding/problems/two-sum/bookmark", headers=h).json()
    assert first == {"slug": "two-sum", "bookmarked": True}
    detail = client.get("/api/student/coding/problems/two-sum", headers=h).json()
    assert detail["bookmarked"] is True
    marked = client.get("/api/student/coding/problems", params={"bookmarked": "true"}, headers=h).json()
    assert [p["slug"] for p in marked["problems"]] == ["two-sum"] and marked["bookmarks"] == 1
    assert client.post("/api/student/coding/problems/two-sum/bookmark", headers=h).json()["bookmarked"] is False
    assert client.get("/api/student/coding/problems", params={"bookmarked": "true"}, headers=h).json()["problems"] == []
    assert client.post("/api/student/coding/problems/nope/bookmark", headers=h).status_code == 404


def test_bookmarks_are_private_to_each_student(student):
    db = database.SessionLocal()
    try:
        org = db.query(models.Organization).filter(models.Organization.slug == "coding-platform-org").one()
        user = models.User(email="bookmark.other@coding-platform.edu", hashed_password=utils.get_password_hash("OtherPass123!"),
                           role=models.UserRole.STUDENT, organization_id=org.id, is_active=True, password_changed=True)
        db.add(user)
        db.commit()
        token = utils.create_access_token({"sub": user.email, "role": "STUDENT"})
    finally:
        db.close()
    client.post("/api/student/coding/problems/two-sum/bookmark", headers=student["headers"])
    other = client.get("/api/student/coding/problems", params={"bookmarked": "true"}, headers={"Authorization": f"Bearer {token}"}).json()
    assert other["problems"] == []
    client.post("/api/student/coding/problems/two-sum/bookmark", headers=student["headers"])          # leave the shared fixture clean


def test_one_daily_problem_per_day_cycles_through_the_bank(student):
    import datetime as dt
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        problems = db.query(models.CodingProblem).order_by(models.CodingProblem.order_index).all()
        today = dt.date(2026, 10, 28)
        assert cps.daily_problem_slug(problems, today) == cps.daily_problem_slug(problems, today)
        assert cps.daily_problem_slug(problems, today) != cps.daily_problem_slug(problems, today + dt.timedelta(days=1))
        assert cps.daily_problem_slug(problems, today) == cps.daily_problem_slug(problems, today + dt.timedelta(days=len(problems)))
        assert cps.daily_problem_slug([], today) is None
    finally:
        db.close()
    body = client.get("/api/student/coding/problems", headers=student["headers"]).json()
    assert body["daily"]["slug"] and sum(1 for p in body["problems"] if p["is_daily"]) == 1
    assert [p for p in body["problems"] if p["is_daily"]][0]["slug"] == body["daily"]["slug"]


def test_stats_carry_a_twelve_week_activity_map(student):
    import datetime as dt
    _submit_slug(student, "two-sum", "class Solution:\n    pass\n")
    stats = client.get("/api/student/coding/stats", headers=student["headers"]).json()
    assert stats["activity_days"] == 84 and stats["activity"].get(cps.utc_today().isoformat(), 0) >= 1      # a UTC day: timestamps are stored in UTC
    assert all(len(k) == 10 for k in stats["activity"])


def test_columns_added_after_the_first_release_are_migrated_in_place():
    """A coding_problems table created before param_types / return_type existed must be upgraded, not break every query."""
    import sqlalchemy as sa
    from sqlalchemy.orm import sessionmaker
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE coding_problems (id INTEGER PRIMARY KEY, slug VARCHAR(120))"))
    session = sessionmaker(bind=engine)()
    cps._columns_checked = False
    try:
        cps._ensure_columns(session)
        cols = {c["name"] for c in sa.inspect(engine).get_columns("coding_problems")}
        assert {"param_types", "return_type"} <= cols
        cps._columns_checked = False
        cps._ensure_columns(session)                               # idempotent
    finally:
        session.close()
        cps._columns_checked = True


# ------------------------------------------------------------------ concurrent first use (found by the real-browser run) ------------------------------------------------------------------
class _NoLock:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.mark.parametrize("process_lock", [True, False], ids=["one worker", "several workers"])
def test_simultaneous_first_requests_seed_the_bank_exactly_once(tmp_path, monkeypatch, process_lock):
    """The list page fires overlapping calls; on an empty table they used to both insert the same slugs and one got a 500."""
    import concurrent.futures
    import sqlalchemy as sa
    from sqlalchemy.orm import sessionmaker
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'seed.db'}", connect_args={"check_same_thread": False, "timeout": 60})
    models.CodingProblem.__table__.create(engine)
    maker = sessionmaker(bind=engine)
    if not process_lock:
        monkeypatch.setattr(cps, "_seed_lock", _NoLock())          # separate worker processes share no in-process lock

    def seed():
        session = maker()
        try:
            cps.ensure_seeded(session)
            return session.query(models.CodingProblem).count()
        finally:
            session.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        counts = [f.result(timeout=300) for f in [pool.submit(seed) for _ in range(4)]]       # any exception fails the test
    assert counts == [len(coding_problem_bank.PROBLEMS)] * 4
    check = maker()
    try:
        slugs = [s for (s,) in check.query(models.CodingProblem.slug).all()]
        assert len(slugs) == len(set(slugs)) == len(coding_problem_bank.PROBLEMS)
    finally:
        check.close()
    engine.dispose()


def test_the_bank_is_loaded_at_startup():
    import main
    names = {fn.__name__ for fn in (h for h in main.app.router.on_startup)}
    assert "seed_coding_problem_bank" in names


# ------------------------------------------------------------------ starters stored before the LeetCode-exact format are brought up to date
def test_problems_stored_with_an_older_starter_get_the_current_one(student):
    db = database.SessionLocal()
    try:
        cps.ensure_seeded(db)
        row = db.query(models.CodingProblem).filter(models.CodingProblem.slug == "two-sum").one()
        row.starter_code = "from typing import List\n\n\nclass Solution:\n    def twoSum(self, nums, target):\n        # Write your solution here\n        pass\n"
        db.commit()
        cps._starters_synced = False                                    # a fresh process
        cps._seeded_databases.clear()
        cps.ensure_seeded(db)
        db.refresh(row)
        assert row.starter_code == "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        \n"
    finally:
        db.close()
