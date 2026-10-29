// Streaming voice turn: the NDJSON reader and VoiceInterviewSession.streamAnswer, with fake streams, a fake player and no microphone.
// A passing run proves the turn-taking and fallback logic, NOT live audio or the real services.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './test_support/bundle.mjs';

const loadSession = () => loadModule('src/utils/voiceInterviewSession.js');
const loadNdjson = () => loadModule('src/utils/ndjson.js');

const b64 = (text) => Buffer.from(text).toString('base64');
const stream = (events) => async function* () { for (const e of events) yield e; };

const bodyOf = (chunks) => new ReadableStream({
    start(controller) { chunks.forEach((c) => controller.enqueue(new TextEncoder().encode(c))); controller.close(); },
});

// A session whose player, listener and clock-dependent parts are replaced, so only streamAnswer's own logic runs.
const harness = async (turnStream) => {
    const { VoiceInterviewSession } = await loadSession();
    const s = new VoiceInterviewSession({ turn: async () => { throw new Error('plain turn must not run'); }, turnStream });
    const log = { played: [], emitted: [], listening: 0 };
    s.play = async (blob) => { log.played.push(blob.size); };
    s.startListening = () => { log.listening += 1; s.state = 'listening'; };
    const emit = s.emit.bind(s);
    // live-caption events are covered by test_voice_live_captions: this suite is about the order of the turn itself
    s.emit = (event, payload) => { if (event !== 'caption') log.emitted.push(event === 'message' ? `${event}:${payload.role}` : event); emit(event, payload); };
    return { s, log };
};

describe('readNdjson', () => {
    test('yields one object per line even when a chunk ends mid-line', async () => {
        const { readNdjson } = await loadNdjson();
        const out = [];
        for await (const e of readNdjson(bodyOf(['{"a":1}\n{"b"', ':2}\n', '{"c":3}']))) out.push(e);
        assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    test('ignores blank lines and an empty body', async () => {
        const { readNdjson } = await loadNdjson();
        const out = [];
        for await (const e of readNdjson(bodyOf(['\n\n{"a":1}\n\n']))) out.push(e);
        assert.deepEqual(out, [{ a: 1 }]);
        for await (const e of readNdjson(bodyOf([]))) out.push(e);
        assert.equal(out.length, 1);
    });

    test('a corrupt line is an error, not silently skipped', async () => {
        const { readNdjson } = await loadNdjson();
        await assert.rejects(async () => { for await (const e of readNdjson(bodyOf(['{"a":1}\nnot json\n']))) void e; });
    });
});

describe('VoiceInterviewSession.streamAnswer', () => {
    test('speaks every chunk in order, records both sides of the conversation, then listens again', async () => {
        const { s, log } = await harness(stream([
            { type: 'transcript', user_text: 'I built a payments service' },
            { type: 'audio', index: 0, text: 'Interesting.', audio_base64: b64('aaa'), mime: 'audio/mpeg' },
            { type: 'audio', index: 1, text: 'How did you test it?', audio_base64: b64('bbbbb'), mime: 'audio/mpeg' },
            { type: 'done', reply_text: 'Interesting. How did you test it?' },
        ]));
        assert.equal(await s.streamAnswer(new Blob(['x'])), true);
        assert.deepEqual(log.played, [3, 5]);
        assert.deepEqual(s.history, [{ role: 'user', text: 'I built a payments service' }, { role: 'ai', text: 'Interesting. How did you test it?' }]);
        assert.deepEqual(log.emitted.filter((e) => e !== 'message:user' && e !== 'message:assistant'), ['speech-start', 'speech-end']);
        assert.ok(log.emitted.indexOf('message:user') < log.emitted.indexOf('speech-start'), 'the candidate transcript appears first');
        assert.equal(log.listening, 1);
    });

    test('no speech recognised: keep listening and add nothing to the conversation', async () => {
        const { s, log } = await harness(stream([{ type: 'transcript', user_text: '' }, { type: 'done', reply_text: '' }]));
        assert.equal(await s.streamAnswer(new Blob(['x'])), true);
        assert.deepEqual(s.history, []);
        assert.equal(log.listening, 1);
        assert.deepEqual(log.played, []);
    });

    test('a failure before anything was heard hands back to the plain request (returns false, nothing recorded)', async () => {
        const { s, log } = await harness(async function* () { throw Object.assign(new Error('network'), { response: undefined }); });
        assert.equal(await s.streamAnswer(new Blob(['x'])), false);
        assert.deepEqual(s.history, []);
        assert.equal(log.listening, 0);
    });

    test('an error event after the candidate was transcribed is raised, so the same answer is never recorded twice', async () => {
        const { s } = await harness(stream([
            { type: 'transcript', user_text: 'hello' },
            { type: 'error', message: 'The interviewer is unavailable right now.', status: 503 },
        ]));
        await assert.rejects(() => s.streamAnswer(new Blob(['x'])), /unavailable/);
        assert.deepEqual(s.history, [{ role: 'user', text: 'hello' }]);
    });

    test('closing the session mid-stream stops playback and never resumes listening', async () => {
        const { s, log } = await harness(async function* () {
            yield { type: 'transcript', user_text: 'hello' };
            s.closed = true;
            yield { type: 'audio', index: 0, text: 'x', audio_base64: b64('a'), mime: 'audio/mpeg' };
        });
        assert.equal(await s.streamAnswer(new Blob(['x'])), true);
        assert.deepEqual(log.played, []);
        assert.equal(log.listening, 0);
    });

    test('a playback failure surfaces as an error instead of a silent hang', async () => {
        const { s } = await harness(stream([
            { type: 'transcript', user_text: 'hi' },
            { type: 'audio', index: 0, text: 'x', audio_base64: b64('a'), mime: 'audio/mpeg' },
            { type: 'done', reply_text: 'x' },
        ]));
        s.play = async () => { throw new Error('Interviewer audio could not be played.'); };
        await assert.rejects(() => s.streamAnswer(new Blob(['x'])), /could not be played/);
    });

    test('without a stream function the session keeps using the plain request', async () => {
        const { VoiceInterviewSession } = await loadSession();
        assert.equal(new VoiceInterviewSession({ turn: async () => ({}) }).turnStream, null);
    });
});
