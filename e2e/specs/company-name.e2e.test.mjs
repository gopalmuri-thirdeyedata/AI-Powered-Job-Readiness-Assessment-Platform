// Optional Company Name on the New Job Role form, in a real browser against the real backend on a scratch database:
// the field replaces "Role / team (optional)", can be filled or left empty, and is shown (only when given) on the job card,
// the shared link card, the candidate's instructions and the public metadata. Existing roles keep working.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const JD = 'We are hiring an engineer to build Python and FastAPI services backed by SQL databases, design REST APIs and own reliability in production.';
const card = (page, title) => page.locator('article', { has: page.getByRole('heading', { name: title, exact: true }) });

describe('New Job Role: Company Name (optional)', () => {
  test('the form shows the new field, creating works with and without it, and the name appears only where it was given', async () => {
    const org = await stack.newOrg('co');                              // an organization that already has one published role (no company name)
    const { browser, context } = await U.launch();
    await U.signIn(context, stack.api, org);
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    try {
      await page.goto(`${stack.web}/admin/job-roles`);
      await U.dismissTour(page);
      await page.getByRole('button', { name: 'New job role' }).click();
      const form = page.getByRole('form').or(page.locator('form')).first();
      await form.getByText('Company Name (optional)', { exact: true }).waitFor({ timeout: 20000 });
      const text = await form.innerText();
      assert.ok(!text.includes('Role / team'), 'the old label is gone');
      for (const kept of ['Job title', 'New Job Role', 'Create job role']) assert.ok(text.includes(kept), kept);
      const company = form.getByPlaceholder('e.g. Google, Microsoft, Infosys');
      assert.equal(await company.count(), 1);
      assert.equal(await form.locator('[required]').count(), 0, 'nothing in the form is marked required, including the company name');

      // 1) with a company name
      await form.getByPlaceholder('e.g. Senior Backend Engineer').fill('Company Test Engineer');
      await company.fill('Infosys');
      await form.locator('textarea').fill(JD);
      await form.getByRole('button', { name: 'Create job role' }).click();
      const withCompany = card(page, 'Company Test Engineer');
      await withCompany.waitFor({ timeout: 20000 });
      assert.ok((await withCompany.innerText()).includes('Infosys'), 'the company name is shown on the job card');

      // 2) without one
      await page.getByRole('button', { name: 'New job role' }).click();
      await form.getByPlaceholder('e.g. Senior Backend Engineer').fill('No Company Engineer');
      await form.locator('textarea').fill(JD);
      await form.getByRole('button', { name: 'Create job role' }).click();
      const without = card(page, 'No Company Engineer');
      await without.waitFor({ timeout: 20000 });
      const noText = await without.innerText();
      assert.ok(!/null|undefined|Infosys/.test(noText), `no placeholder text for a missing company: ${noText}`);

      // saved and retrieved through the API; role / team stays the title when not given (as before)
      const roles = (await stack.call('GET', '/api/admin/job-roles/', { token: org.token })).body;
      const a = roles.find((r) => r.title === 'Company Test Engineer');
      const b = roles.find((r) => r.title === 'No Company Engineer');
      assert.equal(a.company_name, 'Infosys');
      assert.equal(b.company_name, null);
      assert.equal(a.role, 'Company Test Engineer');
      const existing = roles.find((r) => r.id === org.job_id);
      assert.ok(existing && existing.company_name === null, 'the pre-existing role loads and has no company name');
    } finally { await browser.close(); }
  });

  test('candidates see the company name on the instructions page; without one the existing organization name is used', async () => {
    const org = await stack.newOrg('co2');
    const set = await stack.call('PUT', `/api/admin/job-roles/${org.job_id}`, { token: org.token, json: { company_name: 'Microsoft' } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const meta = await (await fetch(`${stack.api}/api/public/assessment/${org.share_token}`)).json();
    assert.equal(meta.company_name, 'Microsoft');
    const student = await stack.newOrgStudent(org, 'Company Student');
    const { browser, context } = await U.launch();
    const ui = await U.newPage(context, stack.api);
    try {
      await U.registerCandidate(ui, stack.web, org.share_token, student);
      await ui.page.getByRole('heading', { name: 'Exam Instructions' }).waitFor({ timeout: 20000 });
      const text = await ui.text();
      assert.ok(text.includes('Microsoft'), 'the company the assessment is for');
      assert.ok(!/null|undefined/.test(text));
    } finally { await browser.close(); }
  });
});
