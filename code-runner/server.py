"""
In-house Judge0-compatible code runner for Python, Java, C++ and C (language ids 71 / 70, 62, 54, 50).

It implements just enough of `POST /submissions?wait=true` for backend/services/judge0_service.py. Two modes:

  * single (Judge0-compatible): one program, one stdin, one result;
  * batch ("stdins": [...] in the request): compile ONCE, then run every stdin as its own process and return one result per stdin.
    One uid-pool slot is held for the whole batch. `"stdins": []` compiles only. This is what the assessment engine uses: a
    submission of 7 tests costs one compile, not seven.

What is enforced (per submission, and per test in batch mode):
  * the caller's cpu_time_limit / wall_time_limit / memory_limit, clamped to the server maximums below;
  * RLIMIT_CPU, RLIMIT_FSIZE, RLIMIT_NOFILE, RLIMIT_NPROC (and RLIMIT_AS for Python and native code; the JVM gets -Xmx instead);
  * compilers (javac, g++, gcc) run as the same throwaway uid with their own, larger limits;
  * candidate code runs as a throwaway numeric uid (never root, never the server's own account), in its own 0700 work directory
    that is deleted afterwards; the server runs as root only to switch users and clean up, and the container drops every other
    capability (see docker-compose.prod.yml);
  * stdout / stderr go to files and only the first 64 KB of each are returned, so a program printing gigabytes cannot exhaust memory;
  * each run is its own process group and the whole group is killed on timeout; after a submission every process left by its uid is killed;
  * at most len(UID_POOL) submissions at once; extra callers wait SLOT_WAIT_SECONDS and then get HTTP 429 with Retry-After
    (the backend retries).

What is NOT provided: this is an ordinary hardened container shared by all runs. There is no per-run filesystem snapshot, no seccomp
profile of its own (Docker's default applies), and uids are reused between runs (the work directory is wiped and leftover processes are
killed). Compiled languages mean candidates run arbitrary native code under the limits above. Keep it on a private network with no
internet and use it for invited candidates only.
"""
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from queue import Empty, Queue

RUNS_DIR = os.environ.get("RUNNER_RUNS_DIR", "/tmp/runs")
UID_POOL = [int(u) for u in os.environ.get("RUNNER_UIDS", "10001,10002,10003,10004,10005,10006,10007,10008").split(",") if u.strip()]
SLOT_WAIT_SECONDS = float(os.environ.get("RUNNER_SLOT_WAIT_SECONDS", "10"))

COMPILE_TIMEOUT = 20
COMPILE_CPU_SECONDS = 15
COMPILE_FSIZE = 32 * 1024 * 1024
COMPILE_ADDRESS_SPACE = 1024 * 1024 * 1024          # g++ / gcc only; javac is a JVM and gets -J-Xmx instead
MAX_CPU_SECONDS, DEFAULT_CPU_SECONDS = 10, 5
MAX_WALL_SECONDS, DEFAULT_WALL_SECONDS = 15, 10
BATCH_DEFAULT_CPU_SECONDS, BATCH_DEFAULT_WALL_SECONDS = 3, 6
MAX_MEMORY_KB, DEFAULT_MEMORY_KB = 512 * 1024, 128 * 1024
MIN_JVM_HEAP_MB = 64
MAX_OUTPUT = 64 * 1024
MAX_SOURCE_BYTES = 256 * 1024
MAX_BODY_BYTES = 1024 * 1024
MAX_BATCH_TESTS = 20
MAX_TLE_BEFORE_STOP = 2             # after this many time limits in one batch the remaining tests are not run
BATCH_RUN_PHASE_SECONDS = 40        # total wall time of the run phase of one batch

ACCEPTED, TIME_LIMIT, COMPILE_ERROR, RUNTIME_ERROR, INTERNAL = 3, 5, 6, 11, 13
STATUS_TEXT = {3: "Accepted", 5: "Time Limit Exceeded", 6: "Compilation Error",
               11: "Runtime Error (NZEC)", 13: "Internal Error"}

# Judge0 language ids -> language
LANGUAGES = {71: "python", 70: "python", 62: "java", 54: "cpp", 50: "c"}
LANGUAGE_NAMES = ["python", "java", "cpp", "c"]
NOT_RUN_MESSAGE = "Not run: time limit exceeded earlier"
SIGNAL_REASONS = {
    signal.SIGSEGV: "Segmentation fault",
    signal.SIGABRT: "Aborted",
    signal.SIGFPE: "Floating point exception",
    signal.SIGBUS: "Bus error",
    signal.SIGILL: "Illegal instruction",
    signal.SIGKILL: "Killed (resource limit exceeded)",
    signal.SIGPIPE: "Broken pipe",
    signal.SIGTERM: "Terminated",
}

_slots = Queue()
for _uid in UID_POOL:
    _slots.put(_uid)


class Busy(Exception):
    """No free execution slot within SLOT_WAIT_SECONDS."""


class BadRequest(Exception):
    """The request is not a valid submission (HTTP 400)."""


class Limits:
    def __init__(self, data, default_cpu=DEFAULT_CPU_SECONDS, default_wall=DEFAULT_WALL_SECONDS):
        def num(key, default, cap):
            try:
                value = float(data.get(key))
            except (TypeError, ValueError):
                return default
            return min(cap, value) if value > 0 else default
        self.cpu = int(max(1, num("cpu_time_limit", default_cpu, MAX_CPU_SECONDS)) + 0.999)
        self.wall = num("wall_time_limit", default_wall, MAX_WALL_SECONDS)
        self.memory_kb = int(num("memory_limit", DEFAULT_MEMORY_KB, MAX_MEMORY_KB))


def _clip(data):
    return (data or b"")[:MAX_OUTPUT].decode("utf-8", errors="replace")


def _read_clipped(path):
    try:
        with open(path, "rb") as fh:
            return _clip(fh.read(MAX_OUTPUT))
    except OSError:
        return ""


def _java_main_class(source):
    # Java requires the file name to match the public class; fall back to Main
    match = re.search(r"public\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)", source)
    return match.group(1) if match else "Main"


def _limiter(cpu, address_space=None, fsize=1024 * 1024):
    """RLIMITs applied in the child after fork, before exec. `address_space` in bytes, or None for no cap (the JVM)."""
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
        resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if address_space:
            resource.setrlimit(resource.RLIMIT_AS, (address_space, address_space))
    return apply


def _kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _sweep(uid):
    """Kill every process the throwaway uid still owns (a program that detached itself from its process group)."""
    try:
        subprocess.run([sys.executable, "-c", "import os, signal; os.kill(-1, signal.SIGKILL)"], user=uid, group=uid, extra_groups=[],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, close_fds=True)
    except Exception:  # noqa: BLE001 - best effort
        pass


def _run(cmd, workdir, uid, stdin, timeout, preexec):
    """
    Run one command as `uid` in its own process group; stdout / stderr are files, never pipes.
    Returns (returncode, stdout, stderr, timed_out, elapsed_seconds).
    """
    out_path, err_path = os.path.join(workdir, ".stdout"), os.path.join(workdir, ".stderr")
    env = {"PATH": "/opt/java/openjdk/bin:/usr/local/bin:/usr/bin:/bin", "HOME": workdir, "TMPDIR": workdir,
           "LANG": "C.UTF-8"}
    in_path = os.path.join(workdir, ".stdin")
    with open(in_path, "w", encoding="utf-8") as fh:
        fh.write(stdin or "")
    os.chown(in_path, uid, uid)
    started = time.monotonic()
    with open(out_path, "wb") as out, open(err_path, "wb") as err, open(in_path, "rb") as inp:
        os.chown(out_path, uid, uid)
        os.chown(err_path, uid, uid)
        proc = subprocess.Popen(cmd, cwd=workdir, stdin=inp, stdout=out, stderr=err, env=env, start_new_session=True,
                                user=uid, group=uid, extra_groups=[], preexec_fn=preexec, close_fds=True)
        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        _kill_group(proc)          # also reaps anything the program left running in its group
        proc.wait()
    elapsed = time.monotonic() - started
    return proc.returncode, _read_clipped(out_path), _read_clipped(err_path), timed_out, elapsed


def _prepare_workdir(uid):
    os.makedirs(RUNS_DIR, exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="run-", dir=RUNS_DIR)
    os.chmod(workdir, 0o700)          # mode first: once the directory belongs to `uid`, root (without FOWNER) can no longer chmod it
    os.chown(workdir, uid, uid)
    return workdir


def _cleanup(workdir):
    shutil.rmtree(workdir, ignore_errors=True)


def _write_source(workdir, uid, name, source):
    path = os.path.join(workdir, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(source)
    os.chown(path, uid, uid)


def _signal_reason(returncode):
    if returncode is None or returncode >= 0:
        return ""
    sig = -returncode
    try:
        return SIGNAL_REASONS.get(signal.Signals(sig), f"Killed by signal {sig}")
    except ValueError:
        return f"Killed by signal {sig}"


# ------------------------------------------------------------------------------
# Compile + run plan per language
# ------------------------------------------------------------------------------
def _compile(kind, workdir, uid, source):
    """
    Writes the source and compiles it. Returns (error_text_or_None, run_command, run_address_space_applies).
    `error_text` is the compiler output when compilation failed (status 6).
    """
    if kind == "python":
        _write_source(workdir, uid, "main.py", source)
        return None, ["python3", "-B", "-I", "main.py"], True
    if kind == "java":
        main_class = _java_main_class(source)
        _write_source(workdir, uid, f"{main_class}.java", source)
        cmd = ["javac", "-J-Xmx256m", f"{main_class}.java"]
        limiter = _limiter(COMPILE_CPU_SECONDS, None, COMPILE_FSIZE)
        run_cmd = ["java", "-Xss512k", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-cp", workdir, main_class]
        code, out, err, timed_out, _ = _run(cmd, workdir, uid, "", COMPILE_TIMEOUT, limiter)
        if timed_out:
            return "Compilation timed out", None, False
        if code != 0:
            return err or out or "Compilation failed", None, False
        return None, run_cmd, False          # the JVM reserves far more virtual memory than it uses; -Xmx is its cap
    if kind == "cpp":
        _write_source(workdir, uid, "main.cpp", source)
        cmd = ["g++", "-O2", "-std=gnu++17", "-pipe", "-w", "-I/opt/pch", "-o", "main", "main.cpp"]
    else:
        _write_source(workdir, uid, "main.c", source)
        cmd = ["gcc", "-O2", "-std=gnu11", "-pipe", "-w", "-o", "main", "main.c", "-lm"]
    limiter = _limiter(COMPILE_CPU_SECONDS, COMPILE_ADDRESS_SPACE, COMPILE_FSIZE)
    code, out, err, timed_out, _ = _run(cmd, workdir, uid, "", COMPILE_TIMEOUT, limiter)
    if timed_out:
        return "Compilation timed out", None, False
    if code != 0:
        return err or out or "Compilation failed", None, False
    return None, [os.path.join(workdir, "main")], True


def _run_one(kind, run_cmd, address_space_applies, workdir, uid, stdin, limits):
    """One execution of the compiled program. Returns (status_id, stdout, stderr, elapsed_seconds)."""
    if kind == "java":
        heap_mb = max(MIN_JVM_HEAP_MB, limits.memory_kb // 1024)
        cmd = [run_cmd[0], f"-Xmx{heap_mb}m"] + run_cmd[1:]
    else:
        cmd = run_cmd
    address_space = limits.memory_kb * 1024 if address_space_applies else None
    code, out, err, timed_out, elapsed = _run(cmd, workdir, uid, stdin, limits.wall, _limiter(limits.cpu, address_space))
    if timed_out:
        return TIME_LIMIT, out, err, elapsed
    if code is not None and code < 0 and -code == signal.SIGXCPU:
        return TIME_LIMIT, out, err, elapsed
    if code == 0:
        return ACCEPTED, out, err, elapsed
    reason = _signal_reason(code)
    if reason:
        err = (err + "\n" if err and not err.endswith("\n") else err) + reason
    return RUNTIME_ERROR, out, err, elapsed


def _acquire_slot():
    try:
        return _slots.get(timeout=SLOT_WAIT_SECONDS)
    except Empty:
        raise Busy()


def _release_slot(uid, workdir):
    _sweep(uid)
    if workdir:
        _cleanup(workdir)
    _slots.put(uid)


# ------------------------------------------------------------------------------
# Single mode (Judge0-compatible)
# ------------------------------------------------------------------------------
def execute(language_id, source, stdin, limits=None):
    """Returns (status, stdout, stderr, compile_output, started). Raises Busy when no slot frees up in time."""
    started = time.monotonic()
    limits = limits or Limits({})
    kind = LANGUAGES.get(language_id)
    if kind is None:
        return INTERNAL, "", f"Language {language_id} is not supported by this runner", "", started
    if len(source.encode("utf-8", errors="replace")) > MAX_SOURCE_BYTES:
        return INTERNAL, "", "Source code is too large", "", started
    uid = _acquire_slot()
    workdir = None
    try:
        workdir = _prepare_workdir(uid)
        error, run_cmd, as_applies = _compile(kind, workdir, uid, source)
        if error is not None:
            return COMPILE_ERROR, "", "", error, started
        status, out, err, _ = _run_one(kind, run_cmd, as_applies, workdir, uid, stdin, limits)
        return status, out, err, "", started
    except Exception as exc:  # noqa: BLE001 - report any runner failure as an internal error
        return INTERNAL, "", f"{type(exc).__name__}: {exc}", "", started
    finally:
        _release_slot(uid, workdir)


# ------------------------------------------------------------------------------
# Batch mode: compile once, one process per stdin
# ------------------------------------------------------------------------------
def _result(status, stdout="", stderr="", seconds=0.0):
    return {"stdout": stdout, "stderr": stderr, "time": f"{seconds:.3f}", "status": {"id": status, "description": STATUS_TEXT[status]}}


def execute_batch(language_id, source, stdins, limits):
    """
    Returns (overall_status, compile_output, results). Raises Busy when no slot frees up in time. Results come in the order of `stdins`.
    After MAX_TLE_BEFORE_STOP time limits (or BATCH_RUN_PHASE_SECONDS of running) the remaining tests are reported as time limit exceeded
    without being run, so one infinite loop cannot hold a slot for a long time.
    """
    kind = LANGUAGES.get(language_id)
    if kind is None:
        return INTERNAL, f"Language {language_id} is not supported by this runner", []
    if len(source.encode("utf-8", errors="replace")) > MAX_SOURCE_BYTES:
        return INTERNAL, "Source code is too large", []
    uid = _acquire_slot()
    workdir = None
    try:
        workdir = _prepare_workdir(uid)
        error, run_cmd, as_applies = _compile(kind, workdir, uid, source)
        if error is not None:
            return COMPILE_ERROR, error, []
        results = []
        tle = 0
        phase_started = time.monotonic()
        for stdin in stdins:
            if tle >= MAX_TLE_BEFORE_STOP or time.monotonic() - phase_started >= BATCH_RUN_PHASE_SECONDS:
                results.append(_result(TIME_LIMIT, "", NOT_RUN_MESSAGE))
                continue
            status, out, err, elapsed = _run_one(kind, run_cmd, as_applies, workdir, uid, stdin, limits)
            if status == TIME_LIMIT:
                tle += 1
            results.append(_result(status, out, err, elapsed))
        return ACCEPTED, "", results
    except Exception as exc:  # noqa: BLE001 - report any runner failure as an internal error
        return INTERNAL, f"{type(exc).__name__}: {exc}", []
    finally:
        _release_slot(uid, workdir)


def _parse_stdins(data):
    stdins = data.get("stdins")
    if not isinstance(stdins, list) or len(stdins) > MAX_BATCH_TESTS or not all(isinstance(s, str) for s in stdins):
        raise BadRequest("stdins must be a list of at most %d strings" % MAX_BATCH_TESTS)
    return stdins


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload, headers=None):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/about") or self.path.startswith("/health"):
            return self._send(200, {"version": "in-house-runner", "languages": LANGUAGE_NAMES, "slots": len(UID_POOL), "batch": True})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/submissions"):
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY_BYTES:
                return self._send(413, {"error": "request too large"})
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("not an object")
            language_id = int(data.get("language_id", 0))
            batch = "stdins" in data
            stdins = _parse_stdins(data) if batch else None
        except (ValueError, json.JSONDecodeError, BadRequest):
            return self._send(400, {"error": "invalid json"})
        source = str(data.get("source_code", ""))
        try:
            if batch:
                status, compile_output, results = execute_batch(
                    language_id, source, stdins, Limits(data, BATCH_DEFAULT_CPU_SECONDS, BATCH_DEFAULT_WALL_SECONDS))
                return self._send(201, {
                    "token": uuid.uuid4().hex,
                    "status": {"id": status, "description": STATUS_TEXT[status]},
                    "compile_output": compile_output if status == COMPILE_ERROR else "",
                    "stderr": compile_output if status == INTERNAL else "",
                    "results": results,
                })
            started_status, stdout, stderr, compile_output, started = execute(language_id, source, str(data.get("stdin", "") or ""), Limits(data))
        except Busy:
            return self._send(429, {"error": "all execution slots are busy"}, {"Retry-After": "1"})
        self._send(201, {
            "token": uuid.uuid4().hex,
            "stdout": stdout, "stderr": stderr, "compile_output": compile_output,
            "time": f"{time.monotonic() - started:.3f}",
            "status": {"id": started_status, "description": STATUS_TEXT[started_status]},
        })

    def log_message(self, fmt, *args):
        print("[runner]", fmt % args, flush=True)


if __name__ == "__main__":
    # The default listen backlog is 5: a burst of simultaneous submissions would see "connection reset" before they could queue for a slot.
    ThreadingHTTPServer.request_queue_size = 128
    server = ThreadingHTTPServer(("0.0.0.0", 2358), Handler)
    server.daemon_threads = True
    server.serve_forever()
