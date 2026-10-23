// Candidate capability storage for the shared-link assessment.
//
//  * registration token  -> sessionStorage (per share link), cleared once the attempt starts
//  * rules acknowledgement flag -> sessionStorage (per share link); the SERVER enforces it again when the attempt is started
//  * session uuid + token -> sessionStorage (identifies the sitting; survives reload but is useless without the lease)
//  * session LEASE        -> module memory ONLY. It is never written to localStorage, sessionStorage, cookies or the URL.
//                            A reload (or a duplicated tab) therefore loses it, which is what makes "no resume" enforceable.
//
// Nothing candidate-related is ever written to localStorage.

const REG_PREFIX = 'pw_reg:';
const ACK_PREFIX = 'pw_ack:';
const SESSION_KEY = 'pw_assessment_session';

const memory = { lease: null };

const store = () => {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
};

export const setLease = (lease) => {
    memory.lease = lease || null;
};
export const getLease = () => memory.lease;
export const clearLease = () => {
    memory.lease = null;
};

export const saveRegistration = (shareToken, registrationToken) => {
    try {
        store()?.setItem(REG_PREFIX + shareToken, registrationToken);
    } catch { /* storage unavailable: the candidate simply has to register again */ }
};
export const loadRegistration = (shareToken) => {
    try {
        return store()?.getItem(REG_PREFIX + shareToken) || null;
    } catch {
        return null;
    }
};
export const clearRegistration = (shareToken) => {
    try {
        store()?.removeItem(REG_PREFIX + shareToken);
    } catch { /* ignore */ }
};

export const saveAcknowledgement = (shareToken) => {
    try {
        store()?.setItem(ACK_PREFIX + shareToken, '1');
    } catch { /* storage unavailable: the candidate acknowledges again on the instructions page */ }
};
export const hasAcknowledged = (shareToken) => {
    try {
        return store()?.getItem(ACK_PREFIX + shareToken) === '1';
    } catch {
        return false;
    }
};
export const clearAcknowledgement = (shareToken) => {
    try {
        store()?.removeItem(ACK_PREFIX + shareToken);
    } catch { /* ignore */ }
};

export const saveSession = ({ uuid, token, shareToken = null }) => {
    try {
        store()?.setItem(SESSION_KEY, JSON.stringify({ uuid, token, shareToken }));
    } catch { /* ignore */ }
};
export const loadSession = () => {
    try {
        const raw = store()?.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};
export const clearSession = () => {
    try {
        store()?.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
};
