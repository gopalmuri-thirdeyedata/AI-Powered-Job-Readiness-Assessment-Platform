"""
A fair waiting line in front of the code sandbox for everything a student runs (assessment round, Practice, the Coding page).

Why: the runner executes only a handful of programs at once. When many students press Run or Submit together, calling it directly makes the
surplus requests fail ("busy"), and a student sees an error for code that was fine. Here, surplus requests WAIT their turn (first come, first
served) for a bounded time, and only when the line is too long or the wait is too long do they get the existing "busy, try again" answer.

This only schedules runs. It never changes what runs, with what input, or how the output is judged, so results are exactly the same.

Settings (per server worker; the runner's own capacity is shared by all workers):
    STUDENT_SANDBOX_CONCURRENCY   runs in the sandbox at once            (default 3)
    STUDENT_SANDBOX_WAIT_SECONDS  longest a request waits for its turn    (default 20)
    STUDENT_SANDBOX_MAX_WAITING   longest line before refusing at once    (default 150)
"""
import logging
import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict

from services import judge0_service

logger = logging.getLogger("prepwin.sandbox")


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, "").strip() or default))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, "").strip() or default))
    except ValueError:
        return default


class SandboxGate:
    def __init__(self, concurrency: int, max_wait_seconds: float, max_waiting: int, busy_factory=None):
        # busy_factory(message) builds the exception raised when the line is full or the wait runs out (default: the sandbox's SandboxBusy)
        self._busy = busy_factory or (lambda message: judge0_service.SandboxBusy(message))
        self.concurrency = max(1, int(concurrency))
        self.max_wait_seconds = max(0.0, float(max_wait_seconds))
        self.max_waiting = max(0, int(max_waiting))
        self._slots = threading.Semaphore(self.concurrency)
        self._lock = threading.Lock()
        self._running = 0
        self._waiting = 0
        self._peak_running = 0
        self._admitted = 0
        self._refused_full = 0
        self._refused_timeout = 0
        self._wait_total = 0.0
        self._wait_max = 0.0

    @contextmanager
    def slot(self):
        """Wait for a turn (bounded), run, give the turn back. Raises judge0_service.SandboxBusy when the line is full or the wait runs out."""
        with self._lock:
            if self._waiting >= self.max_waiting:
                self._refused_full += 1
                raise self._busy("The code runner has a long queue right now; please try again in a moment.")
            self._waiting += 1
        started = time.monotonic()
        got = False
        try:
            got = self._slots.acquire(timeout=self.max_wait_seconds)
        finally:
            with self._lock:
                self._waiting -= 1
                if got:
                    waited = time.monotonic() - started
                    self._admitted += 1
                    self._wait_total += waited
                    self._wait_max = max(self._wait_max, waited)
                    self._running += 1
                    self._peak_running = max(self._peak_running, self._running)
                else:
                    self._refused_timeout += 1
        if not got:
            logger.warning("sandbox wait exceeded %.0fs (%d running, %d waiting)", self.max_wait_seconds, self._running, self._waiting)
            raise self._busy("The code runner is busy right now; please try again in a moment.")
        try:
            yield
        finally:
            with self._lock:
                self._running -= 1
            self._slots.release()

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "concurrency": self.concurrency, "running": self._running, "waiting": self._waiting, "peak_running": self._peak_running,
                "admitted": self._admitted, "refused_line_full": self._refused_full, "refused_wait_timeout": self._refused_timeout,
                "average_wait_seconds": round(self._wait_total / self._admitted, 3) if self._admitted else 0.0,
                "max_wait_seconds": round(self._wait_max, 3),
            }


def _from_env() -> SandboxGate:
    return SandboxGate(_int_env("STUDENT_SANDBOX_CONCURRENCY", 3), _float_env("STUDENT_SANDBOX_WAIT_SECONDS", 20.0),
                       _int_env("STUDENT_SANDBOX_MAX_WAITING", 150))


gate = _from_env()


def run(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    """Same contract as judge0_service.execute_code (this is what the assessment engine's `execute` hook takes), after waiting for a turn."""
    with gate.slot():
        return judge0_service.execute_code(language, code, stdin=stdin)       # looked up at call time: tests and alternative runners are honoured


def run_batch(language: str, code: str, stdins) -> Dict[str, Any]:
    """judge0_service.execute_batch after waiting for a turn. A whole batch (compile + every test) holds ONE slot, so a submission costs the
    same turn whether it has 2 tests or 10; this is what keeps many students' runs from starving each other."""
    stdins = list(stdins)
    if any(len((s or "").encode("utf-8")) > judge0_service.MAX_STDIN_BYTES for s in stdins):
        return {"status": "error", "output": "Standard input exceeds the 64 KB limit.", "compile_output": "", "results": [], "raw": {}}
    with gate.slot():
        return judge0_service.execute_batch(language, code, stdins)       # looked up at call time: tests and alternative runners are honoured


def execute(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    """judge0_service.execute_sandboxed (input cap + classification) with the waiting line instead of an immediate refusal."""
    if len((stdin or "").encode("utf-8")) > judge0_service.MAX_STDIN_BYTES:
        return {"status": "error", "output": "Standard input exceeds the 64 KB limit.", "stdout": "", "stderr": "",
                "compile_output": "", "timed_out": False, "execution_time_ms": None, "raw": {},
                "classification": judge0_service.RUNTIME_ERROR}
    result = dict(run(language, code, stdin) or {})
    result["classification"] = judge0_service.classify_execution(result)
    return result
