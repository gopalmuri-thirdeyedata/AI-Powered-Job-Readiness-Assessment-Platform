import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

const entrySrc = read('src/pages/candidate/SharedAssessmentEntry.jsx');
const instructionsSrc = read('src/pages/candidate/ExamInstructions.jsx');
const pageSrc = read('src/pages/candidate/RecruitmentAssessmentPage.jsx');
const workspaceSrc = read('src/pages/roleready/RoleReadyAssessment.jsx');
const adapterSrc = read('src/services/assessmentApi.js');
const apiSrc = read('src/services/recruitmentApi.js');
const modalSrc = read('src/components/candidate/CandidateRegistrationModal.jsx');
const sessionSrc = read('src/services/assessmentSession.js');
const appSrc = read('src/App.jsx');

// In-memory sessionStorage stand-in (Node has none)
const makeStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) };
};

describe('Candidate shared-link flow: registration popup (3 fields, no OTP, no accounts)', () => {
    test('1. validation accepts a valid candidate and returns a normalised E.164 payload', async () => {
        const { validateRegistration } = await loadModule('src/utils/registrationValidation.js');
        const r = validateRegistration({ name: '  Priya   Sharma ', countryCode: '+91', phone: '098765 43210', email: '  Priya.Sharma@Example.COM ' });
        assert.equal(r.valid, true);
        assert.deepEqual(r.payload, { name: 'Priya Sharma', phone: '+919876543210', email: 'priya.sharma@example.com' });
        assert.deepEqual(Object.keys(r.payload).sort(), ['email', 'name', 'phone']); // exactly three fields travel to the server
    });

    test('2. validation rejects bad name, phone and email with field-level messages', async () => {
        const { validateRegistration } = await loadModule('src/utils/registrationValidation.js');
        const bad = validateRegistration({ name: 'A', countryCode: '+1', phone: '12ab', email: 'nope' });
        assert.equal(bad.valid, false);
        assert.ok(bad.errors.name && bad.errors.phone && bad.errors.email);
        assert.ok(validateRegistration({ name: 'Valid Name', countryCode: '+1', phone: '123', email: 'a@b.co' }).errors.phone, 'too-short number');
        assert.ok(validateRegistration({ name: 'Valid Name', countryCode: '+1', phone: '4155550123', email: 'a@b' }).errors.email, 'email without a TLD');
        assert.equal(validateRegistration({ name: 'Valid Name', countryCode: '+44', phone: '7911 123456', email: 'ok@example.org' }).valid, true);
    });

    test('3. the popup renders exactly Full Name, Phone (with country code) and Email, and nothing else to fill in', async () => {
        const { default: Modal } = await loadModule('src/components/candidate/CandidateRegistrationModal.jsx');
        const html = renderToStaticMarkup(React.createElement(Modal, { assessmentTitle: 'Backend Engineer', onSubmit: () => {} }));
        const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
        assert.equal(inputs.length, 3, 'exactly three <input> elements');
        assert.ok(inputs.some((i) => i.includes('name="name"') && i.includes('type="text"')));
        assert.ok(inputs.some((i) => i.includes('name="phone"') && i.includes('type="tel"')));
        assert.ok(inputs.some((i) => i.includes('name="email"') && i.includes('type="email"')));
        assert.match(html, /<select[^>]*name="country_code"/);
        assert.ok((html.match(/<option/g) || []).length >= 20, 'international country code support');
        assert.match(html, /role="dialog"/);
        assert.match(html, /Full Name/);
        assert.match(html, /Phone Number/);
        assert.match(html, /Email Address/);
        for (const input of inputs) assert.doesNotMatch(input, /otp|password|code|verif/i, 'no OTP / password / verification inputs');
        for (const forbidden of [/send (a )?(code|otp)/i, /verify (your )?(email|phone|number)/i, /resend/i, /google/i, /sign in/i, /create (an )?account/i]) {
            assert.doesNotMatch(html, forbidden);
        }
        assert.match(html, /Backend Engineer/);
    });

    test('4. the popup source never collects credentials and blocks submit on invalid input', () => {
        assert.ok(modalSrc.includes('validateRegistration'));
        assert.ok(modalSrc.includes('if (result.valid) onSubmit(result.payload)'));
        assert.ok(!/type="password"/.test(modalSrc));
        assert.ok(!/localStorage/.test(modalSrc));
    });
});

describe('Candidate shared-link flow: registration -> Exam Instructions -> device check -> explicit start', () => {
    test('5. the dedicated instructions page gates the next step on the acknowledgement checkbox', () => {
        assert.ok(instructionsSrc.includes('type="checkbox"') && instructionsSrc.includes('id="instructions-ack"'));
        assert.ok(instructionsSrc.includes('disabled={!acknowledged}'), 'Continue button gated on the checkbox');
        assert.ok(instructionsSrc.includes('if (!acknowledged) return;'), 'handler also guards against a bypassed button');
        assert.ok(instructionsSrc.includes('I have read and understood the assessment instructions and agree to follow the assessment rules.'));
        assert.ok(instructionsSrc.includes('const [acknowledged, setAcknowledged] = useState(false);'), 'the box starts unchecked');
        assert.ok(instructionsSrc.includes('saveAcknowledgement(shareToken)'));
    });

    test('6. successful registration navigates to the instructions page and never starts the attempt', () => {
        assert.ok(entrySrc.includes('<CandidateRegistrationModal'));
        const registerBlock = entrySrc.slice(entrySrc.indexOf('const handleRegister'), entrySrc.indexOf('if (loadError)'));
        assert.ok(registerBlock.includes('candidateApi.register'));
        assert.ok(!registerBlock.includes('candidateApi.start'), 'registering must not start the attempt');
        assert.ok(registerBlock.includes('saveRegistration(shareToken, res.registration_token)'));
        assert.ok(registerBlock.includes('navigate(instructionsPath, { replace: true })'), 'registration leads straight to the instructions page');
        assert.ok(entrySrc.includes('`/assessment/join/${shareToken}/instructions`'));
        assert.ok(!entrySrc.includes('candidateApi.start') && !entrySrc.includes('type="checkbox"'), 'the entry page no longer hosts the start button or the acknowledgement');
    });

    test('6b. nothing but the explicit Start click inside the workspace can create an attempt (viewing, refreshing or ticking a box starts no timer)', () => {
        for (const [name, src] of [['entry', entrySrc], ['instructions', instructionsSrc], ['page', pageSrc]]) {
            assert.ok(!src.includes('candidateApi.start('), `${name} never calls the backend start request`);
        }
        const startCalls = adapterSrc.split('candidateApi.start(').length - 1;
        assert.equal(startCalls, 1, 'exactly one call site for the backend start request');
        const startFrom = adapterSrc.indexOf('startAptitude: async');
        const startAptitude = adapterSrc.slice(startFrom, adapterSrc.indexOf('submitAptitude:', startFrom));
        assert.ok(startAptitude.includes('candidateApi.start(shareToken, registration, hasAcknowledged(shareToken))'), 'the acknowledgement travels with the start request');
        assert.ok(startAptitude.includes('if (!startPromise)'), 'one in-flight start: a second click can never create a second attempt');
        // the workspace calls it only from the Start Assessment button handler (after the device check + fullscreen)
        const handleStart = workspaceSrc.slice(workspaceSrc.indexOf('const handleStartAssessment'), workspaceSrc.indexOf('// ── Draft autosave'));
        assert.ok(handleStart.includes('await api.startAptitude()') && handleStart.includes('enterFullscreen()'));
        assert.ok(handleStart.includes('if (!instructionsAccepted || cameraStatus'), 'needs the acceptance box and a working camera');
        const effect = instructionsSrc.slice(instructionsSrc.indexOf('useEffect('), instructionsSrc.indexOf('// Nobody reaches the instructions'));
        assert.ok(effect.includes('candidateApi.getMeta(shareToken)') && !effect.includes('start('), 'the page load only reads public metadata');
        assert.ok(instructionsSrc.includes('<Navigate to={`/assessment/join/${shareToken}`} replace />'), 'unregistered visitors are sent back to register first');
        assert.ok(!instructionsSrc.includes('setLease('), 'no lease before an explicit start');
    });

    test('6c. the instructions page renders the server-written Rules of Assessment (grouped), not a hard-coded list', async () => {
        const mod = await loadModule('src/pages/candidate/ExamInstructions.jsx');
        assert.ok(!instructionsSrc.includes('instructionsFor'), 'the old hard-coded list is gone: one source of truth (the server)');
        assert.ok(instructionsSrc.includes('normalizeRules(meta.rules)') && instructionsSrc.includes('Maximum overall duration'));
        const groups = mod.normalizeRules([{ key: 'timing', title: 'Timing', items: [{ text: 'Hard limit.', important: true }, 'Plain.'] }]);
        assert.deepEqual(groups, [{ key: 'timing', title: 'Timing', items: [{ text: 'Hard limit.', important: true }, { text: 'Plain.', important: false }] }]);
        assert.equal(mod.normalizeRules(['a', 'b'])[0].items.length, 2, 'a flat list from an older server still renders');
        assert.deepEqual(mod.normalizeRules(undefined), []);
        const html = renderToStaticMarkup(React.createElement(mod.RuleGroups, { groups }));
        assert.match(html, /<h3[^>]*>Timing<\/h3>/);
        assert.match(html, /border-amber-500 font-semibold[^>]*>Hard limit\./, 'important rules are visually distinct');
    });

    test('6d. the instructions page loads first (no Start button yet) and its route is public', async () => {
        const mod = await loadModule('src/pages/candidate/ExamInstructions.jsx');
        const backup = globalThis.sessionStorage;
        globalThis.sessionStorage = makeStorage();
        globalThis.sessionStorage.setItem('pw_reg:tok-1', 'reg-capability');
        const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/assessment/join/tok-1/instructions'] },
            React.createElement(Routes, null, React.createElement(Route, { path: '/assessment/join/:shareToken/instructions', element: React.createElement(mod.default) }))));
        assert.match(html, /Loading instructions/);
        assert.doesNotMatch(html, /Continue to Device Check/, 'the continue button is not available before the instructions are loaded');
        globalThis.sessionStorage = backup;
        assert.ok(appSrc.includes('path="/assessment/join/:shareToken/instructions"'));
        assert.ok(!/ClerkAdminGuard[^\n]*ExamInstructions|RoleReadyAuthGuard[^\n]*ExamInstructions/.test(appSrc), 'candidates need no login');
    });

    test('7. the session lease is kept in memory only; nothing candidate-related touches localStorage', () => {
        const startBlock = adapterSrc.slice(adapterSrc.indexOf('startAptitude: async'));
        assert.ok(startBlock.includes('setLease(session.lease)'));
        assert.ok(startBlock.includes('saveSession({ uuid: session.uuid, token: session.token, shareToken })'));
        assert.ok(startBlock.includes('clearRegistration(shareToken)'), 'registration capability is single use');
        const candidateApiSrc = apiSrc.slice(apiSrc.indexOf('// Candidate API (public'));   // (the admin half of the file reads the admin JWT from localStorage)
        for (const [name, src] of [['entry', entrySrc], ['instructions', instructionsSrc], ['page', pageSrc], ['modal', modalSrc], ['session store', sessionSrc], ['recruitment adapter', adapterSrc], ['candidate api', candidateApiSrc]]) {
            const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
            assert.ok(!/localStorage/.test(code), `${name} must not use localStorage`);
            assert.ok(!/document\.cookie/.test(code), `${name} must not use cookies`);
        }
        assert.ok(!/(lease)[^\n]*(sessionStorage|setItem)/i.test(sessionSrc.replace(/\/\/.*$/gm, '')), 'lease is never persisted');
    });

    test('8. assessmentSession persists identity in sessionStorage but the lease only in module memory', async () => {
        const store = makeStorage();
        globalThis.sessionStorage = store;
        const s = await loadModule('src/services/assessmentSession.js');
        s.setLease('LEASE-SECRET');
        s.saveSession({ uuid: 'u-1', token: 'tok-1' });
        s.saveRegistration('share-1', 'reg-1');
        assert.equal(s.getLease(), 'LEASE-SECRET');
        assert.deepEqual(s.loadSession(), { uuid: 'u-1', token: 'tok-1', shareToken: null });
        s.saveAcknowledgement('share-1');
        assert.equal(s.hasAcknowledged('share-1'), true);
        s.clearAcknowledgement('share-1');
        assert.equal(s.hasAcknowledged('share-1'), false);
        assert.equal(s.loadRegistration('share-1'), 'reg-1');
        assert.ok(!JSON.stringify(store.dump()).includes('LEASE-SECRET'), 'the lease must never reach storage');
        // A reloaded page boots a fresh module instance (blank heap) but inherits sessionStorage: no lease -> cannot resume
        const reloaded = await loadModule('src/services/assessmentSession.js');
        assert.ok(reloaded.loadSession(), 'identity survives');
        s.clearRegistration('share-1');
        assert.equal(s.loadRegistration('share-1'), null);
        s.clearLease();
        assert.equal(s.getLease(), null);
        delete globalThis.sessionStorage;
    });

    test('9. routes are wired publicly and do not collide with the existing student assessment routes', () => {
        assert.ok(appSrc.includes('path="/assessment/join/:shareToken"'));
        assert.ok(appSrc.includes('path="/assessment/join/:shareToken/assessment"'), 'the shared workspace for candidates');
        assert.ok(!appSrc.includes('/assessment/runner/'), 'the old stand-alone runner route is gone');
        const join = appSrc.indexOf('/assessment/join/:shareToken');
        const guarded = appSrc.indexOf('path="/assessment/:sessionUuid"');
        assert.ok(join !== -1 && guarded !== -1 && join < guarded, 'specific candidate routes are declared before the student ones');
        assert.ok(appSrc.includes('path="/assessment/setup"'), 'student setup route is untouched');
        assert.ok(!/ClerkAdminGuard[^\n]*SharedAssessmentEntry|RoleReadyAuthGuard[^\n]*SharedAssessmentEntry/.test(appSrc), 'candidate pages need no login');
    });
});

describe('Candidate API client and runner behaviour', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = { ok: true }; });

    test('10. start sends only the registration capability; session calls send token + in-memory lease', async () => {
        const { candidateApi } = await loadModule('src/services/recruitmentApi.js');
        await candidateApi.start('SHARE', 'REG-TOKEN', true);
        let call = globalThis.__axiosCalls.at(-1);
        assert.equal(call.url, 'http://api.test/api/public/assessment/SHARE/start');
        assert.equal(call.headers['X-Registration-Token'], 'REG-TOKEN');
        assert.deepEqual(call.body, { acknowledged: true });
        await candidateApi.start('SHARE', 'REG-TOKEN');
        assert.deepEqual(globalThis.__axiosCalls.at(-1).body, { acknowledged: false }, 'never acknowledged by default');

        const session = { uuid: 'UU', token: 'TOK', lease: 'LEASE' };
        await candidateApi.heartbeat(session);
        call = globalThis.__axiosCalls.at(-1);
        assert.equal(call.url, 'http://api.test/api/public/assessment/session/UU/heartbeat');
        assert.equal(call.headers['X-Session-Token'], 'TOK');
        assert.equal(call.headers['X-Session-Lease'], 'LEASE');

        await candidateApi.state({ uuid: 'UU', token: 'TOK', lease: null });
        call = globalThis.__axiosCalls.at(-1);
        assert.equal(call.headers['X-Session-Token'], 'TOK');
        assert.ok(!('X-Session-Lease' in call.headers), 'a lease-less tab sends no lease (the server then decides)');
    });

    test('11. every plan endpoint is called with the right path and payload', async () => {
        const { candidateApi } = await loadModule('src/services/recruitmentApi.js');
        const s = { uuid: 'U', token: 'T', lease: 'L' };
        await candidateApi.register('SH', { name: 'N', phone: '+1415', email: 'e@x.co' });
        await candidateApi.submitAptitude(s, { A1: 'B' }, [{ type: 'Tab switch' }]);
        await candidateApi.startCoding(s);
        await candidateApi.runCode(s, 'C1', 'code', 'java');
        await candidateApi.submitCoding(s, { C1: { language: 'python', code: 'x' } });
        await candidateApi.startInterview(s);
        await candidateApi.voiceInit(s);
        await candidateApi.submitInterview(s, [{ question_id: 'I1', response: 'ans' }], [{ role: 'user', text: 'ans' }]);
        await candidateApi.saveDraft(s, 'aptitude', { answers: {} }, []);
        await candidateApi.finalize(s);
        const seen = globalThis.__axiosCalls.map((c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test/api/public/assessment', '')}`);
        assert.deepEqual(seen, [
            'POST /SH/register', 'POST /session/U/submit-aptitude', 'POST /session/U/start-coding', 'POST /session/U/run-code',
            'POST /session/U/submit-coding', 'POST /session/U/start-interview', 'POST /session/U/voice-init', 'POST /session/U/submit-interview',
            'PUT /session/U/draft', 'POST /session/U/finalize',
        ]);
        assert.deepEqual(globalThis.__axiosCalls[3].body, { problem_id: 'C1', language: 'java', code: 'code' }, 'the shared editor supports Java as well as Python');
        assert.deepEqual(globalThis.__axiosCalls[1].body, { answers: { A1: 'B' }, violations: [{ type: 'Tab switch' }] });
        assert.deepEqual(globalThis.__axiosCalls[7].body, { answers: [{ question_id: 'I1', response: 'ans' }], transcript: [{ role: 'user', text: 'ans' }], violations: null });
    });

    test('12. a browser event alone never abandons: the client no longer sends an unload beacon', () => {
        for (const [name, src] of [['page', pageSrc], ['adapter', adapterSrc], ['api client', apiSrc], ['workspace', workspaceSrc]]) {
            assert.ok(!/sendBeacon|abandonBeacon|pagehide/.test(src), `${name} sends no abandon beacon`);
        }
        assert.ok(pageSrc.includes("window.addEventListener('beforeunload', onBeforeUnload)"), 'the candidate is still warned before leaving');
    });

    test('13. errorMessage understands string, object and validation details', async () => {
        const { errorMessage } = await loadModule('src/services/recruitmentApi.js');
        assert.equal(errorMessage({ response: { data: { detail: 'plain' } } }), 'plain');
        assert.equal(errorMessage({ response: { data: { detail: { message: 'obj', state: 'X' } } } }), 'obj');
        assert.equal(errorMessage({ response: { data: { detail: [{ msg: 'bad field' }] } } }), 'bad field');
        assert.match(errorMessage({ message: 'Network Error' }), /Network problem/);
        assert.equal(errorMessage({}, 'fallback'), 'fallback');
    });

    test('14. the page enforces the no-resume contract on the client side (the server enforces it for real)', () => {
        assert.ok(pageSrc.includes('const HEARTBEAT_MS = 15000'));
        assert.ok(pageSrc.includes("window.addEventListener('beforeunload', onBeforeUnload)"));
        const heartbeatEffect = pageSrc.slice(pageSrc.indexOf('// ---- heartbeat'), pageSrc.indexOf('// ---- no-resume guard'));
        assert.ok(heartbeatEffect.includes('if (!handle || phase') && heartbeatEffect.includes('candidateApi.heartbeat(handle)'), 'heartbeat only exists once the attempt does');
        assert.ok(pageSrc.includes('getLease()'), 'the lease is read from memory');
        assert.ok(pageSrc.includes('candidateApi.state({ uuid: stored.uuid, token: stored.token, lease: getLease() })'), 'a reload asks the server, which decides');
        assert.ok(pageSrc.includes('An attempt cannot be resumed after a reload'));
        assert.ok(adapterSrc.includes('setLease(session.lease)') && adapterSrc.includes('// volatile lease: in-memory ONLY'));
    });

    test('15. all three sections are the Student Platform workspace: Monaco, Python + Java, voice interview, proctoring', () => {
        assert.ok(pageSrc.includes("import { AssessmentWorkspace } from '../roleready/RoleReadyAssessment'"), 'the page reuses the student workspace');
        assert.ok(pageSrc.includes('mode="recruitment"') && pageSrc.includes('skipInstructions') && pageSrc.includes('proctoringPolicy="flag"'));
        assert.ok(!pageSrc.includes('<textarea') && !pageSrc.includes('@monaco-editor') && !pageSrc.includes('voiceInterviewSession'), 'no second editor / voice implementation in the recruitment page');
        for (const needle of ["from '@monaco-editor/react'", "from '../../utils/voiceInterviewSession'", "handleLanguageChange('java')", "handleLanguageChange('python')", 'useFaceProctoring', 'useAssessmentFullscreen', 'api.initVoice()', 'api.runCode(']) {
            assert.ok(workspaceSrc.includes(needle), `shared workspace has: ${needle}`);
        }
        assert.ok(!/hidden_test|hiddenTest|hidden test/i.test(adapterSrc + pageSrc), 'recruitment code never references hidden tests');
        assert.ok(adapterSrc.includes('initVoice: async') && adapterSrc.includes('candidateApi.voiceInit(need())'));
        assert.ok(!/manual_id|manualId/.test(workspaceSrc), 'no interviewer-ID override for candidates');
    });

    test('15b. the aptitude Integrity Monitor follows the proctoring policy: recruitment never shows strikes or "terminated" wording', () => {
        const panel = workspaceSrc.slice(workspaceSrc.indexOf('Malpractice Integrity Monitor'), workspaceSrc.indexOf('Question Palette Widget'));
        assert.ok(panel.length > 200, 'found the panel');
        assert.ok(!/\{violationCount\}\/3 Strikes/.test(panel), 'no hard-coded "/3 Strikes"');
        assert.ok(panel.includes('strikeLimit ? `${violationCount}/${strikeLimit} Strikes` : `${violationCount} recorded`'));
        // the termination wording is only reachable inside a block that requires a strike limit (student policy)
        const terminated = panel.indexOf('Assessment terminated.');
        const gate = panel.lastIndexOf('{strikeLimit && (', terminated);
        assert.ok(terminated > 0 && gate > 0 && !panel.slice(gate, terminated).includes('{!strikeLimit'), 'terminated wording is student-only');
        assert.ok(panel.includes('Integrity events are recorded for the hiring team. Your assessment continues'));
    });

    test('15c. an empty Constraints block is not rendered (blueprint problems carry no separate constraints text)', () => {
        const at = workspaceSrc.indexOf('Constraints:</span>');
        assert.ok(at > 0 && workspaceSrc.lastIndexOf("String(activeProblem.constraints || '').trim() &&", at) > at - 400);
    });

    test('15d. frame analysis is authenticated per workflow and the workspace wires the adapter credential into the hook', () => {
        const hookSrc = read('src/hooks/useFaceProctoring.js');
        assert.ok(hookSrc.includes('getAuthHeaders') && hookSrc.includes('storedAuthHeaders()'), 'hook sends credentials');
        assert.ok(hookSrc.includes("headers: { 'Content-Type': 'application/json', ...(getAuthHeadersRef.current"), 'credentials are part of the analyze-frame request');
        assert.ok(workspaceSrc.includes('getAuthHeaders: api.proctorHeaders || null'), 'workspace passes the adapter credential');
        assert.ok(adapterSrc.includes("'X-Session-Id': session.uuid, 'X-Session-Token': session.token"), 'recruitment uses its capability, not a student token');
        assert.ok(!/studentToken|Authorization/.test(adapterSrc.slice(adapterSrc.indexOf('createRecruitmentAssessmentApi'))), 'recruitment adapter never touches student auth');
    });

    test('16. light and dark themes with PrepWin brand tokens', () => {
        for (const src of [entrySrc, instructionsSrc, pageSrc, modalSrc]) {
            assert.ok(src.includes('#5d8c2c'));
            assert.ok(src.includes('dark:bg-slate-9'));
            assert.ok(src.includes('dark:text-'));
        }
        const shellSrc = read('src/components/candidate/CandidateShell.jsx');
        assert.ok(shellSrc.includes('PrepWin</span>') && workspaceSrc.includes('PrepWin</span>'));
        assert.ok(entrySrc.includes('CandidateShell') && instructionsSrc.includes('CandidateShell'));
    });
});
