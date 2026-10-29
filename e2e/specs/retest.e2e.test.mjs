// Section-specific retest in a real browser against the real backend on a scratch database:
//   a student finishes the assessment -> the administrator opens Candidate Results, clicks Retest next to Dossier and assigns CODING only
//   -> the student (same sign-in, no registration) finds it on the completion page and sits only that section in the shared workspace
//   -> Candidate Results / Dossier show the new Coding score, the other two scores are untouched, and the overall is recalculated.
//
// Real: frontend, backend, login sessions, scoring, Chrome (fake camera/mic), local Python as the code sandbox.
// NOT real: Gemini (offline mock mode), Vapi / ElevenLabs (the interview is answered in writing), Judge0.
// Set RETEST_SHOT_DIR to also save light/dark screenshots of the dialog.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startSink } from '../support/smtpSink.mjs';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

// E-mail goes to a local sink (nothing leaves the machine); empty SMTP_USER / SMTP_PASSWORD stop backend/.env from supplying real credentials.
let stack;
let org;
let sink;
before(async () => {
  sink = await startSink();
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURITY: 'none', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: 'PrepWin E2E <retests@e2e.test>' });
  stack = await startStack();
  org = await stack.newOrg('rt');
});
after(() => { stack?.stop(); sink?.close(); });

/** Plain-text body of a captured message (decoded the way a mail client would). */
const bodyOf = (m) => {
  const raw = m.data.replace(/\r\n/g, '\n');
  const plain = raw.split(/\n--=+[^\n]*\n/).find((part) => /Content-Type: text\/plain/i.test(part)) || raw;
  const [head, ...rest] = plain.split('\n\n');
  let text = rest.join('\n\n');
  if (/quoted-printable/i.test(head)) text = text.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (/base64/i.test(head)) text = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
  return text;
};

const roster = async () => (await stack.call('GET', '/api/admin/recruitment/candidates?page_size=100', { token: org.token })).body.items;
const rowOf = async (email) => (await roster()).find((r) => r.email === email.toLowerCase());
const WRONG_SUM = 'class Solution:\n    def sum_two_numbers(self, a, b):\n        return None\n';

/** Sign in through the link, take the whole assessment (coding answered WRONG on purpose) and land on the completion page. */
async function finishAssessment(ui, student) {
  await U.registerCandidate(ui, stack.web, org.share_token, student);
  await U.acknowledgeAndOpenDeviceCheck(ui);
  await U.clickStart(ui);
  await U.answerAptitude(ui, { count: 15 });
  await U.openCoding(ui);
  await U.setCode(ui, WRONG_SUM);
  await U.stubVoiceApi(ui.page);
  await U.submitCodingToInterview(ui);
  await U.answerWrittenInterview(ui);
  await U.finishInterview(ui);
  await ui.page.waitForURL(/\/complete$/, { timeout: 90000 });
  await ui.page.locator('textarea[aria-label="Exam review"]').waitFor({ timeout: 30000 });
}

describe('section retest, end to end', () => {
  test('assign Coding only; the student retests it with the existing sign-in; only Coding (and the overall) change', async () => {
    const student = await stack.newOrgStudent(org, 'Rita Retest');
    let { browser: sb, context: sctx, ui: s } = await (async () => {
      const { browser, context } = await U.launch();
      return { browser, context, ui: await U.newPage(context, stack.api) };
    })();
    const { browser: ab, context: actx } = await U.launch();
    try {
      await finishAssessment(s, student);
      const before = await rowOf(student.email);
      assert.equal(before.status, 'COMPLETED');
      assert.ok(before.coding_score < 100, `the deliberately wrong coding answer did not score full marks (${before.coding_score})`);

      // ---------------------------------------------------------------- administrator: Retest beside Dossier
      await U.signIn(actx, stack.api, org);
      const a = await U.newPage(actx, stack.api);
      await a.page.goto(`${stack.web}/admin/candidate-results`);
      await U.dismissTour(a.page);
      const dossier = a.page.getByRole('button', { name: `Open dossier for ${student.name}` });
      const retest = a.page.getByRole('button', { name: `Assign retest for ${student.name}` });
      await dossier.waitFor({ timeout: 30000 });
      const [d, r] = [await dossier.boundingBox(), await retest.boundingBox()];
      assert.ok(Math.abs(d.y - r.y) < 4 && r.x > d.x, 'Retest sits beside Dossier on one row');
      await retest.click();

      const dialog = a.page.getByRole('dialog', { name: 'Assign retest' });
      await dialog.waitFor({ timeout: 15000 });
      await dialog.getByRole('checkbox', { name: 'Retest Coding' }).waitFor({ timeout: 20000 });   // the dialog's data has loaded
      const text = (await dialog.innerText()).replace(/\s+/g, ' ');
      assert.ok(text.includes(student.name) && text.includes(student.email.toLowerCase()), 'candidate details come from the database');
      assert.match(text, /Backend Engineer|Full Stack|Engineer/);
      assert.match(text, new RegExp(`Aptitude ${before.aptitude_score.toFixed(1)}%`), 'the real aptitude score is shown');
      assert.match(text, new RegExp(`Coding ${before.coding_score.toFixed(1)}%`), 'the real coding score is shown');
      assert.equal(await dialog.getByRole('button', { name: 'Assign Retest' }).isDisabled(), true, 'nothing selected yet');
      if (process.env.RETEST_SHOT_DIR) {
        fs.mkdirSync(process.env.RETEST_SHOT_DIR, { recursive: true });
        await a.page.screenshot({ path: path.join(process.env.RETEST_SHOT_DIR, 'retest-dialog-light.png') });
        await a.page.evaluate(() => { document.documentElement.classList.add('dark'); });
        await a.page.screenshot({ path: path.join(process.env.RETEST_SHOT_DIR, 'retest-dialog-dark.png') });
        await a.page.evaluate(() => { document.documentElement.classList.remove('dark'); });
      }
      await dialog.getByRole('checkbox', { name: 'Retest Coding' }).check();
      await dialog.getByLabel('Retest reason').fill('The code runner failed during my original sitting');
      await dialog.getByRole('button', { name: 'Assign Retest' }).click();
      await dialog.getByTestId('retest-email-status').waitFor({ timeout: 20000 });
      await dialog.locator('#retest-section-coding:disabled').waitFor({ timeout: 20000 });   // a second active retest for the section is not offered

      // assigning alone changes no score and no record
      const assigned = await rowOf(student.email);
      assert.deepEqual([assigned.aptitude_score, assigned.coding_score, assigned.interview_score, assigned.overall_score],
        [before.aptitude_score, before.coding_score, before.interview_score, before.overall_score]);

      // ---------------------------------------------------------------- the candidate was e-mailed (registered address, local sink)
      await dialog.getByTestId('retest-email-status').waitFor({ timeout: 20000 });
      assert.ok((await dialog.getByTestId('retest-email-status').innerText()).includes(`Email sent to ${student.email.toLowerCase()}`), 'the administrator is told the e-mail went out');
      const mails = sink.to(student.email.toLowerCase());
      assert.equal(mails.length, 1, 'exactly one e-mail, to the registered address');
      assert.match(mails[0].data, /Subject: Retest Assigned/);
      const mail = bodyOf(mails[0]);
      assert.match(mail, /Job Role: /); assert.match(mail, /Assigned Section\(s\): Coding/);
      assert.match(mail, /Reason: The code runner failed during my original sitting/);
      assert.ok(!/Aptitude|Interview|token=/i.test(mail), 'only the assigned section; no token in the link (a student signs in)');
      // login details: the student was created through the admin API, so the assigned password is still retained and is the one mailed
      assert.ok(mail.includes(`Login ID (your registered e-mail): ${student.email.toLowerCase()}`), `the login ID
${mail}`);
      assert.ok(mail.includes(`Password: ${student.password}`), 'the assigned password');
      assert.match(mail, new RegExp(`Student login page: ${stack.web.replace(/[.:/]/g, '\\$&')}/student/login`));
      assert.ok(!mail.includes(`${student.password}`) || !/assessment\/retest\/\S*Zx9/.test(mail), 'the password is never part of a link');
      const emailed = (mail.match(/https?:\/\/\S+\/assessment\/retest\/[0-9a-f-]{36}/) || [])[0];
      assert.ok(emailed, `the e-mail carries the retest link\n${mail}`);

      // ---------------------------------------------------------------- student: the completion page offers it too (same sign-in, no registration)
      const registrationsBefore = s.count(/\/register$/);
      await s.page.goto(`${stack.web}/assessment/join/${org.share_token}/complete`);
      const card = s.page.getByRole('region', { name: 'Retests assigned to you' });
      await card.waitFor({ timeout: 30000 });
      assert.match(await card.innerText(), /Coding/);
      assert.ok(!/Aptitude|Interview/.test(await card.innerText()), 'only the assigned section is offered');

      // ---------------------------------------------------------------- the candidate opens the E-MAILED link in a clean browser: the existing sign-in, then one section
      await sb.close();
      const fresh = await U.launch();
      const s2 = await U.newPage(fresh.context, stack.api);
      sb = fresh.browser;
      await s2.page.goto(emailed);
      await s2.page.getByRole('heading', { name: 'Sign in to open your retest' }).waitFor({ timeout: 30000 });   // not signed in: the existing sign-in form, no registration form
      assert.equal(await s2.page.getByPlaceholder('you@example.com').count(), 1);
      await s2.page.getByPlaceholder('you@example.com').fill(student.email);
      await s2.page.locator('input[autocomplete="current-password"]').fill(student.password);
      await s2.page.getByRole('button', { name: 'Sign in' }).click();
      await s2.page.getByRole('heading', { name: 'Coding retest' }).waitFor({ timeout: 30000 });
      assert.equal(s2.count(/\/register$/), 0);
      s = s2;
      assert.equal(await s.page.locator('input[type=email], input[placeholder*="phone" i]').count(), 0, 'no registration or sign-in form is shown');
      await s.page.locator('input[type=checkbox]').check();
      await s.page.getByRole('button', { name: 'Continue to device check' }).click();
      await s.page.waitForTimeout(1500);
      await s.page.locator('input[type=checkbox]').last().check();
      // the fake camera is sometimes not detected on the first pass: press Re-test Devices until Start Assessment is enabled (what a person does)
      const startBtn = s.page.getByRole('button', { name: /Start Assessment/ });
      for (let attempt = 0; attempt < 5 && await startBtn.isDisabled(); attempt++) {
        await s.page.getByRole('button', { name: /Re-test Devices/ }).click().catch(() => {});
        await s.page.waitForTimeout(3000);
      }
      await s.page.getByRole('button', { name: /Start Assessment/ }).click({ timeout: 20000 }).catch(async (err) => { throw new Error(`${err.message}
PAGE: ${(await s.text()).slice(0, 900)}
ERRORS: ${s.t.errors.join(' ; ')}`); });
      await s.page.waitForSelector('.monaco-editor', { timeout: 45000 });
      assert.ok(!/Question 1 of 15/.test(await s.text()), 'the aptitude section is not opened');
      await U.setCode(s, U.SOLUTIONS.sumPython);
      await s.page.getByRole('button', { name: /Submit All/ }).click();
      await s.page.getByRole('heading', { name: 'Retest submitted' }).waitFor({ timeout: 90000 });
      // ---------------------------------------------------------------- back to the dashboard (only after the submission)
      const back = s.page.getByRole('button', { name: 'Back to Dashboard' });
      await back.waitFor({ timeout: 15000 });
      assert.equal(await back.count(), 1);
      // a refresh of the completion page shows the submitted retest again; it cannot be started a second time, and the button is still there
      const startsBefore = s.count(/\/api\/public\/retest\/[0-9a-f-]{36}\/start$/);
      await s.page.reload();
      await s.page.getByRole('button', { name: 'Back to Dashboard' }).waitFor({ timeout: 30000 });
      assert.match(await s.text(), /already been completed/);
      assert.equal(await s.page.getByRole('button', { name: /Continue to device check|Start Assessment/ }).count(), 0, 'no second attempt is offered');
      assert.equal(s.count(/\/api\/public\/retest\/[0-9a-f-]{36}\/start$/), startsBefore, 'the refresh started nothing');
      await s.page.getByRole('button', { name: 'Back to Dashboard' }).click();
      await s.page.waitForURL(/\/student\/dashboard/, { timeout: 20000 });
      assert.equal(s.count(/\/api\/public\/retest\/[0-9a-f-]{36}\/start$/), startsBefore, 'navigating away started nothing');
      assert.equal(s.count(/\/register$/), registrationsBefore, 'no registration request was made');
      assert.ok(s.t.requests.some((q) => /\/api\/public\/retest\/[0-9a-f-]{36}\/start$/.test(q)));

      // ---------------------------------------------------------------- results: only Coding and the overall changed
      const after = await rowOf(student.email);
      assert.ok(after.coding_score > before.coding_score, `Coding has the new, better score (${before.coding_score} -> ${after.coding_score})`);
      assert.equal(after.aptitude_score, before.aptitude_score);
      assert.equal(after.interview_score, before.interview_score);
      const expected = Math.round(((after.aptitude_score + after.coding_score + after.interview_score) / 3) * 100) / 100;
      assert.ok(Math.abs(after.overall_score - expected) < 0.02, `overall ${after.overall_score} is the equal-weight mean ${expected}`);
      assert.equal((await roster()).filter((x) => x.email === student.email.toLowerCase()).length, 1, 'one results row');

      await dialog.getByRole('button', { name: 'Close retest dialog' }).click();
      await a.page.getByRole('button', { name: 'Refresh' }).click();
      await a.page.getByRole('button', { name: `Open dossier for ${student.name}` }).click();
      const dossierDialog = a.page.getByRole('dialog', { name: 'Candidate dossier' });
      await dossierDialog.getByText('Retest history').waitFor({ timeout: 20000 });
      const dossierText = (await dossierDialog.innerText()).replace(/\s+/g, ' ');
      assert.match(dossierText, /Retest history/);
      assert.match(dossierText, /completed · current score/);
      assert.match(dossierText, new RegExp(`Coding ${after.coding_score.toFixed(1)}%`), 'the dossier shows the new effective score');

      // the original attempt stays locked: starting it again is refused
      const started = await s.page.evaluate(async ({ api, token }) => {
        const me = await (await fetch(`${api}/api/auth/me`, { credentials: 'include' })).json();
        const reg = await fetch(`${api}/api/student-assessment/${token}/access`, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': me.csrf_token } });
        return (await reg.json()).status;
      }, { api: stack.api, token: org.share_token });
      assert.equal(started, 'ATTEMPTED', 'the shared link only reports the finished attempt; it does not hand out another one');
    } finally { await sb.close(); await ab.close(); }
  });
});
