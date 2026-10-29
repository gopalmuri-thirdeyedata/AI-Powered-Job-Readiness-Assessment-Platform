// Live captions of the voice interview: what the candidate is saying is shown while they speak, so they can see they are being heard.
// A fake SpeechRecognition stands in for the browser's; no microphone, no network. A passing run proves the caption lifecycle, NOT
// the accuracy of any real recogniser.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './test_support/bundle.mjs';

const loadSession = () => loadModule('src/utils/voiceInterviewSession.js');

class FakeRecognition {
    static instances = [];
    constructor() { this.started = false; this.stopped = false; FakeRecognition.instances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; if (this.onend) this.onend(); }
    // results: [{ text, final }] as the browser would deliver them
    say(results) { this.onresult({ results: results.map((r) => Object.assign([{ transcript: r.text }], { isFinal: !!r.final })) }); }
    fail(error) { this.onerror({ error }); }
    end() { this.stopped = true; if (this.onend) this.onend(); }          // the browser stopped it by itself
}
const live = () => FakeRecognition.instances.filter((r) => r.started && !r.stopped);

const session = async (options = {}) => {
    const { VoiceInterviewSession } = await loadSession();
    const s = new VoiceInterviewSession({ turn: async () => ({}), ...options });
    const captions = [];
    const statuses = [];
    s.on('caption', (c) => captions.push(c.text));
    s.on('caption-status', (c) => statuses.push(c));
    s.beginRecording = () => {};                  // no recorder in a test
    return { s, captions, statuses };
};

beforeEach(() => { FakeRecognition.instances = []; globalThis.webkitSpeechRecognition = FakeRecognition; });
afterEach(() => { delete globalThis.webkitSpeechRecognition; delete globalThis.SpeechRecognition; });

describe('live captions', () => {
    test('listening starts the recogniser, and words appear as they are recognised, before the answer ends', async () => {
        const { s, captions } = await session();
        s.startListening();
        assert.equal(live().length, 1);
        live()[0].say([{ text: 'I built' }]);
        live()[0].say([{ text: 'I built a payments', final: false }]);
        live()[0].say([{ text: 'I built a payments service', final: true }, { text: ' in Python' }]);
        assert.deepEqual(captions.filter(Boolean), ['I built', 'I built a payments', 'I built a payments service in Python']);
    });

    test('the browser stopping after a pause does not lose what was already heard; it restarts and carries on', async () => {
        const { s, captions } = await session();
        s.startListening();
        live()[0].say([{ text: 'first part', final: true }]);
        live()[0].end();                                              // the browser stops listening by itself
        await new Promise((resolve) => setTimeout(resolve, 250));
        assert.equal(live().length, 1, 'a fresh recogniser is running');
        live()[0].say([{ text: 'second part' }]);
        assert.equal(captions.at(-1), 'first part second part');
    });

    test('when the answer ends the caption stays on screen (the answer is being processed) and the recogniser stops', async () => {
        const { s, captions } = await session();
        s.startListening();
        live()[0].say([{ text: 'my answer so far' }]);
        s.state = 'processing';
        s.stopCaptions();
        assert.equal(live().length, 0);
        assert.equal(captions.at(-1), 'my answer so far', 'not cleared: the server transcript replaces it');
        assert.equal(await new Promise((resolve) => setTimeout(() => resolve(live().length), 250)), 0, 'and it does not restart while processing');
    });

    test('a new answer starts from a blank caption', async () => {
        const { s, captions } = await session();
        s.startListening();
        live()[0].say([{ text: 'old answer' }]);
        s.stopCaptions();
        s.startListening();
        assert.equal(captions.at(-1), '');
        live()[0].say([{ text: 'new' }]);
        assert.equal(captions.at(-1), 'new');
    });

    test('while the interviewer speaks and when the call ends nothing is captioned and the caption is cleared', async () => {
        const { s, captions } = await session();
        s.startListening();
        live()[0].say([{ text: 'words' }]);
        s.stopCaptions({ clear: true });                               // what say() does when the interviewer starts
        assert.equal(captions.at(-1), '');
        assert.equal(live().length, 0);
        s.startListening();
        live()[0].say([{ text: 'again' }]);
        s.cleanup();
        assert.equal(captions.at(-1), '');
        assert.equal(live().length, 0);
    });

    test('muting silences the captions as well (the recogniser listens to the microphone on its own) and unmuting resumes them', async () => {
        const { s, captions } = await session();
        s.startListening();
        live()[0].say([{ text: 'hello' }]);
        s.setMuted(true);
        assert.equal(live().length, 0);
        assert.equal(captions.at(-1), '');
        s.setMuted(false);
        assert.equal(live().length, 1);
    });

    test('a cough or click that is discarded does not leave its caption behind', async () => {
        const { s, captions } = await session();
        s.startListening();
        live()[0].say([{ text: 'uh' }]);
        s.resetCaptions();
        assert.equal(captions.at(-1), '');
        assert.equal(live().length, 1, 'still listening for the real answer');
    });

    test('no permission or no service turns captions off and says so; the interview itself is unaffected', async () => {
        const { s, statuses } = await session();
        s.startListening();
        live()[0].fail('not-allowed');
        assert.deepEqual(statuses.map((x) => x.available), [false]);
        s.startListening();
        assert.equal(live().length, 0, 'it is not retried on every turn');
    });

    test('harmless errors such as no-speech do not disable captions', async () => {
        const { s, statuses } = await session();
        s.startListening();
        live()[0].fail('no-speech');
        live()[0].end();
        await new Promise((resolve) => setTimeout(resolve, 250));
        assert.equal(statuses.length, 0);
        assert.equal(live().length, 1);
    });

    test('a browser without speech recognition simply has no captions, with no error', async () => {
        delete globalThis.webkitSpeechRecognition;
        const { s, captions } = await session();
        assert.doesNotThrow(() => s.startListening());
        assert.deepEqual(captions.filter(Boolean), []);
    });

    test('captions can be switched off by the caller', async () => {
        const { s } = await session({ captions: false });
        s.startListening();
        assert.equal(live().length, 0);
    });
});
