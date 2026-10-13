# PrepWin — Implementation Master Plan

## 1. Overview & Strategy
This master plan governs the sequential transformation of the existing codebase into **PrepWin — AI-Powered Job Readiness & Assessment Platform**. Every phase delivers verifiable, production-ready code with corresponding automated test suites.

---

## 2. Phase Breakdown & Execution Sequence

| Phase | Title | Focus & Core Deliverables | Dependencies |
|---|---|---|---|
| **Phase 0** | Repo Audit & Specs | Specification suite in `docs/roleready/`, technology audit, baseline verification. | None |
| **Phase 1** | Data Model & State Machine | Unified `RoleReadyAssessmentSession`, `JobDescriptionVersion`, sequential state machine (`NOT_STARTED` → `APTITUDE_...` → `CODING_...` → `INTERVIEW_...` → `COMPLETED`). | Phase 0 |
| **Phase 2** | Student Resume & JD Processing | Resume & JD upload endpoints, AI structured extraction, context synthesis, tailored assessment generator service. | Phase 1 |
| **Phase 3** | Sequential Aptitude Engine | Timed aptitude testing, server-side scoring, aptitude scorecard, backend gate unlocking Coding round. | Phase 1, 2 |
| **Phase 4** | Coding Assessment & Proctoring | 1–3 configurable coding challenges, sandboxed execution (Piston), hidden test evaluations, proctoring & fullscreen controls, coding scorecard. | Phase 3 |
| **Phase 5** | Conversational AI Interview | JD & resume-grounded questions, Vapi integration preservation, transcript & answer evaluation, interview scorecard. | Phase 4 |
| **Phase 6** | Consolidated Student Report | End-to-end self-assessment pipeline, multi-dimension job readiness index, gap analysis, practice recommendations. | Phase 3, 4, 5 |
| **Phase 7** | Admin Bulk Upload & JD Campaign | Multi-resume batch ingestion, parsing pipeline, recruitment batch/campaign model, organization isolation. | Phase 1, 2 |
| **Phase 8** | Secure Invitation System | Cryptographic invitation tokens, email dispatch, candidate onboarding & assessment launch portal. | Phase 7, 1 |
| **Phase 9** | Recruiter Reporting & Analytics | Consolidated recruitment dashboard, candidate leaderboards, multi-round comparative analytics, exportable reports. | Phase 8, 6 |
| **Phase 10** | UI Overhaul & Rebranding | Full RoleReady rebranding, modern landing page explaining Workflows A & B, upgraded student & recruiter dashboards, polished coding environment. | All previous phases |
| **Phase 11** | Security Hardening & Regression Tests | Cross-tenant security tests, anti-tampering verification, end-to-end regression validation. | Phase 1–10 |
| **Phase 12** | Final Verification & Delivery | Production build validation, Docker container readiness check, final sign-off documentation. | Phase 11 |

---

## 3. Strict Implementation Guidelines
1. **Never Bypass Backend Validation:** Round progression must be verified and enforced strictly on the server. Frontend status flags are purely visual indicators.
2. **Preserve Protected Services:** Do not modify `backend/routers/interview.py`, `backend/services/vapi_service.py`, `backend/services/interview_evaluation.py`, or `frontend/src/hooks/useFullscreen.js`.
3. **Preserve Historical Data:** All database migrations must be additive and non-destructive.
4. **Autonomous Execution:** Proceed directly through phases, validating each step with automated test execution.
