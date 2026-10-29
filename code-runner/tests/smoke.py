"""
Smoke / abuse tests for the in-house code runner (Python, Java, C++, C; single and batch mode). Standard library only.

  docker exec -i <container> python3 - http://127.0.0.1:2358 < code-runner/tests/smoke.py

Run it against a LOCAL container started with the production flags (see interviewer-platform-deploy.md 2A "Safe test run").
Never point it at a shared server: several cases deliberately try to exhaust memory, processes and output.
"""
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:2358").rstrip("/")
PY, JAVA, CPP, C = 71, 62, 54, 50
ACCEPTED, TLE, COMPILE, RUNTIME, INTERNAL = 3, 5, 6, 11, 13
results = []


def raw_post(body, timeout=90):
    req = urllib.request.Request(f"{BASE}/submissions?wait=true", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, {}


def post(language_id, source, stdin="", cpu=5, wall=10, memory=128000, timeout=60):
    return raw_post({"language_id": language_id, "source_code": source, "stdin": stdin,
                     "cpu_time_limit": cpu, "wall_time_limit": wall, "memory_limit": memory}, timeout)


def batch(language_id, source, stdins, cpu=3, wall=6, memory=128000, timeout=90):
    return raw_post({"language_id": language_id, "source_code": source, "stdins": stdins,
                     "cpu_time_limit": cpu, "wall_time_limit": wall, "memory_limit": memory}, timeout)


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


def outs(resp):
    return [r.get("stdout", "").strip() for r in resp.get("results", [])]


def statuses(resp):
    return [r.get("status", {}).get("id") for r in resp.get("results", [])]


# ---- programs (no backslashes in the C / C++ sources, so Python string escapes cannot interfere) ----
CPP_ADD = "#include <bits/stdc++.h>\nusing namespace std;\nint main() { long long a, b; cin >> a >> b; cout << a + b << endl; return 0; }\n"
C_ADD = "#include <stdio.h>\nint main(void) { long long a, b; scanf(\"%lld %lld\", &a, &b); printf(\"%lld\", a + b); return 0; }\n"
JAVA_ADD = "import java.util.*;\npublic class Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); long a = s.nextLong(), b = s.nextLong(); System.out.println(a + b); } }\n"
PY_ADD = "a, b = map(int, input().split())\nprint(a + b)\n"

# The operands come from stdin and the result is used (the asm line forces the writes to happen), so -O2 cannot fold the work away.
DIV_ZERO_C = """#include <stdio.h>
int main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d", a / b); return 0; }
"""
MEM_BOMB_CPP = """#include <cstdio>
#include <cstdlib>
#include <cstring>
int main() { unsigned long n; std::scanf("%lu", &n); char* p = (char*)std::malloc(n); if (!p) return 7; std::memset(p, 1, n);
  __asm__ volatile("" :: "r"(p) : "memory"); std::printf("%d", (int)p[n - 1]); return 0; }
"""
MEM_BOMB_C = """#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) { unsigned long n; scanf("%lu", &n); char* p = malloc(n); if (!p) return 7; memset(p, 1, n);
  __asm__ volatile("" :: "r"(p) : "memory"); printf("%d", (int)p[n - 1]); return 0; }
"""
ADD_TESTS = ["1 2", "10 20", "100 200"]
ADD_EXPECT = ["3", "30", "300"]


def main():
    check("runner is healthy", healthy())
    with urllib.request.urlopen(f"{BASE}/health", timeout=10) as resp:
        info = json.loads(resp.read())
    check("health reports the four languages and slots", info.get("languages") == ["python", "java", "cpp", "c"] and info.get("slots", 0) >= 1, info)

    # ------------------------------------------------------------------ single mode (Judge0-compatible)
    code, r = post(PY, "print(1+1)")
    check("python print(1+1) -> 3, stdout 2", code == 201 and status(r) == ACCEPTED and r["stdout"].strip() == "2", r)

    code, r = post(JAVA, 'public class Main { public static void main(String[] a) { System.out.println("hello"); } }')
    check("java hello world -> 3", code == 201 and status(r) == ACCEPTED and r["stdout"].strip() == "hello", r)

    code, r = post(JAVA, "public class Main { public static void main(String[] a) { int x = ; } }")
    check("java compile error -> 6 with message", status(r) == COMPILE and "error" in r.get("compile_output", ""), r)

    code, r = post(CPP, CPP_ADD, "2 3")
    check("single mode c++ -> 3, stdout 5", code == 201 and status(r) == ACCEPTED and r["stdout"].strip() == "5", r)
    code, r = post(C, C_ADD, "2 3")
    check("single mode c -> 3, stdout 5", code == 201 and status(r) == ACCEPTED and r["stdout"].strip() == "5", r)
    code, r = post(CPP, "int main() { return ; }")
    check("single mode c++ compile error -> 6", status(r) == COMPILE and "error" in r.get("compile_output", ""), r)
    code, r = post(63, "console.log(1)")
    check("unsupported language id -> 13, not a crash", code == 201 and status(r) == INTERNAL, r)

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

    code, r = post(PY, "import os, signal\ntry:\n    os.kill(1, signal.SIGKILL)\n    print('KILLED')\nexcept Exception:\n    print('denied')")
    check("cannot kill the server (pid 1)", "KILLED" not in r.get("stdout", ""), r)
    check("runner healthy after kill attempt", healthy())

    code, r = post(PY, "for p in ('/x', '/srv/x', '/usr/x'):\n    try:\n        open(p, 'w').write('1'); print('WROTE', p)\n    except Exception:\n        pass\nprint('done')")
    check("cannot write to / or /srv (read-only fs)", "WROTE" not in r.get("stdout", ""), r)

    code, r = post(PY, "import os\nprint(os.getuid())")
    check("code does not run as root", r.get("stdout", "").strip() not in ("0", ""), r)

    # ------------------------------------------------------------------ batch mode: happy path, order, timing
    for name, lang, src in (("python", PY, PY_ADD), ("java", JAVA, JAVA_ADD), ("c++", CPP, CPP_ADD), ("c", C, C_ADD)):
        t = time.time()
        code, r = batch(lang, src, ADD_TESTS)
        check(f"{name} batch: 3 tests, order preserved, all accepted", code == 201 and status(r) == ACCEPTED and outs(r) == ADD_EXPECT and statuses(r) == [ACCEPTED] * 3,
              r)
        check(f"{name} batch: per-test results carry stdout/stderr/time/status", all({"stdout", "stderr", "time", "status"} <= set(x) for x in r.get("results", [])) and r.get("compile_output") == "", r)
        print(f"      {name} batch of 3 took {time.time() - t:.2f}s")

    code, r = batch(CPP, CPP_ADD, [])
    check("c++ compile-only (stdins=[]) -> 3, no results", code == 201 and status(r) == ACCEPTED and r.get("results") == [], r)
    code, r = batch(CPP, "int main( {", [])
    check("c++ compile-only with an error -> 6", status(r) == COMPILE and r.get("results") == [], r)
    for name, lang, src in (("c++", CPP, "#include <bits/stdc++.h>\nint main() { int x = ; }\n"), ("c", C, "int main(void) { int x = ; }\n"),
                            ("java", JAVA, "public class Main { public static void main(String[] a) { int x = ; } }")):
        code, r = batch(lang, src, ["1", "2"])
        check(f"{name} batch compile error -> 6, message, no results", status(r) == COMPILE and "error" in r.get("compile_output", "") and r.get("results") == [], r)

    code, r = raw_post({"language_id": CPP, "source_code": CPP_ADD, "stdins": "not a list"})
    check("batch with stdins that is not a list -> 400", code == 400, code)
    code, r = raw_post({"language_id": CPP, "source_code": CPP_ADD, "stdins": ["1 2"] * 21})
    check("batch with more than 20 stdins -> 400", code == 400, code)
    code, r = batch(63, "x", ["1"])
    check("batch with an unsupported language -> 13", status(r) == INTERNAL, r)

    # ------------------------------------------------------------------ batch mode: time limits and the early-stop rule
    spin = "#include <bits/stdc++.h>\nusing namespace std;\nint main() { string s; cin >> s; if (s == \"loop\") { volatile unsigned long x = 0; while (true) x++; } cout << s << endl; return 0; }\n"
    t = time.time()
    code, r = batch(CPP, spin, ["ok1", "loop", "ok2"], cpu=2, wall=3)
    check("one infinite loop does not affect the other tests (3, 5, 3)", statuses(r) == [ACCEPTED, TLE, ACCEPTED] and outs(r)[0] == "ok1" and outs(r)[2] == "ok2", r)
    t = time.time()
    code, r = batch(CPP, spin, ["loop"] * 6, cpu=2, wall=3)
    took = time.time() - t
    notrun = [x for x in r.get("results", []) if "Not run" in x.get("stderr", "")]
    check("two time limits stop the batch: all 6 are 5, the last 4 were not run", statuses(r) == [TLE] * 6 and len(notrun) == 4 and took < 12, f"{statuses(r)} notrun={len(notrun)} {took:.1f}s")
    check("runner healthy after the spinning batch", healthy())

    # ------------------------------------------------------------------ batch mode: crashes and resource abuse
    code, r = batch(CPP, "int main() { int* p = 0; *p = 1; return 0; }\n", ["x"])
    check("c++ segfault -> 11 with a readable reason", statuses(r) == [RUNTIME] and "Segmentation" in r["results"][0]["stderr"], r)
    code, r = batch(C, DIV_ZERO_C, ["1 0"])
    check("c division by zero -> 11 with a readable reason", statuses(r) == [RUNTIME] and "Floating point" in r["results"][0]["stderr"], r)
    code, r = batch(CPP, "#include <cstdlib>\nint main() { abort(); }\n", ["x"])
    check("c++ abort -> 11 'Aborted'", statuses(r) == [RUNTIME] and "Aborted" in r["results"][0]["stderr"], r)
    code, r = batch(CPP, "int main() { return 3; }\n", ["x"])
    check("non-zero exit code -> 11", statuses(r) == [RUNTIME], r)

    code, r = batch(CPP, MEM_BOMB_CPP, ["1073741824"], memory=128000)
    check("c++ allocating 1 GB with a 128 MB limit -> not accepted", statuses(r) and statuses(r)[0] != ACCEPTED, r)
    code, r = batch(C, MEM_BOMB_C, ["1073741824"], memory=128000)
    check("c allocating 1 GB with a 128 MB limit -> not accepted", statuses(r) and statuses(r)[0] != ACCEPTED, r)
    check("runner healthy after the memory bombs", healthy())

    code, r = batch(C, "#include <unistd.h>\nint main(void) { for (;;) fork(); }\n", ["x", "y"], cpu=2, wall=3)
    check("native fork bomb contained (answered with per-test statuses)", code == 201 and status(r) == ACCEPTED and all(s in (TLE, RUNTIME) for s in statuses(r)), r)
    check("runner healthy after the native fork bomb", healthy())
    code, r = batch(CPP, CPP_ADD, ADD_TESTS)
    check("runner still runs c++ after the native fork bomb", outs(r) == ADD_EXPECT, r)

    flood = "#include <stdio.h>\nint main(void) { for (long i = 0; i < 200L * 1024 * 1024 / 64; i++) fputs(\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\", stdout); return 0; }\n"
    code, r = batch(C, flood, ["x"], wall=10, cpu=8)
    check("c 200 MB output clipped to 64 KB", code == 201 and all(len(x.get("stdout", "")) <= 64 * 1024 for x in r.get("results", [])) and r.get("results"), f"{[len(x.get('stdout', '')) for x in r.get('results', [])]}")
    check("runner healthy after the native output flood", healthy())

    net = "#include <stdio.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <unistd.h>\nint main(void) { int s = socket(AF_INET, SOCK_STREAM, 0); struct sockaddr_in a = {0}; a.sin_family = AF_INET; a.sin_port = htons(80); inet_pton(AF_INET, \"1.1.1.1\", &a.sin_addr); alarm(3); if (connect(s, (struct sockaddr*)&a, sizeof a) == 0) puts(\"REACHED\"); else puts(\"blocked\"); return 0; }\n"
    code, r = batch(C, net, ["x"], wall=5)
    check("native code has no network access", "REACHED" not in "".join(outs(r)), r)

    code, r = batch(CPP, "#include <fstream>\n#include <iostream>\nint main() { std::ifstream f(\"/proc/1/environ\"); std::string s; if (f && std::getline(f, s)) std::cout << \"LEAK\"; else std::cout << \"denied\"; }\n", ["x"])
    check("native code cannot read /proc/1/environ", outs(r) == ["denied"], r)
    code, r = batch(C, "#include <stdio.h>\nint main(void) { FILE* f = fopen(\"/srv/x\", \"w\"); FILE* g = fopen(\"/usr/x\", \"w\"); puts(f || g ? \"WROTE\" : \"ro\"); return 0; }\n", ["x"])
    check("native code cannot write to /srv or /usr (read-only fs)", outs(r) == ["ro"], r)
    code, r = batch(C, "#include <stdio.h>\n#include <unistd.h>\nint main(void) { printf(\"%d\", (int)getuid()); return 0; }\n", ["x"])
    check("native code does not run as root", outs(r) and outs(r)[0] not in ("0", ""), r)

    # ------------------------------------------------------------------ isolation between concurrent runs
    peek = ("#include <stdio.h>\n#include <dirent.h>\n#include <string.h>\n#include <unistd.h>\n#include <stdlib.h>\n"
            "int main(void) { char me[4096]; getcwd(me, sizeof me); char* base = strrchr(me, '/') + 1; DIR* d = opendir(\"/tmp/runs\"); int others = 0, leak = 0;\n"
            "if (d) { struct dirent* e; while ((e = readdir(d))) { if (e->d_name[0] == '.' || !strcmp(e->d_name, base)) continue; others++; char p[4300]; snprintf(p, sizeof p, \"/tmp/runs/%s\", e->d_name); DIR* x = opendir(p); if (x) { leak++; closedir(x); } } closedir(d); }\n"
            "printf(\"others=%d leak=%d\", others, leak); return 0; }\n")
    sleepers = [threading.Thread(target=lambda: batch(PY, "import time\ntime.sleep(4)\nprint(1)", ["x"], wall=8)) for _ in range(3)]
    [s.start() for s in sleepers]
    time.sleep(1.0)
    code, r = batch(C, peek, ["x"])
    [s.join() for s in sleepers]
    seen = outs(r)[0] if outs(r) else ""
    check("native code sees other runs' directories exist but cannot open them", "leak=0" in seen and "others=" in seen, seen or r)

    daemon = ("import os, time\nif os.fork() == 0:\n    os.setsid()\n    if os.fork() == 0:\n        time.sleep(60)\n    os._exit(0)\nprint('spawned')\n")
    for _ in range(9):
        batch(PY, daemon, ["x"], wall=5)
    scan = ("import os\nbusy = []\nfor pid in os.listdir('/proc'):\n    if not pid.isdigit() or int(pid) == os.getpid():\n        continue\n    try:\n"
            "        uid = [l for l in open('/proc/%s/status' % pid) if l.startswith('Uid:')][0].split()[1]\n    except Exception:\n        continue\n"
            "    if 10001 <= int(uid) <= 10008:\n        busy.append(pid)\nprint('LEFTOVER', len(busy))\n")
    code, r = batch(PY, scan, ["x"])
    check("processes a run detached from its group are killed after the run", "LEFTOVER 0" in "".join(outs(r)), r)

    # ------------------------------------------------------------------ concurrency
    codes = []
    lock = threading.Lock()

    def one():
        c, r = batch(PY, "import time\ntime.sleep(3)\nprint(1)", ["x"], wall=8, timeout=120)
        with lock:
            codes.append((c, status(r)))

    threads = [threading.Thread(target=one) for _ in range(20)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    ok_n = sum(1 for c, s in codes if c == 201 and s == ACCEPTED)
    busy_n = sum(1 for c, _ in codes if c == 429)
    other = [c for c, s in codes if not (c in (201, 429))]
    check("20 concurrent batches: all either run or get 429, none error", not other and ok_n + busy_n == 20, f"ok={ok_n} 429={busy_n} other={other}")
    check("runner healthy after the burst", healthy())

    # ------------------------------------------------------------------ load-ish: 16 simultaneous c++ batches of 7 tests
    seven = ["%d %d" % (i, i * 2) for i in range(1, 8)]
    expect7 = [str(i * 3) for i in range(1, 8)]
    lat, bad = [], []

    def load_one():
        t0 = time.time()
        c, r = batch(CPP, CPP_ADD.replace("endl", "endl << \"\""), seven, timeout=180)
        with lock:
            lat.append(time.time() - t0)
            if not (c == 201 and outs(r) == expect7):
                bad.append((c, status(r)))

    t0 = time.time()
    threads = [threading.Thread(target=load_one) for _ in range(16)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    wall_total = time.time() - t0
    lat.sort()
    print(f"      16 simultaneous c++ batches x 7 tests: total {wall_total:.1f}s; latency min {lat[0]:.2f}s median {statistics.median(lat):.2f}s p90 {lat[int(len(lat) * 0.9) - 1]:.2f}s max {lat[-1]:.2f}s")
    check("16 simultaneous c++ batches of 7 tests all answered correctly (queued, none 429)", not bad and len(lat) == 16, bad)

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
