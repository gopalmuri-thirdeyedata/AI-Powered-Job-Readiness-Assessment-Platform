// Recruitment (shared-link) workflow in a real browser against the real backend on a scratch database.
//
// What is real: the frontend, the FastAPI backend, the scoring/timing code, Chrome with fake camera + microphone devices,
// and the Python runtime of this machine (the code sandbox stand-in for Judge0).
// What is NOT real here (and therefore not proven): Gemini (offline mock mode), ElevenLabs (stubbed in the backend harness; a
// real spoken conversation needs a person and a microphone), Judge0.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
let org;
before(async () => {
  stack = await startStack();
  org = await stack.newOrg('rec');
});
after(() => stack?.stop());

const open = async (opts) => {
  const { browser, context } = await U.launch(opts);
  const ui = await U.newPage(context, stack.api);
  return { browser, context, ui };
};

describe('student sign-in and the explicit start', () => {
  test('the link asks only for the account email and password: no name / phone registration form, no OTP, no social sign-in', async () => {
    const { browser, ui } = await open();
    try {
      await ui.page.goto(`${stack.web}/assessment/join/${org.share_token}`);
      await ui.page.getByPlaceholder('you@example.com').waitFor();
      const inputs = await ui.page.locator('input:visible, textarea:visible').evaluateAll((els) => els.map((e) => ({ type: e.type, ph: e.placeholder })));
      assert.equal(inputs.length, 2, JSON.stringify(inputs));
      assert.deepEqual(inputs.map((i) => i.type).sort(), ['email', 'password']);
      const text = (await ui.text()).toLowerCase();
      for (const forbidden of ['full name', 'phone number', 'e.g. priya sharma', 'sign in with google', 'continue with google', 'create account', 'send code', 'enter the code']) assert.ok(!text.includes(forbidden), forbidden);
      assert.equal(ui.count(/\/register$/), 0, 'the old candidate registration request is never made');
      // an empty form sends nothing
      await ui.page.getByRole('button', { name: 'Sign in' }).click();
      await ui.page.waitForTimeout(500);
      assert.equal(ui.count(/\/api\/auth\/login/), 0, 'an empty form never reaches the server');
      assert.match(await ui.text(), /enter your email address and password/i);
    } finally { await browser.close(); }
  });

  test('one reusable link: a second student uses the same URL and gets an independent registration', async () => {
    const a = await open(); const b = await open();
    try {
      const ea = await U.registerCandidate(a.ui, stack.web, org.share_token, await stack.newOrgStudent(org));
      const eb = await U.registerCandidate(b.ui, stack.web, org.share_token, await stack.newOrgStudent(org));
      assert.notEqual(ea, eb);
      assert.match(a.ui.page.url(), new RegExp(`/assessment/join/${org.share_token}/instructions`));
      assert.match(b.ui.page.url(), new RegExp(`/assessment/join/${org.share_token}/instructions`));
    } finally { await a.browser.close(); await b.browser.close(); }
  });

  test('nothing starts the clock until the Start Assessment click; the click creates exactly one attempt with a 20 / 60 minute clock', async () => {
    const { browser, ui } = await open();
    try {
      await U.registerCandidate(ui, stack.web, org.share_token, await stack.newOrgStudent(org));
      assert.equal(ui.count(/\/start$/), 0, 'signing in starts nothing');
      assert.equal(await ui.page.getByRole('button', { name: 'Continue to Device Check' }).isDisabled(), true, 'the acknowledgement gates the next step');
      await U.acknowledgeAndOpenDeviceCheck(ui);
      await ui.page.reload();                                                 // reading time, reloads and the device check never start anything
      await ui.page.waitForTimeout(2500);
      assert.equal(ui.count(/\/start$/), 0, 'no POST /start before the explicit click');
      await ui.page.locator('input[type=checkbox]').last().check();
      await ui.page.getByRole('button', { name: /Start Assessment/ }).dblclick();      // a double click must not create two attempts
      await ui.page.waitForSelector('text=Question 1 of 15', { timeout: 30000 });
      assert.equal(ui.count(/\/start$/), 1, 'one start request despite the double click');
      const [section, total] = await U.timers(ui);
      assert.ok(U.toSeconds(section) >= 19 * 60 + 50 && U.toSeconds(section) <= 20 * 60, `section clock ${section}`);
      assert.ok(U.toSeconds(total) >= 59 * 60 + 50 && U.toSeconds(total) <= 60 * 60, `overall clock ${total}`);
      const row = await stack.session(U.sessionUuid(ui));
      assert.equal(row.state, 'APTITUDE_IN_PROGRESS');
      assert.deepEqual(Object.values(row.rounds).map((r) => r.limit), [20, 20, 20]);
      const deadlineMinutes = (new Date(row.overall_deadline_at) - new Date(row.started_at)) / 60000;
      assert.equal(deadlineMinutes, 60);
    } finally { await browser.close(); }
  });
});

describe('the full journey in the browser', () => {
  test('aptitude -> coding (Python only, errors surfaced) -> interview -> reports show the persisted scores', async () => {
    const { browser, ui } = await open();
    try {
      await U.startRecruitmentAttempt(ui, stack, org);
      const uuid = U.sessionUuid(ui);

      // ---- aptitude: drafts autosave, the section is submitted once
      const chosen = await U.answerAptitude(ui, { submit: false });
      for (let i = 0; i < 25 && ui.t.responses.filter((r) => /\/draft$/.test(r.path) && r.status === 200).length === 0; i++) await ui.page.waitForTimeout(1000);
      assert.ok(ui.t.responses.some((r) => /\/draft$/.test(r.path) && r.status === 200), 'answers are autosaved to the server');
      await ui.page.getByRole('button', { name: /Submit Aptitude/ }).click();
      await U.openCoding(ui);
      const [, totalAfter] = await U.timers(ui);
      assert.ok(U.toSeconds(totalAfter) < 60 * 60, 'the overall clock keeps running across sections');

      // ---- coding: the LeetCode workspace (function only, Python only): a pass, then a runtime error is shown, then the fix passes
      assert.doesNotMatch(await U.editorText(ui), /import|__main__|stdin|json/i, 'the candidate sees only class Solution and the signature');
      assert.equal(await ui.page.getByRole('button', { name: /Java/ }).count(), 0, 'Python is the only language');
      await U.setCode(ui, U.SOLUTIONS.sumPython);
      assert.match(await U.runPublicTests(ui), /Sample tests passed/);
      await ui.page.getByRole('button', { name: 'Problem 2' }).click();
      await U.setCode(ui, U.SOLUTIONS.pythonRuntimeError);
      assert.match(await U.runPublicTests(ui), /ZeroDivisionError|Runtime Error/i);
      await U.setCode(ui, U.SOLUTIONS.reversePython);
      assert.match(await U.runPublicTests(ui), /Sample tests passed/);
      const executed = (await stack.info()).executions;
      assert.ok(executed.includes('python') && !executed.includes('java'), `only Python was used: ${executed}`);

      // ---- interview (voice is covered separately; here the written fallback keeps the journey free of external calls)
      await U.stubVoiceApi(ui.page);
      await U.submitCodingToInterview(ui);
      await U.answerWrittenInterview(ui);
      await U.finishInterview(ui);
      await ui.page.waitForSelector('text=Assessment submitted', { timeout: 60000 });
      const final = await ui.text();
      assert.ok(!/\d+(\.\d+)?\s*%|score/i.test(final.split('Assessment submitted')[1] || ''), 'the candidate is shown no score');

      // ---- persisted truth, recomputed independently of the server's own arithmetic
      const row = await stack.session(uuid);
      assert.equal(row.state, 'COMPLETED');
      assert.equal(row.scoring_model, 'equal_v1');
      const regs = await stack.call('GET', '/api/admin/recruitment/candidates?page_size=100', { token: org.token });
      const mine = regs.body.items.find((i) => i.status === 'COMPLETED' && i.overall_score === row.reported_overall);
      assert.ok(mine, 'the roster row matches the persisted overall');
      const dossier = (await stack.call('GET', `/api/admin/recruitment/candidates/${mine.id}/dossier`, { token: org.token })).body;
      const questions = dossier.report.sections.aptitude.details.questions;
      const expectedAptitude = questions.filter((q, i) => q.correct_key === chosen[i]).length / questions.length * 100;
      assert.ok(Math.abs(row.aptitude - expectedAptitude) < 1e-6, `aptitude ${row.aptitude} vs ${expectedAptitude}`);
      assert.equal(row.coding, 100, 'Python sum and reverse-string pass every hidden test');
      assert.equal(row.rounds.INTERVIEW.status, 'EVALUATED');
      const expectedOverall = Math.round(((row.aptitude + row.coding + row.interview) / 3) * 100) / 100;
      assert.equal(row.reported_overall, expectedOverall, 'overall = equal-weight mean of the full-precision sections, two decimals');
      assert.equal(dossier.report.overall_score, expectedOverall);
      assert.equal(mine.overall_score, expectedOverall);
      assert.equal(dossier.report.scoring_model, 'equal_v1');
      assert.equal(dossier.report.sections.coding.score, 100);
      assert.ok(dossier.session.rules_acknowledged_at, 'the rules acknowledgement is recorded');
      assert.equal(ui.t.errors.length, 0, `no uncaught page errors: ${ui.t.errors}`);
    } finally { await browser.close(); }
  });
});

describe('integrity, interruptions and the clock', () => {
  test('integrity events are recorded for the hiring team and never end the attempt', async () => {
    const { browser, ui } = await open();
    await U.stubNoPersonProctoring(ui.page);                      // deterministic: nobody is in front of the camera
    try {
      await U.startRecruitmentAttempt(ui, stack, org);
      const uuid = U.sessionUuid(ui);
      for (let i = 0; i < 60; i++) {                                       // the fake camera never shows a person: events accumulate
        const m = (await ui.text()).match(/Integrity events:\s*(\d+)/);
        if (m && Number(m[1]) >= 4) break;
        await ui.page.waitForTimeout(1500);
      }
      const text = await ui.text();
      assert.match(text, /Integrity events:\s*[4-9]/);
      assert.match(text, /recorded for the hiring team/);
      assert.ok(!/Assessment terminated|Strikes/.test(text), 'no strike / termination wording for recruitment candidates');
      assert.equal((await stack.session(uuid)).state, 'APTITUDE_IN_PROGRESS', 'four or more events: still sitting');
      await U.answerAptitude(ui);
      await U.openCoding(ui);
      const row = await stack.session(uuid);
      assert.ok(row.rounds.APTITUDE.violations >= 3, `events persisted with the submission: ${row.rounds.APTITUDE.violations}`);
      assert.equal(row.state, 'CODING_IN_PROGRESS');
    } finally { await browser.close(); }
  });

  test('frame analysis uses the sitting capability: authorized in the browser, refused without it', async () => {
    const { browser, ui } = await open();
    try {
      await U.startRecruitmentAttempt(ui, stack, org);
      for (let i = 0; i < 20 && !ui.t.responses.some((r) => r.path === '/api/proctor/analyze-frame'); i++) await ui.page.waitForTimeout(1000);
      const analyzed = ui.t.responses.filter((r) => r.path === '/api/proctor/analyze-frame');
      assert.ok(analyzed.length > 0 && analyzed.every((r) => r.status === 200), JSON.stringify(analyzed.slice(0, 3)));
      const anonymous = await ui.page.request.post(`${stack.api}/api/proctor/analyze-frame`, { data: { image: 'x' } });
      assert.equal(anonymous.status(), 401);
    } finally { await browser.close(); }
  });

  test('a page refresh ends the sitting for the candidate (no resume) and, once the heartbeat is stale, the attempt is abandoned', async () => {
    const { browser, ui } = await open();
    try {
      await U.startRecruitmentAttempt(ui, stack, org);
      const uuid = U.sessionUuid(ui);
      await U.answerAptitude(ui, { count: 3, submit: false });
      await ui.page.reload();
      await ui.page.waitForTimeout(4000);
      const text = await ui.text();
      assert.doesNotMatch(text, /Question \d+ of 15/, 'the assessment is not resumed after a reload');
      assert.match(text, /interrupted|cannot be resumed|closed|no longer active|reload|another window/i);
      // A fresh heartbeat protects a live sitting from a duplicate tab, so the attempt is not abandoned on the spot;
      // once the heartbeat is stale the next request without the lease closes it for good.
      await stack.advance(120);
      await ui.page.reload();
      await ui.page.waitForTimeout(3000);
      assert.equal((await stack.session(uuid)).state, 'ABANDONED');
      assert.equal((await stack.session(uuid)).reported_overall, null);
    } finally { await browser.close(); }
  });

  test('past the 60-minute deadline the attempt is closed, earned sections are kept and there is no overall score', async () => {
    const { browser, ui } = await open();
    try {
      await U.startRecruitmentAttempt(ui, stack, org);
      const uuid = U.sessionUuid(ui);
      await U.answerAptitude(ui);
      await U.openCoding(ui);
      const before = await stack.session(uuid);
      await stack.advance(61 * 60);
      for (let i = 0; i < 12; i++) { if ((await stack.session(uuid)).state === 'TIMED_OUT') break; await ui.page.waitForTimeout(1500); }
      // the browser's own next request (heartbeat / state poll) makes the server enforce the deadline
      await ui.page.waitForTimeout(3000);
      let row = await stack.session(uuid);
      if (row.state !== 'TIMED_OUT') { await ui.page.getByRole('button', { name: /Submit All & Unlock Interview/ }).click().catch(() => {}); await ui.page.waitForTimeout(3000); row = await stack.session(uuid); }
      assert.equal(row.state, 'TIMED_OUT');
      assert.equal(row.reported_overall, null, 'incomplete: no overall score');
      assert.equal(row.aptitude, before.aptitude, 'the evaluated section is preserved exactly');
      assert.equal(row.rounds.INTERVIEW.status, 'UNATTEMPTED');
      assert.doesNotMatch(await ui.text(), /Question \d+ of 15|Run Public Tests/, 'the candidate cannot keep working');
    } finally { await browser.close(); }
  });
});

describe('the voice interview lifecycle', () => {
  const toInterview = async (ui, { denyMic = false } = {}) => {
    await U.startRecruitmentAttempt(ui, stack, org);
    await U.answerAptitude(ui);
    await U.openCoding(ui);
    if (!denyMic) await U.stubVoiceApi(ui.page);                     // the denial scenario never reaches the voice API
    if (denyMic) await ui.page.evaluate(() => { window.__denyMic = true; });
    await U.submitCodingToInterview(ui);
  };

  test('a connection failure is readable (no white screen) and offers Retry and a written alternative', async () => {
    const { browser, ui } = await open();
    try {
      await toInterview(ui);
      await ui.page.waitForSelector('text=Connection Failed', { timeout: 30000 });
      const text = await ui.text();
      assert.match(text, /does not exist|could not be established|timed out|connection/i);
      assert.match(text, /Retry Connection/);
      assert.match(text, /Answer in writing instead/);
      assert.equal(ui.t.errors.length, 0, `no uncaught page errors (an object rendered as a React child white-screens the candidate): ${ui.t.errors}`);
      await ui.page.getByRole('button', { name: 'Retry Connection' }).click();         // a retry replaces the instance cleanly
      await ui.page.waitForSelector('text=Connection Failed', { timeout: 30000 });
      assert.equal(ui.t.errors.length, 0);
    } finally { await browser.close(); }
  });

  // The voice session asks the browser for the microphone itself, so the denial is observable without any provider. The
  // classification logic is also unit tested in test_voice_session.test.mjs.
  test('a blocked microphone shows an actionable permission message', async () => {
    const { browser, context } = await U.launch();
    await U.armMicDenial(context);
    const ui = await U.newPage(context, stack.api);
    try {
      await toInterview(ui, { denyMic: true });
      await ui.page.waitForSelector('text=Connection Failed', { timeout: 30000 });
      assert.match(await ui.text(), /Microphone access was blocked|microphone/i);
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });

  test('a connection that never completes is released by the watchdog instead of spinning forever', async () => {
    const { browser, ui } = await open();
    try {
      await U.startRecruitmentAttempt(ui, stack, org);
      await U.answerAptitude(ui);
      await U.openCoding(ui);
      await ui.page.route('**/voice-turn', () => { /* never answered */ });
      await U.submitCodingToInterview(ui);
      await ui.page.waitForSelector('text=Connection Failed', { timeout: 40000 });
      assert.match(await ui.text(), /timed out/i);
    } finally { await browser.close(); }
  });

  test('a failed submission is never shown as completed, can be retried, and a double click sends one request', async () => {
    const { browser, ui } = await open();
    try {
      await toInterview(ui);
      await ui.page.waitForSelector('text=Connection Failed', { timeout: 30000 });
      await U.answerWrittenInterview(ui);
      let failNext = true;
      await ui.page.route('**/submit-interview', (route) => (failNext ? route.abort('connectionfailed') : route.continue()));
      const uuid = U.sessionUuid(ui);
      await ui.page.getByRole('button', { name: 'Finish interview', exact: true }).click();
      await ui.page.getByRole('button', { name: /Submit & Complete/ }).click();
      await ui.page.waitForSelector('[role=alert]', { timeout: 15000 });
      const text = await ui.text();
      assert.match(text, /could not be sent|try again/i);
      assert.doesNotMatch(text, /Assessment submitted/, 'a submission that never reached the server is not "completed"');
      assert.notEqual((await stack.session(uuid)).state, 'COMPLETED');
      failNext = false;
      const before = ui.count(/submit-interview$/);
      await ui.page.getByRole('button', { name: /Submit & Complete/ }).dblclick();     // two clicks, one submission
      await ui.page.waitForSelector('text=Assessment submitted', { timeout: 60000 });
      assert.equal(ui.count(/submit-interview$/) - before, 1, 'exactly one submission request for the double click');
      assert.equal((await stack.session(uuid)).state, 'COMPLETED');
      assert.equal(ui.t.errors.length, 0);
    } finally { await browser.close(); }
  });
});

describe('tenant isolation in the hiring team views', () => {
  test("another organization's admin can neither list nor open this organization's candidates", async () => {
    const { browser, ui } = await open();
    try {
      const email = await U.startRecruitmentAttempt(ui, stack, org);
      const other = await stack.newOrg('rec2');
      const mine = (await stack.call('GET', `/api/admin/recruitment/candidates?search=${encodeURIComponent(email)}`, { token: org.token })).body.items;
      assert.equal(mine.length, 1);
      const theirs = (await stack.call('GET', `/api/admin/recruitment/candidates?search=${encodeURIComponent(email)}`, { token: other.token })).body.items;
      assert.equal(theirs.length, 0, 'not listed for another tenant');
      const dossier = await stack.call('GET', `/api/admin/recruitment/candidates/${mine[0].id}/dossier`, { token: other.token });
      assert.equal(dossier.status, 404, 'not readable by another tenant');
      assert.equal((await stack.call('GET', `/api/admin/recruitment/candidates/${mine[0].id}/dossier`)).status, 401, 'not readable anonymously');
    } finally { await browser.close(); }
  });
});
