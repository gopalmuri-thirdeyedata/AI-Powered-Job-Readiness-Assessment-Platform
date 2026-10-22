// Pure helpers for the microphone check and the in-interview "we can't hear you" warning.

// Headset microphones are often quiet: speech can measure as low as 0.01 RMS; idle room noise stays below it.
export const SOUND_THRESHOLD = 0.012;
export const SILENCE_WARNING_MS = 12000;
export const MIC_STORAGE_KEY = 'prepwin_mic_device';

/** Root-mean-square loudness (0..1) of a byte time-domain buffer from an AnalyserNode (128 = silence). */
export const rmsFromTimeDomain = (bytes) => {
    if (!bytes || !bytes.length) return 0;
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        const v = (bytes[i] - 128) / 128;
        sum += v * v;
    }
    return Math.sqrt(sum / bytes.length);
};

/**
 * Maps RMS to a 0..1 meter fill on a decibel scale (-55 dB empty, -15 dB full), the way people hear loudness,
 * so quiet headset speech still moves the bars clearly.
 */
export const toMeterLevel = (rms) => {
    if (!(rms > 0)) return 0;
    return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 55) / 40));
};

export const isSoundDetected = (rms) => rms >= SOUND_THRESHOLD;

/**
 * True when the candidate should be told we cannot hear them: nothing loud enough for `thresholdMs`
 * since the later of "last sound heard" and "the interviewer finished speaking".
 */
export const shouldWarnSilence = ({ now, lastSoundAt = 0, listeningSince = 0, thresholdMs = SILENCE_WARNING_MS }) => {
    if (!listeningSince) return false; // the interviewer has not asked anything yet
    return now - Math.max(lastSoundAt, listeningSince) > thresholdMs;
};

/** Keeps only real input devices and gives unnamed ones a readable label. */
export const normalizeInputDevices = (devices = []) => devices
    .filter((d) => d && d.kind === 'audioinput' && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label && d.label.trim() ? d.label : `Microphone ${i + 1}` }));

/** The preferred device if it is still plugged in, otherwise '' (meaning the browser default). */
export const resolveDeviceId = (devices, preferredId) => (
    preferredId && devices.some((d) => d.deviceId === preferredId) ? preferredId : ''
);

export const describeMicError = (err) => {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Microphone access is blocked. Click the lock icon in the address bar, allow the microphone, then reload.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'No microphone was found. Plug in a microphone or headset and pick it below.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'The microphone is in use by another app. Close other apps that use it (Zoom, Teams, Meet) and try again.';
    }
    return 'The microphone could not be started. Try another microphone from the list.';
};
