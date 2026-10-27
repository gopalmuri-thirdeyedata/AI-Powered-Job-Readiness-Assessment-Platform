// OPT-IN live check of the voice interview against the real Vapi service (billable: the call runs for about half a minute).
//   E2E_LIVE_VAPI_CALL=1 node --test specs/live-vapi.e2e.test.mjs
//
// It proves CONNECTION and lifecycle only: the browser connects, the AI interviewer speaks, the call ends cleanly, the interview
// is submitted. The fake microphone produces no speech, so it does NOT verify speech transcription of a candidate or AI scoring
// (Gemini is the offline mock). The backend's Vapi REST calls are stubbed (the browser uses the inline assistant configuration).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../support/stack.mjs';
import * as U from '../support/ui.mjs';

const enabled = !!process.env.E2E_LIVE_VAPI_CALL;
let stack;
let org;
before(async () => { if (!enabled) return; stack = await startStack(); org = await stack.newOrg('vapi'); });
after(() => stack?.stop());

describe('live Vapi call (opt-in)', { skip: !enabled && 'set E2E_LIVE_VAPI_CALL=1 to run (uses the real Vapi service)' }, () => {
  test('connects, the interviewer speaks, the call ends cleanly and the interview is submitted; no unsupported-SDK warning', async () => {
    const { browser, context } = await U.launch();
    const ui = await U.newPage(context, stack.api);
    try {
      await U.stubNoPersonProctoring(ui.page);
      await U.startRecruitmentAttempt(ui, stack, org);
      const uuid = U.sessionUuid(ui);
      await U.answerAptitude(ui);
      await U.openCoding(ui);
      await U.submitCodingToInterview(ui);

      // connected: the "Connecting" overlay goes away and the interviewer's first words appear in the live transcript
      await ui.page.waitForFunction(() => !/Connecting to AI Interviewer/.test(document.body.innerText), null, { timeout: 60000 });
      await ui.page.waitForFunction(() => /LIVE TRANSCRIPT[\s\S]*AI Interviewer\s+\S/i.test(document.body.innerText), null, { timeout: 60000 });
      assert.doesNotMatch(await ui.text(), /Connection Failed/);
      await ui.page.waitForTimeout(12000);                                   // let the interviewer speak a few sentences
      const spoken = (await ui.text()).match(/AI Interviewer/g) || [];
      assert.ok(spoken.length >= 2, 'the interviewer produced transcript lines');

      // the SDK no longer warns that its Daily client is unsupported
      const warnings = ui.t.console.filter((c) => /no longer supported|daily-js version/i.test(c.text));
      assert.deepEqual(warnings, [], JSON.stringify(warnings));

      // clean disconnect, then the submission: exactly one request, session completed
      await ui.page.getByRole('button', { name: 'End Interview' }).click();
      await ui.page.getByRole('button', { name: /Submit & Complete/ }).click();
      await ui.page.waitForSelector('text=Assessment submitted', { timeout: 90000 });
      assert.equal(ui.count(/submit-interview$/), 1);
      assert.equal((await stack.session(uuid)).state, 'COMPLETED');
      assert.equal(ui.t.errors.length, 0, ui.t.errors.join('; '));
    } finally { await browser.close(); }
  });
});
