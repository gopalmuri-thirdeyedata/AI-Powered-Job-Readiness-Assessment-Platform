# 📘 Comprehensive System Architecture & Project Inventory
**Platform Names:** HiringAI / PrepWin  
**Repository:** `AI-Powered-Job-Readiness-Assessment-Platform`  
**Author / Organization:** Gopal Muri · ThirdEye Data  
**Scope:** Complete inventory of all existing backend code, frontend interfaces, database models, AI pipelines, proctoring systems, and operational deployment configurations.

---

## 1. Executive Summary & Identity

The repository contains an enterprise-grade, multi-tenant AI recruitment, student readiness, and skills evaluation platform. It merges corporate B2B applicant tracking and candidate assessment with a student career development hub and university placement cell portal.

The platform provides an end-to-end autonomous evaluation workflow:
1. **Applicant Tracking & Resume Screening (ATS):** Multi-attribute structured job description creation, real-time AI keyword extraction, and progressive streaming resume evaluations.
2. **RoleReady Multi-Stage Proctored Assessment Pipeline:** Strict sequential 3-tier testing:
   - **Tier 1:** Domain & Quantitative Aptitude (timed MCQ / short-answer).
   - **Tier 2:** Algorithmic Coding (Monaco editor + sandboxed Piston/Judge0 execution with public and hidden test cases).
   - **Tier 3:** AI Voice & Conversational Technical Interview (Vapi speech-to-speech WebRTC + Gemini STAR rubric evaluations).
3. **Computer Vision Anti-Malpractice Proctoring:** Real-time CPU-optimized YOLOv8/YOLO11 object detection (flagging mobile phones, multiple people, absence, unauthorized displays/books) coupled with fullscreen enforcement and 10-second violation recovery grace periods.
4. **Student Career Readiness Hub:** 9-dimension resume diagnostics, dynamic weekly learning roadmaps with daily task tracking, DSA & aptitude practice question banks, AI project architecture code reviews, 4-stage campus placement simulations, and an interactive AI Career Copilot drawer.
5. **College / University Placement Cell Management:** Cohort readiness tracking, department-level distribution metrics, and campus recruitment drive coordination.
6. **Platform Administration & Enterprise Multi-Tenancy:** Hardened organization boundaries (`organization_id`), Clerk identity management with role-based access control (RBAC), and global tenant provisioning.

---

## 2. Platform Portals & User Roles

The codebase defines 5 primary operational portals and user roles in [backend/models.py](file:///e:/HiringAi/backend/models.py):

| Role / Actor | Frontend Layout / Access | Primary Functions |
| :--- | :--- | :--- |
| **Platform Admin** (`PLATFORM_ADMIN`) | `DashboardLayout` (`/platform/organizations`) | Global platform governor (`gopalmuri1919@gmail.com`). Provisions organizations, assigns enterprise tenant admins, oversees cross-tenant statistics and billing status. |
| **Organization Admin** (`ORGANIZATION_ADMIN`) | `DashboardLayout` (`/admin/dashboard`, `/settings`) | Manages company recruiters, invite codes, organization settings, scoring weights, and corporate branding. |
| **HR Recruiter** (`HR` / `HR_ADMIN`) | `DashboardLayout` (`/admin/dashboard`, `/resume-screening`, `/candidates`, `/recruitment/rounds`, `/analytics`) | Creates structured JDs, uploads and screens candidate resumes in bulk, designs manual/AI assessments, schedules interviews, and inspects analytics dossiers. |
| **Candidate** (`CANDIDATE`) | `CandidateLayout` (`/portal/*`) & RoleReady Portal (`/portal/roleready/:invitationToken`) | Authenticates via single-use token or candidate login; completes proctored aptitude, coding, and voice interviews in fullscreen. |
| **Student** (`STUDENT`) | `StudentLayout` (`/student/*`) | Self-onboards; uploads resumes for 9-dimension scoring; builds target career roadmaps; practices DSA and aptitude; runs mock interviews and 4-round placement simulations; consults Career Copilot. |
| **College TPO / Placement Admin** | `CollegeLayout` (`/college/*`) | Monitors college student cohort readiness, department trends, and coordinates on-campus recruitment drives. |

---

## 3. Technology Stack & Runtime Dependencies

### 3.1 Backend
- **Framework:** FastAPI (`fastapi==0.115.0`) with ASGI servers `uvicorn` and `gunicorn`.
- **Language / Runtime:** Python 3.11.
- **Database & ORM:** MySQL 8.0, SQLAlchemy 1.4 / 2.0 with connection pooling (`pool_pre_ping=True`, `pool_recycle=3600`), and PyMySQL (`pymysql==1.1.1`).
- **Cache & Message Broker:** Redis 7 (`redis:7-alpine`).
- **Authentication:** Clerk Identity Management (`@clerk/clerk-react`, `backend/services/clerk_service.py`), Python-Jose JWT (`python-jose[cryptography]==3.3.0`), Passlib with Bcrypt (`passlib[bcrypt]==1.7.4`).
- **AI & LLM Services:** Google Gemini API (`google-generativeai>=0.8.0`, `backend/services/gemini_client.py`) utilizing `gemini-2.5-flash`, with an offline deterministic fixture engine (`gemini_mock_fixtures.py`) for keyless development.
- **Voice AI:** Vapi WebRTC conversational speech agent (`backend/services/vapi_service.py`, `backend/routers/interview.py`).
- **Code Execution:** Piston sandbox API (`backend/services/piston_service.py`) and Judge0 CE endpoints.
- **Vision Proctoring:** Ultralytics YOLOv8 / YOLO11 (`ultralytics==8.3.163`, `opencv-python-headless==4.10.0.84`, `Pillow`, `numpy`). Weights: `backend/models/yolov8n.pt` and `yolo11n.pt`.
- **Document Extraction:** `pypdf==4.3.1`, Python DOCX parsing, custom regex tokenizers.

### 3.2 Frontend
- **Framework / Bundler:** React 18.2, Vite 5.0 (`frontend/package.json`).
- **Styling & Motion:** TailwindCSS 3.3.5, Framer Motion 10.16, GSAP 3.14, Lucide Icons (`lucide-react`).
- **Code Editor:** Monaco Editor (`@monaco-editor/react==4.6.0`).
- **Data Visualization:** Recharts 2.9, Three.js (`three==0.182.0`, `@react-three/fiber`, `@react-three/drei`).
- **Client Speech & Voice:** Vapi Web SDK (`@vapi-ai/web==2.5.2`).
- **Document Export:** jsPDF (`jspdf==4.0.0`, `jspdf-autotable`), XLSX (`xlsx==0.18.5`).
- **State & Routing:** React Router DOM v6 (`react-router-dom==6.18.0`), ThemeContext (Dark/Light mode).

### 3.3 Infrastructure & Edge Proxy
- **Docker Compose:** Multi-container orchestration (`docker-compose.yml`, `docker-compose.prod.yml`).
- **Edge Proxy:** Nginx alpine serving static frontend assets, proxying `/api/` to backend, handling WebSockets and SSL termination.

---

## 4. Database Schema & Architecture

The database schema defined in [backend/models.py](file:///e:/HiringAi/backend/models.py) includes 20+ relational models with tenant isolation (`organization_id`):

### 4.1 Enterprise Multi-Tenancy & Core Auth
- **`organizations`**: Enterprise tenant details, unique slug, Clerk organization mapping, active/deactivated status.
- **`organization_members`**: Link table mapping users to organizations with roles (`ORGANIZATION_ADMIN`, `HR`) and membership status.
- **`users`**: User records with email, hashed password, role (`PLATFORM_ADMIN`, `ORGANIZATION_ADMIN`, `HR`, `STUDENT`, `CANDIDATE`), active state, and Clerk user mapping.

### 4.2 ATS & Recruitment Pipeline
- **`job_descriptions`**: Structured job postings including role title, required skills, preferred skills, responsibilities, experience requirements, targets, and organization ownership.
- **`candidates`**: Candidate records including parsed resume path, extracted raw text, phone, status (`Applied`, `In Progress`, `Hired`, `Rejected`), stage (`Resume Screening`, `Aptitude Round`, `Coding Round`, `Technical Interview`, `Offer Sent`), and AI score breakdowns.
- **`assessments`**: Recruiter-assigned assessments storing question configuration, question source (`ai` vs `manual`), scores, candidate submissions, and evaluation details.
- **`activity_logs`**: System audit trail logging actions, targets, details, and timestamps per tenant.
- **`global_settings`**: Tenant-specific configuration covering cutoffs, scoring weights, and notification flags.
- **`notifications`**: In-app notifications with read/unread tracking.

### 4.3 RoleReady Core Assessment Pipeline
- **`recruitment_batches`**: Cohort of candidate invitations attached to a job description for bulk testing.
- **`candidate_invitations`**: Single-use cryptographic invitation tokens with expiration dates and acceptance status.
- **`roleready_sessions`**: Central assessment session coordinating either Workflow A (Student Self-Assessment) or Workflow B (Recruiter Invitation). Tracks state machine:
  - `NOT_STARTED` -> `APTITUDE_IN_PROGRESS` -> `APTITUDE_SUBMITTED` -> `APTITUDE_EVALUATED`
  - -> `CODING_UNLOCKED` -> `CODING_IN_PROGRESS` -> `CODING_SUBMITTED` -> `CODING_EVALUATED`
  - -> `INTERVIEW_UNLOCKED` -> `INTERVIEW_IN_PROGRESS` -> `INTERVIEW_SUBMITTED` -> `INTERVIEW_EVALUATED`
  - -> `COMPLETED` / `ABANDONED`
  Stores aptitude, coding, interview, and overall readiness scores, resume text, and final report JSON.
- **`roleready_round_attempts`**: Individual round attempt records storing public question payload, confidential server keys (hidden tests & answers withheld from client), candidate submission payload, qualitative evaluation payload, and proctoring violation logs.

### 4.4 Student Career Hub & Placement Models
- **`student_profiles`**: Student profile records linked 1-to-1 with `users`, tracking academic branch, college name, graduation year, CGPA, target role, target company, readiness scores, and onboarding status.
- **`student_resumes`**: Versioned student resume uploads with extracted text, ATS score, overall score, strengths, weaknesses, missing information, and recommendations.
- **`student_roadmaps`**: Tailored multi-week learning roadmaps for target roles.
- **`student_daily_tasks`**: Actionable daily tasks assigned to weeks/days with category tags (`DSA`, `APTITUDE`, `TECHNICAL_SKILL`, `SYSTEM_DESIGN`, `RESUME`, `MOCK_INTERVIEW`) and completion states.
- **`student_practice_questions`**: Practice repository containing coding and aptitude questions with starter code, hidden test cases, difficulty, and explanations.
- **`student_practice_attempts`**: Student submission logs recording code submitted, tests passed, execution time, and feedback.
- **`student_mock_interviews`**: AI-driven mock interviews (Technical, HR, Mixed) tracking STAR structure scores, technical accuracy, and qualitative summaries.
- **`student_mock_interview_turns`**: Turn-by-turn dialogue records storing question text, student answer, AI turn feedback, and turn score.
- **`student_projects`**: Portfolio projects submitted by students with tech stack, GitHub/live links, and AI architectural completeness scores.
- **`student_placement_simulations`**: Multi-round campus placement simulations (Rounds 1–4).
- **`student_placement_simulation_rounds`**: Detailed round records for aptitude, coding, technical interview, and HR interview within a simulation.
- **`student_copilot_messages`**: Persistent conversational history for the student AI Career Copilot.
- **`placement_drives`**: Campus recruitment drives hosted by institutions/organizations with eligibility criteria, package LPA, and deadlines.
- **`placement_drive_applications`**: Student applications to drives with status (`APPLIED`, `SHORTLISTED`, `REJECTED`, `PLACED`).

---

## 5. Backend API Routers & Endpoints

All routers are registered in [backend/main.py](file:///e:/HiringAi/backend/main.py):

### 5.1 `routers/auth.py`
- `POST /api/auth/login/`: User password authentication returning JWT access token.
- `POST /api/auth/candidate-login/`: Candidate access via assigned test credentials.
- `POST /api/auth/check-email/`: Checks if an email exists and returns login eligibility.
- `POST /api/auth/clerk-sync/`: Validates Clerk session token, provisions or verifies organization membership, and exchanges for internal JWT.
- `GET /api/auth/me`: Resolves current authenticated user, role, and organization scope.

### 5.2 `routers/platform.py` (Platform Admin Only)
- `GET /api/platform/organizations`: Lists all organizations and their statistics.
- `POST /api/platform/organizations`: Provisions a new enterprise organization and assigns an initial admin.
- `GET /api/platform/organizations/{org_id}`: Retrieves deep tenant details.
- `PATCH /api/platform/organizations/{org_id}`: Updates tenant name, status, or Clerk mappings.
- `GET /api/platform/stats`: Aggregates platform-wide user, tenant, and assessment statistics.
- `DELETE /api/platform/organizations/{org_id}/members/{member_id}`: Removes an organization member.

### 5.3 `routers/organization.py` (Tenant Admin / HR)
- `GET /api/organization/`: Retrieves tenant company profile.
- `GET /api/organization/users`: Lists organization recruiters and members.
- `POST /api/organization/users/invite`: Generates recruiter invitations.
- `PATCH /api/organization/users/{member_id}`: Updates member role or status.
- `DELETE /api/organization/users/{member_id}`: Deactivates or removes a member.

### 5.4 `routers/resume.py` (ATS & Screening)
- `POST /api/resume/job-descriptions/`: Creates a structured job description.
- `GET /api/resume/job-descriptions/`: Lists all organization job descriptions.
- `GET /api/resume/job-descriptions/{jd_id}/`: Retrieves JD details.
- `PUT /api/resume/job-descriptions/{jd_id}/`: Updates an existing JD.
- `DELETE /api/resume/job-descriptions/{jd_id}/`: Deletes a JD.
- `POST /api/resume/suggest-skills/`: AI-powered skill extraction suggestions from job duties.
- `POST /api/resume/screen/`: Synchronous batch resume upload and screening against a JD.
- `POST /api/resume/screen-stream/`: Server-Sent Events (SSE) streaming endpoint that analyzes resumes in real-time, yielding progressive live matching feedback.
- `GET /api/resume/candidates/`: Lists screened candidates with sorting, filtering, and role scoping.
- `POST /api/resume/candidates/`: Manually creates a candidate record.
- `PATCH /api/resume/candidates/{candidate_id}/`: Updates candidate stage or status.
- `DELETE /api/resume/candidates/{candidate_id}/`: Deletes a candidate record.
- `POST /api/resume/candidates/bulk-update/`: Bulk stage progression or status updates.
- `GET /api/resume/stats/`: Computes pipeline conversion metrics and candidate distributions.
- `GET /api/resume/file/{candidate_id}`: Generates a scoped preview token for resume viewing.
- `GET /api/resume/preview-token`: Validates preview tokens for document viewing.

### 5.5 `routers/assessments.py`
- `POST /api/assessments/assign/`: Configures and assigns custom aptitude/coding assessments to candidates.
- `GET /api/assessments/my-pending/`: Retrieves pending tests for an authenticated candidate.
- `GET /api/assessments/{assessment_id}`: Retrieves candidate assessment configuration.
- `POST /api/assessments/{assessment_id}/submit`: Authoritative grading of submitted test answers.

### 5.6 `routers/roleready.py` (RoleReady Assessment Engine)
- `POST /api/roleready/student/initialize`: Initializes a student self-assessment session with uploaded resume and JD text/file.
- `GET /api/roleready/session/{session_uuid}`: Returns current state and sanitized questions for the active round.
- `POST /api/roleready/session/{session_uuid}/start-aptitude`: Transitions session to aptitude in progress.
- `POST /api/roleready/session/{session_uuid}/submit-aptitude`: Server-side grading of aptitude answers; unlocks coding round.
- `POST /api/roleready/session/{session_uuid}/start-coding`: Transitions session to coding in progress.
- `POST /api/roleready/session/{session_uuid}/run-code`: Sandboxed trial run against public sample cases.
- `POST /api/roleready/session/{session_uuid}/submit-coding`: Authoritative evaluation against hidden test cases; unlocks interview round.
- `POST /api/roleready/session/{session_uuid}/start-interview`: Starts technical interview round.
- `POST /api/roleready/session/{session_uuid}/vapi-init`: Generates dynamic Vapi assistant configuration grounded in candidate JD & resume.
- `POST /api/roleready/session/{session_uuid}/submit-interview`: Submits transcript and evaluates technical depth, STAR structure, and relevance.
- `POST /api/roleready/session/{session_uuid}/terminate`: Aborts session upon proctoring violation limit (e.g. 3/3 malpractice alerts).
- `GET /api/roleready/session/{session_uuid}/report`: Returns consolidated Job Readiness Report.
- `POST /api/roleready/admin/batches`: Creates recruitment batches for bulk candidate assessment.
- `GET /api/roleready/admin/batches`: Lists tenant recruitment batches.
- `POST /api/roleready/admin/parse-resumes`: Batch parses uploaded resumes for candidate invitation setup.
- `POST /api/roleready/admin/dispatch-batch`: Generates single-use invitation tokens and dispatches emails to candidates.
- `GET /api/roleready/portal/verify`: Validates single-use candidate invitation tokens for entry into the test portal.

### 5.7 `routers/student.py` (Student Career Platform)
- `POST /api/student/auth/register`: Student account registration.
- `POST /api/student/auth/login`: Student login.
- `GET /api/student/profile`: Returns student profile and readiness stats.
- `PUT /api/student/profile`: Updates student academic, skills, and target career info.
- `POST /api/student/resume/upload`: Uploads and parses resume into 9-dimension diagnostic breakdown.
- `GET /api/student/resume`: Retrieves latest analyzed resume scorecard.
- `GET /api/student/readiness`: Computes comprehensive multi-factor placement readiness score.
- `GET /api/student/dashboard`: High-level summary of active tasks, roadmaps, and scores.
- `GET /api/student/skill-gap`: Compares student skills against target role taxonomy.
- `POST /api/student/skill-gap/analyze`: Generates detailed gap report with missing skills.
- `GET /api/student/roadmap`: Fetches active weekly roadmap and daily tasks.
- `POST /api/student/roadmap/generate`: Uses Gemini to synthesize a customized 4-week study plan.
- `PATCH /api/student/daily-tasks/{task_id}`: Updates completion status of a daily task.
- `GET /api/student/practice/topics`: Lists practice categories (DSA, Aptitude, System Design).
- `GET /api/student/practice/questions`: Fetches practice questions without leaking server keys.
- `POST /api/student/practice/submit`: Runs student code against test cases in sandbox and records attempt.
- `POST /api/student/mock-interview/start`: Initializes a mock STAR interview session.
- `POST /api/student/mock-interview/{id}/turn`: Evaluates a dialogue turn and generates the next question.
- `POST /api/student/mock-interview/{id}/complete`: Finalizes mock interview and computes rubric scores.
- `GET /api/student/projects`: Lists student portfolio projects.
- `POST /api/student/projects`: Adds a new project.
- `POST /api/student/projects/{id}/analyze`: AI architectural review, code quality check, and interview questions.
- `POST /api/student/simulation/start`: Initiates a 4-round placement simulation.
- `POST /api/student/simulation/{id}/round/{num}/submit`: Grades simulation round (Aptitude, Coding, Tech, HR).
- `POST /api/student/copilot/chat`: Conversational AI Career Copilot grounded in student profile data.
- `GET /api/student/drives`: Lists open campus placement drives.
- `POST /api/student/drives/{id}/apply`: Submits application to a campus drive.
- `POST /api/student/onboarding/step`: Saves student progress through the onboarding wizard.
- `GET /api/student/performance/dashboard`: Comprehensive multi-test performance analytics.

### 5.8 `routers/college.py` (College Placement Administration)
- `GET /api/college/overview`: Cohort readiness metrics, department averages, student counts.
- `GET /api/college/students`: Searchable, filterable student roster with readiness scores.
- `GET /api/college/drives`: Campus placement drives hosted by the college.
- `POST /api/college/drives`: Creates a campus placement drive.
- `GET /api/college/drives/{id}/applications`: Lists student applicants for a drive.
- `PATCH /api/college/applications/{id}/status`: Shortlists, selects, or rejects candidate drive applications.

### 5.9 `routers/dashboard.py` (Recruitment Analytics)
- `GET /api/dashboard/activity/`: Recent audit events.
- `GET /api/dashboard/insights/`: AI-generated recruitment bottleneck alerts.
- `GET /api/dashboard/notifications/`: Recruiter notifications.
- `PUT /api/dashboard/notifications/{id}/read`: Marks notification read.
- `GET /api/dashboard/analytics/`: Detailed candidate scores, round comparisons, and funnel statistics.

### 5.10 `routers/interview.py` (Voice AI Webhooks)
- `GET /api/interview/init`: Generates dynamic Vapi configuration for scheduled recruiter interviews.
- `POST /api/interview/submit`: Webhook receiving Vapi call end transcripts and computing candidate scores.

### 5.11 `routers/proctor.py` (Computer Vision Proctoring)
- `GET /api/proctor/status`: Returns status and capabilities of the YOLO detection engine.
- `POST /api/proctor/analyze-frame`: Analyzes a base64 webcam frame with YOLOv8/v11, returning detected persons, phones, books, and laptops with bounding boxes.

### 5.12 `routers/settings.py`
- `GET /api/settings/`: Retrieves organization scoring weights and cutoffs.
- `PUT /api/settings/`: Updates organization evaluation configuration.

---

## 6. Backend Services Inventory

The 26 services in [backend/services/](file:///e:/HiringAi/backend/services) handle business logic:

1. **`gemini_client.py`**: Centralized Google Gemini LLM client (`gemini-2.5-flash`). Handles retries, exponential backoffs, JSON output parsing, and keyless mock mode routing.
2. **`gemini_mock_fixtures.py`**: Offline deterministic fixtures for question generation, resume screening, and evaluations when running without live API keys.
3. **`roleready_service.py`** (140 KB): Core orchestration for RoleReady assessment sessions. Manages JD synthesis, question generation, state machines, sandbox execution, proctoring violations, and dual-audience reports.
4. **`student_performance_service.py`**: Aggregates, normalizes, and analyzes student performance across assessments, simulations, practice questions, and mock interviews.
5. **`student_resume_analyzer.py`**: Extracts text from PDF/DOCX and evaluates student resumes across 9 dimensions without fabricating credentials.
6. **`proctor_service.py`**: Loads CPU-optimized YOLO models (`yolov8n.pt` / `yolo11n.pt`) and performs real-time detection on webcam frames for malpractice objects.
7. **`piston_service.py`**: Interfaces with the Piston and Judge0 containerized execution engines to safely execute code in Python, Java, C++, and JavaScript with timeout limits.
8. **`vapi_service.py`**: Integrates with Vapi voice API, generating customized assistant system prompts and WebRTC call configurations.
9. **`ai_generator.py`**: Generates aptitude questions, coding challenges, and interview rubrics tailored to job descriptions.
10. **`aptitude_evaluation.py`**: Grades candidate aptitude submissions against server answer keys.
11. **`coding_evaluation.py`**: Evaluates coding submissions against public and hidden test cases, checking execution times and error outputs.
12. **`interview_evaluation.py`**: Parses conversational interview transcripts to score technical depth, STAR structure, and domain accuracy.
13. **`readiness_service.py`**: Calculates multi-factor student readiness index combining resumes, practice attempts, and test scores.
14. **`roadmap_service.py`**: Generates and manages 4-week structured preparation roadmaps with daily milestones.
15. **`practice_service.py`**: Powers the student DSA and aptitude practice engine with question retrieval and test evaluation.
16. **`student_interview_service.py`**: Manages conversational turns and feedback loops for student mock interviews.
17. **`project_analyzer_service.py`**: Analyzes student software projects from descriptions and repositories, producing architecture feedback and interview defense questions.
18. **`placement_simulation_service.py`**: Manages the 4-round full campus recruitment simulation pipeline.
19. **`skill_gap_service.py`**: Analyzes missing competencies between student profiles and standard industry roles.
20. **`skill_suggestion.py`**: Extracts skill tags from job descriptions using regex dictionaries and LLMs.
21. **`college_service.py`**: Computes cohort statistics, department benchmarks, and student placement analytics.
22. **`copilot_service.py`**: Manages conversational AI context for the student Career Copilot assistant.
23. **`onboarding_service.py`**: Handles student multi-step profile onboarding.
24. **`rag_service.py`**: Extracts text from PDF and DOCX files.
25. **`clerk_service.py`**: Verifies Clerk JWTs and synchronizes organization memberships.
26. **`email_templates.py`**: Pre-built HTML/text email templates for candidate assessment invitations and notifications.

---

## 7. Frontend Pages & Component Topology

### 7.1 Pages (`frontend/src/pages`)
- **Public & Authentication:**
  - `Home.jsx`: Landing page showcasing capabilities with unified authentication modal for Recruiter, Candidate, Student, and College roles.
- **Recruiter & Admin (`DashboardLayout`):**
  - `Dashboard.jsx`: Main recruiting dashboard with pipeline funnels, candidate counts, and activity feeds.
  - `ResumeScreening.jsx`: ATS interface with structured JD editor and streaming resume screening.
  - `ScreenedCandidates.jsx`: Table of screened candidates with score filters and bulk status actions.
  - `RecruitmentRoundsManager.jsx`: Assessment round manager for aptitude, coding, and interview rounds.
  - `AptitudeRound.jsx`: Aptitude question authoring (AI generation or manual builder).
  - `CodingRound.jsx`: Coding challenge authoring with test case configuration.
  - `TechnicalInterview.jsx`: Voice interview configuration and rubric parameters.
  - `Candidates.jsx`: Candidate directory with stage movement and test invitation triggers.
  - `Analytics.jsx`: Recruiting analytics, score distributions, and candidate comparison drawer.
  - `GlobalSettings.jsx`: Organization configuration, scoring weights, and cutoffs.
  - `PlatformAdminDashboard.jsx`: Platform-wide tenant management, organization creation, and member role assignment.
  - `VapiTest.jsx`: Audio/microphone diagnostic test utility.
- **Candidate Portal (`CandidateLayout`):**
  - `CandidateLogin.jsx`: Login page for candidates using test credentials.
  - `CandidateStartPage.jsx`: Candidate welcome and system hardware check (camera, mic, fullscreen).
  - `InstructionsPage.jsx`: Rules and anti-cheating guidelines before starting tests.
  - `CandidateAptitudeAssessment.jsx`: Timed aptitude test interface.
  - `CandidateCodingAssessment.jsx`: Coding test interface with Monaco editor, syntax highlighting, and test runner.
  - `VapiInterview.jsx`: Voice interview interface with real-time speech interaction and transcript display.
- **RoleReady Assessment (`pages/roleready/`):**
  - `RoleReadySetup.jsx`: Setup page for student self-assessment with resume upload and JD entry.
  - `RoleReadyAssessment.jsx`: Unified 3-stage assessment interface enforcing sequential progression with webcam proctoring and fullscreen protection.
  - `RoleReadyReport.jsx`: Consolidated Job Readiness Report featuring Job Fit Score, Skill Match Matrix, and personalized roadmaps.
  - `CandidateInvitationPortal.jsx`: Entry portal for candidates completing invited assessments via token.
- **Student Career Hub (`StudentLayout`):**
  - `StudentDashboard.jsx`: Unified student hub with readiness scores, daily task checklists, and simulation summaries.
  - `StudentResumeUpload.jsx`: Resume uploader displaying 9-dimension diagnostic feedback.
  - `StudentProfile.jsx`: Profile manager for education, skills, and target career paths.
  - `StudentSkillGap.jsx`: Interactive skill gap analyzer comparing skills to market demands.
  - `StudentRoadmap.jsx`: Interactive 4-week roadmap with task checkboxes and progress tracking.
  - `StudentPractice.jsx`: DSA and aptitude practice coding ground with Monaco editor.
  - `StudentMockInterview.jsx`: Behavioral/technical STAR interview practice interface.
  - `StudentProjects.jsx`: Project portfolio manager with AI architecture review.
  - `StudentPlacementSimulation.jsx`: 4-stage campus placement simulation interface.
  - `StudentDrives.jsx`: Campus recruitment drive listing and application tracker.
- **College Placement Cell (`CollegeLayout`):**
  - `CollegeDashboard.jsx`: TPO cohort overview, department averages, and readiness distributions.
  - `CollegeStudents.jsx`: Student roster with readiness filtering and detailed performance views.
  - `CollegeDrives.jsx`: Campus drive creator and applicant management.

### 7.2 Key Components (`frontend/src/components`)
- `FullscreenGateModal.jsx`: Modal that blocks candidate progression when exiting fullscreen, with a 10-second countdown before violation recording.
- `StructuredJobDescriptionEditor.jsx`: Multi-attribute JD builder capturing duties, required/preferred skills, and experience.
- `ManualAptitudeBuilder.jsx` & `ManualCodingBuilder.jsx`: Recruiter authoring interfaces for test questions and test cases.
- `CandidateDetailDrawer.jsx`: Recruiter slide-over drawer displaying candidate metrics without exposing prompt internals.
- `CareerCopilotDrawer.jsx`: Floating AI career assistant drawer accessible throughout the student portal.
- `StudentOnboardingWizard.jsx`: Multi-step onboarding guide for first-time students.
- `StudentPerformanceView.jsx`: Unified analytics component charting assessment performance over time.
- `ClerkAdminGuard.jsx` & `RoleReadyAuthGuard.jsx`: Route protection components enforcing authentication and role checks.
- `GlobalNavbar.jsx`, `PublicNavbar.jsx`, `RoleReadyNavbar.jsx`: Context-aware navigation headers.

### 7.3 Custom Hooks (`frontend/src/hooks`)
- `useAssessmentFullscreen.js`: Enforces fullscreen mode, detects tab switching (`blur`/`visibilitychange`), and triggers violation callbacks.
- `useProctoring.js` / `useFaceProctoring.js`: Manages webcam streams, captures periodic frames, sends them to `/api/proctor/analyze-frame`, and manages warning alerts.
- `useStudentTaskStatus.js`: Tracks real-time completion state for roadmap tasks.

---

## 8. Anti-Malpractice & Vision Proctoring Pipeline

The platform uses a layered security model during test-taking:

```
[Candidate Browser]
   │
   ├─► Fullscreen Enforcement (`useAssessmentFullscreen.js`)
   │      └─► Fullscreen exit / Tab switch triggered
   │             └─► `FullscreenGateModal.jsx` opens (10s recovery timer)
   │                    └─► If unrecovered: records violation attempt (max 3 allowed)
   │
   └─► Continuous Webcam Capture (`useProctoring.js`)
          └─► Periodically encodes base64 video frame
                 └─► POST /api/proctor/analyze-frame
                        │
                        ▼
               [FastAPI Backend: `proctor_service.py`]
                        │
                        ▼
               [Ultralytics YOLOv8 / YOLO11 CPU Engine]
                        │
                        ├─► Detection: No person detected -> Warning
                        ├─► Detection: Multiple people (count > 1) -> Violation
                        ├─► Detection: Cell phone (class 67) -> Malpractice Alert
                        ├─► Detection: Laptop / Secondary Screen -> Malpractice Alert
                        └─► Detection: Book / Notes -> Malpractice Alert
```

When 3 violations are logged, the session is locked or terminated (`/api/roleready/session/{session_uuid}/terminate`), and all incident timestamps are preserved in `roleready_round_attempts.proctoring_violations` for recruiter review.

---

## 9. Automated Testing Suite

The repository contains automated test suites covering backend and frontend logic:

### 9.1 Backend Tests (`backend/tests/` — 41 Test Files, 162+ Tests)
- `test_multitenant_isolation.py`: Validates fail-closed tenant boundaries across all queries.
- `test_b2b_provisioning_flow.py`: Tests organization creation, user invitations, and Clerk synchronization.
- `test_roleready_pipeline.py`: Tests the sequential state machine from aptitude initialization to final report generation.
- `test_roleready_auth_matrix.py`: Tests access permissions across students, recruiters, and candidates.
- `test_proctor_vision.py`: Tests YOLO model loading, inference on frames, and violation flags.
- `test_scoring_and_starters.py`: Verifies coding test case execution and language starter templates.
- `test_student_performance_dashboard.py`: Verifies student analytics aggregation and metric calculations.
- `test_student_phase1.py` through `test_student_phase11.py`: Comprehensive coverage of student onboarding, roadmaps, mock interviews, simulations, and drives.
- `test_gemini_client_mock.py`: Verifies offline deterministic fallback operation.

### 9.2 Frontend Tests (`frontend/` — 16+ Test Suites, 53+ Tests)
Run via `npm test` (`node --test *.test.mjs`):
- `test_analytics_dashboard.test.mjs`: Tests dashboard rendering and metric aggregation.
- `test_assessment_fullscreen.test.mjs`: Verifies fullscreen entry and 10s recovery window contracts.
- `test_roleready_proctoring_fullscreen.test.mjs`: Tests proctoring event listeners and modal interactions.
- `test_student_dashboard_navigation.test.mjs`: Tests student routing and layout rendering.
- `test_security_phase11.test.mjs`: Verifies token storage and authenticated route guards.
- `test_college_phase9.test.mjs`: Tests college placement overview and student listings.

---

## 10. Operational Deployment & Environment Configuration

### 10.1 Production Orchestration (`docker-compose.prod.yml`)
- **`db`**: MySQL 8.0 with volume persistence (`interviewer_mysql_data`).
- **`redis`**: Redis 7 Alpine with AOF persistence (`interviewer_redis_data`).
- **`backend`**: FastAPI running on Python 3.11 with Gunicorn + Uvicorn workers. Exposes `/health/live` and `/health/ready`.
- **`frontend`**: React + Vite production build served through Nginx.
- **`reverse_proxy`**: Nginx edge proxy listening on host port `8212` (or `80`/`443`), directing traffic to frontend and `/api` to backend.

### 10.2 Environment Configuration (`backend/.env.example`)
Configures MySQL connection parameters, `JWT_SECRET_KEY` (minimum 32 characters in production), Clerk keys, Google Gemini credentials (`GEMINI_API_KEY`, `GEMINI_MODEL_NAME=gemini-2.5-flash`), `GEMINI_MOCK_MODE` toggle, Vapi keys, Piston/Judge0 execution URLs, and SMTP notification credentials.

---

*This document summarizes all existing modules, files, routes, data structures, and services within the HiringAI / PrepWin codebase as of October 2026.*
