# Browser end-to-end tests

Real Chrome (fake camera and microphone) against the **real** frontend (Vite) and the **real** FastAPI backend running on a
scratch SQLite database in a temp directory. Nothing touches `backend/hiringai.db`; the harness refuses to start unless the
database lives inside its temp directory.

```bash
cd e2e && npm install          # playwright-core only (it drives your installed Chrome)
npm test                       # recruitment + student suites (about 7 minutes)
npm run test:recruitment
npm run test:student
E2E_LIVE_VAPI_CALL=1 node --test specs/live-vapi.e2e.test.mjs     # opt-in, billable, real Vapi call (~40 s)
E2E_VAPI_BROWSER_LIVE=1 node --test --test-name-pattern="blocked microphone" specs/recruitment.e2e.test.mjs
```

Requirements: Node 22+, a Python environment with the backend dependencies (`backend/venv` is picked up automatically, or set
`E2E_PYTHON`), a JDK 17 (`javac` / `java` on PATH) and Chrome (set `E2E_CHROME` if it is not in a standard location).
`E2E_HEADED=1` shows the browser.

## What is real and what is not

| Real | Substituted (so **not** proven by these tests) |
|---|---|
| Frontend, backend, timing, scoring, authorization, persistence | **Judge0**: code runs on this machine's Python and JDK (`harness/serve.py`). Only the harness does this; the application never executes candidate code itself |
| Chrome, fake camera / microphone devices, fullscreen | **Gemini**: the application's offline mock mode (deterministic) |
| Python and Java compilation / execution | **Vapi REST**: stubbed in the backend; in the browser the SDK talks to an intercepted endpoint (except the opt-in live specs) |
| The student JWT validated by `/api/auth/me` | **Clerk sign-in** (an external identity provider) cannot be automated; a real JWT is minted by the harness |
| | **YOLO** is real in the frame-analysis authorization tests, replaced by a deterministic response where a test needs a known detection |

The harness also exposes test-only routes (`/__e2e/*`) to mint tokens, seed an organization, move the server clock forward
(timer tests do not wait an hour) and read the persisted session. They exist only in `harness/serve.py`, never in the application.
