# PrepWin UI/UX Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize and elevate the UI/UX across all PrepWin student-facing pages into a cohesive, modern, professional, minimal, beautiful, and accessible product using a unified emerald and slate design system.

**Architecture:** Implement a 5-tier safe migration strategy starting with CSS variables and theme foundation, harmonizing shared navigation headers and sidebars (Approach A), standardizing core Assessment Setup and Dashboard pages, progressively updating student career modules, and culminating in full regression testing.

**Tech Stack:** React 18, Vite 5, TailwindCSS 3.3, Vanilla CSS Design Tokens, Lucide React, Recharts.

**Spec:** `docs/superpowers/specs/2026-10-14-prepwin-ui-ux-standardization-design.md`

---

## Global Constraints

- **Strict Wording Preservation:** Never rename, rewrite, remove, or replace existing page titles, headings, navigation labels, button text, form labels, placeholder text, tab names, menu items, feature names, informational text, or status labels.
- **Strict Functionality Preservation:** Do not modify business logic, backend logic, API endpoints, request/response payloads, database schemas, authentication, assessment generation, scoring calculations, form validation rules, or permissions.
- **Workflow Continuity:** Preserve the exact sequence of user actions across Assessment Setup, Test Taking, Score Reporting, and Dashboard navigation.
- **Zero Fabrication:** No dummy statistics, fake charts, or mocked metrics.
- **Backward-Compatible Token Migration:** Preserve existing token names (`--rr-*`, `--s-*`, `--brand`) as aliases pointing to the new unified palette until all component consumers are migrated.
- **Reusable Component Primitives First:** Establish standardized styling tokens and components before applying changes to individual student pages.
- **Independent Theme Verification:** Validate light and dark modes independently on every modified screen.
- **Responsive Breakpoints:** Verify layouts at 375px (Mobile), 768px (Tablet), 1280px (Laptop), and 1536px+ (Desktop).
- **Textarea Typography Rule:** Ordinary textareas (Job Description paste, notes, descriptions) MUST use regular application font (`font-sans text-sm`); `font-mono` is strictly restricted to code editors and technical syntax fields.
- **Seven Interactive States:** Every button/interactive element must have default, hover, focus, active, disabled, loading, and error states. Keyboard focus indicator must be visible in both themes (`focus-visible:ring-2 focus-visible:ring-emerald-500`).

---

## Review Focus

1. **Text Contrast in Dark Mode:** Primary buttons and active badges must maintain a contrast ratio >= 4.5:1 against their backgrounds in both light and dark themes.
2. **Textarea Font Integrity:** Ensure non-code textareas in `RoleReadySetup`, `StudentDrives`, and `StudentProjects` use `font-sans text-sm`, while coding sandboxes retain `font-mono`.
3. **Sidebar Route Preservation:** Ensure all 11 routes in `StudentLayout` navigate to the exact same paths without route disruption or handler loss.
4. **Assessment Setup Form Validation:** Ensure required field validation (Target Role and Job Description) continues to fire cleanly with inline alerts when inputs are empty.
5. **Real Data Persistence:** Ensure student dashboard score gauge and performance charts continue to bind to live API data without mock fallbacks.

---

## Verified Starting Baseline

- **Automated Tests:** `npm test` -> 201 passed in 24 suites (100% passing, 622ms duration).
- **Production Build:** `npm run build` -> Compiled cleanly in 36.04s (`vite v5.4.21`, 58 output chunks).
- **Known Unrelated Warnings:** `Browserslist: browsers data (caniuse-lite) is 10 months old` (benign build advisory, documented separately).
- **Docker Stack:** 5/5 containers running healthy on port `8212` (`interviewer_proxy`, `interviewer_frontend`, `interviewer_backend`, `interviewer_mysql`, `interviewer_redis`).

---

## Task Breakdown

### Task 1 (Tier 1): Unified Semantic Design Tokens & Theme Foundation

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/tailwind.config.js`

**Interfaces:**
- Consumes: Tailwind base/components/utilities, existing ThemeContext (`.dark` class toggling).
- Produces: Explicit semantic tokens (`--brand-primary`, `--brand-hover`, `--brand-light`, `--bg-main`, `--bg-card`, `--bg-input`, `--border-default`, `--text-primary`, `--text-secondary`, `--semantic-info`, `--semantic-warn`, `--semantic-error`), backward-compatible aliases for `--rr-*`, `--s-*`, and `.btn-primary` / `.btn-secondary` / `.card-surface` utility styles.

- [ ] **Step 1: Check existing token definitions in `frontend/src/index.css`**
- [ ] **Step 2: Add explicit semantic tokens and backward-compatible alias mappings to `frontend/src/index.css`**
  - Add `--brand-primary: #059669`, `--brand-hover: #047857`, `--brand-light: #ECFDF5`, `--bg-main: #F8FAFC`, `--bg-card: #FFFFFF`, `--bg-input: #F8FAFC`, `--border-default: #E2E8F0`, `--text-primary: #0F172A`, `--text-secondary: #64748B`.
  - Add corresponding dark theme definitions in `.dark`: `--brand-primary: #10B981`, `--brand-hover: #059669`, `--bg-main: #0B1220`, `--bg-card: #111B2E`, `--bg-input: #0F172A`, `--border-default: #1E293B`, `--text-primary: #F8FAFC`.
  - Wire backward-compatibility aliases: `--brand: var(--brand-primary)`, `--rr-bg: var(--bg-main)`, `--rr-card: var(--bg-card)`, `--rr-border: var(--border-default)`, `--rr-text: var(--text-primary)`, `--s-bg: var(--bg-main)`, `--s-card: var(--bg-card)`, `--s-border: var(--border-default)`, `--s-emerald: var(--brand-primary)`.
  - Define reusable classes: `.btn-primary`, `.btn-secondary`, `.card-surface`, `.input-base`.
- [ ] **Step 3: Clean up `frontend/tailwind.config.js`**
  - Remove non-standard yellow-green override on `indigo`.
  - Standardize `font-sans` to `['Inter', 'system-ui', '-apple-system', 'sans-serif']`.
  - Maintain native Tailwind emerald, slate, and semantic color maps.
- [ ] **Step 4: Tier 1 Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
  - Run: `npm run build` in `frontend` (Expected: Exit code 0, clean build).
- [ ] **Step 5: Commit Tier 1**
  - Commit message: `feat(design-system): establish unified semantic tokens and theme foundation`

---

### Task 2 (Tier 2): Shared Navigation & Header Harmonization (Approach A)

**Files:**
- Modify: `frontend/src/components/RoleReadyNavbar.jsx`
- Modify: `frontend/src/layouts/StudentLayout.jsx`

**Interfaces:**
- Consumes: `useTheme` from `context/ThemeContext`, `useUser` from `@clerk/clerk-react`, Lucide icons.
- Produces: Harmonized 64px header across Assessment Setup and Student Portal with breadcrumb back to Dashboard, consistent user profile pill, theme toggle, and unified emerald sidebar active indicators.

- [ ] **Step 1: Update `RoleReadyNavbar.jsx`**
  - Standardize header height to `h-16` (64px).
  - Align brand lockup (`logo_main.png` + "PrepWin" bold wordmark + "Job Readiness Platform" subtitle).
  - Add prominent breadcrumb return link: `<Link to="/student/dashboard" className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 flex items-center gap-1.5">← Back to Dashboard</Link>`.
  - Standardize user profile pill (`bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700`) and theme toggle.
- [ ] **Step 2: Update `StudentLayout.jsx`**
  - Unify sidebar item active indicator: clean emerald left border + subtle background (`bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold border-emerald-200/80 dark:border-emerald-500/20`).
  - Remove multicolor rainbow glow effects in favor of cohesive brand green hierarchy.
  - Preserve all 11 existing navigation routes and visible labels.
- [ ] **Step 3: Tier 2 Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
  - Verify navigation links, active states, collapse/expand toggle, and breadcrumbs.
- [ ] **Step 4: Commit Tier 2**
  - Commit message: `feat(navigation): harmonize header height, breadcrumbs, and sidebar active indicators`

---

### Task 3 (Tier 3A): Assessment Setup Page Polish

**Files:**
- Modify: `frontend/src/pages/roleready/RoleReadySetup.jsx`

**Interfaces:**
- Consumes: `RoleReadyNavbar`, `rolereadyApi.initializeSession`, FormData.
- Produces: Standardized form cards, 44px text inputs, `font-sans text-sm` textarea for Job Description, dropzone styling, 44px primary start button, and accessible validation errors.

- [ ] **Step 1: Standardize Cards & Form Controls in `RoleReadySetup.jsx`**
  - Update Target Position card: `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs`.
  - Update Target Job Title input to 44px (`h-11`) with `rounded-xl`, `border-slate-200 dark:border-slate-800`, and focus ring `focus:ring-2 focus:ring-emerald-500/20`.
  - Update Role Suggestion Chips: subtle active emerald pill (`bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-300`).
  - Update Job Description textarea: Ensure it uses `font-sans text-sm` (CORRECTION 2) instead of `font-mono text-xs`.
  - Update Resume Upload dropzone: `rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800`.
  - Update Three-Round Assessment Pipeline card: Clean number badges, lock icons, and durations.
  - Update Start Assessment primary button: 44px (`h-11`), `bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl shadow-xs`.
- [ ] **Step 2: Tier 3A Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
  - Verify validation error triggers when required fields are empty.
- [ ] **Step 3: Commit Tier 3A**
  - Commit message: `feat(setup): standardize assessment setup cards, inputs, and typography`

---

### Task 4 (Tier 3B): Student Dashboard & Performance View Polish

**Files:**
- Modify: `frontend/src/pages/student/StudentDashboard.jsx`
- Modify: `frontend/src/components/student/StudentPerformanceView.jsx`

**Interfaces:**
- Consumes: `studentApi.getDashboard`, `studentApi.getUnifiedDashboard`, `studentApi.getAssessmentHistory`, Recharts.
- Produces: Polished segmented view switchers, circular score gauge card, metric stat cards, performance charts, and assessment history list using 100% real data.

- [ ] **Step 1: Update `StudentDashboard.jsx`**
  - Standardize top segmented view switcher (`Performance & Analytics` vs `Readiness & Career`): `p-1 bg-slate-100 dark:bg-slate-800 rounded-xl`.
  - Standardize welcome section and quick action buttons.
  - Standardize circular score gauge card and multi-factor preparation cards (`rounded-2xl border border-slate-200 dark:border-slate-800 p-6`).
  - Standardize empty states and loading spinner indicators.
- [ ] **Step 2: Update `StudentPerformanceView.jsx`**
  - Standardize metric stat cards, Recharts chart container with accessible tooltip styling, and filter buttons.
  - Standardize historical assessment table rows, score badges (`High: emerald`, `Intermediate: amber`, `Foundation: rose`), and action buttons.
- [ ] **Step 3: Tier 3B Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
  - Verify real data rendering and tab switching in both light and dark themes.
- [ ] **Step 4: Commit Tier 3B**
  - Commit message: `feat(dashboard): standardize student dashboard metrics, charts, and history views`

---

### Task 5 (Tier 4A): Skill Gap & Roadmap Modules

**Files:**
- Modify: `frontend/src/pages/student/StudentSkillGap.jsx`
- Modify: `frontend/src/pages/student/StudentRoadmap.jsx`

**Interfaces:**
- Consumes: `studentApi.getSkillGap`, `studentApi.simulateSkillGap`, `studentApi.getRoadmap`, `studentApi.updateDailyTaskStatus`.
- Produces: Standardized benchmark role dropdown, match percentage gauge, taxonomy skill lists, what-if simulator, week tabs, and daily task cards.

- [ ] **Step 1: Update `StudentSkillGap.jsx`**
  - Standardize header card, benchmark role dropdown, and match score card (`rounded-2xl border border-slate-200 dark:border-slate-800 p-6`).
  - Replace legacy indigo accents with standardized emerald and slate tokens.
  - Standardize what-if simulation input, add button, and simulated skill tags.
- [ ] **Step 2: Update `StudentRoadmap.jsx`**
  - Standardize week navigation pills (`px-4 py-2 rounded-xl text-xs font-semibold`).
  - Standardize task cards with category badges, status checkboxes, and regeneration confirmation modal.
- [ ] **Step 3: Tier 4A Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
- [ ] **Step 4: Commit Tier 4A**
  - Commit message: `feat(skill-gap-roadmap): standardize skill intelligence and roadmap views`

---

### Task 6 (Tier 4B): Practice & Mock Interview Modules

**Files:**
- Modify: `frontend/src/pages/student/StudentPractice.jsx`
- Modify: `frontend/src/pages/student/StudentMockInterview.jsx`

**Interfaces:**
- Consumes: `studentApi.getPracticeQuestions`, `studentApi.submitPracticeAttempt`, `studentApi.startMockInterview`, `studentApi.submitInterviewTurn`.
- Produces: Standardized category switcher pills, topic filter badges, code editor sandbox card, aptitude MCQ cards, interview track cards, dialogue turns, and scorecard.

- [ ] **Step 1: Update `StudentPractice.jsx`**
  - Standardize category switcher (`All Modules`, `DSA Coding`, `Aptitude`).
  - Standardize coding workspace card (retaining `font-mono` for code editor) and MCQ option cards.
  - Standardize execution feedback card and submit button (44px, emerald).
- [ ] **Step 2: Update `StudentMockInterview.jsx`**
  - Standardize track selection cards and STAR guide cards.
  - Standardize dialogue bubbles, response textarea (`font-sans text-sm`), and turn feedback card.
  - Standardize final session scorecard and history drawer.
- [ ] **Step 3: Tier 4B Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
- [ ] **Step 4: Commit Tier 4B**
  - Commit message: `feat(practice-interview): standardize practice sandbox and mock interview views`

---

### Task 7 (Tier 4C): Placement Simulation & Projects Modules

**Files:**
- Modify: `frontend/src/pages/student/StudentPlacementSimulation.jsx`
- Modify: `frontend/src/pages/student/StudentProjects.jsx`

**Interfaces:**
- Consumes: `studentApi.startSimulation`, `studentApi.submitSimulationRound`, `studentApi.getProjects`, `studentApi.createProject`.
- Produces: Standardized round progress stepper, round workspace cards, simulation scorecard, project repository cards, and project modal.

- [ ] **Step 1: Update `StudentPlacementSimulation.jsx`**
  - Standardize 4-round stepper bar (Aptitude, Coding, Architecture, HR).
  - Standardize round workspace cards, question blocks, and submission triggers.
  - Standardize comprehensive 4-round scorecard.
- [ ] **Step 2: Update `StudentProjects.jsx`**
  - Standardize project cards, completeness score gauges, and external repository links.
  - Standardize architectural critique view, predicted interview questions, and create/edit modal.
- [ ] **Step 3: Tier 4C Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
- [ ] **Step 4: Commit Tier 4C**
  - Commit message: `feat(simulation-projects): standardize placement simulation and projects views`

---

### Task 8 (Tier 4D): Campus Drives, Resume Upload & Profile Modules

**Files:**
- Modify: `frontend/src/pages/student/StudentDrives.jsx`
- Modify: `frontend/src/pages/student/StudentResumeUpload.jsx`
- Modify: `frontend/src/pages/student/StudentProfile.jsx`

**Interfaces:**
- Consumes: `studentApi.getAvailableDrives`, `studentApi.applyToDrive`, `studentApi.getResume`, `studentApi.uploadResume`, `studentApi.getProfile`, `studentApi.updateProfile`.
- Produces: Standardized drive cards, eligibility badges, apply modal with `font-sans` textarea, resume upload dropzone, 9-dimension scorecard, and profile form.

- [ ] **Step 1: Update `StudentDrives.jsx`**
  - Standardize drive cards, salary/package badges, eligibility indicators, and apply modal.
- [ ] **Step 2: Update `StudentResumeUpload.jsx`**
  - Standardize upload dropzone, 9-dimension analysis scorecard, version switcher tabs, and recommendations list.
- [ ] **Step 3: Update `StudentProfile.jsx`**
  - Standardize form layout, 44px text inputs, common roles select, interactive skill tags, and save button.
- [ ] **Step 4: Tier 4D Validation Checkpoint**
  - Run: `npm test` in `frontend` (Expected: 201 passed).
- [ ] **Step 5: Commit Tier 4D**
  - Commit message: `feat(drives-resume-profile): standardize campus drives, resume upload, and profile views`

---

### Task 9 (Tier 5): Final Acceptance, Theme, Responsive & Build Verification

**Files:**
- Verification only: All modified frontend files and build artifacts.

**Interfaces:**
- Consumes: Complete codebase, test runner, Vite bundler.
- Produces: Fully verified, regression-free, cohesive PrepWin application.

- [ ] **Step 1: Run complete automated test suite**
  - Run: `npm test` in `frontend`
  - Expected: 201 passed in 24 suites (100% pass).
- [ ] **Step 2: Run production build**
  - Run: `npm run build` in `frontend`
  - Expected: Clean build with zero errors.
- [ ] **Step 3: Verify light and dark mode consistency**
  - Validate contrast ratios and surface tokens on Assessment Setup, Dashboard, and Modules.
- [ ] **Step 4: Verify responsive viewports**
  - Check layouts at 375px (Mobile), 768px (Tablet), 1280px (Laptop), and 1536px+ (Desktop).
- [ ] **Step 5: Generate Final Comprehensive Audit & Implementation Report**
  - Document all inspected files, modified files, verification commands, and test results.

---

## Rollback & Regression Handling

- **Isolating Regressions:** Because each tier is committed independently with an accompanying checkpoint, any unexpected test failure or visual regression can be isolated to the exact tier.
- **Rollback Strategy:** If a regression is detected during a tier:
  1. Inspect the git diff for that specific tier: `git diff HEAD~1`.
  2. If the issue is a simple token mismatch, patch it immediately and re-run `npm test`.
  3. If the regression is structural, revert the tier's commit cleanly (`git revert HEAD --no-edit`) without affecting earlier verified tiers.
- **Unrelated User Work:** No changes are made to backend files, database schemas, or untracked archives, preserving all user assets.

---

## Final Verification Checklist

- [ ] All 201 automated tests passing (`npm test`).
- [ ] Production build succeeds without errors (`npm run build`).
- [ ] Existing wording preserved 100% across all pages.
- [ ] Existing business logic, calculations, and APIs unchanged.
- [ ] Light and dark themes visually inspected and verified.
- [ ] Responsive layouts verified at 375px, 768px, 1280px, and 1536px+.
- [ ] Actual results reported with evidence; zero unverified assertions.
