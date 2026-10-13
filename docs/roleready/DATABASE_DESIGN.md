# PrepWin — Database Design & Schema Evolution

## 1. Design Principles
1. **Zero Data Loss:** All existing tables (`users`, `organizations`, `job_descriptions`, `candidates`, `assessments`, `student_profiles`) remain intact.
2. **Additive Evolution:** New tables and columns cleanly extend existing entities using foreign keys with appropriate cascade policies.
3. **Auditability & Temporal Tracking:** Every round attempt, submission snapshot, and state transition is recorded with server-generated timestamps.

---

## 2. Entity Relationship Diagram (RoleReady Core)

```
┌────────────────────────┐
│     organizations      │
└───────────┬────────────┘
            │ 1:N
            ├───►┌───────────────────────────┐
            │    │     job_descriptions      │◄──┐
            │    └─────────────┬─────────────┘   │
            │                  │ 1:N             │ 1:N
            │                  ▼                 │
            │    ┌───────────────────────────┐   │
            │    │    recruitment_batches    │   │
            │    └─────────────┬─────────────┘   │
            │                  │ 1:N             │
            │                  ▼                 │
            │    ┌───────────────────────────┐   │
            ├───►│   candidate_invitations   │   │
            │    └─────────────┬─────────────┘   │
            │                  │ 1:1             │
            │                  ▼                 │
            │    ┌───────────────────────────┐   │
            ├───►│ roleready_sessions        │───┴─ (JD Context)
            │    │ • student_profile_id (opt)│
            │    │ • candidate_id (opt)      │
            │    │ • current_state           │
            │    │ • overall_score           │
            │    └─────────────┬─────────────┘
            │                  │ 1:N
            │                  ▼
            │    ┌───────────────────────────┐
            └───►│ roleready_round_attempts  │
                 │ • round_type (APT/COD/INT)│
                 │ • status                  │
                 │ • score & evaluation_data │
                 │ • violations_count        │
                 └───────────────────────────┘
```

---

## 3. Data Tables Specification

### 3.1 `roleready_sessions`
Represents an instance of an end-to-end 3-round assessment session.
- `id` (INT, PK, AUTO_INCREMENT)
- `session_uuid` (VARCHAR(64), UNIQUE, INDEX)
- `organization_id` (INT, FK -> organizations.id, NULLABLE for independent students)
- `student_profile_id` (INT, FK -> student_profiles.id, NULLABLE)
- `candidate_id` (INT, FK -> candidates.id, NULLABLE)
- `invitation_id` (INT, FK -> candidate_invitations.id, NULLABLE)
- `job_description_id` (INT, FK -> job_descriptions.id, NULLABLE)
- `custom_jd_text` (MEDIUMTEXT, NULLABLE - for custom pasted student JDs)
- `custom_jd_metadata` (JSON - extracted role, skills, requirements)
- `resume_snapshot` (JSON - parsed resume structured data at time of assessment)
- `current_state` (VARCHAR(50), NOT NULL, DEFAULT 'NOT_STARTED')
  - Valid states: `NOT_STARTED`, `APTITUDE_IN_PROGRESS`, `APTITUDE_SUBMITTED`, `APTITUDE_EVALUATED`, `CODING_UNLOCKED`, `CODING_IN_PROGRESS`, `CODING_SUBMITTED`, `CODING_EVALUATED`, `INTERVIEW_UNLOCKED`, `INTERVIEW_IN_PROGRESS`, `INTERVIEW_SUBMITTED`, `INTERVIEW_EVALUATED`, `COMPLETED`, `ABANDONED`
- `aptitude_score` (FLOAT, DEFAULT 0.0)
- `coding_score` (FLOAT, DEFAULT 0.0)
- `interview_score` (FLOAT, DEFAULT 0.0)
- `overall_job_readiness_score` (FLOAT, DEFAULT 0.0)
- `final_report_data` (JSON, NULLABLE)
- `started_at` (DATETIME, NULLABLE)
- `completed_at` (DATETIME, NULLABLE)
- `created_at` (DATETIME, server_default=now())
- `updated_at` (DATETIME, onupdate=now())

### 3.2 `roleready_round_attempts`
Stores the detailed configuration, question set, student submission, and evaluation breakdown per round.
- `id` (INT, PK, AUTO_INCREMENT)
- `session_id` (INT, FK -> roleready_sessions.id, ON DELETE CASCADE)
- `round_type` (VARCHAR(30), NOT NULL) - `APTITUDE`, `CODING`, `INTERVIEW`
- `round_order` (INT, NOT NULL) - 1, 2, or 3
- `status` (VARCHAR(30), DEFAULT 'PENDING') - `PENDING`, `IN_PROGRESS`, `SUBMITTED`, `EVALUATED`
- `score` (FLOAT, DEFAULT 0.0)
- `time_spent_seconds` (INT, DEFAULT 0)
- `questions_payload` (JSON) - Generated questions, problems, prompts (client-safe)
- `server_answer_keys` (JSON) - Hidden test cases, correct answers (STRICTLY SERVER-SIDE)
- `submission_payload` (JSON) - Candidate answers, code submissions, transcripts
- `evaluation_payload` (JSON) - Detailed scoring breakdown, strengths, weaknesses, code metrics
- `proctoring_violations` (JSON) - Tab switches, fullscreen exits, face-off events
- `started_at` (DATETIME, NULLABLE)
- `submitted_at` (DATETIME, NULLABLE)
- `created_at` (DATETIME, server_default=now())

### 3.3 `candidate_invitations`
Encapsulates secure recruitment workflow invitations.
- `id` (INT, PK, AUTO_INCREMENT)
- `organization_id` (INT, FK -> organizations.id, ON DELETE CASCADE)
- `job_description_id` (INT, FK -> job_descriptions.id, ON DELETE CASCADE)
- `candidate_id` (INT, FK -> candidates.id, ON DELETE CASCADE)
- `batch_id` (INT, FK -> recruitment_batches.id, NULLABLE)
- `invitation_token` (VARCHAR(128), UNIQUE, INDEX) - Cryptographic hex token
- `status` (VARCHAR(30), DEFAULT 'PENDING') - `PENDING`, `ACCEPTED`, `EXPIRED`, `REVOKED`
- `expires_at` (DATETIME, NOT NULL)
- `created_at` (DATETIME, server_default=now())
- `accepted_at` (DATETIME, NULLABLE)

### 3.4 `recruitment_batches`
Allows recruiters to group candidates into named hiring campaigns.
- `id` (INT, PK, AUTO_INCREMENT)
- `organization_id` (INT, FK -> organizations.id, ON DELETE CASCADE)
- `job_description_id` (INT, FK -> job_descriptions.id)
- `batch_name` (VARCHAR(200), NOT NULL)
- `description` (TEXT, NULLABLE)
- `total_candidates` (INT, DEFAULT 0)
- `created_by` (INT, FK -> users.id)
- `created_at` (DATETIME, server_default=now())
