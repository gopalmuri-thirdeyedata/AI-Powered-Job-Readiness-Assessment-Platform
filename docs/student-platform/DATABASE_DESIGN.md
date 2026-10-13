# HiringAI Student Career Platform — Database Schema Design

## 1. Overview & Data Philosophy
The HiringAI student career database model extends the existing MySQL 8 relational schema with comprehensive student learning, practice, simulation, and college placement tables.

### Key Tenets:
1. **Mandatory Tenant Scoping**: Every student and institutional entity has a non-nullable `organization_id` with foreign key and index to guarantee multi-tenant boundary enforcement.
2. **Normalized Relations**: Critical identifiers, foreign keys, and statuses use standard relational columns. Complex variable outputs (such as detailed AI feedback breakdowns or test execution results) use MySQL `JSON` columns.
3. **Idempotent Migrations**: All migration scripts use `IF NOT EXISTS` or schema introspection to ensure safety across environments.

---

## 2. Entity Relational Details

### 2.1 Student Foundations (Phase 1 — Implemented & Active)
#### `student_profiles`
- `id` (VARCHAR(36), PK)
- `user_id` (VARCHAR(36), FK -> users.id, UNIQUE, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `target_role` (VARCHAR(100), NULL)
- `target_company` (VARCHAR(100), NULL)
- `skills` (JSON, DEFAULT '[]')
- `education_level` (VARCHAR(50), NULL)
- `graduation_year` (INT, NULL)
- `created_at`, `updated_at` (DATETIME)
- *Indexes*: `(user_id)`, `(organization_id)`

#### `student_resumes`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `version` (INT, DEFAULT 1)
- `file_path` (VARCHAR(500), NOT NULL)
- `file_name` (VARCHAR(255), NOT NULL)
- `file_size` (INT, NOT NULL)
- `mime_type` (VARCHAR(100), NOT NULL)
- `raw_text` (LONGTEXT, NULL)
- `extracted_skills` (JSON, DEFAULT '[]')
- `strengths` (JSON, DEFAULT '[]')
- `weaknesses` (JSON, DEFAULT '[]')
- `ats_score` (INT, DEFAULT 0)
- `analysis_json` (JSON, NULL)
- `created_at`, `updated_at` (DATETIME)
- *Indexes*: `(student_id)`, `(organization_id)`, `(student_id, version)`

---

### 2.2 Preparation & Roadmap (Phase 3)
#### `student_roadmaps`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `target_role` (VARCHAR(100), NOT NULL)
- `title` (VARCHAR(255), NOT NULL)
- `summary` (TEXT, NULL)
- `total_weeks` (INT, DEFAULT 4)
- `current_week` (INT, DEFAULT 1)
- `status` (VARCHAR(30), DEFAULT 'ACTIVE') -- ACTIVE, COMPLETED, ARCHIVED
- `created_at`, `updated_at` (DATETIME)
- *Indexes*: `(student_id, status)`, `(organization_id)`

#### `student_daily_tasks`
- `id` (VARCHAR(36), PK)
- `roadmap_id` (VARCHAR(36), FK -> student_roadmaps.id, NOT NULL)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `week_number` (INT, NOT NULL)
- `day_number` (INT, NOT NULL)
- `title` (VARCHAR(255), NOT NULL)
- `description` (TEXT, NULL)
- `category` (VARCHAR(50), NOT NULL) -- DSA, APTITUDE, SYSTEM_DESIGN, SOFT_SKILLS, RESUME
- `estimated_minutes` (INT, DEFAULT 45)
- `status` (VARCHAR(30), DEFAULT 'PENDING') -- PENDING, IN_PROGRESS, COMPLETED, SKIPPED
- `completed_at` (DATETIME, NULL)
- `created_at`, `updated_at` (DATETIME)
- *Indexes*: `(roadmap_id)`, `(student_id, status)`

---

### 2.3 Practice & Problem Solving (Phase 4)
#### `student_practice_questions`
- `id` (VARCHAR(36), PK)
- `topic` (VARCHAR(100), NOT NULL) -- e.g. "Arrays", "Dynamic Programming", "Quantitative"
- `category` (VARCHAR(50), NOT NULL) -- CODING, APTITUDE
- `difficulty` (VARCHAR(20), NOT NULL) -- EASY, MEDIUM, HARD
- `title` (VARCHAR(255), NOT NULL)
- `description` (TEXT, NOT NULL)
- `options` (JSON, NULL) -- For Aptitude / MCQ questions: [{"key":"A","text":"..."}, ...]
- `correct_answer` (VARCHAR(255), NOT NULL) -- Never sent to client in problem payload
- `starter_code` (JSON, NULL) -- {"python": "...", "javascript": "...", "cpp": "..."}
- `test_cases` (JSON, NOT NULL) -- [{"input":"...","expected_output":"...","is_hidden":false}, ...]
- `created_at` (DATETIME)
- *Indexes*: `(category, topic)`, `(difficulty)`

#### `student_practice_attempts`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `question_id` (VARCHAR(36), FK -> student_practice_questions.id, NOT NULL)
- `code_submitted` (TEXT, NULL)
- `language` (VARCHAR(50), NULL)
- `selected_option` (VARCHAR(255), NULL)
- `is_correct` (BOOLEAN, NOT NULL)
- `tests_passed` (INT, DEFAULT 0)
- `total_tests` (INT, DEFAULT 0)
- `execution_time_ms` (INT, NULL)
- `created_at` (DATETIME)
- *Indexes*: `(student_id, question_id)`, `(organization_id)`

---

### 2.4 Mock Interviews (Phase 5)
#### `student_mock_interviews`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `interview_type` (VARCHAR(50), NOT NULL) -- TECHNICAL, HR, MIXED
- `target_role` (VARCHAR(100), NOT NULL)
- `status` (VARCHAR(30), DEFAULT 'IN_PROGRESS') -- IN_PROGRESS, COMPLETED, ABANDONED
- `score` (INT, DEFAULT 0)
- `feedback_summary` (TEXT, NULL)
- `strengths` (JSON, DEFAULT '[]')
- `improvements` (JSON, DEFAULT '[]')
- `created_at`, `completed_at` (DATETIME)
- *Indexes*: `(student_id)`, `(organization_id)`

#### `student_mock_interview_turns`
- `id` (VARCHAR(36), PK)
- `mock_interview_id` (VARCHAR(36), FK -> student_mock_interviews.id, NOT NULL)
- `turn_number` (INT, NOT NULL)
- `question_text` (TEXT, NOT NULL)
- `student_response` (TEXT, NULL)
- `feedback` (TEXT, NULL)
- `score` (INT, DEFAULT 0)
- `created_at` (DATETIME)
- *Indexes*: `(mock_interview_id, turn_number)`

---

### 2.5 Student Projects (Phase 6)
#### `student_projects`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `title` (VARCHAR(255), NOT NULL)
- `description` (TEXT, NOT NULL)
- `tech_stack` (JSON, DEFAULT '[]')
- `github_url` (VARCHAR(500), NULL)
- `live_url` (VARCHAR(500), NULL)
- `architecture_review` (TEXT, NULL)
- `completeness_score` (INT, DEFAULT 0)
- `suggested_interview_questions` (JSON, DEFAULT '[]')
- `recommendations` (JSON, DEFAULT '[]')
- `created_at`, `updated_at` (DATETIME)
- *Indexes*: `(student_id)`, `(organization_id)`

---

### 2.6 Placement Simulation (Phase 7)
#### `placement_simulations`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `target_role` (VARCHAR(100), NOT NULL)
- `status` (VARCHAR(30), DEFAULT 'IN_PROGRESS') -- IN_PROGRESS, COMPLETED
- `aptitude_score` (INT, DEFAULT 0)
- `coding_score` (INT, DEFAULT 0)
- `technical_interview_score` (INT, DEFAULT 0)
- `hr_interview_score` (INT, DEFAULT 0)
- `overall_score` (INT, DEFAULT 0)
- `report_summary` (TEXT, NULL)
- `strengths` (JSON, DEFAULT '[]')
- `weaknesses` (JSON, DEFAULT '[]')
- `recommended_actions` (JSON, DEFAULT '[]')
- `created_at`, `completed_at` (DATETIME)
- *Indexes*: `(student_id)`, `(organization_id)`

---

### 2.7 Career Copilot (Phase 8)
#### `student_copilot_messages`
- `id` (VARCHAR(36), PK)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `role` (VARCHAR(20), NOT NULL) -- 'user' or 'assistant'
- `content` (TEXT, NOT NULL)
- `context_metadata` (JSON, NULL)
- `created_at` (DATETIME)
- *Indexes*: `(student_id, created_at)`

---

### 2.8 College Placement Drives (Phase 9)
#### `placement_drives`
- `id` (VARCHAR(36), PK)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `company_name` (VARCHAR(255), NOT NULL)
- `role_title` (VARCHAR(255), NOT NULL)
- `description` (TEXT, NOT NULL)
- `eligibility_criteria` (TEXT, NULL)
- `minimum_cgpa` (FLOAT, DEFAULT 0.0)
- `required_skills` (JSON, DEFAULT '[]')
- `package_lpa` (FLOAT, NULL)
- `application_deadline` (DATETIME, NOT NULL)
- `status` (VARCHAR(30), DEFAULT 'OPEN') -- OPEN, CLOSED, COMPLETED
- `created_at`, `updated_at` (DATETIME)
- *Indexes*: `(organization_id, status)`

#### `placement_drive_applications`
- `id` (VARCHAR(36), PK)
- `drive_id` (VARCHAR(36), FK -> placement_drives.id, NOT NULL)
- `student_id` (VARCHAR(36), FK -> student_profiles.id, NOT NULL)
- `organization_id` (VARCHAR(36), FK -> organizations.id, NOT NULL)
- `status` (VARCHAR(30), DEFAULT 'APPLIED') -- APPLIED, SHORTLISTED, REJECTED, PLACED
- `applied_at` (DATETIME)
- *Indexes*: `(drive_id, student_id)`, `(student_id)`
