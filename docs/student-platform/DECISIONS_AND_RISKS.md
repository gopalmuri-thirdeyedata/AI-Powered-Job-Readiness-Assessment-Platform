# HiringAI Student Career Platform — Architectural Decisions & Risk Matrix

## 1. Architectural Decisions Log

| Decision ID | Context | Decision | Rationale |
|---|---|---|---|
| **ADR-001** | Recruiter Interview Safety | Freeze `interview_evaluation.py` (`backend/routers/interview.py` and the voice service were unfrozen once to replace Vapi with ElevenLabs). Build student mock interviews under isolated student services. | Prevents regressions in live recruiter assessment interviews and keeps student practice separated from official evaluations. |
| **ADR-002** | Multi-Tenant Organization Provisioning | Reject client-supplied `organization_id`. Resolve tenant solely via admin pre-invitations or verified college slug/invite code. | Eliminates security vulnerability where arbitrary users could attach themselves to enterprise organizations. |
| **ADR-003** | AI Service Architecture | Reuse `AIGenerator` (`ai_generator.py`) and `skill_suggestion.py` rather than spawning duplicate SDK clients. | Single point of failure control, uniform error logging, Gemini -> Groq automatic fallback, and centralized prompt management. |
| **ADR-004** | Hybrid Relational / JSON Storage | Store student relational keys, statuses, and foreign keys in traditional columns; store rich, variable AI evaluations (9-dimension resume findings, interview rubrics, practice traces) in MySQL `JSON` columns. | Delivers fast relational query joins and indexing while preserving flexibility for rich AI analytics without schema churn. |
| **ADR-005** | Hidden Test Case Privacy | Strip `is_hidden: true` test cases and answer keys from API responses. Evaluate submissions strictly server-side. | Prevents candidate cheat extensions and guarantees assessment integrity. |

---

## 2. Risk Matrix & Mitigations

| Risk | Severity | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **LLM Provider Outage or Rate Limit** | High | Medium | Dual-provider failover (Gemini 1.5 Pro to Groq Llama 3) with deterministic, rule-based fallback taxonomies to guarantee 100% uptime. |
| **Arbitrary Code Execution in Practice** | Critical | Low | Practice code executes via existing sandboxed Judge0 runner with memory limits, strict 5-second timeouts, and bounded output buffers. |
| **Cross-Tenant Data Exposure** | Critical | Low | Rigorous fail-closed tenant queries (`organization_id == current_student.organization_id`) in every database operation; verified by automated cross-tenant test suites. |
| **Frontend State Desynchronization** | Medium | Low | React query patterns and centralized API service layer with standardized error handling and token refresh. |

---

## 3. Rollback & Disaster Recovery Strategy
1. **Database Backward Compatibility**: All new tables are purely additive. No existing recruiter or candidate tables are dropped or structurally modified.
2. **Feature Flags & Modular Routers**: Student features reside in modular routers (`/api/student`, `/api/college`). Any component can be isolated or deactivated without affecting the core recruiter platform.
