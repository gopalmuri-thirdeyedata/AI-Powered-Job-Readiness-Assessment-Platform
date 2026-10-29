import { RealtimeCaptions } from './liveCaptions';

// Browser side of the voice interview. It records the candidate, sends each answer to the backend (speech-to-text -> interviewer
// reply -> text-to-speech) and plays the interviewer's voice. It exposes the small event API the interview screens already use:
//   on('call-start' | 'call-end' | 'speech-start' | 'speech-end' | 'processing' | 'volume-level' | 'message' | 'error', handler)
//   start(config) / stop() / setMuted(bool) / setInputDevicesAsync({ audioDeviceId }) / removeAllListeners()
// The turn-taking logic (UtteranceDetector) is pure and framework-free so it can be unit tested without a browser or a microphone.

export const END_SILENCE_MS = 1300;        // pause that ends an answer (short, so the interviewer answers promptly; the longer waits below protect unfinished thoughts)
export const END_SILENCE_FINISHED_MS = 800;      // ... a little less when the last words already read as a finished sentence
export const END_SILENCE_UNFINISHED_MS = 2800;   // ... and longer when the sentence is left hanging ("and", "because", a trailing comma)
export const MIN_SPEECH_MS = 400;          // shorter sounds (a cough, a click) are discarded, not sent
export const MAX_UTTERANCE_MS = 90000;     // an answer is cut here and sent
export const SPEECH_CONFIRM_MS = 90;       // sound must last this long to count as speech
export const PRE_ROLL_RESET_MS = 3000;     // recording while nobody speaks is thrown away this often (keeps uploads small)
export const REPLY_GUARD_MS = 250;         // the mic is ignored briefly after the interviewer stops (room echo)
export const CALIBRATE_MS = 600;           // the first moments of listening teach the detector how noisy the room is
export const NOISE_FLOOR_CAP = 0.02;
export const POLL_MS = 50;
const MIN_THRESHOLD = 0.015;

// Words that cannot end a thought: the candidate is still going.
const HANGING_WORDS = new Set(['and', 'but', 'so', 'because', 'or', 'then', 'which', 'that', 'like', 'um', 'uh', 'umm', 'uhh', 'hmm', 'well', 'actually',
    'basically', 'with', 'to', 'of', 'in', 'on', 'for', 'as', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'if', 'when', 'where', 'while', 'also', 'my', 'we', 'i']);

/** How long a pause must last before the answer counts as finished, judged from the words heard so far (live captions). */
export const endSilenceFor = (text) => {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return END_SILENCE_MS;
    const last = words[words.length - 1];
    const lastWord = last.toLowerCase().replace(/[^a-z']/g, '');
    if (/[,;:…-]$/.test(last) || HANGING_WORDS.has(lastWord)) return END_SILENCE_UNFINISHED_MS;
    if (/[.?!]$/.test(last) && words.length >= 5) return END_SILENCE_FINISHED_MS;
    return END_SILENCE_MS;
};

/** Root-mean-square loudness (0..1) of a block of samples. */
export const rms = (samples) => {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
};

/** Speech must clearly beat the room's background noise, which is learned while nobody is talking. */
export const speechThreshold = (noiseFloor) => Math.max(MIN_THRESHOLD, noiseFloor * 3);

/**
 * Decides when the candidate starts and finishes an answer from a stream of loudness readings.
 * push() returns 'speech-start', 'speech-end' (send it), 'discard' (too short) or null.
 */
export class UtteranceDetector {
    constructor() {
        this.calibStart = null;
        this.calibSum = 0;
        this.calibCount = 0;
        this.calibrated = false;
        this.reset();
    }

    reset() {
        this.speaking = false;
        this.loudSince = null;
        this.speechStartedAt = 0;
        this.lastLoudAt = 0;
        this.noiseFloor = this.noiseFloor || 0.005;
    }

    push(level, now, endSilenceMs = END_SILENCE_MS) {
        if (!this.calibrated) {
            if (this.calibStart === null) this.calibStart = now;
            this.calibSum += level;
            this.calibCount += 1;
            if (now - this.calibStart >= CALIBRATE_MS) {
                this.noiseFloor = Math.min(NOISE_FLOOR_CAP, Math.max(0.002, this.calibSum / this.calibCount));
                this.calibrated = true;
            }
            return null;
        }
        const threshold = speechThreshold(this.noiseFloor);
        if (!this.speaking) {
            if (level > threshold) {
                if (this.loudSince === null) this.loudSince = now;
                if (now - this.loudSince >= SPEECH_CONFIRM_MS) {
                    this.speaking = true;
                    this.speechStartedAt = this.loudSince;
                    this.lastLoudAt = now;
                    return 'speech-start';
                }
            } else {
                this.loudSince = null;
                this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
            }
            return null;
        }
        if (level > threshold * 0.7) this.lastLoudAt = now;      // hysteresis: a dip between words is not a pause
        const forced = now - this.speechStartedAt >= MAX_UTTERANCE_MS;
        if (forced || now - this.lastLoudAt >= endSilenceMs) {
            const spokenMs = this.lastLoudAt - this.speechStartedAt;
            this.speaking = false;
            this.loudSince = null;
            return forced || spokenMs >= MIN_SPEECH_MS ? 'speech-end' : 'discard';
        }
        return null;
    }
}

// Live captions use the browser's own speech recognition (Chrome, Edge, Safari) purely to SHOW the candidate what is being heard while they
// speak. The transcript that counts (and that is scored) is still the server's. Set VITE_LIVE_CAPTIONS=off to disable them.
const getRecognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
const CAPTION_FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'];
const captionsDisabledByEnv = () => {
    try { return String(import.meta.env.VITE_LIVE_CAPTIONS || '').toLowerCase() === 'off'; } catch { return false; }
};

const base64ToBlob = (base64, mime) => {
    const bytes = atob(base64);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) out[i] = bytes.charCodeAt(i);
    return new Blob([out], { type: mime || 'audio/mpeg' });
};

const pickRecorderType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
};

const audioError = (message) => {
    const err = new Error(message);
    err.name = 'VoiceAudioError';
    return err;
};

/** The multipart body of one voice turn (shared by the student and the recruitment candidate API). */
export const buildVoiceTurnForm = ({ blob, history = [], opening = false, hint = '' } = {}) => {
    const form = new FormData();
    if (blob) form.append('audio', blob, 'answer.webm');
    form.append('history', JSON.stringify(history));
    form.append('opening', opening ? 'true' : 'false');
    if (hint) form.append('hint', String(hint).slice(0, 2400));     // the live-caption text (optional)
    return form;
};

export class VoiceInterviewSession {
    /**
     * @param {{ turn: (args: { blob?: Blob, history: Array, opening?: boolean }) => Promise<object>, audioDeviceId?: string,
     *           turnStream?: (args: { blob: Blob, history: Array }, options: { signal: AbortSignal }) => AsyncIterable<object> }} options
     * `turnStream` is optional: when given, the interviewer's reply is spoken chunk by chunk as it arrives; if it fails before
     * anything was heard, the plain `turn` request is used instead.
     */
    constructor({ turn, turnStream, audioDeviceId, captions = true, captionLang = 'en-IN', captionSession } = {}) {
        this.turn = turn;
        this.captionsEnabled = captions !== false && !captionsDisabledByEnv();
        this.captionLang = captionLang;
        this.captionRec = null;
        this.captionTimer = null;
        this.captionBase = '';
        this.captionCurrent = '';
        // Primary live captions: the microphone streamed to the realtime speech service (needs `captionSession`, which asks our backend for a
        // single-use connection). If that is unavailable or fails, the browser's own recogniser below takes over.
        this.rtCaptions = captionSession && this.captionsEnabled
            ? new RealtimeCaptions({
                getSession: captionSession,
                onCaption: (text) => this.emit('caption', { role: 'user', text }),
                onFatal: (reason) => this.captionFallback(reason),
            })
            : null;
        this.turnStream = turnStream || null;
        this.abortController = null;
        this.audioDeviceId = audioDeviceId || null;
        this.listeners = {};
        this.closed = false;
        this.muted = false;
        this.state = 'idle';           // idle | speaking (the interviewer) | listening | processing
        this.history = [];
        this.detector = new UtteranceDetector();
        this.chunks = [];
        this.recorder = null;
        this.recorderStartedAt = 0;
        this.stream = null;
        this.ctx = null;
        this.micAnalyser = null;
        this.micBuffer = null;
        this.poll = null;
        this.maxTimer = null;
        this.player = null;
        this.volumeTimer = null;
        this.lastActivityAt = Date.now();
        this.silenceTimeoutMs = 180000;
    }

    on(event, handler) {
        (this.listeners[event] = this.listeners[event] || []).push(handler);
        return this;
    }

    removeAllListeners() { this.listeners = {}; }

    emit(event, payload) {
        if (event === 'caption' && payload?.role === 'user') this.lastUserCaption = String(payload.text || '');      // sent with the recording so the reply can start early
        if (event === 'caption' && payload?.role === 'user') this.userCaptionText = payload.text || '';      // the words heard so far decide how long to wait
        for (const handler of this.listeners[event] || []) {
            try { handler(payload); } catch (e) { console.error(`[voice] ${event} handler failed`, e); }
        }
    }

    fail(err) {
        if (this.closed) return;
        this.cleanup();
        this.emit('error', err);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────────
    async start(config = {}) {
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error('mediaDevices is undefined: a secure context is required');
            this.silenceTimeoutMs = Math.max(1, Number(config.silenceTimeoutSeconds) || 180) * 1000;
            await this.openMic();
            if (this.closed) return;
            const opening = await this.requestTurn({ opening: true });
            if (this.closed) return;
            this.emit('call-start');
            const seconds = Math.max(1, Number(config.maxDurationSeconds) || 1200);
            this.maxTimer = setTimeout(() => this.finish(), seconds * 1000);     // the call never outlives the server deadline
            this.poll = setInterval(() => this.tick(), POLL_MS);
            await this.say(opening);
        } catch (err) {
            this.fail(err);
        }
    }

    stop() {
        if (this.closed) return;
        this.finish();
    }

    finish() {
        if (this.closed) return;
        this.cleanup();
        this.emit('call-end');
    }

    cleanup() {
        this.closed = true;
        try { this.abortController?.abort(); } catch { /* ignore */ }
        this.stopCaptions({ clear: true });
        this.rtCaptions?.close();
        clearInterval(this.poll);
        clearTimeout(this.maxTimer);
        clearInterval(this.volumeTimer);
        try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* already stopped */ }
        try { this.player?.pause(); } catch { /* ignore */ }
        try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        try { this.ctx?.close(); } catch { /* ignore */ }
    }

    // ── Microphone ───────────────────────────────────────────────────────────────
    async openMic() {
        this.stream?.getTracks().forEach((t) => t.stop());
        const constraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        if (this.audioDeviceId) constraints.deviceId = { exact: this.audioDeviceId };
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        this.stream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!this.ctx) this.ctx = new AudioCtx();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this.micAnalyser = this.ctx.createAnalyser();
        this.micAnalyser.fftSize = 1024;
        this.ctx.createMediaStreamSource(this.stream).connect(this.micAnalyser);
        this.micBuffer = new Float32Array(this.micAnalyser.fftSize);
        this.rtCaptions?.attach(this.stream);             // (re)connect the live-caption capture to this microphone
    }

    async setInputDevicesAsync({ audioDeviceId } = {}) {
        this.audioDeviceId = audioDeviceId || null;
        if (this.closed) return;
        await this.openMic();
        if (this.state === 'listening') this.beginRecording();
    }

    setMuted(muted) {
        this.muted = !!muted;
        this.stream?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
        this.detector.reset();
        if (this.muted) this.stopCaptions({ clear: true });
        else if (this.state === 'listening') this.startCaptions();
    }

    // ── Recording ────────────────────────────────────────────────────────────────
    beginRecording() {
        try { if (this.recorder && this.recorder.state !== 'inactive') { this.recorder.onstop = null; this.recorder.stop(); } } catch { /* ignore */ }
        this.chunks = [];
        const type = pickRecorderType();
        const recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
        recorder.start();
        this.recorder = recorder;
        this.recorderStartedAt = Date.now();
    }

    endRecording() {
        return new Promise((resolve) => {
            const recorder = this.recorder;
            if (!recorder || recorder.state === 'inactive') { resolve(null); return; }
            recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
            recorder.stop();
        });
    }

    micLevel() {
        if (!this.micAnalyser) return 0;
        this.micAnalyser.getFloatTimeDomainData(this.micBuffer);
        return rms(this.micBuffer);
    }

    // ── Live captions ────────────────────────────────────────────────────────────
    // Emits 'caption' { role: 'user', text } with everything heard since the candidate started this answer ('' clears it).
    startCaptions() {
        if (!this.captionsEnabled || this.closed || this.muted) return;
        if (this.rtCaptions?.available) { this.rtCaptions.start(); return; }
        const Recognition = getRecognition();
        if (!this.captionsEnabled || !Recognition || this.captionRec || this.closed || this.muted) return;
        const rec = new Recognition();
        rec.lang = this.captionLang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onresult = (event) => {
            let text = '';
            for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0]?.transcript || '';
            this.captionCurrent = text;                                   // finished words and the ones still being recognised
            this.emit('caption', { role: 'user', text: `${this.captionBase} ${this.captionCurrent}`.trim() });
        };
        rec.onerror = (event) => {
            if (CAPTION_FATAL_ERRORS.includes(event?.error)) {            // no permission / no service: captions are simply not available
                this.captionsEnabled = false;
                this.stopCaptions({ clear: true });
                this.emit('caption-status', { available: false, reason: event.error });
            }                                                             // 'no-speech' / 'aborted' / network blips: onend restarts it
        };
        rec.onend = () => {
            this.captionRec = null;
            this.captionBase = `${this.captionBase} ${this.captionCurrent}`.trim();      // browsers stop after a pause: keep what was heard
            this.captionCurrent = '';
            if (this.state === 'listening' && !this.closed && this.captionsEnabled && !this.muted) {
                this.captionTimer = setTimeout(() => this.startCaptions(), 150);
            }
        };
        try { rec.start(); this.captionRec = rec; } catch { this.captionRec = null; }
    }

    stopCaptions({ clear = false } = {}) {
        this.rtCaptions?.stop();
        clearTimeout(this.captionTimer);
        const rec = this.captionRec;
        this.captionRec = null;
        if (rec) {
            rec.onend = null; rec.onresult = null; rec.onerror = null;
            try { rec.stop(); } catch { /* not started */ }
        }
        if (clear) {
            this.captionBase = '';
            this.captionCurrent = '';
            this.emit('caption', { role: 'user', text: '' });
        }
    }

    /** A new answer starts from a blank caption. */
    resetCaptions() {
        if (this.rtCaptions?.available) {
            // keep the (already warmed) connection: only the text restarts
            this.captionBase = '';
            this.captionCurrent = '';
            this.emit('caption', { role: 'user', text: '' });
            this.startCaptions();
            return;
        }
        this.stopCaptions({ clear: true });
        if (this.state === 'listening') this.startCaptions();
    }

    /** The realtime captions cannot work (no token, refused, repeated failures): continue with the browser's own recogniser. */
    captionFallback(reason) {
        this.emit('caption-status', { available: true, source: 'browser', reason });
        if (this.state === 'listening' && !this.closed) this.startCaptions();
    }

    // ── Turn taking ──────────────────────────────────────────────────────────────
    startListening() {
        this.state = 'listening';
        this.detector.reset();
        this.lastActivityAt = Date.now();
        this.beginRecording();
        this.resetCaptions();
        this.emit('listening');           // the microphone is open for the candidate's answer
    }

    tick() {
        if (this.closed || this.state !== 'listening') return;
        const now = Date.now();
        if (now - this.lastActivityAt > this.silenceTimeoutMs) { this.finish(); return; }
        if (this.muted) return;
        const level = this.micLevel();
        this.emit('mic-level', Math.min(1, level * 6));        // drives the "you are being heard" animation
        const event = this.detector.push(level, now, endSilenceFor(this.userCaptionText));
        if (event === 'speech-start') {
            this.lastActivityAt = now;
            this.emit('user-speech', true);
        } else if (event === 'speech-end') {
            this.emit('user-speech', false);
            this.answerGiven();
        } else if (event === 'discard' || (!this.detector.speaking && now - this.recorderStartedAt > PRE_ROLL_RESET_MS)) {
            if (event === 'discard') { this.emit('user-speech', false); this.resetCaptions(); }       // a cough or click is not an answer: do not leave its caption on screen
            this.beginRecording();       // nothing worth sending: start a fresh recording so silence is never uploaded
        }
    }

    async answerGiven() {
        const hint = (this.lastUserCaption || '').trim();             // what the live captions heard: the server only uses it if its own transcript agrees
        this.state = 'processing';
        this.stopCaptions();             // the caption stays on screen until the server's transcript replaces it
        this.emit('processing');
        try {
            const blob = await this.endRecording();
            if (this.closed) return;
            if (this.turnStream && blob && blob.size && await this.streamAnswer(blob, hint)) return;
            const result = blob && blob.size ? await this.requestTurn({ blob, history: this.history }) : null;
            if (this.closed) return;
            if (!result || !result.user_text) { this.startListening(); return; }      // no speech recognised: keep listening
            this.history.push({ role: 'user', text: result.user_text });
            this.emit('message', { type: 'transcript', transcriptType: 'final', role: 'user', transcript: result.user_text });
            await this.say(result);
        } catch (err) {
            this.fail(err);
        }
    }

    /**
     * Streaming exchange: the first spoken chunk plays while the rest of the reply is still being produced.
     * @returns {Promise<boolean>} true when the turn was handled here; false when the stream failed before anything was heard,
     *   so the caller can repeat the exchange with the plain request (nothing was recorded twice).
     */
    async streamAnswer(blob, hint = '') {
        const sentAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.lastTurnTiming = {};            // how long the candidate really waited (answer sent -> first words of the reply arrive); shown in the console only
        let heard = false;
        let spoke = false;
        let spokenSoFar = '';
        let playback = Promise.resolve();
        this.abortController = typeof AbortController === 'undefined' ? null : new AbortController();
        try {
            for await (const event of this.turnStream({ blob, history: this.history, hint }, { signal: this.abortController?.signal })) {
                if (this.closed) return true;
                if (event.type === 'transcript') {
                    if (!event.user_text) { this.startListening(); return true; }       // no speech recognised: keep listening
                    heard = true;
                    this.history.push({ role: 'user', text: event.user_text });
                    this.emit('message', { type: 'transcript', transcriptType: 'final', role: 'user', transcript: event.user_text });
                } else if (event.type === 'audio') {
                    if (!spoke) {
                        spoke = true;
                        this.lastTurnTiming.first_audio_wait_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - sentAt);
                        this.state = 'speaking';
                        this.stopCaptions({ clear: true });
                        this.rtCaptions?.warm();
                        this.lastActivityAt = Date.now();
                        this.emit('speech-start');
                    }
                    const chunk = base64ToBlob(event.audio_base64, event.mime);
                    const caption = { prefix: spokenSoFar, text: event.text || '' };
                    spokenSoFar = `${spokenSoFar} ${event.text || ''}`.trim();
                    playback = playback.then(() => (this.closed ? undefined : this.play(chunk, caption)));
                    playback.catch(() => {});       // surfaced below when awaited; never an unhandled rejection meanwhile
                } else if (event.type === 'done') {
                    this.lastTurnTiming.server = event.timings;
                    try { console.debug('[voice] turn timing', this.lastTurnTiming); } catch { /* no console */ }
                    if (event.reply_text) {
                        this.history.push({ role: 'ai', text: event.reply_text, ...(Number.isInteger(event.question_no) ? { q: event.question_no } : {}) });
                        this.emit('message', { type: 'transcript', transcriptType: 'final', role: 'assistant', transcript: event.reply_text, questionNo: Number.isInteger(event.question_no) ? event.question_no : undefined });
                    }
                } else if (event.type === 'error') {
                    const err = new Error(event.message || 'The interviewer is unavailable right now.');
                    err.response = { status: event.status };
                    throw err;
                }
            }
        } catch (err) {
            if (this.closed) return true;
            if (!heard) return false;       // nothing consumed or recorded yet: safe to repeat with the plain request
            throw err;
        }
        await playback;
        if (this.closed) return true;
        if (!spoke) { this.startListening(); return true; }
        this.emit('speech-end');
        await new Promise((resolve) => setTimeout(resolve, REPLY_GUARD_MS));
        if (!this.closed) this.startListening();
        return true;
    }

    /** One backend exchange; a single automatic retry hides a momentary network or provider hiccup. */
    async requestTurn(args) {
        try {
            return await this.turn({ history: this.history, ...args });
        } catch (first) {
            const status = first?.response?.status;
            if (this.closed || (status && status >= 400 && status < 500 && status !== 429)) throw first;       // the server refused: retrying cannot help
            await new Promise((resolve) => setTimeout(resolve, 800));
            return this.turn({ history: this.history, ...args });
        }
    }

    // ── The interviewer's voice ──────────────────────────────────────────────────
    async say(result) {
        if (this.closed || !result?.audio_base64) { if (!this.closed) this.startListening(); return; }
        this.state = 'speaking';
        this.stopCaptions({ clear: true });
        this.rtCaptions?.warm();                  // ready before the candidate's turn: the first words are not delayed
        this.lastActivityAt = Date.now();
        const text = result.reply_text || '';
        this.history.push({ role: 'ai', text, ...(Number.isInteger(result.question_no) ? { q: result.question_no } : {}) });
        this.emit('speech-start');
        this.emit('message', { type: 'transcript', transcriptType: 'final', role: 'assistant', transcript: text, questionNo: Number.isInteger(result.question_no) ? result.question_no : undefined });
        await this.play(base64ToBlob(result.audio_base64, result.mime), { prefix: '', text });
        if (this.closed) return;
        this.emit('speech-end');
        await new Promise((resolve) => setTimeout(resolve, REPLY_GUARD_MS));
        if (!this.closed) this.startListening();
    }

    play(blob, caption) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const player = new Audio(url);
            this.player = player;
            if (caption?.text) {
                // The words follow the voice: the earlier chunks in full, this chunk spread over its audio duration
                const announce = () => this.emit('caption', {
                    role: 'assistant', prefix: caption.prefix || '', text: caption.text,
                    durationMs: Number.isFinite(player.duration) && player.duration > 0 ? player.duration * 1000 : null,
                });
                if (player.readyState >= 1) announce(); else player.addEventListener('loadedmetadata', announce, { once: true });
            }
            const done = () => { clearInterval(this.volumeTimer); URL.revokeObjectURL(url); this.emit('volume-level', 0); };
            player.onended = () => { done(); resolve(); };
            player.onerror = () => { done(); reject(audioError('Interviewer audio could not be played. Choose Retry Connection.')); };
            try {
                const source = this.ctx.createMediaElementSource(player);
                const analyser = this.ctx.createAnalyser();
                analyser.fftSize = 512;
                source.connect(analyser);
                analyser.connect(this.ctx.destination);
                const buffer = new Float32Array(analyser.fftSize);
                this.volumeTimer = setInterval(() => {
                    analyser.getFloatTimeDomainData(buffer);
                    this.emit('volume-level', Math.min(1, rms(buffer) * 4));
                }, POLL_MS);
            } catch { /* volume animation is cosmetic: play without it */ }
            player.play().catch(() => { done(); reject(audioError('Interviewer audio could not start. Choose Retry Connection.')); });
        });
    }
}
