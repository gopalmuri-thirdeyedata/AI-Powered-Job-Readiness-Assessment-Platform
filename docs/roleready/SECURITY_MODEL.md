# PrepWin — Security Model & Isolation Framework

## 1. Multi-Tenant Organization Isolation
1. **Strict Scoping:** Every recruiter entity (`job_descriptions`, `recruitment_batches`, `candidate_invitations`, `candidates`) includes an indexed `organization_id` column.
2. **Database Query Guards:** Every administrative query in `PrepWin` enforces `WHERE organization_id = :org_id` derived exclusively from the verified Clerk session claims.
3. **Cross-Tenant Prevention:** An admin cannot view, invite, or download reports for candidates outside their tenant organization under any circumstance.

---

## 2. Assessment Integrity & Anti-Tampering
1. **Hidden Test Cases Confidentiality:** Hidden test inputs and expected outputs are never delivered to the client during assessment. Only passing test counts are returned.
2. **Answer Key Protection:** Aptitude answer keys are stripped from question payloads sent to the client.
3. **Cryptographic Invitation Tokens:** Invitations utilize `secrets.token_urlsafe(32)` cryptographically secure tokens. Tokens expire after 7 days or upon single-use completion.
4. **Proctoring Telemetry:** Client continuously monitors:
   - Fullscreen state via `document.fullscreenElement`
   - Tab blur / visibility changes via `visibilitychange`
   - Face presence via continuous video frame landmark checks.
   Violations are submitted with timestamps and recorded in the server assessment dossier.
5. **Rate Limiting & File Upload Validation:** File uploads (Resumes and JDs) are limited to 10MB and restricted to MIME types `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, and plain text.
