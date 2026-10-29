// API adapters for the shared assessment workspace (pages/roleready/RoleReadyAssessment.jsx -> AssessmentWorkspace).
//
// The workspace (aptitude, Monaco coding, voice interview, timers, drafts, proctoring) is ONE implementation used by both
// workflows. It talks to the server only through the small interface below, so each workflow keeps its own authentication,
// attempt management and endpoints:
//
//   getSession() startAptitude() submitAptitude(answers, spent, violations) startCoding() runCode(problemId, code, language)
//   submitCoding(solutions, spent, violations) startInterview() initVoice() voiceTurn(turn) submitInterview(answers, spent, violations, transcript)
//   saveDraft(section, payload, violations) terminate(reason, violations, stage)
//
// Student  -> /api/roleready/session/*   (student JWT or invitation token; services/rolereadyApi.js)
// Candidate-> /api/public/assessment/*   (share link -> registration capability -> session capability + in-memory lease)
import rolereadyApi from './rolereadyApi';
import { candidateApi } from './recruitmentApi';
import { clearRegistration, hasAcknowledged, loadRegistration, saveSession, setLease } from './assessmentSession';

export const createStudentAssessmentApi = (sessionUuid) => ({
    kind: 'student',
    getSession: () => rolereadyApi.getSessionStatus(sessionUuid),
    startAptitude: () => rolereadyApi.startAptitude(sessionUuid),
    submitAptitude: (answers, spent, violations) => rolereadyApi.submitAptitude(sessionUuid, answers, spent, violations),
    startCoding: () => rolereadyApi.startCoding(sessionUuid),
    runCode: (problemId, code, language, customInput) => rolereadyApi.runCodeTest(sessionUuid, problemId, code, language, customInput),
    submitCoding: (solutions, spent, violations) => rolereadyApi.submitCoding(sessionUuid, solutions, spent, violations),
    startInterview: () => rolereadyApi.startInterview(sessionUuid),
    initVoice: () => rolereadyApi.initVoiceSession(sessionUuid),
    voiceTurn: (turn) => rolereadyApi.voiceTurn(sessionUuid, turn),
    voiceCaptionSession: () => rolereadyApi.voiceCaptionSession(sessionUuid),                 // student only; candidates use the browser's own captions
    voiceTurnStream: (turn, options) => rolereadyApi.voiceTurnStream(sessionUuid, turn, options),     // student only; candidates use the plain turn
    submitInterview: (answers, spent, violations, transcript) => rolereadyApi.submitInterview(sessionUuid, answers, spent, violations, transcript),
    saveDraft: (section, payload) => rolereadyApi.saveDraft(sessionUuid, section, payload),
    terminate: (reason, violations, stage) => rolereadyApi.terminateSession(sessionUuid, reason, violations, stage),
    // credential for /api/proctor/analyze-frame: the stored student token / invitation token (the hook's default)
    proctorHeaders: null,
});

const TERMINAL = new Set(['COMPLETED', 'TIMED_OUT', 'ABANDONED', 'EVALUATION_PENDING', 'INFRASTRUCTURE_FAILURE', 'MANUAL_REVIEW_REQUIRED', 'REVOKED_RETRIED']);

// A server detail may be an object ({ message, state }); the workspace renders `detail` as text.
const readable = (err) => {
    const detail = err?.response?.data?.detail;
    if (detail && typeof detail === 'object' && err.response) {
        err.response.data = { ...err.response.data, detail: detail.message || 'The request could not be completed.' };
    }
    return err;
};

/**
 * Recruitment adapter. The shared workspace is mounted BEFORE the attempt exists (device check), and the explicit
 * "Start Assessment" click inside it calls startAptitude(), which is where the server creates the attempt, records the rules
 * acknowledgement and starts the 60-minute deadline. Nothing before that click touches the clock.
 *   meta            public metadata of the shared link (title, role, organization_name)
 *   onSession       called once with { uuid, token, lease } when the attempt exists (the page starts its heartbeat)
 *   onTerminalState called with the latest server state whenever it reports a terminal state
 */
export const createRecruitmentAssessmentApi = ({ shareToken, meta = {}, onSession = null, onTerminalState = null }) => {
    let session = null;
    let startPromise = null;
    let lastState = null;

    const need = () => {
        if (!session) throw readable({ response: { status: 409, data: { detail: 'The assessment has not started yet.' } } });
        return session;
    };
    const timing = (state) => ({
        remaining_seconds: state?.section?.remaining_seconds,
        overall_remaining_seconds: state?.overall_remaining_seconds,
        deadline_at: state?.section?.deadline_at,
        started_at: state?.section?.started_at,
        server_time: state?.server_time,
        time_limit_minutes: 20,
    });
    const remember = (state) => {
        lastState = state;
        if (state?.terminal && onTerminalState) onTerminalState(state);
        return state;
    };
    const mapSession = (state) => ({
        session_uuid: session?.uuid ?? null,
        current_state: state.state,
        target_role: meta.role || meta.title,
        target_company: meta.organization_name,
        is_completed: !!state.terminal,
        coding_unlocked: ['CODING_IN_PROGRESS', 'INTERVIEW_IN_PROGRESS'].includes(state.state),
        interview_unlocked: state.state === 'INTERVIEW_IN_PROGRESS',
        message: state.message,
        ...timing(state),
    });
    // A section the server already closed / advanced (408 deadline, 503 evaluation pending) resolves with the state it reports.
    const submit = async (call) => {
        try {
            return remember(await call());
        } catch (err) {
            const status = err?.response?.status;
            const detail = err?.response?.data?.detail;
            if ((status === 408 || status === 503) && detail && typeof detail === 'object' && detail.state) {
                remember(detail);
                return { ...detail, status: 'success' };
            }
            throw readable(err);
        }
    };
    const section = (state, key) => {
        if (!state?.section || state.section.key !== key) {
            throw readable({ response: { status: 409, data: { detail: state?.message || `The ${key} section is not active.` } } });
        }
        return state;
    };

    return {
        kind: 'recruitment',
        // credential for /api/proctor/analyze-frame: the sitting's capability (no student account, no lease)
        proctorHeaders: () => (session ? { 'X-Session-Id': session.uuid, 'X-Session-Token': session.token } : {}),
        getHandle: () => session,
        getLastState: () => lastState,

        getSession: async () => {
            if (!session) {
                return { session_uuid: null, current_state: 'NOT_STARTED', is_completed: false, coding_unlocked: false, interview_unlocked: false,
                         target_role: meta.role || meta.title, target_company: meta.organization_name };
            }
            try {
                return mapSession(remember(await candidateApi.state(session)));
            } catch (err) {
                throw readable(err);
            }
        },

        startAptitude: async () => {
            if (!session) {
                if (!startPromise) {   // one in-flight start at a time; a second click can never create a second attempt
                    startPromise = (async () => {
                        const registration = loadRegistration(shareToken);
                        if (!registration) {
                            throw readable({ response: { status: 403, data: { detail: 'Your registration was not found in this window. Please register again from your assessment link.' } } });
                        }
                        let res;
                        try {
                            res = await candidateApi.start(shareToken, registration, hasAcknowledged(shareToken));
                        } catch (err) {
                            if ([403, 409, 410].includes(err?.response?.status)) clearRegistration(shareToken);   // spent: it can never be used again
                            throw readable(err);
                        }
                        clearRegistration(shareToken);                                       // single use: consumed by this attempt
                        session = { uuid: res.session_uuid, token: res.session_token, lease: res.session_lease };
                        saveSession({ uuid: session.uuid, token: session.token, shareToken });   // identity (sessionStorage)
                        setLease(session.lease);                                             // volatile lease: in-memory ONLY
                        remember(res.state);
                        if (onSession) onSession(session);
                        return res.state;
                    })().finally(() => { startPromise = null; });
                }
                const state = section(await startPromise, 'aptitude');
                return { session_uuid: session.uuid, current_state: state.state, questions: state.section.questions, ...timing(state) };
            }
            try {
                const state = section(remember(await candidateApi.state(session)), 'aptitude');
                return { session_uuid: session.uuid, current_state: state.state, questions: state.section.questions, ...timing(state) };
            } catch (err) {
                throw readable(err);
            }
        },

        submitAptitude: (answers, _spent, violations) => submit(() => candidateApi.submitAptitude(need(), answers, violations)),

        startCoding: async () => {
            try {
                const state = section(remember(await candidateApi.startCoding(need())), 'coding');
                return { session_uuid: session.uuid, current_state: state.state, problems: state.section.questions, ...timing(state) };
            } catch (err) {
                throw readable(err);
            }
        },
        runCode: async (problemId, code, language, customInput) => {
            try {
                return await candidateApi.runCode(need(), problemId, code, language, customInput);
            } catch (err) {
                throw readable(err);
            }
        },
        submitCoding: (solutions, _spent, violations) => submit(() => candidateApi.submitCoding(need(), solutions, violations)),

        startInterview: async () => {
            try {
                const state = section(remember(await candidateApi.startInterview(need())), 'interview');
                return { session_uuid: session.uuid, current_state: state.state, questions: state.section.questions, ...timing(state) };
            } catch (err) {
                throw readable(err);
            }
        },
        initVoice: async () => {
            try {
                return await candidateApi.voiceInit(need());
            } catch (err) {
                throw readable(err);
            }
        },
        voiceTurn: (turn) => candidateApi.voiceTurn(need(), turn),
        voiceCaptionSession: () => candidateApi.voiceCaptionSession(need()),
        voiceTurnStream: (turn, options) => candidateApi.voiceTurnStream(need(), turn, options),
        submitInterview: (answers, _spent, violations, transcript) => submit(() => candidateApi.submitInterview(need(), answers, transcript, violations)),

        saveDraft: async (sectionKey, payload, violations) => {
            if (!session) return { saved: false };
            return candidateApi.saveDraft(session, sectionKey, payload, violations);
        },
        // Recruitment never terminates an attempt on a browser-side proctoring event (policy 'flag'); events are saved with the drafts.
        terminate: async () => ({ status: 'ignored' }),
        isTerminalState: (state) => TERMINAL.has(state),
    };
};
