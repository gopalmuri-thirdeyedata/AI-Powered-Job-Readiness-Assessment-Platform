# HiringAI Student Career & Placement Platform — Implementation Master Plan

## 1. Executive Summary & Vision
HiringAI is expanding from a premier AI-powered enterprise recruitment platform into an end-to-end **AI-Powered Student Career & Placement Platform**, while rigorously preserving all existing recruiter, candidate, and multi-tenant capabilities.

The core product loop for every student is:
```
ASSESS → IDENTIFY SKILL GAPS → RECOMMEND → PRACTICE → REASSESS → IMPROVE → PLACEMENT READY
```
The platform continuously and objectively answers the fundamental question for every student:
**"What should this student do next to become more placement-ready?"**

---

## 2. Repository Audit & Current Architecture Findings

### 2.1 Backend Architecture
- **Framework**: FastAPI with asynchronous endpoints and Pydantic validation.
- **ORM & Database**: SQLAlchemy ORM with MySQL 8 (`hiringai` database). Connection pooling configured in `backend/database.py`.
- **Authentication & RBAC**:
  - Recruiter / College Admins: Clerk session tokens validated against `User` and `OrganizationMember` models. Roles: `PLATFORM_ADMIN`, `ORGANIZATION_ADMIN`, `HR`.
  - Candidates: JWT tokens scoped to assessment sessions via `backend/utils.py`.
  - Students: Secure JWT tokens with role `STUDENT`, scoped to user ID and tenant organization ID.
- **AI Integrations**: `backend/services/ai_generator.py` providing unified Gemini and Groq AI abstractions with structured JSON parsing and graceful fallback logic.
- **Skill Suggestions**: `backend/services/skill_suggestion.py` providing role-based skill taxonomy, deduplication, and extraction.
- **Code Execution**: Judge0 / Piston integration in `backend/services/code_runner.py` with multi-language execution and hidden test evaluation.
- **Interviews**: Vapi AI voice interview pipeline (`backend/services/vapi_service.py` and `backend/services/interview_evaluation.py`) — **frozen for recruiter assessment safety**.
- **Student Phase 1 (Completed & Verified)**:
  - Models: `StudentProfile` and `StudentResume` in `backend/models.py`.
  - Schemas: `backend/schemas.py`.
  - Services: `backend/services/student_resume_analyzer.py` (9-dimension zero-hallucination analysis) and `backend/services/readiness_service.py` (indicative Placement Readiness Indicator).
  - Routers: `backend/routers/student.py` implementing server-controlled organization resolution (pre-invite and slug-based code verification).

### 2.2 Frontend Architecture
- **Framework**: React 18 with Vite and Tailwind CSS.
- **Routing**: `react-router-dom` v6 in `frontend/src/App.jsx`.
- **Client Services**: Axios-based API client wrappers (`frontend/src/services/studentApi.js`, `frontend/src/api.js`).
- **Student Layout**: `frontend/src/layouts/StudentLayout.jsx` with secure role guard and responsive sidebar navigation.
- **Student Pages**: `StudentDashboard.jsx`, `StudentProfile.jsx`, `StudentResumeUpload.jsx`, `StudentLogin.jsx`.
- **Existing Recruiter & Candidate Pages**: Completely intact and passing all regression suites.

---

## 3. Existing Capabilities to Reuse
1. **Resume Screening & Skill Suggestion**: Reuse `skill_suggestion.py` and resume parsing utilities for skill gap extraction and student project analysis.
2. **Coding Execution Engine**: Reuse `backend/services/code_runner.py` for student topic-wise DSA practice without mutating recruiter assessment logs.
3. **Aptitude Evaluation**: Reuse question generation and scoring logic from recruiter aptitude services for topic-wise practice.
4. **AI Generation Abstraction**: Reuse `AIGenerator` in `backend/services/ai_generator.py` for Roadmap creation, Career Copilot, Mock Interview questions, and Project Reviews.
5. **Multi-Tenant Scoping**: Reuse `OrganizationMember` and tenant dependency injection (`get_current_org_user`, `get_current_student`).

---

## 4. Phase-by-Phase Roadmap

### Phase 1: Student Foundation & Security Review (COMPLETED & VERIFIED)
- **Status**: VERIFIED (14/14 security tests passing, full regression suite passing).
- **Deliverables**: Models, Schemas, 9-dimension Resume Analyzer, Readiness Service, Server-Controlled Org Provisioning, Student Dashboard UI.

### Phase 2: Student Career Profile & Skill Intelligence
- **Objective**: Benchmark student capabilities against target roles and companies, identifying required vs. preferred skill gaps.
- **Deliverables**:
  - Backend: Skill gap analysis service (`backend/services/skill_gap_service.py`) comparing resume skills with role benchmarks.
  - Endpoints: `GET /api/student/skill-gap`, `POST /api/student/skill-gap/analyze`, `GET /api/student/target-roles`.
  - Frontend: `SkillGapAnalysis.jsx` interactive visualizer showing matched, missing required, and missing preferred skills.
  - Tests: Test skill normalization, role benchmarks, and deterministic fallbacks.

### Phase 3: Personalized Roadmap & Daily Preparation Plan
- **Objective**: Translate skill gaps into an actionable weekly and daily preparation roadmap.
- **Deliverables**:
  - Database: `student_roadmaps` and `student_daily_tasks` tables.
  - Backend: Roadmap generator service (`backend/services/roadmap_service.py`).
  - Endpoints: `GET /api/student/roadmap`, `POST /api/student/roadmap/generate`, `PATCH /api/student/daily-tasks/{task_id}`.
  - Frontend: `StudentRoadmap.jsx` with weekly timeline, daily task checklists, and progress tracker.
  - Tests: Test roadmap generation, status updates, and idempotent task recalculation.

### Phase 4: DSA, Aptitude & Topic-Wise Practice
- **Objective**: Structured, non-evaluative practice environment for DSA and aptitude questions.
- **Deliverables**:
  - Database: `student_practice_questions` and `student_practice_attempts`.
  - Backend: Practice service (`backend/services/practice_service.py`) routing code to Judge0/Piston while keeping hidden test cases strictly private.
  - Endpoints: `GET /api/student/practice/topics`, `GET /api/student/practice/questions`, `POST /api/student/practice/submit`.
  - Frontend: `StudentPractice.jsx` with code editor, language selector, test runner, and MCQ practice interface.
  - Tests: Verify server-side evaluation, test isolation, and student practice metrics.

### Phase 5: AI Mock Interview & Communication Improvement
- **Objective**: Realistic technical and behavioral mock interview preparation without modifying frozen recruiter files.
- **Deliverables**:
  - Database: `student_mock_interviews` and `student_mock_interview_turns`.
  - Backend: Isolated student interview service (`backend/services/student_interview_service.py`) using text/audio dialogue with role-tailored questions.
  - Endpoints: `POST /api/student/mock-interview/start`, `POST /api/student/mock-interview/{id}/answer`, `POST /api/student/mock-interview/{id}/complete`.
  - Frontend: `StudentMockInterview.jsx` with question-by-question dialogue, response feedback, STAR structure tips, and scoring.
  - Safeguard: Zero edits to frozen `backend/routers/interview.py`, `vapi_service.py`, or `interview_evaluation.py`.

### Phase 6: Resume Improvement & Project Analyzer
- **Objective**: Deep-dive feedback on resume bullet points, formatting, and technical project architecture.
- **Deliverables**:
  - Database: `student_projects` table.
  - Backend: Project analyzer service (`backend/services/project_analyzer_service.py`) generating architectural critiques and likely interview questions.
  - Endpoints: `GET /api/student/projects`, `POST /api/student/projects`, `POST /api/student/projects/{id}/analyze`.
  - Frontend: `StudentProjects.jsx` and version-comparison modal in `StudentResumeUpload.jsx`.

### Phase 7: Placement Simulation & Readiness Scoring
- **Objective**: Full end-to-end placement drive simulation (Aptitude -> Coding -> Technical -> HR) and multi-factor readiness scoring.
- **Deliverables**:
  - Database: `placement_simulations` and `placement_simulation_rounds`.
  - Backend: Simulation orchestrator service (`backend/services/simulation_service.py`) and updated multi-factor scoring in `readiness_service.py`.
  - Endpoints: `POST /api/student/simulation/start`, `POST /api/student/simulation/{id}/submit-round`, `GET /api/student/simulation/{id}/report`.
  - Frontend: `PlacementSimulation.jsx` multi-step simulation wizard and comprehensive readiness report.

### Phase 8: Student Career Dashboard & Career Copilot
- **Objective**: Centralized student cockpit with an embedded, context-aware AI career counselor.
- **Deliverables**:
  - Database: `student_copilot_messages` table.
  - Backend: Copilot service (`backend/services/copilot_service.py`) answering student questions strictly grounded in their verified profile and readiness gaps.
  - Endpoints: `GET /api/student/copilot/history`, `POST /api/student/copilot/chat`.
  - Frontend: Integrated chat drawer and unified overview on `StudentDashboard.jsx`.

### Phase 9: College Placement Officer Dashboard & Drives
- **Objective**: Enable college administrators to monitor cohort readiness, identify at-risk students, and manage placement drives.
- **Deliverables**:
  - Database: `placement_drives` and `placement_drive_applications`.
  - Backend: College analytics & drive router (`backend/routers/college.py`) with strict organization scoping.
  - Endpoints: `GET /api/college/overview`, `GET /api/college/students`, `GET /api/college/drives`, `POST /api/college/drives`.
  - Frontend: `CollegeDashboard.jsx`, `CollegeStudents.jsx`, `CollegeDrives.jsx`.

### Phase 10: Student Enrollment, Onboarding & Role-Based UX
- **Objective**: Smooth, secure college-onboarding flow with guided steps.
- **Deliverables**:
  - Frontend: Guided onboarding modal / wizard on first student login (`StudentOnboardingWizard.jsx`).
  - Validation: Automatic transition from onboarding to dashboard upon profile completion.

### Phase 11: Security Hardening, Performance & Integration
- **Objective**: Validate tenant isolation across all endpoints, prevent prompt injection, sanitize file uploads, and optimize query latency.
- **Deliverables**:
  - Security audit of all student and college endpoints.
  - Input validation, rate limiting considerations, and safe error masking.

### Phase 12: Complete Regression Testing & Documentation
- **Objective**: Full automated regression testing across recruiter, candidate, student, and college portals.
- **Deliverables**:
  - Backend test suite run with zero failures.
  - Frontend test suite run with zero failures.
  - Frontend production build check (`npm run build`).
  - Final implementation report.

---

## 5. Security & Multi-Tenant Isolation Strategy
1. **Server-Controlled Organization Scoping**: Students cannot select an arbitrary `organization_id`. Organizations are validated through pre-invitations or valid college invite codes/slugs.
2. **Object-Level Access Controls (IDOR Prevention)**: Every query checks `student_id == current_student.id` and verifies matching `organization_id`.
3. **Information Disclosure Prevention**: Practice question evaluation and interview scoring keep answer keys, system prompts, and test cases exclusively server-side.
4. **Recruiter Platform Integrity**: All recruiter assessment tables, candidate tokens, and Clerk RBAC dependencies remain completely independent of student practice workflows.
