// User Management -> Delete student account in a real browser against the real backend (scratch database, isolated ports).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack; let org;
before(async () => {
  stack = await startStack();
  org = await stack.newOrg('del');
});
after(() => { stack?.stop(); });

const openUsers = async (viewport) => {
  const { browser, context } = await U.launch(viewport ? { viewport } : {});
  await U.signIn(context, stack.api, org);
  const ui = await U.newPage(context, stack.api);
  await ui.page.goto(`${stack.web}/admin/users`);
  await ui.page.getByRole('heading', { name: 'User Management' }).waitFor({ timeout: 30000 });
  return { browser, ui };
};

const loginStatus = async (email, password) => (await fetch(`${stack.api}/api/auth/login/`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
})).status;

const deleteCalls = (ui) => ui.t.responses.filter((r) => r.method === 'DELETE');

describe('Delete student account', () => {
  test('confirmation dialog, one request for a double click, the row disappears and the student can no longer sign in', async () => {
    const student = await stack.newOrgStudent(org, 'Maya Patel');
    const keep = await stack.newOrgStudent(org, 'Keep Student');
    assert.equal(await loginStatus(student.email, student.password), 200);
    const { browser, ui } = await openUsers();
    try {
      await ui.page.getByPlaceholder('Search by name or email').fill(student.email);
      await ui.page.getByText(student.email, { exact: true }).waitFor({ timeout: 15000 });

      // every existing action is still on the row; Delete sits beside them, exactly once
      for (const name of [`View ${student.email}`, `Share login credentials with ${student.email}`, `Replace password for ${student.email}`,
        `Deactivate ${student.email}`, `Delete ${student.email}`]) {
        assert.equal(await ui.page.getByRole('button', { name }).count(), 1, name);
      }
      const del = ui.page.getByRole('button', { name: `Delete ${student.email}` });
      assert.ok(await del.isVisible());

      // Cancel: nothing is sent, the account stays
      await del.click();
      const dialog = ui.page.getByRole('dialog', { name: 'Delete student account?' });
      await dialog.waitFor({ timeout: 10000 });
      const body = await dialog.innerText();
      assert.ok(body.includes('Maya Patel') && body.includes(student.email), 'names the student');
      assert.match(body, /permanently delete/);
      assert.match(body, /cannot be undone/);
      assert.match(body, /audit records are kept/i);
      const confirm = dialog.getByRole('button', { name: 'Delete permanently' });
      assert.ok(await confirm.isDisabled(), 'disabled until the acknowledgement is ticked');
      await confirm.click({ force: true }).catch(() => {});
      assert.equal(deleteCalls(ui).length, 0, 'a disabled button sends nothing');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(deleteCalls(ui).length, 0);
      assert.equal(await loginStatus(student.email, student.password), 200, 'cancelling deleted nothing');

      // Escape also cancels
      await del.click();
      await dialog.waitFor({ timeout: 10000 });
      await ui.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 10000 });

      // Confirm: tick, double click => exactly ONE DELETE
      await del.click();
      await dialog.waitFor({ timeout: 10000 });
      await dialog.locator('#delete-account-understood').check();
      assert.ok(await confirm.isEnabled());
      await confirm.dblclick();
      await ui.page.getByRole('status').filter({ hasText: /permanently deleted/ }).waitFor({ timeout: 30000 });
      await dialog.waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(deleteCalls(ui).length, 1, 'one request despite the double click');
      assert.equal(deleteCalls(ui)[0].status, 200);
      assert.ok(ui.t.requests.some((r) => r.startsWith(`DELETE /api/admin/users/`) && r.includes('confirm_email=')), 'the e-mail confirmation was sent');

      // the row is gone, the student cannot sign in, the other student is untouched
      await ui.page.getByText(student.email, { exact: true }).waitFor({ state: 'detached', timeout: 15000 });
      assert.equal(await loginStatus(student.email, student.password), 401);
      assert.equal(await loginStatus(keep.email, keep.password), 200);
      await ui.page.getByPlaceholder('Search by name or email').fill(keep.email);
      await ui.page.getByText(keep.email, { exact: true }).waitFor({ timeout: 15000 });
      assert.equal(await ui.page.getByRole('button', { name: `Delete ${keep.email}` }).count(), 1);
      assert.deepEqual(ui.t.errors, [], 'no page errors');
    } finally { await browser.close(); }
  });

  test('an administrator (the signed-in admin) never gets a Delete action', async () => {
    const { browser, ui } = await openUsers();
    try {
      await ui.page.getByPlaceholder('Search by name or email').fill(org.email);
      await ui.page.getByRole('cell', { name: org.email, exact: true }).waitFor({ timeout: 15000 });
      assert.equal(await ui.page.getByRole('button', { name: `View ${org.email}` }).count(), 1, 'the admin row is on the page');
      assert.equal(await ui.page.getByRole('button', { name: `Delete ${org.email}` }).count(), 0, 'but it has no Delete action');
    } finally { await browser.close(); }
  });

  test('a server refusal is shown inside the dialog and the account stays (already deleted elsewhere)', async () => {
    const student = await stack.newOrgStudent(org, 'Gone Elsewhere');
    const { browser, ui } = await openUsers({ width: 390, height: 844 });   // phone width: the card layout carries the same action
    try {
      await ui.page.getByPlaceholder('Search by name or email').fill(student.email);
      await ui.page.getByText(student.email, { exact: true }).waitFor({ timeout: 15000 });
      await ui.page.getByRole('button', { name: `Delete ${student.email}` }).click();
      const dialog = ui.page.getByRole('dialog', { name: 'Delete student account?' });
      await dialog.waitFor({ timeout: 10000 });
      // another administrator deletes the same account first
      const found = await (await fetch(`${stack.api}/api/admin/users/?q=${encodeURIComponent(student.email)}`, { headers: { Authorization: `Bearer ${org.token}` } })).json();
      const gone = await fetch(`${stack.api}/api/admin/users/${found.items[0].id}?confirm_email=${encodeURIComponent(student.email)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${org.token}` } });
      assert.equal(gone.status, 200);
      await dialog.locator('#delete-account-understood').check();
      await dialog.getByRole('button', { name: 'Delete permanently' }).click();
      await dialog.getByRole('alert').waitFor({ timeout: 15000 });
      assert.match(await dialog.getByRole('alert').innerText(), /not found/i);
      assert.equal(deleteCalls(ui).at(-1).status, 404);
    } finally { await browser.close(); }
  });
});
