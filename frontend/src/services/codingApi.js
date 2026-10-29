import axios from 'axios';
import API_URL from '../apiConfig';
import { isStudentDemo } from '../utils/studentDemo';
import { codingHandlers } from './demo/practiceCoding';

// Authentication is the HttpOnly session cookie plus the CSRF header, both added by the auth client (auth/authSession.js).
const BASE = `${API_URL}/api/student/coding`;
const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };

const realCodingApi = {
    async getProblems({ difficulty, tag, status, q, bookmarked } = {}) {
        const params = {};
        if (bookmarked) params.bookmarked = true;
        if (difficulty) params.difficulty = difficulty;
        if (tag) params.tag = tag;
        if (status) params.status = status;
        if (q) params.q = q;
        return (await axios.get(`${BASE}/problems`, { headers, params })).data;
    },

    async getProblem(slug) {
        return (await axios.get(`${BASE}/problems/${encodeURIComponent(slug)}`, { headers })).data;
    },

    async run(slug, code, customInput) {
        return (await axios.post(`${BASE}/problems/${encodeURIComponent(slug)}/run`,
            { code, custom_input: customInput ?? null }, { headers, timeout: 60000 })).data;
    },

    async submit(slug, code) {
        return (await axios.post(`${BASE}/problems/${encodeURIComponent(slug)}/submit`, { code }, { headers, timeout: 90000 })).data;
    },

    async bookmark(slug) {
        return (await axios.post(`${BASE}/problems/${encodeURIComponent(slug)}/bookmark`, null, { headers })).data;
    },

    async getSubmissions(slug) {
        return (await axios.get(`${BASE}/problems/${encodeURIComponent(slug)}/submissions`, { headers })).data;
    },

    async getSubmission(id) {
        return (await axios.get(`${BASE}/submissions/${id}`, { headers })).data;
    },
};

// On a Student Dashboard Demo route every call is answered from sample data: no request, no code runner (see utils/studentDemo.js).
export const codingApi = new Proxy(realCodingApi, {
    get(target, name, receiver) {
        if (typeof name !== 'string' || !isStudentDemo()) return Reflect.get(target, name, receiver);
        const handler = codingHandlers[name];
        return handler
            ? (...args) => Promise.resolve(handler(...args)).then((v) => (v === undefined ? v : structuredClone(v)))
            : () => Promise.reject(new Error(`${name} is not part of the demo`));
    },
});

export default codingApi;
