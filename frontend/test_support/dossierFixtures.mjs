// Candidate scenarios for the shared Candidate Dossier pipeline tests (admin dossier + the student endpoint view of the same candidate).
const lorem = 'Isolation levels specify how and when changes made by one transaction become visible to others, trading consistency for throughput.';

export const adminDossier = ({ long = true, incomplete = false, minimal = false, notStarted = false } = {}) => {
  const base = {
    candidate: { id: 1, name: 'Suprit Roy', email: 'suprit.roy@example.com', phone: minimal ? '' : '+91 98765 43210', registered_at: '2026-10-25T10:30:00Z' },
    job_role: { id: 7, title: 'Senior Full Stack Engineer', company_name: minimal ? null : 'ThirdEye Data' },
    status: notStarted ? 'REGISTERED' : incomplete ? 'IN_PROGRESS' : 'COMPLETED',
    session: null, report: null, timeline: [], retests: [],
    actions: { can_revoke: false, can_authorize_retake: false, can_reject_review: false, can_retry_evaluation: false },
  };
  if (notStarted) return base;
  const apt = { score: 85, status: 'EVALUATED', proctoring: { count: 0, events: [] }, details: { total: 15, correct: 13, questions: Array.from({ length: long ? 15 : 3 }, (_, i) => ({ id: i + 1, question: `Question ${i + 1}: which option best describes the time complexity of operation ${i + 1} on a balanced search tree?`, selected: 'O(log n)', correct_key: i % 4 ? 'O(log n)' : 'O(n)', is_correct: i % 4 !== 0 })) } };
  const cod = { score: 90, status: 'EVALUATED', proctoring: minimal ? { count: 0, events: [] } : { count: 2, events: [{ type: 'FULLSCREEN_EXIT', timestamp: '2026-10-25T11:25:00Z' }, { type: 'TAB_SWITCH', timestamp: '2026-10-25T11:30:00Z' }] }, details: { problems: Array.from({ length: long ? 2 : 1 }, (_, i) => ({ id: 100 + i, title: `Two Sum Problem ${i + 1}`, language: 'python', score: 100, passed_tests: 10, total_tests: 10, classification: 'ALL_PASSED', message: null, code: 'def twoSum(nums, target):\n    lookup = {}\n' + Array.from({ length: long ? 30 : 6 }, (_, k) => `    value_${k} = lookup.get(target - nums[${k}], None)  # step ${k}`).join('\n') })) } };
  const itv = { score: 87.5, status: 'EVALUATED', proctoring: { count: 0, events: [] }, details: { summary: minimal ? '' : 'Demonstrated deep conceptual knowledge of distributed systems and clean API design.', technical_depth_score: 82, communication_score: 91, key_strengths: ['Clear structure', 'Trade-off awareness'], key_areas_for_improvement: ['Caching depth'], questions: Array.from({ length: long ? 6 : 2 }, (_, i) => ({ id: 200 + i, topic: 'Databases', question_text: `Explain how you approach optimistic locking in database transactions (variant ${i + 1}).`, score: 90, response: lorem + ' ' + lorem, explanation: 'Clear, accurate explanation covering retry semantics and trade-offs.', strengths: ['Retry semantics'], gaps: [] })), transcript: minimal ? [] : Array.from({ length: long ? 70 : 4 }, (_, i) => ({ role: i % 2 ? 'candidate' : 'ai', text: `${i % 2 ? 'Candidate answer' : 'Interviewer question'} ${i + 1}: ${lorem}` })) } };
  const unattempted = { score: null, status: 'UNATTEMPTED', proctoring: { count: 0, events: [] }, details: {} };
  const sections = incomplete ? { aptitude: apt, coding: unattempted, interview: unattempted } : { aptitude: apt, coding: cod, interview: itv };
  return {
    ...base,
    session: { state: incomplete ? 'IN_PROGRESS' : 'COMPLETED', started_at: '2026-10-25T11:00:00Z', finalized_at: incomplete ? null : '2026-10-25T12:15:00Z', rules_acknowledged_at: minimal ? null : '2026-10-25T10:59:00Z', incident_reference_id: null },
    report: { scoring_model: 'equal_v1', overall_score: incomplete ? null : 87.5, sections },
    timeline: incomplete
      ? [{ section: 'aptitude', status: 'EVALUATED', started_at: '2026-10-25T11:00:00Z', submitted_at: '2026-10-25T11:20:00Z', time_spent_seconds: 1200 }, { section: 'coding', status: 'IN_PROGRESS', started_at: '2026-10-25T11:21:00Z', submitted_at: null, time_spent_seconds: 300 }, { section: 'interview', status: 'UNATTEMPTED', started_at: null, submitted_at: null, time_spent_seconds: 0 }]
      : [{ section: 'aptitude', status: 'EVALUATED', started_at: '2026-10-25T11:00:00Z', submitted_at: '2026-10-25T11:20:00Z', time_spent_seconds: 1200 }, { section: 'coding', status: 'EVALUATED', started_at: '2026-10-25T11:21:00Z', submitted_at: '2026-10-25T11:51:00Z', time_spent_seconds: 1800 }, { section: 'interview', status: 'EVALUATED', started_at: '2026-10-25T11:52:00Z', submitted_at: '2026-10-25T12:15:00Z', time_spent_seconds: 1380 }],
    retests: long && !minimal ? [{ retest_uuid: 'r1', label: 'Coding', status: 'COMPLETED', original_score: 60, retest_score: 90, assigned_at: '2026-10-26T09:00:00Z', assigned_by: 'admin@thirdeyedata.ai', completed_at: '2026-10-26T10:00:00Z', accepted_as_effective_score: true, email: { status: 'SENT' }, reason: 'Code runner failed during the original sitting' }] : [],
  };
};

/** What the student endpoint returns for the SAME completed candidate (the server's whitelist view). */
export const studentReport = ({ long = true } = {}) => {
  const d = adminDossier({ long });
  const s = d.report.sections;
  return {
    assessment: { title: d.job_role.title, role: d.job_role.title, organization: d.job_role.company_name },
    student: { name: d.candidate.name, email: d.candidate.email },
    completed_at: '2026-10-25T12:15:00Z', overall_score: d.report.overall_score, overall_status: 'COMPLETED', scoring_model: 'equal_v1',
    sections: [
      { key: 'aptitude', label: 'Aptitude', status: 'EVALUATED', score: s.aptitude.score, time_spent_seconds: 1200, summary: { correct: s.aptitude.details.correct, total: s.aptitude.details.total }, questions: s.aptitude.details.questions.map((q) => ({ question: q.question, domain: 'Data structures', selected: q.selected, is_correct: q.is_correct })) },
      { key: 'coding', label: 'Coding', status: 'EVALUATED', score: s.coding.score, time_spent_seconds: 1800, problems: s.coding.details.problems.map((p) => ({ title: p.title, language: p.language, passed_tests: p.passed_tests, total_tests: p.total_tests, score: p.score, message: p.message })) },
      { key: 'interview', label: 'AI Technical Interview', status: 'EVALUATED', score: s.interview.score, time_spent_seconds: 1380, summary: s.interview.details.summary, technical_depth_score: 82, communication_score: 91, key_strengths: s.interview.details.key_strengths, key_areas_for_improvement: s.interview.details.key_areas_for_improvement, questions: s.interview.details.questions.map((q) => ({ topic: q.topic, question: q.question_text, score: q.score, status: 'EVALUATED', feedback: q.explanation, strengths: q.strengths, gaps: q.gaps })) },
    ],
  };
};
