# 🚀 HiringAI — Enterprise AI-Powered Hiring & Assessment Platform

> **Autonomous End-to-End Recruitment, Multi-Tenant SaaS, Resilient Proctoring & AI Voice Interviews**  
> Developed by **Gopal Muri · ThirdEye Data**

---

## 📋 Executive Overview

**HiringAI** is an enterprise-grade B2B SaaS platform that automates the entire corporate recruitment lifecycle—from structured job description design and real-time streaming resume screening to dynamic aptitude assessments, sandboxed coding challenges, AI-led voice interviews, and deep hiring analytics.

Eliminating recruitment bottlenecks and cognitive bias, HiringAI provides an end-to-end autonomous evaluation pipeline protected by computer vision proctoring and hardened multi-tenant organization isolation.

---

## 🌟 Key Platform Capabilities

### 🏢 1. Enterprise Multi-Tenancy & B2B Authorization
* **Tenant Isolation:** Every organization's jobs, candidates, resumes, assessments, and analytics are strictly partitioned by `organization_id`. Frontend-provided org parameters are never trusted; tenant scope is resolved server-side from verified membership.
* **Role-Based Access Control (RBAC):**
  * `PLATFORM_ADMIN`: Global software owner (`admin@thirdeyedata.ai`) managing enterprise tenant provisioning, subscription lifecycle, and cross-organization governance.
  * `ORG_ADMIN`: Company administrator managing organization recruiters, settings, and job pipelines.
  * `HR_RECRUITER`: Recruiter managing candidates, screening, assessments, and interview evaluations.
  * `CANDIDATE`: Restricted, one-time candidate session with scoped token access.
* **Invite-Only Security Model:** Unknown users attempting OAuth or password sign-in strictly receive `403 Forbidden` until explicitly provisioned.
* **Clerk Identity Management:** Production support for Google OAuth, GitHub OAuth, Email/Password, and Email Verification Codes (OTP).

### 🔍 2. Real-Time Streaming Resume Screening (ATS Intelligence)
* **Structured Job Descriptions:** Multi-attribute JD builder capturing job duties, required skills, preferred skills, and minimum experience thresholds.
* **AI Skill Extraction:** Dual-provider LLM pipeline (Groq Llama 3.1 & Gemini) with instant regex/heuristic fallbacks providing intelligent skill recommendations with full recruiter curation control.
* **Progressive Streaming Evaluation:** Real-time resume parsing, keyword relevance extraction, criteria matching, and scoring with live SSE/stream updates.

### 🧠 3. Dual-Mode Aptitude Assessments
* **Dual Question Authoring:**
  * **AI Generation:** Automatically synthesizes role-aligned aptitude and domain questions with dynamic difficulty.
  * **Manual Builder:** Recruiters can manually author Multiple Choice (MCQ), True/False, and Short Answer questions with custom marks and explanations.
* **Candidate Security & Privacy:** Private answer keys and explanations are strictly withheld on the backend during test taking.
* **Authoritative Server Grading:** All candidate answers are graded authoritatively by backend evaluation engines.

### 💻 4. Sandboxed Coding Assessments
* **Monaco Code Editor:** Integrated developer editor supporting Python, Java, JavaScript, C++, and C with syntax highlighting and auto-completion.
* **Isolated Sandbox Execution:** Code is compiled and executed in real-time using Piston / Judge0 execution sandboxes.
* **Public & Hidden Test Cases:** Supports sample test cases for candidate debugging alongside hidden test cases evaluated exclusively on the server to prevent hardcoded solutions.

### 🎙️ 5. Autonomous Voice Technical Interviews
* **Real-Time Voice AI:** Integrated with **Vapi AI** for conversational voice-based technical interviews.
* **Adaptive Questioning:** The AI interviewer listens to candidate answers, asks technical follow-ups, and adapts difficulty based on candidate depth.
* **Full Transcript & Analytics:** Automatically parses interview transcripts, computes rubric scores, and provides recruiter briefing summaries.

### 🛡️ 6. Anti-Malpractice & Vision Proctoring
* **Unified Fullscreen Protection:** Shared `useAssessmentFullscreen` hook and `FullscreenGateModal` across Aptitude, Coding, and Interview rounds with a 10-second violation recovery timer.
* **YOLO Computer Vision:** CPU-optimized YOLOv8/YOLO11 object detection checking candidate camera frames for:
  * Absence / No person detected
  * Multiple faces / Unauthorized persons
  * Cell phone usage
  * Secondary laptop or display
  * Unauthorized books or notes
* **Session Integrity:** Voice WebRTC sessions remain connected without reset during fullscreen recovery.

### 📊 7. Recruitment Intelligence Dashboard
* **100% Real Data:** Fully integrated with live database analytics—zero fabricated or mocked candidate data.
* **Pipeline Bottleneck Alerting:** Detects and surfaces candidate drop-off and conversion bottlenecks across assessment stages.
* **Interactive Score Distributions:** Switch metrics between Aptitude, Coding, and Technical Interview rounds.
* **Candidate Detail Drawer:** Provides recruiters with concise score summaries and interview performance metrics without exposing raw prompt internals.

---

## 🎓 PrepWin Assessment Notes

- **LLM provider:** all AI calls go through `backend/services/gemini_client.py` (Google Gemini only; no OpenAI or Groq).
  Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL_NAME`). `GEMINI_MOCK_MODE=true` serves offline fixtures for development and tests; keep it `false` in production.
- **Interview round:** the text STAR interview is the default and works with no voice credentials. Vapi + Deepgram voice interviews
  (recruiter candidate portal) are optional; the Vapi assistant uses the `google` LLM provider with `GEMINI_MODEL_NAME`, which requires a Google AI Studio credential to be added in the Vapi dashboard.
- **Interview score fallback (agreed behaviour):** if Gemini is unavailable and the student submitted answers, the interview score defaults to **75**.
  Such rounds are marked `evaluation_source: "fallback_default"` in the round's `evaluation_payload` (AI-scored rounds use `"ai"`, empty interviews score 0 with `"no_answers"`),
  so fallback scores can always be told apart from AI evaluations. No other scoring formula is applied.
- **Code execution:** Python only, via the Judge0-compatible endpoint in `JUDGE0_API_URL` (hosting topology is a deferred decision).
- **Database migration:** `python backend/migrate_roleready_schema.py` adds `roleready_sessions.resume_raw_text` (additive, idempotent). Back up first
  (`mysqldump --single-transaction` for MySQL, or copy the SQLite file; `*.pre_migration_backup` files are git-ignored). Never drop the column on rollback.

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite 5, TailwindCSS, Framer Motion, Monaco Editor, Lucide Icons, Recharts |
| **Backend** | FastAPI, Python 3.11, SQLAlchemy ORM, Pydantic v2, Gunicorn + Uvicorn |
| **Database & Cache** | MySQL 8.0 (Connection Pooling, Pre-ping), Redis 7.0 |
| **Authentication** | Clerk (B2B Admin & Recruiter), Python-Jose / Passlib (Candidate JWT) |
| **AI & Inference** | Groq (Llama 3.1), Google Gemini, Ultralytics YOLOv8 / YOLO11 (CPU), Vapi AI (Voice) |
| **Code Execution** | Piston API / Judge0 Isolated Execution Sandbox |
| **Deployment & Ops** | Docker, Docker Compose, Nginx (Reverse Proxy, SSL, WebSockets, Gzip) |

---

## 📁 Repository Structure

```
HiringAI/
├── backend/
│   ├── models/                   # YOLO vision detection weights (.pt)
│   ├── routers/                  # Modular FastAPI routers
│   │   ├── auth.py               # Clerk sync, candidate auth, JWT
│   │   ├── platform.py           # Platform Admin organization management
│   │   ├── organization.py       # Organization member & invite management
│   │   ├── assessments.py        # Aptitude & Coding rounds, test submissions
│   │   ├── resume.py             # Structured JDs, AI skills, streaming screening
│   │   ├── dashboard.py          # Real-time recruitment analytics
│   │   ├── interview.py          # Voice interview webhook & transcripts
│   │   ├── proctor.py            # YOLO frame analysis
│   │   └── settings.py           # Global scoring weights & config
│   ├── services/                 # Evaluation engines & external API clients
│   ├── tests/                    # 16 automated backend test suites (162 tests)
│   ├── database.py               # MySQL engine & connection pool setup
│   ├── main.py                   # FastAPI application & middleware
│   ├── migrate_multitenant_schema.py # Idempotent multi-tenant DB migration
│   ├── migrate_v2_schema.py      # Idempotent V2 schema migration
│   ├── Dockerfile                # Production Python 3.11 container
│   └── requirements.txt          # Production Python dependencies
├── frontend/
│   ├── src/
│   │   ├── components/           # UI widgets, modals, builders, analytics
│   │   ├── hooks/                # useAssessmentFullscreen, useProctoring
│   │   ├── layouts/              # DashboardLayout, CandidateLayout
│   │   ├── pages/                # Home, Dashboard, Assessment, Portal pages
│   │   └── apiConfig.js          # Dynamic environment-driven API routing
│   ├── test_*.test.mjs           # 5 frontend test suites (53 tests)
│   ├── Dockerfile                # Multi-stage production container
│   ├── nginx.conf                # Nginx SPA fallback configuration
│   └── package.json              # Scripts & dependencies
├── nginx/
│   └── nginx.conf                # Production edge reverse proxy with SSL & WebSockets
├── docker-compose.prod.yml       # Production orchestration
├── DEPLOYMENT.md                 # Complete 22-step server deployment guide
└── README.md
```

---

## ⚡ Quick Start (Local Development)

### Prerequisites
* **Node.js** (v20+ LTS recommended)
* **Python** (3.10+ or 3.11+)
* **MySQL** (8.0+)
* Required API Keys (Groq, Vapi, Clerk)

### 1. Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your MySQL credentials, Clerk keys, and AI API keys

# Run database migrations
python migrate_multitenant_schema.py
python migrate_v2_schema.py

# Launch development server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
* API runs at: `http://localhost:8000`
* Interactive API Documentation: `http://localhost:8000/docs`
* Health probes: `http://localhost:8000/health/live` and `http://localhost:8000/health/ready`

### 2. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Set VITE_API_URL=http://localhost:8000 and your Clerk publishable key

# Launch Vite development server
npm run dev
```
* Application runs at: `http://localhost:5173`

---

## 🧪 Automated Testing & Verification

The platform maintains comprehensive test coverage across backend business logic, multi-tenant isolation, role authorization, candidate proctoring, and frontend UI components.

### Run Backend Tests (162 Tests)
```bash
cd backend
pytest tests/
```
* **Result:** `162 passed in 18.38s` (100% Pass)
* Validates B2B tenant isolation, Platform Admin privileges, candidate data masking, hidden test execution, and analytics aggregation.

### Run Frontend Tests (53 Tests)
```bash
cd frontend
npm test
```
* **Result:** `53 passed in 219ms` (100% Pass)
* Validates dashboard analytics, fullscreen entry & recovery contracts, structured JD builders, and settings pipelines.

### Run Frontend Production Build
```bash
cd frontend
npm run build
```
* **Result:** Production bundle compiles cleanly in ~14s into `dist/`.

---

## 🚢 Production Deployment

For detailed production deployment instructions, server hardening, SSL provisioning, and systemd/Docker management, see:

👉 **[Complete Production Deployment Guide (DEPLOYMENT.md)](./DEPLOYMENT.md)**

### Quick Docker Production Launch
```bash
# 1. Provide production secrets in backend/.env and frontend/.env.production
# 2. Build and launch all services (MySQL, Redis, Backend, Frontend, Nginx)
docker compose -f docker-compose.prod.yml up -d --build

# 3. Check container health
docker compose -f docker-compose.prod.yml ps
```

---

## 👨‍💻 Author & Attribution

* **Architect & Developer:** **Gopal Muri**
* **Organization:** **ThirdEye Data**
* **Contact:** `admin@thirdeyedata.ai`

---

## 📄 License

Proprietary enterprise software developed for **ThirdEye Data**. All rights reserved.




