// User Management -> Share (e-mail a student's login e-mail + assigned password) in a real browser against the real backend.
//
// Real: frontend, backend, tenant scoping, the real admin API that creates the student, the encrypted short-lived retention, the real
// smtplib client. NOT real: the mail server (a local sink on 127.0.0.1; nothing leaves the machine; empty SMTP_USER/SMTP_PASSWORD are
// pinned so backend/.env cannot supply real credentials).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startSink } from '../support/smtpSink.mjs';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let sink; let stack; let org;
before(async () => {
  sink = await startSink();
  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURITY: 'none',
    SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: 'PrepWin E2E <noreply@e2e.test>',
  });
  stack = await startStack();
  org = await stack.newOrg('cred');
});
after(() => { stack?.stop(); sink?.close(); });

const openUsers = async () => {
  const { browser, context } = await U.launch();
  await U.signIn(context, stack.api, org);
  const ui = await U.newPage(context, stack.api);
  await ui.page.goto(`${stack.web}/admin/users`);
  await ui.page.getByRole('heading', { name: 'User Management' }).waitFor({ timeout: 30000 });
  return { browser, ui };
};

const loginStatus = async (email, password) => (await fetch(`${stack.api}/api/auth/login/`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
})).status;

const shareBtn = (ui, email) => ui.page.getByRole('button', { name: `Share login credentials with ${email}` });
const toast = (ui, re) => ui.page.getByRole('status').filter({ hasText: re });

describe('Share credentials', () => {
  test('Share e-mails the real password once; an unavailable password sends the admin to Replace password; then the new one is shared', async () => {
    const student = await stack.newOrgStudent(org, 'Maya Patel');
    const { browser, ui } = await openUsers();
    try {
      await ui.page.getByPlaceholder('Search by name or email').fill(student.email);
      await ui.page.getByText(student.email, { exact: true }).waitFor({ timeout: 15000 });

      // the existing actions are all still on the row, Share sits beside them
      for (const name of [`View ${student.email}`, `Replace password for ${student.email}`, `Deactivate ${student.email}`]) {
        assert.equal(await ui.page.getByRole('button', { name }).count(), 1, name);
      }
      assert.equal(await shareBtn(ui, student.email).count(), 1);

      // a double click sends exactly one e-mail; the button shows its loading state and the result is reported
      await shareBtn(ui, student.email).dblclick();
      await toast(ui, /Login credentials were sent to/).waitFor({ timeout: 30000 });
      assert.equal(sink.to(student.email).length, 1, 'one e-mail despite the double click');
      const mail = sink.to(student.email)[0].data;
      assert.match(mail, /Subject: Your PrepWin Student Login Credentials/);
      assert.ok(mail.includes(student.password) && mail.includes(student.email), 'the actual login email and password');
      assert.ok(mail.includes(`${stack.web}/student/login`), 'the student login page');
      assert.ok(!/\{\{|\}\}/.test(mail), 'no placeholder text');
      const page = await ui.text();
      assert.ok(!page.includes(student.password), 'the password is never shown in the admin UI');
      assert.ok(!ui.t.responses.some((r) => /share-credentials/.test(r.path) && r.status >= 400));
      assert.equal(await loginStatus(student.email, student.password), 200, 'sharing did not touch the account');

      // delivered once: the password cannot be recovered, so the UI sends the admin to Replace password (it changes nothing itself)
      await shareBtn(ui, student.email).click();
      await ui.page.getByText("Password can't be shared yet").waitFor({ timeout: 15000 });
      assert.equal(sink.messages.length, 1);
      await ui.page.getByRole('button', { name: 'Replace password' }).last().click();
      const NEW_PASSWORD = 'Rq7$kNv3@tYu-9021';
      await ui.page.locator('#um-reset-password').fill(NEW_PASSWORD);
      await ui.page.locator('form').filter({ has: ui.page.locator('#um-reset-password') }).getByRole('button', { name: 'Replace password' }).click();
      await toast(ui, /Click Share to e-mail the new password/).waitFor({ timeout: 15000 }).catch(async (err) => {
        throw new Error(`${err.message}
PAGE: ${(await ui.text()).slice(0, 600)}
API: ${ui.t.responses.slice(-6).map((r) => `${r.method} ${r.path} ${r.status}`).join(' | ')}`);
      });

      await shareBtn(ui, student.email).click();
      await toast(ui, /Login credentials were sent to/).waitFor({ timeout: 30000 });
      assert.equal(sink.to(student.email).length, 2);
      const second = sink.to(student.email)[1].data;
      assert.ok(second.includes(NEW_PASSWORD) && !second.includes(student.password), 'the CURRENT password');
      assert.equal(await loginStatus(student.email, NEW_PASSWORD), 200);
      assert.equal(await loginStatus(student.email, student.password), 401);
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });

  test('a rejected recipient is reported clearly and a retry works; the account is unchanged meanwhile', async () => {
    const student = await stack.newOrgStudent(org, 'Retry Student');
    const { browser, ui } = await openUsers();
    try {
      await ui.page.getByPlaceholder('Search by name or email').fill(student.email);
      await ui.page.getByText(student.email, { exact: true }).waitFor({ timeout: 15000 });
      sink.refused.add(student.email);
      await shareBtn(ui, student.email).click();
      await toast(ui, /refused this recipient address.*you can try again/s).waitFor({ timeout: 30000 });
      assert.equal(sink.to(student.email).length, 0);
      assert.equal(await shareBtn(ui, student.email).isEnabled(), true, 'the button is usable again');
      assert.ok(!(await ui.text()).includes(student.password));
      assert.equal(await loginStatus(student.email, student.password), 200, 'nothing was changed by the failure');
      sink.refused.delete(student.email);
      await shareBtn(ui, student.email).click();
      await toast(ui, /Login credentials were sent to/).waitFor({ timeout: 30000 });
      assert.equal(sink.to(student.email).length, 1);
    } finally { await browser.close(); }
  });

  test('administrator accounts have no Share button (students on the same page do)', async () => {
    const student = await stack.newOrgStudent(org, 'Visible Student');
    const { browser, ui } = await openUsers();
    try {
      await ui.page.getByRole('cell', { name: org.email, exact: true }).waitFor({ timeout: 15000 });   // the administrator's own row is listed
      await ui.page.getByRole('cell', { name: student.email, exact: true }).waitFor({ timeout: 15000 });
      const labels = await ui.page.getByRole('button', { name: /Share login credentials with/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      assert.ok(labels.includes(`Share login credentials with ${student.email}`), 'students are offered Share');
      assert.ok(!labels.some((l) => l.includes(org.email)), 'the administrator row is not');
    } finally { await browser.close(); }
  });
});
