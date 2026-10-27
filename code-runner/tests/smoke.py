"""
Smoke / abuse tests for the in-house code runner. Standard library only.

  python code-runner/tests/smoke.py http://127.0.0.1:2358

Run it against a LOCAL container started with the production flags (see the PR description / interviewer-platform-deploy.md).
Never point it at a shared server: several cases deliberately try to exhaust memory, processes and output.
"""
import json
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:2358").rstrip("/")
PY, JAVA = 71, 62
ACCEPTED, TLE, COMPILE, RUNTIME, INTERNAL = 3, 5, 6, 11, 13
results = []


def post(language_id, source, stdin="", cpu=5, wall=10, memory=128000, timeout=60):
    body = json.dumps({"language_id": language_id, "source_code": source, "stdin": stdin,
                       "cpu_time_limit": cpu, "wall_time_limit": wall, "memory_limit": memory}).encode()
    req = urllib.request.Request(f"{BASE}/submissions?wait=true", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, {}


def healthy():
    try:
        with urllib.request.urlopen(f"{BASE}/health", timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False


def check(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))


def status(resp):
    return resp.get("status", {}).get("id")


def main():
    check("runner is healthy", healthy())

    code, r = post(PY, "print(1+1)")
    check("python print(1+1) -> 3, stdout 2", code == 201 and status(r) == ACCEPTED and r["stdout"].strip() == "2", r)

    code, r = post(JAVA, 'public class Main { public static void main(String[] a) { System.out.println("hello"); } }')
    check("java hello world -> 3", code == 201 and status(r) == ACCEPTED and r["stdout"].strip() == "hello", r)

    code, r = post(JAVA, "public class Main { public static void main(String[] a) { int x = ; } }")
    check("java compile error -> 6 with message", status(r) == COMPILE and "error" in r.get("compile_output", ""), r)

    t = time.time()
    code, r = post(PY, "while True: pass", cpu=3, wall=4)
    check("infinite loop -> 5 within the wall limit", status(r) == TLE and time.time() - t < 12, f"{status(r)} {time.time() - t:.1f}s")
    check("runner healthy after infinite loop", healthy())

    t = time.time()
    code, r = post(PY, "import time\ntime.sleep(1000)", cpu=3, wall=3, timeout=40)
    check("a sleeping program is killed at the wall limit -> 5", status(r) == TLE and time.time() - t < 12, f"{status(r)} {time.time() - t:.1f}s")
    t = time.time()
    code, r = post(JAVA, "public class Main { public static void main(String[] a) throws Exception { Thread.sleep(1000000); } }", cpu=3, wall=3, timeout=40)
    check("a sleeping java program is killed at the wall limit -> 5", status(r) == TLE and time.time() - t < 12, f"{status(r)} {time.time() - t:.1f}s")
    check("runner healthy after the sleepers", healthy())

    code, r = post(PY, "x = bytearray(1024 * 1024 * 1024)\nprint(len(x))")
    check("python allocating 1 GB -> not accepted", status(r) != ACCEPTED, r)
    check("runner healthy after 1 GB allocation", healthy())

    code, r = post(PY, "import os\nwhile True:\n    os.fork()", wall=5)
    check("fork bomb contained (answered, not an internal error)", code == 201 and status(r) in (TLE, RUNTIME), r)
    check("runner healthy after fork bomb", healthy())
    code, r = post(PY, "print('still works')")
    check("runner still runs code after fork bomb", status(r) == ACCEPTED, r)

    code, r = post(PY, "import sys\nchunk = 'x' * 1024 * 1024\nfor _ in range(200):\n    sys.stdout.write(chunk)", wall=10)
    check("200 MB output clipped to 64 KB", code == 201 and len(r.get("stdout", "")) <= 64 * 1024, f"{len(r.get('stdout', ''))} bytes")
    check("runner healthy after output flood", healthy())

    code, r = post(PY, "import urllib.request\ntry:\n    urllib.request.urlopen('http://1.1.1.1', timeout=3)\n    print('REACHED')\nexcept Exception:\n    print('blocked')")
    check("no network access", "REACHED" not in r.get("stdout", ""), r)

    code, r = post(PY, "import os\ntry:\n    print(open('/proc/1/environ').read()[:50] or 'EMPTY')\nexcept Exception as e:\n    print('denied')")
    check("cannot read /proc/1/environ", r.get("stdout", "").strip() == "denied", r)

    code, r = post(PY, "import os\nbase = '/tmp/runs'\nseen = []\ntry:\n    seen = os.listdir(base)\nexcept Exception:\n    pass\nother = [d for d in seen if d != os.path.basename(os.getcwd())]\nbad = 0\nfor d in other:\n    try:\n        os.listdir(os.path.join(base, d)); bad += 1\n    except Exception:\n        pass\nprint('LEAK' if bad else 'ok')")
    check("cannot read other runs' directories", "LEAK" not in r.get("stdout", ""), r)

    code, r = post(PY, "import os, signal\ntry:\n    os.kill(1, signal.SIGKILL)\n    print('KILLED')\nexcept Exception:\n    print('denied')")
    check("cannot kill the server (pid 1)", "KILLED" not in r.get("stdout", ""), r)
    check("runner healthy after kill attempt", healthy())

    code, r = post(PY, "for p in ('/x', '/srv/x', '/usr/x'):\n    try:\n        open(p, 'w').write('1'); print('WROTE', p)\n    except Exception:\n        pass\nprint('done')")
    check("cannot write to / or /srv (read-only fs)", "WROTE" not in r.get("stdout", ""), r)

    code, r = post(PY, "import os\nprint(os.getuid())")
    check("code does not run as root", r.get("stdout", "").strip() not in ("0", ""), r)

    codes = []
    lock = threading.Lock()

    def one():
        c, r = post(PY, "import time\ntime.sleep(3)\nprint(1)", wall=8, timeout=90)
        with lock:
            codes.append((c, status(r)))

    threads = [threading.Thread(target=one) for _ in range(20)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    ok_n = sum(1 for c, s in codes if c == 201 and s == ACCEPTED)
    busy_n = sum(1 for c, _ in codes if c == 429)
    other = [c for c, s in codes if not (c in (201, 429))]
    check("20 concurrent requests: all either run or get 429, none error", not other and ok_n + busy_n == 20, f"ok={ok_n} 429={busy_n} other={other}")
    check("runner healthy after the burst", healthy())

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
