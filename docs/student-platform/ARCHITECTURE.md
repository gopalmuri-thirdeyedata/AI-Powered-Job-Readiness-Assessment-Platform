# HiringAI Student Career Platform — System Architecture

## 1. High-Level Architecture Topology

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT TIER                                       |
|                                                                                   |
|  +--------------------+  +----------------------+  +---------------------------+  |
|  |   Recruiter Web    |  |   Candidate Portal   |  |   Student Career Hub      |  |
|  |   (Clerk Session)  |  |   (Candidate JWT)    |  |   (Student Auth JWT)      |  |
|  +---------+----------+  +----------+-----------+  +-------------+-------------+  |
|            |                        |                            |                |
+------------|------------------------|----------------------------|----------------+
             |                        |                            |
             v                        v                            v
+-----------------------------------------------------------------------------------+
|                             API GATEWAY / REVERSE PROXY                           |
|                                  (NGINX Port 80)                                  |
+-----------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                                 BACKEND TIER                                      |
|                             FastAPI Application                                   |
|                                                                                   |
|  [Security & Auth Subsystem]                                                      |
|   - Clerk Token Verifier (Recruiters / Org Admins / Platform Admins)              |
|   - Candidate Session Verifier (Candidate JWTs)                                   |
|   - Student Tenant Verifier (Student JWTs + Org Scoping)                          |
|                                                                                   |
|  [Routers]                                                                        |
|   - /api/auth               - /api/organization         - /api/recruiter          |
|   - /api/candidate          - /api/resume               - /api/interview (Frozen) |
|   - /api/student            - /api/college              - /api/analytics          |
|                                                                                   |
|  [Services & Business Logic]                                                      |
|   - AIGenerator (Gemini / Groq with Fallback)                                     |
|   - StudentResumeAnalyzer (9-Dimension Extraction)                                |
|   - ReadinessService (Indicative Multi-factor Scoring)                            |
|   - SkillGapService & SkillTaxonomy                                               |
|   - RoadmapGenerator & TaskManager                                                |
|   - PracticeService & CodeExecutionProxy (Judge0)                        |
|   - StudentMockInterviewService (STAR dialogue & Speech Evaluation)               |
|   - ProjectAnalyzerService                                                        |
|   - PlacementSimulationOrchestrator                                               |
|   - CareerCopilotService                                                          |
|   - CollegeAnalyticsService                                                       |
+-----------------------------------------------------------------------------------+
             |                                             |
             v                                             v
+-----------------------------+               +-------------------------------------+
|      PERSISTENCE TIER       |               |        EXTERNAL INTEGRATIONS        |
|                             |               |                                     |
|  MySQL 8 Relational Store   |               |  - Clerk Identity API               |
|  - organizations            |               |  - Google Gemini API / Groq Cloud   |
|  - organization_members     |               |  - Judge0 Execution Engine |
|  - users                    |               |  - ElevenLabs Voice Engine           |
|  - student_profiles         |               +-------------------------------------+
|  - student_resumes          |
|  - student_roadmaps         |
|  - student_daily_tasks      |
|  - student_practice_*       |
|  - student_mock_interviews  |
|  - student_projects         |
|  - placement_simulations    |
|  - placement_drives         |
|  - career_copilot_messages  |
+-----------------------------+
```

---

## 2. Component Boundaries & Isolation

### 2.1 Student vs. Recruiter Isolation
1. **Database Tables**: Student learning records (`student_roadmaps`, `student_practice_attempts`, `student_mock_interviews`) are strictly decoupled from formal recruiter candidate evaluation tables (`candidates`, `candidate_results`, `interviews`). Practice tests never alter candidate recruitment scores.
2. **Frozen Files Protection**: The recruiter interview evaluation (`interview_evaluation.py`) remains unmodified. `routers/interview.py` and the voice engine (`elevenlabs_service.py`) were changed once, to replace Vapi with ElevenLabs. Student mock interviews operate through independent student services and routes.
3. **Authentication Boundary**: Students authenticate via the dedicated `/api/student/auth` route, obtaining scoped tokens with `role="STUDENT"` that cannot access recruiter or admin APIs.

### 2.2 College / Tenant Isolation
1. **Multi-Tenant Scoping**: All student records carry a non-nullable `organization_id` referencing the educational institution.
2. **Fail-Closed Queries**: All database queries enforce filtering on `organization_id`. Any attempt by an authenticated student or college admin to query entities outside their assigned organization results in an immediate HTTP 403 or 404 response.
3. **Server-Controlled Enrollment**: Students cannot enroll into an arbitrary organization; enrollment requires an institution-issued invite code or prior administrative pre-enrollment.

---

## 3. AI Service Pipeline & Reliability Strategy
The platform utilizes the unified `AIGenerator` service located at `backend/services/ai_generator.py`.

```
                    +---------------------------+
                    |    Service AI Request     |
                    +-------------+-------------+
                                  |
                                  v
                    +---------------------------+
                    |      Primary Provider     |
                    |      (Gemini 1.5 Pro)     |
                    +-------------+-------------+
                                  |
                        +---------+---------+
                        | Success?          |
                        |                   |
                       YES                  NO (Timeout / Rate Limit)
                        |                   |
                        v                   v
            +-----------------------+  +---------------------------+
            |  Structured JSON Parse|  |    Secondary Provider     |
            |      & Validation     |  |       (Groq Llama 3)      |
            +-----------+-----------+  +-------------+-------------+
                        |                            |
                     Success?              +---------+---------+
                        |                  | Success?          |
                       YES                 |                   |
                        |                 YES                  NO
                        v                  |                   |
            +-----------------------+      v                   v
            | Return Validated Model|  +-------+  +---------------------------+
            +-----------------------+  | Parse |  |   Deterministic Fallback  |
                                       +-------+  |   (Rule-based Taxonomy)   |
                                                  +-------------+-------------+
                                                                |
                                                                v
                                                  +---------------------------+
                                                  | Return Graceful Fallback  |
                                                  +---------------------------+
```

---

## 4. Frontend Architecture
- **Routing & Guards**: Single-page application using React Router v6.
  - `/student/*` routes are protected by `StudentLayout.jsx`, which validates student session tokens.
  - `/college/*` routes are protected by organization administrator RBAC checks.
  - `/recruiter/*` and `/admin/*` remain isolated under Clerk authentication.
- **Design System**: Tailored dark-mode SaaS interface built with Tailwind CSS, Lucide icons, responsive flex/grid layouts, accessible forms, and rich micro-interactions.
