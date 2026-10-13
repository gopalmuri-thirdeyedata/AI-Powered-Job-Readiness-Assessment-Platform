# HiringAI Student Career Platform — Testing & Verification Strategy

## 1. Quality Objectives
Every phase must satisfy strict automated verification criteria before being declared complete:
1. **Zero Security Regressions**: Existing recruiter assessments, candidate tokens, Clerk authentication, and B2B provisioning must continue to pass without errors.
2. **Deterministic Multi-Tenant Verification**: Cross-student and cross-organization access attempts must be actively tested and proven to fail with HTTP 403 or 404.
3. **Confidentiality Checks**: Tests must verify that answer keys, hidden test inputs, and system prompts are never exposed in student API payloads.
4. **Full Automated Execution**: Tests must be executed using CLI tools with real output captured.

---

## 2. Test Execution Tiers

### 2.1 Backend Unit & Integration Tests (Pytest)
- **Framework**: `pytest` with `fastapi.testclient.TestClient` and SQLite/MySQL fixtures.
- **Coverage Areas**:
  - `test_student_phase1.py`: Student authentication, organization resolution, 9-dimension resume analysis, and readiness calculations.
  - `test_student_phase2.py`: Skill gap analysis, role requirements matching, required vs. preferred skill filtering.
  - `test_student_phase3.py`: Roadmap generation, daily task status transitions, idempotent task management.
  - `test_student_phase4.py`: Topic-wise practice, hidden test confidentiality, code execution parsing.
  - `test_student_phase5.py`: Student mock interview flow, STAR response feedback.
  - `test_student_phase6.py`: Project analyzer, tech stack review, interview question generation.
  - `test_student_phase7.py`: Placement simulation rounds, multi-factor readiness recomputation.
  - `test_student_phase8.py`: Career copilot context injection and chat boundaries.
  - `test_student_phase9.py`: College placement officer dashboard, student roster, and drives.
  - Existing regression test suite (`test_phase1` through `test_phase6`, `test_multitenant_isolation`, etc.).

### 2.2 Frontend Unit & Integration Tests (Node Test Runner)
- **Framework**: Node.js built-in test runner (`node --test *.test.mjs`).
- **Coverage Areas**:
  - `test_student_phase1.test.mjs`: Student navigation, dashboard cards, resume upload, profile editing, and API service integration.
  - Additional phase test suites verifying new views, modals, forms, and service wrappers.

### 2.3 Frontend Production Build Verification
- **Command**: `npm run build` in `frontend/`.
- **Criteria**: Zero syntax, JSX, or bundling errors; exit code 0.

---

## 3. Continuous Verification Checklist Per Phase
For each implementation phase:
1. Create models, schemas, services, and endpoints.
2. Implement corresponding frontend pages, components, and API service methods.
3. Run target phase unit & security tests.
4. Run full backend pytest regression suite (170+ tests).
5. Run full frontend node test suite (60+ tests).
6. Run `npm run build` to confirm bundling integrity.
7. Record exact test counts and logs in `IMPLEMENTATION_PROGRESS.md`.
