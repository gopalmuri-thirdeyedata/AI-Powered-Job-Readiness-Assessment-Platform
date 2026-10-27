// Invited-student workflow in a real browser against the real backend on a scratch database:
//   open link -> sign in (account an administrator created) -> instructions -> device check -> explicit start -> the three sections
//   -> completion page -> mandatory 30-word review -> report download (a real PDF) -> countdown -> student dashboard.
//
// Real: frontend, backend, login sessions, tenant scoping, scoring, report release, Chrome (fake camera/mic), local Python as the
// code sandbox. NOT real: Gemini (offline mock mode), Vapi (REST stubbed; the interview is answered in writing), Judge0.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
let org;
before(async () => { stack = await startStack(); org = await stack.newOrg('sa'); });
after(() => stack?.stop());

const open = async (opts) => {
  const { browser, context } = await U.launch(opts);
  const ui = await U.newPage(context, stack.api);
  return { browser, context, ui };
};

const words = (n) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
const reviewBox = (ui) => ui.page.locator('textarea[aria-label="Exam review"]');
const counter = (ui) => ui.page.getByTestId('word-counter');

/** Sign in through the link, take the whole assessment in the browser and land on the completion page. */
async function finishAssessment(ui, student) {
  await U.registerCandidate(ui, stack.web, org.share_token, student);
  await U.acknowledgeAndOpenDeviceCheck(ui);
  await U.clickStart(ui);
  const uuid = U.sessionUuid(ui);
  await U.answerAptitude(ui);
  await U.openCoding(ui);
  await U.setCode(ui, U.SOLUTIONS.sumPython);
  await U.stubVapiRest(ui.page);
  await U.submitCodingToInterview(ui);
  await U.answerWrittenInterview(ui);
  await U.finishInterview(ui);
  await ui.page.waitForURL(/\/complete$/, { timeout: 90000 });
  await reviewBox(ui).waitFor({ timeout: 30000 }).catch(async (err) => {
    const api = ui.t.responses.filter((r) => /student-assessment/.test(r.path)).map((r) => `${r.method} ${r.path} ${r.status}`);
    const logs = ui.t.console.filter((c) => c.type === 'error').map((c) => c.text.slice(0, 300));
    throw new Error(`${err.message}\nPAGE: ${(await ui.text()).slice(0, 400)}\nAPI: ${api.join(' | ')}\nERRORS: ${ui.t.errors.join(' ; ')} ${logs.join(' ; ')}`);
  });
  return uuid;
}

describe('access to the link', () => {
  test('wrong password and an administrator account are refused; the intended assessment is kept; nothing starts', async () => {
    const { browser, ui } = await open();
    const student = await stack.newOrgStudent(org);
    try {
      await ui.page.goto(`${stack.web}/assessment/join/${org.share_token}`);
      await ui.page.getByPlaceholder('you@example.com').fill(student.email);
      await ui.page.locator('input[autocomplete="current-password"]').fill('not-the-password');
      await ui.page.getByRole('button', { name: 'Sign in' }).click();
      await ui.page.getByRole('alert').filter({ hasText: /invalid|incorrect|wrong|credentials/i }).waitFor({ timeout: 15000 });
      assert.match(ui.page.url(), new RegExp(`/assessment/join/${org.share_token}$`), 'still on the intended assessment link');

      // an administrator's own credentials open nothing here
      await ui.page.getByPlaceholder('you@example.com').fill(org.email);
      await ui.page.locator('input[autocomplete="current-password"]').fill(org.password);
      await ui.page.getByRole('button', { name: 'Sign in' }).click();
      await ui.page.getByRole('alert').filter({ hasText: /student account/i }).waitFor({ timeout: 15000 });
      assert.doesNotMatch(ui.page.url(), /instructions|admin/);
      assert.equal(ui.count(/\/start$/), 0);
      const me = await ui.page.evaluate(async (api) => (await fetch(`${api}/api/auth/me`, { credentials: 'include' })).status, stack.api);
      assert.equal(me, 401, 'the administrator session created by that attempt was ended');
    } finally { await browser.close(); }
  });

  test('a signed-in student goes straight to the instructions; no form, no attempt, and a reload still works', async () => {
    const { browser, ui } = await open();
    const student = await stack.newOrgStudent(org, 'Maya Patel');
    try {
      await U.registerCandidate(ui, stack.web, org.share_token, student);
      assert.match(ui.page.url(), /\/instructions$/);
      await ui.page.getByRole('heading', { name: 'Exam Instructions' }).waitFor({ timeout: 20000 });
      assert.match(await ui.text(), /Your timer has not started/);
      assert.equal(ui.count(/\/start$/), 0);
      assert.equal(ui.count(/\/register$/), 0);
      // back at the link while still signed in: access is re-issued, no second form, still no attempt
      await ui.page.goto(`${stack.web}/assessment/join/${org.share_token}`);
      await ui.page.waitForURL(/instructions$/, { timeout: 20000 });
      await ui.page.getByRole('heading', { name: 'Exam Instructions' }).waitFor({ timeout: 20000 });
      assert.equal(ui.count(/\/start$/), 0);
    } finally { await browser.close(); }
  });
});

describe('completion: review, report, redirect', () => {
  test('review is mandatory; the report unlocks only after it is saved; the download is a real PDF; then the dashboard', async () => {
    const { browser, context, ui } = await open();
    const student = await stack.newOrgStudent(org, 'Priya Nair');
    try {
      const uuid = await finishAssessment(ui, student);
      const text = await ui.text();
      assert.match(text, /Assessment submitted/);
      assert.ok(!/\d+(\.\d+)?\s*%/.test(text), 'no score is shown on the completion page');

      const download = ui.page.getByRole('button', { name: /Download Report/ });
      const submit = ui.page.getByRole('button', { name: 'Submit Review' });
      assert.equal(await download.isDisabled(), true, 'locked before the review');
      assert.equal(await submit.isDisabled(), true);
      assert.match(await counter(ui).innerText(), /^0 \/ 30 words$/);

      // the live counter and the validation message
      await reviewBox(ui).fill(words(18));
      assert.match(await counter(ui).innerText(), /^18 \/ 30 words$/);
      assert.match(await ui.text(), /at least 30 words\. Write 12 more words/);
      assert.equal(await submit.isDisabled(), true);
      await reviewBox(ui).fill(`  ${words(29)}  \n\n  `);                      // spaces and line breaks do not add words
      assert.match(await counter(ui).innerText(), /^29 \/ 30 words$/);
      assert.equal(await submit.isDisabled(), true);

      // the server refuses the download no matter what the page shows
      const direct = await context.request.get(`${stack.api}/api/student-assessment/attempts/${uuid}/report`);
      assert.equal(direct.status(), 403);
      assert.equal((await direct.json()).detail.code, 'REVIEW_REQUIRED');
      // ...and refuses a short review sent behind the page's back
      const csrf = (await (await context.request.get(`${stack.api}/api/auth/me`)).json()).csrf_token;
      const bypass = await context.request.post(`${stack.api}/api/student-assessment/attempts/${uuid}/review`, { data: { review: words(29) }, headers: { 'X-CSRF-Token': csrf } });
      assert.equal(bypass.status(), 422);

      // exactly 30 words: accepted
      await reviewBox(ui).fill(words(30));
      assert.match(await counter(ui).innerText(), /^30 \/ 30 words$/);
      assert.equal(await submit.isDisabled(), false);
      await submit.click();
      await ui.page.getByTestId('review-saved').waitFor({ timeout: 15000 });
      assert.equal(await download.isDisabled(), false, 'unlocked once the review is saved');
      assert.equal(await reviewBox(ui).getAttribute('readonly') !== null, true, 'a saved review is read-only');

      // the saved state is the server's: a reload keeps the review and keeps the report unlocked
      await ui.page.reload();
      await ui.page.getByTestId('review-saved').waitFor({ timeout: 30000 });
      assert.equal(await download.isDisabled(), false);
      assert.equal((await context.request.post(`${stack.api}/api/student-assessment/attempts/${uuid}/review`, { data: { review: words(40) }, headers: { 'X-CSRF-Token': csrf } })).status(), 409);

      // download -> a real PDF of the stored report, then the countdown and the redirect to the student dashboard
      const [file] = await Promise.all([ui.page.waitForEvent('download', { timeout: 60000 }), download.click()]);
      assert.match(file.suggestedFilename(), /^PrepWin-Assessment-Report-.*\.pdf$/);
      const bytes = fs.readFileSync(await file.path());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      await ui.page.getByTestId('download-started').waitFor({ timeout: 15000 });
      const left = Number(await ui.page.getByTestId('redirect-countdown').innerText());
      assert.ok(left >= 1 && left <= 10, `countdown ${left}`);
      assert.doesNotMatch(ui.page.url(), /student\/dashboard/, 'not redirected the instant the download starts');
      await ui.page.waitForURL(/\/student\/dashboard/, { timeout: 20000 });
      const me = await ui.page.evaluate(async (api) => (await fetch(`${api}/api/auth/me`, { credentials: 'include' })).status, stack.api);
      assert.equal(me, 200, 'the same session carries over: no second login');
      assert.ok(ui.t.errors.length === 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });

  test('a failed report is explained, nothing redirects, and Try again works', async () => {
    const { browser, ui } = await open();
    const student = await stack.newOrgStudent(org, 'Retry Student');
    try {
      await finishAssessment(ui, student);
      await reviewBox(ui).fill(words(31));
      await ui.page.getByRole('button', { name: 'Submit Review' }).click();
      await ui.page.getByTestId('review-saved').waitFor({ timeout: 15000 });

      await ui.page.route('**/api/student-assessment/attempts/*/report', (route) => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'REPORT_GENERATION_FAILED', message: 'Your report could not be generated right now. Please try again.' } }),
      }));
      await ui.page.getByRole('button', { name: /Download Report/ }).click();
      await ui.page.getByTestId('download-error').waitFor({ timeout: 15000 });
      assert.match(await ui.page.getByTestId('download-error').innerText(), /could not be generated/);
      await ui.page.waitForTimeout(9500);                                   // longer than the countdown would have been
      assert.match(ui.page.url(), /\/complete$/, 'no redirect after a failed download');
      assert.equal(await ui.page.getByTestId('download-started').count(), 0);

      await ui.page.unroute('**/api/student-assessment/attempts/*/report');
      const [file] = await Promise.all([ui.page.waitForEvent('download', { timeout: 60000 }), ui.page.getByRole('button', { name: /Try download again/ }).click()]);
      assert.match(file.suggestedFilename(), /\.pdf$/);
      await ui.page.waitForURL(/\/student\/dashboard/, { timeout: 20000 });
    } finally { await browser.close(); }
  });
});

describe('administrator-authorised retake link', () => {
  /** A student who started an attempt that then hit a verified outage, and the retake link the administrator generated for them. */
  async function retakeFor(student) {
    const { browser, context, ui } = await open();
    await U.registerCandidate(ui, stack.web, org.share_token, student);
    await U.acknowledgeAndOpenDeviceCheck(ui);
    await U.clickStart(ui);
    const uuid = U.sessionUuid(ui);
    await browser.close();
    assert.equal((await stack.call('POST', `/__e2e/session-state?session_uuid=${uuid}&state=MANUAL_REVIEW_REQUIRED`)).status, 200);
    const list = await stack.call('GET', `/api/admin/recruitment/candidates?search=${encodeURIComponent(student.email)}`, { token: org.token });
    const regId = list.body.items[0].id;
    const r = await stack.call('POST', `/api/admin/recruitment/candidates/${regId}/authorize-retake`, { token: org.token, json: { justification: 'Verified platform outage during the sitting.' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return `${stack.web}/assessment/join/${org.share_token}?registration_token=${encodeURIComponent(r.body.registration_token)}`;
  }

  test('an unauthenticated student sees the login (not an error), keeps the retake destination, and only their own account can use it', async () => {
    const student = await stack.newOrgStudent(org, 'Retake Owner');
    const other = await stack.newOrgStudent(org, 'Retake Bystander');
    const link = await retakeFor(student);
    const { browser, ui } = await open();
    try {
      await ui.page.goto(link);
      await ui.page.getByPlaceholder('you@example.com').waitFor({ timeout: 20000 });         // the login screen, not a "sign in" error
      assert.match(await ui.text(), /authorised a new attempt for you/);
      assert.match(ui.page.url(), /registration_token=/, 'the retake destination is preserved while signing in');
      assert.equal(ui.count(/\/start$/), 0);

      // an administrator's credentials open nothing
      await ui.page.getByPlaceholder('you@example.com').fill(org.email);
      await ui.page.locator('input[autocomplete="current-password"]').fill(org.password);
      await ui.page.getByRole('button', { name: 'Sign in' }).click();
      await ui.page.getByRole('alert').filter({ hasText: /student account/i }).waitFor({ timeout: 15000 });

      // another student cannot use somebody else's retake authorisation
      await ui.page.getByPlaceholder('you@example.com').fill(other.email);
      await ui.page.locator('input[autocomplete="current-password"]').fill(other.password);
      await ui.page.getByRole('button', { name: 'Sign in' }).click();
      await ui.page.getByText(/not valid for your account/i).waitFor({ timeout: 15000 });
      assert.doesNotMatch(ui.page.url(), /instructions/);
      assert.equal(ui.count(/\/start$/), 0);
    } finally { await browser.close(); }

    // the owner signs in and continues to the instructions; signing in starts nothing; the explicit start creates the new attempt
    const { browser: b2, ui: ui2 } = await open();
    try {
      await ui2.page.goto(link);
      await ui2.page.getByPlaceholder('you@example.com').fill(student.email);
      await ui2.page.locator('input[autocomplete="current-password"]').fill(student.password);
      await ui2.page.getByRole('button', { name: 'Sign in' }).click();
      await ui2.page.waitForURL(/\/instructions$/, { timeout: 20000 });
      assert.doesNotMatch(ui2.page.url(), /registration_token/, 'the token is gone from the address bar');
      assert.equal(ui2.count(/\/start$/), 0);
      await U.acknowledgeAndOpenDeviceCheck(ui2);
      await U.clickStart(ui2);
      assert.equal(ui2.count(/\/start$/), 1);
      const row = await stack.session(U.sessionUuid(ui2));
      assert.equal(row.state, 'APTITUDE_IN_PROGRESS');
    } finally { await b2.close(); }
  });

  test('an invalid or already-used retake link is explained and nothing starts', async () => {
    const { browser, ui } = await open();
    try {
      await ui.page.goto(`${stack.web}/assessment/join/${org.share_token}?registration_token=not-a-real-token`);
      await ui.page.getByText('This link cannot be used').waitFor({ timeout: 20000 });
      assert.equal(await ui.page.getByPlaceholder('you@example.com').count(), 0);
      assert.equal(ui.count(/\/start$/), 0);
    } finally { await browser.close(); }
  });
});
