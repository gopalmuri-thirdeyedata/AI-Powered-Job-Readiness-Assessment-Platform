// Recruitment integrity policy (tab switches / event limits), and resuming a sitting after a reload. Pure logic + the resume adapter against the axios fake.
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadModule } from './test_support/bundle.mjs';

const load = () => loadModule('src/utils/integrityPolicy.js');
const TAB = 'Navigated away from assessment window (Tab Switch)';
const BLUR = 'Application lost focus (Window Blur / Switch)';
const ev = (type, strike = 1) => ({ type, strike, timestamp: '2026-03-02T09:00:00Z' });

describe('which events are "switching tabs"', () => {
    test('only the Tab Switch event is; a lost window focus (blur) is NOT an event at all, and the reload marker is its own thing', async () => {
        const { isFocusEvent, isResumeEvent, RESUME_EVENT } = await load();
        assert.ok(isFocusEvent(TAB));
        assert.equal(isFocusEvent(BLUR), false, 'window blur no longer counts as a tab switch');
        for (const other of ['Pasting from outside was blocked', 'Face not visible in camera', 'Fullscreen exit exceeded 10-second recovery limit', 'Screenshot key pressed', '', undefined]) {
            assert.equal(isFocusEvent(other), false, String(other));
        }
        assert.equal(isResumeEvent(RESUME_EVENT), true);
        assert.equal(RESUME_EVENT, 'Page reloaded (assessment resumed)');
        assert.equal(isFocusEvent(RESUME_EVENT), false);
    });
});

describe('when the attempt ends', () => {
    test('the first tab switch only warns; the second disqualifies (a blur in between changes nothing)', async () => {
        const { decideRecruitmentAction } = await load();
        let list = [ev(TAB)];
        assert.equal(decideRecruitmentAction(list, TAB).action, 'warn_focus');
        list = [...list, ev(TAB, 2)];
        const d = decideRecruitmentAction(list, TAB);
        assert.deepEqual([d.action, d.disqualified, d.reason], ['terminate', true, 'tab_switch_limit']);
    });

    test('five events of any kind are allowed, the sixth ends the attempt (not a disqualification)', async () => {
        const { decideRecruitmentAction } = await load();
        const five = Array.from({ length: 5 }, (_, i) => ev('Pasting from outside was blocked', i + 1));
        assert.equal(decideRecruitmentAction(five, 'Pasting from outside was blocked').action, 'none');
        const six = [...five, ev('Face not visible in camera', 6)];
        const d = decideRecruitmentAction(six, 'Face not visible in camera');
        assert.deepEqual([d.action, d.disqualified, d.reason], ['terminate', false, 'integrity_limit']);
    });

    test('the reload marker never counts toward either limit', async () => {
        const { decideRecruitmentAction, tallyEvents, RESUME_EVENT } = await load();
        const reloads = Array.from({ length: 5 }, () => ev(RESUME_EVENT, 0));
        assert.deepEqual(tallyEvents(reloads), { count: 0, switches: 0 });
        const five = Array.from({ length: 5 }, () => ev('Screenshot key pressed'));
        assert.equal(decideRecruitmentAction([...reloads, ...five], 'Screenshot key pressed').action, 'none', '5 events + 5 reloads is still fine');
        assert.equal(decideRecruitmentAction([...reloads, ev(TAB)], TAB).action, 'warn_focus', 'one tab switch after reloads is still only a warning');
        assert.equal(decideRecruitmentAction([ev(TAB), ...reloads], RESUME_EVENT).action, 'none', 'a reload after the warning is not a new warning');
    });

    test('a tab switch before a reload still counts after it (a reload never resets the limits)', async () => {
        const { decideRecruitmentAction, RESUME_EVENT } = await load();
        const restored = [ev(TAB), ev(RESUME_EVENT, 0)];
        assert.equal(decideRecruitmentAction([...restored, ev(TAB, 2)], TAB).disqualified, true);
    });
});

describe('restoring a sitting from the /resume answer', () => {
    const resume = {
        resumed: true, session_lease: 'NEW',
        state: { state: 'CODING_IN_PROGRESS', terminal: false, overall_remaining_seconds: 2500, section: { key: 'coding', remaining_seconds: 777 } },
        draft: { section: 'coding', payload: { solutions: { C1: { language: 'cpp', code: 'class Solution {};' }, C2: { code: 'x = 1' }, bad: 'nope' } } },
        violations: [ev(TAB), ev('Page reloaded (assessment resumed)', 0), ev('Screenshot key pressed', 2)],
    };

    test('coding: code + language per problem, per-language buffers, events with the reload marker kept but not counted, server-clock timers', async () => {
        const { restoreFromResume } = await load();
        const r = restoreFromResume(resume);
        assert.equal(r.sectionKey, 'coding');
        assert.deepEqual(r.solutions, { C1: { code: 'class Solution {};', language: 'cpp' }, C2: { code: 'x = 1', language: 'python' } });
        assert.deepEqual(r.buffers.C1, { cpp: 'class Solution {};' });
        assert.equal(r.violations.length, 3, 'the marker stays in the list that is sent back');
        assert.deepEqual([r.counted, r.switches], [2, 1], 'but only the two real events count');
        assert.deepEqual(r.timing, { remaining_seconds: 777, overall_remaining_seconds: 2500 });
    });

    test('aptitude answers are validated; interview answers and transcript come back', async () => {
        const { restoreFromResume } = await load();
        const apt = restoreFromResume({ state: { section: { key: 'aptitude' } }, draft: { section: 'aptitude', payload: { answers: { A1: 'b', A2: 'Z', A3: 'D' } } } });
        assert.deepEqual(apt.aptitudeAnswers, { A1: 'B', A3: 'D' });
        const itv = restoreFromResume({
            state: { section: { key: 'interview' } },
            draft: { section: 'interview', payload: { answers: [{ question_id: 'I1', response: 'my answer' }, { question_id: 'I2', response: '' }], transcript: [{ role: 'ai', text: 'Hello' }, { role: 'user', text: 'Hi' }, { role: 'user', text: '' }] } },
        });
        assert.deepEqual(itv.interviewResponses, { I1: 'my answer' });
        assert.deepEqual(itv.transcript.map((t) => [t.role, t.text]), [['ai', 'Hello'], ['user', 'Hi']]);
    });

    test('an empty or odd answer never throws', async () => {
        const { restoreFromResume } = await load();
        for (const odd of [undefined, {}, { draft: null, violations: 'x' }, { draft: { payload: { solutions: 5, answers: 7, transcript: 'z' } } }]) {
            const r = restoreFromResume(odd);
            assert.deepEqual([r.counted, Object.keys(r.solutions).length, r.violations.length], [0, 0, 0]);
        }
    });
});

describe('resume adapter: the same attempt, nothing started again', () => {
    const makeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
    const codingState = { session_uuid: 'S-1', state: 'CODING_IN_PROGRESS', terminal: false, overall_remaining_seconds: 2500, section: { key: 'coding', remaining_seconds: 777, questions: [{ id: 'C1' }] } };
    let api;
    beforeEach(async () => {
        globalThis.sessionStorage = makeStorage();
        (globalThis.__axiosCalls ||= []).length = 0;
        globalThis.__axiosHandler = null;
        const { createRecruitmentAssessmentApi } = await loadModule('src/services/assessmentApi.js');
        api = createRecruitmentAssessmentApi({ shareToken: 'SHARE', meta: { role: 'Dev' }, resume: { handle: { uuid: 'S-1', token: 'TOK', lease: 'NEW' }, state: codingState } });
    });

    test('resumeSection reads the running section from the server state and creates / starts nothing', async () => {
        globalThis.__axiosHandler = () => codingState;
        const s = await api.resumeSection();
        assert.deepEqual([s.key, s.problems.length, s.remaining_seconds, s.overall_remaining_seconds], ['coding', 1, 777, 2500]);
        assert.deepEqual(globalThis.__axiosCalls.map((c) => `${c.method} ${c.url.split('/').slice(-1)[0]}`), ['get state']);
        assert.equal(globalThis.__axiosCalls[0].headers['X-Session-Lease'], 'NEW', 'it works with the lease the resume issued');
        assert.equal(api.getHandle().uuid, 'S-1');
        assert.equal((await api.getSession()).coding_unlocked, true);
    });

    test('the resume call needs only the capability; terminate carries lease + the event list', async () => {
        const { candidateApi } = await loadModule('src/services/recruitmentApi.js');
        globalThis.__axiosHandler = () => ({ resumed: true });
        await candidateApi.resume({ uuid: 'S-1', token: 'TOK', lease: 'STALE' });
        const call = globalThis.__axiosCalls.at(-1);
        assert.ok(call.url.endsWith('/session/S-1/resume'));
        assert.equal(call.headers['X-Session-Token'], 'TOK');
        assert.equal(call.headers['X-Session-Lease'], undefined, 'no lease on a resume');
        globalThis.__axiosHandler = () => ({ state: 'ABANDONED', terminal: true, terminated: true, disqualified: true, message: 'Disqualified.' });
        const out = await api.terminateAttempt([ev(TAB), ev(TAB, 2)], 'tab_switch_limit');
        const t = globalThis.__axiosCalls.at(-1);
        assert.ok(t.url.endsWith('/session/S-1/terminate'));
        assert.deepEqual([t.headers['X-Session-Token'], t.headers['X-Session-Lease']], ['TOK', 'NEW']);
        assert.deepEqual(t.body, { reason: 'tab_switch_limit', violations: [ev(TAB), ev(TAB, 2)] });
        assert.deepEqual([out.disqualified, api.getLastState().message], [true, 'Disqualified.']);
    });
});

describe('wiring', () => {
    const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8');
    const page = read('./src/pages/candidate/RecruitmentAssessmentPage.jsx');
    const workspace = read('./src/pages/roleready/RoleReadyAssessment.jsx');

    test('a reload resumes instead of blocking, and the unload warning no longer claims the attempt is lost', () => {
        assert.ok(page.includes('candidateApi.resume(') && page.includes('setLease(res.session_lease)'));
        assert.ok(!page.includes('An attempt cannot be resumed after a reload'));
        assert.ok(page.includes('Reloading is allowed, but the timer keeps running and the reload is recorded.'));
        assert.ok(page.includes('resumeInfo={resume}'));
    });

    test('the recruitment policy is applied only under the flag policy; students keep the three-strike path', () => {
        const from = workspace.indexOf('// Recruitment policy: switching tabs more than once');
        const flag = workspace.slice(from, workspace.indexOf('if (count === 1) {', from));
        assert.ok(flag.includes('decideRecruitmentAction(') && flag.includes('endAttemptRef.current?.(decision, violationsRef.current)') && flag.includes('FOCUS_WARNING'));
        assert.ok(workspace.includes('MAX_MALPRACTICE_WARNINGS') && workspace.includes('handleAutoSubmitDueToMalpractice(reason, violationsRef.current)'));
        assert.ok(workspace.includes('api.terminateAttempt(list, decision.reason)') && workspace.includes('api.saveDraft(currentStage, buildDraftPayload(), list)'), 'the draft is flushed before terminating');
        const blurHandler = workspace.slice(workspace.indexOf('const handleWindowBlur'), workspace.indexOf('document.addEventListener("visibilitychange"'));
        assert.ok(blurHandler.includes("if (proctoringPolicy === 'flag') return;"), 'recruitment ignores a lost window focus; students keep it');
        assert.ok(workspace.includes('Resume Assessment & Enter Fullscreen') && workspace.includes('await api.resumeSection()'));
    });
});
