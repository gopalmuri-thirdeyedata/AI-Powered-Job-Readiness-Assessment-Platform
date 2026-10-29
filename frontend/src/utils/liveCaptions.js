// Live captions for the voice interview. The browser streams the microphone (16 kHz, 16-bit mono) to ElevenLabs' realtime speech-to-text
// over a websocket and reports the words as they are recognised, so the candidate sees them while still speaking.
// The API key never reaches the browser: the connection URL carries a single-use token minted by our backend.
// Captions are for display only. The answer that is scored is transcribed on the server from the uploaded recording.

export const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 2048;                 // samples per audio callback (about 128 ms at 16 kHz)
const MAX_BUFFERED_FRAMES = 60;          // audio captured while the connection is still opening is kept (about 8 s) and sent when it opens
const MAX_RECONNECTS = 2;
const FATAL_MESSAGES = new Set(['auth_error', 'quota_exceeded', 'unaccepted_terms', 'rate_limited', 'resource_exhausted', 'invalid_request', 'input_error']);

/** Float samples (-1..1) at `inRate` -> 16-bit little-endian PCM at `outRate` (linear resampling when the rates differ). */
export const toPcm16 = (samples, inRate = TARGET_SAMPLE_RATE, outRate = TARGET_SAMPLE_RATE) => {
    const ratio = inRate / outRate;
    const length = ratio === 1 ? samples.length : Math.floor(samples.length / ratio);
    const out = new Int16Array(length);
    for (let i = 0; i < length; i += 1) {
        let value;
        if (ratio === 1) {
            value = samples[i];
        } else {
            const position = i * ratio;
            const lo = Math.floor(position);
            const hi = Math.min(lo + 1, samples.length - 1);
            value = samples[lo] + (samples[hi] - samples[lo]) * (position - lo);
        }
        const clamped = Math.max(-1, Math.min(1, value));
        out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return out;
};

export const pcmToBase64 = (pcm) => {
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
};

const join = (a, b) => `${a} ${b}`.trim();

/**
 * Streams the microphone to the realtime service while an answer is being given and reports the words so far.
 *
 *   getSession()   -> Promise<{ url }>   asks our backend for a single-use connection URL
 *   onCaption(text)                      everything recognised since start() (finished segments + the one still being recognised)
 *   onFatal(reason)                      captions cannot work (no token, refused, repeated failures): the caller falls back
 *
 * Lifecycle per answer: warm() while the interviewer speaks (the connection is ready), start() when listening begins, stop() when the answer ends.
 */
export class RealtimeCaptions {
    constructor({ getSession, onCaption, onFatal, WebSocketImpl, AudioContextImpl } = {}) {
        this.getSession = getSession;
        this.onCaption = onCaption || (() => {});
        this.onFatal = onFatal || (() => {});
        this.WebSocketImpl = WebSocketImpl || globalThis.WebSocket;
        this.AudioContextImpl = AudioContextImpl || globalThis.AudioContext || globalThis.webkitAudioContext;
        this.socket = null;
        this.connecting = null;
        this.opened = false;
        this.active = false;
        this.failed = false;
        this.reconnects = 0;
        this.base = '';
        this.current = '';
        this.pending = [];
        this.ctx = null;
        this.source = null;
        this.processor = null;
        this.mute = null;
    }

    get available() {
        return !this.failed && typeof this.getSession === 'function' && !!this.WebSocketImpl && !!this.AudioContextImpl;
    }

    // ── microphone ───────────────────────────────────────────────────────────────
    /** Connects (or reconnects, after the microphone was changed) the capture of `stream`. */
    attach(stream) {
        if (!this.available || !stream) return;
        try {
            this.detach();
            if (!this.ctx) {
                try { this.ctx = new this.AudioContextImpl({ sampleRate: TARGET_SAMPLE_RATE }); } catch { this.ctx = new this.AudioContextImpl(); }
            }
            if (this.ctx.state === 'suspended') this.ctx.resume?.();
            this.source = this.ctx.createMediaStreamSource(stream);
            this.processor = this.ctx.createScriptProcessor(FRAME_SIZE, 1, 1);
            this.processor.onaudioprocess = (event) => this.onAudio(event.inputBuffer.getChannelData(0));
            this.mute = this.ctx.createGain();
            this.mute.gain.value = 0;                       // the processor must be connected to run; nothing is played
            this.source.connect(this.processor);
            this.processor.connect(this.mute);
            this.mute.connect(this.ctx.destination);
        } catch (err) {
            this.fail(`capture: ${err?.message || err}`);
        }
    }

    detach() {
        try { this.processor && (this.processor.onaudioprocess = null); } catch { /* ignore */ }
        for (const node of [this.source, this.processor, this.mute]) { try { node?.disconnect(); } catch { /* ignore */ } }
        this.source = this.processor = this.mute = null;
    }

    onAudio(samples) {
        if (!this.active || this.failed) return;
        const frame = pcmToBase64(toPcm16(samples, this.ctx?.sampleRate || TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE));
        if (this.socket && this.opened) {
            this.send(frame);
        } else {
            this.pending.push(frame);
            if (this.pending.length > MAX_BUFFERED_FRAMES) this.pending.shift();
        }
    }

    send(frame) {
        try {
            this.socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: frame, commit: false, sample_rate: TARGET_SAMPLE_RATE }));
        } catch { /* the close handler deals with a broken connection */ }
    }

    // ── connection ───────────────────────────────────────────────────────────────
    /** Opens the connection ahead of time (while the interviewer is speaking) so the first words are not delayed. */
    warm() {
        if (this.available) this.ensureSocket().catch(() => {});
    }

    ensureSocket() {
        if (this.socket && (this.opened || this.connecting)) return this.connecting || Promise.resolve();
        this.opened = false;
        this.connecting = (async () => {
            let session;
            try { session = await this.getSession(); } catch (err) { throw new Error(`token: ${err?.message || err}`); }
            if (!session?.url) throw new Error('token: no connection URL');
            await new Promise((resolve, reject) => {
                const socket = new this.WebSocketImpl(session.url);
                this.socket = socket;
                socket.onopen = () => {
                    if (this.socket !== socket) return;
                    this.opened = true;
                    for (const frame of this.pending.splice(0)) this.send(frame);      // what was captured while connecting
                    resolve();
                };
                socket.onmessage = (event) => { if (this.socket === socket) this.onMessage(event.data); };
                socket.onerror = () => { if (this.socket === socket && !this.opened) reject(new Error('connection failed')); };
                socket.onclose = () => {
                    if (this.socket !== socket) return;
                    this.socket = null;
                    const wasOpen = this.opened;
                    this.opened = false;
                    if (!wasOpen) reject(new Error('connection closed'));
                    else if (this.active && !this.failed) this.recover('connection dropped');
                };
            });
        })().then(() => { this.connecting = null; }, (err) => {
            this.connecting = null;
            this.socket = null;
            if (this.active) this.recover(err.message); else this.reconnects = 0;
            throw err;
        });
        return this.connecting;
    }

    recover(reason) {
        if (this.failed) return;
        if (this.reconnects >= MAX_RECONNECTS) { this.fail(reason); return; }
        this.reconnects += 1;
        this.ensureSocket().catch(() => {});
    }

    onMessage(raw) {
        if (!this.active) return;                           // late words from an answer that is already over
        let message;
        try { message = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch { return; }
        const kind = message?.message_type;
        if (kind === 'partial_transcript') {
            this.current = message.text || '';
            this.onCaption(join(this.base, this.current));
        } else if (kind === 'committed_transcript') {
            this.base = join(this.base, message.text || '');
            this.current = '';
            this.onCaption(this.base);
        } else if (FATAL_MESSAGES.has(kind)) {
            this.fail(`${kind}: ${message.error || ''}`);
        }
    }

    // ── per answer ───────────────────────────────────────────────────────────────
    start() {
        if (!this.available) return;
        this.base = '';
        this.current = '';
        this.pending = [];
        this.reconnects = 0;
        this.active = true;
        if (this.ctx?.state === 'suspended') this.ctx.resume?.();
        this.ensureSocket().catch(() => {});
    }

    /** The answer is over: stop sending audio and drop the connection (the next answer opens a fresh one, so nothing leaks across). */
    stop() {
        if (!this.active) return;                           // between answers the warmed connection is kept for the next one
        this.active = false;
        this.pending = [];
        this.closeSocket();
    }

    closeSocket() {
        const socket = this.socket;
        this.socket = null;
        this.opened = false;
        this.connecting = null;
        try { socket?.close(); } catch { /* ignore */ }
    }

    fail(reason) {
        if (this.failed) return;
        this.failed = true;
        this.active = false;
        this.closeSocket();
        this.onFatal(reason);
    }

    close() {
        this.active = false;
        this.closeSocket();
        this.detach();
        try { this.ctx?.close(); } catch { /* ignore */ }
        this.ctx = null;
    }
}

// ── word-by-word display ─────────────────────────────────────────────────────────

/** How many words of `target` to show after another tick: one at a time, catching up faster when far behind, never past the target. */
export const revealStep = (shown, targetCount) => {
    if (shown > targetCount) return targetCount;           // the recogniser revised the text to something shorter
    const behind = targetCount - shown;
    if (behind <= 0) return shown;
    return shown + (behind > 12 ? Math.ceil(behind / 6) : 1);
};

/** The interviewer's words as they are spoken: the earlier chunks in full plus the current chunk spread evenly over its audio duration. */
export const aiRevealedText = (prefix, chunk, elapsedMs, durationMs) => {
    const before = String(prefix || '').split(/\s+/).filter(Boolean);
    const words = String(chunk || '').split(/\s+/).filter(Boolean);
    const total = Math.max(1, Number(durationMs) || words.length * 380);
    const count = Math.min(words.length, Math.max(0, Math.ceil((Math.max(0, elapsedMs) / total) * words.length)));
    return [...before, ...words.slice(0, count)].join(' ');
};
