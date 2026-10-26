import axios from 'axios';
import API_URL from '../apiConfig';
import { getAdminOrgId } from '../utils/authStorage';

// Admin-only User Management API. Authentication is the HttpOnly session cookie + CSRF header added by the auth client;
// the server resolves the tenant and re-checks every permission, whatever the browser sends.
const headers = () => {
    const h = { Accept: 'application/json', 'Content-Type': 'application/json' };
    const org = getAdminOrgId();
    if (org) h['X-Organization-Id'] = String(org);
    return h;
};

const BASE = `${API_URL}/api/admin/users`;

export const userManagementApi = {
    list: async ({ q, role, isActive, page = 1, pageSize = 25 } = {}) => {
        const params = { page, page_size: pageSize };
        if (q && q.trim()) params.q = q.trim();
        if (role) params.role = role;
        if (isActive === true || isActive === false) params.is_active = isActive;
        return (await axios.get(`${BASE}/`, { headers: headers(), params })).data;
    },
    get: async (id) => (await axios.get(`${BASE}/${id}`, { headers: headers() })).data,
    create: async ({ role, fullName, email, password, phone }) =>
        (await axios.post(`${BASE}/`, { role, full_name: fullName, email, password, phone: phone || null }, { headers: headers() })).data,
    update: async (id, { fullName, phone }) =>
        (await axios.patch(`${BASE}/${id}`, { full_name: fullName, phone: phone || null }, { headers: headers() })).data,
    deactivate: async (id) => (await axios.post(`${BASE}/${id}/deactivate`, {}, { headers: headers() })).data,
    activate: async (id) => (await axios.post(`${BASE}/${id}/activate`, {}, { headers: headers() })).data,
    resetPassword: async (id, newPassword) =>
        (await axios.post(`${BASE}/${id}/reset-password`, { new_password: newPassword }, { headers: headers() })).data,
};

/** Client-side mirror of the server password policy (the server remains the authority). */
export const passwordProblems = (password, email = '') => {
    const pw = password || '';
    const out = [];
    if (pw.length < 10) out.push('at least 10 characters');
    if (!/[a-z]/.test(pw)) out.push('a lowercase letter');
    if (!/[A-Z]/.test(pw)) out.push('an uppercase letter');
    if (!/[0-9]/.test(pw)) out.push('a digit');
    if (new TextEncoder().encode(pw).length > 72) out.push('at most 72 bytes');
    const local = String(email).split('@')[0].toLowerCase();
    if (local.length >= 4 && pw.toLowerCase().includes(local)) out.push('no part of the e-mail name');
    return out;
};

/** FastAPI error -> one readable sentence (field errors, string details and policy lists are all handled). */
export const apiError = (err, fallback = 'Something went wrong. Please try again.') => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
        return detail.map((d) => (typeof d === 'string' ? d : (d?.msg || '')).replace(/^Value error, /, '')).filter(Boolean).join(' ');
    }
    if (err?.response?.status === 403) return 'You do not have permission to do that.';
    if (err?.code === 'ECONNABORTED' || err?.message === 'Network Error') return 'Network problem. Please check your connection.';
    return fallback;
};
