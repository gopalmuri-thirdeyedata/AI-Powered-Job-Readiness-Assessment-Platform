// Pure rules of the recruitment (shared-link) assessment: what counts as an integrity event, when the attempt ends, and how a reload
// restores a sitting. No React, no network. The server re-checks every number (POST .../terminate answers 400 if the limits are not exceeded),
// so these functions only decide WHEN the browser asks.
//
//   - switching to another tab ("Tab Switch" events only; a blur / lost window focus is ignored) more than MAX_TAB_SWITCHES times => disqualified
//   - more than MAX_INTEGRITY_EVENTS integrity events of any kind                                                  => attempt ended
//   - the "reload" event the server records on a resume never counts toward either limit, but stays in the list that is sent back.
// Student assessments (policy 'terminate', three strikes) do not use any of this.

export const RESUME_EVENT = 'Page reloaded (assessment resumed)';
export const MAX_TAB_SWITCHES = 1;
export const MAX_INTEGRITY_EVENTS = 5;

// Only a real TAB SWITCH (document.visibilitychange -> hidden) is a focus event now; losing window focus (blur) is ignored for recruitment
// (the server treats only "Tab Switch" events as focus events: assessment_flow_service._FOCUS_EVENT_MARKERS).
const FOCUS_MARKERS = ['tab switch'];

export const isResumeEvent = (type) => type === RESUME_EVENT;
export const isFocusEvent = (type) => {
    const low = String(type || '').toLowerCase();
    return FOCUS_MARKERS.some((m) => low.includes(m));
};

/** The events that count: everything except the resume marker. */
export const countedEvents = (list) => (Array.isArray(list) ? list : []).filter((e) => e && !isResumeEvent(e.type));

/** { count, switches }: counted events, and how many of them were the candidate switching tabs. */
export const tallyEvents = (list) => {
    const counted = countedEvents(list);
    return { count: counted.length, switches: counted.filter((e) => isFocusEvent(e.type)).length };
};

/**
 * What to do after an event was added to `list`.
 *   { action: 'terminate', disqualified, reason }  the attempt must end now
 *   { action: 'warn_focus' }                        this was the first (allowed) tab switch: warn that the next one disqualifies
 *   { action: 'none' }
 */
export const decideRecruitmentAction = (list, latestType = '') => {
    const { count, switches } = tallyEvents(list);
    if (switches > MAX_TAB_SWITCHES) return { action: 'terminate', disqualified: true, reason: 'tab_switch_limit', count, switches };
    if (count > MAX_INTEGRITY_EVENTS) return { action: 'terminate', disqualified: false, reason: 'integrity_limit', count, switches };
    if (isFocusEvent(latestType) && switches === MAX_TAB_SWITCHES) return { action: 'warn_focus', count, switches };
    return { action: 'none', count, switches };
};

export const FOCUS_WARNING = 'Switching to another tab again will disqualify you and end your assessment.';

// ── Restoring a sitting after a reload ─────────────────────────────────────────

const text = (v) => (typeof v === 'string' ? v : '');

/**
 * Everything the workspace needs to continue the SAME attempt, from the server's /resume answer:
 *   sectionKey  'aptitude' | 'coding' | 'interview'
 *   aptitudeAnswers  { [questionId]: 'A'..'D' }
 *   solutions   { [problemId]: { code, language } }  (the language the candidate was in) and buffers { [problemId]: { [language]: code } }
 *   interviewResponses { [questionId]: text }, transcript [{ id, role, text }]
 *   violations  every recorded event (resume markers included), with `counted` / `switches` already tallied
 *   timing      { remaining_seconds, overall_remaining_seconds } from the SERVER clock
 */
export const restoreFromResume = (resume) => {
    const state = resume?.state || {};
    const draft = resume?.draft || {};
    const payload = draft.payload || {};
    const sectionKey = state?.section?.key || draft.section || null;

    const aptitudeAnswers = {};
    for (const [qid, val] of Object.entries(payload.answers && !Array.isArray(payload.answers) ? payload.answers : {})) {
        const v = String(val).trim().toUpperCase();
        if (['A', 'B', 'C', 'D'].includes(v)) aptitudeAnswers[String(qid)] = v;
    }

    const solutions = {};
    const buffers = {};
    for (const [pid, sol] of Object.entries(payload.solutions && typeof payload.solutions === 'object' ? payload.solutions : {})) {
        if (!sol || typeof sol !== 'object') continue;
        const language = text(sol.language) || 'python';
        const code = text(sol.code);
        solutions[String(pid)] = { code, language };
        buffers[String(pid)] = { [language]: code };
    }

    const interviewResponses = {};
    for (const item of Array.isArray(payload.answers) ? payload.answers : []) {
        if (item && item.question_id !== undefined && text(item.response)) interviewResponses[String(item.question_id)] = item.response;
    }
    const transcript = (Array.isArray(payload.transcript) ? payload.transcript : [])
        .filter((t) => t && text(t.text))
        .map((t, i) => ({ id: `restored-${i}`, role: t.role === 'ai' || t.role === 'assistant' ? 'ai' : 'user', text: t.text, time: '' }));

    const violations = (Array.isArray(resume?.violations) ? resume.violations : []).filter((e) => e && typeof e.type === 'string');
    const { count, switches } = tallyEvents(violations);

    return {
        sectionKey, aptitudeAnswers, solutions, buffers, interviewResponses, transcript, violations, counted: count, switches,
        timing: { remaining_seconds: state?.section?.remaining_seconds, overall_remaining_seconds: state?.overall_remaining_seconds },
    };
};
