# PrepWin UI/UX Standardization & Design System Specification

- **Project:** PrepWin — Job Readiness Platform
- **Date:** 2026-10-14
- **Role:** Principal UI/UX Designer, Senior Frontend Engineer, Design Systems Architect, Accessibility Specialist
- **Status:** Validated Design Spec (Awaiting User Review)

---

## 1. Executive Summary & Objective

The objective of this specification is to audit, improve, and standardize the visual design and user experience across the entire PrepWin application. The goal is to transform the platform into a cohesive, modern, professional, minimal, beautiful, responsive, and production-ready interface (10/10 quality) where all pages feel like integral parts of one carefully crafted product rather than a collection of independently designed views.

### Verified Starting Baseline
- **Automated Tests:** 201 passing tests across 24 test suites (`npm test` passed 100% in 622ms).
- **Production Bundle Build:** `npm run build` compiled cleanly in 36.04s with zero errors.
- **Docker Stack:** 5/5 containers running healthy on port `8212`.

---

## 2. Mandatory Safeguards & Migration Governance

All 12 Component Standardization Safeguards and 12 Migration Governance rules are enforced as hard requirements:

1. **Strict Wording Preservation:** Never rename, rewrite, remove, or replace existing page titles, headings, navigation labels, button text, form labels, placeholder text, tab names, menu items, feature names, informational text, or status labels.
2. **Strict Functionality Preservation:** Do not modify business logic, backend logic, API endpoints, request/response payloads, database schemas, authentication, assessment generation, scoring calculations, form validation rules, or permissions.
3. **Workflow Continuity:** Preserve the exact sequence of user actions across Assessment Setup, Test Taking, Score Reporting, and Dashboard navigation.
4. **Zero Fabrication:** No dummy statistics, fake charts, or mocked metrics.
5. **Backward-Compatible Token Migration:** Preserve existing token names (`--rr-*`, `--s-*`, `--brand`) as aliases pointing to the new unified palette until all component consumers are migrated.
6. **Reusable Component Primitives First:** Establish standardized styling tokens and components before applying changes to individual student pages.
7. **Independent Theme Verification:** Validate light and dark modes independently on every modified screen.
8. **Responsive Breakpoints:** Verify layouts at 375px (Mobile), 768px (Tablet), 1280px (Laptop), and 1536px+ (Desktop).

---

## 3. Design System Architecture & Tokens

### 3.1 Color Palette

```
Primary Green (Brand):     #059669 (Tailwind emerald-600)
Dark Green (Hover/Active): #047857 (Tailwind emerald-700)
Light Green (Pill/Accent): #ECFDF5 (Tailwind emerald-50) / dark: rgba(16,185,129,0.12)
Main Background:           #F8FAFC (Tailwind slate-50)   / dark: #0B1220 (Slate 950)
Card Surface:              #FFFFFF (Pure White)          / dark: #111B2E (Surface Slate 900)
Input Surface:             #F8FAFC (Slate 50)            / dark: #0F172A (Input Slate 900)
Default Border:            #E2E8F0 (Slate 200)           / dark: #1E293B (Slate 800)
Subtle Border:             #F1F5F9 (Slate 100)           / dark: #16233B
Primary Text:              #0F172A (Slate 900)           / dark: #F8FAFC (Slate 50)
Secondary Text:            #64748B (Slate 500)           / dark: #94A3B8 (Slate 400)
Information Blue:          #2563EB (Blue 600)            / dark: #60A5FA (Blue 400)
Warning Amber:             #D97706 (Amber 600)           / dark: #FBBF24 (Amber 400)
Error Red:                 #DC2626 (Red 600)             / dark: #F87171 (Red 400)
```

### 3.2 CSS Variables Mapping (`frontend/src/index.css`)

```css
:root {
  /* Unified Brand Tokens */
  --brand:         #059669;
  --brand-dark:    #047857;
  --brand-light:   #ECFDF5;
  --brand-faint:   rgba(5, 150, 105, 0.05);

  /* Page Surfaces */
  --bg-main:       #F8FAFC;
  --bg-surface:    #FFFFFF;
  --bg-card:       #FFFFFF;
  --bg-input:      #F8FAFC;
  --border-subtle: #E2E8F0;
  --border-strong: #CBD5E1;

  /* Typography */
  --text-primary:   #0F172A;
  --text-secondary: #64748B;
  --text-muted:     #94A3B8;

  /* Backward Compatibility Aliases for RoleReady & Student Platform */
  --rr-bg:         var(--bg-main);
  --rr-surface:    var(--bg-surface);
  --rr-card:       var(--bg-card);
  --rr-input:      var(--bg-input);
  --rr-border:     var(--border-subtle);
  --rr-border-md:  var(--border-strong);
  --rr-text:       var(--text-primary);
  --rr-text-2:     #334155;
  --rr-muted:      var(--text-secondary);
  --rr-faint:      var(--text-muted);

  --s-bg:          var(--bg-main);
  --s-surface:     var(--bg-surface);
  --s-card:        var(--bg-card);
  --s-border:      var(--border-subtle);
  --s-border-md:   var(--border-strong);
  --s-emerald:     #059669;
  --s-emerald-d:   #047857;
  --s-text:        var(--text-primary);
  --s-muted:       var(--text-secondary);
}

.dark {
  --brand-light:   rgba(16, 185, 129, 0.12);
  --brand-faint:   rgba(16, 185, 129, 0.05);

  --bg-main:       #0B1220;
  --bg-surface:    #111B2E;
  --bg-card:       #111B2E;
  --bg-input:      #0F172A;
  --border-subtle: #1E293B;
  --border-strong: #334155;

  --text-primary:   #F8FAFC;
  --text-secondary: #94A3B8;
  --text-muted:     #64748B;

  --rr-bg:         var(--bg-main);
  --rr-surface:    var(--bg-surface);
  --rr-card:       var(--bg-card);
  --rr-input:      var(--bg-input);
  --rr-border:     var(--border-subtle);
  --rr-border-md:  var(--border-strong);
  --rr-text:       var(--text-primary);
  --rr-text-2:     #CBD5E1;
  --rr-muted:      var(--text-secondary);
  --rr-faint:      var(--text-muted);

  --s-bg:          var(--bg-main);
  --s-surface:     var(--bg-surface);
  --s-card:        var(--bg-card);
  --s-border:      var(--border-subtle);
  --s-border-md:   var(--border-strong);
  --s-text:        var(--text-primary);
  --s-muted:       var(--text-secondary);
}
```

### 3.3 Tailwind Configuration Clean-Up (`frontend/tailwind.config.js`)
- Restore standard Tailwind palette without distorting colors (remove yellow-green `#76B828` mapping from `indigo`).
- Standardize `font-sans` to `['Inter', 'system-ui', '-apple-system', 'sans-serif']`.

---

## 4. Component Standardization Specifications

### 4.1 Buttons
- **Primary:** `h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-sm shadow-xs hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`
- **Secondary:** `h-11 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200 font-semibold text-sm transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer`
- **Ghost:** `h-9 px-3 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70 font-medium text-xs transition-colors cursor-pointer`
- **Destructive:** `h-11 px-4 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/40 hover:bg-red-100 text-sm font-semibold transition-all cursor-pointer`

### 4.2 Cards & Surfaces
- **Standard Card:** `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-2xl p-6 shadow-xs transition-colors`
- **Metric Stat Card:** `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all`
- **Well / Nested Container:** `bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800/80 rounded-xl p-3.5 transition-colors`

### 4.3 Form Inputs
- **Text Input & Select:** `h-11 px-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium`
- **Textarea:** `min-h-[120px] p-3.5 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 leading-relaxed resize-y transition-all`
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

## 6. Page-by-Page Migration Scope

### Tier 1: Foundation
- `frontend/src/index.css`: Add standardized tokens while maintaining backward-compatible alias mappings.
- `frontend/tailwind.config.js`: Clean up color overrides and font family.

### Tier 2: Shared Navigation & Layouts
- `frontend/src/components/RoleReadyNavbar.jsx`: 64px height, matching user pill, breadcrumb to dashboard.
- `frontend/src/layouts/StudentLayout.jsx`: Harmonized sidebar active states, clean brand emerald indicators.

### Tier 3: Core Assessment Setup & Student Dashboard
- `frontend/src/pages/roleready/RoleReadySetup.jsx`:
  - Standardize Target Position card, Job Description card, Resume Upload card, Pipeline card.
  - Standardize 44px text inputs, role chip pills, dropzone styling, and 44px primary start button.
- `frontend/src/pages/student/StudentDashboard.jsx` & `StudentPerformanceView.jsx`:
  - Standardize segmented tab switchers (`Performance & Analytics` vs `Readiness & Career`).
  - Circular score gauge card, metric cards, recent assessments list, and empty states.

### Tier 4: Student Hub Modules
- `frontend/src/pages/student/StudentSkillGap.jsx`: Taxonomy role selector, match percentage gauge, what-if simulator inputs.
- `frontend/src/pages/student/StudentRoadmap.jsx`: Week navigation tabs, daily task cards, status badges, regeneration dialog.
- `frontend/src/pages/student/StudentPractice.jsx`: Category pills, topic badges, code editor sandbox card, aptitude MCQ cards.
- `frontend/src/pages/student/StudentMockInterview.jsx`: Track cards, STAR guidelines, conversational turns, session scorecard.
- `frontend/src/pages/student/StudentPlacementSimulation.jsx`: Round stepper, round workspace cards, scorecard overview.
- `frontend/src/pages/student/StudentProjects.jsx`: Project cards, architectural critique view, create/edit modal.
- `frontend/src/pages/student/StudentDrives.jsx`: Campus drive cards, eligibility badges, apply modal.
- `frontend/src/pages/student/StudentResumeUpload.jsx`: Upload dropzone, 9-dimension analysis scorecard, version switcher.
- `frontend/src/pages/student/StudentProfile.jsx`: Target role select, input fields, skill tag inputs, save action.

---

## 7. Verification & Acceptance Criteria

1. **Automated Test Suite:** Full suite execution (`npm test`) must pass with 201/201 tests passing.
2. **Production Build:** `npm run build` must compile cleanly without errors or warnings.
3. **Visual Regression:** Assessment Setup and Student Dashboard look and feel like parts of the same cohesive product.
4. **Wording Integrity:** Zero changed words across titles, labels, placeholders, or buttons.
5. **Theme Integrity:** Verified in both light mode and dark mode.
6. **Responsiveness:** Verified across mobile, tablet, and desktop viewports.
