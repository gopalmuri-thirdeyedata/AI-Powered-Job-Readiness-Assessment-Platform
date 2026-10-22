import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SOUND_THRESHOLD, SILENCE_WARNING_MS, rmsFromTimeDomain, toMeterLevel, isSoundDetected,
    shouldWarnSilence, normalizeInputDevices, resolveDeviceId, describeMicError,
} from './src/utils/micLevel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, 'src', ...p), 'utf-8');

const buffer = (amplitude, size = 1024) => Uint8Array.from({ length: size }, (_, i) => Math.round(128 + amplitude * 127 * Math.sin((2 * Math.PI * i) / 64)));

describe('Microphone level maths', () => {
    test('1. silence measures zero and is not "sound"', () => {
        const silent = new Uint8Array(1024).fill(128);
        assert.equal(rmsFromTimeDomain(silent), 0);
        assert.equal(rmsFromTimeDomain(new Uint8Array(0)), 0);
        assert.equal(rmsFromTimeDomain(null), 0);
        assert.equal(isSoundDetected(0), false);
    });

    test('2. a normal speaking volume is detected, background hiss is not', () => {
        assert.ok(isSoundDetected(rmsFromTimeDomain(buffer(0.2))), 'quiet speech must count as sound');
        assert.ok(isSoundDetected(rmsFromTimeDomain(buffer(0.8))));
        assert.ok(!isSoundDetected(rmsFromTimeDomain(buffer(0.01))), 'faint noise must not count');
        assert.ok(rmsFromTimeDomain(buffer(0.8)) > rmsFromTimeDomain(buffer(0.2)));
    });

    test('3. the meter level always stays between 0 and 1', () => {
        assert.equal(toMeterLevel(0), 0);
        assert.equal(toMeterLevel(5), 1);
        assert.equal(toMeterLevel(-1), 0);
        const mid = toMeterLevel(SOUND_THRESHOLD);
        assert.ok(mid > 0 && mid < 1);
    });
});

describe('"We cannot hear you" warning', () => {
    const now = 1_000_000;

    test('4. never warns before the interviewer has finished a question', () => {
        assert.equal(shouldWarnSilence({ now, lastSoundAt: 0, listeningSince: 0 }), false);
    });

    test('5. warns only after the full silence window has passed', () => {
        const listeningSince = now - SILENCE_WARNING_MS - 500;
        assert.equal(shouldWarnSilence({ now, lastSoundAt: 0, listeningSince }), true);
        assert.equal(shouldWarnSilence({ now, lastSoundAt: 0, listeningSince: now - SILENCE_WARNING_MS + 500 }), false);
    });

    test('6. a recent sound resets the window, and sound heard before the question does not count against them', () => {
        const listeningSince = now - 30_000;
        assert.equal(shouldWarnSilence({ now, lastSoundAt: now - 2000, listeningSince }), false);
        // they spoke 60s ago while the interviewer was talking; the clock starts when the interviewer stopped
        assert.equal(shouldWarnSilence({ now, lastSoundAt: now - 60_000, listeningSince: now - 3000 }), false);
    });
});

describe('Microphone device list', () => {
    const raw = [
        { kind: 'audioinput', deviceId: 'a', label: 'Realtek Microphone' },
        { kind: 'audioinput', deviceId: 'b', label: '' },
        { kind: 'audiooutput', deviceId: 'c', label: 'Speakers' },
        { kind: 'videoinput', deviceId: 'd', label: 'Camera' },
        { kind: 'audioinput', deviceId: '', label: 'No id yet' },
    ];

    test('7. keeps real input devices only and names unnamed ones', () => {
        const list = normalizeInputDevices(raw);
        assert.deepEqual(list.map((d) => d.deviceId), ['a', 'b']);
        assert.equal(list[0].label, 'Realtek Microphone');
        assert.match(list[1].label, /^Microphone \d+$/);
        assert.deepEqual(normalizeInputDevices(undefined), []);
    });

    test('8. a remembered device is used only while it is still plugged in', () => {
        const list = normalizeInputDevices(raw);
        assert.equal(resolveDeviceId(list, 'b'), 'b');
        assert.equal(resolveDeviceId(list, 'unplugged'), '');
        assert.equal(resolveDeviceId(list, ''), '');
    });

    test('9. every failure gets a message that says what to do', () => {
        assert.match(describeMicError({ name: 'NotAllowedError' }), /blocked/i);
        assert.match(describeMicError({ name: 'NotFoundError' }), /plug in/i);
        assert.match(describeMicError({ name: 'NotReadableError' }), /another app/i);
        assert.match(describeMicError(new Error('boom')), /another microphone/i);
        assert.match(describeMicError(null), /another microphone/i);
    });
});

describe('Microphone wiring in the assessment', () => {
    const page = read('pages', 'roleready', 'RoleReadyAssessment.jsx');
    const hook = read('hooks', 'useMicrophone.js');

    test('10. the live level is never React state (it would re-render the whole assessment 60 times a second)', () => {
        assert.ok(hook.includes('subscribeLevel'));
        assert.ok(!/useState\([^)]*level/i.test(hook) && !hook.includes('setLevel'));
        assert.ok(read('components', 'student-ui', 'MicrophonePicker.jsx').includes('subscribeLevel'));
    });

    test('11. the microphone runs in the device check and the interview only', () => {
        assert.ok(page.includes("useMicrophone({ enabled: currentStage === 'device_check' || currentStage === 'interview' })"));
    });

    test('12. the chosen microphone is applied to the live Vapi call and to later changes', () => {
        assert.ok(page.includes('setInputDevicesAsync({ audioDeviceId: target })'));
        const callStart = page.slice(page.indexOf("vapi.on('call-start'"), page.indexOf("vapi.on('speech-start'"));
        assert.ok(callStart.includes('applyMicToCall()'));
        assert.ok(page.includes('onDeviceChange={applyMicToCall}'));
    });

    test('13. silence tracking starts when the interviewer stops speaking and resets when they start', () => {
        const end = page.slice(page.indexOf("vapi.on('speech-end'"), page.indexOf("vapi.on('volume-level'"));
        const start = page.slice(page.indexOf("vapi.on('speech-start'"), page.indexOf("vapi.on('speech-end'"));
        assert.ok(end.includes('listeningSinceRef.current = Date.now()'));
        assert.ok(start.includes('listeningSinceRef.current = 0'));
        assert.ok(page.includes('id="interview-mic-silent"') && page.includes('Choose microphone'));
    });

    test('14. the device check shows a picker and only says "Voice detected" after real sound', () => {
        assert.ok(page.includes('<MicrophonePicker mic={mic} idPrefix="devicecheck-mic" />'));
        assert.ok(page.includes("mic.heardSound ? 'Voice detected ✅'"));
        assert.ok(!page.includes("'Ready for Interview ✅'"), 'permission alone must not claim the mic works');
    });

    test('15. the interview has a microphone settings button', () => {
        assert.ok(page.includes('id="interview-mic-settings-btn"'));
        assert.ok(page.includes('<MicrophonePicker mic={mic} dark compact idPrefix="interview-mic"'));
    });

    test('16. the microphone state is declared after the Vapi state it reads (no use-before-define at render)', () => {
        const order = ['const [vapiCallStatus', 'const [vapiSpeakingState', 'const [vapiIsMuted', 'const vapiRef', 'const mic = useMicrophone']
            .map((marker) => page.indexOf(marker));
        assert.ok(order.every((i) => i > 0), 'all declarations exist');
        assert.deepEqual(order, [...order].sort((a, b) => a - b));
    });

    test('17. the preferred device is remembered and an unplugged one falls back to the default', () => {
        assert.ok(hook.includes('localStorage.setItem(MIC_STORAGE_KEY'));
        assert.ok(hook.includes("err?.name === 'OverconstrainedError'"));
        assert.ok(hook.includes("addEventListener('devicechange'"));
    });
});
