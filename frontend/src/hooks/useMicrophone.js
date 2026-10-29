import { useCallback, useEffect, useRef, useState } from 'react';
import {
    MIC_STORAGE_KEY, describeMicError, isSoundDetected, normalizeInputDevices, rmsFromTimeDomain, toMeterLevel,
} from '../utils/micLevel';

const readPreferred = () => {
    try { return localStorage.getItem(MIC_STORAGE_KEY) || ''; } catch { return ''; }
};
const writePreferred = (id) => {
    try {
        if (id) localStorage.setItem(MIC_STORAGE_KEY, id);
        else localStorage.removeItem(MIC_STORAGE_KEY);
    } catch { /* storage unavailable */ }
};

/**
 * Opens the chosen microphone, measures its loudness and lists the available inputs.
 *
 * The loudness changes ~60 times a second, so it is NOT React state (that would re-render the whole
 * assessment page). Components read it through subscribeLevel(); `heardSound` flips once and is state.
 */
export default function useMicrophone({ enabled = true } = {}) {
    const [devices, setDevices] = useState([]);
    const [deviceId, setDeviceId] = useState(() => readPreferred());
    const [status, setStatus] = useState('idle'); // idle | starting | listening | denied | unavailable | error
    const [error, setError] = useState(null);
    const [heardSound, setHeardSound] = useState(false);

    const streamRef = useRef(null);
    const ctxRef = useRef(null);
    const rafRef = useRef(0);
    const listenersRef = useRef(new Set());
    const lastSoundAtRef = useRef(0);
    const heardRef = useRef(false);
    const deviceIdRef = useRef(deviceId);
    const startTokenRef = useRef(0);
    deviceIdRef.current = deviceId;

    const subscribeLevel = useCallback((fn) => {
        listenersRef.current.add(fn);
        return () => listenersRef.current.delete(fn);
    }, []);

    const refreshDevices = useCallback(async () => {
        try {
            const list = normalizeInputDevices(await navigator.mediaDevices.enumerateDevices());
            setDevices(list);
            return list;
        } catch {
            return [];
        }
    }, []);

    const stop = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        if (streamRef.current) {
            try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
            streamRef.current = null;
        }
        if (ctxRef.current) {
            try { ctxRef.current.close(); } catch { /* already closed */ }
            ctxRef.current = null;
        }
    }, []);

    const start = useCallback(async (wantedId) => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus('unavailable');
            setError('This browser cannot access a microphone.');
            return;
        }
        stop();
        const token = ++startTokenRef.current;
        setStatus('starting');
        setError(null);

        const open = (id) => navigator.mediaDevices.getUserMedia({
            audio: {
                ...(id ? { deviceId: { exact: id } } : {}),
                // Noise suppression can swallow quiet speech from headset microphones, so the level check
                // hears the raw signal; automatic gain keeps a low input volume usable.
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });

        try {
            let stream;
            try {
                stream = await open(wantedId);
            } catch (err) {
                // The remembered microphone was unplugged: fall back to the browser default
                if (wantedId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
                    stream = await open('');
                } else {
                    throw err;
                }
            }
            if (token !== startTokenRef.current) { // a newer start() replaced this one
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            streamRef.current = stream;

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioCtx();
            if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
            ctxRef.current = ctx;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            ctx.createMediaStreamSource(stream).connect(analyser);
            const buffer = new Uint8Array(analyser.fftSize);

            lastSoundAtRef.current = Date.now();
            const tick = () => {
                analyser.getByteTimeDomainData(buffer);
                const rms = rmsFromTimeDomain(buffer);
                if (isSoundDetected(rms)) {
                    lastSoundAtRef.current = Date.now();
                    if (!heardRef.current) {
                        heardRef.current = true;
                        setHeardSound(true);
                    }
                }
                const level = toMeterLevel(rms);
                listenersRef.current.forEach((fn) => fn(level));
                rafRef.current = requestAnimationFrame(tick);
            };
            tick();

            const actualId = stream.getAudioTracks()[0]?.getSettings?.().deviceId || '';
            await refreshDevices(); // device labels are only available once access is granted
            setDeviceId(actualId || wantedId || '');
            setStatus('listening');
        } catch (err) {
            if (token !== startTokenRef.current) return;
            const name = err?.name || '';
            setStatus(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied'
                : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'unavailable' : 'error');
            setError(describeMicError(err));
        }
    }, [refreshDevices, stop]);

    const selectDevice = useCallback((id) => {
        writePreferred(id);
        setDeviceId(id);
        heardRef.current = false;
        setHeardSound(false);
        start(id);
    }, [start]);

    const restart = useCallback(() => {
        heardRef.current = false;
        setHeardSound(false);
        start(deviceIdRef.current);
    }, [start]);

    useEffect(() => {
        if (!enabled) {
            stop();
            setStatus('idle');
            return undefined;
        }
        start(deviceIdRef.current);
        return () => { startTokenRef.current += 1; stop(); };
    }, [enabled, start, stop]);

    // Headsets plugged in or removed while the page is open
    useEffect(() => {
        const md = navigator.mediaDevices;
        if (!md?.addEventListener) return undefined;
        const onChange = () => { refreshDevices(); };
        md.addEventListener('devicechange', onChange);
        return () => md.removeEventListener('devicechange', onChange);
    }, [refreshDevices]);

    return {
        devices, deviceId, status, error, heardSound,
        selectDevice, restart, subscribeLevel, lastSoundAtRef,
    };
}
