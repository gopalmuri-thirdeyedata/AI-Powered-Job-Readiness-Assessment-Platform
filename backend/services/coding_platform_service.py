"""
LeetCode-style coding platform (Python only) for the student side.

How a run works
---------------
The student's `class Solution` is embedded in a small harness and sent to the sandbox (Judge0 / the in-house runner) as ONE program
that executes every test case in one process. Only the *inputs* travel to the sandbox (as stdin JSON); the expected answers stay on
the server, so candidate code can never read them. The harness prints one line per run, prefixed with a random nonce the candidate does
not know, containing per-case status, runtime and a digest of the returned value. The server compares digests, so large outputs never
have to fit in the sandbox's 10 KB output cap.
"""
import copy
import datetime as dt
import json
import secrets
import threading
import time
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, defer, load_only

import models
from services import coding_problem_bank, function_style, judge0_service, student_sandbox, student_typed

ACCEPTED = "ACCEPTED"
WRONG_ANSWER = "WRONG_ANSWER"
RUNTIME_ERROR = "RUNTIME_ERROR"
TIME_LIMIT_EXCEEDED = "TIME_LIMIT_EXCEEDED"
COMPILE_ERROR = "COMPILE_ERROR"
OUTPUT_ERROR = "OUTPUT_ERROR"

def utc_today() -> dt.date:
    """Submission times are stored in UTC, so a "day" (streak, activity map, problem of the day) is a UTC day for everyone, consistently."""
    return dt.datetime.now(dt.timezone.utc).date()


PER_CASE_SECONDS = 2.0
ACTIVITY_DAYS = 84               # the heatmap covers twelve weeks
MAX_CODE_CHARS = 20000
MAX_CUSTOM_INPUT_CHARS = 5000
SHOWN_CHARS = 300              # longest input / output echoed back to the browser
STDOUT_SHOWN_CHARS = 1000

# Canonical form of a returned value. This source is used BOTH inside the sandbox harness and on the server, so the two always agree.
CANON_SRC = '''
import json as _json, hashlib as _hashlib

def _canon(v):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else round(v, 6)
    if isinstance(v, (list, tuple)):
        return [_canon(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _canon(x) for k, x in v.items()}
    raise TypeError("unsupported return type: " + type(v).__name__)

def _dump(v):
    return _json.dumps(v, sort_keys=True, separators=(",", ":"))

def _digest(v, mode):
    c = _canon(v)
    if mode in ("unordered", "unordered_nested") and isinstance(c, list):
        if mode == "unordered_nested":
            c = [sorted(x, key=_dump) if isinstance(x, list) else x for x in c]
        c = sorted(c, key=_dump)
    return _hashlib.sha1(_dump(c).encode()).hexdigest()
'''

_canon_ns: Dict[str, Any] = {}
exec(CANON_SRC, _canon_ns)  # trusted constant above
_digest = _canon_ns["_digest"]

# LeetCode's own convention: linked lists and trees are given to the student as ListNode / TreeNode objects and returned the same way,
# while test data stays plain JSON arrays ([1,2,3] and level-order [1,null,2]). Shared by the sandbox harness and the server.
NODES_SRC = '''
from collections import deque as _deque

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def _lc_make_list(values):
    head = None
    for v in reversed(values or []):
        head = ListNode(v, head)
    return head

def _lc_list_values(node, limit=100000):
    out = []
    while node is not None:
        if len(out) >= limit:
            raise ValueError("the returned linked list is too long (or has a cycle)")
        out.append(node.val)
        node = node.next
    return out

def _lc_make_tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue, i = _deque([root]), 1
    while queue and i < len(values):
        cur = queue.popleft()
        if i < len(values) and values[i] is not None:
            cur.left = TreeNode(values[i])
            queue.append(cur.left)
        i += 1
        if i < len(values) and values[i] is not None:
            cur.right = TreeNode(values[i])
            queue.append(cur.right)
        i += 1
    return root

def _lc_tree_values(root, limit=100000):
    out, queue = [], _deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            out.append(None)
            continue
        if len(out) >= limit:
            raise ValueError("the returned tree is too large (or has a cycle)")
        out.append(node.val)
        queue.append(node.left)
        queue.append(node.right)
    while out and out[-1] is None:
        out.pop()
    return out

_LC_IN = {"list": _lc_make_list, "tree": _lc_make_tree}
_LC_OUT = {"list": _lc_list_values, "tree": _lc_tree_values}
'''

_nodes_ns: Dict[str, Any] = {}
exec(NODES_SRC, _nodes_ns)  # trusted constant above
_to_input = lambda value, kind: _nodes_ns["_LC_IN"][kind](value) if kind in _nodes_ns["_LC_IN"] else value      # noqa: E731
_from_output = lambda value, kind: _nodes_ns["_LC_OUT"][kind](value) if kind in _nodes_ns["_LC_OUT"] else value  # noqa: E731

TYPE_DEFINITIONS = {
    "list": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\n",
    "tree": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\n",
}

HARNESS_SRC = r'''
import sys, io, json, time, contextlib, traceback
try:
    import resource
except ImportError:
    resource = None
try:
    import signal
except ImportError:
    signal = None

__CANON__
__NODES__

class _LCTimeout(BaseException):
    pass

def _lc_main():
    payload = json.loads(sys.stdin.read())
    sys.stdin = io.StringIO("")
    nonce, fn, cases = payload["nonce"], payload["fn"], payload["cases"]
    mode, capture, limit = payload["compare"], payload["capture"], payload["limit_s"]
    argtypes, rettype = payload.get("argtypes") or [], payload.get("rettype")
    real_out = sys.stdout

    def emit(obj):
        real_out.write(nonce + json.dumps(obj, separators=(",", ":")) + "\n")
        real_out.flush()

    def user_trace(exc):
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == "solution.py"]
        lines = ["Line %s in %s: %s" % (f.lineno, f.name, (f.line or "").strip()) for f in frames[-3:]]
        return "\n".join(lines + ["%s: %s" % (type(exc).__name__, str(exc)[:300])])

    try:
        code = compile(__USER_CODE__, "solution.py", "exec")
    except SyntaxError as exc:
        emit({"fatal": "COMPILE_ERROR", "message": "Line %s: %s" % (exc.lineno, exc.msg)})
        return
    ns = {"__name__": "__lc_solution__", "ListNode": ListNode, "TreeNode": TreeNode}
    exec(__PRELUDE__, ns)                    # the usual imports are available without writing them, as on LeetCode
    sys.setrecursionlimit(3000)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(code, ns)
        solution = ns["Solution"]()
        method = getattr(solution, fn)
    except KeyError:
        emit({"fatal": "COMPILE_ERROR", "message": "Your code must define a class named Solution."})
        return
    except AttributeError:
        emit({"fatal": "COMPILE_ERROR", "message": "class Solution must define a method named " + fn + "."})
        return
    except BaseException as exc:
        emit({"fatal": "RUNTIME_ERROR", "message": user_trace(exc)})
        return

    def on_alarm(signum, frame):
        raise _LCTimeout()

    use_alarm = signal is not None and hasattr(signal, "setitimer")
    if use_alarm:
        signal.signal(signal.SIGALRM, on_alarm)
    results = []
    for args in cases:
        buf = io.StringIO()
        status, out, err, digest, shown = "ok", None, None, None, None
        started = time.perf_counter()
        try:
            if use_alarm:
                signal.setitimer(signal.ITIMER_REAL, limit)
            args = [_LC_IN[t](a) if t in _LC_IN else a for a, t in zip(args, argtypes + [None] * len(args))]
            with contextlib.redirect_stdout(buf):
                out = method(*args)
            if rettype in _LC_OUT:
                out = _LC_OUT[rettype](out)
            if use_alarm:
                signal.setitimer(signal.ITIMER_REAL, 0)
        except _LCTimeout:
            status = "tle"
        except BaseException as exc:
            if use_alarm:
                signal.setitimer(signal.ITIMER_REAL, 0)
            status, err = "error", user_trace(exc)
        elapsed = (time.perf_counter() - started) * 1000
        if status == "ok":
            try:
                digest = _digest(out, mode)
                shown = json.dumps(_canon(out), separators=(",", ":"))
                if len(shown) > __SHOWN__:
                    shown = None
            except TypeError as exc:
                status, err = "error", "Your function returned a value that cannot be compared: " + str(exc)
        results.append({"s": status, "ms": round(elapsed, 2), "d": digest, "o": shown, "e": err,
                        "p": buf.getvalue()[:__STDOUT__] if capture else None})
        if status != "ok":
            break
    mem = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss if resource else None
    emit({"results": results, "mem_kb": mem})

_lc_main()
'''


def build_program(code: str) -> str:
    """The full sandbox program: the harness with the student's source embedded as a literal (never concatenated as code)."""
    harness = HARNESS_SRC.replace("__CANON__", CANON_SRC).replace("__NODES__", NODES_SRC).replace("__PRELUDE__", repr(function_style.STANDARD_IMPORTS))
    harness = harness.replace("__SHOWN__", str(SHOWN_CHARS)).replace("__STDOUT__", str(STDOUT_SHOWN_CHARS))
    return harness.replace("__USER_CODE__", repr(code))


# ------------------------------------------------------------------------------
# Bank seeding and verification
# ------------------------------------------------------------------------------
def _compile_reference(problem: Dict[str, Any]):
    ns: Dict[str, Any] = {}
    exec(NODES_SRC, ns)
    exec("from typing import List, Optional", ns)
    exec(problem["solution"], ns)  # trusted: our own reference solutions
    method = getattr(ns["Solution"](), problem["fn"])
    argtypes, rettype = problem.get("argtypes") or [], problem.get("rettype")

    def call(*args):
        converted = [_to_input(a, t) for a, t in zip(args, argtypes + [None] * len(args))]
        return _from_output(method(*converted), rettype)
    return call


def _starter(problem: Dict[str, Any]) -> str:
    kinds = []
    for kind in list(problem.get("argtypes") or []) + [problem.get("rettype")]:
        if kind in TYPE_DEFINITIONS and kind not in kinds:
            kinds.append(kind)
    definitions = "".join(TYPE_DEFINITIONS[k] + "\n" for k in kinds)
    # Exactly LeetCode's starter: the signature and an empty body. The usual imports are provided for the student (see STANDARD_IMPORTS).
    return "%sclass Solution:\n    def %s(self, %s) -> %s:\n        \n" % (definitions, problem["fn"], problem["sig"], problem["ret"])


def _split_params(sig: str) -> List[str]:
    """Split 'a: List[int], b: int' on top-level commas only."""
    parts, depth, cur = [], 0, ""
    for ch in sig:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.split(":")[0].strip() for p in parts]


def _display_args(names: List[str], args: List[Any]) -> str:
    return ", ".join("%s = %s" % (n, json.dumps(a, separators=(",", ":"))) for n, a in zip(names, args))


def _compute_problem(problem: Dict[str, Any]) -> Dict[str, Any]:
    """Run the reference solution over every example and test: returns the row values, with expected outputs computed (never typed)."""
    method = _compile_reference(problem)
    names = _split_params(problem["sig"])
    cases, examples = [], []
    for args, known, explanation in problem["examples"]:
        args = list(args)
        expected = json.loads(json.dumps(method(*copy.deepcopy(args))))
        cases.append({"args": args, "expected": expected, "is_example": True, "known": known})
        examples.append({"input": _display_args(names, args), "output": json.dumps(expected, separators=(",", ":")),
                         "explanation": explanation})
    for args in problem["tests"]:
        args = list(args)
        expected = json.loads(json.dumps(method(*copy.deepcopy(args))))
        cases.append({"args": args, "expected": expected, "is_example": False})
    return {"names": names, "cases": cases, "examples": examples}


def verify_bank() -> List[str]:
    """Self-check used by the tests: every reference solution matches the answers known from its statement and every payload fits stdin."""
    problems: List[str] = []
    seen = set()
    for p in coding_problem_bank.PROBLEMS:
        if p["slug"] in seen:
            problems.append("%s: duplicate slug" % p["slug"])
        seen.add(p["slug"])
        try:
            computed = _compute_problem(p)
        except Exception as exc:  # noqa: BLE001
            problems.append("%s: reference solution failed: %s: %s" % (p["slug"], type(exc).__name__, exc))
            continue
        for case in computed["cases"]:
            if case.get("is_example") and case.get("known") is not None and _digest(case["known"], p["compare"]) != _digest(case["expected"], p["compare"]):
                problems.append("%s: reference gave %r but the statement says %r" % (p["slug"], case["expected"], case["known"]))
        payload = json.dumps({"cases": [c["args"] for c in computed["cases"]]})
        if len(payload.encode()) > judge0_service.MAX_STDIN_BYTES - 2048:
            problems.append("%s: test inputs are %d bytes, too large for the sandbox stdin" % (p["slug"], len(payload)))
        if len(computed["cases"]) < 6:
            problems.append("%s: needs at least 6 test cases" % p["slug"])
    return problems


_columns_checked = False


def _ensure_columns(db: Session) -> None:
    """create_all never alters an existing table: add the columns introduced after the table first shipped (idempotent, once per process)."""
    global _columns_checked
    if _columns_checked:
        return
    from sqlalchemy import inspect, text
    present = {c["name"] for c in inspect(db.get_bind()).get_columns("coding_problems")}
    for name, ddl in (("param_types", "JSON"), ("return_type", "VARCHAR(20)")):
        if name not in present:
            db.execute(text(f"ALTER TABLE coding_problems ADD COLUMN {name} {ddl}"))
    inspector = inspect(db.get_bind())
    if inspector.has_table("coding_submissions") and "language" not in {c["name"] for c in inspector.get_columns("coding_submissions")}:
        db.execute(text("ALTER TABLE coding_submissions ADD COLUMN language VARCHAR(20)"))
    db.commit()
    _columns_checked = True


_seed_lock = threading.Lock()
_starters_synced = False
_seeded_databases = set()          # databases this process has fully seeded: later requests skip the check (new problems arrive with a deploy)


def _sync_starters(db: Session) -> None:
    """Problems stored before the starter format changed get the current one (once per process; the starter is cheap to rebuild)."""
    global _starters_synced
    if _starters_synced:
        return
    by_slug = {p["slug"]: p for p in coding_problem_bank.PROBLEMS}
    changed = False
    for row in db.query(models.CodingProblem).all():
        problem = by_slug.get(row.slug)
        if problem is not None and row.starter_code != _starter(problem):
            row.starter_code = _starter(problem)
            changed = True
    if changed:
        db.commit()
    _starters_synced = True


def ensure_seeded(db: Session) -> None:
    """
    Insert any bank problem that is missing (by slug). Existing rows are left alone.
    Safe to call concurrently: requests that arrive together on an empty table (the list page fires several at once) must not
    both insert the same slugs, in this process (lock) or in another worker (the unique slug turns the loser's insert into a
    harmless rollback and a second look at what is still missing).
    """
    from sqlalchemy.exc import IntegrityError
    database_key = str(db.get_bind().url)
    if database_key in _seeded_databases:
        return
    with _seed_lock:
        if database_key in _seeded_databases:
            return
        _ensure_columns(db)
        for _attempt in range(3):
            have = {slug for (slug,) in db.query(models.CodingProblem.slug).all()}
            missing = [(order, p) for order, p in enumerate(coding_problem_bank.PROBLEMS, start=1) if p["slug"] not in have]
            if not missing:
                _sync_starters(db)
                _seeded_databases.add(database_key)
                return
            for order, p in missing:
                computed = _compute_problem(p)
                db.add(models.CodingProblem(
                    slug=p["slug"], title=p["title"], difficulty=p["difficulty"], tags=p["tags"], order_index=order,
                    description=p["description"], constraints=p["constraints"], examples=computed["examples"], hints=p["hints"],
                    function_name=p["fn"], param_names=computed["names"], starter_code=_starter(p), compare_mode=p["compare"],
                    param_types=p.get("argtypes") or None, return_type=p.get("rettype"),
                    test_cases=[{k: v for k, v in c.items() if k != "known"} for c in computed["cases"]],
                    solution_code=p["solution"], solution_explanation=p["explanation"]))
            try:
                db.commit()
                _sync_starters(db)
                _problem_cache.clear()
                _seeded_databases.add(database_key)
                return
            except IntegrityError:
                db.rollback()          # another worker seeded the same rows first: look again at what is still missing


# ------------------------------------------------------------------------------
# Execution
# ------------------------------------------------------------------------------
class CodingPlatformError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _truncate(text: Any, limit: int = SHOWN_CHARS) -> str:
    text = text if isinstance(text, str) else json.dumps(text, separators=(",", ":"))
    return text if len(text) <= limit else text[:limit] + "… (%d characters)" % len(text)


def _execute_typed(problem: models.CodingProblem, language: str, code: str, cases: List[List[Any]], capture: bool) -> Dict[str, Any]:
    """Java / C++ / C (and Python through the Assessment's driver): same answer shape as _execute, so Run and Submit judge it identically."""
    spec = student_typed.coding_spec_for(problem.slug, problem.test_cases)
    if spec is None:
        raise CodingPlatformError("This problem is only available in Python.", 400)
    try:
        run = student_typed.run_cases(spec, language, code, cases)
    except ValueError as exc:
        raise CodingPlatformError(str(exc), 400)
    except (student_typed.SandboxUnavailable, student_typed.SandboxBusy):
        raise CodingPlatformError("The code runner is busy or unavailable right now. Please try again in a few seconds.", 429)
    if run.get("compile_error"):
        return {"fatal": COMPILE_ERROR, "message": _truncate(run["compile_error"], 800)}
    results = []
    for case in run["cases"]:
        item = {"s": case["status"], "ms": case["ms"], "d": None, "o": None, "e": case["error"], "p": case["prints"][:STDOUT_SHOWN_CHARS] if capture else None}
        if case["status"] == "ok":
            item["d"] = _digest(case["value"], problem.compare_mode)
            shown = student_typed.compact(case["value"])
            item["o"] = shown if len(shown) <= SHOWN_CHARS else None
        results.append(item)
        if case["status"] != "ok":
            break                                    # like the Python harness: nothing runs after a failure
    return {"results": results, "mem_kb": None}


def _execute(problem: models.CodingProblem, code: str, cases: List[List[Any]], capture: bool, language: str = "python") -> Dict[str, Any]:
    if language != "python":
        return _execute_typed(problem, language, code, cases, capture)
    nonce ="@@LC-" + secrets.token_hex(12) + "@@"
    stdin = json.dumps({"nonce": nonce, "fn": problem.function_name, "cases": cases, "compare": problem.compare_mode,
                        "capture": capture, "limit_s": PER_CASE_SECONDS,
                        "argtypes": problem.param_types or [], "rettype": problem.return_type})
    try:
        result = student_sandbox.execute("python", build_program(code), stdin)       # waits its turn (fair line) instead of failing at once
    except judge0_service.SandboxBusy:
        raise CodingPlatformError("The code runner is busy right now. Please try again in a few seconds.", 429)
    classification = result.get("classification")
    if classification == judge0_service.INFRASTRUCTURE_ERROR:
        raise CodingPlatformError("The code runner is unavailable right now. Please try again shortly.", 503)
    stdout = result.get("stdout") or ""
    for line in stdout.splitlines():
        if line.startswith(nonce):
            try:
                return json.loads(line[len(nonce):])
            except ValueError:
                break
    if result.get("timed_out") or classification == judge0_service.TIME_LIMIT_EXCEEDED:
        return {"fatal": TIME_LIMIT_EXCEEDED, "message": "Time Limit Exceeded"}
    if classification == judge0_service.COMPILATION_ERROR:
        return {"fatal": COMPILE_ERROR, "message": _truncate(result.get("compile_output") or result.get("stderr") or "Compile error", 800)}
    detail = (result.get("stderr") or result.get("output") or "").strip()
    if detail:
        return {"fatal": RUNTIME_ERROR, "message": _truncate(detail.splitlines()[-1] if detail else detail, 400)}
    return {"fatal": OUTPUT_ERROR, "message": "Your program ended without returning results."}


def _check_code(code: str) -> str:
    code = code or ""
    if not code.strip():
        raise CodingPlatformError("Write some code first.", 400)
    if len(code) > MAX_CODE_CHARS:
        raise CodingPlatformError("Your code is too long (limit %d characters)." % MAX_CODE_CHARS, 400)
    return code


def _get_problem(db: Session, slug: str, with_tests: bool = False) -> models.CodingProblem:
    ensure_seeded(db)
    query = db.query(models.CodingProblem).filter(models.CodingProblem.slug == slug)
    if not with_tests:
        query = query.options(defer(models.CodingProblem.test_cases))           # up to ~100 KB of test inputs the screen never shows
    problem = query.first()
    if problem is None:
        raise CodingPlatformError("Problem not found.", 404)
    return problem


_EXECUTION_FIELDS = ("id", "slug", "function_name", "param_names", "param_types", "return_type", "compare_mode", "test_cases", "examples")
_PROBLEM_CACHE_SECONDS = 600
_problem_cache = {}                # (database, slug) -> (loaded_at, snapshot): problems only change with a deploy
_problem_cache_lock = threading.Lock()


def _snapshot(problem) -> SimpleNamespace:
    """What running code needs from a problem as plain values, detached from the database session (so no connection is held while it runs)."""
    if isinstance(problem, SimpleNamespace):
        return problem
    return SimpleNamespace(**{name: getattr(problem, name) for name in _EXECUTION_FIELDS})


def snapshot_for_execution(db: Session, slug: str) -> SimpleNamespace:
    """The problem (tests included) for a Run or Submit, served from memory after the first use."""
    key = (str(db.get_bind().url), slug)
    now = time.monotonic()
    with _problem_cache_lock:
        hit = _problem_cache.get(key)
    if hit is not None and now - hit[0] < _PROBLEM_CACHE_SECONDS:
        return hit[1]
    snapshot = _snapshot(_get_problem(db, slug, with_tests=True))
    with _problem_cache_lock:
        _problem_cache[key] = (now, snapshot)
    return snapshot


def _release_connection(db: Session) -> None:
    """End the open transaction so the database connection goes back to the pool while code waits for the sandbox and runs."""
    try:
        db.rollback()
    except Exception:  # noqa: BLE001 - the connection is simply released later
        pass


def parse_custom_input(problem: models.CodingProblem, text: str) -> List[Any]:
    """One JSON value per line, one line per parameter (exactly like LeetCode's custom testcase box)."""
    text = (text or "").strip()
    if len(text) > MAX_CUSTOM_INPUT_CHARS:
        raise CodingPlatformError("Custom input is too long.", 400)
    lines = [ln for ln in text.splitlines() if ln.strip() != ""]
    names = problem.param_names or []
    if len(lines) != len(names):
        raise CodingPlatformError("Enter %d line(s), one per parameter: %s." % (len(names), ", ".join(names)), 400)
    try:
        return [json.loads(ln) for ln in lines]
    except ValueError:
        raise CodingPlatformError("Each line must be valid JSON, e.g. [1,2,3] or \"text\" or 5.", 400)


def _language(language: Optional[str]) -> str:
    """'python' | 'java' | 'cpp' | 'c': the Assessment's language list (Python3, Java, C++, C)."""
    try:
        return student_typed.normalize(language)
    except ValueError as exc:
        raise CodingPlatformError(str(exc), 400)


def run_code(db: Session, problem: models.CodingProblem, code: str, custom_input: Optional[str], language: str = "python") -> Dict[str, Any]:
    """The Run button: the examples, plus the student's own testcase when given. Nothing is stored."""
    code = _check_code(code)
    language = _language(language)
    problem = _snapshot(problem)
    _release_connection(db)
    cases = [c for c in problem.test_cases if c.get("is_example")]
    labels = [{"input": e["input"], "expected": e["output"], "custom": False} for e in (problem.examples or [])]
    if custom_input is not None and custom_input.strip():
        args = parse_custom_input(problem, custom_input)
        cases = cases + [{"args": args, "expected": None, "is_example": False}]
        labels.append({"input": _display_args(problem.param_names, args), "expected": None, "custom": True})
    raw = _execute(problem, code, [c["args"] for c in cases], capture=True, language=language)
    if raw.get("fatal"):
        return {"verdict": raw["fatal"], "message": raw.get("message"), "cases": [], "passed": 0, "total": len(cases)}
    out_cases, passed, verdict = [], 0, ACCEPTED
    results = raw.get("results") or []
    for i, label in enumerate(labels):
        r = results[i] if i < len(results) else None
        if r is None:
            out_cases.append({**label, "status": "skipped"})
            continue
        item = {**label, "stdout": r.get("p") or "", "runtime_ms": r.get("ms")}
        if r["s"] == "tle":
            item.update(status="tle", error="Time Limit Exceeded")
            verdict = verdict if verdict != ACCEPTED else TIME_LIMIT_EXCEEDED
        elif r["s"] == "error":
            item.update(status="error", error=r.get("e"))
            verdict = verdict if verdict != ACCEPTED else RUNTIME_ERROR
        else:
            item["actual"] = r.get("o") if r.get("o") is not None else "(output too long to display)"
            if label["custom"]:
                item["status"] = "ran"
            else:
                ok = r["d"] == _digest(cases[i]["expected"], problem.compare_mode)
                item["status"] = "passed" if ok else "failed"
                passed += 1 if ok else 0
                if not ok and verdict == ACCEPTED:
                    verdict = WRONG_ANSWER
        out_cases.append(item)
    return {"verdict": verdict, "cases": out_cases, "passed": passed, "total": len(problem.examples or []), "message": None}


def submit_code(db: Session, profile: models.StudentProfile, problem: models.CodingProblem, code: str, language: str = "python") -> Dict[str, Any]:
    """The Submit button: every test, the first failure decides the verdict. The submission is stored."""
    code = _check_code(code)
    language = _language(language)
    problem = _snapshot(problem)
    profile_id, organization_id = profile.id, profile.organization_id
    _release_connection(db)
    cases = problem.test_cases
    raw = _execute(problem, code, [c["args"] for c in cases], capture=False, language=language)
    total = len(cases)
    verdict, passed, runtime, failed, error_text = ACCEPTED, 0, None, None, None
    memory = raw.get("mem_kb")
    if raw.get("fatal"):
        verdict, error_text = raw["fatal"], raw.get("message")
    else:
        results = raw.get("results") or []
        runtime = int(round(sum(r.get("ms") or 0 for r in results)))
        for i, case in enumerate(cases):
            r = results[i] if i < len(results) else None
            if r is None:        # the harness stopped at an earlier failure
                break
            if r["s"] == "tle":
                verdict = TIME_LIMIT_EXCEEDED
            elif r["s"] == "error":
                verdict, error_text = RUNTIME_ERROR, r.get("e")
            elif r["d"] != _digest(case["expected"], problem.compare_mode):
                verdict = WRONG_ANSWER
                error_text = None
            else:
                passed += 1
                continue
            failed = {"input": _truncate(_display_args(problem.param_names, case["args"]), 600),
                      "expected": _truncate(case["expected"]),
                      "actual": _truncate(r["o"]) if r.get("o") is not None else None}
            break
    submission = models.CodingSubmission(
        student_profile_id=profile_id, organization_id=organization_id, problem_id=problem.id, code=code,
        verdict=verdict, passed=passed, total=total, runtime_ms=runtime if verdict == ACCEPTED else None,
        memory_kb=memory if verdict == ACCEPTED else None, failed_case=failed, error_text=error_text, language=language)
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return {"id": submission.id, "verdict": verdict, "passed": passed, "total": total, "runtime_ms": submission.runtime_ms,
            "memory_kb": submission.memory_kb, "failed_case": failed, "message": error_text,
            "beats_runtime_pct": _beats_runtime_pct(db, problem.id, submission) if verdict == ACCEPTED else None,
            "created_at": submission.created_at.isoformat() if submission.created_at else None}


def _beats_runtime_pct(db: Session, problem_id: int, submission: models.CodingSubmission) -> Optional[float]:
    if submission.runtime_ms is None:
        return None
    base = db.query(models.CodingSubmission).filter(
        models.CodingSubmission.problem_id == problem_id, models.CodingSubmission.verdict == ACCEPTED,
        models.CodingSubmission.runtime_ms.isnot(None), models.CodingSubmission.id != submission.id)
    others = base.count()
    if others < 5:
        return None
    slower = base.filter(models.CodingSubmission.runtime_ms > submission.runtime_ms).count()
    return round(100.0 * slower / others, 1)


# ------------------------------------------------------------------------------
# Listing, detail, history, stats
# ------------------------------------------------------------------------------
def _statuses(db: Session, profile_id: int) -> Dict[int, str]:
    rows = db.query(models.CodingSubmission.problem_id, models.CodingSubmission.verdict).filter(
        models.CodingSubmission.student_profile_id == profile_id).distinct().all()
    status: Dict[int, str] = {}
    for problem_id, verdict in rows:
        if verdict == ACCEPTED:
            status[problem_id] = "solved"
        else:
            status.setdefault(problem_id, "attempted")
    return status


def daily_problem_slug(problems: List[models.CodingProblem], today: Optional[dt.date] = None) -> Optional[str]:
    """One problem per calendar day, the same for every student, cycling through the bank in order."""
    if not problems:
        return None
    return problems[(today or utc_today()).toordinal() % len(problems)].slug


def toggle_bookmark(db: Session, profile: models.StudentProfile, slug: str) -> Dict[str, Any]:
    problem = _get_problem(db, slug)
    existing = db.query(models.CodingBookmark).filter(
        models.CodingBookmark.student_profile_id == profile.id, models.CodingBookmark.problem_id == problem.id).first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"slug": slug, "bookmarked": False}
    db.add(models.CodingBookmark(student_profile_id=profile.id, problem_id=problem.id))
    db.commit()
    return {"slug": slug, "bookmarked": True}


def list_problems(db: Session, profile: models.StudentProfile, difficulty: Optional[str] = None, tag: Optional[str] = None,
                  status: Optional[str] = None, query: Optional[str] = None, bookmarked: bool = False) -> Dict[str, Any]:
    ensure_seeded(db)
    problems = db.query(models.CodingProblem).options(load_only(
        models.CodingProblem.id, models.CodingProblem.slug, models.CodingProblem.title, models.CodingProblem.difficulty,
        models.CodingProblem.tags, models.CodingProblem.order_index)).order_by(models.CodingProblem.order_index).all()
    st = _statuses(db, profile.id)
    marked = {pid for (pid,) in db.query(models.CodingBookmark.problem_id).filter(models.CodingBookmark.student_profile_id == profile.id).all()}
    daily_slug = daily_problem_slug(problems)
    daily = None
    totals = dict(db.query(models.CodingSubmission.problem_id, func.count(models.CodingSubmission.id)).group_by(models.CodingSubmission.problem_id).all())
    accepted = dict(db.query(models.CodingSubmission.problem_id, func.count(models.CodingSubmission.id)).filter(
        models.CodingSubmission.verdict == ACCEPTED).group_by(models.CodingSubmission.problem_id).all())
    items, summary = [], {"Easy": [0, 0], "Medium": [0, 0], "Hard": [0, 0]}
    for p in problems:
        state = st.get(p.id, "todo")
        summary.setdefault(p.difficulty, [0, 0])
        summary[p.difficulty][1] += 1
        if state == "solved":
            summary[p.difficulty][0] += 1
        if difficulty and p.difficulty.lower() != difficulty.lower():
            continue
        if tag and tag.lower() not in [t.lower() for t in (p.tags or [])]:
            continue
        if status and state != status:
            continue
        if query and query.lower() not in p.title.lower():
            continue
        if bookmarked and p.id not in marked:
            continue
        sub_total = totals.get(p.id, 0)
        items.append({"id": p.id, "slug": p.slug, "title": p.title, "difficulty": p.difficulty, "tags": p.tags or [],
                      "status": state, "acceptance_rate": round(100.0 * accepted.get(p.id, 0) / sub_total, 1) if sub_total else None,
                      "order": p.order_index, "bookmarked": p.id in marked, "is_daily": p.slug == daily_slug})
    for p in problems:
        if p.slug == daily_slug:
            daily = {"slug": p.slug, "title": p.title, "difficulty": p.difficulty, "status": st.get(p.id, "todo")}
    all_tags = sorted({t for p in problems for t in (p.tags or [])})
    return {"problems": items, "tags": all_tags, "daily": daily, "bookmarks": len(marked), "stats": get_stats(db, profile, summary)}


def get_stats(db: Session, profile: models.StudentProfile, summary: Optional[Dict[str, List[int]]] = None) -> Dict[str, Any]:
    if summary is None:
        summary = {"Easy": [0, 0], "Medium": [0, 0], "Hard": [0, 0]}
        st = _statuses(db, profile.id)
        for p in db.query(models.CodingProblem).options(load_only(models.CodingProblem.id, models.CodingProblem.difficulty)).all():
            summary.setdefault(p.difficulty, [0, 0])
            summary[p.difficulty][1] += 1
            if st.get(p.id) == "solved":
                summary[p.difficulty][0] += 1
    stamps = [d for (d,) in db.query(models.CodingSubmission.created_at).filter(
        models.CodingSubmission.student_profile_id == profile.id).all() if d]
    days = {d.date() if isinstance(d, dt.datetime) else d for d in stamps}
    activity: Dict[str, int] = {}
    cutoff = utc_today() - dt.timedelta(days=ACTIVITY_DAYS - 1)
    for d in stamps:
        day_ = d.date() if isinstance(d, dt.datetime) else d
        if day_ >= cutoff:
            activity[day_.isoformat()] = activity.get(day_.isoformat(), 0) + 1
    streak, day = 0, utc_today()
    if day not in days:
        day -= dt.timedelta(days=1)
    while day in days:
        streak += 1
        day -= dt.timedelta(days=1)
    return {"solved": sum(v[0] for v in summary.values()), "total": sum(v[1] for v in summary.values()),
            "by_difficulty": {k: {"solved": v[0], "total": v[1]} for k, v in summary.items()}, "streak_days": streak,
            "activity": activity, "activity_days": ACTIVITY_DAYS,
            "submissions": db.query(func.count(models.CodingSubmission.id)).filter(
                models.CodingSubmission.student_profile_id == profile.id).scalar() or 0}


def problem_detail(db: Session, profile: models.StudentProfile, slug: str) -> Dict[str, Any]:
    problem = _get_problem(db, slug)
    mine = db.query(models.CodingSubmission).filter(
        models.CodingSubmission.student_profile_id == profile.id, models.CodingSubmission.problem_id == problem.id)
    solved = mine.filter(models.CodingSubmission.verdict == ACCEPTED).first() is not None
    last = mine.order_by(models.CodingSubmission.id.desc()).first()
    order = [slug_ for (slug_,) in db.query(models.CodingProblem.slug).order_by(models.CodingProblem.order_index).all()]
    idx = order.index(slug) if slug in order else -1
    tests = snapshot_for_execution(db, slug).test_cases           # from memory: the test data is never read from the database for a screen
    first_case_args = tests[0]["args"] if tests else []
    spec = student_typed.coding_spec_for(slug, tests)           # None: only Python for this problem (linked lists, trees ...)
    return {
        "id": problem.id, "slug": problem.slug, "title": problem.title, "difficulty": problem.difficulty, "tags": problem.tags or [],
        "description": problem.description, "constraints": problem.constraints or [], "examples": problem.examples or [],
        "hints": problem.hints or [], "function_name": problem.function_name, "param_names": problem.param_names,
        "starter_code": problem.starter_code, "status": "solved" if solved else ("attempted" if last else "todo"),
        "languages": student_typed.offered_languages(spec), "starters": student_typed.starters(spec, problem.starter_code),
        "last_code": last.code if last else None, "last_language": (last.language or "python") if last else None,
        "bookmarked": db.query(models.CodingBookmark).filter(
            models.CodingBookmark.student_profile_id == profile.id, models.CodingBookmark.problem_id == problem.id).first() is not None,
        "is_daily": bool(order) and slug == order[utc_today().toordinal() % len(order)],       # the same rule as daily_problem_slug, on slugs only
        "solution": {"code": problem.solution_code, "explanation": problem.solution_explanation} if solved else None,
        "default_custom_input": "\n".join(json.dumps(a, separators=(",", ":")) for a in (first_case_args if first_case_args else [])),
        "prev_slug": order[idx - 1] if idx > 0 else None, "next_slug": order[idx + 1] if 0 <= idx < len(order) - 1 else None,
    }


def list_submissions(db: Session, profile: models.StudentProfile, slug: str, limit: int = 50) -> List[Dict[str, Any]]:
    problem = _get_problem(db, slug)
    rows = db.query(models.CodingSubmission).filter(
        models.CodingSubmission.student_profile_id == profile.id, models.CodingSubmission.problem_id == problem.id
    ).order_by(models.CodingSubmission.id.desc()).limit(limit).all()
    return [{"id": r.id, "verdict": r.verdict, "passed": r.passed, "total": r.total, "runtime_ms": r.runtime_ms,
             "language": r.language or "python", "memory_kb": r.memory_kb, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def get_submission(db: Session, profile: models.StudentProfile, submission_id: int) -> Dict[str, Any]:
    row = db.query(models.CodingSubmission).filter(
        models.CodingSubmission.id == submission_id, models.CodingSubmission.student_profile_id == profile.id).first()
    if row is None:
        raise CodingPlatformError("Submission not found.", 404)
    return {"id": row.id, "verdict": row.verdict, "code": row.code, "language": row.language or "python", "passed": row.passed, "total": row.total,
            "runtime_ms": row.runtime_ms, "memory_kb": row.memory_kb, "failed_case": row.failed_case, "message": row.error_text,
            "created_at": row.created_at.isoformat() if row.created_at else None}
