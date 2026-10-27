# Student assessment access (admin-controlled)

The **normal student assessment** (aptitude, coding, AI interview, started from the Student Portal) is locked per student until an
Admin or Super Admin grants access in **User Management -> Assessment Access**.

## Rules

- Every student starts **locked**, including every student that existed before the feature (the migration adds the column as `FALSE`).
- Grant / revoke: `PUT /api/admin/users/{id}/assessment-access` with `{"granted": true|false}`. Same hierarchy as the rest of User
  Management: an Admin manages Students of their own organization; a Super Admin follows the existing role rules; anything outside the
  caller's organization is a 404. Only Student accounts have the switch. Students are rejected before the handler runs.
- Access stays granted until it is revoked. There is no timer.
- Each change is written to the activity log (`assessment_access_granted` / `assessment_access_revoked`) and stamped on the profile
  (`assessment_access_updated_at`, `assessment_access_updated_by`).
- A student can read their own state: `GET /api/roleready/student/assessment-access` -> `{"access_granted": bool}`.

## Where the backend enforces it (`services/assessment_access.py`)

| Request | When locked |
|---|---|
| `POST /api/roleready/student/initialize` | `403 {"code": "ASSESSMENT_ACCESS_LOCKED"}` before anything is parsed or created |
| `POST /api/roleready/session/{uuid}/start-aptitude` on a `NOT_STARTED` self-assessment | same 403 (a session created earlier cannot be started) |

Not gated: a session that is already running or finished (so revoking never ends an attempt in progress, and its drafts, later rounds,
submissions and report keep working), the history/results endpoints, the dashboard, and every other student feature.
Recruitment (shared-link), recruiter-invitation and job-role sessions never call this module. Attempt limits, timers, scoring and
evaluation are untouched.

## Schema

`python migrate_student_assessment_toggle.py` (also run automatically at API start-up; additive and idempotent) adds to
`student_profiles`: `assessment_access_enabled` (NOT NULL, default false), `assessment_access_updated_at`, `assessment_access_updated_by`.

## Student UI

`AssessmentLockContext` asks the server for the student's access (re-read on every press, so a change applies without signing out).
Locked: every "Start assessment" button opens the contact-admin popup. Unlocked: the same buttons open `/assessment/setup`.
The server remains the authority; the UI is only a mirror.
