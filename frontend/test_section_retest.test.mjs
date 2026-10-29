import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

const tableSrc = read('src/components/admin/CandidateResultsTable.jsx');
const modalSrc = read('src/components/admin/RetestModal.jsx');
const dossierSrc = read('src/components/admin/CandidateReportModal.jsx');
const pageSrc = read('src/pages/candidate/RetestAssessmentPage.jsx');
const workspaceSrc = read('src/pages/roleready/RoleReadyAssessment.jsx');
const completeSrc = read('src/pages/candidate/StudentAssessmentComplete.jsx');
const entrySrc = read('src/pages/candidate/SharedAssessmentEntry.jsx');
const appSrc = read('src/App.jsx');

const makeStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const calls = () => globalThis.__axiosCalls;
const seen = () => calls().map((c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`);

describe('Admin: Retest next to Dossier in Candidate Results', () => {
    test('1. every candidate row (table and card layouts) shows [Dossier] [Retest] in one actions group', () => {
        assert.ok(tableSrc.includes("<Eye size={14} /> Dossier</button>"), 'the existing Dossier button is unchanged');
        assert.ok(tableSrc.includes('<RotateCcw size={14} /> Retest</button>'));
        assert.match(tableSrc, /const actions = \(r\) => <div className="inline-flex items-center justify-end gap-2">\{dossierBtn\(r\)\}\{retestBtn\(r\)\}<\/div>;/, 'Dossier first, Retest beside it');
        assert.equal((tableSrc.match(/\{actions\(r\)\}/g) || []).length, 2, 'wide table cell and the narrow card both use it');
        assert.equal((tableSrc.match(/\{dossierBtn\(r\)\}/g) || []).length, 1, 'no row renders Dossier on its own any more');
        assert.ok(tableSrc.includes('className={ghostBtnSm} onClick={() => setRetestId(r.id)}'), 'same button style as Dossier (theme tokens, light and dark)');
        for (const label of ['Candidate', 'Role', 'Status', 'Aptitude', 'Coding', 'Interview', 'Overall', 'Registered']) assert.ok(tableSrc.includes(`>${label}</th>`), `column ${label} kept`);
    });

    test('2. assigning refreshes the results table; the existing Dossier modal stays wired exactly as before', () => {
        assert.ok(tableSrc.includes('<RetestModal candidateId={retestId} onClose={() => setRetestId(null)} onAssigned={() => { load(); if (onChanged) onChanged(); }} />'), 'Candidate Results reload after a retest is assigned');
        assert.ok(tableSrc.includes('<CandidateReportModal candidateId={openId}') && tableSrc.includes('setOpenId(r.id)'));
        assert.ok(tableSrc.includes('aria-label={`Open dossier for ${r.name}`}'));
    });
});

describe('Admin: the Retest dialog', () => {
    test('3. it shows the candidate, role, status and the actual current score of each section from the backend', () => {
        for (const needle of ['adminApi.retestOverview(candidateId)', 'data.candidate.name', 'data.candidate.email', 'data.job_role.title', 'data.attempt_state', 'formatScore(s.score)', "data.sections.map((s) =>"]) {
            assert.ok(modalSrc.includes(needle), `dialog: ${needle}`);
        }
        assert.ok(!/\b\d{2}\.\d%/.test(modalSrc), 'no score is hard-coded in the dialog');
    });

    test('4. the administrator picks one or more sections with checkboxes; sections that already have an open retest cannot be picked twice', () => {
        assert.ok(modalSrc.includes('type="checkbox"') && modalSrc.includes('disabled={!!open}') && modalSrc.includes('const toggle = (key)'));
        assert.ok(modalSrc.includes('aria-label={`Retest ${s.label}`}'));
        assert.ok(modalSrc.includes('Reason (optional)') && modalSrc.includes('maxLength={1000}'));
        assert.ok(modalSrc.includes('Assign Retest') && modalSrc.includes('>Cancel</button>'));
    });

    test('5. at least one section is required, the button is disabled while the request runs, and failures are shown', () => {
        assert.ok(modalSrc.includes("Select at least one section to retest."));
        assert.ok(modalSrc.includes('const canAssign = !!data?.eligible && selected.length > 0 && !busy;') && modalSrc.includes('disabled={!canAssign}'));
        assert.ok(modalSrc.includes('if (busy) return;') && modalSrc.includes('setBusy(true)') && modalSrc.includes('setBusy(false)'));
        assert.ok(modalSrc.includes("retestErrorMessage(err, 'The retest could not be assigned.')") && modalSrc.includes("type: 'error'"), 'the server\'s refusal (e.g. a duplicate active retest) is displayed');
        assert.ok(modalSrc.includes('data.ineligible_reason'), 'an attempt that cannot be retested explains why');
    });

    test('6. no registration fields are ever collected: the dialog only sends sections and a reason', async () => {
        assert.ok(!/\sname=|type="(email|tel)"|phone/i.test(modalSrc), 'no name / e-mail / phone inputs');
        globalThis.__axiosResponse = { retests: [] };
        (globalThis.__axiosCalls ||= []).length = 0;
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        await adminApi.retestOverview(9);
        await adminApi.assignRetests(9, ['coding', 'interview'], 'sandbox crashed');
        await adminApi.assignRetests(9, ['coding'], '');
        await adminApi.resendRetestEmail('R-1');
        await adminApi.cancelRetest('R-1');
        await adminApi.retryRetestEvaluation('R-1');
        assert.deepEqual(seen(), [
            'GET /api/admin/recruitment/candidates/9/retests', 'POST /api/admin/recruitment/candidates/9/retests', 'POST /api/admin/recruitment/candidates/9/retests',
            'POST /api/admin/recruitment/retests/R-1/resend-email', 'POST /api/admin/recruitment/retests/R-1/cancel', 'POST /api/admin/recruitment/retests/R-1/retry-evaluation']);
        assert.deepEqual(calls()[1].body, { sections: ['coding', 'interview'], reason: 'sandbox crashed' });
        assert.deepEqual(calls()[2].body, { sections: ['coding'], reason: null });
        assert.ok(calls().every((c) => !('Authorization' in c.headers)), 'admin calls use the cookie session');
    });

    test('7. the link handed to the candidate carries a token only when the server issued one (accountless registrations)', async () => {
        globalThis.window = { location: { origin: 'https://prep.test' } };
        const { retestLink } = await loadModule('src/components/admin/RetestModal.jsx');
        assert.equal(retestLink({ retest_uuid: 'U-1' }), 'https://prep.test/assessment/retest/U-1');
        assert.equal(retestLink({ retest_uuid: 'U-1', access_token: 'a b+c' }), 'https://prep.test/assessment/retest/U-1?token=a%20b%2Bc');
        delete globalThis.window;
    });
});

describe('Dossier shows the effective result and keeps history apart', () => {
    test('8. retest history is its own labelled table; the score tiles still come from the report (the current result)', () => {
        assert.ok(dossierSrc.includes('Retest history') && dossierSrc.includes('data.retests'));
        assert.ok(dossierSrc.includes('The scores above are the current effective results'), 'history is never presented as the current score');
        assert.ok(dossierSrc.includes('Previous score') && dossierSrc.includes('Retest score') && dossierSrc.includes('r.reason'));
        assert.ok(dossierSrc.includes('<Score label="Coding" value={sections.coding?.score} />'), 'the section tiles read report.sections');
        assert.ok(dossierSrc.includes("report.overall_score === null ? 'INCOMPLETE'"), 'existing dossier behaviour intact');
        assert.ok(!/#[0-9a-f]{6}/i.test(dossierSrc.replace(/#5d8c2c|#4c7324|#9fd05a/gi, '')), 'no stray colours (both themes)');
    });
});

describe('Candidate: the retest uses the existing sign-in / capability and the shared assessment workspace', () => {
    let session;
    const STATE = (key, extra = {}) => ({ retest_uuid: 'R-1', state: `${key.toUpperCase()}_IN_PROGRESS`, terminal: false, server_time: 't',
        overall_remaining_seconds: 1200, section: { key, label: key, index: 1, total_sections: 1, remaining_seconds: 1200, deadline_at: 'd', started_at: 's', questions: [{ id: 'Q1' }] }, ...extra });
    beforeEach(async () => {
        globalThis.sessionStorage = makeStorage();
        (globalThis.__axiosCalls ||= []).length = 0;
        globalThis.__axiosHandler = null;
        session = await loadModule('src/services/assessmentSession.js');
    });

    test('9. nothing is sent before the explicit start; the start sends only the rules acknowledgement (+ the hand-over token when there is one)', async () => {
        const { createRetestAssessmentApi } = await loadModule('src/services/assessmentApi.js');
        const sessions = [];
        const api = createRetestAssessmentApi({ retestUuid: 'R-1', retestToken: 'HAND-OVER', section: 'coding', meta: { title: 'Backend' }, acknowledged: true, onSession: (s) => sessions.push(s) });
        assert.equal((await api.getSession()).current_state, 'NOT_STARTED');
        assert.equal(calls().length, 0);
        globalThis.__axiosHandler = (c) => (c.url.endsWith('/start') ? { retest_uuid: 'R-1', session_token: 'TOK', session_lease: 'LEASE', state: STATE('coding') } : STATE('coding'));
        const [a, b] = await Promise.all([api.startRetest(), api.startRetest()]);
        const starts = calls().filter((c) => c.url.endsWith('/api/public/retest/R-1/start'));
        assert.equal(starts.length, 1, 'a double click creates one sitting');
        assert.deepEqual(starts[0].body, { acknowledged: true });
        assert.equal(starts[0].headers['X-Retest-Token'], 'HAND-OVER');
        for (const c of calls()) {
            const sent = JSON.stringify(c.body ?? {}).toLowerCase();
            assert.ok(!/"(name|email|phone|registration)/.test(sent), 'no registration details are ever sent');
        }
        assert.equal(a.section.key, 'coding'); assert.equal(b.section.key, 'coding');
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].lease, 'LEASE', 'the lease is handed to the page in memory');
        assert.equal(globalThis.sessionStorage.getItem('pw_assessment_session'), null, 'nothing about the sitting is persisted (no resume)');
    });

    test('10. a student retest sends no token at all (the signed-in session is the credential) and maps the section for the workspace', async () => {
        const { createRetestAssessmentApi } = await loadModule('src/services/assessmentApi.js');
        const api = createRetestAssessmentApi({ retestUuid: 'R-1', section: 'interview', meta: {}, acknowledged: true });
        globalThis.__axiosHandler = (c) => (c.url.endsWith('/start') ? { retest_uuid: 'R-1', session_token: 'TOK', session_lease: 'LEASE', state: STATE('interview') } : STATE('interview'));
        await api.startRetest();
        assert.ok(!('X-Retest-Token' in calls()[0].headers));
        const s = await api.getSession();
        assert.equal(s.interview_unlocked, true);
        assert.equal(s.coding_unlocked, false, 'the workspace opens the interview, not the earlier sections');
        assert.equal(s.is_completed, false);
        assert.deepEqual(api.proctorHeaders(), { 'X-Session-Id': 'R-1', 'X-Session-Token': 'TOK' });
    });

    test('11. section loaders and submits go to the retest endpoints; an unassigned section is refused before and by the server', async () => {
        const { createRetestAssessmentApi } = await loadModule('src/services/assessmentApi.js');
        const api = createRetestAssessmentApi({ retestUuid: 'R-1', section: 'coding', meta: {}, acknowledged: true });
        await assert.rejects(() => api.startCoding(), (e) => e.response.status === 409, 'no sitting yet');
        globalThis.__axiosHandler = (c) => {
            if (c.url.endsWith('/start')) return { retest_uuid: 'R-1', session_token: 'TOK', session_lease: 'LEASE', state: STATE('coding') };
            if (c.url.endsWith('/start-section/aptitude')) return Promise.reject({ response: { status: 403, data: { detail: 'The Aptitude section is not assigned to you.' } } });
            if (c.url.endsWith('/submit')) return { state: 'COMPLETED', terminal: true, evaluation_pending: false };
            return STATE('coding');
        };
        await api.startRetest();
        const coding = await api.startCoding();
        assert.deepEqual(coding.problems, [{ id: 'Q1' }]);
        await assert.rejects(() => api.startAptitude(), (e) => e.response.status === 403);
        const done = await api.submitCoding({ C1: { code: 'x', language: 'python' } }, 12, []);
        assert.equal(done.state, 'COMPLETED');
        assert.ok(seen().includes('POST /api/public/retest/R-1/start-section/coding') && seen().includes('POST /api/public/retest/R-1/submit'));
        assert.ok(seen().every((u) => !u.includes('/api/public/assessment/')), 'the original attempt\'s endpoints are never used');
        const submit = calls().find((c) => c.url.endsWith('/submit'));
        assert.deepEqual(Object.keys(submit.body).sort(), ['solutions', 'violations'], 'only answers: no section id and no score');
        assert.equal(submit.headers['X-Session-Token'], 'TOK');
        assert.equal(submit.headers['X-Session-Lease'], 'LEASE');
    });

    test('12. the entry page uses the existing sign-in form and shows no registration form; the workspace is the shared one, restricted to one section', () => {
        assert.ok(pageSrc.includes("import StudentAccessLogin from '../../components/candidate/StudentAccessLogin'"), 'existing sign-in component');
        assert.ok(pageSrc.includes("SIGN_IN_REQUIRED") && pageSrc.includes('You do not need to register again.'));
        assert.ok(!/<input[^>]*(email|type="tel"|\sname=)/i.test(pageSrc), 'no registration inputs on the retest page');
        assert.ok(pageSrc.includes('<AssessmentWorkspace') && pageSrc.includes('retestSection={info.section}') && pageSrc.includes('proctoringPolicy="flag"'));
        assert.ok(pageSrc.includes("window.addEventListener('beforeunload'") && pageSrc.includes('HEARTBEAT_MS'), 'same no-resume guard and heartbeat as the attempt');
        assert.ok(appSrc.includes('path="/assessment/retest/:retestUuid"'));
        assert.ok(appSrc.includes('path="/assessment/join/:shareToken"') && appSrc.includes('path="/assessment/join/:shareToken/complete"'), 'existing routes untouched');
    });

    test('13. the shared workspace changes only for a retest: it starts in the assigned section and finishes after submit', () => {
        assert.ok(workspaceSrc.includes('retestSection = null,'));
        assert.equal((workspaceSrc.match(/if \(retestSection\) \{ finishAssessment\('completed'\); return; \}/g) || []).length, 2, 'aptitude and coding end the sitting (interview already does)');
        assert.ok(workspaceSrc.includes('await api.startRetest();') && workspaceSrc.includes('setCurrentStage(retestSection);'));
        assert.ok(workspaceSrc.includes('const started = await api.startAptitude();'), 'the original start path is unchanged');
    });

    test('14. a student finds an assigned retest on the existing completion page, and the link entry routes there too', () => {
        assert.ok(completeSrc.includes('<RetestsAssigned retests={data.retests}') && completeSrc.includes('/assessment/retest/${id}'));
        assert.ok(completeSrc.includes('aria-label="Exam review"') && completeSrc.includes('Download Report'), 'review and report flow intact');
        assert.ok(entrySrc.includes('res.attempt?.submitted || res.retests?.length'));
    });
});

describe('Candidate Results refresh after a retest is accepted', () => {
    test('15. the table reloads its rows from the API (never a cached score) when a retest is assigned or the dialog changes anything', () => {
        assert.ok(tableSrc.includes('const res = await adminApi.listCandidates(params);') && tableSrc.includes('formatScore(r.coding_score)'));
        assert.ok(modalSrc.includes('if (onAssigned) onAssigned();') && (modalSrc.match(/onAssigned\(\)/g) || []).length >= 2, 'assign and cancel/retry both refresh the table');
        assert.ok(dossierSrc.includes('onChanged'), 'the dossier loads fresh data on every open (load() on mount)');
        assert.ok(dossierSrc.includes('setData(await adminApi.dossier(candidateId));'));
    });
});

describe('The "Not Found" fix: the dialog talks to the real route and explains a stale server', () => {
    test('16. the dialog\'s request is exactly the route the backend registers (GET .../candidates/{registration id}/retests)', async () => {
        globalThis.__axiosResponse = {};
        (globalThis.__axiosCalls ||= []).length = 0;
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        await adminApi.retestOverview(42);
        await adminApi.assignRetests(42, ['coding'], null);
        assert.deepEqual(seen(), ['GET /api/admin/recruitment/candidates/42/retests', 'POST /api/admin/recruitment/candidates/42/retests']);
        // the id sent is the roster row's id (the candidate registration id): the same `r.id` the Dossier button uses
        assert.ok(tableSrc.includes('onClick={() => setRetestId(r.id)}') && tableSrc.includes('onClick={() => setOpenId(r.id)}'));
        assert.ok(modalSrc.includes('adminApi.retestOverview(candidateId)') && modalSrc.includes('adminApi.assignRetests(candidateId, selected, reason.trim())'));
    });

    test('17. a bare 404 "Not Found" (route missing on the running server) says to restart the backend; real lookups keep their own message', async () => {
        const { retestErrorMessage } = await loadModule('src/components/admin/RetestModal.jsx');
        const missingRoute = retestErrorMessage({ response: { status: 404, data: { detail: 'Not Found' } } }, 'fallback');
        assert.match(missingRoute, /older version: restart it/);
        assert.equal(retestErrorMessage({ response: { status: 404, data: { detail: 'Candidate not found.' } } }, 'fallback'), 'Candidate not found.');
        assert.equal(retestErrorMessage({ response: { status: 409, data: { detail: { code: 'RETEST_ALREADY_ACTIVE', message: 'Coding already has an active retest for this candidate.' } } } }, 'fallback'),
            'Coding already has an active retest for this candidate.');
        assert.equal(retestErrorMessage({ response: { status: 403, data: { detail: 'Not authorized' } } }, 'fallback'), 'Not authorized');
        assert.equal(retestErrorMessage({}, 'fallback'), 'fallback');
        assert.ok(modalSrc.includes("retestErrorMessage(err, 'Unable to load this candidate.')"), 'the load error uses it');
    });
});

describe('Candidate email: status is shown separately from the assignment and failures are recoverable', () => {
    test('18. after assigning, the administrator sees whether the email was sent; a failure offers Retry and keeps the retest', () => {
        assert.ok(modalSrc.includes("assigned.email?.status === 'SENT'") && modalSrc.includes('data-testid="retest-email-status"'));
        assert.ok(modalSrc.includes('Email sent to {assigned.email.to}.'));
        assert.ok(modalSrc.includes('The retest is saved, but the email to') && modalSrc.includes('The candidate has not been notified yet.'), 'a failed email is never presented as success');
        assert.ok(modalSrc.includes('Retry email') && modalSrc.includes('adminApi.resendRetestEmail(retestUuid)') && modalSrc.includes('if (busy) return;'));
        assert.ok(modalSrc.includes("{ type: 'error', message: 'Retest assigned, but the email could not be sent. See the notice below.' }"));
    });

    test('19. the fallback link (with its one-time token) is offered only when the email did NOT go out; the history shows the email status and Resend', () => {
        assert.ok(modalSrc.includes('const sent = assigned.email?.status === \'SENT\';'));
        const failedBranch = modalSrc.slice(modalSrc.indexOf('Retry email'), modalSrc.indexOf('data.history.length > 0'));
        assert.ok(failedBranch.includes('retestLink(r)'), 'links live only in the failure branch');
        const sentBranch = modalSrc.slice(modalSrc.indexOf('const sent ='), modalSrc.indexOf('Retry email'));
        assert.ok(!sentBranch.includes('retestLink('), 'once the mail is sent no link or token is displayed');
        assert.ok(modalSrc.includes("r.status === 'ASSIGNED' && r.email?.status === 'FAILED'") && modalSrc.includes('Resend email'));
        assert.ok(modalSrc.includes("{ PENDING: 'Email pending', SENT: 'Email sent', FAILED: 'Email failed' }"));
        assert.ok(dossierSrc.includes('<th className={thCls}>Email</th>') && dossierSrc.includes('r.email?.error'), 'the dossier history lists the email status');
    });
});

describe('Retest validity (24 hours) is shown wherever a retest is listed', () => {
    test('20. the candidate entry page, the student card and the admin history show the server-stored expiry (no client-side date maths)', () => {
        assert.ok(pageSrc.includes('new Date(info.expires_at)') && pageSrc.includes('can no longer be started or submitted') && read('src/components/candidate/AssessmentBrief.jsx').includes('data-testid="retest-valid-until"'));
        assert.ok(completeSrc.includes('Valid until {new Date(r.expires_at)'));
        assert.ok(modalSrc.includes("valid until ${formatDate(r.expires_at)}") && modalSrc.includes("['ASSIGNED', 'IN_PROGRESS'].includes(r.status)"));
        for (const src of [pageSrc, completeSrc, modalSrc]) {
            assert.ok(!/24\s*\*\s*60|86400|7\s*\*\s*24|setHours|getTime\(\)\s*\+/.test(src), 'the browser never computes an expiry: it only displays what the server stored');
        }
    });
});

describe('Back to Dashboard after a submitted retest', () => {
    test('21. the button goes to the real Student Dashboard route, appears only for a submitted retest and a signed-in student, and calls no API', () => {
        assert.ok(appSrc.includes('path="/student/dashboard"'), 'the dashboard route exists in the router');
        assert.ok(pageSrc.includes("const DASHBOARD_PATH = '/student/dashboard';") && pageSrc.includes('navigate(DASHBOARD_PATH)'), 'existing router navigation to that route');
        const handler = pageSrc.slice(pageSrc.indexOf('const backToDashboard'), pageSrc.indexOf('// an already-submitted retest'));
        assert.ok(handler.includes('Back to Dashboard') && handler.includes('primary') && !/retestApi|axios|fetch\(/.test(handler), 'the click only navigates: no submit / start request can be repeated by it');
        // only two places show it: the submitted outcome, and a retest the server reports as already submitted (e.g. after a refresh)
        assert.equal((pageSrc.match(/backToDashboard/g) || []).length, 3, 'defined once, used twice');
        assert.ok(pageSrc.includes("action={ok && isStudent ? backToDashboard : null}"), 'submitted outcome only (not for closed / expired)');
        assert.ok(pageSrc.includes("isStudent && SUBMITTED_STATUSES.includes(info?.status) ? backToDashboard : null") && pageSrc.includes("['COMPLETED', 'SUBMITTED', 'EVALUATION_PENDING']"));
        assert.ok(pageSrc.includes("const isStudent = isSignedIn && user?.role === 'STUDENT';"), 'candidates without an account have no dashboard to return to');
        const intro = pageSrc.slice(pageSrc.indexOf("if (phase === 'intro' && info)"), pageSrc.indexOf("if (phase !== 'ready' || !api) return null;"));
        assert.ok(!intro.includes('backToDashboard'), 'not offered before the retest is submitted');
    });
});
