# PrepWin — System Architecture

## 1. Architectural Overview
PrepWin is architected as an asynchronous, API-driven web application with distinct tenant boundaries, decoupled assessment execution engines, and a unified scoring pipeline.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RoleReady Client (React 18)                     │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐ │
│  │ Workflow A (Student) │  │  Workflow B (Admin) │  │ Assessment UI  │ │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / REST / WebSockets / WebRTC
┌───────────────────────────────────▼────────────────────────────────────┐
│                       FastAPI Application Gateway                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   Security & Tenant Isolation Layer              │  │
│  │   • JWT / Clerk Auth  • RBAC & Tenant Guard  • Cryptographic Invites│  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ AssessmentRouter │  │ CandidateRouter  │  │ AdminRecruitRouter   │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           │                     │                       │              │
│  ┌────────▼─────────────────────▼───────────────────────▼───────────┐  │
│  │                   Core Service Orchestration                     │  │
│  │  • Session State Machine Service  • JD & Resume Synthesis Engine │  │
│  │  • AI Assessment Generator       • Report Aggregation Engine    │  │
│  └────────┬─────────────────────────────────────────────┬───────────┘  │
└───────────┼─────────────────────────────────────────────┼──────────────┘
            │                                             │
┌───────────▼──────────────┐             ┌────────────────▼──────────────┐
│ Third-Party & Runtimes   │             │   Persistence & Storage       │
│ • Gemini 2.5 / Groq AI   │             │ • MySQL 8 (Relational & JSON) │
│ • Piston Code Sandbox    │             │ • File Storage (Resumes/JDs)  │
│ • Vapi Conversational AI │             │ • Redis / In-Memory Session   │
└──────────────────────────┘             └───────────────────────────────┘
```

---

## 2. Key System Subsystems

### 2.1 The Assessment Session Orchestrator
At the core of RoleReady is the `RoleReadyAssessmentSession`. This model guarantees:
- **Atomicity:** Every candidate/student attempt is bound to a single immutable session record.
- **Round Isolation:** Questions, starter code, test suites, and Vapi session tokens are instantiated uniquely per session.
- **Deterministic Gating:** Transitions between rounds are executed via server-side transition methods that verify the prior round has passed server evaluation before unlocking the next round.

### 2.2 The Resume & JD Semantic Synthesis Engine
Instead of generic questions, the synthesis engine:
1. Deconstructs the Job Description into key competencies: Core Languages, Frameworks, Architecture, Problem-Solving Scope, and Domain Knowledge.
2. Deconstructs the Candidate's Resume to detect experience depth and claimed proficiencies.
3. Computes the **Competency Gap Delta** and seeds the AI Assessment Generator to test both verified strengths and critical role prerequisites.

### 2.3 Sandboxed Code Execution Subsystem
RoleReady utilizes a self-hosted Piston execution service:
- Support for Python, JavaScript, Java, C++, and Go.
- Strict resource isolation: 256MB memory limit, 3-second CPU timeout per run.
- Separate public test cases (visible feedback to candidate) and hidden test cases (evaluated strictly server-side upon final submission).

### 2.4 Voice & Conversational Interview Engine
- Integrated with Vapi WebRTC client for real-time speech interaction.
- Prompts are dynamically compiled from JD context and resume specifics.
- Audio transcriptions and response metrics are scored for technical accuracy, problem formulation, and communication clarity.
