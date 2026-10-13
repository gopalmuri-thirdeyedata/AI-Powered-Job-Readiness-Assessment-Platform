# RoleReady — Restore Complete Assessment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the complete, end-to-end assessment experience in RoleReady by reusing existing HiringAI assessment components, webcam integration, unified proctoring, fullscreen enforcement, sandboxed execution, and sequential round gating (`INSTRUCTIONS` -> `APTITUDE` -> `CODING` -> `INTERVIEW` -> `COMPLETED`).

**Architecture:** Integrate the Instructions & Device Readiness Check, Aptitude MCQ round, Coding Sandbox (Monaco + Piston), and Voice/Conversational Interview into `RoleReadyAssessment.jsx` while leveraging existing `useAssessmentFullscreen.js`, `FullscreenGateModal.jsx`, `piston_service.py`, and `RoleReadyReport.jsx`. Gating is strictly verified both client-side and server-side.

**Tech Stack:** React 18, TailwindCSS, Lucide React, Monaco Editor (`@monaco-editor/react`), Vapi AI Web SDK (`@vapi-ai/web`), FastAPI, SQLAlchemy, SQLite/PostgreSQL, Piston Sandbox.

---

## Global Constraints

- Do NOT create a new assessment workflow from scratch; reuse existing components.
- State progression must follow `NOT_STARTED / INSTRUCTIONS` -> `APTITUDE` -> `CODING` -> `INTERVIEW` -> `COMPLETED`.
- Strict sequential gating: Coding cannot start before Aptitude completion; Interview cannot start before Coding completion.
- Page refresh must restore the exact active session and current round.
- Fullscreen enforcement with 10s exit recovery and webcam floating PIP must be preserved during all active assessment rounds.
- Answer keys and hidden test cases must remain strictly on the backend.
- Maintain RoleReady CSS design tokens (`--rr-bg`, `--rr-card`, `--rr-text`, `--rr-border`, `--brand`, etc.).

---

## Review Focus

1. **Hardware / Camera Denial Recovery:** If camera access is denied or hardware is unavailable during system check, user receives actionable instructions and a retry button without breaking the app.
2. **Fullscreen Exit & Grace Period:** Exiting fullscreen during any active round shows `FullscreenGateModal` with 10-second countdown and logs violation upon timeout or exit.
3. **Sequential Bypass Protection:** Direct API calls to `start-coding` or `start-interview` without previous round completion are rejected with HTTP 403 Forbidden.
4. **Sandboxed Code Execution:** Running code evaluates against public test cases and renders clean output/error formatting in the sandboxed terminal.
5. **State Restoration on Refresh:** Navigating directly to `/assessment/:sessionUuid` accurately resumes the current round without resetting scores or starting over.

---

### Task 1: Enhance `RoleReadyAssessment.jsx` with Instructions & Hardware Readiness Check

**Files:**
- Modify: `frontend/src/pages/roleready/RoleReadyAssessment.jsx`
- Test: Verify instructions screen, camera permission prompt, live video preview, microphone test, agreement checkbox, and fullscreen entry.

- [ ] **Step 1: Implement Instructions & Device Check Stage in `RoleReadyAssessment.jsx`**
  - Add `isInstructionsStep` state initialized when `sessionData.current_state === 'NOT_STARTED'`.
  - Add camera request handler (`navigator.mediaDevices.getUserMedia({ video: true })`) with live `<video>` preview.
  - Add microphone test handler (`navigator.mediaDevices.getUserMedia({ audio: true })`).
  - Render 3-round breakdown: Round 1 Aptitude (15m), Round 2 Coding (30m), Round 3 Interview (15m).
  - Add agreement checkbox and "Start Assessment & Enter Fullscreen" CTA.

- [ ] **Step 2: Connect Start Assessment Action to Fullscreen & Round 1**
  - Trigger `enterFullscreen()`.
  - Call `rolereadyApi.startAptitude(sessionUuid)`.
  - Start 15-minute countdown timer.
  - Transition UI to Aptitude round.

---

### Task 2: Integrate Fullscreen Gate & Floating Camera PIP Proctoring

**Files:**
- Modify: `frontend/src/pages/roleready/RoleReadyAssessment.jsx`
- Reuse: `frontend/src/hooks/useAssessmentFullscreen.js`, `frontend/src/components/FullscreenGateModal.jsx`

- [ ] **Step 1: Wire `useAssessmentFullscreen` & `FullscreenGateModal`**
  - Attach hook with `enabled = activeRound !== 'instructions' && !sessionData?.is_completed`.
  - Render `FullscreenGateModal` for both entry and 10s recovery window.

- [ ] **Step 2: Add Floating Webcam PIP Thumbnail**
  - Render a floating `<video>` thumbnail in the corner with status badge (`Live Feed • AI Proctor Active`).
  - Attach visibility change and tab-switch telemetry listeners that log violations to backend submissions.

---

### Task 3: Enhance Round 1 (Aptitude) & Round 2 (Coding) Experiences

**Files:**
- Modify: `frontend/src/pages/roleready/RoleReadyAssessment.jsx`
- Reuse: Monaco Editor (`@monaco-editor/react`), Piston sandbox execution

- [ ] **Step 1: Polish Round 1 (Aptitude)**
  - Add question navigation palette (answered vs unanswered indicators).
  - Add countdown timer with warning colors.
  - Implement answer submission and auto-transition to Coding round.

- [ ] **Step 2: Polish Round 2 (Coding)**
  - Integrate Monaco Editor with language switching (Python / JavaScript).
  - Support "Run Public Tests" calling `/api/roleready/session/{sessionUuid}/run-code`.
  - Render interactive execution terminal showing test inputs, expected vs actual outputs.
  - Implement solution submission and auto-transition to Interview round.

---

### Task 4: Integrate Conversational Voice & Defense for Round 3 (Interview)

**Files:**
- Modify: `frontend/src/pages/roleready/RoleReadyAssessment.jsx`
- Reuse: `@vapi-ai/web`, Audio visualizer, Structured defense editor

- [ ] **Step 1: Implement Conversational Interview UI**
  - Display role-tailored interview questions generated from JD & Resume.
  - Add voice interaction support with animated audio visualizer waves.
  - Provide structured technical defense response editor for STAR/trade-off articulation.
  - Implement submission calling `/api/roleready/session/{sessionUuid}/submit-interview` and auto-navigating to `/assessment/{sessionUuid}/report`.

---

### Task 5: Automated Testing & Verification

**Files:**
- Test: `backend/tests/test_roleready_pipeline.py`
- Test: `backend/tests/test_roleready_auth_matrix.py`
- Build: `npm run build` in `frontend/`

- [ ] **Step 1: Run Backend Test Suites**
  - Run `pytest backend/tests/test_roleready_pipeline.py -v`.
  - Run `pytest backend/tests/test_roleready_auth_matrix.py -v`.

- [ ] **Step 2: Run Frontend Build Verification**
  - Run `npm run build` in `frontend/` to confirm zero syntax or bundling errors.

- [ ] **Step 3: End-to-End Workflow Verification**
  - Test the full flow from `/assessment/setup` -> Instructions -> Aptitude -> Coding -> Interview -> Report.
