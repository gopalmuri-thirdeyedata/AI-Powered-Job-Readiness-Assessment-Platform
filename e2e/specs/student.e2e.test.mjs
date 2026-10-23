// Student Platform assessment workspace in a real browser against the real backend on a scratch database.
//
// Real: frontend, FastAPI backend, timing + scoring code, Chrome with fake camera/microphone, local Python + JDK as the code
// sandbox stand-in. NOT real (and therefore not proven here): Clerk sign-in (the app's JWT path is used with a minted JWT),
// Gemini (offline mock mode), Vapi (REST stubbed; the SDK talks to an intercepted endpoint), Judge0.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const openStudent = async ({ tag, token, cleanProctoring = true } = {}) => {
  const student = token ? { token } : await stack.newStudent(tag);
  const { browser, context } = await U.launch();
  await U.signInStudent(context, student.token);
  const ui = await U.newPage(context, stack.api);
  if (cleanProctoring) await U.stubCleanProctoring(ui.page);
  return { browser, context, ui, student };
};

/** The percentages the report page shows (it animates up from 0%, so wait until they stop changing). */
const shownScores = async (ui) => {
  const read = async () => {
    const t = await ui.text();
    const pct = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
    return { overall: pct(/Overall Job Readiness:\s*([0-9.]+)%/), aptitude: pct(/Aptitude & Reasoning\s*([0-9.]+)%/),
      coding: pct(/Practical Coding\s*([0-9.]+)%/), interview: pct(/AI Technical Interview\s*([0-9.]+)%/) };
  };
  let previous = JSON.stringify(await read());
  for (let i = 0; i < 30; i++) {
    await ui.page.waitForTimeout(700);
    const now = JSON.stringify(await read());
    if (now === previous && !now.includes('null')) return JSON.parse(now);
    previous = now;
  }
  return JSON.parse(previous);
};

/** setup -> instructions -> device check -> explicit start. Returns the session uuid. */
const beginAssessment = async (ui) => {
  const uuid = await U.createStudentAssessment(ui, stack.web);
  await U.studentDeviceCheckAndStart(ui);
  return uuid;
};

describe('student authentication', () => {
  test('without a valid credential the assessment pages send the student to sign in', async () => {
    const { browser, context } = await U.launch();
    try {
      const ui = await U.newPage(context, stack.api);
      await ui.page.goto(`${stack.web}/assessment/setup`);
      await ui.page.waitForURL(/auth=student/, { timeout: 20000 });
      assert.match(ui.page.url(), /\/\?auth=student/);
      assert.ok(!ui.t.responses.some((r) => r.path.startsWith('/api/roleready/student/initialize')), 'nothing is created for an unauthenticated visitor');
    } finally { await browser.close(); }
  });

  test('an invalid or tampered token is refused by the server and removed from the browser', async () => {
    const { browser, context } = await U.launch();
    try {
      await U.signInStudent(context, 'not.a.valid.jwt');
      const ui = await U.newPage(context, stack.api);
      await ui.page.goto(`${stack.web}/assessment/setup`);
      await ui.page.waitForURL(/auth=student/, { timeout: 20000 });
      assert.equal(await ui.page.evaluate(() => localStorage.getItem('studentToken')), null);
      assert.ok(ui.t.responses.some((r) => r.path === '/api/auth/me' && r.status === 401));
    } finally { await browser.close(); }
  });

  test("a student can open the setup page, and another student's session is not reachable", async () => {
    const a = await openStudent({ tag: 'authA' });
    try {
      await a.ui.page.goto(`${stack.web}/assessment/setup`);
      await a.ui.page.waitForSelector('text=Set Up Your Assessment', { timeout: 30000 });
      const uuid = await U.createStudentAssessment(a.ui, stack.web);
      const b = await stack.newStudent('authB');
      assert.equal((await stack.call('GET', `/api/roleready/session/${uuid}`, { token: b.token })).status, 403, 'another student is refused');
      assert.equal((await stack.call('GET', `/api/roleready/session/${uuid}`)).status, 401, 'anonymous is refused');
      assert.equal((await stack.call('GET', `/api/roleready/session/${uuid}`, { token: a.student.token })).status, 200);
    } finally { await a.browser.close(); }
  });
});

describe('setup and the explicit start', () => {
  test('setup validates its input, creates an attempt with 20 / 20 / 20 minute rounds, and nothing starts until Start Assessment', async () => {
    const { browser, ui } = await openStudent({ tag: 'setup' });
    try {
      await ui.page.goto(`${stack.web}/assessment/setup`);
      await U.dismissTour(ui.page);
      await ui.page.getByRole('button', { name: /Start Assessment/ }).click();
      await ui.page.waitForTimeout(800);
      assert.equal(ui.count(/student\/initialize$/), 0, 'an incomplete form is never submitted');
      assert.match(await ui.text(), /required/i);

      const uuid = await U.createStudentAssessment(ui, stack.web);
      let row = await stack.session(uuid);
      assert.equal(row.state, 'NOT_STARTED');
      assert.deepEqual(Object.values(row.rounds).map((r) => r.limit), [20, 20, 20]);
      assert.equal(row.overall_deadline_at, null, 'the 60-minute deadline does not exist before the explicit start');
      await ui.page.waitForSelector('text=Assessment Overview', { timeout: 30000 });
      assert.match(await ui.text(), /3 Sequential Rounds|20 Mins/);

      await ui.page.getByRole('button', { name: 'Continue to Device Check' }).click();
      await ui.page.waitForTimeout(2500);
      await ui.page.reload();                                           // reading time and reloads never start the clock
      await ui.page.waitForTimeout(2500);
      assert.equal(ui.count(/start-aptitude$/), 0);
      assert.equal((await stack.session(uuid)).state, 'NOT_STARTED');

      await ui.page.getByRole('button', { name: 'Continue to Device Check' }).click().catch(() => {});
      await ui.page.waitForTimeout(2000);
      await ui.page.locator('input[type=checkbox]').last().check();
      await ui.page.getByRole('button', { name: /Start Assessment/ }).dblclick();     // a double click starts exactly once
      await ui.page.waitForSelector('text=/Question 1 of \\d+/', { timeout: 60000 });
      assert.equal(ui.count(/start-aptitude$/), 1);
      const [section, total] = await U.timers(ui);
      assert.ok(U.toSeconds(section) >= 19 * 60 + 50 && U.toSeconds(total) >= 59 * 60 + 50, `${section} / ${total}`);
      row = await stack.session(uuid);
      assert.equal(row.state, 'APTITUDE_IN_PROGRESS');
      assert.equal((new Date(row.overall_deadline_at) - new Date(row.started_at)) / 60000, 60);
    } finally { await browser.close(); }
  });
});

describe('the full student journey', () => {
  test('aptitude (persisted) -> coding (Python + Java, errors) -> interview -> report with the persisted scores', async () => {
    const { browser, ui, student } = await openStudent({ tag: 'journey' });
    try {
      const uuid = await beginAssessment(ui);

      // ---- aptitude: answers survive a reload (server-side drafts), then the section is submitted once
      const n = await U.aptitudeCount(ui);
      await U.answerAptitude(ui, { count: 4, submit: false });
      for (let i = 0; i < 25 && !ui.t.responses.some((r) => /\/draft$/.test(r.path) && r.status === 200); i++) await ui.page.waitForTimeout(1000);
      assert.ok(ui.t.responses.some((r) => /\/draft$/.test(r.path) && r.status === 200), 'answers are autosaved');
      await ui.page.reload();
      await ui.page.waitForSelector('text=/Question \\d+ of \\d+/', { timeout: 60000 }).catch(() => {});
      const afterReload = await ui.text();
      assert.match(afterReload, /Question \d+ of \d+|Continue|Resume/i, 'the attempt is still open after a reload (students may resume)');
      assert.equal((await stack.session(uuid)).state, 'APTITUDE_IN_PROGRESS');
      const chosen = await U.answerAptitude(ui, { count: n, submit: true });
      await U.openCoding(ui);

      // ---- coding
      assert.match(await ui.text(), /Round 2: Practical Coding/);
      await U.setCode(ui, U.STUDENT_SOLUTIONS.uniqueRunPython);
      assert.match(await U.runPublicTests(ui), /PASS \(All Public Cases\)/);
      await ui.page.getByRole('button', { name: 'Problem 2' }).click();
      await ui.page.getByRole('button', { name: /Java 17/ }).click();
      await U.setCode(ui, U.SOLUTIONS.javaCompileError);
      assert.match(await U.runPublicTests(ui), /Compilation Error|COMPILE ERROR|error:/i);
      await U.setCode(ui, U.STUDENT_SOLUTIONS.tagsJava);
      assert.match(await U.runPublicTests(ui), /PASS \(All Public Cases\)/);
      await ui.page.getByRole('button', { name: /Python 3\.11/ }).click();
      await U.setCode(ui, U.SOLUTIONS.pythonRuntimeError);
      assert.match(await U.runPublicTests(ui), /ZeroDivisionError|Runtime Error/i);
      const executed = (await stack.info()).executions;
      assert.ok(executed.includes('python') && executed.includes('java'), `both runtimes were used: ${executed}`);
      // submit Python for problem 2 as well (a correct one), so the section is fully solved
      await U.setCode(ui, U.STUDENT_SOLUTIONS.tagsPython);

      // ---- interview (voice failure -> written fallback keeps the journey free of external calls)
      await U.stubVapiRest(ui.page);
      await U.submitCodingToInterview(ui);
      await U.answerWrittenInterview(ui);
      await U.finishInterview(ui);
      await ui.page.waitForURL(/\/report$/, { timeout: 90000 });
      await ui.page.waitForFunction(() => /Overall|Readiness/i.test(document.body.innerText) && !/Loading module|AI Video Interview|Written interview answers/.test(document.body.innerText), null, { timeout: 90000 });

      // ---- persisted truth, recomputed independently
      let row;
      for (let i = 0; i < 40; i++) { row = await stack.session(uuid); if (row.state === 'COMPLETED') break; await ui.page.waitForTimeout(1500); }
      assert.equal(row.state, 'COMPLETED');
      assert.equal(row.scoring_model, 'equal_v1');
      const report = (await stack.call('GET', `/api/roleready/session/${uuid}/report`, { token: student.token })).body;
      assert.equal(report.scoring_model, 'equal_v1');
      const expectedOverall = Math.round(((row.aptitude + row.coding + row.interview) / 3) * 100) / 100;
      assert.equal(row.reported_overall, expectedOverall);
      assert.equal(report.overall_readiness_score, expectedOverall);
      assert.equal(report.aptitude_score, Math.round(row.aptitude * 100) / 100);
      assert.ok(row.coding > 0, `the hidden tests passed for at least one problem (${row.coding})`);
      assert.equal(row.rounds.INTERVIEW.status, 'EVALUATED');
      assert.ok(chosen.length === n);
      const shown = await shownScores(ui);
      const near = (a, b) => a !== null && Math.abs(a - b) <= 0.51;          // the page shows whole percentages
      assert.ok(near(shown.overall, expectedOverall), `report overall ${shown.overall} vs persisted ${expectedOverall}`);
      assert.ok(near(shown.aptitude, row.aptitude) && near(shown.coding, row.coding) && near(shown.interview, row.interview),
        `report sections ${JSON.stringify(shown)} vs persisted ${row.aptitude}/${row.coding}/${row.interview}`);

      // ---- refresh and persistence: the report is rebuilt from the stored result, not from page state
      await ui.page.reload();
      await ui.page.waitForFunction(() => /Overall|Readiness/i.test(document.body.innerText) && !/Loading module/.test(document.body.innerText), null, { timeout: 90000 });
      const afterRefresh = await shownScores(ui);
      assert.ok(near(afterRefresh.overall, expectedOverall) && near(afterRefresh.coding, row.coding), `after a refresh the report still shows the persisted result: ${JSON.stringify(afterRefresh)}`);
      const history = (await stack.call('GET', '/api/roleready/student/history', { token: student.token })).body.assessments.find((a) => a.session_uuid === uuid);
      assert.equal(history.overall_readiness_score, expectedOverall);
      assert.equal(history.scoring_model, 'equal_v1');
      assert.equal(ui.t.errors.length, 0, `no uncaught page errors: ${ui.t.errors}`);
    } finally { await browser.close(); }
  });
});

describe('incomplete attempts and the clock', () => {
  test('past the 60-minute deadline the attempt is closed, the evaluated section is kept and no overall score is reported', async () => {
    const { browser, ui, student } = await openStudent({ tag: 'timeout' });
    try {
      const uuid = await beginAssessment(ui);
      const n = await U.aptitudeCount(ui);
      await U.answerAptitude(ui, { count: n });
      await U.openCoding(ui);
      const before = await stack.session(uuid);
      await stack.advance(61 * 60);
      await ui.page.reload();
      await ui.page.waitForTimeout(4000);
      const row = await stack.session(uuid);
      assert.equal(row.state, 'TIMED_OUT');
      assert.equal(row.reported_overall, null);
      assert.equal(row.aptitude, before.aptitude);
      assert.notEqual(row.rounds.INTERVIEW.status, 'EVALUATED');
      const report = (await stack.call('GET', `/api/roleready/session/${uuid}/report`, { token: student.token })).body;
      assert.equal(report.overall_readiness_score, null);
      assert.equal(report.coding_score === null || report.coding_score === 0, true);
      assert.equal(report.interview_score, null, 'a section that was never reached is null, not a fabricated zero');
      assert.doesNotMatch(await ui.text(), /Run Public Tests/, 'the student cannot keep working on a closed attempt');
    } finally { await browser.close(); }
  });
});

describe('proctoring integration and authorization', () => {
  test('frame analysis works with the student credential and is refused without one', async () => {
    const { browser, ui, student } = await openStudent({ tag: 'proctor', cleanProctoring: false });
    try {
      await beginAssessment(ui);
      // the first real inference in a fresh backend includes loading the YOLO model, which can take well over 20 seconds
      for (let i = 0; i < 90 && !ui.t.responses.some((r) => r.path === '/api/proctor/analyze-frame'); i++) await ui.page.waitForTimeout(1000);
      const analyzed = ui.t.responses.filter((r) => r.path === '/api/proctor/analyze-frame');
      assert.ok(analyzed.length > 0 && analyzed.every((r) => r.status === 200), JSON.stringify({ analyzed: analyzed.slice(0, 3), all: ui.t.responses.slice(-8), errors: ui.t.errors, text: (await ui.text()).slice(0, 200) }));
      assert.equal((await ui.page.request.post(`${stack.api}/api/proctor/analyze-frame`, { data: { image: 'x' } })).status(), 401);
      // a valid credential reaches validation (a malformed image is a 400, not a 401). A second student is used so the check
      // does not race this student's own in-flight frames (one frame per principal at a time is part of the protection).
      const other = await stack.newStudent('proctor2');
      const malformed = await ui.page.request.post(`${stack.api}/api/proctor/analyze-frame`, { data: { image: 'x' }, headers: { Authorization: `Bearer ${other.token}` } });
      assert.equal(malformed.status(), 400);
      assert.equal(student.token.length > 0, true);
    } finally { await browser.close(); }
  });

  test('Student policy: three real integrity warnings end the attempt (unlike recruitment, which only records them)', async () => {
    const { browser, ui } = await openStudent({ tag: 'strikes', cleanProctoring: false });
    await U.stubNoPersonProctoring(ui.page);                      // deterministic: nobody is in front of the camera
    try {
      const uuid = await beginAssessment(ui);
      for (let i = 0; i < 90; i++) {
        if (/Assessment Terminated|3\/3/.test(await ui.text())) break;
        await ui.page.waitForTimeout(1500);
      }
      const text = await ui.text();
      assert.match(text, /Assessment Terminated|Maximum violations reached|3\/3 Strikes/i);
      const row = await stack.session(uuid);
      assert.equal(row.state, 'COMPLETED', 'a terminated student attempt is closed');
      assert.equal(row.reported_overall, 0, 'a forfeited attempt reports its explicit zero');
    } finally { await browser.close(); }
  });
});
