import axios from 'axios';
import API_URL from '../apiConfig';
import { getAdminOrgId } from '../utils/authStorage';

// ------------------------------------------------------------------------------
// Admin API (HttpOnly session cookie + CSRF header added by the auth client; tenant resolved server-side)
// ------------------------------------------------------------------------------
const adminHeaders = () => {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    const org = getAdminOrgId();
    if (org) headers['X-Organization-Id'] = String(org);
    return headers;
};

const adminGet = async (path, params) => (await axios.get(`${API_URL}${path}`, { headers: adminHeaders(), params })).data;
const adminPost = async (path, body = {}, timeout) => (await axios.post(`${API_URL}${path}`, body, { headers: adminHeaders(), timeout })).data;

export const adminApi = {
    listRoles: () => adminGet('/api/admin/job-roles/'),
    getRole: (id) => adminGet(`/api/admin/job-roles/${id}`),
    createRole: (body) => adminPost('/api/admin/job-roles/', body),
    updateRole: async (id, body) => (await axios.put(`${API_URL}/api/admin/job-roles/${id}`, body, { headers: adminHeaders() })).data,
    // "Upload File" option of the New Job Role form: multipart upload, returns { text, filename, ... }. Nothing is created server side.
    extractDescription: async (file, { onUploadProgress, signal } = {}) => {
        const body = new FormData();
        body.append('file', file);
        const headers = adminHeaders();
        delete headers['Content-Type']; // the browser sets the multipart boundary
        return (await axios.post(`${API_URL}/api/admin/job-roles/extract-description`, body, { headers, onUploadProgress, signal, timeout: 60000 })).data;
    },
    generateBlueprint: (id) => adminPost(`/api/admin/job-roles/${id}/generate-blueprint`, {}, 120000),
    publishRole: (id) => adminPost(`/api/admin/job-roles/${id}/publish`),
    closeRole: (id) => adminPost(`/api/admin/job-roles/${id}/close`),
    newShareLink: (id) => adminPost(`/api/admin/job-roles/${id}/new-link`),
    // Optional e-mail invitations (copying the shared link by hand does not use any of this)
    listShareStudents: (id, q) => adminGet(`/api/admin/job-roles/${id}/share-students`, q ? { q } : undefined),
    sendInvitations: (id, studentIds) => adminPost(`/api/admin/job-roles/${id}/invitations`, { student_ids: studentIds }, 120000),
    overview: () => adminGet('/api/admin/recruitment/overview-stats'),
    listCandidates: (params) => adminGet('/api/admin/recruitment/candidates', params),
    dossier: (id) => adminGet(`/api/admin/recruitment/candidates/${id}/dossier`),
    revokeRegistration: (id) => adminPost(`/api/admin/recruitment/registrations/${id}/revoke`),
    authorizeRetake: (id, justification) => adminPost(`/api/admin/recruitment/candidates/${id}/authorize-retake`, { justification }),
    rejectReview: (id, justification) => adminPost(`/api/admin/recruitment/candidates/${id}/reject-review`, { justification }),
    retryEvaluation: (id) => adminPost(`/api/admin/recruitment/candidates/${id}/retry-evaluation`, {}, 120000),
};

// ------------------------------------------------------------------------------
// Candidate API (public, capability based: no accounts, no OTP)
// ------------------------------------------------------------------------------
const PUBLIC = `${API_URL}/api/public/assessment`;
const jsonHeaders = { Accept: 'application/json', 'Content-Type': 'application/json' };
const sessionHeaders = (s) => {
    const h = { ...jsonHeaders };
    if (s?.token) h['X-Session-Token'] = s.token;
    if (s?.lease) h['X-Session-Lease'] = s.lease; // the lease lives in memory only (see assessmentSession.js)
    return h;
};
const sessionUrl = (s, path) => `${PUBLIC}/session/${s.uuid}/${path}`;

export const candidateApi = {
    getMeta: async (shareToken) => (await axios.get(`${PUBLIC}/${shareToken}`)).data,
    // For a handed-over (retake) token: is it usable, and must its holder sign in as a student first? Starts nothing.
    registrationInfo: async (shareToken, registrationToken) =>
        (await axios.post(`${PUBLIC}/${shareToken}/registration-info`, {}, { headers: { ...jsonHeaders, 'X-Registration-Token': registrationToken } })).data,
    register: async (shareToken, body) => (await axios.post(`${PUBLIC}/${shareToken}/register`, body, { headers: jsonHeaders })).data,
    // The server refuses to start without the rules acknowledgement (acknowledged: true) and creates the attempt + deadline only here.
    start: async (shareToken, registrationToken, acknowledged = false) =>
        (await axios.post(`${PUBLIC}/${shareToken}/start`, { acknowledged: acknowledged === true },
            { headers: { ...jsonHeaders, 'X-Registration-Token': registrationToken } })).data,

    state: async (s) => (await axios.get(sessionUrl(s, 'state'), { headers: sessionHeaders(s) })).data,
    heartbeat: async (s) => (await axios.post(sessionUrl(s, 'heartbeat'), {}, { headers: sessionHeaders(s), timeout: 10000 })).data,
    // Autosave; `violations` are client-reported proctoring events kept as evidence for the hiring team
    saveDraft: async (s, section, payload, violations) =>
        (await axios.put(sessionUrl(s, 'draft'), { section, payload, violations: violations ?? null }, { headers: sessionHeaders(s) })).data,
    submitAptitude: async (s, answers, violations) =>
        (await axios.post(sessionUrl(s, 'submit-aptitude'), { answers, violations: violations ?? null }, { headers: sessionHeaders(s), timeout: 60000 })).data,
    startCoding: async (s) => (await axios.post(sessionUrl(s, 'start-coding'), {}, { headers: sessionHeaders(s) })).data,
    runCode: async (s, problemId, code, language = 'python') =>
        (await axios.post(sessionUrl(s, 'run-code'), { problem_id: problemId, language, code }, { headers: sessionHeaders(s), timeout: 60000 })).data,
    submitCoding: async (s, solutions, violations) =>
        (await axios.post(sessionUrl(s, 'submit-coding'), { solutions, violations: violations ?? null }, { headers: sessionHeaders(s), timeout: 180000 })).data,
    startInterview: async (s) => (await axios.post(sessionUrl(s, 'start-interview'), {}, { headers: sessionHeaders(s) })).data,
    vapiInit: async (s) => (await axios.post(sessionUrl(s, 'vapi-init'), {}, { headers: sessionHeaders(s), timeout: 60000 })).data,
    submitInterview: async (s, answers, transcript, violations) =>
        (await axios.post(sessionUrl(s, 'submit-interview'), { answers, transcript: transcript ?? [], violations: violations ?? null },
            { headers: sessionHeaders(s), timeout: 180000 })).data,
    finalize: async (s) => (await axios.post(sessionUrl(s, 'finalize'), {}, { headers: sessionHeaders(s) })).data,
};

// ------------------------------------------------------------------------------
// Invited-student API (the signed-in student's own session cookie + CSRF header, added by the auth client).
// Identity and role are never sent: the server takes them from the account.
// ------------------------------------------------------------------------------
const STUDENT = `${API_URL}/api/student-assessment`;
const studentGet = async (path) => (await axios.get(`${STUDENT}${path}`, { headers: { Accept: 'application/json' } })).data;
const studentPost = async (path, body = {}) => (await axios.post(`${STUDENT}${path}`, body, { headers: jsonHeaders })).data;

export const studentAssessmentApi = {
    // registration created from the account: starts nothing (no attempt, no timer)
    // retakeToken (optional): the single-use token of an administrator-authorised retake link; the server binds it to this account
    access: (shareToken, retakeToken) => studentPost(`/${shareToken}/access`, retakeToken ? { retake_token: retakeToken } : {}),
    result: (shareToken) => studentGet(`/${shareToken}/result`),
    submitReview: (sessionUuid, review) => studentPost(`/attempts/${sessionUuid}/review`, { review }),
    // the server releases the report only to the owner of a completed, evaluated attempt whose review is saved
    getReport: (sessionUuid) => studentGet(`/attempts/${sessionUuid}/report`),
};

// Server error -> short human message (supports string and {message} details)
export const errorMessage = (err, fallback = 'Something went wrong. Please try again.') => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    if (err?.code === 'ECONNABORTED' || err?.message === 'Network Error') return 'Network problem. Please check your connection.';
    return fallback;
};
