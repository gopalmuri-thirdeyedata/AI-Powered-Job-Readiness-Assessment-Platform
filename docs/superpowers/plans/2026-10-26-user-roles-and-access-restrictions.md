# PrepWin: Correct User Roles and Enforce Access Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct user roles and permissions in PrepWin so that exactly three accounts remain with strictly enforced, non-overlapping access: `admin@thirdeyedata.ai` (ADMIN only), `gopalmuri1919@gmail.com` (STUDENT only), and `mundgodsuprit@gmail.com` (STUDENT only).

**Architecture:** Database roles are corrected directly via atomic SQL updates; unnecessary student profile for admin (Profile ID 230) is removed after zero-dependency verification; backend FastAPI route guards (`get_current_user`, `require_admin_user`, `get_current_student_profile`, `clerk_sync`) are hardened to strictly enforce role boundaries, reject stale or contradictory JWT claims, and block privilege escalation.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy, SQLite (production `backend/hiringai.db` and isolated test databases), pytest, Jose JWT.

**Spec:** User prompt: "PrepWin: Correct User Roles and Enforce Access Restrictions"

## Global Constraints
- Exactly three user accounts must remain: `admin@thirdeyedata.ai`, `gopalmuri1919@gmail.com`, `mundgodsuprit@gmail.com`.
- Final counts: Total users = 3, ADMIN = 1, STUDENT = 2, accounts with both roles = 0.
- Do NOT repeat database cleanup or delete any user accounts or business assessment data.
- Student assessment history and scores for `mundgodsuprit@gmail.com` (3 sessions) must be strictly preserved.
- Automated tests must execute against an isolated test database (via `backend/tests/db_guard.py`) without modifying `backend/hiringai.db`.
- Foreign key checks and database integrity checks must pass with 0 errors.

## Review Focus
1. Gopal attempting to access admin APIs with an old/cached JWT containing `role: "ADMIN"` -> Rejected with HTTP 401 Unauthorized or HTTP 403 Forbidden.
2. Gopal or Suprit attempting to login via `/api/auth/clerk-sync/` with `role_intent: "admin"` -> Rejected with HTTP 403 Forbidden without modifying user role in database.
3. Administrator `admin@thirdeyedata.ai` attempting to call student endpoints (`/api/student/*`, `/api/roleready/student/*`) -> Rejected with HTTP 403 Forbidden.
4. Candidate or unauthenticated requests to protected student or admin endpoints -> Denied with HTTP 401 Unauthorized or HTTP 403 Forbidden.
5. Preserved assessment history for `mundgodsuprit@gmail.com` remains fully queryable via `/api/roleready/student/assessments` and `/api/student/dashboard/unified`.

---

### Task 1: Database Role Correction and Admin StudentProfile Removal

**Files:**
- Modify: `backend/hiringai.db` via execution script `backend/scripts/apply_role_correction.py`
- Test: Verification query script `backend/scripts/verify_db_roles.py`

**Interfaces:**
- Consumes: `users` table, `student_profiles` table, `organization_members` table
- Produces: `gopalmuri1919@gmail.com` role set to `STUDENT`, `admin@thirdeyedata.ai` StudentProfile 230 removed, foreign key integrity intact.

- [ ] **Step 1: Write script to verify 0 dependencies for StudentProfile 230 and execute role correction**

Create `backend/scripts/apply_role_correction.py` to:
1. Confirm Profile ID 230 belongs to `admin@thirdeyedata.ai` (User ID 301).
2. Check every table in `backend/hiringai.db` for columns named `student_profile_id` referencing 230 (must be 0).
3. Execute SQL transaction:
   - `UPDATE users SET role = 'STUDENT', organization_id = 8 WHERE lower(email) = 'gopalmuri1919@gmail.com';`
   - `DELETE FROM student_profiles WHERE id = 230;`
4. Run `PRAGMA foreign_key_check` and `PRAGMA integrity_check`.

- [ ] **Step 2: Run `apply_role_correction.py` and verify success**

Run: `python backend/scripts/apply_role_correction.py`
Expected: Output confirms role updated, profile 230 deleted, 0 foreign key violations, "ok" integrity check.

- [ ] **Step 3: Verify the 3 accounts and their profiles**

Write and run `backend/scripts/verify_db_roles.py` confirming:
- Total user accounts: 3
- `admin@thirdeyedata.ai`: role = ADMIN, organization_id = 8, student_profile = None
- `gopalmuri1919@gmail.com`: role = STUDENT, organization_id = 8, student_profile_id = 298
- `mundgodsuprit@gmail.com`: role = STUDENT, organization_id = 8, student_profile_id = 133
- Total student profiles: 2 (298 and 133)
- Total sessions for Suprit: 3

---

### Task 2: Backend Authorization Guards Hardening

**Files:**
- Modify: `backend/routers/auth.py`
- Modify: `backend/routers/student.py`
- Modify: `backend/routers/roleready.py`

**Interfaces:**
- Consumes: `get_current_user`, `require_admin_user`, `get_current_student_profile`, `_assert_admin_identity`
- Produces: Strict role matching where token claims cannot grant privileges contrary to DB role, and admins cannot access student endpoints.

- [ ] **Step 1: Enforce role consistency in `get_current_user` in `backend/routers/auth.py`**

In `get_current_user`:
- When decoding JWT token:
  If `role_claim == "ADMIN"` and `user.role != models.UserRole.ADMIN`:
    Raise `HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token role is no longer valid. Re-authentication required.")`.
  If `user.role == models.UserRole.ADMIN`:
    `user._token_role = models.UserRole.ADMIN`
  Else:
    `user._token_role = models.UserRole.STUDENT`

- [ ] **Step 2: Enforce strict student role in `get_current_student_profile` in `backend/routers/student.py`**

In `get_current_student_profile`:
- Replace permissive admin check with strict student requirement:
  ```python
  active_role = getattr(current_user, "_token_role", None) or current_user.role
  if active_role != models.UserRole.STUDENT or current_user.role != models.UserRole.STUDENT:
      raise HTTPException(
          status_code=status.HTTP_403_FORBIDDEN,
          detail="Student authorization required."
      )
  ```
- Reject any user without a student profile if they are an admin or non-student.

- [ ] **Step 3: Enforce strict role isolation in `backend/routers/roleready.py`**

In `roleready.py` `get_authorized_session`:
- If `user.role == models.UserRole.ADMIN`:
  Cannot claim student session ownership. Admin can only view recruitment assessment sessions within their authorized organization.

---

### Task 3: Clerk Synchronization and Pre-Auth Hardening

**Files:**
- Modify: `backend/routers/auth.py:221-370` (`clerk_sync` and `_check_email_allowed`)

**Interfaces:**
- Consumes: `ClerkSyncSchema`, `role_intent`
- Produces: Rejection of non-admin accounts when `role_intent == "admin"`; prevention of silent role elevation.

- [ ] **Step 1: Hardening `clerk_sync` against silent admin privilege restoration**

In `clerk_sync`:
- For `role_intent == "admin"`:
  Verify `is_admin` strictly:
  Only grant admin if user email is `admin@thirdeyedata.ai` (or configured platform admin email) OR active member of an organization with admin role.
  If `not is_admin`:
    Immediately raise `HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account has not been provisioned for the PrepWin administrator workspace. Please contact your administrator.")`.
- Do not let `existing_user.role == models.UserRole.ADMIN` auto-escalate if the account is `gopalmuri1919@gmail.com`.
- For `role_intent == "student"`:
  Always issue `STUDENT` token. If the user is `gopalmuri1919@gmail.com` or `mundgodsuprit@gmail.com`, ensure their `role` in the DB remains/is set to `models.UserRole.STUDENT`.

- [ ] **Step 2: Verify `_check_email_allowed`**

Ensure `_check_email_allowed`:
- When `intent == "admin"`: returns `allowed: False` for `gopalmuri1919@gmail.com` and `mundgodsuprit@gmail.com`.
- Returns `allowed: True` with `role: "ADMIN"` only for `admin@thirdeyedata.ai`.
- When `intent == "student"`: returns `allowed: True` with `role: "STUDENT"`.

---

### Task 4: Automated Test Suite

**Files:**
- Create: `backend/tests/test_role_correction_and_access_restrictions.py`
- Consumes: `TestClient`, `tests/db_guard.py`

**Interfaces:**
- Produces: Full regression test verifying all requirements of the prompt on an isolated database.

- [ ] **Step 1: Write test cases in `backend/tests/test_role_correction_and_access_restrictions.py`**

The test file must contain:
1. `test_admin_account_permissions`:
   - `admin@thirdeyedata.ai` logs in successfully via `/api/auth/login/`.
   - `/api/auth/me` returns `role: "ADMIN"`.
   - Admin APIs (`/api/admin/job-roles/`, `/api/admin/batches/`) return 200 OK.
   - Student endpoints (`/api/student/profile`, `/api/roleready/student/assessments`) return 403 Forbidden.
2. `test_gopal_account_permissions`:
   - `gopalmuri1919@gmail.com` logs in as `STUDENT` via `/api/auth/clerk-sync/` with `role_intent="student"`.
   - `/api/auth/me` returns `role: "STUDENT"`.
   - Student dashboard (`/api/student/profile`, `/api/student/dashboard/unified`) returns 200 OK.
   - Admin login (`/api/auth/login/`) rejects Gopal with 403 Forbidden.
   - Admin clerk-sync (`/api/auth/clerk-sync/` with `role_intent="admin"`) rejects Gopal with 403 Forbidden.
   - Direct requests to admin APIs (`/api/admin/job-roles/`, `/api/admin/batches/`) return 403 Forbidden.
   - Stale JWT with `role: "ADMIN"` claim for Gopal returns 401 or 403.
3. `test_suprit_account_permissions_and_history`:
   - `mundgodsuprit@gmail.com` logs in as `STUDENT`.
   - `/api/auth/me` returns `role: "STUDENT"`.
   - Assessment history (`/api/roleready/student/assessments`) returns the 3 sessions with correct scores.
   - Direct requests to admin APIs return 403 Forbidden.
4. `test_security_and_regression`:
   - Unauthenticated requests return 401 Unauthorized.
   - Candidate requests to student/admin routes return 403 Forbidden.
   - Production database `backend/hiringai.db` is never modified during test runs (verified via hash/stat).

- [ ] **Step 2: Run pytest and confirm all tests pass**

Run: `pytest backend/tests/test_role_correction_and_access_restrictions.py -v`
Expected: 100% tests pass.

---

### Task 5: Live API and Database Verification

**Files:**
- Create: `backend/scripts/live_access_verification.py`

**Interfaces:**
- Consumes: Running backend on `http://127.0.0.1:8000`
- Produces: Live HTTP verification report validating the exact 8 requirements in the prompt.

- [ ] **Step 1: Write and run `live_access_verification.py` against `http://127.0.0.1:8000`**

Verify:
- Live login for `admin@thirdeyedata.ai`, `/api/auth/me` -> ADMIN, admin endpoints 200, student endpoints 403.
- Live clerk-sync for `gopalmuri1919@gmail.com` -> STUDENT, `/api/auth/me` -> STUDENT, student endpoints 200, admin login 403, admin endpoints 403, clerk-sync admin intent 403.
- Live clerk-sync for `mundgodsuprit@gmail.com` -> STUDENT, `/api/auth/me` -> STUDENT, 3 assessment sessions returned, admin endpoints 403.
- Unauthenticated requests -> 401.

- [ ] **Step 2: Run PRAGMA checks and account count checks on `backend/hiringai.db`**

Verify:
- Total user accounts: 3 (1 ADMIN, 2 STUDENT).
- Total student profiles: 2.
- `PRAGMA foreign_key_check` returns empty.
- `PRAGMA integrity_check` returns `ok`.
