# RoleReady — Assessment Workflow & State Machine

## 1. Sequential State Machine Specification

The assessment pipeline enforces a deterministic state machine strictly validated on the backend. Attempting to access an unapproved round via client routing or direct API execution will result in an `HTTP 403 Forbidden` response.

```
       [ NOT_STARTED ]
              │
              │ POST /start-aptitude
              ▼
   [ APTITUDE_IN_PROGRESS ]
              │
              │ POST /submit-aptitude
              ▼
    [ APTITUDE_SUBMITTED ]
              │
              │ Server Evaluation
              ▼
    [ APTITUDE_EVALUATED ] ───► Automatically unlocks Coding
              │
              ▼
      [ CODING_UNLOCKED ]
              │
              │ POST /start-coding
              ▼
    [ CODING_IN_PROGRESS ]
              │
              │ POST /submit-coding
              ▼
     [ CODING_SUBMITTED ]
              │
              │ Server Hidden-Tests Evaluation
              ▼
     [ CODING_EVALUATED ] ───► Automatically unlocks Interview
              │
              ▼
    [ INTERVIEW_UNLOCKED ]
              │
              │ POST /start-interview
              ▼
  [ INTERVIEW_IN_PROGRESS ]
              │
              │ POST /submit-interview
              ▼
   [ INTERVIEW_SUBMITTED ]
              │
              │ Speech & Technical Evaluation
              ▼
   [ INTERVIEW_EVALUATED ]
              │
              │ Synthesize Final Job Readiness Dossier
              ▼
        [ COMPLETED ]
```

---

## 2. Gating Invariants & Security Rules
1. **Rule 1 (Pristine Initiation):** A session starts in `NOT_STARTED`. Only when the candidate triggers the aptitude countdown does it become `APTITUDE_IN_PROGRESS`.
2. **Rule 2 (No Skipping):** Round 2 (`CODING`) cannot be started unless the session state is either `CODING_UNLOCKED` or `CODING_IN_PROGRESS`.
3. **Rule 3 (Backend as Sole Source of Truth):** Frontend UI locks are driven entirely by `session.current_state` returned from the server.
4. **Rule 4 (Idempotent Submissions):** Submitting a round that is already submitted or evaluated returns the existing scorecard without duplicate re-evaluation or state corruption.
5. **Rule 5 (Session Recovery):** If a candidate's browser refreshes during an `IN_PROGRESS` round, the server restores the active questions, problem states, and elapsed timer without loss of valid work.
