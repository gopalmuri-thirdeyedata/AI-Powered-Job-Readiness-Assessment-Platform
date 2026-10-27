# Browser end-to-end tests

Real Chrome (fake camera and microphone) against the **real** frontend (Vite) and the **real** FastAPI backend running on a
scratch SQLite database in a temp directory. Nothing touches `backend/PrepWin.db`; the harness refuses to start unless the
database lives inside its temp directory.

```bash
cd e2e && npm install          # playwright-core only (it drives your installed Chrome)
npm test                       # recruitment + student suites (about 7 minutes)
npm run test:recruitment
npm run test:student
E2E_LIVE_VOICE=1 npm run test:recruitment     # opt-in: real ElevenLabs speech instead of the backend stub (billable)
```

Requirements: Node 22+, a Python environment with the backend dependencies (`backend/venv` is picked up automatically, or set
`E2E_PYTHON`), a JDK 17 (`javac` / `java` on PATH) and Chrome (set `E2E_CHROME` if it is not in a standard location).
`E2E_HEADED=1` shows the browser.

## What is real and what is not

| Real | Substituted (so **not** proven by these tests) |
|---|---|
| Frontend, backend, timing, scoring, authorization, persistence | **Judge0**: code runs on this machine's Python and JDK (`harness/serve.py`). Only the harness does this; the application never executes candidate code itself |
| Chrome, fake camera / microphone devices, fullscreen | **Gemini**: the application's offline mock mode (deterministic) |
| Python and Java compilation / execution | **ElevenLabs**: stubbed in the backend harness (opt in with `E2E_LIVE_VOICE=1`); a real spoken conversation needs a person and a microphone |
| The real email + password login (`/api/auth/login/`, HttpOnly cookie session validated by `/api/auth/me`) | Accounts are seeded by the harness in the throw-away database (PrepWin has no public sign-up) |
| | **YOLO** is real in the frame-analysis authorization tests, replaced by a deterministic response where a test needs a known detection |

The harness also exposes test-only routes (`/__e2e/*`) to seed accounts and tokens, seed an organization, move the server clock forward
(timer tests do not wait an hour) and read the persisted session. They exist only in `harness/serve.py`, never in the application.
