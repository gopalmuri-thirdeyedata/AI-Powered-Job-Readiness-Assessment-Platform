// Behavioural tests for the shared-workspace API adapters (src/services/assessmentApi.js).
// axios is the recording fake from test_support: nothing here reaches a real server (mocked-API tests).
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './test_support/bundle.mjs';

const makeStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) };
};
const fail = (status, detail) => Promise.reject({ response: { status, data: { detail } } });
const state = (over = {}) => ({
    session_uuid: 'S-1', state: 'APTITUDE_IN_PROGRESS', terminal: false, server_time: '2026-03-02T09:00:00+00:00',
    overall_remaining_seconds: 3600,
    section: { key: 'aptitude', label: 'Aptitude', index: 1, total_sections: 3, started_at: 'x', deadline_at: 'y', remaining_seconds: 1200,
        questions: [{ id: 'A1', options: [{ key: 'A', text: 'a' }] }] },
    ...over,
});
const META = { title: 'Backend Engineer', role: 'Backend Engineer', organization_name: 'Acme' };

describe('recruitment adapter: the explicit start, in-memory lease and server-driven sequencing', () => {
    let api, session, createRecruitmentAssessmentApi, sessions;
    beforeEach(async () => {
        globalThis.sessionStorage = makeStorage();
        (globalThis.__axiosCalls ||= []).length = 0;
        globalThis.__axiosHandler = null;
        session = await loadModule('src/services/assessmentSession.js');
        ({ createRecruitmentAssessmentApi } = await loadModule('src/services/assessmentApi.js'));
        sessions = [];
        api = createRecruitmentAssessmentApi({ shareToken: 'SHARE', meta: META, onSession: (s) => sessions.push(s) });
    });

    test('before the explicit start nothing is sent to the server and the session reads as NOT_STARTED', async () => {
        const s = await api.getSession();
        assert.equal(s.current_state, 'NOT_STARTED');
        assert.equal(s.is_completed, false);
        assert.equal(s.target_role, 'Backend Engineer');
        assert.equal(s.target_company, 'Acme');
        assert.equal(globalThis.__axiosCalls.length, 0, 'viewing / device check never touches the clock');
        assert.deepEqual(await api.saveDraft('aptitude', { answers: {} }, []), { saved: false });
        assert.equal(globalThis.__axiosCalls.length, 0);
        assert.deepEqual(await api.terminate('x', [], 'aptitude'), { status: 'ignored' }, 'a browser-side proctoring event never terminates a recruitment attempt');
    });

    test('startAptitude creates exactly one attempt (double click), keeps the lease in memory only, consumes the registration', async () => {
        session.saveRegistration('SHARE', 'REG-1');
        session.saveAcknowledgement('SHARE');
        globalThis.__axiosHandler = (call) => (call.url.endsWith('/start')
            ? { session_uuid: 'S-1', session_token: 'TOK', session_lease: 'LEASE-SECRET', state: state() }
            : state());
        const [a, b] = await Promise.all([api.startAptitude(), api.startAptitude()]);
        const starts = globalThis.__axiosCalls.filter((c) => c.url.endsWith('/SHARE/start'));
        assert.equal(starts.length, 1, 'one in-flight start only');
        assert.deepEqual(starts[0].body, { acknowledged: true });
        assert.equal(starts[0].headers['X-Registration-Token'], 'REG-1');
        assert.equal(a.questions.length, 1);
        assert.equal(a.remaining_seconds, 1200);
        assert.equal(a.overall_remaining_seconds, 3600);
        assert.equal(b.session_uuid, 'S-1');
        assert.equal(api.getHandle().lease, 'LEASE-SECRET', 'the lease is held in memory by the adapter');
        assert.ok(!JSON.stringify(globalThis.sessionStorage.dump()).includes('LEASE-SECRET'), 'the lease never reaches storage');
        assert.equal(session.loadRegistration('SHARE'), null, 'the registration capability is single use');
        assert.deepEqual(session.loadSession(), { uuid: 'S-1', token: 'TOK', shareToken: 'SHARE' });
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].lease, 'LEASE-SECRET');
    });

    test('proctoring credential: none before the start, then only the sitting capability (never the lease, never a student token)', async () => {
        assert.deepEqual(api.proctorHeaders(), {}, 'nothing to authorize before the attempt exists');
        session.saveRegistration('SHARE', 'REG-1');
        session.saveAcknowledgement('SHARE');
        globalThis.__axiosHandler = (call) => (call.url.endsWith('/start')
            ? { session_uuid: 'S-1', session_token: 'TOK', session_lease: 'LEASE-SECRET', state: state() }
            : state());
        await api.startAptitude();
        assert.deepEqual(api.proctorHeaders(), { 'X-Session-Id': 'S-1', 'X-Session-Token': 'TOK' });
        assert.ok(!JSON.stringify(api.proctorHeaders()).includes('LEASE-SECRET'));
    });

    test('without the stored acknowledgement the request says so and the server (not this client) refuses it', async () => {
        session.saveRegistration('SHARE', 'REG-1');
        globalThis.__axiosHandler = () => fail(422, 'You must acknowledge the assessment rules before starting.');
        await assert.rejects(api.startAptitude(), (err) => err.response.data.detail.includes('acknowledge'));
        assert.deepEqual(globalThis.__axiosCalls[0].body, { acknowledged: false });
        assert.equal(session.loadRegistration('SHARE'), 'REG-1', 'a fixable refusal keeps the registration usable');
    });

    test('a spent registration (409) is cleared and surfaces a readable message', async () => {
        session.saveRegistration('SHARE', 'REG-1');
        session.saveAcknowledgement('SHARE');
        globalThis.__axiosHandler = () => fail(409, 'An assessment attempt has already been initiated for this registration.');
        await assert.rejects(api.startAptitude(), (err) => /already been initiated/.test(err.response.data.detail));
        assert.equal(session.loadRegistration('SHARE'), null);
    });

    async function started() {
        session.saveRegistration('SHARE', 'REG-1');
        session.saveAcknowledgement('SHARE');
        globalThis.__axiosHandler = (call) => (call.url.endsWith('/start')
            ? { session_uuid: 'S-1', session_token: 'TOK', session_lease: 'L', state: state() } : state());
        await api.startAptitude();
        globalThis.__axiosCalls.length = 0;
    }

    test('session state maps onto the shared workspace contract', async () => {
        await started();
        globalThis.__axiosHandler = () => state({ state: 'CODING_IN_PROGRESS', section: { ...state().section, key: 'coding' } });
        let s = await api.getSession();
        assert.deepEqual([s.current_state, s.coding_unlocked, s.interview_unlocked, s.is_completed], ['CODING_IN_PROGRESS', true, false, false]);
        globalThis.__axiosHandler = () => state({ state: 'INTERVIEW_IN_PROGRESS', section: { ...state().section, key: 'interview' } });
        s = await api.getSession();
        assert.deepEqual([s.coding_unlocked, s.interview_unlocked], [true, true]);
        globalThis.__axiosHandler = () => state({ state: 'TIMED_OUT', terminal: true, section: undefined, message: 'The assessment time limit has expired.' });
        s = await api.getSession();
        assert.equal(s.is_completed, true);
        assert.equal(api.getLastState().state, 'TIMED_OUT');
    });

    test('a section the server closed itself (408 / 503 with a state) resolves with that state instead of failing', async () => {
        await started();
        globalThis.__axiosHandler = () => fail(408, { state: 'CODING_IN_PROGRESS', message: 'Your saved work was submitted automatically.', terminal: false });
        const r = await api.submitAptitude({ A1: 'B' }, 30, []);
        assert.equal(r.state, 'CODING_IN_PROGRESS');
        globalThis.__axiosHandler = () => fail(503, { state: 'INTERVIEW_IN_PROGRESS', evaluation_pending: true, message: 'Code received. Sandbox evaluation pending.' });
        assert.equal((await api.submitCoding({}, 30, [])).state, 'INTERVIEW_IN_PROGRESS');
        globalThis.__axiosHandler = () => fail(409, { message: 'Session interrupted.' });
        await assert.rejects(api.submitInterview([], 1, [], []), (err) => err.response.data.detail === 'Session interrupted.', 'object details become readable text');
    });

    test('every section call carries the capability + lease, proctoring events and the student payload shapes', async () => {
        await started();
        globalThis.__axiosHandler = (call) => (call.url.includes('vapi-init') ? { assistantId: 'a', questions: [] } : state());
        await api.submitAptitude({ A1: 'B' }, 5, [{ type: 'Tab switch', strike: 1 }]);
        await api.runCode('C1', 'print(1)', 'java');
        await api.initVapi();
        await api.submitInterview([{ question_id: 'I1', response: 'r' }], 5, [], [{ role: 'user', text: 'r' }]);
        await api.saveDraft('coding', { solutions: {} }, [{ type: 'Blur' }]);
        for (const c of globalThis.__axiosCalls) {
            assert.equal(c.headers['X-Session-Token'], 'TOK');
            assert.equal(c.headers['X-Session-Lease'], 'L');
        }
        const by = (suffix) => globalThis.__axiosCalls.find((c) => c.url.endsWith(suffix));
        assert.deepEqual(by('/submit-aptitude').body, { answers: { A1: 'B' }, violations: [{ type: 'Tab switch', strike: 1 }] });
        assert.deepEqual(by('/run-code').body, { problem_id: 'C1', language: 'java', code: 'print(1)' });
        assert.deepEqual(by('/submit-interview').body.transcript, [{ role: 'user', text: 'r' }]);
        assert.deepEqual(by('/draft').body, { section: 'coding', payload: { solutions: {} }, violations: [{ type: 'Blur' }] });
    });

    test('startCoding refuses a section the server did not unlock', async () => {
        await started();
        globalThis.__axiosHandler = () => state();   // still aptitude
        await assert.rejects(api.startCoding(), (err) => err.response.status === 409);
    });
});

describe('student adapter: the existing student endpoints, student authentication, plus drafts', () => {
    test('calls the roleready endpoints for the given session and never a public candidate endpoint', async () => {
        globalThis.localStorage = makeStorage();
        (globalThis.__axiosCalls ||= []).length = 0;
        globalThis.__axiosHandler = () => ({});
        const { createStudentAssessmentApi } = await loadModule('src/services/assessmentApi.js');
        const api = createStudentAssessmentApi('UUID-9');
        await api.getSession();
        await api.startAptitude();
        await api.submitAptitude({ 1: 'A' }, 12, [{ type: 'x' }]);
        await api.startCoding();
        await api.runCode('1', 'code', 'python');
        await api.submitCoding({ 1: { code: 'c', language: 'java' } }, 7, []);
        await api.startInterview();
        await api.initVapi();
        await api.submitInterview([{ question_id: 1, response: 'r' }], 9, [], []);
        await api.saveDraft('aptitude', { answers: { 1: 'B' } });
        await api.terminate('reason', [], 'coding');
        const seen = globalThis.__axiosCalls.map((c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`);
        assert.deepEqual(seen, [
            'GET /api/roleready/session/UUID-9', 'POST /api/roleready/session/UUID-9/start-aptitude', 'POST /api/roleready/session/UUID-9/submit-aptitude',
            'POST /api/roleready/session/UUID-9/start-coding', 'POST /api/roleready/session/UUID-9/run-code', 'POST /api/roleready/session/UUID-9/submit-coding',
            'POST /api/roleready/session/UUID-9/start-interview', 'POST /api/roleready/session/UUID-9/vapi-init', 'POST /api/roleready/session/UUID-9/submit-interview',
            'PUT /api/roleready/session/UUID-9/draft', 'POST /api/roleready/session/UUID-9/terminate',
        ]);
        // Students authenticate with the HttpOnly session cookie (+ CSRF header added by the auth client): no per-request bearer credential
        assert.ok(globalThis.__axiosCalls.every((c) => !('Authorization' in c.headers)), 'no bearer credential is attached by the service client');
        assert.deepEqual(globalThis.localStorage.dump(), {}, 'nothing is written to storage');
        assert.ok(!seen.some((u) => u.includes('/api/public/')));
        assert.deepEqual(globalThis.__axiosCalls[9].body, { section: 'aptitude', payload: { answers: { 1: 'B' } } });
    });
});

describe('student adapter: proctoring uses the stored account / invitation credential', () => {
    test('exposes no custom header source, so the hook falls back to the stored student credential', async () => {
        const { createStudentAssessmentApi } = await loadModule('src/services/assessmentApi.js');
        assert.equal(createStudentAssessmentApi('S-1').proctorHeaders, null);
    });
});
