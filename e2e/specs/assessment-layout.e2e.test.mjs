// Layout, theme and content of the pre-assessment screens in a real browser: the full-assessment Exam Instructions and the three
// section-retest entry pages. Real frontend + backend on a scratch database; e-mail goes to a local sink (nothing leaves the machine).
// Set LAYOUT_SHOT_DIR to also save screenshots (desktop / laptop / tablet / mobile, light / dark).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startSink } from '../support/smtpSink.mjs';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

let stack;
let org;
let sink;
before(async () => {
  sink = await startSink();
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURITY: 'none', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: 'PrepWin E2E <layout@e2e.test>' });
  stack = await startStack();
  org = await stack.newOrg('lay');
});
after(() => { stack?.stop(); sink?.close(); });

const SIZES = { desktop: [1920, 1080], laptop: [1366, 768], tablet: [768, 1024], mobile: [390, 844] };
const shot = async (page, name) => {
  if (!process.env.LAYOUT_SHOT_DIR) return;
  fs.mkdirSync(process.env.LAYOUT_SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.LAYOUT_SHOT_DIR, `${name}.png`), fullPage: true });
};
const setTheme = (page, dark) => page.evaluate((d) => { document.documentElement.classList.toggle('dark', d); try { localStorage.setItem('rr-theme', d ? 'dark' : 'light'); } catch { /* ignore */ } }, dark);
const noOverflow = async (page, label) => {
  const m = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > cw + 1)
      .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)} "${(e.textContent || '').slice(0, 40)}"`);
    return { sw: document.documentElement.scrollWidth, cw, offenders };
  });
  assert.ok(m.sw <= m.cw + 1, `${label}: no horizontal overflow (${m.sw} > ${m.cw}); offenders: ${m.offenders.join(' | ')}`);
};
const box = async (loc) => (await loc.boundingBox());
/** The frame and the panels really are drawn as specified (computed styles, not class names). */
const checkSurfaces = async (page, label) => {
  const frame = await page.getByTestId('assessment-frame').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow, bg: cs.backgroundColor, page: getComputedStyle(document.body.firstElementChild).backgroundColor };
  });
  assert.equal(frame.border, '1px', `${label}: the frame has a 1px border`);
  assert.ok(frame.radius >= 12 && frame.radius <= 16, `${label}: frame radius ${frame.radius}px`);
  assert.notEqual(frame.shadow, 'none', `${label}: the frame has a subtle shadow`);
  assert.notEqual(frame.bg, frame.page, `${label}: the frame contrasts with the page background`);
  const panels = await page.locator('main [aria-label="Assessment Rules"], main [aria-label="Retest details"], main ol > li > div').evaluateAll((els) => els.map((el) => { const cs = getComputedStyle(el); return [cs.borderTopWidth, parseFloat(cs.borderTopLeftRadius)]; }));
  assert.ok(panels.length >= 2 && panels.every(([bw, r]) => bw === '1px' && r === 12), `${label}: every card / panel has a 1px border and a 12px radius (${JSON.stringify(panels)})`);
};
/** Colours that would look wrong on the active theme: warning tints, or a white surface in dark mode. */
const themeProblems = (page, dark) => page.evaluate((isDark) => {
  const bad = [];
  for (const el of document.querySelectorAll('main *')) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/\b(?:dark:)?(?:bg|border|text)-(?:amber|orange|yellow)-/.test(cls)) bad.push(`warning colour: ${cls.slice(0, 60)}`);
    if (isDark) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg === 'rgb(255, 255, 255)') bad.push(`white surface in dark mode: ${cls.slice(0, 60)}`);
    }
  }
  return bad;
}, dark);

describe('full assessment: Exam Instructions', () => {
  test('wide, aligned, neutral and compact at every size, in light and dark', async () => {
    const student = await stack.newOrgStudent(org, 'Layout Student');
    const { browser, context } = await U.launch({ viewport: { width: 1920, height: 1080 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    try {
      await U.registerCandidate(ui, stack.web, org.share_token, student);
      await page.getByRole('heading', { name: 'Exam Instructions' }).waitFor({ timeout: 20000 });
      const text = await ui.text();
      assert.match(text, /Your timer has not started/);
      assert.match(text, /Maximum overall duration: 60 minutes/);
      for (const label of ['Aptitude', 'Coding', 'AI Technical Interview']) assert.ok(text.includes(label), label);
      assert.ok(!text.includes('Rules of Assessment') && text.includes('Assessment Rules'));

      const rules = page.getByRole('region', { name: 'Assessment Rules' });
      const rows = await rules.getByTestId('essential-rules').locator('> li').allInnerTexts();
      assert.deepEqual(rows.map((r) => r.replace(/\s+/g, ' ').trim()), [
        'One Attempt You cannot restart after starting.',
        'Time Limit Each section has 20 minutes; the full assessment is limited to 60 minutes.',
        'No Pausing The timer continues running once started.',
        'Final Submission Submitted sections cannot be reopened.',
        'Stay on Screen Avoid refreshing, closing the tab, or switching windows.',
      ], 'exactly the five essential rules');
      assert.equal(await page.locator('details').count(), 0, 'no accordion: the long rules are gone, not collapsed');
      for (const gone of ['Read the full rules', 'Assessment Structure', 'Answering and Submitting', 'Proctoring and Integrity', 'Completion and Results']) assert.ok(!text.includes(gone), `must not show ${gone}`);
      assert.ok(text.split(/\s+/).length < 190, `the whole page reads in well under 30 seconds (${text.split(/\s+/).length} words)`);

      await checkSurfaces(page, 'full assessment');
      assert.equal(await page.getByTestId('assessment-frame').count(), 1, 'one assessment frame');
      assert.equal(await page.getByRole('list', { name: 'Assessment sections in order' }).locator('> li').count(), 3, 'all three section cards');
      assert.equal(await page.getByTestId('essential-rules').locator('> li').first().evaluate((li) => getComputedStyle(li).borderTopWidth), '0px', 'first rule has no divider above it');
      assert.equal(await page.getByTestId('essential-rules').locator('> li').nth(2).evaluate((li) => getComputedStyle(li).borderTopWidth), '1px', 'rules are separated by light dividers');

      for (const [name, [w, h]] of Object.entries(SIZES)) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(150);
        await noOverflow(page, name);
        const container = await box(page.locator('main'));
        const cards = page.getByRole('list', { name: 'Assessment sections in order' }).locator('> li');
        assert.equal(await cards.count(), 3);
        const boxes = [await box(cards.nth(0)), await box(cards.nth(1)), await box(cards.nth(2))];
        if (w >= 640) {
          assert.ok(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 2 && Math.abs(b.height - boxes[0].height) < 2), `${name}: three equal cards on one row`);
        } else {
          assert.ok(boxes[1].y > boxes[0].y && Math.abs(boxes[1].x - boxes[0].x) < 2, `${name}: cards stack`);
          assert.ok(boxes[0].width >= w - 72, `${name}: cards use nearly the full width (${boxes[0].width} of ${w}, inside the page margin and the frame padding)`);
        }
        if (w >= 1366) assert.ok(boxes[0].x + boxes[1].width + boxes[2].width > 650, `${name}: the content is wide, not a narrow column`);
        const header = await box(page.locator('header').first());
        assert.ok(header.width >= container.width - 1);
        // the brand, the cards and the action row share the content's left edge
        const brand = await box(page.getByRole('img', { name: 'ThirdEye Data' }));
        const frameBox = await box(page.getByTestId('assessment-frame'));
        assert.ok(Math.abs(brand.x - frameBox.x) < 3, `${name}: the brand and the assessment frame share the content's left edge (${brand.x} vs ${frameBox.x})`);
        assert.ok(boxes[0].x > frameBox.x && boxes[0].x - frameBox.x <= 40 && frameBox.x + frameBox.width - (boxes[2].x + boxes[2].width) <= 40, `${name}: cards sit inside the frame with even padding`);
        const action = await box(page.getByRole('button', { name: 'Continue to Device Check' }));
        const actionRow = await box(page.locator('#instructions-ack'));
        assert.ok(Math.abs((action.y + action.height / 2) - (actionRow.y + actionRow.height / 2)) < 40 || action.y > actionRow.y, `${name}: the button is in the action bar with the confirmation`);
        for (const dark of [false, true]) {
          await setTheme(page, dark);
          const problems = await themeProblems(page, dark);
          assert.deepEqual(problems, [], `${name} ${dark ? 'dark' : 'light'}: ${problems.join(' | ')}`);
          await shot(page, `instructions-${name}-${dark ? 'dark' : 'light'}`);
        }
        await setTheme(page, false);
      }

      // the page stays short: the rules and the action bar are on one laptop screen (at most a few lines of scrolling)
      await page.setViewportSize({ width: 1366, height: 768 });
      const heightLaptop = await page.evaluate(() => document.documentElement.scrollHeight);
      assert.ok(heightLaptop <= 840, `little or no scrolling on a laptop (${heightLaptop}px)`);
      const btn = page.getByRole('button', { name: 'Continue to Device Check' });
      assert.equal(await btn.isDisabled(), true, 'locked until the rules are confirmed');
      await page.waitForTimeout(500);
      const [off, on] = [await btn.evaluate((b) => getComputedStyle(b).backgroundColor)];
      await page.locator('#instructions-ack').check();
      await page.waitForTimeout(500);                                   // the button's colour is a CSS transition: read the settled value
      const enabled = await btn.evaluate((b) => getComputedStyle(b).backgroundColor);
      assert.notEqual(off, enabled, 'disabled and enabled are visibly different (grey vs PrepWin green)');
      assert.ok((await btn.boundingBox()).height >= 44, '44px tap target');
      await page.locator('#instructions-ack').uncheck();
      await shot(page, 'instructions-final');

      // the start workflow is unchanged: acknowledgement -> device check (still nothing started)
      await page.locator('#instructions-ack').check();
      await page.getByRole('button', { name: 'Continue to Device Check' }).click();
      await page.waitForURL(/assessment$/, { timeout: 15000 });
      assert.equal(ui.count(/\/start$/), 0, 'no attempt was started');
    } finally { await browser.close(); }
  });
});

describe('section retest entry pages show only the assigned section', () => {
  test('Aptitude, Coding and AI Technical Interview retests: focused layout, correct facts, nothing from the other sections', async () => {
    const student = await stack.newOrgStudent(org, 'Retest Layout');
    const { browser, context } = await U.launch({ viewport: { width: 1920, height: 1080 } });
    const ui = await U.newPage(context, stack.api);
    const { page } = ui;
    try {
      await U.registerCandidate(ui, stack.web, org.share_token, student);
      await U.acknowledgeAndOpenDeviceCheck(ui);
      await U.clickStart(ui);
      await U.answerAptitude(ui, { count: 15 });
      await U.openCoding(ui);
      await U.setCode(ui, U.SOLUTIONS.sumPython);
      await U.stubVoiceApi(ui.page);
      await U.submitCodingToInterview(ui);
      await U.answerWrittenInterview(ui);
      await U.finishInterview(ui);
      await page.waitForURL(/\/complete$/, { timeout: 90000 });

      const reg = (await stack.call('GET', '/api/admin/recruitment/candidates?page_size=100', { token: org.token })).body.items.find((r) => r.email === student.email.toLowerCase());
      const assigned = await stack.call('POST', `/api/admin/recruitment/candidates/${reg.id}/retests`, { token: org.token, json: { sections: ['aptitude', 'coding', 'interview'] } });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
      const byKey = Object.fromEntries(assigned.body.retests.map((r) => [r.section, r.retest_uuid]));

      const EXPECT = {
        aptitude: { title: 'Aptitude Retest', format: '15 multiple-choice questions', others: ['Coding', 'AI Technical Interview'] },
        coding: { title: 'Coding Retest', format: '2 programming problems', others: ['Aptitude', 'AI Technical Interview'] },
        interview: { title: 'AI Technical Interview Retest', format: '5 voice-based interview questions', others: ['Aptitude', 'Coding'] },
      };
      for (const [key, want] of Object.entries(EXPECT)) {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(`${stack.web}/assessment/retest/${byKey[key]}`);
        await page.getByRole('heading', { name: want.title, exact: true }).waitFor({ timeout: 30000 });
        const text = await ui.text();
        assert.ok(text.includes('20 minutes') && text.includes(want.format), `${key}: duration and format (${want.format})`);
        assert.ok(text.includes(`You are retaking only the ${want.title.replace(' Retest', '')} section. Your other sections are unaffected.`), `${key}: says only this section is retaken`);
        await checkSurfaces(page, `${key} retest`);
        assert.equal(await page.getByRole('list', { name: 'Assessment sections in order' }).count(), 0, `${key}: one focused section card, not three`);
        const card = page.getByRole('region', { name: 'Retest details' });
        assert.ok(await card.locator('.rounded-full', { hasText: '20 minutes' }).isVisible(), `${key}: a clearly visible 20-minute duration badge`);
        for (const other of want.others) {
          // the other sections' NAMES may only appear in the sentence that says they are unaffected? No: they must not appear at all
          assert.ok(!new RegExp(`\\b${other}\\b`).test(text.replace(want.title.replace(' Retest', ''), '')), `${key}: no mention of ${other}`);
        }
        for (const forbidden of ['60 minutes', 'Maximum overall duration', 'Section 1', 'Section 2', 'Section 3', 'three sections', 'next section', 'Assessment Structure', 'Completion and Results']) {
          assert.ok(!text.includes(forbidden), `${key}: must not show "${forbidden}"`);
        }
        assert.ok(text.includes('Valid until'), `${key}: validity is shown`);
        const rules = page.getByRole('region', { name: 'Assessment Rules' });
        const rows = (await rules.getByTestId('essential-rules').locator('> li').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
        assert.deepEqual(rows, [
          'One Attempt You cannot restart after starting.',
          'Submit on Time You have 20 minutes. Submit before the timer ends.',
          'Stay on Screen Avoid refreshing, closing the tab, or switching windows.',
        ], `${key}: three short retest rules`);
        assert.equal(await page.locator('details').count(), 0, `${key}: no accordion`);
        assert.ok(!/Proctoring and Integrity|Assessment Structure|Read the .* rules/.test(text), `${key}: no long rule text`);

        for (const [name, [w, h]] of Object.entries(SIZES)) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(150);
          await noOverflow(page, `${key} ${name}`);
          const details = await box(page.getByRole('region', { name: 'Retest details' }));
          const rulesBox = await box(rules);
          const action = await box(page.getByRole('button', { name: 'Continue to device check' }));
          const brand = await box(page.getByRole('img', { name: 'ThirdEye Data' }));
          const frameBox = await box(page.getByTestId('assessment-frame'));
          assert.ok(Math.abs(brand.x - frameBox.x) < 3 && details.x > frameBox.x && details.x - frameBox.x <= 40, `${key} ${name}: header, frame and card are aligned`);
          if (w >= 1024) {
            assert.ok(Math.abs(details.y - rulesBox.y) < 3 && rulesBox.x > details.x + details.width - 2, `${key} ${name}: details and rules sit side by side`);
            assert.ok(Math.abs((rulesBox.x + rulesBox.width) - (action.x + action.width)) < 80 || action.x + action.width <= rulesBox.x + rulesBox.width + 1, `${key} ${name}: action inside the same container`);
          } else {
            assert.ok(rulesBox.y > details.y + details.height - 2 && Math.abs(rulesBox.x - details.x) < 3 && Math.abs(rulesBox.width - details.width) < 3, `${key} ${name}: cards stack at the same width`);
          }
          for (const dark of [false, true]) {
            await setTheme(page, dark);
            const problems = await themeProblems(page, dark);
            assert.deepEqual(problems, [], `${key} ${name} ${dark ? 'dark' : 'light'}: ${problems.join(' | ')}`);
            if (key === 'coding' || name === 'laptop') await shot(page, `retest-${key}-${name}-${dark ? 'dark' : 'light'}`);
          }
          await setTheme(page, false);
        }
      }

      // the retest workflow itself is unchanged: accept -> device check (nothing starts before the explicit start)
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`${stack.web}/assessment/retest/${byKey.coding}`);
      await page.getByRole('heading', { name: 'Coding Retest', exact: true }).waitFor({ timeout: 30000 });
      const cont = page.getByRole('button', { name: 'Continue to device check' });
      assert.equal(await cont.isDisabled(), true, 'locked until the rules are accepted');
      await page.locator('input[type=checkbox]').check();
      await cont.click();
      await page.getByRole('button', { name: /Start Assessment/ }).waitFor({ timeout: 30000 });
      assert.equal(ui.count(/\/api\/public\/retest\/[0-9a-f-]{36}\/start$/), 0, 'no sitting was started by reading the page');
    } finally { await browser.close(); }
  });
});
