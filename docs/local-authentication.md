# Local authentication (Clerk removed)

PrepWin authenticates users itself with **email + password**. There is no external identity provider and no public sign-up:
accounts are created only by an authenticated administrator (Admin Dashboard -> User Management).

## How it works

| Concern | Implementation |
|---|---|
| Login | `POST /api/auth/login/` (one endpoint and one login page for Admin and Student). Email is normalized, the password is verified against its bcrypt (cost 12) hash, the account must be active. The **role and redirect come from the stored account**, never from the request. |
| Session | Opaque random value in an **HttpOnly** cookie `prepwin_session` (`SameSite=Lax`, `Secure` in production). Only its SHA-256 is stored in `auth_sessions`. Absolute lifetime 12 h, idle timeout 120 min (`SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES`). Nothing secret is kept in localStorage / sessionStorage. |
| Rotation / revocation | A new session id is issued at every login (a presented session is revoked). Logout, password change, admin password replacement and deactivation revoke sessions immediately. |
| CSRF | Cookie-authenticated `POST/PUT/PATCH/DELETE` must send the per-session `X-CSRF-Token` (returned by login and `GET /api/auth/me`). The browser client adds it automatically. |
| Rate limiting | Failed logins are counted per (email, client), per client and per email in a 15-minute window; over the limit the API answers `429` with `Retry-After`. In-process memory: with several workers keep an nginx `limit_req` on `/api/auth/login/`. |
| Errors | Unknown email, wrong password, internal/candidate accounts all return the same `401 Invalid email or password.` |
| Authorization | Enforced server-side on every API (`routers/auth.py`: `get_current_user`, `require_admin_user`, tenant resolution). Endpoints that authenticate on their own (RoleReady sessions, proctoring) use the same cookie resolver. |
| API clients / candidates | `Authorization: Bearer <signed JWT>` is still accepted (the candidate portal's shadow accounts and programmatic clients); the browser Admin/Student UI no longer uses or stores it. An explicit invalid Bearer value is rejected, never replaced by the cookie. |

## Roles (SUPER_ADMIN > ADMIN > STUDENT)

| Action | SUPER_ADMIN | ADMIN | STUDENT |
|---|---|---|---|
| Create Student | yes | yes | no |
| Create Admin | yes | **no** | no |
| Create Super Admin | yes | **no** | no |
| Manage (edit / activate / deactivate / replace password) | every account in the organization | Students only | no |
| Delete a Student account (permanent) | yes | yes (own organization) | no |
| Delete an Admin / Super Admin account | **no** | **no** | no |
| Change any account's role (including their own) | **no API exists** | no | no |
| Super Admin / platform APIs (`/api/platform/*`) | yes | no (403) | no (403) |

* Enforced in `routers/users.py` (`CREATABLE_ROLES` / `MANAGEABLE_ROLES`), `routers/auth.py` (`require_platform_admin`, `_assert_admin_identity`) and the legacy
  `routers/organization.py` member endpoints. The UI hides what a role cannot do, but the server is the boundary.
* Platform scope is the stored `SUPER_ADMIN` role. It is no longer inferred from e-mail patterns such as `platform.*` / `pa_*`.
* A signed Bearer token that claims a higher role than the database row is rejected; cookie sessions always use the stored role.
* `UserRole` aliases: `PLATFORM_ADMIN` -> `SUPER_ADMIN`; `ORGANIZATION_ADMIN`, `HR`, `RECRUITER`, `HR_ADMIN`, `INTERVIEWER` -> `ADMIN`; `CANDIDATE` is the internal
  shadow account of a candidate invitation and can never sign in with a password.
* Initial Super Admin: `admin@thirdeyedata.ai`, provisioned by `python migrate_super_admin.py --execute` (dry run by default; backup first; idempotent; classifies
  legacy admin roles to ADMIN; anything else with a platform-level or unknown role is printed for MANUAL REVIEW and left unchanged).

## Admin-managed accounts

`/api/admin/users` (admin only, tenant-scoped; every call re-checks the caller on the server):

* `GET /` list (search `q` by name/email, `role`, `is_active`, paging) - `POST /` create (`role` ADMIN|STUDENT, `full_name`, `email`, `password`, optional `phone`) -
  `GET /{id}` - `PATCH /{id}` (name, phone only) - `POST /{id}/activate|deactivate` - `POST /{id}/reset-password`.
* Creating a Student also creates the StudentProfile; creating an Admin also creates the organization membership - one transaction.
* Role cannot be changed by any API; nobody can deactivate themselves or the last active administrator; platform-administrator identities
  (`admin@thirdeyedata.ai`, `platform.*`, `pa.*`, ...) cannot be created or managed by organization admins.
* Passwords are never returned (create, list, detail) and the UI never shows one again after creation.

### Deleting a student (`DELETE /api/admin/users/{id}?confirm_email=<the student's e-mail>`)

Permanent, students only, own organization only (another organization's id is a plain 404; an Admin / Super Admin target is a 403 for every caller). The
e-mail confirmation must match the stored address. One transaction (`services/student_deletion.py`); any failure rolls everything back.

* **Deleted:** the login (user, sessions, memberships, retained credentials), the student profile and everything keyed by it (resumes, roadmap, tasks, practice
  attempts, mock interviews, projects, placement simulations, copilot chat, drive applications, self-assessment attempts + rounds + feedback), assessment
  invitations, shared-link registrations (name / phone / e-mail) with their attempts (including archived retaken ones), reviews and reports, notifications, legacy
  assessments owned by the account, and the uploaded resume / JD files (after the commit, only inside `backend/media`, and never a file another row still uses).
* **Retained (audit):** `activity_logs` rows are kept; the e-mail in them becomes `deleted-user:<id>` and the student is detached as actor. One new
  `student_account_deleted` row records who deleted it, when, the row counts and the SHA-256 of the e-mail (no address).
* **Not touched, and reported in the response and the audit row:** e-mail-keyed recruiter records never linked to the account (`candidates`, accountless
  registrations, assessments with only a `candidate_email`) - nothing proves they belong to this account.
* SQLite does not enforce foreign keys here, so the cleanup is explicit and ordered; a table that references users / student profiles without a policy
  makes the delete fail closed (409) and `tests/test_student_deletion.py` fails.

Password policy: 10-72 bytes, at least two kinds of characters (lower case, upper case, digit, symbol), no leading/trailing space, not a common password, not containing the email name. (Until 2026-10-30 it required upper + lower case + a digit; it was relaxed so that `firstname@college` style initial passwords are accepted.)

## Sharing a student's credentials (User Management -> Share)

A password is stored only as a bcrypt hash and can never be recovered, so Share can only deliver a password the server was handed a
moment ago: at **account creation** or at **Replace password**. That password is kept in `credential_deliveries`, **encrypted**
(Fernet; key derived from `JWT_SECRET_KEY` or set in `CREDENTIAL_DELIVERY_KEY`), bound to the student, and **only when SMTP is configured**.
It is deleted when the e-mail has been accepted by the mail server, when it expires (`CREDENTIAL_SHARE_TTL_MINUTES`, default 120;
`0` = keep nothing), or when the student changes their password. Right before sending it is checked against the account's current hash;
a mismatch deletes it and nothing is sent.

* `POST /api/admin/users/:id/share-credentials` (same organization / role rules as Replace password; **students only**, active accounts
  only). The recipient is the account's e-mail from the database; the request carries nothing. It never changes a password.
* An older student, one already shared, or one whose retention expired answers 409 `PASSWORD_NOT_AVAILABLE`: use **Replace password**,
  then **Share**. Failures (SMTP missing/invalid, connection, TLS, authentication, rejected recipient, temporary failure) are explained
  without internals, change nothing and can be retried until the retained password expires. One send at a time per student.
* Audit: `CREDENTIALS_SHARE_SENT` / `CREDENTIALS_SHARE_FAILED` (actor, student id, time) - never the password or the message.
* **Remaining risk:** an e-mailed password sits in the mail systems of the sender, the recipient and everything in between, outside
  PrepWin's control. Treat it as a temporary credential and ask students to change it at first sign-in
  (the student "Change password" flow already revokes other sessions). Prefer a short retention window.

## Operations

| Task | Command (from `backend/`) |
|---|---|
| Set / replace the platform admin password (no echo, nothing printed) | `python scripts/set_admin_password.py` |
| Migrate an existing database (backup first, then columns + `auth_sessions`, clear Clerk-era placeholder hashes) | `python migrate_local_auth.py --neutralize-placeholders` |
| Smoke-check a running API's login | `PREPWIN_VERIFY_EMAIL=... PREPWIN_VERIFY_PASSWORD=... python scripts/verify_local_login.py --base http://127.0.0.1:8000` |
| Provision the Super Admin / normalize legacy roles (dry run unless `--execute`) | `python migrate_super_admin.py [--execute]` |
| Remove specific student accounts safely (dry run by default, verified backup, one transaction) | `python scripts/remove_student_accounts.py --email a@x.com [--execute]` |

Self-service "forgot password" by email is intentionally absent: SMTP is used only for optional assessment-link invitations and
for the administrator-triggered **Share** of a student's login credentials (`services/email_service.py`), never for self-service
authentication or reset links. Password replacement is
administrator-controlled (User Management -> Replace password) or, for the platform admin, `scripts/set_admin_password.py`.

## What changed from the Clerk design

* Removed: `POST /api/auth/clerk-sync/` (it issued a session for any email without verifying Clerk), `POST|GET /api/auth/check-email/`,
  `POST /api/student/auth/register|login`, `services/clerk_service.py`, the Clerk React provider/components, `@clerk/clerk-react`, all `CLERK_*` /
  `VITE_CLERK_*` configuration and the hard-coded default admin password.
* Kept (inert, never read): the legacy columns `users.clerk_user_id`, `organizations.clerk_org_id`, `organization_members.clerk_user_id`.
  Dropping them is irreversible and unnecessary. Nothing in an external Clerk account was changed or deleted.
* Browser and API must be **same-site** (same registrable domain, e.g. `localhost:5173` + `localhost:8000`) because the cookie is `SameSite=Lax`.
  The dev API URL follows the page's host name automatically. For a different registrable domain set `SESSION_COOKIE_SAMESITE=none` (forces `Secure`).
