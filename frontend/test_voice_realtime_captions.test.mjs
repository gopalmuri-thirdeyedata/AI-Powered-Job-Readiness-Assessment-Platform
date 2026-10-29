// Realtime live captions: the microphone is streamed to the speech service and the words are shown as they arrive; the interviewer's words
// follow their voice. A fake websocket, audio context and player stand in for the real ones: this proves the protocol handling,
// buffering, reconnect and fallback logic, NOT the accuracy of the service or a real microphone.
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadModule } from './test_support/bundle.mjs';

const load = () => loadModule('src/utils/liveCaptions.js');
const loadSession = () => loadModule('src/utils/voiceInterviewSession.js');
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeSocket {
    static instances = [];
    constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeSocket.instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    say(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    drop() { this.onclose?.(); }
    refuse() { this.onerror?.(); this.onclose?.(); }
}

// Just enough of an AudioContext to capture frames
class FakeAudioContext {
    static last = null;
    constructor() { this.sampleRate = 16000; this.state = 'running'; this.destination = {}; FakeAudioContext.last = this; }
    resume() {}
    close() { this.closedFlag = true; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() { this.processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return this.processor; }
    feed(samples) { this.processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } }); }
}

const sine = (n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10) * amp);

beforeEach(() => { FakeSocket.instances = []; FakeAudioContext.last = null; });

describe('audio conversion', () => {
    test('floats become 16-bit PCM, clamped, and base64 encodes the raw little-endian bytes', async () => {
        const { toPcm16, pcmToBase64 } = await load();
        const pcm = toPcm16(Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]));
        assert.deepEqual([...pcm], [0, 16383, -16384, 32767, -32768, 32767, -32768]);
        assert.equal(Buffer.from(pcmToBase64(Int16Array.from([1, -2])), 'base64').toString('hex'), '0100feff');
    });

    test('other sample rates are resampled to 16 kHz with the right length', async () => {
        const { toPcm16 } = await load();
        assert.equal(toPcm16(new Float32Array(4800), 48000, 16000).length, 1600);
        assert.equal(toPcm16(new Float32Array(441), 44100, 16000).length, 160);
    });

    test('a large frame does not overflow the encoder', async () => {
        const { toPcm16, pcmToBase64 } = await load();
        assert.ok(pcmToBase64(toPcm16(sine(200000))).length > 100000);
    });
});

describe('word-by-word display', () => {
    test('shows one more word per tick, catches up when far behind, and never passes the text', async () => {
        const { revealStep } = await load();
        assert.equal(revealStep(0, 5), 1);
        assert.equal(revealStep(4, 5), 5);
        assert.equal(revealStep(5, 5), 5);
        assert.ok(revealStep(0, 60) > 1 && revealStep(0, 60) < 60, 'a long jump is eased in');
        assert.equal(revealStep(9, 4), 4, 'text revised to something shorter');
    });

    test("the interviewer's words follow the audio: earlier chunks in full, this chunk spread over its duration", async () => {
        const { aiRevealedText } = await load();
        const chunk = 'How did you test it';
        assert.equal(aiRevealedText('Interesting.', chunk, 0, 2000), 'Interesting.');
        assert.equal(aiRevealedText('Interesting.', chunk, 300, 2000), 'Interesting. How');        // 5 words over 2 s: each word owns 400 ms
        assert.equal(aiRevealedText('Interesting.', chunk, 600, 2000), 'Interesting. How did');
        assert.equal(aiRevealedText('Interesting.', chunk, 1000, 2000), 'Interesting. How did you');
        assert.equal(aiRevealedText('Interesting.', chunk, 2000, 2000), 'Interesting. How did you test it');
        assert.equal(aiRevealedText('', chunk, 9999, 2000), chunk, 'never beyond the text');
        assert.ok(aiRevealedText('', chunk, 500, null).length > 0, 'without a known duration it still moves');
    });
});

const make = async (overrides = {}) => {
    const { RealtimeCaptions } = await load();
    const captions = [];
    const fatal = [];
    let tokens = 0;
    const c = new RealtimeCaptions({
        getSession: async () => { tokens += 1; return { url: `wss://example.test/stt?token=t${tokens}` }; },
        onCaption: (text) => captions.push(text),
        onFatal: (reason) => fatal.push(reason),
        WebSocketImpl: FakeSocket,
        AudioContextImpl: FakeAudioContext,
        ...overrides,
    });
    c.attach({});
    return { c, captions, fatal, tokens: () => tokens };
};

describe('RealtimeCaptions', () => {
    test('streams captured audio as 16 kHz PCM chunks and shows words as they are recognised', async () => {
        const { c, captions } = await make();
        c.start();
        await tick();
        const socket = FakeSocket.instances[0];
        socket.open();
        FakeAudioContext.last.feed(sine(2048));
        assert.equal(socket.sent.length, 1);
        assert.deepEqual({ ...socket.sent[0], audio_base_64: '…' }, { message_type: 'input_audio_chunk', audio_base_64: '…', commit: false, sample_rate: 16000 });
        socket.say({ message_type: 'partial_transcript', text: 'I built' });
        socket.say({ message_type: 'partial_transcript', text: 'I built a payment service' });
        assert.deepEqual(captions, ['I built', 'I built a payment service']);
    });

    test('audio spoken while the connection is still opening is kept and sent, in order, once it opens', async () => {
        const { c } = await make();
        c.start();
        await tick();
        const socket = FakeSocket.instances[0];
        FakeAudioContext.last.feed(sine(2048, 0.1));
        FakeAudioContext.last.feed(sine(2048, 0.2));
        assert.equal(socket.sent.length, 0, 'nothing can be sent before it opens');
        socket.open();
        assert.equal(socket.sent.length, 2, 'nothing the candidate said is lost');
        FakeAudioContext.last.feed(sine(2048, 0.3));
        assert.equal(socket.sent.length, 3);
    });

    test('finished segments are kept and the next one continues after them', async () => {
        const { c, captions } = await make();
        c.start(); await tick();
        const socket = FakeSocket.instances[0];
        socket.open();
        socket.say({ message_type: 'partial_transcript', text: 'first part' });
        socket.say({ message_type: 'committed_transcript', text: 'first part.' });
        socket.say({ message_type: 'partial_transcript', text: 'second' });
        assert.deepEqual(captions, ['first part', 'first part.', 'first part. second']);
    });

    test('a connection warmed up while the interviewer speaks is reused when listening starts', async () => {
        const { c, tokens } = await make();
        c.warm(); await tick();
        FakeSocket.instances[0].open();
        c.start(); await tick();
        assert.equal(FakeSocket.instances.length, 1);
        assert.equal(tokens(), 1, 'one token, one connection');
    });

    test('while the answer is not being given, no audio is sent and late words are ignored', async () => {
        const { c, captions } = await make();
        c.warm(); await tick();
        const socket = FakeSocket.instances[0];
        socket.open();
        FakeAudioContext.last.feed(sine(2048));
        assert.equal(socket.sent.length, 0, 'the interviewer speaking is never streamed');
        c.start();
        c.stop();
        socket.say({ message_type: 'partial_transcript', text: 'too late' });
        assert.deepEqual(captions, []);
        assert.equal(socket.closed, true, 'a finished answer drops its connection, so the next one starts clean');
    });

    test('a dropped connection reconnects and carries on; after repeated failures it gives up exactly once', async () => {
        const { c, fatal, tokens } = await make();
        c.start(); await tick();
        FakeSocket.instances[0].open();
        FakeSocket.instances[0].drop();
        await tick();
        assert.equal(FakeSocket.instances.length, 2, 'reconnected');
        FakeSocket.instances[1].refuse(); await tick();
        FakeSocket.instances[2].refuse(); await tick(20);
        assert.equal(fatal.length, 1);
        assert.equal(c.available, false);
        assert.ok(tokens() <= 4);
    });

    test('a refused or exhausted account is fatal at once; a failed token request is fatal after the retries', async () => {
        const first = await make();
        first.c.start(); await tick();
        FakeSocket.instances[0].open();
        FakeSocket.instances[0].say({ message_type: 'quota_exceeded', error: 'out of credit' });
        assert.deepEqual(first.fatal, ['quota_exceeded: out of credit']);

        const second = await make({ getSession: async () => { throw new Error('503'); } });
        second.c.start();
        await tick(30);
        assert.equal(second.fatal.length, 1);
        assert.match(second.fatal[0], /token/);
    });

    test('without a websocket or audio support it is simply unavailable', async () => {
        const { RealtimeCaptions } = await load();
        const c = new RealtimeCaptions({ getSession: async () => ({}), WebSocketImpl: null, AudioContextImpl: null });
        assert.equal(c.available, false);
        assert.doesNotThrow(() => { c.attach({}); c.start(); c.warm(); c.stop(); c.close(); });
    });
});

describe('inside the voice session', () => {
    const FakeRecognition = class { constructor() { FakeRecognition.made.push(this); } start() { this.started = true; } stop() { this.stopped = true; this.onend?.(); } };
    FakeRecognition.made = [];

    beforeEach(() => {
        FakeRecognition.made = [];
        globalThis.WebSocket = FakeSocket;
        globalThis.AudioContext = FakeAudioContext;
        globalThis.webkitSpeechRecognition = FakeRecognition;
    });
    afterEach(() => { delete globalThis.WebSocket; delete globalThis.AudioContext; delete globalThis.webkitSpeechRecognition; });

    const session = async () => {
        const { VoiceInterviewSession } = await loadSession();
        const s = new VoiceInterviewSession({ turn: async () => ({}), captionSession: async () => ({ url: 'wss://example.test/stt?token=t' }) });
        const captions = [];
        const statuses = [];
        s.on('caption', (c) => captions.push(c));
        s.on('caption-status', (c) => statuses.push(c));
        s.beginRecording = () => {};
        s.rtCaptions.attach({});
        return { s, captions, statuses };
    };

    test('listening uses the realtime service first (not the browser recogniser) and shows its words', async () => {
        const { s, captions } = await session();
        s.startListening();
        await tick();
        FakeSocket.instances[0].open();
        FakeSocket.instances[0].say({ message_type: 'partial_transcript', text: 'hello there' });
        assert.equal(captions.at(-1).text, 'hello there');
        assert.equal(captions.at(-1).role, 'user');
        assert.equal(FakeRecognition.made.length, 0);
    });

    test('if the realtime service fails, the browser recogniser takes over without the candidate doing anything', async () => {
        const { s, statuses } = await session();
        s.startListening();
        await tick();
        FakeSocket.instances[0].open();
        FakeSocket.instances[0].say({ message_type: 'auth_error', error: 'bad token' });
        assert.deepEqual(statuses.map((x) => x.source), ['browser']);
        assert.equal(FakeRecognition.made.length, 1);
        assert.equal(FakeRecognition.made[0].started, true);
    });

    test("the interviewer's voice warms the connection, and the candidate's turn starts with it already open", async () => {
        const { s } = await session();
        s.state = 'speaking';
        s.rtCaptions.warm();
        await tick();
        FakeSocket.instances[0].open();
        s.startListening();
        await tick();
        assert.equal(FakeSocket.instances.length, 1, 'no second connection');
    });

    test("each chunk of the interviewer's reply announces its words and its audio duration when it starts playing", async () => {
        class FakeAudio {
            constructor() { this.readyState = 1; this.duration = 2.5; this.listeners = {}; }
            addEventListener(name, fn) { this.listeners[name] = fn; }
            play() { return Promise.resolve(); }
            pause() {}
        }
        globalThis.Audio = FakeAudio;
        try {
            const { s, captions } = await session();
            s.ctx = { createMediaElementSource() { throw new Error('no analyser in a test'); } };
            const playing = s.play(new Blob(['x']), { prefix: 'Interesting.', text: 'How did you test it?' });
            const assistant = captions.find((c) => c.role === 'assistant');
            assert.deepEqual({ prefix: assistant.prefix, text: assistant.text, durationMs: assistant.durationMs },
                { prefix: 'Interesting.', text: 'How did you test it?', durationMs: 2500 });
            s.player.onended();
            await playing;
        } finally { delete globalThis.Audio; }
    });
});

describe('the interview screen and the API', () => {
    const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

    test('the screen shows both sides live and adds the interviewer line to the transcript only after it was spoken', () => {
        const page = read('./src/pages/roleready/RoleReadyAssessment.jsx');
        const bubbles = read('./src/components/interview/LiveCaptionBubbles.jsx');
        assert.ok(page.includes("voice.on('caption'") && page.includes("caption?.role === 'assistant'"));
        assert.ok(page.includes('<AiLiveCaption caption={aiCaption} />') && page.includes('<UserLiveCaption'));
        assert.ok(page.includes('pendingAiRef.current.push(msg.transcript)'), 'the finished interviewer line waits for the speech to end');
        const speechEnd = page.slice(page.indexOf("voice.on('speech-end'"), page.indexOf("voice.on('volume-level'"));
        assert.ok(speechEnd.includes('flushInterviewerLines()'));
        assert.ok(bubbles.includes('data-testid="live-caption"') && bubbles.includes('data-testid="ai-live-caption"'));
        assert.ok(bubbles.includes("processing ? 'You · processing your answer…' : 'You · speaking'"));
        assert.ok(page.includes('captionSession: api.voiceCaptionSession'));
    });

    test('only the student adapter asks our backend for a caption connection, and no key is handled in the browser', () => {
        const adapter = read('./src/services/assessmentApi.js');
        const client = read('./src/services/rolereadyApi.js');
        assert.ok(adapter.includes('voiceCaptionSession: () => rolereadyApi.voiceCaptionSession(sessionUuid)'));
        assert.ok(adapter.slice(adapter.indexOf("kind: 'recruitment'")).includes('voiceCaptionSession: () => candidateApi.voiceCaptionSession(need())'), 'shared-link candidates get the same live captions');
        assert.ok(client.includes('/voice-caption-token'));
        const live = read('./src/utils/liveCaptions.js');
        assert.ok(!/xi-api-key|ELEVENLABS_API_KEY/i.test(live), 'the browser never sees the API key');
    });
});
