# HiringAI Student Career Platform — API Specification & Design

## 1. Authentication & Scoping Conventions
All student endpoints require a Bearer JWT passed via the `Authorization: Bearer <token>` HTTP header.
The token claims payload is:
```json
{
  "sub": "user_uuid_here",
  "role": "STUDENT",
  "org_id": "organization_uuid_here",
  "exp": 1728500000
}
```
All student routes resolve the student record via dependency injection (`get_current_student`), verifying that `user_id` and `organization_id` strictly align.

---

## 2. API Endpoints Catalog

### 2.1 Student Auth & Profile (Phase 1)
- `POST /api/student/auth/register`: Register new student using verified email and college invite code/pre-invitation.
- `POST /api/student/auth/login`: Student credentials authentication.
- `GET /api/student/profile`: Retrieve student profile, skills, education, target role.
- `PUT /api/student/profile`: Update target role, target company, skills, graduation details.
- `POST /api/student/resume/upload`: Upload PDF/DOCX resume, execute 9-dimension extraction.
- `GET /api/student/resume/latest`: Retrieve active resume analysis and scores.
- `GET /api/student/readiness`: Retrieve modular Placement Readiness breakdown.

### 2.2 Skill Intelligence & Gap Analysis (Phase 2)
- `GET /api/student/target-roles`: List standardized career target roles and required skills.
- `GET /api/student/skill-gap`: Retrieve gap analysis for student's current target role.
  - *Response*:
    ```json
    {
      "target_role": "Full Stack Developer",
      "required_skills": ["React", "Node.js", "SQL", "Git"],
      "preferred_skills": ["Docker", "GraphQL", "TypeScript"],
      "matched_skills": ["React", "SQL", "Git"],
      "missing_required": ["Node.js"],
      "missing_preferred": ["Docker", "GraphQL"],
      "match_percentage": 75.0,
      "recommendations": ["Focus on Node.js REST API fundamentals this week."]
    }
    ```

### 2.3 Preparation Roadmap & Daily Tasks (Phase 3)
- `GET /api/student/roadmap`: Retrieve active preparation roadmap with weekly modules.
- `POST /api/student/roadmap/generate`: Generate or regenerate structured roadmap based on current skill gaps.
- `PATCH /api/student/daily-tasks/{task_id}`: Update task status (`IN_PROGRESS`, `COMPLETED`, `SKIPPED`).

### 2.4 Practice Environment (Phase 4)
- `GET /api/student/practice/topics`: List available practice topics with completion stats.
- `GET /api/student/practice/questions?topic={topic}&category={category}`: Retrieve practice questions (omits hidden tests and answer keys).
- `POST /api/student/practice/submit`: Submit code or aptitude selection for server-side evaluation.
  - *Request*:
    ```json
    {
      "question_id": "uuid",
      "code": "def solution()...",
      "language": "python",
      "selected_option": null
    }
    ```
  - *Response*:
    ```json
    {
      "is_correct": true,
      "tests_passed": 5,
      "total_tests": 5,
      "feedback": "All public and hidden test cases passed successfully!"
    }
    ```

### 2.5 Student Mock Interviews (Phase 5)
- `POST /api/student/mock-interview/start`: Initialize a new mock interview session (`TECHNICAL`, `HR`).
- `POST /api/student/mock-interview/{id}/turn`: Submit student response to the current question; returns AI evaluation and next question.
- `POST /api/student/mock-interview/{id}/complete`: Finalize interview and generate STAR-method feedback summary.

### 2.6 Project Analyzer (Phase 6)
- `GET /api/student/projects`: List student projects with architecture review scores.
- `POST /api/student/projects`: Add a project (title, tech stack, description, github URL).
- `POST /api/student/projects/{id}/analyze`: Run AI project evaluation and generate anticipated interview questions.

### 2.7 Placement Simulation (Phase 7)
- `POST /api/student/simulation/start`: Begin simulated placement test.
- `POST /api/student/simulation/{id}/submit-round`: Submit scores for aptitude, coding, or interview rounds.
- `GET /api/student/simulation/{id}/report`: Retrieve comprehensive simulation score report and weakness diagnostic.

### 2.8 Career Copilot (Phase 8)
- `GET /api/student/copilot/history`: Retrieve recent chat message thread.
- `POST /api/student/copilot/chat`: Send prompt to AI Career Copilot, grounded in student resume and readiness state.

### 2.9 College Placement Officer APIs (Phase 9)
- `GET /api/college/overview`: Cohort analytics, average readiness score, student count, at-risk count.
- `GET /api/college/students`: Paginated roster of college students with resume and readiness status.
- `GET /api/college/drives`: List placement drives organized by the college.
- `POST /api/college/drives`: Create new on-campus placement drive.
- `GET /api/college/drives/{id}/applications`: View applicants and eligibility statuses.

---

## 3. Error Handling & HTTP Status Codes
- `200 OK`: Request succeeded.
- `201 Created`: Entity created successfully.
- `400 Bad Request`: Payload validation failed or invalid state transition.
- `401 Unauthorized`: Missing or invalid JWT credentials.
- `403 Forbidden`: Authenticated student attempting to access another student's or organization's data.
- `404 Not Found`: Entity not found within the authorized tenant scope.
- `422 Unprocessable Entity`: Pydantic validation failure.
- `500 Internal Server Error`: Server exception with sanitized client message.
