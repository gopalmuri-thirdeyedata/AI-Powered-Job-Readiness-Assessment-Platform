# HiringAI Student Career Platform — Security Model & Tenant Isolation

## 1. Core Security Tenets
1. **Zero Client Trust for Multi-Tenancy**: The backend never accepts, trusts, or authorizes tenant identity (`organization_id`, `tenant_id`) supplied in client request bodies or query parameters.
2. **Deterministic Ownership Chain**:
   ```
   Organization (College) -> User Account -> Student Profile -> Student Artifacts
   ```
   Every student resource must resolve strictly through this authenticated chain.
3. **Fail-Closed Authorization**: All data queries must explicitly scope to `organization_id` and `student_id`. A missing or mismatched match yields an immediate 403 Forbidden or 404 Not Found.
4. **Data Privacy**: Practice test cases, question answer keys, private interview prompts, and recruiter candidate data are kept strictly confidential from students.

---

## 2. Student Provisioning & Organization Security

### 2.1 The Two Authorized Enrollment Models
- **Model A: College Pre-Invitation**:
  An administrator creates an `OrganizationMember` with `role="STUDENT"` and the student's email address. When the student registers, the backend matches their verified email to the pending membership.
- **Model B: Verified College Slug/Invite Code**:
  If registering independently, the student must provide a valid `invite_code` that corresponds to an existing, active `Organization.slug` in the database. The backend validates this on the server. If invalid, registration fails with `400 Bad Request`.

### 2.2 IDOR Defenses
Every endpoint receiving an entity ID (e.g. `PATCH /api/student/daily-tasks/{task_id}`, `GET /api/student/projects/{project_id}`) executes:
```python
task = db.query(StudentDailyTask).filter(
    StudentDailyTask.id == task_id,
    StudentDailyTask.student_id == current_student.id,
    StudentDailyTask.organization_id == current_student.organization_id
).first()
if not task:
    raise HTTPException(status_code=404, detail="Task not found or access denied")
```
This guarantees students cannot modify or read peers' roadmap tasks, resumes, practice attempts, or interview transcripts.

---

## 3. Resume File Upload Security
1. **MIME & Extension Validation**: Only `.pdf` and `.docx` extensions and MIME types `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` are accepted.
2. **File Size Limits**: Enforce strict 10 MB maximum file size limit.
3. **Safe Storage**: Files are saved with cryptographically random UUID names into an isolated directory structure (`media/resumes/{org_id}/{student_id}/`). Directory traversal attempts (`../`) are stripped.
4. **Authorization on File Download**: Resumes can only be downloaded by the owning student or authorized college administrators within the same organization.

---

## 4. Hidden Test Case & Answer Key Confidentiality
In Phase 4 (Practice) and Phase 7 (Placement Simulation):
1. **Public vs. Hidden Test Cases**: Practice problems contain both public and hidden test cases. When the client fetches questions, hidden test cases (`is_hidden: true`) and correct answer keys for MCQs are stripped from the response payload before serializing JSON.
2. **Server-Side Evaluation**: Code execution and test verification occur strictly inside the backend sandbox (Judge0). The student UI receives only aggregate pass/fail counts and public test output, never hidden test inputs or expected outputs.

---

## 5. AI Guardrails & Prompt Injection Protection
1. **System Prompt Confidentiality**: AI instructions and rubrics are maintained exclusively server-side in Python services.
2. **Input Sanitization**: User resumes, code, and chat responses are treated as untrusted strings and wrapped within structured boundaries.
3. **Zero Hallucination Guard**: As proven in `student_resume_analyzer.py`, AI analysis outputs require explicit evidence citations and fall back to deterministic extractions if the provider returns invalid JSON.
