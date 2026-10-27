// Small, framework-free helpers for the voice-interview lifecycle in the shared assessment workspace.
// Kept separate from the component so the behaviour can be unit tested without a browser, a microphone or the voice service.

/** The voice connection must reach "call-start" within this time or the candidate is offered a retry (never a silent hang). */
const envTimeout = (() => {
    try { return Number(import.meta.env.VITE_VOICE_CONNECT_TIMEOUT_MS); } catch { return NaN; }   // test builds shorten the watchdog
})();
export const VOICE_CONNECT_TIMEOUT_MS = envTimeout > 0 ? envTimeout : 30000;

/**
 * ALWAYS a string. The browser, the voice session and the API deliver errors as strings OR as nested objects ({ type, msg, details }, { detail: {...} });
 * putting one of those objects into JSX throws "Objects are not valid as a React child" and white-screens the candidate in the
 * middle of an assessment. Walk the usual message fields (bounded depth) and fall back to the supplied text.
 */
export const toDisplayText = (value, fallback = '') => {
    const seen = new Set();
    const dig = (v, depth) => {
        if (v == null || depth > 4) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v !== 'object' || seen.has(v)) return '';
        seen.add(v);
        for (const key of ['message', 'msg', 'errorMsg', 'detail', 'error', 'details', 'reason']) {
            const found = dig(v[key], depth + 1);
            if (found) return found;
        }
        return '';
    };
    return dig(value, 0) || fallback;
};

const text = (value) => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

/**
 * Classify a voice-session / getUserMedia error into something the candidate can act on.
 * @returns {{ kind: 'permission'|'no_device'|'device_busy'|'insecure'|'network'|'unknown', message: string }}
 */
export const classifyVoiceError = (err) => {
    const raw = `${err?.name || ''} ${err?.message || ''} ${text(err?.error)} ${text(err?.errorMsg)} ${text(err)}`.toLowerCase();
    if (/notallowederror|permission|denied|mic-blocked|blockedby|blocked by|not allowed/.test(raw)) {
        return {
            kind: 'permission',
            message: 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then choose Retry Connection.',
        };
    }
    if (/notfounderror|not-found|devicesnotfound|requested device not found|no microphone|no audio input/.test(raw)) {
        return { kind: 'no_device', message: 'No microphone was found. Connect a microphone, then choose Retry Connection.' };
    }
    if (/notreadableerror|in-use|in use|could not start audio source|trackstarterror/.test(raw)) {
        return { kind: 'device_busy', message: 'Your microphone is being used by another application. Close it, then choose Retry Connection.' };
    }
    if (/secure context|insecure|mediadevices.*undefined/.test(raw)) {
        return { kind: 'insecure', message: 'The microphone is only available on a secure (HTTPS) connection.' };
    }
    if (/network|failed to fetch|timeout|timed out|ice|connection|offline|unreachable/.test(raw)) {
        return { kind: 'network', message: 'The voice connection could not be established. Check your network, then choose Retry Connection.' };
    }
    return { kind: 'unknown', message: toDisplayText(err, 'Failed to establish the voice session. Choose Retry Connection.') };
};

/**
 * Stop a voice session and detach every listener so a stale instance can never update state (or end a newer call) later.
 * Safe to call with null, twice, or on an instance that already ended.
 */
export const disposeVoice = (voice) => {
    if (!voice) return;
    try { voice.stop(); } catch { /* already stopped */ }
    try { if (typeof voice.removeAllListeners === 'function') voice.removeAllListeners(); } catch { /* ignore */ }
};

/**
 * HTTP statuses that mean the SERVER has closed this attempt (deadline passed, attempt closed, section already submitted):
 * the candidate must be taken out of the interview, not asked to retry. Anything else (network error, 5xx, 401/403)
 * means the submission may not have been recorded and must be retried - it must never be shown as "completed".
 */
export const isClosedAttemptStatus = (status) => status === 408 || status === 409 || status === 410;

/** The message to show when an interview submission did not reach the server. */
export const interviewSubmitErrorMessage = (err) => {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail;
    if (!err?.response) return 'Your answers could not be sent. Check your connection and choose Submit & Complete again.';
    if (typeof detail === 'string' && detail) return `${detail} Choose Submit & Complete to try again.`;
    return `Submission failed (${status}). Choose Submit & Complete to try again.`;
};
