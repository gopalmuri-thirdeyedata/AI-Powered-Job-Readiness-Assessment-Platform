// Turn-taking logic of the voice interview (src/utils/voiceInterviewSession.js). No browser or microphone is involved:
// loudness readings are fed in with a fake clock. A passing run proves the logic, NOT a live conversation.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './test_support/bundle.mjs';

const load = () => loadModule('src/utils/voiceInterviewSession.js');

// Feed `level` readings every 50 ms from `from` to `to`; returns the events produced and the time reached.
const feed = (detector, level, from, to) => {
    const events = [];
    for (let t = from; t < to; t += 50) {
        const e = detector.push(level, t);
        if (e) events.push(e);
    }
    return events;
};

describe('UtteranceDetector', () => {
    test('quiet room produces nothing', async () => {
        const { UtteranceDetector } = await load();
        assert.deepEqual(feed(new UtteranceDetector(), 0.004, 0, 5000), []);
    });

    test('a spoken answer starts after sound is confirmed and ends after the pause, and is sent', async () => {
        const { UtteranceDetector, END_SILENCE_MS } = await load();
        const d = new UtteranceDetector();
        assert.deepEqual(feed(d, 0.004, 0, 700), []);
        assert.deepEqual(feed(d, 0.2, 700, 3000), ['speech-start']);
        const events = feed(d, 0.004, 3000, 3000 + END_SILENCE_MS + 200);
        assert.deepEqual(events, ['speech-end']);
    });

    test('a short pause between words does not end the answer', async () => {
        const { UtteranceDetector, END_SILENCE_MS } = await load();
        const d = new UtteranceDetector();
        feed(d, 0.004, 0, 700);
        feed(d, 0.2, 700, 2200);
        assert.deepEqual(feed(d, 0.004, 2200, 2200 + END_SILENCE_MS - 300), [], 'still the same answer');
        assert.equal(d.speaking, true);
    });

    test('a cough or click shorter than the minimum is discarded, not sent', async () => {
        const { UtteranceDetector, END_SILENCE_MS } = await load();
        const d = new UtteranceDetector();
        feed(d, 0.004, 0, 700);
        const events = [...feed(d, 0.3, 700, 900), ...feed(d, 0.004, 900, 900 + END_SILENCE_MS + 300)];
        assert.deepEqual(events, ['speech-start', 'discard']);
    });

    test('a very long answer is cut and sent', async () => {
        const { UtteranceDetector, MAX_UTTERANCE_MS } = await load();
        const d = new UtteranceDetector();
        feed(d, 0.004, 0, 700);
        const events = feed(d, 0.2, 700, 700 + MAX_UTTERANCE_MS + 100);
        assert.deepEqual(events, ['speech-start', 'speech-end']);
    });

    test('steady background noise raises the bar so it is not mistaken for speech', async () => {
        const { UtteranceDetector, speechThreshold } = await load();
        const d = new UtteranceDetector();
        assert.deepEqual(feed(d, 0.02, 0, 6000), [], 'a constantly noisy room is never mistaken for speech');
        assert.ok(d.noiseFloor >= 0.019, 'the noise floor was learned');
        assert.ok(speechThreshold(d.noiseFloor) > 0.05);
        assert.deepEqual(feed(d, 0.025, 6000, 8000), [], 'noise slightly above the old floor stays quiet');
        assert.deepEqual(feed(d, 0.3, 8000, 9000), ['speech-start'], 'real speech still gets through');
    });
});

describe('helpers', () => {
    test('rms of a constant signal is its amplitude; empty input is 0', async () => {
        const { rms } = await load();
        assert.ok(Math.abs(rms(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-6);
        assert.equal(rms(new Float32Array([])), 0);
    });

    test('a voice turn is sent as multipart with the history and the opening flag', async () => {
        const { buildVoiceTurnForm } = await load();
        const history = [{ role: 'ai', text: 'Hello' }];
        const form = buildVoiceTurnForm({ blob: new Blob(['x'], { type: 'audio/webm' }), history });
        assert.equal(form.get('opening'), 'false');
        assert.deepEqual(JSON.parse(form.get('history')), history);
        assert.ok(form.get('audio'));
        const opening = buildVoiceTurnForm({ opening: true });
        assert.equal(opening.get('opening'), 'true');
        assert.equal(opening.get('audio'), null, 'the opening line needs no recording');
    });
});

describe('waiting for the candidate to finish (adaptive end of answer)', () => {
    test('a sentence left hanging waits longer than a finished one, and nothing is cut off before the base pause', async () => {
        const m = await load();
        assert.ok(m.END_SILENCE_MS >= 2000, 'a real interviewer waits at least two seconds');
        assert.equal(m.endSilenceFor(''), m.END_SILENCE_MS);
        assert.equal(m.endSilenceFor('I built the service with Redis and'), m.END_SILENCE_UNFINISHED_MS);
        assert.equal(m.endSilenceFor('We cached the results, because'), m.END_SILENCE_UNFINISHED_MS);
        assert.equal(m.endSilenceFor('We used a queue so that,'), m.END_SILENCE_UNFINISHED_MS);
        assert.equal(m.endSilenceFor('That is how I fixed the memory leak.'), m.END_SILENCE_FINISHED_MS);
        assert.equal(m.endSilenceFor('We moved the work to a background queue'), m.END_SILENCE_MS);
        assert.ok(m.END_SILENCE_FINISHED_MS < m.END_SILENCE_MS && m.END_SILENCE_MS < m.END_SILENCE_UNFINISHED_MS);
    });

    test('the detector keeps listening through a pause shorter than the wait it is given, and ends the answer after it', async () => {
        const { UtteranceDetector } = await load();
        const d = new UtteranceDetector();
        const run = (level, from, to, wait) => { const out = []; for (let t = from; t < to; t += 50) { const e = d.push(level, t, wait); if (e) out.push(e); } return out; };
        run(0.004, 0, 700, 4000);                                    // calibrate
        assert.deepEqual(run(0.3, 700, 2200, 4000), ['speech-start']);
        assert.deepEqual(run(0.004, 2200, 2200 + 3500, 4000), [], 'a 3.5 s pause after "and" is still the same answer');
        assert.deepEqual(run(0.004, 5700, 5700 + 900, 4000), ['speech-end']);
    });
});
