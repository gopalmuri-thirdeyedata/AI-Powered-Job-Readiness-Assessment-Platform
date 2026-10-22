# Resume Analyzer and Resume Formatter - Design

Date: 2026-10-22
Audience: students only (own resume). Backend endpoints are written so a recruiter page can reuse them later.

## Goal

Give students a detailed resume analysis, with or without a job description, and let them turn their
existing resume into one of three ATS-friendly templates they can download as PDF or DOCX.

## Scope

In scope:
- Rename the existing **Resume** sidebar entry to **Resume Analyzer** and add a mode switch (without JD / with JD).
- New JD-match analysis endpoint.
- New **Resume Formatter** page and endpoint, three templates, PDF and DOCX download.

Out of scope (first version):
- Recruiter-side pages.
- Persisting JD analyses or formatted resumes to the database.
- Editing resume content inside the Formatter.

## Sidebar

`navItems` in `frontend/src/layouts/StudentLayout.jsx`:
- `Resume` becomes `Resume Analyzer`, path `/student/resume` unchanged.
- New `Resume Formatter`, path `/student/resume-formatter`, lazy route in `App.jsx` under the `StudentLayout` routes
  (both the `/student/...` and relative route blocks that already exist for `resume`).

## Resume Analyzer

Page: `frontend/src/pages/student/StudentResumeUpload.jsx` gains a two-card mode switch at the top.

- **Without Job Description**: the current flow, unchanged (upload, 9-dimension analysis, scores, versions).
- **With Job Description**: source is either a new upload or the latest saved resume version, plus a pasted JD
  (minimum 50 characters). Result panel shows:
  - match score (0-100) and fit verdict: `Strong`, `Good`, `Partial`, `Weak`
  - matched skills and missing skills
  - strengths and weaknesses relative to the JD
  - experience and qualification fit notes
  - tailored recommendations

Backend: `POST /api/student/resume/analyze-jd` in `routers/student.py`.
- Multipart: optional `file`, optional `resume_id`, required `job_description`. Exactly one resume source is required.
- Uses `get_current_student_profile`, so the same auth and ownership rules apply; `resume_id` must belong to the caller.
- Text extraction via `extract_resume_text`; analysis via a new `analyze_resume_against_jd` in
  `services/student_resume_analyzer.py` using `gemini_client.call_gemini`.
- Prompt forbids inventing skills, experience or metrics. Output is validated and clamped (scores 0-100, lists of strings).
- Fallback when Gemini is unavailable: keyword overlap between resume and JD produces the matched and missing skills and a
  proportional score, flagged `ai_generated: false`.
- File rules match `/resume/upload`: PDF, DOCX, DOC, TXT, max 10 MB, non-empty. The uploaded file is not persisted.
- Response is not stored.

## Resume Formatter

Page: new `frontend/src/pages/student/StudentResumeFormatter.jsx`.

Flow: choose source (upload or latest saved) -> structure extracted -> three template previews side by side ->
click to select -> download PDF or DOCX.

Backend: `POST /api/student/resume/format` in `routers/student.py`.
- Same source and file rules as `analyze-jd` (no JD).
- New `extract_structured_resume` in `services/student_resume_analyzer.py` returns:
  `name, contact{email, phone, location, links[]}, summary, skills[], experience[{title, company, dates, bullets[]}],
  projects[{name, description, bullets[], tech[]}], education[{degree, institution, dates, details}], certifications[]`.
- Content comes only from the document. Missing sections are returned empty and omitted from templates.
- Fallback without Gemini: heuristic section splitter (headings and bullets) so the page still works.
- Response is not stored.

Templates (all single column, standard headings Summary / Skills / Experience / Projects / Education / Certifications,
no tables, columns, icons or images):
- **Classic**: serif headings, rules between sections.
- **Modern**: sans-serif, accent-coloured section headings.
- **Compact**: tighter spacing and smaller type, aimed at one page.

Rendering is a pure function of the structured data, in one frontend module `resumeTemplates.js` shared by the
preview, PDF and DOCX paths so all three agree.

Downloads:
- **PDF**: generated client-side with `jspdf` text calls, so text is selectable and parseable by ATS (not a screenshot).
- **DOCX**: generated client-side with the `docx` npm package (new dependency), using real headings and bullet paragraphs.
- File name `<Name>_Resume_<Template>.pdf|docx`.

## Errors and edge cases

- Unsupported type, empty file, oversize, unreadable scan (extracted text under 40 characters): 400 with a clear message,
  shown inline on the page.
- JD too short or missing: validated on client and server.
- Gemini failure: silent fallback with a visible note that a basic analysis was used.
- A 401 is handled by the existing token-refresh interceptor in `studentApi.js`.

## Testing

- Backend (pytest, TestClient): both endpoints for valid input, empty file, bad extension, missing JD, other student's
  `resume_id` rejected, and the no-Gemini fallback path.
- Frontend: source-grep tests in the style of the existing `frontend/test_*.test.mjs` files (routes, nav items, endpoints,
  template names, download buttons); a template-render test over a sample structured resume.
- All new UI is mobile responsive (previews stack on small screens, mode cards stack).

## Files touched

- `backend/routers/student.py`, `backend/services/student_resume_analyzer.py`, `backend/schemas.py`, `backend/tests/` (new tests)
- `frontend/src/layouts/StudentLayout.jsx`, `frontend/src/App.jsx`, `frontend/src/services/studentApi.js`
- `frontend/src/pages/student/StudentResumeUpload.jsx`, `frontend/src/pages/student/StudentResumeFormatter.jsx` (new),
  `frontend/src/utils/resumeTemplates.js` (new), `frontend/package.json` (adds `docx`)
