# RoleReady — API Specification & Endpoint Design

## 1. Authentication & Security Headers
All endpoints require either:
- **Student Bearer Token:** `Authorization: Bearer <jwt_token>` (extracted from `studentApi`)
- **Admin/Recruiter Clerk Token:** `Authorization: Bearer <clerk_session_token>`
- **Candidate Invitation Header:** `X-Invitation-Token: <token>` or URL token parameter for portal start.

---

## 2. API Endpoints Catalog

### 2.1 Workflow A: Student Assessment Endpoints (`/api/roleready/student/...`)
- `POST /api/roleready/student/initialize`
  - Upload/select resume + provide JD (text or document).
  - Triggers AI parsing and creates a new `RoleReadyAssessmentSession`.
  - Returns: `{ session_id, session_uuid, current_state: 'NOT_STARTED', jd_summary, candidate_summary }`
- `GET /api/roleready/student/session/{session_uuid}`
  - Fetches current session status, unlocked rounds, and current progress.
- `POST /api/roleready/student/session/{session_uuid}/start-aptitude`
  - Starts Round 1. Transitions state to `APTITUDE_IN_PROGRESS`.
  - Returns: Client-safe question list (MCQs, options, time limit) without correct answers.
- `POST /api/roleready/student/session/{session_uuid}/submit-aptitude`
  - Submits aptitude answers + proctoring telemetry.
  - Server evaluates answers against secure answer keys.
  - Transitions state to `APTITUDE_EVALUATED` and immediately unlocks Coding round (`CODING_UNLOCKED`).
  - Returns: Aptitude scorecard, score %, breakdown.
- `POST /api/roleready/student/session/{session_uuid}/start-coding`
  - Requires state `CODING_UNLOCKED`. Transitions to `CODING_IN_PROGRESS`.
  - Returns: 1 to 3 coding problems (statements, constraints, starter codes, visible public test cases).
- `POST /api/roleready/student/session/{session_uuid}/run-code`
  - Sandboxed execution against public test cases via Piston.
  - Returns: stdout, stderr, execution time, pass/fail status.
- `POST /api/roleready/student/session/{session_uuid}/submit-coding`
  - Submits code solutions for all problems.
  - Server executes full hidden test suites. Computes correctness and code quality metrics.
  - Transitions to `CODING_EVALUATED` and immediately unlocks Interview round (`INTERVIEW_UNLOCKED`).
  - Returns: Coding scorecard, test summary.
- `POST /api/roleready/student/session/{session_uuid}/start-interview`
  - Requires state `INTERVIEW_UNLOCKED`. Transitions to `INTERVIEW_IN_PROGRESS`.
  - Generates role-specific questions and returns Vapi session credentials / fallback question battery.
- `POST /api/roleready/student/session/{session_uuid}/submit-interview`
  - Submits interview responses or triggers webhook evaluation.
  - Transitions to `INTERVIEW_EVALUATED` and synthesizes `COMPLETED`.
  - Computes final Job Readiness score and report.
- `GET /api/roleready/student/session/{session_uuid}/report`
  - Fetches consolidated Job Readiness report for the authenticated student.

---

### 2.2 Workflow B: Administrator Recruitment Endpoints (`/api/roleready/admin/...`)
- `POST /api/roleready/admin/batches`
  - Create recruitment batch bound to a Job Description.
- `POST /api/roleready/admin/resumes/bulk-upload`
  - Multipart bulk upload of candidate resumes into a recruitment batch.
  - Asynchronously parses and creates candidate records with preliminary match ratings.
- `GET /api/roleready/admin/batches/{batch_id}/candidates`
  - List candidates in batch with screening status and score indicators.
- `POST /api/roleready/admin/invitations/send`
  - Triggers secure email invitations with cryptographic single-use launch tokens.
- `GET /api/roleready/admin/batches/{batch_id}/dashboard`
  - Full funnel analytics: Ingested, Invited, Aptitude Passed, Coding Passed, Interview Passed, Completed.
- `GET /api/roleready/admin/batches/{batch_id}/report`
  - Consolidated recruitment report, candidate comparison matrix, exportable rankings.

---

### 2.3 Candidate Invitation Portal (`/api/roleready/portal/...`)
- `GET /api/roleready/portal/verify-invitation?token={token}`
  - Validates token, returns company name, role title, and assessment duration.
- `POST /api/roleready/portal/start?token={token}`
  - Initializes candidate session bound to invitation and returns initial round status.
