# Plan: 20-student trial readiness, and how to deploy the new build files

Owner of the decision: Aniket. Implementer: a teammate who has not seen the analysis. This file is self-contained.
Written 2026-10-28 against `PrepWin` at `b1a72383` plus the uncommitted build-speed changes described in `interviewer-platform-deploy.md` section 5.8.

## 0. Summary

**Scenario.** About 20 college students take the assessment at the same time, all registering through ONE shared link, all doing the AI voice interview and all proctored (YOLO on CPU), on server2 (shared host, about 60 other containers).

**Verdict: the current server can handle it. No upgrade is needed.** CPU, memory and database all have large headroom (measured, section 2). What will break is a handful of limits and operational traps (section 3), and they are cheap to fix:

| # | Problem | Fix | Kind |
| :-: | :--- | :--- | :--- |
| 1 | Registration is limited to 5 per minute per worker per IP, and the backend sees every student as the same IP (`10.97.0.1`) | Make the public limits configurable and raise them for the trial | small code change (T1) |
| 2 | If the backend was restarted shortly before, students' hardware checks hammer `/api/proctor/status` (limit 60 per minute, shared) and see "model error" | Restart 30+ minutes before the trial and check readiness; raise the limit (T1, T5) | ops + config |
| 3 | 20 students pressing Run/Submit on coding in the same second can saturate the code sandbox (backend gives up after about 1.2 s) | Let the backend wait a few seconds for a free slot (T3), and stagger submissions | small code change |
| 4 | Each of 4 workers defaults to 7 torch threads on a shared 8-core host | `OMP_NUM_THREADS=2` (T2): measured as fast, far less contention | config |

**Deployment: yes, redeploy for the new build files, as a separate deploy ("Deploy A") a few days BEFORE the trial changes ("Deploy B").** Details in section 6.

## 1. What to read first

- `interviewer-platform-deploy.md` (runbook): section 2.5 (routine redeploy), 3.7 (stale proxy), 5.8 (build changes and measured numbers).
- `backend/routers/public_assessment.py` (the shared-link flow), `backend/routers/proctor.py` (frames and status), `backend/services/rate_limiter.py`, `backend/services/judge0_service.py` and `backend/services/assessment_engine.py` (code runs), `backend/services/elevenlabs_service.py` (voice).
- The shared-link page reuses the student assessment screens: `frontend/src/pages/candidate/RecruitmentAssessmentPage.jsx` renders `AssessmentWorkspace` from `frontend/src/pages/roleready/RoleReadyAssessment.jsx`.

## 2. Analysis: what the server can take

### 2.1 Measured on server2 (2026-10-28, read-only commands plus one short timing test inside the backend container)

| Item | Result |
| :--- | :--- |
| Host | 8 cores, about 80% idle (vmstat us 12-14, sy 3-5), load average about 2; 35 GiB RAM available; swap full but no swap activity (si/so 0); 321 days uptime, 29 users logged in |
| One proctoring frame (`analyze_frame`, one process, host quiet) | 89 ms at the default 7 threads, 71 ms at 4, 84 ms at 2, 124 ms at 1 |
| Backend workers | about 530 MB RSS each (4 workers, about 2.1 GB in total) |
| MySQL | `max_connections` 151, `Max_used_connections` 10 (pool upper bound is 4 x (10 + 20) = 120, from `backend/database.py`) |
| Client IP the backend records | `auth_sessions.ip_address` is `10.97.0.1` (the Docker bridge gateway) for all sessions |
| Backend env | `OMP_NUM_THREADS` and `MKL_NUM_THREADS` unset; `GEMINI_USE_SDK` unset (SDK unused); `SANDBOX_MAX_CONCURRENCY=2`; `GEMINI_MODEL_NAME=gemini-2.5-flash` |
| Keys | Gemini and ElevenLabs are on paid plans (stated by the owner) |

### 2.2 Load model (arithmetic from the numbers above)

- The browser sends one frame every 3 s (`frontend/src/hooks/useFaceProctoring.js:75`), so 20 students send at most 6.7 frames per second.
- At 84 ms per frame (2 threads) that is 0.56 inference-seconds per second spread over 4 workers: about 14% utilisation per worker.
- CPU cost: each frame uses 2 threads for 84 ms, about 0.17 core-seconds; times 6.7 per second is about 1.1 cores, against about 6.4 free.
- Memory and database: far below their limits.

Assumptions: one quiet-host measurement; a real run will be somewhat slower. Not load-tested.

### 2.3 Read from the code (verify the line numbers before relying on them)

- **Proctoring.** `FRAME_LIMIT_PER_MINUTE=40` per principal (the browser sends 20), one frame in flight per principal, and a per-process inference gate `PROCTOR_MAX_CONCURRENT` (default 4) that answers 503 "busy" instead of queueing (`proctor.py:40-48`, `:193-212`). `status_limiter` is 60 per minute per client IP (`proctor.py:46`, `:141`).
- **Hardware check.** While the model is `loading` the browser polls `/api/proctor/status` every 2 s, up to 45 times (`RoleReadyAssessment.jsx:589-600`). Any non-`ready` answer, including a 429, becomes "model error".
- **Shared-link limits** (all keyed by client IP, all per process, so effective limit is up to 4x, but only if requests spread evenly across workers): `register_limiter` 5 per minute, `start_limiter` 30 per minute (shared by `/start` and `/registration-info`), `meta_limiter` 60 per minute (`public_assessment.py:38-40`; used at `:118`, `:126`, `:188`, `:208`). Session endpoints (heartbeat, draft, submit, run-code, voice-turn) use the session token, not the IP.
- **Client IP.** `client_ip()` trusts `X-Real-IP` only from private peers (`rate_limiter.py:90-108`). Both nginx layers set `X-Real-IP $remote_addr` (`nginx/nginx.conf:47,61,75,85,98,107`; host file `/etc/nginx/sites-enabled/interviewer.learningpath.ai:11`) and no real-IP module is configured, so the backend never sees the student's address.
- **Code runs.** The backend has a non-blocking semaphore of `SANDBOX_MAX_CONCURRENCY` slots per process, 2 each, so 8 in total (`judge0_service.py:459-460,496`). `assessment_engine.py:41-42,141-153` retries 3 times with 0.4 s between tries, then raises `SandboxUnavailable`; the run-code endpoint turns that into HTTP 429 "The code runner is busy" (`assessment_flow_service.py:563`). The runner has 6 user slots, 3 CPUs and 3 GB (`docker-compose.prod.yml`, `code-runner/server.py`).
- **Voice.** One turn = ElevenLabs speech-to-text (`scribe_v1`), a Gemini reply, then ElevenLabs text-to-speech (`eleven_flash_v2_5`) (`elevenlabs_service.py:259,287`), all blocking calls in a worker thread. No per-IP limiter on these endpoints.
- **Gemini.** Not verified for the shared-link flow how many calls a Start makes. For the student-platform flow an analysis read about 5 sequential calls (`roleready.py:260`, `roleready_service.py:1267-1277`), unverified.

### 2.3.1 Claims from the analysis that were NOT verified (check before acting)

- That a coding Submit during sandbox saturation leaves the score as `EVALUATION_PENDING` (`assessment_flow_service.py` around 680).
- The exact Gemini call count per Start in the shared-link flow.

### 2.4 External limits (from vendor docs; check your own plan and project)

- **ElevenLabs concurrent requests**, by plan, text-to-speech on Flash models / speech-to-text: Starter 6 / 12, Creator 10 / 20, Pro 20 / 40, Scale and Business 30 / 60. The app uses the Flash TTS model and non-realtime STT, which are the generous columns. Sources: [text to speech limits](https://elevenlabs.io/docs/help-center/technical/how-many-text-to-speech-requests-can-i-make-and-can-i-increase-it.md), [speech to text limits](https://elevenlabs.io/docs/help-center/product/core-capabilities/speech-to-text/how-many-speech-to-text-requests-can-i-make-and-can-i-increase-it.md). Estimate (not measured): only a handful of calls overlap at any moment for 20 students.
- **Gemini paid Tier 1** for `gemini-2.5-flash` is most often quoted at about 1,000 requests per minute; the daily cap is quoted inconsistently (1,000 vs 10,000), and some users report paid keys showing free-tier limits. Check the real quota for the project in AI Studio / Cloud Console. Sources: [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [forum: Tier 1 key showing free limits](https://discuss.ai.google.dev/t/gemini-api-key-incorrectly-has-free-tier-usage-limits-despite-being-a-tier-1-key/94936).

## 3. Risks, ranked

| # | Risk | Evidence | What the student sees | Severity |
| :-: | :--- | :--- | :--- | :-: |
| 1 | Shared-link registration limit | 5 per minute per worker, all students one IP (2.1, 2.3) | "Too many requests" at registration for a share of students if most register in the same minute | High |
| 2 | Status polling after a restart | 60 per minute shared; 2 s polling while loading (2.3) | Hardware check shows "model error" | Medium (only right after a restart) |
| 3 | Coding burst | 8 backend slots, 1.2 s retry budget (2.3) | "The code runner is busy, retry in a few seconds" on Run; possibly delayed score on Submit (unverified) | Medium |
| 4 | Thread oversubscription | 4 workers x 7 threads on 8 shared cores | Slower frames, noisy neighbour effect on other projects | Low to medium |
| 5 | Voice turns bunching | ElevenLabs plan concurrency | An occasional failed or slow turn | Low (plan dependent) |
| 6 | Gemini daily cap | Unclear daily quota on the paid tier | Generic fallback questions late in the day | Low, but check |

## 4. Tasks for the teammate

Work on a branch from `PrepWin` that already contains the build-speed changes (see T0). Keep these changes in their own commits. Do NOT change YOLO behaviour (thresholds, image size, model) and do NOT remove proctoring.

### T0. Prerequisite: base branch

The build-speed changes (`backend/Dockerfile`, `backend/requirements.txt`, `frontend/Dockerfile`, `frontend/package.json`, `frontend/package-lock.json`, `docker-compose.prod.yml`, `scripts/`, `.gitattributes`, runbook section 5.8) are currently uncommitted in the working tree of whoever ran the analysis. The owner must commit them to `PrepWin` (or a named branch) first. Then:

```bash
git checkout PrepWin && git pull
git checkout -b feature/trial-readiness
bash scripts/build-images.sh backend      # first run builds the tagged base image (minutes); later runs take seconds
```

### T1. Make the public rate limits configurable (and raise them for the trial)

Files: `backend/routers/public_assessment.py:38-40`, `backend/routers/proctor.py:46`, `docker-compose.prod.yml` (backend `environment`), `backend/.env.example`.

Change: read each limit from an environment variable and keep the current number as the default, so nothing changes unless the variable is set. Suggested names (keep the module-level limiter variable names; tests may patch them):

| Variable | Default (unchanged) | Value to set for the trial |
| :--- | :-: | :-: |
| `PUBLIC_REGISTER_LIMIT_PER_MIN` | 5 | 40 |
| `PUBLIC_START_LIMIT_PER_MIN` | 30 | 120 |
| `PUBLIC_META_LIMIT_PER_MIN` | 60 | 240 |
| `PROCTOR_STATUS_LIMIT_PER_MIN` | 60 | 600 |

Notes: the limits are per process, so these are per worker. They still limit abuse per IP per minute; they only stop 20 real students sharing one IP from being blocked. Parse defensively (a bad value falls back to the default). Do not change `auth_fail_limiter` or the login failure limits.

Tests: add unit tests that (a) with no env the limits equal the old numbers, (b) with the env set the new numbers apply. Then run the existing suites that touch these paths and confirm they still pass:

```bash
cd backend && python -m pytest tests/test_public_assessment_registration.py tests/test_proctor_security.py tests/test_shared_link_availability.py -q
```

Acceptance: on a local stack with the trial values set, 20 registrations from one IP inside 60 seconds all succeed; with defaults, the 6th in a minute from one worker is still rejected.

### T2. Limit torch/OpenMP threads

File: `docker-compose.prod.yml`, backend `environment`: add `OMP_NUM_THREADS=2` and `MKL_NUM_THREADS=2`.

Acceptance: inside the container `python -c "import torch; print(torch.get_num_threads())"` prints 2, and the timing script in Appendix A shows about 84 ms per frame (it was 89 ms at the default). No change to detections.

### T3. Let the backend wait briefly for a free sandbox slot

Files: `backend/services/judge0_service.py:459-460,496`, `backend/services/assessment_engine.py:41-42,141-153`.

Change: replace the non-blocking `acquire(blocking=False)` with `acquire(timeout=SANDBOX_WAIT_SECONDS)`, where `SANDBOX_WAIT_SECONDS` comes from an env var, default 0 (identical to today), and set about 6 for the trial. Keep the existing retry logic and the "never resubmit code that may have run" rule intact.

Check the interplay before choosing numbers: 4 workers x `SANDBOX_MAX_CONCURRENCY=2` = 8 backend slots, but the runner has 6 user slots, and it answers 429 with `Retry-After` when full (the adapter already retries that). Leave `SANDBOX_MAX_CONCURRENCY` at 2.

Tests: add a unit test with all slots held (the call waits, then succeeds when one is released, and raises `SandboxBusy` after the timeout); run:

```bash
cd backend && python -m pytest tests/test_code_execution_engines.py tests/test_coding_sandbox_security.py tests/test_judge0_adapter.py -q
```

Also read `assessment_flow_service.py` around line 563 and 680 and confirm what a student sees on Run and on Submit when the sandbox is busy; update section 2.3.1 of this file with what you find.

### T4. (Optional, maintainer only) pass the real client IP through

Only do this if you want per-IP separation in logs and limits. It does NOT remove the shared-IP effect for students on one college network, so T1 is needed regardless.

- Host nginx (`/etc/nginx/sites-enabled/interviewer.learningpath.ai`, shared server, edit only this site): trust `CF-Connecting-IP` only from Cloudflare ranges (`set_real_ip_from <each Cloudflare range>; real_ip_header CF-Connecting-IP;`), and keep `proxy_set_header X-Real-IP $remote_addr;`.
- Inner nginx (`nginx/nginx.conf`): `set_real_ip_from 10.97.0.0/24; real_ip_header X-Real-IP;` in the `server` block, keep the `X-Real-IP $remote_addr` lines.
- Verify: after a login, `SELECT ip_address FROM auth_sessions ORDER BY id DESC LIMIT 3;` shows a real address, not `10.97.0.1`. Test with `curl -H 'X-Real-IP: 1.2.3.4'` against the public URL and confirm the header cannot be spoofed from outside.

### T5. Pre-trial preflight script

Create `scripts/trial-preflight.sh` (bash, LF endings, `bash scripts/trial-preflight.sh`) that prints PASS or FAIL for each of:

1. all containers up and healthy (`docker compose -f docker-compose.prod.yml ps`),
2. `curl -s http://127.0.0.1:8212/health/live` returns alive,
3. `curl -s http://127.0.0.1:8212/api/proctor/status` returns `ready` on 8 consecutive calls (it is answered by whichever worker accepts the call, so repeat it),
4. the code runner runs Python and Java (the snippet in the runbook section 7),
5. MySQL connections well below `max_connections`,
6. the trial env values are present in the backend (`printenv`, non-secret keys only).

### T6. Rehearsal and load test (never on production)

Run on a local Docker stack built with `bash scripts/build-images.sh` (create the schema once before `up`, as in the runbook section 2.6), or on a staging copy off-hours with the maintainer's approval (server2 is shared). Do not call the paid Gemini or ElevenLabs APIs from a load test: test the voice path with 4-5 real people in the rehearsal instead.

Load test outline (k6 or Locust): 20 virtual users, unique test emails.

1. Burst: all 20 `POST /api/public/assessment/{token}/register` within 30 s, then `/start`. Expect no 429 once T1 is applied.
2. Steady state, 10 minutes: each user `POST /api/proctor/analyze-frame` every 3 s with a real 320x240 JPEG (credentials `X-Session-Id` + `X-Session-Token` from the start response; see `proctor.py:94-97` and `frontend/src/services/assessmentApi.js` lines 31 and 110), plus a heartbeat every 30 s.
3. Spike: all 20 `run-code` (Python and Java) in the same second, then again 10 s later.

Measure: frame latency p50 and p95, count of 429 and 503, host CPU from `vmstat 5` and `docker stats`, MySQL connections, runner 429s.

Pass: frame p95 under 1.5 s, frame failures under 2%, no 429 on registration, run-code failures under 5% during the spike and zero after one retry.

Rehearsal: 4-5 real browsers (different laptops, real cameras and microphones) run the whole flow once, the day before.

## 5. Not in scope

- Replacing `ultralytics` / PyTorch with ONNX, or changing YOLO thresholds, image size or model (it can change detections).
- A server upgrade (the numbers do not justify it; revisit only if the load test shows p95 frame latency above 1 s with threads limited).
- Moving the rate limiters to Redis (they are per worker by design; a possible later improvement).
- Any change to Gemini or ElevenLabs plans.

## 6. Deployment plan

### 6.1 Should we redeploy for the new build files? Yes, as its own deploy, first.

Why:

- The build-speed changes (Dockerfile split, trimmed dependencies, base-image script) only help once they are on the server; builds there are currently slow and cold-cache prone.
- Users and admins see no change: proctor detections, the frontend files and the backend test results were checked as identical in section 5.8 of the runbook (on a laptop, not on the server).
- Doing it separately means that if something is wrong on the server, it is attributable to the build change and not to the trial changes.
- Do it a few days before the trial, so the first slow build and any surprise are out of the way.

Risk to watch: this deploy changes the backend image (dependencies differ: no `google-generativeai`, one OpenCV, the proctoring model baked in). The first server build downloads PyTorch and builds the base image (expect minutes; the earlier cold build there took about 7 minutes) and downloads `yolov8n.pt` from GitHub during the build (if that download fails the build still succeeds and the service downloads the model on first use, as before).

### 6.2 Deploy A: the build changes

Prerequisite: T0 committed. Then, on your machine and on server2:

```powershell
# local (PowerShell): package as in runbook 2.2 (excluding backend/.env), scp to server2
```

```bash
# server2
cd ~/interviewer-platform
# keep the current images so you can roll back
docker tag interviewer-platform-backend:latest interviewer-platform-backend:rollback-pre-build-changes
docker tag interviewer-platform-frontend:latest interviewer-platform-frontend:rollback-pre-build-changes
tar -xzvf ~/interviewer_platform.tar.gz -C ~/interviewer-platform > /dev/null && rm -f ~/interviewer_platform.tar.gz
grep -n "thirdeyedata" docker-compose.prod.yml          # must print nothing
bash scripts/build-images.sh backend frontend           # first run builds interviewer-backend-base:<hash>
docker compose -f docker-compose.prod.yml up -d --no-build --no-deps backend frontend
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps reverse_proxy   # runbook 3.7
docker exec interviewer_proxy nginx -t
```

If `bash scripts/build-images.sh` fails with `\r: command not found`, run `sed -i 's/\r$//' scripts/*.sh` and retry.

Verify (wait about 40 s): runbook section 7, plus:

```bash
docker logs interviewer_backend --since 3m 2>&1 | grep -ciE "downloading|6\.25M"     # expect 0 (model is in the image)
curl -s http://127.0.0.1:8212/api/proctor/status                                      # expect "ready" within about a minute of start
docker exec interviewer_backend python -c "import cv2; print(cv2.__version__)"        # expect 5.0.0
curl -s -o /dev/null -w "%{http_code}\n" https://interviewer.learningpath.ai/logo_main.png   # expect 200
```

Rollback: `docker tag interviewer-platform-backend:rollback-pre-build-changes interviewer-platform-backend:latest` (same for frontend), then `docker compose -f docker-compose.prod.yml up -d --no-build --no-deps backend frontend`.

### 6.3 Deploy B: trial-readiness changes (T1, T2, T3, T5)

After code review and passing tests, at least 2 days before the trial:

```bash
# local: package and scp as above; server2:
cd ~/interviewer-platform && tar -xzvf ~/interviewer_platform.tar.gz -C . > /dev/null && rm -f ~/interviewer_platform.tar.gz
bash scripts/build-images.sh backend          # seconds: the dependencies come from the tagged base image
docker compose -f docker-compose.prod.yml up -d --no-build --no-deps backend
bash scripts/trial-preflight.sh
```

Rollback: revert the compose env values and re-tag the previous backend image as in 6.2, then `up -d --no-build --no-deps backend`.

### 6.4 Day-of runbook

- **T-1 day:** rehearsal with 4-5 real browsers; run the load test locally (T6); confirm the Gemini daily quota and the ElevenLabs plan.
- **T-1 hour:** deploy freeze. No builds or restarts after this point.
- **T-30 min:** `docker compose -f docker-compose.prod.yml restart backend`, wait for healthy, run `bash scripts/trial-preflight.sh`. Do not start the trial until `/api/proctor/status` returns `ready` eight times in a row.
- **Ask students to:** register over about 5 minutes (not all in the same second), and submit coding in groups of about 5.
- **During:** `docker stats --no-stream`, `vmstat 5`, `docker logs -f interviewer_backend 2>&1 | grep -E "Traceback| 429 | 503 "`, and watch MySQL connections. Keep one person on the runbook, not the teaching.
- **After:** save the logs and the peak numbers; decide whether to keep or revert the raised limits.

## 7. Open questions for the owner

1. Which ElevenLabs plan? (Creator or higher recommended for the trial; Starter probably works but has less margin.)
2. What is the real Gemini daily quota for the project?
3. Is the trial on production or a staging copy? Server2 is shared, so a load test there needs maintainer approval and an off-hours slot.
4. Who can edit the host nginx file (needed only for T4)?
5. Keep the raised limits after the trial, or revert to the defaults?

## 8. Definition of done

- [ ] T0 committed; Deploy A done and verified on server2; rollback tags exist.
- [ ] T1, T2 and T3 merged with tests; existing suites named in each task still pass; defaults unchanged when the env is unset.
- [ ] T5 preflight script works on server2.
- [ ] Load test passes the thresholds in T6 on a local or staging stack; rehearsal done with real browsers.
- [ ] Deploy B done at least 2 days before the trial; `trial-preflight.sh` is green.
- [ ] The unverified claims in 2.3.1 are checked and this file is updated.

## Appendix A: timing one proctoring frame (inside the running backend container)

```bash
docker exec -i interviewer_backend python - <<'PY'
import base64, sys, time, pathlib
sys.path.insert(0, "/app")
import ultralytics, torch
from services import proctor_service as p
b = base64.b64encode((pathlib.Path(ultralytics.__file__).parent/"assets"/"bus.jpg").read_bytes()).decode()
p.analyze_frame(b)   # warm-up
for threads in (torch.get_num_threads(), 4, 2, 1):
    torch.set_num_threads(threads)
    t = time.time()
    for _ in range(15): p.analyze_frame(b)
    print("threads", threads, "avg ms/frame", round((time.time() - t) / 15 * 1000))
PY
```

## Appendix B: read-only capacity commands (used for section 2.1)

```bash
nproc; uptime; free -h; vmstat 5 3
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | sort -k2 -rn | head -8
docker exec -i interviewer_mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE"' <<'SQL'
SHOW VARIABLES LIKE 'max_connections';
SHOW STATUS LIKE 'Max_used_connections';
SELECT ip_address, COUNT(*) AS sessions FROM auth_sessions GROUP BY ip_address ORDER BY sessions DESC LIMIT 5;
SQL
docker exec interviewer_backend printenv | grep -E '^(OMP_NUM_THREADS|MKL_NUM_THREADS|GEMINI_MODEL_NAME|GEMINI_USE_SDK|GEMINI_MOCK_MODE|SANDBOX_MAX_CONCURRENCY|CODE_RUNNER_URL|PREPWIN_TRUSTED_PROXIES)='
```
