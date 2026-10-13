# RoleReady — Product Requirements Document (PRD)

## 1. Executive Summary
**RoleReady** is an enterprise-grade, AI-powered Job Readiness & Assessment Platform designed to evaluate candidate competencies directly against verified Job Descriptions (JDs). 

RoleReady bridges the gap between academic preparation and industry recruitment standards by providing an objective, three-tier sequential assessment pipeline:
1. **Round 1: Role-Specific Aptitude & Reasoning**
2. **Round 2: Practical Coding & Algorithmic Problem Solving**
3. **Round 3: Conversational AI Technical & Behavioral Interview**

---

## 2. Core Workflows

### Workflow A: Student Self-Assessment
1. **Authentication & Profile Setup:**
   - Student logs in via the RoleReady student portal.
   - Student uploads their current resume (PDF / DOCX).
   - Student inputs a target Job Description (either by uploading a JD document or pasting full job text).
2. **Context Synthesis & Assessment Generation:**
   - System parses the resume (skills, experience, education, projects, certifications).
   - System analyzes the full JD (required skills, preferred skills, responsibilities, seniority level, domain expectations).
   - System generates a custom 3-round assessment battery tailored to the delta between the student's profile and the JD.
3. **Strict Sequential Assessment Progression:**
   - **Round 1 (Aptitude):** Timed MCQ battery assessing numerical reasoning, logical problem-solving, and domain aptitude.
   - *Gating:* Round 2 remains locked until Round 1 is submitted and evaluated on the server.
   - **Round 2 (Coding):** 1 to 3 live programming problems executed in a sandboxed runtime (Piston/Judge0) with public and hidden test cases, accompanied by webcam proctoring and fullscreen monitoring.
   - *Gating:* Round 3 remains locked until Round 2 is submitted and evaluated on the server.
   - **Round 3 (Technical & Behavioral Interview):** Conversational AI voice/audio interview utilizing speech-to-speech interaction (Vapi/WebRTC) asking JD-specific and resume-grounded technical questions.
4. **Individual & Consolidated Readiness Reporting:**
   - Per-round scorecards and diagnostic feedback.
   - Consolidated Job Readiness Report featuring:
     - Job Fit Index (0–100%)
     - Skill Match Matrix (Met vs. Unmet Requirements)
     - Code Quality & Algorithmic Efficiency Analysis
     - Interview Articulation & Technical Depth Ratings
     - Actionable preparation roadmap with recommended practice.

---

### Workflow B: Administrator-Managed Recruitment
1. **Authentication & Organization Scope:**
   - Recruiter/Admin signs in via Clerk-backed role-based authentication.
   - All assets, JDs, candidate cohorts, and reports are strictly scoped to the admin's organization tenant.
2. **Job Description & Campaign Setup:**
   - Admin defines or selects a Job Description (role title, description, required skills, competencies).
   - Admin configures the assessment criteria (number of coding problems, aptitude duration, interview depth).
3. **Bulk Candidate Ingestion & Resume Parsing:**
   - Admin uploads multiple candidate resumes in batch.
   - Asynchronous parsing extracts candidate name, email, phone, skills, and background.
   - Automatic preliminary ATS screening score calculated against the selected JD.
4. **Secure Invitation Dispatch:**
   - Admin reviews parsed candidates and triggers personalized assessment invitations.
   - System generates cryptographic, single-use, time-bound invitation tokens.
   - Email dispatch with direct, secure assessment launch URLs.
5. **Candidate Assessment Execution:**
   - Invited candidates access the dedicated, proctored assessment portal.
   - Candidates take the exact same rigorous sequential 3-round assessment battery.
6. **Consolidated Recruitment Dashboard & Comparative Analytics:**
   - Admin dashboard displays real-time candidate funnel: Ingested → Invited → Aptitude Complete → Coding Complete → Interview Complete → Assessed.
   - Comparative candidate leaderboards with multi-round filtering and ranking.
   - Comprehensive recruiter assessment dossier per candidate with code playback, test case reports, proctoring violation logs, and interview audio/transcripts.

---

## 3. High-Level Technical Architecture
- **Backend:** FastAPI (Python 3.11+), SQLAlchemy 2.0 ORM, MySQL 8 / PostgreSQL with JSON capabilities, Pydantic V2 schemas.
- **Frontend:** React 18, Vite, Tailwind CSS, Lucide icons, Monaco / CodeMirror editor, WebRTC audio streaming.
- **AI Engine:** Google Gemini 2.5 Flash / Groq LLM abstraction for question generation, resume synthesis, and evaluation.
- **Code Execution:** Piston / Judge0 containerized sandbox supporting Python, JavaScript, Java, C++, and Go.
- **Interview Voice Pipeline:** Vapi conversational AI WebRTC integration with fallback audio capture and speech evaluation.
- **Proctoring Engine:** Client-side webcam continuous face detection, tab switch detection, and fullscreen enforcement with server violation persistence.

---

## 4. Key Performance Indicators & Non-Functional Requirements
- **Security:** Zero cross-tenant data leakage; zero client-side bypass of round gating; server-side validation of all scores and test results.
- **Reliability:** Idempotent evaluation pipelines with automatic recovery for interrupted sessions.
- **Responsiveness:** Round generation under 5 seconds; code execution turnaround under 3 seconds per test suite; real-time conversational audio latency under 800ms.
- **Maintainability:** Fully backward-compatible database schema migrations with preserved historical candidate data.
