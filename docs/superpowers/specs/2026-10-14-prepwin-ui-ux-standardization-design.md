# PrepWin UI/UX Standardization & Design System Specification

- **Project:** PrepWin — Job Readiness Platform
- **Date:** 2026-10-14
- **Role:** Principal UI/UX Designer, Senior Frontend Engineer, Design Systems Architect, Accessibility Specialist
- **Status:** Finalized Design Specification

---

## 1. Executive Summary & Objective

The objective of this specification is to audit, improve, and standardize the visual design and user experience across the entire PrepWin application. The goal is to transform the platform into a cohesive, modern, professional, minimal, beautiful, responsive, and production-ready interface (10/10 quality) where all pages feel like integral parts of one carefully crafted product rather than a collection of independently designed views.

### Verified Starting Baseline
- **Automated Tests:** 201 passing tests across 24 test suites (`npm test` passed 100% in 622ms).
- **Production Bundle Build:** `npm run build` compiled cleanly in 36.04s with zero errors (`vite v5.4.21`).
- **Known Unrelated Warnings:** `caniuse-lite` database is 10 months old (harmless build notice, documented separately).
- **Docker Stack:** 5/5 containers running healthy on port `8212`.

---

## 2. Mandatory Safeguards & Migration Governance

All 12 Component Standardization Safeguards and 12 Migration Governance rules are enforced as non-negotiable architectural requirements:

1. **Strict Wording Preservation:** Never rename, rewrite, remove, or replace existing page titles, headings, navigation labels, button text, form labels, placeholder text, tab names, menu items, feature names, informational text, or status labels.
2. **Strict Functionality Preservation:** Do not modify business logic, backend logic, API endpoints, request/response payloads, database schemas, authentication, assessment generation, scoring calculations, form validation rules, or permissions.
3. **Workflow Continuity:** Preserve the exact sequence of user actions across Assessment Setup, Test Taking, Score Reporting, and Dashboard navigation.
4. **Zero Fabrication:** No dummy statistics, fake charts, or mocked metrics.
5. **Backward-Compatible Token Migration:** Preserve existing token names (`--rr-*`, `--s-*`, `--brand`) as aliases pointing to the new unified palette until all component consumers are migrated.
6. **Reusable Component Primitives First:** Establish standardized styling tokens and components before applying changes to individual student pages.
7. **Independent Theme Verification:** Validate light and dark modes independently on every modified screen.
8. **Responsive Breakpoints:** Verify layouts at 375px (Mobile), 768px (Tablet), 1280px (Laptop), and 1536px+ (Desktop).
9. **Component Inspection Pre-Migration:** Inspect existing component dependencies before altering shared styles.
10. **Preserve Interactive Handlers:** Preserve existing icons, click handlers, keyboard interactions, loading states, and disabled behavior.
11. **Visible Focus & Contrast:** Ensure visible keyboard focus rings and compliant contrast ratios in both light and dark themes.
12. **Honest Reporting:** Distinguish verified test execution from unexecuted checks; document limitations transparently.

---

## 3. Design System Architecture & Tokens

### 3.1 Explicit Semantic Color Palette

The specification establishes explicit, accessible semantic tokens across both light and dark themes:

| Semantic Token | Light Theme Value | Dark Theme Value | Purpose & Contrast Specification |
| :--- | :--- | :--- | :--- |
| **`--brand-primary`** | `#059669` (Emerald 600) | `#10B981` (Emerald 500) | Primary brand accent; white text (`#FFFFFF`) on `#059669` achieves WCAG AA compliant 4.6:1 contrast |
| **`--brand-hover`** | `#047857` (Emerald 700) | `#059669` (Emerald 600) | Hover & active pressed state for primary interactive elements |
| **`--brand-light`** | `#ECFDF5` (Emerald 50) | `rgba(16, 185, 129, 0.15)` | Subtle pill backgrounds, active tabs, icon badge containers |
| **`--brand-faint`** | `rgba(5, 150, 105, 0.05)`| `rgba(16, 185, 129, 0.06)` | Ultra-subtle card highlights and table hover fills |
| **`--bg-main`** | `#F8FAFC` (Slate 50) | `#0B1220` (Dark Slate 950) | Top-level viewport background |
| **`--bg-card`** | `#FFFFFF` (Pure White) | `#111B2E` (Surface Slate 900) | Elevated cards, modals, dropdown panels |
| **`--bg-input`** | `#F8FAFC` (Slate 50) | `#0F172A` (Input Slate 900) | Text fields, textareas, file dropzones |
| **`--border-default`**| `#E2E8F0` (Slate 200) | `#1E293B` (Slate 800) | Primary container, card, and input boundaries |
| **`--border-subtle`** | `#F1F5F9` (Slate 100) | `#16233B` (Slate 850) | Dividers, table row borders, nested wells |
| **`--text-primary`** | `#0F172A` (Slate 900) | `#F8FAFC` (Slate 50) | Headings, card titles, key metric numbers (high contrast) |
| **`--text-secondary`**| `#64748B` (Slate 500) | `#94A3B8` (Slate 400) | Subtitles, supporting copy, labels (accessible secondary) |
| **`--text-muted`** | `#94A3B8` (Slate 400) | `#64748B` (Slate 500) | Microcopy, helper hints, timestamps |
| **`--semantic-info`** | `#2563EB` (Blue 600) | `#60A5FA` (Blue 400) | Informational callouts and guide tags |
| **`--semantic-warn`** | `#D97706` (Amber 600) | `#FBBF24` (Amber 400) | Warning badges, medium readiness indicators |
| **`--semantic-error`**| `#DC2626` (Red 600) | `#F87171` (Red 400) | Form validation errors, critical alerts |

> **Contrast Rule:** Primary buttons use `#FFFFFF` text on `#059669` (light mode) and `#FFFFFF` text on `#047857` or `#0B1220` text on `#10B981` (dark mode) to guarantee crisp, readable text with a contrast ratio exceeding 4.5:1 under WCAG 2.1 AA.

### 3.2 CSS Variables Mapping (`frontend/src/index.css`)

```css
:root {
  /* Explicit Semantic Tokens */
  --brand-primary:   #059669;
  --brand-hover:     #047857;
  --brand-light:     #ECFDF5;
  --brand-faint:     rgba(5, 150, 105, 0.05);

  --bg-main:         #F8FAFC;
  --bg-surface:      #FFFFFF;
  --bg-card:         #FFFFFF;
  --bg-input:        #F8FAFC;
  --border-default:  #E2E8F0;
  --border-subtle:   #F1F5F9;
  --border-strong:   #CBD5E1;

  --text-primary:    #0F172A;
  --text-secondary:  #64748B;
  --text-muted:      #94A3B8;

  /* Backward Compatibility Aliases for RoleReady & Student Platform */
  --brand:           var(--brand-primary);
  --brand-dark:      var(--brand-hover);
  --rr-bg:           var(--bg-main);
  --rr-surface:      var(--bg-surface);
  --rr-card:         var(--bg-card);
  --rr-input:        var(--bg-input);
  --rr-border:       var(--border-default);
  --rr-border-md:    var(--border-strong);
  --rr-text:         var(--text-primary);
  --rr-text-2:       #334155;
  --rr-muted:        var(--text-secondary);
  --rr-faint:        var(--text-muted);

  --s-bg:            var(--bg-main);
  --s-surface:       var(--bg-surface);
  --s-card:          var(--bg-card);
  --s-border:        var(--border-default);
  --s-border-md:     var(--border-strong);
  --s-emerald:       var(--brand-primary);
  --s-emerald-d:     var(--brand-hover);
  --s-text:          var(--text-primary);
  --s-muted:         var(--text-secondary);
}

.dark {
  --brand-primary:   #10B981;
  --brand-hover:     #059669;
  --brand-light:     rgba(16, 185, 129, 0.15);
  --brand-faint:     rgba(16, 185, 129, 0.06);

  --bg-main:         #0B1220;
  --bg-surface:      #111B2E;
  --bg-card:         #111B2E;
  --bg-input:        #0F172A;
  --border-default:  #1E293B;
  --border-subtle:   #16233B;
  --border-strong:   #334155;

  --text-primary:    #F8FAFC;
  --text-secondary:  #94A3B8;
  --text-muted:      #64748B;

  --brand:           var(--brand-primary);
  --brand-dark:      var(--brand-hover);
  --rr-bg:           var(--bg-main);
  --rr-surface:      var(--bg-surface);
  --rr-card:         var(--bg-card);
  --rr-input:        var(--bg-input);
  --rr-border:       var(--border-default);
  --rr-border-md:    var(--border-strong);
  --rr-text:         var(--text-primary);
  --rr-text-2:       #CBD5E1;
  --rr-muted:        var(--text-secondary);
  --rr-faint:        var(--text-muted);

  --s-bg:            var(--bg-main);
  --s-surface:       var(--bg-surface);
  --s-card:          var(--bg-card);
  --s-border:        var(--border-default);
  --s-border-md:     var(--border-strong);
  --s-emerald:       var(--brand-primary);
  --s-emerald-d:     var(--brand-hover);
  --s-text:          var(--text-primary);
  --s-muted:         var(--text-secondary);
}
```

### 3.3 Tailwind Configuration Clean-Up (`frontend/tailwind.config.js`)
- Remove non-standard color overrides (such as mapping `indigo` to `#76B828`), restoring native Tailwind colors while designating `emerald` as the canonical brand primary.
- Standardize `font-sans` to `['Inter', 'system-ui', '-apple-system', 'sans-serif']`.

---

## 4. Component Standardization Specifications

### 4.1 Buttons & Interactive States
Every interactive button must implement 7 comprehensive visual states:
1. **Default:** Crisp background, visible text, rounded corners (`rounded-xl`), subtle border when secondary.
2. **Hover:** Subtle brightness shift or shade transition (`hover:bg-emerald-700` or `dark:hover:bg-slate-800`).
3. **Focus:** Explicit keyboard focus indicator visible in both themes: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900`.
4. **Active:** Pressed state with micro-compression (`active:scale-[0.99]` or active background deepening).
5. **Disabled:** Clearly communicative disabled state: `disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none`.
6. **Loading:** Disabled interaction, spinner icon, preserved button dimensions to avoid layout shift.
7. **Error (where applicable):** Boundary highlight and error text association.

- **Primary Button:** `h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-sm shadow-xs hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`
- **Secondary Button:** `h-11 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200 font-semibold text-sm transition-all shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 flex items-center justify-center gap-2 cursor-pointer`
- **Ghost Button:** `h-9 px-3 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70 font-medium text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`
- **Destructive Button:** `h-11 px-4 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/40 hover:bg-red-100 text-sm font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500`

### 4.2 Cards & Surfaces
- **Standard Card:** `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-2xl p-6 shadow-xs transition-colors`
- **Metric Stat Card:** `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all`
- **Well / Nested Container:** `bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800/80 rounded-xl p-3.5 transition-colors`

### 4.3 Form Inputs & Textarea Typography
- **Text Input & Select:** `h-11 px-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium`
- **Ordinary Textarea (Job Description, Notes, Descriptions):**
  - **Font Rule:** Ordinary textareas MUST use regular application font (`font-sans`), readable size (`text-sm`), and comfortable line height (`leading-relaxed`).
  - **Monospace Restriction:** `font-mono` is strictly forbidden for regular textareas and is reserved solely for code editor fields or technical syntax blocks.
  - **Classes:** `min-h-[120px] p-3.5 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl text-sm font-sans text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 leading-relaxed resize-y transition-all`
- **Inline Validation Error:** `text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5 mt-1.5`

### 4.4 Status Badges & Chips
- **High / Verified:** `px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60`
- **Medium / Pending:** `px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60`
- **Low / Foundation:** `px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60`
- **Neutral / Topic:** `px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700`

---

## 5. Navigation & Layout Harmonization (Approach A)

### 5.1 RoleReadyNavbar (`frontend/src/components/RoleReadyNavbar.jsx`)
- Height standardized to 64px (`h-16`) to match StudentLayout header height.
- Consistent brand mark lockup: `logo_main.png` + "PrepWin" bold wordmark + "Job Readiness Platform" subtitle.
- Prominent breadcrumb return link: `<Link to="/student/dashboard" className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 flex items-center gap-1.5">← Back to Dashboard</Link>`.
- Identical user profile pill and dark/light theme switch as in `StudentLayout`.

### 5.2 StudentLayout (`frontend/src/layouts/StudentLayout.jsx`)
- Standardized active navigation indicator: crisp 3px emerald vertical pill on the left border, with subtle `bg-emerald-50 dark:bg-emerald-500/10` and `text-emerald-800 dark:text-emerald-300 font-semibold`.
- Remove divergent per-item rainbow glows in favor of brand green hierarchy.
- Preserve all 11 existing routes, labels, icons, and keyboard shortcuts.

---

## 6. Five-Tier Migration Strategy with Validation Checkpoints

### Tier 1: Design Tokens & Theme Foundation
- **Files:** `frontend/src/index.css`, `frontend/tailwind.config.js`
- **Actions:** Define explicit semantic tokens (`--brand-primary`, `--bg-main`, etc.) and maintain full backward-compatible alias mappings (`--rr-*`, `--s-*`). Restore native Tailwind colors.
- **Checkpoint 1:**
  - Run `npm test` -> must pass 201/201 tests.
  - Run `npm run build` -> must build cleanly.
  - Verify CSS variable resolution in browser DevTools for both light and dark themes.

### Tier 2: Shared Components & Navigation
- **Files:** `frontend/src/components/RoleReadyNavbar.jsx`, `frontend/src/layouts/StudentLayout.jsx`
- **Actions:** Synchronize navbar height to 64px, standardize brand lockup, add dashboard breadcrumb, unify profile pill and theme switcher, clean up sidebar active indicators.
- **Checkpoint 2:**
  - Run `npm test` -> must pass 201/201 tests.
  - Verify navigation links, active states, collapse/expand toggle, and breadcrumbs in both themes.

### Tier 3: Core Pages (Assessment Setup & Student Dashboard)
- **Files:** `frontend/src/pages/roleready/RoleReadySetup.jsx`, `frontend/src/pages/student/StudentDashboard.jsx`, `frontend/src/components/student/StudentPerformanceView.jsx`
- **Actions:**
  - Assessment Setup: Standardize form cards, 44px text inputs, `font-sans text-sm` textarea for Job Description, dropzone styling, 44px primary start button, error banners.
  - Student Dashboard: Standardize top view switcher tabs, circular score gauge card, metric cards, recent assessments list, empty states.
- **Checkpoint 3:**
  - Run `npm test` -> must pass 201/201 tests.
  - Verify form validation error triggers, resume dropzone file attachment, and dashboard metrics in both light and dark themes.

### Tier 4: Student Career Modules
- **Files:**
  - `frontend/src/pages/student/StudentSkillGap.jsx` (Taxonomy benchmark selector, match score gauge, what-if simulator)
  - `frontend/src/pages/student/StudentRoadmap.jsx` (Week navigation tabs, daily task cards, status badges, regeneration dialog)
  - `frontend/src/pages/student/StudentPractice.jsx` (Category pills, topic badges, code editor sandbox card, aptitude MCQ cards)
  - `frontend/src/pages/student/StudentMockInterview.jsx` (Track cards, STAR guidelines, conversational turns, session scorecard)
  - `frontend/src/pages/student/StudentPlacementSimulation.jsx` (Round stepper, round workspace cards, scorecard overview)
  - `frontend/src/pages/student/StudentProjects.jsx` (Project cards, architectural critique view, create/edit modal)
  - `frontend/src/pages/student/StudentDrives.jsx` (Campus drive cards, eligibility badges, apply modal)
  - `frontend/src/pages/student/StudentResumeUpload.jsx` (Upload dropzone, 9-dimension analysis scorecard, version switcher)
  - `frontend/src/pages/student/StudentProfile.jsx` (Target role select, input fields, skill tag inputs, save action)
- **Checkpoint 4:**
  - Run `npm test` after each logical group:
    - 4A: Skill Gap & Roadmap
    - 4B: Practice & Mock Interview
    - 4C: Placement Simulation & Projects
    - 4D: Campus Drives, Resume Upload & Profile
  - Any regression detected immediately halts progress until resolved.

### Tier 5: Final Acceptance & Regression Testing
- **Actions:**
  - Run complete automated test suite (`npm test`).
  - Run complete production build (`npm run build`).
  - Verify critical workflows: Assessment Setup initialization, Resume Upload, Dashboard navigation, Practice question submission.
  - Verify responsive layouts at 375px, 768px, 1280px, and 1536px+.
  - Verify light and dark mode consistency on all screens.
  - Document any unrelated warnings separately.
- **Checkpoint 5:** Final acceptance sign-off.

---

## 7. Testing & Acceptance Criteria

1. **Automated Test Suite:** Full suite execution (`npm test`) must pass with 201/201 tests passing (100%).
2. **Production Build:** `npm run build` must compile cleanly without build errors.
3. **Visual Regression:** Assessment Setup and Student Dashboard look and feel like parts of the same cohesive product.
4. **Wording Integrity:** Zero changed words across titles, labels, placeholders, or buttons.
5. **Theme Integrity:** Verified in both light mode and dark mode without contrast violations.
6. **Responsiveness:** Verified across mobile (375px), tablet (768px), laptop (1280px), and desktop (1536px+).
7. **Execution Honesty:** Every reported result reflects an actually executed command or inspection.
