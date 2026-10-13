# Voice-First Vapi Interview (Resume + JD Grounded) & Candidate Assessment Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Round 3 of RoleReady assessment from a legacy text-input textarea into a real-time, voice-first Vapi AI Technical Interview grounded in both the candidate's Resume and Job Description (JD), and build a Candidate Assessment Progress Dashboard linked in the navbar displaying the candidate's historical results, round scores, competencies, and remediation areas.

**Architecture:** 
1. Backend: Add `/api/roleready/session/{session_uuid}/vapi-init` in `backend/routers/roleready.py` to synthesize 5 tailored interview questions combining the session's parsed resume and target JD, and provision an ephemeral Vapi assistant via `vapi_service`.
2. Assessment Frontend: In `frontend/src/pages/roleready/RoleReadyAssessment.jsx`, replace the static text textarea in Round 3 with a live WebRTC voice-first Vapi interface (AI interviewer voice wave, candidate camera feed, audio visualizer, live transcript, proctoring). On completion, submit transcript to `submitInterview`, score with Gemini, and auto-redirect to the Dashboard.
3. Candidate Dashboard: Create `frontend/src/pages/roleready/StudentAssessmentDashboard.jsx` at `/student/dashboard`, display the latest readiness score, round-by-round breakdown (Aptitude, Coding, Interview), verified competencies, remediation areas, and previous assessment history with report links.
4. Navigation: Add "Dashboard" button to `RoleReadyNavbar` and `RoleReadyReport`.

**Tech Stack:** FastAPI, SQLAlchemy, Vapi WebRTC SDK (`@vapi-ai/web`), React 18, TailwindCSS, Framer Motion, Lucide Icons, Vite.

**Spec:** User requirements from session prompts and visual references in attached screenshots.

## Global Constraints
- Proctoring integrity, bounding box visualizer, and fullscreen guards (`useAssessmentFullscreen`) must be preserved in all rounds.
- Interview questions must be dynamically grounded in BOTH candidate resume content and target job description.
- Submissions must never use blocking JavaScript `alert()` dialogs.
- Clean empty states must be provided when no previous candidate data exists.
- `npm run build` must succeed with exit code 0.

## Review Focus
1. Unauthenticated or expired session UUID requesting Vapi assistant: must return 401/403.
2. Missing resume or JD text: must fall back gracefully to structured role-based questions without crashing.
3. Candidate without previous assessment history accessing Dashboard: must render clean empty state with "+ Start Assessment" button.
4. WebRTC microphone permission denial during Round 3: must show actionable in-app recovery banner.
5. Interview completion transition: must finalize transcript, evaluate scores, and redirect smoothly to `/student/dashboard`.

---

### Task 1: Backend Endpoint to Initialize Vapi Interview Grounded in Resume & JD

**Files:**
- Modify: `backend/routers/roleready.py`
- Modify: `backend/services/roleready_service.py`
- Test: `backend/test_roleready_vapi.py`

**Interfaces:**
- Produces: `POST /api/roleready/session/{session_uuid}/vapi-init` returning `{ "assistantId": str, "questions": List[Dict], "role": str, "candidateName": str, "duration": int }`
- Consumes: `roleready_service.get_session_by_uuid`, `vapi_service.create_interview_assistant`, `session.extracted_jd_data`, `session.resume_snapshot`, `session.resume_raw_text`

- [ ] **Step 1: Write backend test for Vapi initialization endpoint**
Create `backend/test_roleready_vapi.py` testing that `/api/roleready/session/{session_uuid}/vapi-init` returns 401/404 for invalid credentials/sessions and returns assistant ID and 5 resume+JD questions for a valid session.

- [ ] **Step 2: Run test to verify it fails**
Run: `python -m pytest backend/test_roleready_vapi.py`
Expected: FAIL (endpoint does not exist)

- [ ] **Step 3: Implement Vapi assistant synthesis in `backend/services/roleready_service.py` and `backend/routers/roleready.py`**
Extract resume projects, skills, and JD requirements from the session, formulate custom interview questions targeting the intersection of candidate background and target JD, and invoke `vapi_service.create_interview_assistant` to get the dynamic assistant ID.

- [ ] **Step 4: Run test to verify it passes**
Run: `python -m pytest backend/test_roleready_vapi.py`
Expected: PASS

---

### Task 2: Replace Round 3 in RoleReadyAssessment with Voice-First Vapi Interview

**Files:**
- Modify: `frontend/src/services/rolereadyApi.js`
- Modify: `frontend/src/pages/roleready/RoleReadyAssessment.jsx`

**Interfaces:**
- Consumes: `rolereadyApi.initVapiSession(sessionUuid)`, Vapi WebRTC SDK (`@vapi-ai/web`), `rolereadyApi.submitInterview`
- Produces: Voice-first conversational Round 3 in `RoleReadyAssessment.jsx` with automatic redirect to `/student/dashboard` upon completion.

- [ ] **Step 1: Add `initVapiSession` helper in `frontend/src/services/rolereadyApi.js`**
Add `async initVapiSession(sessionUuid)` calling `POST ${API_URL}/api/roleready/session/${sessionUuid}/vapi-init`.

- [ ] **Step 2: Implement Vapi voice-first interviewer in `RoleReadyAssessment.jsx`**
Replace the static `<textarea>` text-input box in Stage 4 with the live voice-first Vapi interface:
- AI interviewer soundwave animation & speaking state
- Mirrored candidate camera feed with YOLO proctoring overlay
- Real-time audio volume visualizer
- Dynamic 5-question sequential display
- Live transcript bubbles
- Non-blocking confirmation modal
- On call completion: auto-submits transcript to `rolereadyApi.submitInterview` and navigates to `/student/dashboard`

- [ ] **Step 3: Verify build**
Run: `npm run build` in `frontend`
Expected: Success with code 0

---

### Task 3: Build Candidate Assessment Progress Dashboard

**Files:**
- Create: `frontend/src/pages/roleready/StudentAssessmentDashboard.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `rolereadyApi.getStudentAssessments()`
- Produces: Page at `/student/dashboard` rendering candidate readiness score, round breakdown, competencies, remediation areas, and historical session cards.

- [ ] **Step 1: Create `StudentAssessmentDashboard.jsx`**
Build a modern, role-ready candidate dashboard matching the visual identity of the assessment platform:
- Welcome banner with candidate name and target role
- Overall Job Readiness Gauge (0-100) with Readiness Tier
- Round 1 (Aptitude & Reasoning %), Round 2 (Practical Coding %), Round 3 (AI Technical Interview %) cards
- Competencies Met & Verified list
- Targeted Remediation Areas list
- Assessment History table/cards with date, scores, and "View Full Report" link (`/assessment/:sessionUuid/report`)
- "+ Start New Assessment" button (`/assessment/setup`)
- Clean empty state when no assessments exist yet

- [ ] **Step 2: Register routes in `frontend/src/App.jsx`**
Point `/student/dashboard`, `/student`, and `/dashboard` to `<RoleReadyAuthGuard><StudentAssessmentDashboard /></RoleReadyAuthGuard>`.

- [ ] **Step 3: Verify build**
Run: `npm run build` in `frontend`
Expected: Success with code 0

---

### Task 4: Add Dashboard Button in Navigation and Report Header

**Files:**
- Modify: `frontend/src/components/RoleReadyNavbar.jsx`
- Modify: `frontend/src/pages/roleready/RoleReadyReport.jsx`

- [ ] **Step 1: Add "Dashboard" button to `RoleReadyNavbar.jsx`**
Add a clean button with `LayoutDashboard` icon and "Dashboard" label linking to `/student/dashboard` in both desktop header and mobile menu.

- [ ] **Step 2: Add "Candidate Dashboard" button to `RoleReadyReport.jsx`**
In the report action bar alongside "Export PDF" and "New Assessment", add a prominent "Dashboard" button.

- [ ] **Step 3: Verify build and test suite**
Run: `npm run build` in `frontend`
Expected: Success with code 0

---

### Task 5: End-to-End Verification

- [ ] **Step 1: Run frontend test suites**
Run: `node test_phase6_frontend.test.mjs` and `node test_assessment_fullscreen.test.mjs`
Expected: All tests pass.

- [ ] **Step 2: Verify production build**
Run: `npm run build` in `frontend`
Expected: Exit code 0.
