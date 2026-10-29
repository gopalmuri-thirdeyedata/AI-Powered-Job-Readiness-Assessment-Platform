// Opening page, completion page and fullscreen exit in a real browser (real Chrome, real frontend + backend on a scratch database).
// Set POLISH_SHOT_DIR to also save screenshots (laptop / tablet / mobile, light / dark).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
let org;
before(async () => { stack = await startStack(); org = await stack.newOrg('pol'); });
after(() => stack?.stop());

const SIZES = { laptop: [1366, 768], tablet: [768, 1024], mobile: [390, 844] };
const shot = async (page, name) => {
  if (!process.env.POLISH_SHOT_DIR) return;
  fs.mkdirSync(process.env.POLISH_SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.POLISH_SHOT_DIR, `${name}.png`), fullPage: true });
};
const setTheme = (page, dark) => page.evaluate((d) => { document.documentElement.classList.toggle('dark', d); try { localStorage.setItem('rr-theme', d ? 'dark' : 'light'); } catch { /* ignore */ } }, dark);
const box = (loc) => loc.boundingBox();
const noOverflow = async (page, label) => {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(m.sw <= m.cw + 1, `${label}: no horizontal overflow (${m.sw} > ${m.cw})`);
};
const inFullscreen = (page) => page.evaluate(() => !!document.fullscreenElement);
/** The ThirdEye Data logo: one image, really loaded, in proportion (2560x625), inside the 56px header, and visible at this size. */
const checkLogo = async (page, label) => {
  const logos = page.getByRole('img', { name: 'ThirdEye Data' });
  assert.equal(await logos.count(), 1, `${label}: exactly one logo`);
  const m = await logos.evaluate((img) => { const r = img.getBoundingClientRect(); const h = img.closest('header').getBoundingClientRect(); return { ok: img.complete && img.naturalWidth > 0, nw: img.naturalWidth, nh: img.naturalHeight, w: r.width, h: r.height, left: r.left, right: r.right, headerH: h.height, headerTop: h.top, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth }; });
  assert.ok(m.ok, `${label}: the logo file loaded`);
  assert.ok(Math.abs(m.w / m.h - m.nw / m.nh) < 0.05, `${label}: not stretched (${m.w}x${m.h} vs ${m.nw}x${m.nh})`);
  assert.ok(m.left >= 0 && m.right <= m.vw && m.top >= m.headerTop && m.bottom <= m.headerTop + m.headerH, `${label}: not clipped`);
  // the brand starts at the left content boundary of the fixed site-width header container, on every page and size (never centred)
  const c = await logos.evaluate((img) => { const inner = img.closest('header').firstElementChild; const cs = getComputedStyle(inner); const r = inner.getBoundingClientRect(); return { x: r.left, w: r.width, pad: parseFloat(cs.paddingLeft), chip: img.parentElement.getBoundingClientRect().left, vw: document.documentElement.clientWidth, justify: cs.justifyContent }; });
  assert.ok(Math.abs(c.w - Math.min(1152, c.vw)) < 1.5, `${label}: the header container is the fixed site width (${c.w})`);
  assert.ok(Math.abs(c.chip - (c.x + c.pad)) < 1.5, `${label}: the brand starts at the container's left padding edge (${c.chip} vs ${c.x + c.pad})`);
  assert.equal(c.justify, 'flex-start', `${label}: left-aligned, not centred`);
  assert.equal(Math.round(m.headerH), 57, `${label}: the header did not grow (${m.headerH}px incl. 1px border)`);
};

const MARKDOWN = ['## Machine Learning Engineer', '', '**Experience:** 3+ years building production models', '', '### Responsibilities',
  '- Train and evaluate models', '- Ship FastAPI services', '- Monitor drift', '', '<script>window.__pwned = true</script>'].join('\n');
const LONG = Array.from({ length: 24 }, (_, i) => `- Requirement ${i + 1}: ${'detail '.repeat(18)}`).join('\n');

/** Answer the public metadata request with a description of our choosing (the real response otherwise). */
const withDescription = (page, text) => page.route(new RegExp(`/api/public/assessment/${org.share_token}$`), async (route) => {
  const res = await route.fetch();
  const body = await res.json();
  await route.fulfill({ response: res, json: { ...body, description_snippet: text } });
});

describe('opening page', () => {
  test('Markdown job description, compact overview beside the sign-in card, no overflow, both themes', async () => {
    const { browser, context } = await U.launch({ viewport: { width: 1366, height: 768 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    try {
      await withDescription(page, MARKDOWN);
      await page.goto(`${stack.web}/assessment/join/${org.share_token}`);
      await page.getByRole('heading', { name: 'Sign in to start' }).waitFor({ timeout: 30000 });
      const jd = page.getByTestId('job-description');
      await jd.getByRole('heading', { name: 'Machine Learning Engineer' }).waitFor();
      assert.equal(await jd.locator('strong', { hasText: 'Experience:' }).count(), 1, 'bold renders as bold');
      assert.equal(await jd.locator('ul > li').count(), 3, 'bullets render as a list');
      const jdText = await jd.innerText();
      assert.ok(!/##|\*\*/.test(jdText), `no raw Markdown symbols: ${jdText}`);
      assert.ok(jdText.includes('<script>window.__pwned = true</script>'), 'HTML in a description is shown as text');
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'nothing from the description was executed');

      const cards = page.getByRole('list', { name: 'Assessment sections in order' }).locator('> li');
      assert.equal(await cards.count(), 3);
      const text = await ui.text();
      for (const label of ['Aptitude', 'Coding', 'AI Technical Interview']) assert.ok(text.includes(label), label);
      assert.equal((text.match(/20 minutes/g) || []).length, 3, 'three sections, 20 minutes each (unchanged configuration)');
      assert.match(text, /60 minutes total/);
      assert.equal(await page.getByTestId('assessment-frame').count(), 1);

      for (const [name, [w, h]] of Object.entries(SIZES)) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(200);
        await noOverflow(page, name);
        await checkLogo(page, `opening ${name}`);
        const form = await box(page.getByRole('form', { name: 'Student sign in' }));
        const overview = await box(page.getByRole('region', { name: 'Assessment overview' }));
        const email = await box(page.getByPlaceholder('you@example.com'));
        const password = await box(page.locator('input[autocomplete="current-password"]'));
        assert.ok(Math.abs(email.height - password.height) < 1 && Math.abs(email.width - password.width) < 1 && Math.abs(email.x - password.x) < 1, `${name}: the two fields are aligned and equal`);
        const row = [await box(cards.nth(0)), await box(cards.nth(1)), await box(cards.nth(2))];
        if (w >= 1024) {
          assert.ok(form.x > overview.x + overview.width - 2, `${name}: sign-in sits beside the overview`);
          assert.ok(form.y < overview.y + 200, `${name}: both start at the top`);
          assert.ok(row.every((b) => Math.abs(b.y - row[0].y) < 2 && Math.abs(b.height - row[0].height) < 2), `${name}: three equal cards on one row`);
          assert.ok(form.y + form.height < h + 250, `${name}: the sign-in form is within roughly one screen`);
        } else if (w >= 640) {
          assert.ok(form.y > overview.y + overview.height - 2, `${name}: sign-in stacks under the overview`);
          assert.ok(row.every((b) => Math.abs(b.y - row[0].y) < 2), `${name}: three cards on one row`);
        } else {
          assert.ok(form.y > overview.y + overview.height - 2 && row[1].y > row[0].y, `${name}: everything stacks`);
        }
        const frame = await page.getByTestId('assessment-frame').evaluate((el) => { const cs = getComputedStyle(el); return [cs.borderTopWidth, parseFloat(cs.borderTopLeftRadius)]; });
        assert.deepEqual(frame, ['1px', 16]);
        for (const dark of [false, true]) {
          await setTheme(page, dark);
          if (dark) {
            const whites = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)' && e.tagName !== 'INPUT').length);
            assert.equal(whites, 0, `${name} dark: no white surface`);
          }
          await shot(page, `opening-${name}-${dark ? 'dark' : 'light'}`);
        }
        await setTheme(page, false);
      }

      // validation feedback + the unchanged sign-in behaviour
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('alert').filter({ hasText: 'Enter your email address and password.' }).waitFor();
      assert.equal(await page.getByPlaceholder('you@example.com').getAttribute('aria-invalid'), 'true');
    } finally { await browser.close(); }
  });

  test('plain text and a long description: a compact preview with Show more / Show less', async () => {
    const { browser, context } = await U.launch({ viewport: { width: 1366, height: 768 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    try {
      await withDescription(page, 'We need a data analyst with SQL, Excel and strong communication skills.');
      await page.goto(`${stack.web}/assessment/join/${org.share_token}`);
      await page.getByRole('heading', { name: 'Sign in to start' }).waitFor({ timeout: 30000 });
      assert.match(await page.getByTestId('job-description').innerText(), /^We need a data analyst with SQL, Excel/);
      assert.equal(await page.getByRole('button', { name: 'Show more' }).count(), 0, 'short text: no toggle');

      await page.unroute(new RegExp(`/api/public/assessment/${org.share_token}$`));
      await withDescription(page, LONG);
      await page.reload();
      await page.getByRole('heading', { name: 'Sign in to start' }).waitFor({ timeout: 30000 });
      const before = await page.getByTestId('job-description').locator('li').count();
      assert.ok(before >= 1 && before < 24, `collapsed preview (${before} of 24 items)`);
      await page.getByRole('button', { name: 'Show more' }).click();
      assert.equal(await page.getByTestId('job-description').locator('li').count(), 24);
      await noOverflow(page, 'expanded');
      await page.getByRole('button', { name: 'Show less' }).click();
      assert.equal(await page.getByTestId('job-description').locator('li').count(), before);
    } finally { await browser.close(); }
  });
});

describe('fullscreen and the completion page', () => {
  test('fullscreen is kept through the sections, kept when the final submission fails, and released when it is accepted', async () => {
    const { browser, context } = await U.launch({ viewport: { width: 1366, height: 768 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    const student = await stack.newOrgStudent(org, 'Fiona Fullscreen');
    try {
      await U.registerCandidate(ui, stack.web, org.share_token, student);
      await U.acknowledgeAndOpenDeviceCheck(ui);
      await U.clickStart(ui);
      assert.equal(await inFullscreen(page), true, 'the assessment runs in fullscreen');

      await U.answerAptitude(ui);                       // intermediate submission: Aptitude -> Coding
      await U.openCoding(ui);
      assert.equal(await inFullscreen(page), true, 'still fullscreen after the aptitude section');
      await U.setCode(ui, U.SOLUTIONS.sumPython);
      await U.stubVoiceApi(ui.page);
      await U.submitCodingToInterview(ui);              // intermediate submission: Coding -> Interview
      assert.equal(await inFullscreen(page), true, 'still fullscreen after the coding section');
      await U.answerWrittenInterview(ui);

      // the final submission is refused by the "server": the student stays in the assessment, in fullscreen
      let fail = true;
      await page.route(/\/submit-interview$/, (route) => (fail ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.continue()));
      await U.finishInterview(ui);
      await page.waitForTimeout(2500);
      assert.doesNotMatch(page.url(), /\/complete$/);
      assert.equal(await inFullscreen(page), true, 'a failed final submission keeps fullscreen');

      // retry succeeds: fullscreen is released and the completion page is shown
      fail = false;
      const retry = page.getByRole('button', { name: /Submit & Complete/ });
      if (await retry.count()) await retry.first().click();
      await page.waitForURL(/\/complete$/, { timeout: 90000 });
      await page.getByRole('heading', { name: 'Assessment submitted' }).waitFor({ timeout: 30000 });
      assert.equal(await inFullscreen(page), false, 'the browser left fullscreen after the final submission');
      await page.waitForTimeout(1500);
      assert.equal(await inFullscreen(page), false, 'and it is not asked to enter fullscreen again');
      assert.equal(await page.getByText(/Fullscreen Required|returned to fullscreen|Return to Fullscreen/i).count(), 0, 'no recovery / gate dialog');

      // the completion page: confirmation, review, report, aligned and compact
      const review = page.locator('textarea[aria-label="Exam review"]');
      await review.waitFor({ timeout: 30000 });
      const submit = page.getByRole('button', { name: 'Submit Review' });
      const download = page.getByRole('button', { name: /Download Report/ });
      assert.equal(await submit.isDisabled(), true);
      assert.equal(await download.isDisabled(), true, 'the report stays unavailable before the review');
      assert.match(await ui.text(), /Submit your review to unlock your report/);
      await review.fill('one two three');
      assert.match(await page.getByTestId('word-counter').innerText(), /^3 \/ 30 words$/);
      assert.equal(await submit.isDisabled(), true);

      for (const [name, [w, h]] of Object.entries(SIZES)) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(200);
        await noOverflow(page, `complete ${name}`);
        await checkLogo(page, `complete ${name}`);
        const r = await box(page.getByRole('region', { name: 'Exam review' }));
        const rep = await box(page.getByRole('region', { name: 'Assessment report' }));
        const conf = await box(page.getByRole('region', { name: 'Submission confirmation' }));
        assert.ok(conf.y + conf.height <= r.y + 1, `${name}: confirmation above the review`);
        const ta = await box(review);
        const counter = await box(page.getByTestId('word-counter'));
        assert.ok(counter.y >= ta.y + ta.height - 1 && counter.y - (ta.y + ta.height) < 30, `${name}: the counter sits directly below the textarea`);
        assert.ok(ta.height < 260, `${name}: the textarea does not dominate (${ta.height}px)`);
        if (w >= 1024) {
          assert.ok(rep.x > r.x + r.width - 2 && Math.abs(rep.y - r.y) < 2 && Math.abs(rep.height - r.height) < 2, `${name}: review and report are connected side by side`);
          const sb = await box(submit); const db = await box(download);
          assert.ok(Math.abs((sb.y + sb.height) - (db.y + db.height)) < 4, `${name}: both action buttons sit on one bottom line`);
          assert.ok(rep.y + rep.height < h, `${name}: the whole page fits one laptop screen`);
        } else {
          assert.ok(rep.y > r.y + r.height - 2, `${name}: report stacks under the review`);
        }
        for (const dark of [false, true]) {
          await setTheme(page, dark);
          await shot(page, `complete-${name}-${dark ? 'dark' : 'light'}`);
        }
        await setTheme(page, false);
      }

      await page.setViewportSize({ width: 1366, height: 768 });
      await review.fill(Array.from({ length: 30 }, (_, i) => `word${i + 1}`).join(' '));
      assert.match(await page.getByTestId('word-counter').innerText(), /^30 \/ 30 words$/);
      assert.equal(await submit.isDisabled(), false);
      await submit.click();
      await page.getByTestId('review-saved').waitFor({ timeout: 15000 });
      await page.getByTestId('report-ready').waitFor({ timeout: 15000 });
      assert.equal(await download.isDisabled(), false, 'the report unlocks once the review is saved');
      await shot(page, 'complete-ready-laptop-light');
    } finally { await browser.close(); }
  });

  test('a refused fullscreen exit never blocks the completion page', async () => {
    const { browser, context } = await U.launch({ viewport: { width: 1366, height: 768 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    const student = await stack.newOrgStudent(org, 'Rita Refused');
    try {
      await page.addInitScript(() => { Document.prototype.exitFullscreen = () => Promise.reject(new Error('denied by the browser')); });
      await U.registerCandidate(ui, stack.web, org.share_token, student);
      await U.acknowledgeAndOpenDeviceCheck(ui);
      await U.clickStart(ui);
      await U.answerAptitude(ui);
      await U.openCoding(ui);
      await U.setCode(ui, U.SOLUTIONS.sumPython);
      await U.stubVoiceApi(ui.page);
      await U.submitCodingToInterview(ui);
      await U.answerWrittenInterview(ui);
      await U.finishInterview(ui);
      await page.waitForURL(/\/complete$/, { timeout: 90000 });
      await page.getByRole('heading', { name: 'Assessment submitted' }).waitFor({ timeout: 30000 });
      await page.locator('textarea[aria-label="Exam review"]').waitFor({ timeout: 30000 });
      assert.equal(await inFullscreen(page), true, 'the refusal is not hidden: still fullscreen, but the page works');
      await page.locator('textarea[aria-label="Exam review"]').fill('typing works');
      assert.match(await page.getByTestId('word-counter').innerText(), /^2 \/ 30 words$/);
    } finally { await browser.close(); }
  });
});

describe('Student account required page', () => {
  test('an administrator session sees a compact, centred card with a Student Login action; signed-out visitors are still sent to the sign-in', async () => {
    const { browser, context } = await U.launch({ viewport: { width: 1366, height: 768 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    const complete = `${stack.web}/assessment/join/${org.share_token}/complete`;
    try {
      // signed out: unchanged, straight to this assessment's sign-in (no notice)
      await page.goto(complete);
      await page.getByRole('heading', { name: 'Sign in to start' }).waitFor({ timeout: 30000 });
      assert.match(page.url(), new RegExp(`/assessment/join/${org.share_token}$`));

      // signed in as an administrator: the page appears, with the same guard as before (no student data is requested)
      await U.signIn(context, stack.api, { email: org.email, password: org.password });
      await page.goto(complete);
      await page.getByRole('heading', { name: 'Student account required' }).waitFor({ timeout: 30000 });
      assert.match(await ui.text(), /You must sign in with the student account associated with this assessment\./);
      assert.equal(ui.count(/student-assessment\/.*\/result/), 0, 'no assessment data is fetched for a non-student');
      await checkLogo(page, 'account required');

      for (const [name, [w, h]] of Object.entries(SIZES)) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(200);
        await noOverflow(page, `account required ${name}`);
        await checkLogo(page, `account required ${name}`);
        const card = await box(page.getByRole('region', { name: 'Student account required' }));
        const button = await box(page.getByRole('button', { name: 'Go to Student Login' }));
        assert.ok(Math.abs((card.x + card.width / 2) - w / 2) < 2, `${name}: centred`);
        assert.ok(card.width <= 680 && card.height < 380, `${name}: compact (${card.width}x${card.height})`);
        if (w >= 768) assert.ok(card.width >= 500, `${name}: not a narrow sliver`);
        else assert.ok(card.width >= w - 40, `${name}: uses the phone width inside the page margin`);
        assert.ok(button.x >= card.x && button.x + button.width <= card.x + card.width && button.y + button.height <= card.y + card.height, `${name}: the button is inside the card`);
        const cs = await page.getByRole('region', { name: 'Student account required' }).evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopWidth, parseFloat(c.borderTopLeftRadius)]; });
        assert.deepEqual(cs, ['1px', 16]);
        for (const dark of [false, true]) { await setTheme(page, dark); await shot(page, `account-required-${name}-${dark ? 'dark' : 'light'}`); }
        await setTheme(page, false);
      }

      // the action goes to this assessment's existing student sign-in (never the admin login) and keeps the assessment context
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.getByRole('button', { name: 'Go to Student Login' }).click();
      await page.waitForURL(new RegExp(`/assessment/join/${org.share_token}$`), { timeout: 15000 });
      await page.getByRole('heading', { name: 'Sign in to start' }).waitFor({ timeout: 30000 });
      assert.doesNotMatch(page.url(), /auth=login|admin/);
      assert.match(await ui.text(), /signed in with an administrator account/, 'the join page explains the mismatch and offers the sign-out');
    } finally { await browser.close(); }
  });
});
