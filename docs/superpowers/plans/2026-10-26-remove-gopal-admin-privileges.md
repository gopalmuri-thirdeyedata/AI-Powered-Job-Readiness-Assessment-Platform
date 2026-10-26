# Permanently Remove Administrator Privileges from Gopal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the PrepWin application so that `gopalmuri1919@gmail.com` is exclusively a normal `STUDENT` account with zero administrator privileges, memberships, provisioning, or legacy dual-identity logic, while preserving its student profile, credentials, Clerk identity, and the existing access for the primary administrator (`admin@thirdeyedata.ai`) and other student (`mundgodsuprit@gmail.com`).

**Architecture:** A verified safety database backup is generated first. The database `users` and `organization_members` tables are audited and confirmed free of any administrator bindings for Gopal. In the application codebase, any legacy references or dual-identity assumptions regarding Gopal are expunged from tests, documentation, and provisioning pathways, ensuring the standard role system (`users.role = 'STUDENT'` and absence of active `organization_members` admin record) authoritatively governs authentication and authorization. Comprehensive regression test suites on isolated test databases verify all access boundaries across all three accounts.

**Tech Stack:** Python 3.11, SQLite 3 (`backend/hiringai.db`), SQLAlchemy ORM, FastAPI, Pytest, Python-Jose (JWT), Passlib (Bcrypt).

**Spec:** User request: "Objective: Permanently Remove Administrator Privileges from Gopal"

## Global Constraints

- Never delete any of the three user accounts (`admin@thirdeyedata.ai`, `gopalmuri1919@gmail.com`, `mundgodsuprit@gmail.com`).
- Never delete student profiles (`id=298` for Gopal, `id=133` for Suprit), assessment history (Suprit's 3 sessions, 9 attempts), or required organization data (Org 8).
- Do not replace administrator access with a hardcoded negative exception or account-specific block; Gopal must be a standard student under the generalized role system.
- Back up `backend/hiringai.db` before any persistent changes and verify backup readability.
- The authoritative database state must remain: Total Users = 3, ADMIN accounts = 1, STUDENT accounts = 2.
- Preserve full platform and tenant administration permissions for `admin@thirdeyedata.ai`.
- Verify real application behavior through automated tests using isolated test databases.

## Review Focus

1. **Dual-Identity Legacy Infiltration:** Verify that no code path in `auth.py`, `clerk_sync()`, or `organization.py` allows Gopal to switch role intent or be invited as an admin without standard permission checks.
2. **Clerk Synchronization Re-Escalation:** Verify that calling `/api/auth/clerk-sync/` with `role_intent='admin'` or without intent for `gopalmuri1919@gmail.com` strictly returns 403 Forbidden or issues a `STUDENT` token.
3. **Stale JWT Revocation:** Verify that a stale or forged JWT claiming `role: "ADMIN"` for `gopalmuri1919@gmail.com` is rejected with 401 Unauthorized via `get_current_user`.
4. **Primary Admin Non-Regression:** Verify that `admin@thirdeyedata.ai` login and admin endpoints remain 100% operational (200 OK).
5. **Secondary Student Non-Regression:** Verify that `mundgodsuprit@gmail.com` student endpoints and assessment history remain intact and admin endpoints return 403 Forbidden.

---

### Task 1: Database Safety Backup and Invariant Verification

**Files:**
- Create: `backend/backups/hiringai_pre_gopal_role_correction_<timestamp>.db`
- Script: `scratch/backup_and_verify_baseline.py`

**Interfaces:**
- Consumes: `backend/hiringai.db`
- Produces: Timestamped verified SQLite backup in `backend/backups/` and baseline audit confirmation.

- [ ] **Step 1: Write backup and baseline verification script**

Create `scratch/backup_and_verify_baseline.py` to:
1. Connect to `backend/hiringai.db`.
2. Verify table counts and account distribution.
3. Create a byte-identical copy in `backend/backups/hiringai_pre_gopal_role_correction_<timestamp>.db`.
4. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on the backup.
5. Verify Gopal's account in DB: `role == 'STUDENT'`, 0 rows in `organization_members`, `StudentProfile` 298 exists.

- [ ] **Step 2: Execute backup and baseline verification script**

Run: `& "d:\PrepWin\PrepWin\backend\venv\Scripts\python.exe" scratch/backup_and_verify_baseline.py`
Expected: Backup created, integrity check `ok`, 0 foreign key violations, baseline validated.

---

### Task 2: Codebase Audit & Removal of Legacy Dual-Identity Logic and References

**Files:**
- Modify: `backend/tests/test_two_role_architecture.py` (Update docstrings and comments referencing Gopal as dual identity)
- Modify: `backend/tests/test_admin_student_session_isolation.py` (Clarify Test E that Gopal is standard student, not dual identity)
- Modify: `backend/tests/test_role_correction_and_access_restrictions.py` (Fix slug conflict in fixture and ensure comprehensive Gopal student tests)

**Interfaces:**
- Consumes: Test suites and router definitions
- Produces: Codebase completely cleansed of any suggestion that Gopal possesses dual-identity or special admin provisioning.

- [ ] **Step 1: Update `backend/tests/test_two_role_architecture.py`**

Remove the historical reference in docstring (line 12):
```diff
- 4. Dual-Identity Isolation:
-    - Accounts with dual identity (e.g. gopalmuri1919@gmail.com) receive role strictly matching role_intent.
+ 4. Dual-Identity Isolation:
+    - Test accounts provisioned with multiple roles receive role strictly matching role_intent.
```

- [ ] **Step 2: Update `backend/tests/test_admin_student_session_isolation.py`**

Update docstrings in Test E (lines 12 and 230-237) to eliminate legacy dual-identity terminology:
```diff
- - Test E: Dual-identity account handling (Gopal as student gets STUDENT token and profile; rejected on admin tools without org membership).
+ - Test E: Standard Student Account Isolation (Gopal as standard student receives STUDENT token and profile; strictly rejected on admin recruitment tools).
```

- [ ] **Step 3: Update `backend/tests/test_role_correction_and_access_restrictions.py`**

Fix the organization fixture setup to query by `(id == 8) | (slug == 'roleready-students')` to prevent slug collision during multi-suite runs:
```python
org = db.query(models.Organization).filter(
    (models.Organization.id == 8) | (models.Organization.slug == "roleready-students")
).first()
if not org:
    org = models.Organization(
        id=8,
        name="RoleReady Student Assessment Hub",
        slug="roleready-students",
        status="active"
    )
    db.add(org)
    db.commit()
```
Add explicit test asserting Gopal has NO admin memberships or privileges:
```python
def test_gopal_has_no_admin_memberships_or_privileges(setup_three_accounts):
    """Verify Gopal has zero records in organization_members and zero admin roles."""
    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter_by(email="gopalmuri1919@gmail.com").first()
        assert user.role == "STUDENT"
        memberships = db.query(models.OrganizationMember).filter_by(user_id=user.id).all()
        assert len(memberships) == 0, f"Expected 0 memberships, found: {memberships}"
    finally:
        db.close()
```

---

### Task 3: Execution of Test Matrix on Isolated Test Databases

**Files:**
- Test: `backend/tests/test_role_correction_and_access_restrictions.py`
- Test: `backend/tests/test_two_role_architecture.py`
- Test: `backend/tests/test_admin_student_session_isolation.py`

**Interfaces:**
- Consumes: Test files using isolated temporary SQLite databases (via `db_guard.py` throwaway fixtures).
- Produces: Passing test reports for all three accounts.

- [ ] **Step 1: Run `test_role_correction_and_access_restrictions.py`**

Run: `& "d:\PrepWin\PrepWin\backend\venv\Scripts\python.exe" -m pytest tests/test_role_correction_and_access_restrictions.py -v`
Expected: 15 passed, 0 failed.

- [ ] **Step 2: Run `test_two_role_architecture.py`**

Run: `& "d:\PrepWin\PrepWin\backend\venv\Scripts\python.exe" -m pytest tests/test_two_role_architecture.py -v`
Expected: 9 passed, 0 failed.

- [ ] **Step 3: Run `test_admin_student_session_isolation.py`**

Run: `& "d:\PrepWin\PrepWin\backend\venv\Scripts\python.exe" -m pytest tests/test_admin_student_session_isolation.py -v`
Expected: All passed, 0 failed.

---

### Task 4: Final Database Verification & Live System Invariant Check

**Files:**
- Script: `scratch/final_audit_verification.py`

**Interfaces:**
- Consumes: Active database `backend/hiringai.db` in read-only mode.
- Produces: Formal validation output matching all requirements in Section 7 of the user specification.

- [ ] **Step 1: Write and run final audit script**

Create `scratch/final_audit_verification.py` to confirm:
1. Total users = 3.
2. ADMIN accounts = 1 (`admin@thirdeyedata.ai`).
3. STUDENT accounts = 2 (`gopalmuri1919@gmail.com`, `mundgodsuprit@gmail.com`).
4. `admin@thirdeyedata.ai`:
   - Role: `ADMIN`
   - Organization Member: Org 8, Role `ADMIN`, Status `active`
   - Student Profile: None
5. `gopalmuri1919@gmail.com`:
   - Role: `STUDENT`
   - Administrator memberships: None (`0`)
   - Administrator provisioning: None (`0`)
   - Special administrator exceptions: None
   - Student Profile: ID `298`, Name `'Gopal'`
6. `mundgodsuprit@gmail.com`:
   - Role: `STUDENT`
   - Administrator privileges: None (`0`)
   - Student Profile: ID `133`, Name `'Suprit Mundagod'`
   - Assessment history: 3 sessions, 9 attempts
7. `PRAGMA foreign_key_check` = 0 violations.
8. `PRAGMA integrity_check` = `ok`.

Run: `& "d:\PrepWin\PrepWin\backend\venv\Scripts\python.exe" scratch/final_audit_verification.py`
Expected: All assertions PASS.

---

### Task 5: Documentation & Audit Report

**Files:**
- Create: `GOPAL_ROLE_CORRECTION_VERIFICATION_REPORT.md`

- [ ] **Step 1: Compile formal verification report**
Document all findings, database queries, test evidence, and confirmation that `gopalmuri1919@gmail.com` is exclusively a normal `STUDENT` account with zero administrator capabilities or special-case logic.
