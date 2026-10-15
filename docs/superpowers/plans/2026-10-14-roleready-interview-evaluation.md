# RoleReady AI Technical Interview Answer Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve RoleReady AI technical interview answer evaluation so each of the 5 questions and follow-ups are analyzed individually with evidence-based feedback, scores, demonstrated strengths, knowledge gaps, and actionable recommendations in the final report, while preserving the existing Vapi interview flow, scoring formula, and test requirements.

**Architecture:** 
1. Frontend `RoleReadyAssessment.jsx` segments `vapiTranscript` across the 5 interview questions, bundling follow-up exchanges with their parent question, and submits structured answers and transcript.
2. Backend `interview_evaluation.py` implements `evaluate_five_technical_questions` with multi-question LLM scoring and deterministic fallback rubric; returns granular question scores, status badges, evidence quotes, correct/missing/incorrect points, and actionable advice.
3. Backend `roleready_service.py` connects `submit_interview_round` and `build_performance_dossier` to persist `question_evaluations` and embed `interview_breakdown` into the final assessment dossier.
4. Frontend `RoleReadyReport.jsx` renders the 5-question evaluation breakdown cards with scores, evidence, strengths, gaps, and recommendations.

**Tech Stack:** Python 3.11/FastAPI, SQLAlchemy, Google Gemini (`gemini_client`), React 18, TailwindCSS/Vanilla CSS tokens, Pytest.

**Spec:** User request: RoleReady — Improve Existing AI Interview Answer Evaluation.

## Global Constraints
- Preserve existing flow: Aptitude -> Coding -> Vapi AI Technical Interview -> Final Assessment Report.
- Preserve 5 questions generated per role/JD/resume in `init_vapi_interview_session`.
- Preserve overall readiness formula: `round((aptitude * 0.25) + (coding * 0.40) + (interview * 0.35), 1)`.
- Follow-ups must belong to their parent question and not count as separate primary questions.
- Empty interview answers must score 0.0 with `evaluation_source = "no_answers"` without calling Gemini.
- Gemini failures must fallback to `evaluation_source = "fallback_default"` and complete successfully with full dossier.
- All scores clamped between 0.0 and 100.0.
- No hardcoded fake scores in production; preserve student authentication and data isolation.

## Review Focus
1. **Empty / missing answers:** When a candidate says nothing or transcript is empty, score must be 0.0, evaluation source "no_answers", and Gemini must not be called.
2. **Follow-up dialogue grouping:** Follow-up questions asked by the interviewer must be associated with the current primary question and contribute to that question's score without shifting question indices.
3. **Partial vs complete answers:** Incomplete or partial answers should receive a "partially_correct" or "incomplete" status with constructive feedback rather than failing or inventing content.
4. **Resilience to AI service outages:** If Gemini API fails, deterministic fallback must evaluate each question using heuristic rubric and return valid breakdown without crashing the report.
5. **Idempotent replay:** Re-submitting the interview round should replay the existing evaluation payload identically without duplicate evaluations or score alterations.

---

### Task 1: Transcript Segmentation & Question Association in Frontend

**Files:**
- Modify: `frontend/src/services/rolereadyApi.js:112-121`
- Modify: `frontend/src/pages/roleready/RoleReadyAssessment.jsx:915-950`

**Interfaces:**
- Consumes: `vapiTranscript` (`[{ role: 'ai' | 'user', text: string, time: string }]`), `interviewQuestions` (`[{ id, question, category, evaluation_criteria }]`), `interviewResponses` (`{ [qid]: string }`).
- Produces: `rolereadyApi.submitInterview(sessionUuid, formattedAnswers, timeSpentSeconds, proctoringViolations, rawTranscript)` where each item in `formattedAnswers` contains `question_id`, `question_text`, `category`, `evaluation_criteria`, `response`, `follow_ups` (`[{ question, response }]`), and `full_dialogue`.

- [ ] **Step 1: Update `rolereadyApi.js` to accept `transcript` parameter in `submitInterview`**
- [ ] **Step 2: Implement `segmentInterviewTranscript(questions, transcript, typedResponses)` helper in `RoleReadyAssessment.jsx`**
  - Scans AI transcript turns to detect question markers ("question 1", "question 2", etc.) or sequence boundaries.
  - Associates subsequent user answers and follow-up exchanges with the active question index.
  - Combines typed responses if entered by candidate.
- [ ] **Step 3: Update `handleSubmitInterview` in `RoleReadyAssessment.jsx` to use segmented answers and pass transcript**
- [ ] **Step 4: Verify frontend syntax and bundle**

---

### Task 2: Backend Schemas and Router Support

**Files:**
- Modify: `backend/routers/roleready.py:165-170, 568-581`

**Interfaces:**
- Consumes: HTTP POST `/api/roleready/session/{session_uuid}/submit-interview` with body `{"answers": [...], "transcript": [...], "time_spent_seconds": int, "proctoring_violations": [...]}`.
- Produces: Forwards `{"answers": payload.answers or [], "transcript": payload.transcript or []}` to `roleready_service.submit_interview_round`.

- [ ] **Step 1: Add `transcript: Optional[List[Dict[str, Any]]] = None` to `InterviewSubmissionSchema`**
- [ ] **Step 2: Pass `transcript` in `submit_interview` endpoint handler**
- [ ] **Step 3: Verify with existing pytest suite**

---

### Task 3: 5-Question AI & Fallback Evaluator Service

**Files:**
- Modify: `backend/services/interview_evaluation.py`
- Test: `backend/tests/test_interview_evaluation.py`

**Interfaces:**
- Produces: `evaluate_five_technical_questions(questions, answers, role, jd_summary, resume_summary, transcript)`:
  - Returns dict with `overall_score`, `technical_depth_score`, `communication_score`, `summary`, `key_strengths`, `key_areas_for_improvement`, and `question_evaluations` (list of 5 dicts with `question_id`, `category`, `score`, `status`, `demonstrated_strengths`, `knowledge_gaps`, `evidence`, `actionable_advice`, `explanation`).
  - Empty responses return score 0.0 with `evaluation_source: "no_answers"` without calling Gemini.
  - On Gemini error or offline, calls `fallback_evaluate_five_technical_questions` returning `evaluation_source: "fallback_default"`.

- [ ] **Step 1: Write unit tests in `backend/tests/test_interview_evaluation.py` covering:**
  - Empty answers return 0.0 and `no_answers` without AI call.
  - Complete answers scored with 5 question breakdowns.
  - Follow-up responses counted with parent question.
  - AI failure cleanly triggers deterministic fallback with 5 question breakdowns and `fallback_default`.
  - Scores clamped to 0-100.
- [ ] **Step 2: Run test to verify it fails initially**
- [ ] **Step 3: Implement `evaluate_five_technical_questions` and `fallback_evaluate_five_technical_questions` in `backend/services/interview_evaluation.py`**
- [ ] **Step 4: Run tests to verify they pass**

---

### Task 4: Integrate 5-Question Evaluation with Session Service and Dossier

**Files:**
- Modify: `backend/services/roleready_service.py:1417-1488, 2120-2210`

**Interfaces:**
- Consumes: `evaluate_five_technical_questions` from `backend/services/interview_evaluation.py`.
- Produces:
  - Stored `int_round.evaluation_payload` containing `question_evaluations`, `key_strengths`, `key_areas_for_improvement`, `technical_depth_score`, `communication_score`.
  - `build_performance_dossier` includes `interview_breakdown`, `interview_question_scores`, and enriches `areas_for_improvement` and `personalized_recommendations`.
  - Preserves exact contract for `test_roleready_plan_requirements.py` (`test_ai_failure_still_completes_with_fallback_dossier_and_flags_source`, `test_empty_interview_never_calls_ai_and_scores_zero`, etc.).

- [ ] **Step 1: Connect `evaluate_five_technical_questions` in `submit_interview_round` in `roleready_service.py`**
- [ ] **Step 2: Enrich `build_performance_dossier` with `interview_breakdown` from `RoleReadyRoundAttempt.evaluation_payload`**
- [ ] **Step 3: Run existing and new test suites in `backend/tests`**

---

### Task 5: Interactive 5-Question Report Presentation in Frontend

**Files:**
- Modify: `frontend/src/pages/roleready/RoleReadyReport.jsx`

**Interfaces:**
- Consumes: `final_report.interview_breakdown` (or `final_report.question_evaluations`), `interview_score`, `final_report.interview_technical_depth_score`, `final_report.interview_communication_score`.
- Produces: Rendered UI component showing:
  - Interview Score Header with Technical Depth and Communication Clarity gauges.
  - 5-Question expandable/collapsible cards with category, score badge, status badge (`Correct`, `Partially Correct`, `Needs Improvement`, `Unanswered`), candidate evidence quotes, verified strengths, knowledge gaps, and actionable advice.
  - Safe fallback when question evaluations are not yet present (backward compatibility with earlier sessions).

- [ ] **Step 1: Add interview breakdown rendering section to `RoleReadyReport.jsx`**
- [ ] **Step 2: Add responsive styling using existing design system tokens**
- [ ] **Step 3: Verify build via Vite (`npm run build` or frontend container check)**

---

### Task 6: End-to-End Verification and Container Rebuild

**Files:**
- All modified files
- Docker containers (`hiringai_backend_prod`, `hiringai_frontend_prod`)

- [ ] **Step 1: Run complete backend pytest suite (`pytest backend/tests -v`)**
- [ ] **Step 2: Sync files to Docker containers or rebuild if necessary**
- [ ] **Step 3: Test API endpoints using curl/Invoke-WebRequest for submit-interview and get-report**
- [ ] **Step 4: Verify frontend report page renders properly without errors**
