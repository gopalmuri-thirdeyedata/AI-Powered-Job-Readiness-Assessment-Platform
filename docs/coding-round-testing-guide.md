# Coding round: testing guide (Python, Java, C++, C)

Written for: the person testing the new LeetCode-style coding round end to end on a development machine, without calling Gemini more than once.

## What you are testing

- The admin generates a blueprint. Each coding problem has a typed signature, **2 examples** (shown to students) and **5 hidden tests**, plus starter code for **Python, Java, C++ and C**. A reference solution is run in the code sandbox during generation, and only tests the reference agrees with are kept.
- A student sees the LeetCode-style screen: only the function to write. **Run** checks the 2 examples (and an optional custom testcase). **Hidden tests are graded once**, when the student submits the section: all **7** tests (2 examples + 5 hidden) count toward the problem's score.
- The code runner compiles once and runs all tests of a submission in one request.

You never need Gemini to test: use the **offline fixtures** (Part 1) or **generate once and reuse** (Part 6).

---

## Part 1: one-time setup (no Gemini)

**1. Start the code runner** (needs Docker Desktop running). From the repository root:

```bash
docker build -t pw-code-runner:dev code-runner
docker run -d --name pw-runner-test -p 2358:2358 --init --read-only \
  --tmpfs /tmp/runs:size=256m,mode=0755,exec,nosuid \
  --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add KILL --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true --cpus 4 --memory 5g --pids-limit 768 pw-code-runner:dev
curl http://127.0.0.1:2358/health        # must show "languages": ["python","java","cpp","c"] and "slots": 8
```

(Publishing port 2358 is for local testing only. In production the runner is reachable only from the backend.)

**2. Point the backend at it.** In `backend/.env` set:

```
GEMINI_MOCK_MODE=true
CODE_RUNNER_URL=http://127.0.0.1:2358/submissions
CODE_EXECUTION_ENGINE=judge0
```

`GEMINI_MOCK_MODE=true` makes "Generate" return built-in fixtures: two realistic coding problems (Pair With Target Sum and Longest Unique Substring) that go through the same verification as real Gemini output. No API key is used. The role shows an "Offline test data" badge.

**3. Start the app:**

```bash
cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm run dev                 # http://localhost:5173
```

---

## Part 2: automated checks (5 minutes)

```bash
# Backend: everything that touches the coding round (no Gemini, no sandbox needed)
cd backend && python -m pytest tests/test_coding_typed.py -q

# The same, plus ALL FOUR languages through the real runner: 36 solutions compiled and run (C, C++, Java, Python) and
# the full candidate journey over the real HTTP routes (generate -> publish -> register -> Run -> Submit -> score)
cd backend && PW_RUNNER_URL=http://127.0.0.1:2358/submissions python -m pytest tests/test_coding_typed.py tests/test_coding_typed_flow.py -q
#   (on Windows PowerShell:  $env:PW_RUNNER_URL="http://127.0.0.1:2358/submissions"; python -m pytest tests/test_coding_typed.py tests/test_coding_typed_flow.py -q)
#   Expected: 87 passed (about 1.5 minutes on an idle machine)

# Runner hardening + batch behaviour (67 checks). Hostile programs run inside the container: run it ONLY on your own machine.
docker exec -i pw-runner-test python3 - http://127.0.0.1:2358 < code-runner/tests/smoke.py

# Frontend
cd frontend && npm test && npm run build
```

Expected: all green. If the matrix part fails, the message names the language and the type that broke.

---

## Part 3: admin flow

1. Sign in as the admin → **Job Roles** → create a role with any job description (50+ characters).
2. Click **Generate** (about 1 second in offline mode). A toast says the blueprint was generated; the card shows "Blueprint v1 · 15 aptitude · 2 coding · 5 interview" and the **Offline test data** badge.
3. Open the blueprint preview → **Coding (2 problems)**. Check each problem has a title, description, and examples.
4. **Publish** → copy the shared link (valid 24 hours).

---

## Part 4: student flow, per language

Open the shared link in a **private window**, register, accept the instructions, start, finish aptitude (any answers), and you land on **Round 2: Practical Coding**. (The entry flow is not part of this test.)

### 4.1 Layout checks (once)
- Left: Description (title, difficulty, 2 examples in `Input: nums = [...]` form, constraints). Right: Code editor on top, **Testcase | Test Result** console below. The dividers drag.
- A language dropdown (Python3 / Java / C++ / C) is in the editor toolbar. Run and Submit are in the top bar.
- The editor starts with **only the function**: no `main`, no input/output code. The C starter has LeetCode's `returnSize` note.
- Testcase tab: Case 1, Case 2, and a **+** custom case.

### 4.2 Accepted run: paste these solutions

**Problem 1: `pairIndices(nums, target)`**

| Language | Solution (replace the whole editor content) |
|---|---|
| Python3 | `class Solution:`<br>`    def pairIndices(self, nums: List[int], target: int) -> List[int]:`<br>`        seen = {}`<br>`        for i, x in enumerate(nums):`<br>`            if target - x in seen:`<br>`                return [seen[target - x], i]`<br>`            seen[x] = i`<br>`        return []` |
| Java | `class Solution { public int[] pairIndices(int[] nums, int target) { for (int i = 0; i < nums.length; i++) for (int j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] == target) return new int[]{i, j}; return new int[0]; } }` |
| C++ | `class Solution { public: vector<int> pairIndices(vector<int>& nums, int target) { for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j}; return {}; } };` |
| C | `int* pairIndices(int* nums, int numsSize, int target, int* returnSize) { for (int i = 0; i < numsSize; i++) for (int j = i + 1; j < numsSize; j++) if (nums[i] + nums[j] == target) { int* r = malloc(2 * sizeof(int)); r[0] = i; r[1] = j; *returnSize = 2; return r; } *returnSize = 0; return NULL; }` |

**Problem 2: `longestUniqueSubstring(s)`**

| Language | Solution |
|---|---|
| Python3 | `class Solution:`<br>`    def longestUniqueSubstring(self, s: str) -> int:`<br>`        last, start, best = {}, 0, 0`<br>`        for i, ch in enumerate(s):`<br>`            if ch in last and last[ch] >= start:`<br>`                start = last[ch] + 1`<br>`            last[ch] = i`<br>`            best = max(best, i - start + 1)`<br>`        return best` |
| Java | `class Solution { public int longestUniqueSubstring(String s) { int[] last = new int[128]; Arrays.fill(last, -1); int start = 0, best = 0; for (int i = 0; i < s.length(); i++) { char c = s.charAt(i); if (last[c] >= start) start = last[c] + 1; last[c] = i; best = Math.max(best, i - start + 1); } return best; } }` |
| C++ | `class Solution { public: int longestUniqueSubstring(string s) { int last[128]; fill(begin(last), end(last), -1); int start = 0, best = 0; for (int i = 0; i < (int)s.size(); i++) { unsigned char c = s[i]; if (last[c] >= start) start = last[c] + 1; last[c] = i; best = max(best, i - start + 1); } return best; } };` |
| C | `int longestUniqueSubstring(char* s) { int last[128]; for (int i = 0; i < 128; i++) last[i] = -1; int start = 0, best = 0; for (int i = 0; s[i]; i++) { unsigned char c = s[i]; if (last[c] >= start) start = last[c] + 1; last[c] = i; if (i - start + 1 > best) best = i - start + 1; } return best; }` |

Click **Run**. Expect **Accepted**, "2/2 examples", a runtime, and per-case Input / Output / Expected. The first Java/C++/C run takes a second or two (compile).

### 4.3 Failure cases (do each in at least C++ and Java, plus once in Python and C)

| Test | How | Expected result |
|---|---|---|
| Wrong answer | `return {};` / `return []` / `return new int[0];` | **Wrong Answer**, failing case highlighted, your output vs expected shown |
| Compile error | delete a `;` or a `)` | **Compile Error**, compiler message, line numbers match the editor (starting at line 1) |
| Signature changed | rename the function or a parameter type | Compile error with the hint "Keep the function ... exactly as in the starter code" |
| Runtime error | C/C++: `int* p = nullptr; return *p;` (use a matching return type). Java: `int[] a = new int[1]; a[5] = 1;` Python: `raise ValueError("boom")` | **Runtime Error** with a readable reason ("Segmentation fault", the exception text, ...) |
| Time limit | `while (true) {}` / `while True: pass` | **Time Limit Exceeded** within about 6 seconds, then the run ends (a second timeout stops the remaining tests early) |
| Prints | add `print("hi")` / `cout << "hi";` before returning | Still **Accepted**; the text shows under a collapsible Stdout, it does not break the answer |
| Custom testcase | Testcase tab → **+** → edit the values (JSON, one per parameter, e.g. `[1,2,3]` and `4`) | A "Custom" case shows your output (nothing to compare against) |
| Bad custom testcase | put `abc` in the `nums` field | A clear message, for example "nums: 'abc' is not valid. Use JSON ..." |
| No result | C++: add `exit(0);` at the top of the function | Runtime Error "did not return a result" |

### 4.4 Language switching
Write something in C++, switch to Java, write something, switch back: **each language keeps its own code**. **Reset** resets only the current language. Submitting uses the language selected at that moment.

---

## Part 5: grading (hidden tests)

1. With correct solutions in all (any mix of languages) → **Submit All & Unlock Interview**. Expect it to finish in a few seconds.
2. In the admin → the candidate's results/report: coding score **100%**, each problem **7/7 tests**, language shown.
3. Repeat with one wrong solution → partial score (for example 2/7: the two examples pass, the 5 hidden fail), and `Wrong answer` is not reported as an error.
4. Repeat with a compile error in the submitted code → 0/7, classification "compilation error", message shown to the admin.
5. Stop the runner (`docker stop pw-runner-test`) and submit → the candidate is **not** scored zero: the round shows evaluation pending and the admin gets "Retry Code Evaluation" once the runner is back (`docker start pw-runner-test`).

Confidentiality check (browser dev tools → Network): the coding problems response contains `starter_code`, `public_test_cases` (2 examples) and the signature. It must **not** contain hidden inputs, expected outputs of hidden tests, or any reference solution.

---

## Part 6: generate once, then reuse the same assessment (no Gemini)

**Fastest way to start testing right now.** A ready-made blueprint is in `backend/scripts/sample_blueprint.json` (15 aptitude, 2 coding problems with 2 examples + 5 hidden tests each, 5 interview questions).

1. In the admin screen create a job role (any title, any description of 50+ characters). Do **not** press Generate.
2. Find its id and load the blueprint into it, publishing at the same time:

```bash
cd backend
python scripts/blueprint_io.py list                                    # shows each role's id
python scripts/blueprint_io.py import --role-id <ID> --file scripts/sample_blueprint.json --publish
```

It prints the shared link. Open it in a private window. Repeat with another role id, or after the link's 24 hours are over (`python scripts/blueprint_io.py publish --role-id <ID>` gives a new link for the same assessment), as often as you like. Nothing calls Gemini.

**To reuse a REAL Gemini blueprint instead** (more realistic aptitude and interview questions):

1. Set `GEMINI_MOCK_MODE=false` in `backend/.env` **once**, restart the backend, create a role and press **Generate** (about 20 to 40 seconds: three Gemini calls run side by side, then the reference solutions are verified; if it says validation failed, press Generate again).
2. Save it: `python scripts/blueprint_io.py export --role-id <ID> --out my_blueprint.json`
3. Set `GEMINI_MOCK_MODE=true` again. From now on: `python scripts/blueprint_io.py import --role-id <ANY_ROLE_ID> --file my_blueprint.json --publish`

The file contains the answer keys and hidden tests: keep it private and do not commit it. `import` refuses a file that does not pass the same validation a generated blueprint must pass.

---

## Part 7: load test with many students

Reality check first: the backend queues runs fairly, so many students pressing Run together wait a few seconds instead of failing. Capacity depends on the machine, so measure on the machine you care about (server2).

**On your machine (runner only), simulates 16 and 40 students submitting at once:** the load checks at the end of `code-runner/tests/smoke.py` print total time, per-request latency and failures for simultaneous 7-test batches in C++ and Java. Measured on a developer laptop with the container limited to 4 CPUs:

| Simultaneous submissions (7 tests each) | C++ total | Python total | Java total |
|---|---|---|---|
| 16 | about 4 s | n/a | about 17-21 s |
| 40 | about 9 s | 3-6 s | some requests refused after 10 s |

Java is the heavy one (about 1.5 CPU-seconds per submission). If most students will use Java, give the runner more CPUs and slots.

**End to end with real browsers:** open 10 to 15 private windows on the same link, register different candidates, reach coding, and press **Run** in all of them within a few seconds, then **Submit**. Watch `docker stats pw-runner-test`. Expect every window to get a result; a few may show "The code runner is busy, please retry" if you push far beyond capacity.

---

## Part 8: deploying to server2 (when you are ready)

Follow `interviewer-platform-deploy.md` section 2A and 2.5. The runner image changed (C/C++ compilers, precompiled header), the runner compose settings changed (`exec` tmpfs, 8 slots, 4 CPUs, 5 GB) and the backend has a new variable:

```bash
bash scripts/build-images.sh backend frontend code_runner
docker compose -f docker-compose.prod.yml up -d --no-build --no-deps code_runner backend frontend
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps reverse_proxy
docker exec interviewer_backend python -c "import urllib.request; print(urllib.request.urlopen('http://code_runner:2358/health').read())"
#   must list python, java, cpp, c and 8 slots
```

Old published assessments keep working (they stay Python-only). Only blueprints generated after this release contain typed, multi-language problems.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Run says "Compilation timed out" or "The code runner is busy" for Java / C++ / C only | The machine is overloaded. A hello-world C++ compile takes about 0.6 s on an idle laptop but was 18 s when several test runs and a Docker build ran together. Close heavy programs, run one thing at a time, and retry. |
| Run returns "The code runner is temporarily unavailable" | The runner container is not running or `CODE_RUNNER_URL` is wrong: `docker ps`, `curl http://127.0.0.1:2358/health`, then restart the backend after editing `backend/.env`. |
| `/health` lists only `java` and `python` | An old runner image. Rebuild: `docker build -t pw-code-runner:dev code-runner` and start the container again. |
| Every compiled run fails with "Permission denied" | The runs tmpfs is `noexec`. Docker needs `exec` written explicitly: `--tmpfs /tmp/runs:size=256m,mode=0755,exec,nosuid`. |
| Generate shows "did not pass validation" with real Gemini | A coding problem failed verification twice (its reference solution disagreed with its own answers). Press Generate again; otherwise adjust the job description. |
| A role created before this release only offers Python | Expected. Press Generate again to get a typed, 4-language blueprint (a new version). |

---

## Known limits

- Types are limited to int, long, double, bool, string, int[], long[], double[], bool[], string[] and int[][]. No linked lists or trees yet.
- Test inputs are small. Performance tests with huge inputs are not part of generation.
- One language per problem is graded (the one selected at submit).
- The runner is a hardened shared container for invited candidates; it is not a per-run VM.
