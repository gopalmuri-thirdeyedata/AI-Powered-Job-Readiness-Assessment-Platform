# RoleReady — Testing Strategy & Quality Assurance Plan

## 1. Testing Hierarchy
1. **Unit Tests (Backend):**
   - State machine transition rules.
   - Aptitude scoring algorithm & answer key protection.
   - Piston code submission parsing & test evaluation.
   - Prompt generation & LLM fallback handling.
2. **Integration Tests (Backend API):**
   - End-to-end Workflow A (Student session init → Aptitude → Coding → Interview → Final Report).
   - End-to-end Workflow B (Admin bulk upload → Candidate creation → Invite generation → Candidate portal execution).
   - Security tests: Verify HTTP 403 when attempting to access Coding without completing Aptitude.
   - Tenant isolation tests: Verify Admin A cannot access Batch/Candidate data belonging to Org B.
3. **Frontend Verification:**
   - Production bundle build (`npm run build`).
   - Component rendering and state lock reflection.
   - Round transition navigation checks.

---

## 2. Test Execution Command Standards
- Backend test suite: `pytest backend/tests/test_roleready_*.py -v`
- Frontend build check: `npm --prefix frontend run build`
