# RoleReady — UI & UX Design Plan

## 1. Visual Identity & Brand Philosophy
- **Product Name:** RoleReady
- **Tagline:** "AI-powered assessments that evaluate job readiness against real job requirements."
- **Color Palette:**
  - Deep Navy / Slate Obsidian Background: `#070B14`, `#0C1120`, `#111827`
  - Emerald Primary Accent: `#10B981` (Readiness, High Confidence, Passed)
  - Cyan Secondary Accent: `#06B6D4` (Technical Execution, Analytics)
  - Amber Warning Accent: `#F59E0B` (Skill Gaps, In Progress)
  - Rose Alert Accent: `#F43F5E` (Violations, Failed Tests)
  - Clean Text Hierarchy: Headings in `Plus Jakarta Sans`, body and code in `Inter` and `JetBrains Mono`.

---

## 2. Key Screen Blueprints

### 2.1 The Public Home Page (`/`)
- Hero section emphasizing the two workflows:
  - **Left Call-to-Action:** "Student Self-Assessment" — Upload resume + JD to benchmark readiness.
  - **Right Call-to-Action:** "Recruiter & Enterprise Suite" — Launch bulk campaigns and proctored hiring funnels.
- Interactive workflow demo showing Aptitude → Coding → AI Voice Interview.

### 2.2 Student Self-Assessment Launchpad (`/student/assessment/setup`)
- Step 1: Upload resume (with drag-and-drop & instant parsing preview).
- Step 2: Paste or upload target Job Description.
- Step 3: AI Analysis Card showing detected competencies and generated assessment battery.
- Step 4: "Launch RoleReady Assessment" button.

### 2.3 The Sequential Assessment Portal (`/assessment/:session_uuid`)
- Unified Header with round progress breadcrumb:
  - `[Round 1: Aptitude] ──── [Round 2: Coding 🔒] ──── [Round 3: Interview 🔒]`
- Real-time countdown timer with auto-submit safeguard.
- Live proctoring status pill (`Webcam Active • Fullscreen Locked`).

### 2.4 Coding Environment (`/assessment/:session_uuid/coding`)
- Split-pane layout: Left pane has Problem Statement, Examples, Constraints; Right pane has Monaco/CodeMirror code editor, language selector, and Terminal / Test Output.
- Action bar: "Run Code" (public tests) and "Submit All Solutions" (final server evaluation).

### 2.5 Recruiter Batch Recruitment Hub (`/recruiter/batches`)
- Batch management table with campaign status, candidate counts, and average readiness score.
- Bulk resume uploader with real-time parsing progress bar.
- One-click invitation dispatch modal with preview email template.
