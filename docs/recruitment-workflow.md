# Admin Recruitment Assessment Workflow — Operations Guide

Implements `docs/superpowers/plans/2026-10-22-admin-recruitment-workflow.md` (v3.6).

## Flow

Admin (sidebar → *Recruitment Workspace*) creates a role and pastes the JD (*Job Roles & Blueprints*) → Gemini generates a
validated blueprint (15 aptitude MCQ, 2 coding problems, 5 interview questions; no generic fallback — failure is HTTP 502 and
the existing blueprint is kept) → Publish creates **one reusable link** `/assessment/join/<share_token>` (*Shared Links*) →
candidates register with Name / Phone / Email (no OTP, no accounts) → the dedicated **Exam Instructions** page
(`/assessment/join/<share_token>/instructions`) → acknowledgement checkbox → **device check** (camera, microphone, fullscreen;
`/assessment/join/<share_token>/assessment`) → *Start Assessment* creates the single attempt and the server-authoritative deadline →
Aptitude (20m) → Coding (20m, Monaco, Python + Java) → voice-based AI Technical Interview (20m, Vapi), 60 minutes hard stop →
results appear live in *Candidate Results* (search, role/status filters, sorting, pagination, dossier).

Registering, opening or refreshing the instructions page, ticking the acknowledgement box and doing the device check never start
an attempt or a timer; only the *Start Assessment* click (one `POST /start`, guarded against double clicks and consumed by the
one-attempt rule) does. The server refuses `POST /start` without `{"acknowledged": true}` and records the acknowledgement
(`activity_logs`, action `ASSESSMENT_RULES_ACKNOWLEDGED`, shown in the dossier).

## One assessment engine, two lifecycles

The Student Platform's assessment implementation is the source of truth for assessment *functionality*; Admin Recruitment's
timing rules and equal-weight scoring apply to *both* workflows. Shared code:

| Layer | Module / component | Used by |
|---|---|---|
| Timing + scoring policy | `services/assessment_policy.py` (20/20/20 min, 60 min, 10 s arrival window, `overall_score`) | both lifecycles |
| Round formats, aptitude / coding / interview evaluation, drafts | `services/assessment_engine.py` | both lifecycles |
| Blueprint → student formats (the explicit adapter) | `assessment_engine.adapt_blueprint()` | recruitment |
| Workspace UI (aptitude, Monaco, Vapi, timers, drafts, proctoring) | `pages/roleready/RoleReadyAssessment.jsx` → `AssessmentWorkspace` | both |
| API contract of the workspace | `services/assessmentApi.js` (`createStudentAssessmentApi`, `createRecruitmentAssessmentApi`) | both |
| Code sandbox | `services/piston_service.py` (Judge0 adapter) | both |

Deliberately separate (different identity and attempt model): student JWT / invitation-token auth and attempt management
(`roleready_service`, `/api/roleready/*`) versus the public capability API (`assessment_flow_service`, `/api/public/assessment/*`:
share token → registration token → session token + in-memory lease), the no-resume rules, the sweeper and the admin reports.

**Blueprint adapter.** Blueprint problems use function-call JSON inputs; the student engine runs stdin/stdout programs. The adapter
renders each test input as one JSON value per line in `solve(...)` parameter order (read from the starter code, because JSON
object key order is not reliable in every database) and the expected value as JSON; the Python starter carries a harness that reads
that stdin and prints `json.dumps(solve(...))`; the Java starter documents the format. Recruitment problems are compared with
`comparison: "json"` (text first, then JSON/numeric equivalence); student problems keep exact text comparison. Aptitude questions
become `{key,text}` option lists; interview questions become `{id, category, question}` for the browser and keep the rubric in the
server-only half.

## Standardized timing and scoring (both workflows)

* Aptitude 20 min, Coding 20 min, Interview 20 min, 60 min overall. The overall deadline is created only by the explicit start
  (`start-aptitude` for students, `POST /start` for candidates), never moves, and caps every later section
  (`min(section start + 20 min, overall deadline)`). Repeated or concurrent start requests cannot reset it (atomic state claim).
* Server enforcement (student: `finalize_expired_round` on every request; recruitment: `_enforce_expiry` + sweeper): a section past
  its deadline (+10 s arrival window) is closed from the autosaved draft and the attempt advances; past the overall deadline the
  active section is scored from its draft, later sections become `UNATTEMPTED`, the attempt is `TIMED_OUT` and its overall score is
  null. Running code is rejected at the deadline (no arrival window). Closed attempts are never reopened.
* Overall = `(Aptitude % + Coding % + Interview %) / 3`, null unless all three sections are complete. Section percentages follow the
  Student Platform's logic (aptitude: % correct; coding: hidden tests passed / hidden tests total; interview: the AI evaluator's
  overall score). Every result is stamped `scoring_model = "equal_v1"`.
* `roleready_sessions.overall_readiness_score` is NOT NULL and holds `0.0` for incomplete attempts; **every reader goes through
  `reported_overall()` / `report.overall_score`, which return null unless the attempt is COMPLETED.**
* Sessions that were already running before this change (no `overall_deadline_at`) keep their original per-round limits and get no
  invented deadline; only rounds that start afterwards use the 20-minute limit.

### Historical results

Persisted student scores (25/40/35 weighting) are **not rewritten**. They are labelled `legacy_weighted_25_40_35` in the API and the
report page. `python audit_assessment_scoring.py [--csv out.csv]` is a read-only report of how many legacy attempts would differ
under equal weighting. A recalculation, if approved, must be a separate migration with a verified backup and a per-row record of the
previous value.

## Admin navigation

The admin UI contains only the recruitment workflow: **Recruitment Workspace** (`/admin/dashboard`) with four tabs driven by the
URL (`?tab=roles|links|results`; Overview is the default, so refresh, Back/Forward and deep links work): *Overview* (KPIs + next
step), *Job Roles & Blueprints* (create / generate / review / publish), *Shared Links* (copy, preview, close, reopen) and
*Candidate Results* (roster + dossiers). Platform administrators additionally see *Organizations*.

Resume Screening, Screened Candidates, Assessment Rounds, Invitation Assessments, Recruitment Analytics and Enterprise Settings
were removed from the admin UI; their old URLs redirect to the workspace. Their backend APIs and data are untouched.
`/api/roleready/admin/tracking` stays tenant scoped (org-less student sessions of other tenants are no longer returned).

## Proctoring and interruptions

* The shared workspace records integrity events (fullscreen exit, tab/window switch, camera checks). Students keep the three-strike
  termination. For shared-link candidates the events are saved with the drafts and submissions (`proctoring_violations`) and shown in
  the dossier; **they never end or invalidate an attempt on their own** (a browser event is not a verdict).
* The unload beacon (`POST .../abandon`) is advisory and never abandons. Abandonment is decided from server evidence only: a request
  without the lease after the heartbeat went stale, or the sweeper finding no heartbeat for 60 s. Infrastructure failure is only ever
  set by a platform administrator's incident record.
* Voice: the Vapi call's `maxDurationSeconds` is the seconds left on the server clock. If the voice connection fails, the interview
  screen offers an explicit *Answer in writing instead* fallback (voice stays the default).

## Blueprints and shared links

* A job role gets its assessment blueprint **only from Gemini** (*Job Roles & Blueprints* -> **Generate with Gemini**, then Review and
  Publish). There is no predefined or "demo" blueprint and no other fallback. In development, `GEMINI_MOCK_MODE` produces a fixed
  offline fixture that is labelled **Offline test data**, never "Gemini".
* When Gemini cannot be reached or is out of quota the request fails with HTTP 502 and a readable message, the role card shows it
  as a failure, nothing is stored or replaced, and Publish stays disabled until a valid blueprint exists. Regenerating keeps the
  previous version in `job_blueprint_versions`. Blueprints created earlier through the removed template keep working; they simply
  show no provenance badge.
* **Shared links do not expire.** The data model has no link-expiry timestamp. A link works while the role is published; an admin can
  *close* it (the role becomes `CLOSED`: the public metadata, registration and start endpoints answer HTTP 410 for new candidates, the
  URL is no longer returned by the API) and *reopen* it (the same link works again). Closing never touches candidates already sitting
  or any stored registration, attempt or result. Closed roles stay in the Shared Links list with a Reopen button.

## Rollout (existing database)

```bash
cd backend
python migrate_recruitment_workflow.py            # backup -> preflight -> migrate -> verify
# then restart the API (a startup warning is logged if the schema is not migrated)
```

* SQLite: verified copy (`PRAGMA integrity_check` + row counts) in `backend/backups/`, one atomic `BEGIN EXCLUSIVE` transaction
  with `PRAGMA foreign_keys=OFF` set outside it. Pre-existing foreign-key violations in unrelated tables are reported and
  left untouched (the migration refuses to add *new* ones and aborts on any in the candidate-related tables).
* MySQL: `mysqldump` via a `0600` `--defaults-extra-file`, trailer check, isolated restore into
  `prepwin_backup_verify_<ts>` compared with snapshot coordinates, then guarded idempotent DDL. Functional unique index on
  MySQL ≥ 8.0.13, STORED generated column fallback otherwise (MariaDB uses the fallback). MySQL DDL is not transactional.
  **The MySQL path was verified with fakes and SQL compilation only — run it against a staging copy first.**
* Preflight conflicts (normalized duplicate or blank candidate emails) write `backend/migration_conflicts.json`
  (contains PII, git/docker-ignored) and exit 1 with nothing changed. Resolve manually, then re-run.
* Re-running is a no-op. `--rollback` is blocked while cross-org email collisions, `candidate_registrations` rows or
  recruitment sessions exist.
* Fresh installs need nothing: `create_all` builds the new schema (MySQL ≥ 8.0.13 required for that path; on older MySQL
  run the migration script before first start).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ASSESSMENT_SWEEPER_ENABLED` | `true` | Background finalizer (runs in every worker; safe — claims are fenced) |
| `PREPWIN_TRUSTED_PROXIES` | private ranges | Peers whose `X-Real-IP` is trusted for per-candidate rate limits (nginx overwrites it) |
| `SANDBOX_MAX_CONCURRENCY` | `5` | Concurrent sandbox executions per process |
| `JUDGE0_API_URL` | public Judge0 CE | Code sandbox endpoint (the platform's runner is Judge0, not Piston) |
| `GEMINI_API_KEY` | — | Required for blueprint generation and interview scoring |

Rate limits (per process, per client IP): registration 5/min, start 30/min, public metadata 60/min, run-code 5/min per session.
Put an nginx `limit_req` zone in front for a hard global cap.

## Operations

* **Outage handling:** a platform admin records a corroborated incident
  (`POST /api/admin/recruitment/incidents` with `outage_start_utc`, `outage_resolved_utc`, `telemetry_complete`).
  Record it **before** restarting the API: unreconciled incidents are reconciled first on startup, and sessions already swept
  to `ABANDONED`/`TIMED_OUT` are never rewritten. Heartbeat ≥ `outage_start − 60s` → `INFRASTRUCTURE_FAILURE`;
  `[outage_start − 90s, outage_start − 60s)` or incomplete telemetry → `MANUAL_REVIEW_REQUIRED`; older → `ABANDONED`/`TIMED_OUT`.
* **Retakes:** only Org Admins can authorize one, only for `INFRASTRUCTURE_FAILURE` / reviewed `MANUAL_REVIEW_REQUIRED`;
  a justification is mandatory and recorded in `activity_logs`. Candidate-side interruptions never qualify.
* **Pending evaluations:** a sandbox or Gemini outage leaves a section `EVALUATION_PENDING` (answers kept, no score); the
  dossier offers *Retry evaluation*.
* **Unstarted registration reset:** candidates who lost their registration token cannot recover it by email; an admin uses
  *Reset registration* in the dossier.

## Engineering decisions that differ from, or refine, the plan

* The code runner in this repository is Judge0 CE (`services/piston_service.py`), so the "Piston" threat-model items are
  enforced as: only test **inputs** enter the sandbox, one test at a time, and they travel as stdin (expected outputs and hidden
  tests never leave the backend), 64 KB code/stdin caps, concurrency cap, result classification, and outage →
  `EVALUATION_PENDING`. (The earlier in-sandbox function-call wrapper and its runner template were removed: recruitment problems now
  run through the shared stdin engine so both languages the Student Platform supports work.)
  Network-egress / read-only-rootfs isolation is a property of the Judge0 deployment and is not verifiable from this repo.
* Submitting a section starts the next section's clock in the same transaction (no intermediate "unlocked" state the sweeper
  would have to cover); `start-coding` / `start-interview` are idempotent sequencing checks. (The Student Platform keeps its
  explicit unlock then start step; time spent between the two counts against the 60-minute overall deadline.)
* **Amendments to the original plan** (requested later): the AI interview is the Student Platform's voice interview instead of
  text-first; coding sections are scored with the student logic (hidden tests only, pooled) instead of 50/50 per problem including
  public cases; the interview score is the evaluator's overall score instead of the mean of per-question scores; the overall formula
  is unchanged (equal weight) and is now also the student formula.
* The sweeper waits for `overall_deadline_at + 10s` so the 10-second arrival window is honoured.
* A section whose deadline passes without a submission is closed from its autosaved draft (`PUT …/draft`).
* Recruitment sessions are hidden from, and unreachable through, the legacy student/invitation endpoints.

## Hardening notes (proctoring, code execution, scoring precision, voice interview)

* **Proctoring endpoints.** `POST /api/proctor/analyze-frame` requires a sitting credential: a student / candidate-portal JWT
  (`Authorization`), an unexpired student invitation (`X-Invitation-Token`), or - for shared-link candidates - the session
  capability of a sitting still in progress (`X-Session-Id` + `X-Session-Token`; verified read-only, no lease, no student
  account). Frames are rate limited per principal (`PROCTOR_FRAMES_PER_MINUTE`, default 40), one frame per principal in flight,
  inference concurrency is bounded (`PROCTOR_MAX_CONCURRENT`, default 4), failed credential attempts are throttled per address, the
  body is size-capped before it is parsed, images are strictly validated (type, size, decoded dimensions) and no error carries
  file names, paths or exception text. `GET /api/proctor/status` stays public (the device check needs it before an attempt exists)
  but returns only `{"status": "ready" | "error"}`; account holders get the diagnostic detail.
* **Code execution (Judge0).** `services/piston_service.py` classifies compile errors, runtime errors, timeouts and sandbox
  failures separately; a sandbox failure is never a score. A request is retried once only when nothing can have been submitted
  (connection refused, 429 with a short `Retry-After`, 502/503/504); a read timeout is never resubmitted. Asynchronous submissions
  (`JUDGE0_WAIT=false`, or an instance that returns only a token) are polled within `JUDGE0_POLL_TIMEOUT_SECONDS` (default 25).
  A circuit breaker (6 consecutive infrastructure failures, 10 s) stops retry storms; `JUDGE0_AUTH_TOKEN` is sent as
  `X-Auth-Token` for a self-hosted instance. There is deliberately no local-execution fallback.
* **Scoring precision.** Evaluators return full-precision section percentages; the overall is the equal-weight mean of those,
  rounded once to two decimals. Section percentages are *presented* with two decimals (`assessment_policy.display_pct`).
  Historical (`legacy_weighted_25_40_35`) results are untouched.
* **Voice interview.** `@vapi-ai/web` 3.x (Daily client 0.93). Each session owns at most one ephemeral Vapi assistant (its id is
  kept server-side inside the interview round's private JSON, no schema change); a replaced assistant and the final one are deleted
  (best effort) when the interview closes. Assistants of abandoned or timed-out sittings are not deleted yet. The browser
  stops and detaches every call on submit / unmount, ignores events from replaced instances, shows a readable error (never an
  object - that white-screens the page), offers Retry or the written alternative, and never reports an interview as completed when
  the submission did not reach the server. `@vapi-ai/web` 3.x declares Node >= 22.14 for tooling; the frontend Docker builder uses
  Node 20 (a warning, not a failure, unless `engine-strict` is set): move the builder image to Node 22 when convenient.
* **Browser tests.** `e2e/` (see its README) drives real Chrome through both workflows; `E2E_LIVE_VAPI_CALL=1` adds a live call.

## Sample data, test isolation and cleaning up job roles

* **Production initialization creates no job roles.** Startup only provisions the primary organization and the platform administrator
  and relinks orphaned records. The only code that constructs a job role is an administrator-triggered request handler
  (`routers/job_assessments.py`, `routers/resume.py`, `routers/roleready.py`); `tests/test_production_initialization.py` enforces this
  and also fails if a seed script, a startup insert or a container entrypoint that runs tests or seeds is ever added.
* **Where "Lead Architect" and similar drafts came from.** Not from the application: they were written by the automated tests. Legacy
  tests create roles through the API and never clean up, and they ran against the configured database. Their fixture user ids (301, 302,
  401, 402) can collide with real accounts (here: the real platform administrator is user 301), which routes the rows into that user's
  organization.
* **The tests can no longer do that.** `tests/conftest.py` runs the suite on a throw-away SQLite file unless `DATABASE_URL` is set to a
  database other than the configured one, or `PREPWIN_TESTS_USE_CONFIGURED_DB=1` is set deliberately (`tests/db_guard.py`; the pytest
  header prints the database in use).
* **Existing residue is never deleted automatically.** `python audit_job_roles.py` is a read-only report: it classifies every role as
  PROTECTED (published/closed, has a blueprint, or is referenced by registrations, sessions, invitations, batches ...), LIKELY_TEST_FIXTURE
  (an unprotected draft with a test signature) or LEGITIMATE_DRAFT (kept), and lists possible duplicates for a human decision.
  `--review-ids file` writes the fixture ids; remove any you want to keep. `--delete-ids file --backup-dir DIR` is a dry run;
  adding `--apply` deletes after a verified backup (SQLite online backup + integrity check; other engines need `--backup-confirmed`), exports
  the rows to JSON, re-checks every id, runs in one transaction and verifies that protected roles and every dependent row are unchanged.
  One refused id aborts the whole run. Roll back by restoring the backup file.
