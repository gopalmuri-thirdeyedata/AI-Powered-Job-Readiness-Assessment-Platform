// Browser side of the voice interview. It records the candidate, sends each answer to the backend (speech-to-text -> interviewer
// reply -> text-to-speech) and plays the interviewer's voice. It exposes the small event API the interview screens already use:
//   on('call-start' | 'call-end' | 'speech-start' | 'speech-end' | 'processing' | 'volume-level' | 'message' | 'error', handler)
//   start(config) / stop() / setMuted(bool) / setInputDevicesAsync({ audioDeviceId }) / removeAllListeners()
// The turn-taking logic (UtteranceDetector) is pure and framework-free so it can be unit tested without a browser or a microphone.

export const END_SILENCE_MS = 1800;        // pause that ends an answer: lets the candidate think mid-answer without being cut off
export const MIN_SPEECH_MS = 400;          // shorter sounds (a cough, a click) are discarded, not sent
export const MAX_UTTERANCE_MS = 90000;     // an answer is cut here and sent
export const SPEECH_CONFIRM_MS = 120;      // sound must last this long to count as speech
export const PRE_ROLL_RESET_MS = 3000;     // recording while nobody speaks is thrown away this often (keeps uploads small)
export const REPLY_GUARD_MS = 350;         // the mic is ignored briefly after the interviewer stops (room echo)
export const CALIBRATE_MS = 600;           // the first moments of listening teach the detector how noisy the room is
export const NOISE_FLOOR_CAP = 0.02;
export const POLL_MS = 50;
const MIN_THRESHOLD = 0.015;

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

    push(level, now) {
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
        if (forced || now - this.lastLoudAt >= END_SILENCE_MS) {
            const spokenMs = this.lastLoudAt - this.speechStartedAt;
            this.speaking = false;
            this.loudSince = null;
            return forced || spokenMs >= MIN_SPEECH_MS ? 'speech-end' : 'discard';
        }
        return null;
    }
}

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
export const buildVoiceTurnForm = ({ blob, history = [], opening = false } = {}) => {
    const form = new FormData();
    if (blob) form.append('audio', blob, 'answer.webm');
    form.append('history', JSON.stringify(history));
    form.append('opening', opening ? 'true' : 'false');
    return form;
};

export class VoiceInterviewSession {
    /** @param {{ turn: (args: { blob?: Blob, history: Array, opening?: boolean }) => Promise<object>, audioDeviceId?: string }} options */
    constructor({ turn, audioDeviceId } = {}) {
        this.turn = turn;
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

    // ── Turn taking ──────────────────────────────────────────────────────────────
    startListening() {
        this.state = 'listening';
        this.detector.reset();
        this.lastActivityAt = Date.now();
        this.beginRecording();
    }

    tick() {
        if (this.closed || this.state !== 'listening') return;
        const now = Date.now();
        if (now - this.lastActivityAt > this.silenceTimeoutMs) { this.finish(); return; }
        if (this.muted) return;
        const event = this.detector.push(this.micLevel(), now);
        if (event === 'speech-start') {
            this.lastActivityAt = now;
        } else if (event === 'speech-end') {
            this.answerGiven();
        } else if (event === 'discard' || (!this.detector.speaking && now - this.recorderStartedAt > PRE_ROLL_RESET_MS)) {
            this.beginRecording();       // nothing worth sending: start a fresh recording so silence is never uploaded
        }
    }

    async answerGiven() {
        this.state = 'processing';
        this.emit('processing');
        try {
            const blob = await this.endRecording();
            if (this.closed) return;
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
        this.lastActivityAt = Date.now();
        const text = result.reply_text || '';
        this.history.push({ role: 'ai', text });
        this.emit('speech-start');
        this.emit('message', { type: 'transcript', transcriptType: 'final', role: 'assistant', transcript: text });
        await this.play(base64ToBlob(result.audio_base64, result.mime));
        if (this.closed) return;
        this.emit('speech-end');
        await new Promise((resolve) => setTimeout(resolve, REPLY_GUARD_MS));
        if (!this.closed) this.startListening();
    }

    play(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const player = new Audio(url);
            this.player = player;
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
