# Admin–Student Session Isolation & Organization Context Implementation Plan (Verified & Refined)

> **Execution Method:** Native inline execution in small, verified stages with TDD. No auto-commits, no DB migrations, no deletion of user data, and strict preservation of existing Git modifications.

**Goal:** Permanently resolve the Admin–Student identity switching and organization context error in PrepWin, ensuring independent tokens, unpolluted navbar identity, refresh resilience, and secure organization context resolution without removing Clerk or modifying database roles.

---

## 1. Confirmed Root Causes

1. **Shared Clerk Session Pollution in Navbar:**
   `GlobalNavbar.jsx` uses Clerk's `useUser()`. When a student logs in via Clerk in Tab 2, Clerk updates the browser session across the entire origin (`localhost:5173`). In Tab 1, `GlobalNavbar` renders `<UserButton />`, which immediately replaces the Admin's display with Gopal's student avatar, name, and email.
2. **Ambient Clerk User Fallback in `ClerkAdminGuard.jsx` Overwrites `admin_token`:**
   `ClerkAdminGuard.jsx` had a `useEffect` triggered by Clerk's `user`. When `user` changed to Gopal, the guard ran a fallback calling `/api/auth/clerk-sync/` with `role_intent: 'admin'`. Because Gopal's database row has `role: 'ADMIN'` (historical dual account), the backend returned an `ADMIN` JWT for Gopal, overwriting `admin_token`, `token`, and `admin_user` in localStorage.
3. **Missing Organization Context (`prepwin_org_id`):**
   `recruitmentApi.js` expects `localStorage.getItem('prepwin_org_id')` to attach `X-Organization-Id`. However, `prepwin_org_id` was never saved during login or restored on refresh. When Gopal's token (having 0 organization memberships and `organization_id: null`) was sent to `/api/admin/job-roles/`, `_resolve_tenant_context` in the backend threw: `Platform administrators must specify a target organization via 'X-Organization-Id'.`
4. **Shared Logout State:**
   Admin sign-out called `clerk.signOut()`, destroying the student's Clerk session in the other tab. Student logout called `localStorage.removeItem('token')`, clearing shared credentials.
5. **Auto-navigation bypassing login in `Home.jsx`:**
   `openAdminSignIn()` had `if (user) navigate('/admin/dashboard')` without checking if `user` held an admin role or valid `admin_token`.

---

## 2. Mandatory Invariants

- **Invariant 1: Independent portal identity:** Admin portal reflects `admin_user` from `authStorage`; student portal reflects `student_user`. Tab 2 login cannot alter Tab 1 display.
- **Invariant 2: Strict token separation:** Admin requests strictly use `admin_token`; student requests strictly use `student_token`. Ambiguous generic `token` fallbacks removed.
- **Invariant 3: Backend role enforcement:** Only `ADMIN` role access `/api/admin/*`; only `STUDENT` role access `/api/student/*` and `/api/assessment/*`.
- **Invariant 4: Independent logout:** Admin logout clears admin credentials without calling `clerk.signOut()`; student logout clears student credentials and calls `clerk.signOut()` without touching admin storage.
- **Invariant 5: No identity substitution:** Admin guard validates `admin_token` against `/api/auth/me`. Never blindly syncs ambient Clerk active user into admin storage.

---

## 3. Step-by-Step Implementation & Verification Stages

### Stage 1: Centralized Auth Storage Utility (`authStorage.js`)
- **File:** `frontend/src/utils/authStorage.js`
- **Specification:**
  - Admin storage: `admin_token`, `admin_user`, `prepwin_org_id`.
  - Student storage: `student_token`, `student_user`, `student_user_email`, `student_completed_assessment`.
  - Provide safe, type-guarded methods:
    - `getAdminToken()`, `setAdminSession(token, user, orgId)`, `clearAdminSession()`, `getAdminUser()`, `getAdminOrgId()`, `setAdminOrgId(orgId)`
    - `getStudentToken()`, `setStudentSession(token, user, email)`, `clearStudentSession()`, `getStudentUser()`
- **Verification:** Unit test script `scratch/test_auth_storage.cjs` asserting that setting/clearing one session never pollutes the other.

### Stage 2: Backend Organization & Profile Synchronization
- **Files:** `backend/routers/auth.py`, `backend/tests/recruitment_helpers.py`
- **Specification:**
  - In `backend/routers/auth.py`:
    - Ensure `/api/auth/me` always returns `organization_id`, `organization_name`, and `organization_slug` for `ADMIN` users matching their active membership or user anchor.
    - Ensure `/api/auth/clerk-sync/` returns `organization_id` and user object when authenticating an admin.
  - In `backend/tests/recruitment_helpers.py`:
    - Ensure `make_admin` creates platform email prefix when platform admin role is requested so `test_job_role_tenancy.py` passes cleanly.
- **Verification:** Run pytest:
  `pytest backend/tests/test_job_role_tenancy.py backend/tests/test_two_role_architecture.py`

### Stage 3: Decouple `ClerkAdminGuard.jsx` from Ambient Clerk User
- **File:** `frontend/src/components/ClerkAdminGuard.jsx`
- **Specification:**
  - Read `authStorage.getAdminToken()`.
  - If present: validate with `/api/auth/me`.
    - If `role === 'ADMIN'`: save `prepwin_org_id` via `authStorage.setAdminOrgId(profileData.organization_id)` and authorize.
    - If not `ADMIN`: redirect to `/admin/login`.
  - If token absent: redirect to `/admin/login`.
  - **Remove** the ambient Clerk `user` fallback in `useEffect` that called `clerk-sync` with `role_intent='admin'` on any user change.
- **Verification:** Frontend build + verify guard logic.

### Stage 4: Route-Scoped Identity Rendering & Independent Logout in `GlobalNavbar.jsx`
- **File:** `frontend/src/components/GlobalNavbar.jsx`
- **Specification:**
  - If `location.pathname.startsWith('/admin')`:
    - Read admin profile from `authStorage.getAdminUser()`.
    - Display Admin email, organization name, and "Admin" badge.
    - NEVER render Clerk's `<UserButton />` in the admin portal!
    - Render explicit Admin "Sign Out" button calling `authStorage.clearAdminSession()` and navigating to `/admin/login` (without calling `clerk.signOut()`).
  - If on student / public routes:
    - Display student profile or Clerk `<UserButton />`.
    - Student logout calls `authStorage.clearStudentSession()` and `clerk.signOut()`, leaving admin credentials intact.
- **Verification:** Frontend build + manual/browser verification.

### Stage 5: Organization Context in API Clients & Login Flows
- **Files:** `frontend/src/services/recruitmentApi.js`, `frontend/src/components/ClerkAuthModal.jsx`, `frontend/src/pages/Home.jsx`, `frontend/src/hooks/useStudentTaskStatus.js`, `frontend/src/layouts/StudentLayout.jsx`, `frontend/src/services/studentApi.js`
- **Specification:**
  - `recruitmentApi.js`: `adminHeaders()` strictly uses `authStorage.getAdminToken()` and attaches `X-Organization-Id` from `authStorage.getAdminOrgId() || adminUser?.organization_id`.
  - `ClerkAuthModal.jsx`: on admin login success, call `authStorage.setAdminSession(token, user, orgId)`.
  - `Home.jsx`: "Admin Portal" button verifies `authStorage.getAdminToken()` before navigating; never auto-navigates to admin based on Clerk student session.
  - `StudentLayout.jsx` & `studentApi.js`: student logout calls `authStorage.clearStudentSession()`.
- **Verification:** Frontend build (`npm run build`).

### Stage 6: Automated End-to-End Regression Test Suite
- **File:** `backend/tests/test_admin_student_session_isolation.py`
- **Specification:** Automated test suite exercising:
  - Test A: Exact reproduction sequence (`admin@thirdeyedata.ai` login -> Gopal student login -> admin refresh -> verify admin identity & Org 8 access).
  - Test B: Reverse order login (student -> admin -> both independent).
  - Test C: Token isolation (cross-portal token rejection).
  - Test D: Role authorization (403 for cross-role access).
  - Test E: Logout independence.
  - Test F: Organization context resolution & `X-Organization-Id` validation.
  - Test G: Dual identity handling (Gopal as student vs admin).
  - Test H: Refresh resilience and concurrency.
- **Verification:** Pytest run: `pytest backend/tests/test_admin_student_session_isolation.py`.

### Stage 7: End-to-End Browser Reproduction Verification
- **Specification:** Using browser subagent or manual steps:
  1. Open `/admin/dashboard`, log in as `admin@thirdeyedata.ai`. Verify Org 8 and admin identity.
  2. In student portal (`/assessment/setup`), log in as Gopal. Verify student setup loads.
  3. Return to admin portal, refresh page. Verify admin identity remains `admin@thirdeyedata.ai`, Org 8 data loads, no `X-Organization-Id` error.
  4. Verify student portal refresh retains Gopal.
