// Admin Recruitment screens (Job Roles & Blueprints, Shared Links) in a real browser against the real backend.
//
// Real: frontend, backend, tenant scoping, blueprint persistence, publication. NOT real: Gemini (the backend runs its OFFLINE mock
// mode, labelled "Offline test data"; "Gemini unavailable" is simulated by intercepting the generate request with the 502 the
// backend returns), and sign-in (the admin JWT is minted by the harness and validated by /api/auth/me like a real one).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const JD = 'We are hiring an engineer to build Python and FastAPI services backed by SQL databases, design REST APIs and own reliability in production.';

const openAdmin = async (token, viewport) => {
  const { browser, context } = await U.launch({ viewport });
  await context.addInitScript((t) => { try { localStorage.setItem('token', t); } catch { /* storage unavailable */ } }, token);
  const ui = await U.newPage(context, stack.api);
  return { browser, ui };
};

const createRole = async (token, title) => (await stack.call('POST', '/api/admin/job-roles/', { token, json: { title, description: JD } })).body;

const card = (ui, title) => ui.page.locator('article', { has: ui.page.getByRole('heading', { name: title, exact: true }) });
const buttonNames = (c) => c.getByRole('button').allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean));

describe('Job Roles & Blueprints', () => {
  test('no role card offers, mentions or explains a demo template; the remaining actions are present and aligned', async () => {
    const org = await stack.newOrg('adm1');                         // org with one published role
    await createRole(org.token, 'Full Stack Engineer Draft');       // a title that used to qualify for the template
    await createRole(org.token, 'Backend Engineer');                // a title that used to show "available for ... roles only"
    const { browser, ui } = await openAdmin(org.token);
    try {
      await ui.page.goto(`${stack.web}/admin/job-roles`);
      await ui.page.getByRole('heading', { name: 'Backend Engineer', exact: true }).waitFor({ timeout: 30000 });
      const text = await ui.text();
      for (const forbidden of ['Use Demo Template', 'Demo template', 'demo template', 'Demo Template', 'available for Full Stack Engineer', 'roles only']) {
        assert.ok(!text.includes(forbidden), `must not show: ${forbidden}`);
      }
      assert.equal(await ui.page.getByRole('button', { name: /demo/i }).count(), 0);
      assert.equal(await ui.page.locator('[title*="emo" i], [aria-label*="emo" i]').count(), 0, 'no demo tooltip or label');

      for (const title of ['Full Stack Engineer Draft', 'Backend Engineer']) {
        const names = await buttonNames(card(ui, title));
        assert.deepEqual(names.filter((n) => /Edit JD|Create Assessment|Publish/.test(n)), ['Edit JD', 'Create Assessment', 'Publish'], `${title}: ${names}`);
        // all three sit on one row, in that order, at the same height
        const boxes = [];
        for (const name of ['Edit JD', 'Create Assessment', 'Publish']) boxes.push(await card(ui, title).getByRole('button', { name }).boundingBox());
        assert.ok(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 2), `${title}: buttons share a row ${JSON.stringify(boxes.map((b) => Math.round(b.y)))}`);
        assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x);
        assert.ok(Math.abs(boxes[0].height - boxes[1].height) < 2 && Math.abs(boxes[1].height - boxes[2].height) < 2, 'consistent button height');
      }
      // Publish is disabled until a blueprint exists, and its hint no longer mentions a template
      const publish = card(ui, 'Backend Engineer').getByRole('button', { name: 'Publish' });
      assert.equal(await publish.isDisabled(), true);
      assert.equal(await publish.getAttribute('title'), 'Create an assessment first');
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });

  test('the cards wrap cleanly on a phone-width screen (no horizontal scroll, no stray gap)', async () => {
    const org = await stack.newOrg('adm2');
    await createRole(org.token, 'Backend Engineer');
    const { browser, ui } = await openAdmin(org.token, { width: 390, height: 800 });
    try {
      await ui.page.goto(`${stack.web}/admin/job-roles`);
      await ui.page.getByRole('heading', { name: 'Backend Engineer', exact: true }).waitFor({ timeout: 30000 });
      const overflow = await ui.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
      const names = await buttonNames(card(ui, 'Backend Engineer'));
      assert.deepEqual(names.filter((n) => /Edit JD|Create Assessment|Publish/.test(n)), ['Edit JD', 'Create Assessment', 'Publish']);
    } finally { await browser.close(); }
  });

  test('when Gemini is unavailable the card shows a failure, nothing is implied to have succeeded, and Publish stays disabled', async () => {
    const org = await stack.newOrg('adm3');
    await createRole(org.token, 'Platform Engineer');
    const { browser, ui } = await openAdmin(org.token);
    try {
      await ui.page.route('**/generate-blueprint', (route) => route.fulfill({
        status: 502, contentType: 'application/json',
        body: JSON.stringify({ detail: { code: 'quota', message: 'The Gemini account has run out of quota or prepaid credits. Ask your administrator to add credits, then try again.' } }),
      }));
      await ui.page.goto(`${stack.web}/admin/job-roles`);
      await ui.page.getByRole('heading', { name: 'Platform Engineer', exact: true }).waitFor({ timeout: 30000 });
      const c = card(ui, 'Platform Engineer');
      await c.getByRole('button', { name: 'Create Assessment' }).click();
      await ui.page.waitForSelector('[role=alert]', { timeout: 15000 });
      const text = await ui.text();
      assert.match(text, /run out of quota or prepaid credits/);
      assert.match(text, /Nothing was changed/);
      assert.doesNotMatch(text, /generated and validated/, 'no success toast');
      assert.doesNotMatch(await c.innerText(), /Blueprint v\d/, 'this role has no blueprint');
      assert.match(await c.innerText(), /No valid blueprint yet/);
      assert.equal(await c.getByRole('button', { name: 'Publish' }).isDisabled(), true);
      assert.equal(await c.getByRole('button', { name: 'Create Assessment' }).isEnabled(), true, 'the admin can try again');
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });

  test('generate -> review -> publish works end to end and the role then appears in Shared Links', async () => {
    const org = await stack.newOrg('adm4');
    await createRole(org.token, 'Data Engineer');
    const { browser, ui } = await openAdmin(org.token);
    try {
      await ui.page.goto(`${stack.web}/admin/job-roles`);
      await ui.page.getByRole('heading', { name: 'Data Engineer', exact: true }).waitFor({ timeout: 30000 });
      const c = card(ui, 'Data Engineer');
      await c.getByRole('button', { name: 'Create Assessment' }).click();
      await c.getByText(/Blueprint v1/).waitFor({ timeout: 60000 });
      assert.match(await c.innerText(), /Offline test data/, 'offline mock output is labelled as such, never as Gemini');
      assert.match(await ui.text(), /generated and validated/);
      assert.equal(await c.getByRole('button', { name: 'Update Assessment' }).count(), 1);
      await c.getByRole('button', { name: /Preview Assessment|Review/ }).click();
      await ui.page.getByText(/Aptitude \(15 questions\)/).waitFor();
      await c.getByRole('button', { name: 'Publish' }).click();
      await c.getByRole('button', { name: /Get shared link/ }).waitFor({ timeout: 30000 });

      await ui.page.goto(`${stack.web}/admin/shared-links`);
      await ui.page.getByRole('heading', { name: 'Data Engineer', exact: true }).waitFor({ timeout: 30000 });
      const link = ui.page.locator('article', { has: ui.page.getByRole('heading', { name: 'Data Engineer', exact: true }) });
      assert.match(await link.innerText(), /Published|PUBLISHED/i);
      assert.ok((await link.locator('input, code, a').evaluateAll((els) => els.map((e) => e.value || e.textContent || e.href).join(' '))).includes('/assessment/join/'));
    } finally { await browser.close(); }
  });
});

describe('Shared Links keeps its existing open / closed behaviour', () => {
  test('closing hides the link from candidates and the card offers Reopen; reopening restores the same link; history stays', async () => {
    const org = await stack.newOrg('adm5');
    const { browser, ui } = await openAdmin(org.token);
    try {
      await ui.page.goto(`${stack.web}/admin/shared-links`);
      await ui.page.getByRole('heading', { name: 'Full Stack Engineer', exact: true }).waitFor({ timeout: 30000 });
      const link = ui.page.locator('article', { has: ui.page.getByRole('heading', { name: 'Full Stack Engineer', exact: true }) });
      assert.equal((await fetch(`${stack.api}/api/public/assessment/${org.share_token}`)).status, 200);
      await link.getByRole('button', { name: 'Close' }).click();
      await ui.page.getByRole('button', { name: 'Close assessment' }).click();
      await link.getByRole('button', { name: 'Reopen' }).waitFor({ timeout: 15000 });
      assert.match(await link.innerText(), /no longer accepts new candidates/);
      assert.equal((await fetch(`${stack.api}/api/public/assessment/${org.share_token}`)).status, 410, 'a retained URL no longer opens the assessment');
      await ui.page.reload();                                           // a refresh cannot make it look active again
      await link.getByRole('button', { name: 'Reopen' }).waitFor({ timeout: 30000 });
      await link.getByRole('button', { name: 'Reopen' }).click();
      await link.getByRole('button', { name: 'Close' }).waitFor({ timeout: 15000 });
      assert.equal((await fetch(`${stack.api}/api/public/assessment/${org.share_token}`)).status, 200, 'the same link works again');
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });
});
