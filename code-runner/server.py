"""
Minimal Judge0-compatible code runner for local demos (Java and Python only).

It implements just enough of `POST /submissions?wait=true` for backend/services/judge0_service.py. It is NOT a hardened
sandbox: it is reachable only on the compose-internal network and must not be exposed or used for untrusted traffic.
Use a real Judge0 deployment for production.
"""
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COMPILE_TIMEOUT = 20
RUN_TIMEOUT = 10
MAX_OUTPUT = 64 * 1024

ACCEPTED, TIME_LIMIT, COMPILE_ERROR, RUNTIME_ERROR, INTERNAL = 3, 5, 6, 11, 13
STATUS_TEXT = {3: "Accepted", 5: "Time Limit Exceeded", 6: "Compilation Error",
               11: "Runtime Error (NZEC)", 13: "Internal Error"}


def _clip(text):
    return (text or "")[:MAX_OUTPUT]


def _run(cmd, cwd, stdin="", timeout=RUN_TIMEOUT):
    return subprocess.run(cmd, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=timeout)


def _java_main_class(source):
    # Java requires the file name to match the public class; fall back to Main
    match = re.search(r"public\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)", source)
    return match.group(1) if match else "Main"


def execute(language_id, source, stdin):
    started = time.monotonic()
    with tempfile.TemporaryDirectory() as workdir:
        try:
            if language_id == 62:   # Java
                main_class = _java_main_class(source)
                with open(os.path.join(workdir, f"{main_class}.java"), "w", encoding="utf-8") as fh:
                    fh.write(source)
                compiled = _run(["javac", f"{main_class}.java"], workdir, timeout=COMPILE_TIMEOUT)
                if compiled.returncode != 0:
                    return COMPILE_ERROR, "", "", compiled.stderr or compiled.stdout, started
                run_cmd = ["java", "-Xmx128m", "-cp", workdir, main_class]
            elif language_id in (71, 70):   # Python
                with open(os.path.join(workdir, "main.py"), "w", encoding="utf-8") as fh:
                    fh.write(source)
                run_cmd = ["python3", "main.py"]
            else:
                return INTERNAL, "", f"Language {language_id} is not supported by the demo runner", "", started
            ran = _run(run_cmd, workdir, stdin=stdin)
        except subprocess.TimeoutExpired:
            return TIME_LIMIT, "", "", "", started
        except Exception as exc:  # noqa: BLE001 - report any runner failure as an internal error
            return INTERNAL, "", str(exc), "", started
        status = ACCEPTED if ran.returncode == 0 else RUNTIME_ERROR
        return status, ran.stdout, ran.stderr, "", started


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/about") or self.path.startswith("/health"):
            return self._send(200, {"version": "demo-runner", "languages": ["java", "python"]})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/submissions"):
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "invalid json"})
        status, stdout, stderr, compile_output, started = execute(
            int(data.get("language_id", 0)), data.get("source_code", ""), data.get("stdin", "") or "")
        self._send(201, {
            "token": uuid.uuid4().hex,
            "stdout": _clip(stdout), "stderr": _clip(stderr), "compile_output": _clip(compile_output),
            "time": f"{time.monotonic() - started:.3f}",
            "status": {"id": status, "description": STATUS_TEXT[status]},
        })

    def log_message(self, fmt, *args):
        print("[runner]", fmt % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 2358), Handler).serve_forever()
