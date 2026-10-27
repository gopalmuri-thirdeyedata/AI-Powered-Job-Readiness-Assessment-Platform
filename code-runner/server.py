"""
In-house Judge0-compatible code runner for Python and Java (language ids 71 / 70 and 62).

It implements just enough of `POST /submissions?wait=true` for backend/services/judge0_service.py.

What is enforced (per submission):
  * the caller's cpu_time_limit / wall_time_limit / memory_limit, clamped to the server maximums below;
  * RLIMIT_CPU, RLIMIT_FSIZE, RLIMIT_NOFILE, RLIMIT_NPROC (and RLIMIT_AS for Python; the JVM gets -Xmx instead);
  * candidate code runs as a throwaway numeric uid (never root, never the server's own account), in its own 0700 work directory
    that is deleted afterwards; the server runs as root only to switch users and clean up, and the container drops every other
    capability (see docker-compose.prod.yml);
  * stdout / stderr go to files and only the first 64 KB are returned, so a program printing gigabytes cannot exhaust memory;
  * each run is its own process group and the whole group is killed on timeout;
  * at most len(UID_POOL) runs at once; extra callers wait ~5 s and then get HTTP 429 with Retry-After (the backend retries).

What is NOT provided: this is an ordinary hardened container shared by all runs. There is no per-run filesystem snapshot, no seccomp
profile of its own, and uids are reused between runs (the work directory is wiped, but a run could leave a background process
behind until its group is killed). Keep it on a private network with no internet and use it for invited candidates only.
"""
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from queue import Empty, Queue

RUNS_DIR = os.environ.get("RUNNER_RUNS_DIR", "/tmp/runs")
UID_POOL = [int(u) for u in os.environ.get("RUNNER_UIDS", "10001,10002,10003,10004,10005,10006").split(",") if u.strip()]
SLOT_WAIT_SECONDS = 5

COMPILE_TIMEOUT = 20
MAX_CPU_SECONDS, DEFAULT_CPU_SECONDS = 10, 5
MAX_WALL_SECONDS, DEFAULT_WALL_SECONDS = 15, 10
MAX_MEMORY_KB, DEFAULT_MEMORY_KB = 512 * 1024, 128 * 1024
MIN_JVM_HEAP_MB = 64
MAX_OUTPUT = 64 * 1024
MAX_SOURCE_BYTES = 256 * 1024
MAX_BODY_BYTES = 1024 * 1024

ACCEPTED, TIME_LIMIT, COMPILE_ERROR, RUNTIME_ERROR, INTERNAL = 3, 5, 6, 11, 13
STATUS_TEXT = {3: "Accepted", 5: "Time Limit Exceeded", 6: "Compilation Error",
               11: "Runtime Error (NZEC)", 13: "Internal Error"}

_slots = Queue()
for _uid in UID_POOL:
    _slots.put(_uid)


class Busy(Exception):
    """No free execution slot within SLOT_WAIT_SECONDS."""


class Limits:
    def __init__(self, data):
        def num(key, default, cap):
            try:
                value = float(data.get(key))
            except (TypeError, ValueError):
                return default
            return min(cap, value) if value > 0 else default
        self.cpu = int(max(1, num("cpu_time_limit", DEFAULT_CPU_SECONDS, MAX_CPU_SECONDS)) + 0.999)
        self.wall = num("wall_time_limit", DEFAULT_WALL_SECONDS, MAX_WALL_SECONDS)
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


def _limiter(limits, address_space):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu, limits.cpu + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
        resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if address_space:
            cap = limits.memory_kb * 1024
            resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
    return apply


def _kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _run(cmd, workdir, uid, stdin, timeout, limits, address_space):
    """Run one command as `uid` in its own process group; stdout / stderr are files, never pipes. Returns (code, out, err, timed_out)."""
    out_path, err_path = os.path.join(workdir, ".stdout"), os.path.join(workdir, ".stderr")
    env = {"PATH": "/opt/java/openjdk/bin:/usr/local/bin:/usr/bin:/bin", "HOME": workdir, "TMPDIR": workdir,
           "LANG": "C.UTF-8", "JAVA_TOOL_OPTIONS": ""}
    in_path = os.path.join(workdir, ".stdin")
    with open(in_path, "w", encoding="utf-8") as fh:
        fh.write(stdin or "")
    os.chown(in_path, uid, uid)
    with open(out_path, "wb") as out, open(err_path, "wb") as err, open(in_path, "rb") as inp:
        os.chown(out_path, uid, uid)
        os.chown(err_path, uid, uid)
        proc = subprocess.Popen(cmd, cwd=workdir, stdin=inp, stdout=out, stderr=err, env=env, start_new_session=True,
                                user=uid, group=uid, extra_groups=[], preexec_fn=_limiter(limits, address_space), close_fds=True)
        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        _kill_group(proc)          # also reaps anything the program left running in its group
        proc.wait()
    return proc.returncode, _read_clipped(out_path), _read_clipped(err_path), timed_out


def _prepare_workdir(uid):
    os.makedirs(RUNS_DIR, exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="run-", dir=RUNS_DIR)
    os.chown(workdir, uid, uid)
    os.chmod(workdir, 0o700)
    return workdir


def _cleanup(workdir):
    shutil.rmtree(workdir, ignore_errors=True)


def _write_source(workdir, uid, name, source):
    path = os.path.join(workdir, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(source)
    os.chown(path, uid, uid)


def _execute_in(workdir, uid, language_id, source, stdin, limits):
    if language_id == 62:   # Java
        main_class = _java_main_class(source)
        _write_source(workdir, uid, f"{main_class}.java", source)
        code, out, err, timed_out = _run(["javac", "-J-Xmx256m", f"{main_class}.java"], workdir, uid, "", COMPILE_TIMEOUT, limits, False)
        if timed_out:
            return COMPILE_ERROR, "", "", "Compilation timed out"
        if code != 0:
            return COMPILE_ERROR, "", "", err or out
        heap_mb = max(MIN_JVM_HEAP_MB, limits.memory_kb // 1024)
        cmd = ["java", f"-Xmx{heap_mb}m", "-Xss512k", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-cp", workdir, main_class]
        address_space = False          # the JVM reserves far more virtual memory than it uses; -Xmx is its cap
    elif language_id in (71, 70):   # Python
        _write_source(workdir, uid, "main.py", source)
        cmd = ["python3", "-B", "-I", "main.py"]
        address_space = True
    else:
        return INTERNAL, "", f"Language {language_id} is not supported by this runner", ""
    code, out, err, timed_out = _run(cmd, workdir, uid, stdin, limits.wall, limits, address_space)
    if timed_out:
        return TIME_LIMIT, out, err, ""
    if code is not None and code < 0 and -code == signal.SIGXCPU:
        return TIME_LIMIT, out, err, ""
    return (ACCEPTED if code == 0 else RUNTIME_ERROR), out, err, ""


def execute(language_id, source, stdin, limits=None):
    """Returns (status, stdout, stderr, compile_output, started). Raises Busy when no slot frees up in time."""
    started = time.monotonic()
    limits = limits or Limits({})
    if len(source.encode("utf-8", errors="replace")) > MAX_SOURCE_BYTES:
        return INTERNAL, "", "Source code is too large", "", started
    try:
        uid = _slots.get(timeout=SLOT_WAIT_SECONDS)
    except Empty:
        raise Busy()
    workdir = None
    try:
        workdir = _prepare_workdir(uid)
        status, out, err, compile_output = _execute_in(workdir, uid, language_id, source, stdin, limits)
        return status, out, err, compile_output, started
    except Exception as exc:  # noqa: BLE001 - report any runner failure as an internal error
        return INTERNAL, "", f"{type(exc).__name__}: {exc}", "", started
    finally:
        if workdir:
            _cleanup(workdir)
        _slots.put(uid)


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
            return self._send(200, {"version": "in-house-runner", "languages": ["java", "python"], "slots": len(UID_POOL)})
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
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "invalid json"})
        try:
            status, stdout, stderr, compile_output, started = execute(
                language_id, str(data.get("source_code", "")), str(data.get("stdin", "") or ""), Limits(data))
        except Busy:
            return self._send(429, {"error": "all execution slots are busy"}, {"Retry-After": "1"})
        self._send(201, {
            "token": uuid.uuid4().hex,
            "stdout": stdout, "stderr": stderr, "compile_output": compile_output,
            "time": f"{time.monotonic() - started:.3f}",
            "status": {"id": status, "description": STATUS_TEXT[status]},
        })

    def log_message(self, fmt, *args):
        print("[runner]", fmt % args, flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 2358), Handler)
    server.daemon_threads = True
    server.serve_forever()
