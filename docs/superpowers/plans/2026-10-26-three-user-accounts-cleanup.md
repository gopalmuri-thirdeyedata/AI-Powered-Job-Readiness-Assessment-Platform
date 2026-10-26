# Keep Only Three User Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the PrepWin database so that only the three specified accounts (`admin@thirdeyedata.ai`, `gopalmuri1919@gmail.com`, `mundgodsuprit@gmail.com`) remain as active, primary user accounts, removing all 364 unnecessary test, dummy, and duplicate accounts while preserving referential integrity, application configuration, and assessment history.

**Architecture:** A non-destructive pre-cleanup audit and verified SQLite backup are created first. Historical benchmark test data is exported to JSON archive. Unnecessary child dependencies (test JDs, test batches, test candidates, test student profiles, and test organizations) are systematically pruned in foreign-key topological order. Core JDs are reassigned to `admin@thirdeyedata.ai`. Finally, the 364 unnecessary user accounts and 225 test organizations are deleted, leaving only Organization 8 and the 3 designated accounts. Strict verification via SQLite `PRAGMA foreign_key_check`, API endpoint testing, and isolated pytest runs validates the final state.

**Tech Stack:** Python 3.11, SQLite 3 (`backend/hiringai.db`), SQLAlchemy, FastAPI, Pytest, OpenPyXL.

**Spec:** User request: "PrepWin — Keep Only Three User Accounts"

## Global Constraints

- Never rely on hardcoded user IDs; locate the three primary accounts dynamically by lowercase email.
- Do not execute destructive operations before creating and verifying a readable timestamped backup.
- Never disable SQLite foreign keys (`PRAGMA foreign_keys = ON` must be preserved throughout).
- Do not modify or delete the three required accounts or their credentials, roles, or profiles.
- Preserve student `mundgodsuprit@gmail.com`'s assessment history (3 sessions in Org 8).
- Preserve Organization 8 ("RoleReady Student Assessment Hub") and standard role template Job Descriptions.
- The final database `users` table MUST contain exactly 3 rows.

## Review Focus

1. **Foreign Key Blocker on JDs/Batches:** `job_descriptions.created_by` has `ON DELETE NO ACTION`. If not reassigned or pruned with test orgs first, user deletion will fail with `FOREIGN KEY constraint failed`.
2. **Student Assessment History Loss:** Deleting rows in `roleready_sessions` or `roleready_round_attempts` must specifically exclude StudentProfile ID 133 (`mundgodsuprit@gmail.com`).
3. **Platform Admin Organization Context:** `admin@thirdeyedata.ai` must maintain its `ADMIN` membership in Org 8 (`organization_members`).
4. **Dual-Identity Administrator Preservation:** `gopalmuri1919@gmail.com` must retain StudentProfile 298 without an organization constraint so platform administrator dual-identity workflows function seamlessly.
5. **Test Database Re-Pollution:** Pytest runs must continue utilizing `tests/db_guard.py` throwaway SQLite databases so test execution never reinjects dummy accounts into the cleaned database.

---

### Task 1: Pre-Cleanup Checks, Backup Creation & Archival

**Files:**
- Create: `backend/backups/hiringai_pre_three_account_cleanup_<timestamp>.db`
- Create: `backend/backups/archived_test_data_<timestamp>.json`
- Script: `scratch/run_pre_cleanup_and_backup.py`

**Interfaces:**
- Produces: Verified SQLite backup file and JSON archive of historical test benchmark data.

- [ ] **Step 1: Write pre-cleanup check and backup script**
  Write `scratch/run_pre_cleanup_and_backup.py` to:
  1. Dynamically locate by email: `admin@thirdeyedata.ai`, `gopalmuri1919@gmail.com`, `mundgodsuprit@gmail.com`.
  2. Verify their IDs, roles, student profiles, and memberships.
  3. Create timestamped database backup in `backend/backups/`.
  4. Perform read-verification and `PRAGMA integrity_check` on the backup.
  5. Export historical evaluation sessions (Jordan Lee 958 sessions, round attempts, resume corpus) to timestamped JSON archive.

- [ ] **Step 2: Execute backup and verification script**
  Run: `python scratch/run_pre_cleanup_and_backup.py`
  Expected: Backup verified with `integrity_check == ok`, row counts match source DB.

- [ ] **Step 3: Verify backup file existence and readability**
  Run: `python -c "import sqlite3, os; ..."` to verify backup opens and queries cleanly.

---

### Task 2: Data Dependency Migration & Pruning Preparation

**Files:**
- Script: `scratch/prepare_dependency_cleanup.py`

**Interfaces:**
- Consumes: `backend/hiringai.db` with 367 users, 226 organizations, 151 JDs.
- Produces: Reassigned core JDs, pruned test recruitment records, and isolated Org 8.

- [ ] **Step 1: Write dependency migration and pruning script**
  Write `scratch/prepare_dependency_cleanup.py` to:
  1. Reassign core Job Descriptions in Org 1 and Org 8 so `created_by` points to `admin@thirdeyedata.ai`.
  2. Delete test Job Descriptions belonging to test organizations (`RW Org *`, Org 9).
  3. Delete test recruitment batches and invitations in test organizations.
  4. Delete test candidate records (Candidates 1–48) while preserving zero FK leaks.
  5. Delete test student career hub data (mock interviews, simulations, practice attempts, projects, resumes, drive applications) for non-preserved profiles, strictly excluding StudentProfile 133 (`mundgodsuprit@gmail.com`).
  6. Delete test `roleready_sessions` and `roleready_round_attempts` for non-preserved student profiles.
  7. Delete test student profiles (132 profiles), retaining only Profiles 230, 298, and 133.
  8. Delete test activity logs and test global settings not belonging to `admin@thirdeyedata.ai`.
  9. Delete test organization memberships (218 rows), retaining User 301's membership in Org 8.
  10. Delete 225 test organizations, preserving Organization 8 ("RoleReady Student Assessment Hub").

- [ ] **Step 2: Run dependency cleanup in a transaction with verification**
  Run: `python scratch/prepare_dependency_cleanup.py`
  Expected: All child entities pruned with zero foreign key violations; Org 8 and 3 profiles preserved.

---

### Task 3: Removal of Unnecessary User Accounts

**Files:**
- Script: `scratch/execute_user_account_cleanup.py`

**Interfaces:**
- Consumes: Database with pruned child dependencies.
- Produces: `users` table containing exactly 3 rows.

- [ ] **Step 1: Write user account cleanup script**
  Write `scratch/execute_user_account_cleanup.py` to:
  1. Locate the 3 accounts by email dynamically (`admin@thirdeyedata.ai`, `gopalmuri1919@gmail.com`, `mundgodsuprit@gmail.com`).
  2. Execute `DELETE FROM users WHERE lower(email) NOT IN ('admin@thirdeyedata.ai', 'gopalmuri1919@gmail.com', 'mundgodsuprit@gmail.com');` inside a transaction.
  3. Run `PRAGMA foreign_key_check;` immediately after deletion to ensure zero FK violations.
  4. Assert `SELECT COUNT(*) FROM users` is exactly 3.

- [ ] **Step 2: Execute user account cleanup**
  Run: `python scratch/execute_user_account_cleanup.py`
  Expected: 364 user rows deleted; exactly 3 user rows remain; FK check returns 0 errors.

---

### Task 4: Post-Cleanup Integrity & Authentication Validation

**Files:**
- Script: `scratch/validate_three_accounts.py`
- Test: `backend/tests/test_database_isolation.py`

**Interfaces:**
- Consumes: Cleaned database and running backend service.
- Produces: Verification logs confirming database integrity, account access, and assessment history.

- [ ] **Step 1: Write comprehensive validation script**
  Write `scratch/validate_three_accounts.py` to verify:
  1. Exact user count: `SELECT COUNT(*) FROM users` == 3.
  2. The 3 user records: email, role, active status (`is_active = 1`), Clerk ID.
  3. Student assessment history: `mundgodsuprit@gmail.com` has 3 RoleReady sessions with completed rounds and score data.
  4. Organization isolation: Organization 8 exists, slug `roleready-students`, `admin@thirdeyedata.ai` is sole member (`ADMIN`).
  5. `PRAGMA foreign_key_check;` returns 0 violations.
  6. `PRAGMA integrity_check;` returns `ok`.
  7. HTTP authentication testing against the running backend daemon (`http://127.0.0.1:8000`):
     - Admin login / token generation for `admin@thirdeyedata.ai`
     - Admin token generation for `gopalmuri1919@gmail.com`
     - Student token generation for `mundgodsuprit@gmail.com`
     - Verify `/api/auth/me` returns 200 OK for each.
     - Verify `/api/roleready/student/assessments` returns student assessment history.

- [ ] **Step 2: Execute validation script**
  Run: `python scratch/validate_three_accounts.py`
  Expected: All checks pass.

- [ ] **Step 3: Run isolated pytest suite**
  Run: `& "d:\PrepWin\PrepWin\backend\venv\Scripts\python.exe" -m pytest tests/test_database_isolation.py tests/test_admin_student_session_isolation.py -v`
  Expected: All tests pass against the isolated test database, confirming no regression.

---

### Task 5: Final Report Generation

**Files:**
- Create: `PrepWin_Final_Three_Account_Cleanup_Report.md` / artifact summary

- [ ] **Step 1: Compile the final deliverable report**
  Include:
  - Account count before (367) and after (3).
  - Exact details of the 3 preserved accounts.
  - Number of accounts deleted (364).
  - Number of organizations deleted (225) and preserved (1).
  - Number of dependent records pruned / reassigned / archived.
  - Backup location, timestamp, and verification status.
  - Database integrity results and authentication test results.
