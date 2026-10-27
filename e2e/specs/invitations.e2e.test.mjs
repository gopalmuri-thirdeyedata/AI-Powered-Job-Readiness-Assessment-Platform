// "Share with Students" (e-mail invitations) in a real browser against the real backend.
//
// Real: frontend, backend, tenant scoping, student accounts (created through the real admin API), tracking, the real smtplib client.
// NOT real: the mail server. A tiny local SMTP sink on 127.0.0.1 records what the backend submits; nothing leaves the machine and no
// external SMTP credential is used (the spec pins empty SMTP_USER/SMTP_PASSWORD, which stops backend/.env from supplying real ones).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startSink } from '../support/smtpSink.mjs';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

// ------------------------------------------------------------------------------ stacks
let sink; let stack; let unconfigured;
before(async () => {
  sink = await startSink();
  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURITY: 'none',
    SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: 'PrepWin E2E <invites@e2e.test>',
  });
  stack = await startStack();
  process.env.SMTP_HOST = '';                // a second backend where e-mail is simply not configured
  unconfigured = await startStack();
});
after(() => { stack?.stop(); unconfigured?.stop(); sink?.close(); });

const STUDENT_PASSWORD = 'Zx9#pLm2!qWe-4417';
const addStudent = async (org, name, email) => {
  const r = await stack.call('POST', '/api/admin/users/', { token: org.token, json: { role: 'STUDENT', full_name: name, email, password: STUDENT_PASSWORD } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
};

const openAdmin = async (s, org, viewport) => {
  const { browser, context } = await U.launch({ viewport });
  await U.signIn(context, s.api, org);
  const ui = await U.newPage(context, s.api);
  await ui.page.goto(`${s.web}/admin/shared-links`);
  await ui.page.getByRole('heading', { name: 'Full Stack Engineer', exact: true }).waitFor({ timeout: 30000 });
  return { browser, ui };
};

describe('Share with Students', () => {
  test('select, send, partial failure, safe retry, no duplicates; manual link sharing is unaffected', async () => {
    const org = await stack.newOrg('inv1');
    await addStudent(org, 'Maya Patel', 'maya.patel@students.prepwin-e2e.com');
    await addStudent(org, 'Liam Chen', 'liam.chen@students.prepwin-e2e.com');
    await addStudent(org, 'Priya Nair', 'priya.nair@students.prepwin-e2e.com');
    sink.refused.add('priya.nair@students.prepwin-e2e.com');

    const { browser, ui } = await openAdmin(stack, org);
    const { page } = ui;
    try {
      const card = page.locator('article', { has: page.getByRole('heading', { name: 'Full Stack Engineer', exact: true }) });
      const shareUrl = `${stack.web}/assessment/join/${org.share_token}`;

      // manual sharing is there before, and independent of, the e-mail panel
      assert.equal(await card.getByLabel('Shared link for Full Stack Engineer').inputValue(), shareUrl);
      await card.getByRole('button', { name: /Copy link/ }).waitFor();
      assert.equal(await page.getByTestId('share-with-students').count(), 0, 'the panel is optional: closed until asked for');

      await card.getByRole('button', { name: /Share with Students/ }).click();
      const panel = page.getByTestId('share-with-students');
      await panel.getByText('Maya Patel').waitFor({ timeout: 15000 });
      for (const [n, e] of [['Maya Patel', 'maya.patel@students.prepwin-e2e.com'], ['Liam Chen', 'liam.chen@students.prepwin-e2e.com'], ['Priya Nair', 'priya.nair@students.prepwin-e2e.com']]) {
        await panel.getByText(n, { exact: true }).waitFor();
        await panel.getByText(e, { exact: true }).waitFor();
      }
      assert.equal(await page.getByTestId('selected-count').innerText(), '0 selected');
      assert.equal(await panel.getByRole('button', { name: 'Send Invitation' }).isDisabled(), true, 'nothing selected, nothing to send');

      // search by name and by e-mail
      await panel.getByLabel('Search students').fill('liam');
      await panel.getByText('Priya Nair').waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(await panel.getByRole('checkbox', { name: /Select (?!all)/ }).count(), 1);
      await panel.getByLabel('Search students').fill('PRIYA.NAIR@');
      await panel.getByText('Liam Chen').waitFor({ state: 'detached', timeout: 10000 });
      await panel.getByLabel('Search students').fill('');
      await panel.getByText('Liam Chen').waitFor({ timeout: 10000 });

      // individual checkbox, then select all
      await panel.getByRole('checkbox', { name: 'Select Maya Patel' }).check();
      assert.equal(await page.getByTestId('selected-count').innerText(), '1 selected');
      await panel.getByRole('checkbox', { name: 'Select all students' }).check();
      assert.equal(await page.getByTestId('selected-count').innerText(), '3 selected');

      // send: the real per-recipient outcome is shown, partial failure is NOT reported as success
      await panel.getByRole('button', { name: 'Send Invitation' }).click();
      await page.getByTestId('send-summary').waitFor({ timeout: 30000 });
      assert.match(await page.getByTestId('send-summary').innerText(), /2 sent · 1 failed · 0 skipped/);
      assert.match(await page.getByTestId('send-summary').innerText(), /not confirmed/i, 'never claims inbox delivery');
      const priyaRow = panel.locator('li', { hasText: 'Priya Nair' });
      assert.match(await priyaRow.innerText(), /Failed[\s\S]*refused this recipient/);
      assert.match(await panel.locator('li', { hasText: 'Maya Patel' }).innerText(), /Sent/);
      assert.equal(sink.messages.length, 2);

      // the e-mail itself: addressed to the DB address, carries the existing link and the expiry, HTML + plain text
      const mail = sink.to('maya.patel@students.prepwin-e2e.com')[0].data;
      assert.ok(mail.includes(shareUrl), 'the existing shared link is in the e-mail');
      assert.match(mail, /text\/plain/); assert.match(mail, /text\/html/);
      assert.match(mail, /expires on \d{2} \w{3} \d{4} at \d{2}:\d{2} UTC/);
      assert.match(mail, /Start the assessment/);
      assert.match(mail, /Subject: Invitation: Full Stack Engineer assessment/);

      // retry only the failure; first while the server still refuses it, then after it recovers
      await panel.getByRole('button', { name: /Retry failed \(1\)/ }).click();
      await page.getByText(/0 sent · 1 failed · 0 skipped/).waitFor({ timeout: 30000 });
      sink.refused.clear();
      await panel.getByRole('button', { name: /Retry failed \(1\)/ }).click();
      await page.getByText(/1 sent · 0 failed · 0 skipped/).waitFor({ timeout: 30000 });
      assert.equal(await panel.getByRole('button', { name: /Retry failed/ }).count(), 0);

      // sending to everyone again changes nothing: every student received exactly one e-mail
      await panel.getByRole('button', { name: 'Send Invitation' }).click();
      await page.getByText(/0 sent · 0 failed · 3 skipped/).waitFor({ timeout: 30000 });
      for (const e of ['maya.patel', 'liam.chen', 'priya.nair']) assert.equal(sink.to(`${e}@students.prepwin-e2e.com`).length, 1, `${e} got exactly one e-mail`);

      // the link, its expiry and the publish state are exactly as before; Copy link still works
      assert.equal(await card.getByLabel('Shared link for Full Stack Engineer').inputValue(), shareUrl);
      assert.equal((await fetch(`${stack.api}/api/public/assessment/${org.share_token}`)).status, 200);
      await card.getByRole('button', { name: /Copy link/ }).click();
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
      assert.ok(!ui.t.requests.some((r) => /notification/i.test(r)), 'no notification endpoints involved');
    } finally { await browser.close(); }
  });

  test("an administrator only ever sees their own organization's students", async () => {
    const a = await stack.newOrg('inv2a');
    const b = await stack.newOrg('inv2b');
    await addStudent(a, 'Alpha Student', 'alpha.student@students.prepwin-e2e.com');
    await addStudent(b, 'Bravo Student', 'bravo.student@students.prepwin-e2e.com');
    const { browser, ui } = await openAdmin(stack, a);
    try {
      await ui.page.locator('article').getByRole('button', { name: /Share with Students/ }).click();
      await ui.page.getByText('Alpha Student').waitFor({ timeout: 15000 });
      assert.equal(await ui.page.getByText('Bravo Student').count(), 0);
      // the server rejects an id from the other organization even if the UI never offers it
      const foreign = await stack.call('GET', `/api/admin/job-roles/${b.job_id}/share-students`, { token: a.token });
      assert.equal(foreign.status, 404);
    } finally { await browser.close(); }
  });

  test('the panel fits a phone-width screen', async () => {
    const org = await stack.newOrg('inv3');
    await addStudent(org, 'Narrow Screen', 'narrow.screen@students.prepwin-e2e.com');
    const { browser, ui } = await openAdmin(stack, org, { width: 390, height: 800 });
    try {
      await ui.page.locator('article').getByRole('button', { name: /Share with Students/ }).click();
      await ui.page.getByText('Narrow Screen').waitFor({ timeout: 15000 });
      const overflow = await ui.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
    } finally { await browser.close(); }
  });
});

describe('E-mail not configured on the server', () => {
  test('the panel explains it, sending is disabled, and the manual link keeps working', async () => {
    const org = await unconfigured.newOrg('inv4');
    const r = await unconfigured.call('POST', '/api/admin/users/', { token: org.token, json: { role: 'STUDENT', full_name: 'No Mail', email: 'no.mail@students.prepwin-e2e.com', password: STUDENT_PASSWORD } });
    assert.equal(r.status, 201);
    const { browser, ui } = await openAdmin(unconfigured, org);
    try {
      const card = ui.page.locator('article', { has: ui.page.getByRole('heading', { name: 'Full Stack Engineer', exact: true }) });
      await card.getByRole('button', { name: /Share with Students/ }).click();
      await ui.page.getByText(/E-mail sending is not configured/).waitFor({ timeout: 15000 });
      await ui.page.getByRole('checkbox', { name: 'Select No Mail' }).check();
      assert.equal(await ui.page.getByRole('button', { name: 'Send Invitation' }).isDisabled(), true);
      assert.equal(await card.getByLabel('Shared link for Full Stack Engineer').inputValue(), `${unconfigured.web}/assessment/join/${org.share_token}`);
      await card.getByRole('button', { name: /Copy link/ }).waitFor();
      // and the API itself refuses, tracking nothing
      const refused = await unconfigured.call('POST', `/api/admin/job-roles/${org.job_id}/invitations`, { token: org.token, json: { student_ids: [1] } });
      assert.ok([404, 503].includes(refused.status));
    } finally { await browser.close(); }
  });
});
