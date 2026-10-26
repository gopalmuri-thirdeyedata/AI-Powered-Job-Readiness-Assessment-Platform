/**
 * Browser side of PrepWin's local authentication.
 *
 * The credential is an HttpOnly session cookie set by the backend: page JavaScript can neither read nor store it, and nothing
 * secret is written to localStorage / sessionStorage. This module only keeps, IN MEMORY, the non-secret account summary returned
 * by /api/auth/me and the per-session CSRF token the backend requires on state-changing requests.
 *
 * Authorization is always enforced by the server; the role held here only drives what the UI shows.
 */
import axios from 'axios';
import API_URL from '../apiConfig';

let state = { isLoaded: false, user: null, csrfToken: null, error: null };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
const setState = (next) => { state = { ...state, ...next }; emit(); };

export const getAuthState = () => state;
export const subscribeAuth = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LEGACY_STORAGE_KEYS = [
    'admin_token', 'admin_user', 'prepwin_org_id', 'user_profile', 'token',
    'student_token', 'studentToken', 'student_user', 'student_user_email',
];

/** Account summary as the UI consumes it (server fields + `id` / `fullName` / `primaryEmailAddress` aliases for older components). */
const toUser = (me) => !me ? null : ({
    ...me,
    id: me.user_id,
    fullName: me.full_name || null,
    firstName: (me.full_name || '').split(' ')[0] || null,
    primaryEmailAddress: { emailAddress: me.email },
});

const isApiUrl = (url) => {
    if (typeof url !== 'string') return false;
    return API_URL ? url.startsWith(`${API_URL}/`) : url.startsWith('/api/');
};

const purgeLegacyStorage = () => {
    // Earlier versions kept long-lived bearer tokens here. They are never read any more; remove them.
    try { LEGACY_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
};

let installed = false;
/** Cookie credentials + CSRF header for every request to the PrepWin API, through axios and fetch. Idempotent. */
export const installHttpClient = () => {
    if (installed) return;
    installed = true;

    axios.defaults.withCredentials = true;
    axios.interceptors.request.use((config) => {
        const method = (config.method || 'get').toUpperCase();
        const url = config.baseURL ? `${config.baseURL}${config.url || ''}` : (config.url || '');
        if (UNSAFE.has(method) && state.csrfToken && isApiUrl(url)) {
            config.headers = config.headers || {};
            if (typeof config.headers.set === 'function') {
                if (!config.headers.has('X-CSRF-Token')) config.headers.set('X-CSRF-Token', state.csrfToken);
            } else if (!config.headers['X-CSRF-Token']) {
                config.headers['X-CSRF-Token'] = state.csrfToken;
            }
        }
        return config;
    });
    // A 401 on an authenticated call means the server ended the session (expiry, sign-out elsewhere, deactivation):
    // re-read the truth so guards send the user to the login.
    axios.interceptors.response.use(undefined, (error) => {
        const url = error?.config?.url || '';
        if (error?.response?.status === 401 && isApiUrl(url) && state.user && !url.includes('/api/auth/login')) {
            refreshSession();
        }
        return Promise.reject(error);
    });

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!isApiUrl(url)) return nativeFetch(input, init);
        const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
        const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
        if (UNSAFE.has(method) && state.csrfToken && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', state.csrfToken);
        return nativeFetch(input, { ...init, headers, credentials: init.credentials || 'include' });
    };
};

let inFlight = null;
/** Asks the server who the cookie belongs to. Never throws; a network failure is reported through `error`, not as "signed out". */
export const refreshSession = () => {
    if (!inFlight) {
        inFlight = fetch(`${API_URL}/api/auth/me`, { credentials: 'include', cache: 'no-store' })
            .then(async (res) => {
                if (res.ok) {
                    const me = await res.json();
                    setState({ isLoaded: true, user: toUser(me), csrfToken: me.csrf_token || null, error: null });
                } else {
                    setState({ isLoaded: true, user: null, csrfToken: null, error: null });
                }
            })
            .catch(() => setState({ isLoaded: true, error: 'network' }))
            .finally(() => { inFlight = null; });
    }
    return inFlight;
};

export const initAuth = async () => {
    installHttpClient();
    purgeLegacyStorage();
    await refreshSession();
};

const messageFrom = async (res, fallback) => {
    try {
        const data = await res.json();
        if (typeof data?.detail === 'string') return data.detail;
        if (Array.isArray(data?.detail) && data.detail.length) {
            return data.detail.map((d) => (typeof d === 'string' ? d : d?.msg)).filter(Boolean).join(' ');
        }
    } catch { /* not JSON */ }
    return fallback;
};

/** Signs in with e-mail + password. Resolves with the server response (`role`, `redirect` come from the stored account). */
export const login = async (email, password) => {
    installHttpClient();
    let res;
    try {
        res = await fetch(`${API_URL}/api/auth/login/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), password }),
        });
    } catch {
        throw new Error('Network problem. Please check your connection and try again.');
    }
    if (!res.ok) {
        throw new Error(await messageFrom(res, 'Sign-in failed. Please try again.'));
    }
    const data = await res.json();
    setState({ isLoaded: true, user: toUser({ ...data.user }), csrfToken: data.csrf_token || null, error: null });
    purgeLegacyStorage();
    return data;
};

/** Ends the server-side session and clears local state. The UI is signed out even if the request cannot reach the server. */
export const logout = async () => {
    try {
        await fetch(`${API_URL}/api/auth/logout/`, { method: 'POST', credentials: 'include' });
    } catch { /* offline: the cookie expires on its own */ }
    try {
        Object.keys(localStorage).filter((k) => k.startsWith('student_completed_assessment')).forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
    purgeLegacyStorage();
    setState({ isLoaded: true, user: null, csrfToken: null, error: null });
};

/** Replaces the CSRF token after a call that rotated the session (change-password). */
export const setCsrfToken = (token) => setState({ csrfToken: token || null });
