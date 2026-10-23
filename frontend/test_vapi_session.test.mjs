// Voice-interview (Vapi) lifecycle: error classification, disposal, submission semantics. No browser, microphone or Vapi
// account is involved: these are unit tests of src/utils/vapiSession.js plus source guards for the shared workspace.
// A passing run proves the handling logic, NOT a live call (see the e2e suite and the release report for live status).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceSrc = fs.readFileSync(path.join(__dirname, 'src/pages/roleready/RoleReadyAssessment.jsx'), 'utf-8');

describe('classifyVapiError', () => {
    test('microphone permission denial, in every shape the browser / Daily / Vapi produce', async () => {
        const { classifyVapiError } = await loadModule('src/utils/vapiSession.js');
        const shapes = [
            Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
            { errorMsg: { errorMsg: 'camera or mic blocked', error: { type: 'permissions', blockedBy: 'user', blockedMedia: ['audio'] } } },
            { error: { type: 'daily-call-join-error', msg: 'mic-blocked' } },
            'NotAllowedError: Permission denied by system',
            { message: 'Requested permission was denied' },
        ];
        for (const err of shapes) {
            const c = classifyVapiError(err);
            assert.equal(c.kind, 'permission', JSON.stringify(err));
            assert.match(c.message, /Microphone access was blocked/);
            assert.match(c.message, /Retry Connection/, 'tells the candidate what to do next');
        }
    });

    test('missing device, busy device, insecure context and network failures each get their own message', async () => {
        const { classifyVapiError } = await loadModule('src/utils/vapiSession.js');
        assert.equal(classifyVapiError(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })).kind, 'no_device');
        assert.equal(classifyVapiError(Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' })).kind, 'device_busy');
        assert.equal(classifyVapiError(new Error('getUserMedia requires a secure context')).kind, 'insecure');
        assert.equal(classifyVapiError(new Error('Failed to fetch')).kind, 'network');
        assert.equal(classifyVapiError({ message: 'ICE connection failed' }).kind, 'network');
    });

    test('an unrecognised error keeps its own message, and nothing yields an empty message', async () => {
        const { classifyVapiError } = await loadModule('src/utils/vapiSession.js');
        assert.equal(classifyVapiError(new Error('Assistant limit reached')).message, 'Assistant limit reached');
        for (const err of [undefined, null, {}, '', 42]) {
            const c = classifyVapiError(err);
            assert.equal(c.kind, 'unknown');
            assert.ok(c.message.length > 10);
        }
    });
});

describe('toDisplayText (an object must never reach JSX)', () => {
    test('digs a readable string out of every nested shape Vapi / Daily / the API produce, and is always a string', async () => {
        const { toDisplayText } = await loadModule('src/utils/vapiSession.js');
        assert.equal(toDisplayText('plain'), 'plain');
        assert.equal(toDisplayText({ message: 'top' }), 'top');
        assert.equal(toDisplayText({ type: 'no-room', msg: "The meeting you're trying to join does not exist.", details: { a: 1 } }), "The meeting you're trying to join does not exist.");
        assert.equal(toDisplayText({ error: { error: { msg: 'deep' } } }), 'deep');
        assert.equal(toDisplayText({ detail: { message: 'API says no', state: 'X' } }), 'API says no');
        assert.equal(toDisplayText({ errorMsg: { errorMsg: 'camera or mic blocked' } }), 'camera or mic blocked');
        for (const junk of [undefined, null, {}, [], { type: 'x', details: {} }, 0 / 0, () => 1]) {
            const out = toDisplayText(junk, 'fallback text');
            assert.equal(typeof out, 'string');
        }
        assert.equal(toDisplayText({ type: 'x' }, 'fallback text'), 'fallback text');
        const cyclic = { error: null }; cyclic.error = cyclic;
        assert.equal(toDisplayText(cyclic, 'safe'), 'safe', 'cyclic errors do not hang or throw');
    });

    test('classifyVapiError never returns a non-string message (the production white-screen: found object with keys {type, msg, details})', async () => {
        const { classifyVapiError } = await loadModule('src/utils/vapiSession.js');
        const dailyJoinError = { type: 'daily-call-join-error', stage: 'daily-call-join', error: { type: 'no-room', msg: "The meeting you're trying to join does not exist.", details: { code: 404 } } };
        const c = classifyVapiError(dailyJoinError);
        assert.equal(typeof c.message, 'string');
        assert.match(c.message, /does not exist/);
        for (const err of [{ error: { message: { type: 'a', msg: 'b', details: 'c' } } }, { message: { nested: true } }, { error: { error: {} } }]) {
            assert.equal(typeof classifyVapiError(err).message, 'string', JSON.stringify(err));
        }
    });
});

describe('disposeVapi', () => {
    const fake = (opts = {}) => {
        const calls = [];
        return {
            calls,
            stop() { calls.push('stop'); if (opts.stopThrows) throw new Error('already stopped'); },
            removeAllListeners() { calls.push('removeAllListeners'); },
        };
    };

    test('stops the call and detaches every listener, in that order', async () => {
        const { disposeVapi } = await loadModule('src/utils/vapiSession.js');
        const v = fake();
        disposeVapi(v);
        assert.deepEqual(v.calls, ['stop', 'removeAllListeners']);
    });

    test('is safe with null, with an instance whose stop throws, with no removeAllListeners, and when called twice', async () => {
        const { disposeVapi } = await loadModule('src/utils/vapiSession.js');
        assert.doesNotThrow(() => disposeVapi(null));
        assert.doesNotThrow(() => disposeVapi(undefined));
        const throwing = fake({ stopThrows: true });
        assert.doesNotThrow(() => disposeVapi(throwing));
        assert.ok(throwing.calls.includes('removeAllListeners'), 'listeners are still detached when stop() throws');
        assert.doesNotThrow(() => disposeVapi({ stop() {} }));
        const twice = fake();
        disposeVapi(twice);
        assert.doesNotThrow(() => disposeVapi(twice));
    });
});

describe('interview submission semantics', () => {
    test('only deadline / closed-attempt statuses take the candidate out of the interview', async () => {
        const { isClosedAttemptStatus } = await loadModule('src/utils/vapiSession.js');
        for (const status of [408, 409, 410]) assert.equal(isClosedAttemptStatus(status), true, String(status));
        for (const status of [undefined, 0, 400, 401, 403, 404, 429, 500, 502, 503]) assert.equal(isClosedAttemptStatus(status), false, String(status));
    });

    test('a failed submission produces an actionable message and is never worded as success', async () => {
        const { interviewSubmitErrorMessage } = await loadModule('src/utils/vapiSession.js');
        assert.match(interviewSubmitErrorMessage({}), /could not be sent/);
        assert.match(interviewSubmitErrorMessage({ response: { status: 500, data: {} } }), /Submission failed \(500\)/);
        assert.match(interviewSubmitErrorMessage({ response: { status: 403, data: { detail: 'Interview round is locked.' } } }), /Interview round is locked\. Choose Submit & Complete/);
        for (const err of [{}, { response: { status: 500, data: {} } }]) assert.doesNotMatch(interviewSubmitErrorMessage(err), /completed|submitted successfully/i);
    });
});

describe('shared workspace wiring (source guards)', () => {
    const submit = workspaceSrc.slice(workspaceSrc.indexOf('const handleSubmitInterview = async'), workspaceSrc.indexOf('// ── Auto-submit handlers'));

    test('exactly one interview submission can be in flight (synchronous lock, not just state)', () => {
        assert.ok(submit.includes('if (interviewSubmitLockRef.current) return;'));
        assert.ok(submit.indexOf('interviewSubmitLockRef.current = true') < submit.indexOf('await api.submitInterview'));
    });

    test('a failed submission is not reported as completed: it unlocks, shows the error and keeps the screen', () => {
        const [, catchBlock] = submit.split('} catch (err) {');
        assert.ok(catchBlock, 'has a catch block');
        assert.ok(catchBlock.includes('isClosedAttemptStatus(err?.response?.status)'));
        const failurePath = catchBlock.slice(catchBlock.indexOf('// Not recorded'));
        assert.ok(failurePath.includes('interviewSubmitLockRef.current = false') && failurePath.includes('setInterviewSubmitError(') && failurePath.includes('setShowEndInterviewModal(true)'));
        assert.ok(!failurePath.includes("finishAssessment('completed')"), 'an unsent interview is never finished as completed');
        assert.ok(!/finishAssessment\('completed'\)[\s\S]*finishAssessment\('completed'\)/.test(submit), 'completion is reported only on success');
    });

    test('the call is stopped and detached on submit, malpractice termination and unmount', () => {
        assert.ok(submit.includes('disposeVapi(vapiRef.current)'));
        assert.ok(workspaceSrc.includes('// Instantly shut off media tracks and Vapi call\n        clearTimeout(vapiConnectTimerRef.current);\n        disposeVapi(vapiRef.current);') ||
            /Instantly shut off media tracks and Vapi call\r?\n\s+clearTimeout\(vapiConnectTimerRef\.current\);\r?\n\s+disposeVapi\(vapiRef\.current\);/.test(workspaceSrc));
        assert.ok(/return \(\) => \{\s+clearTimeout\(vapiConnectTimerRef\.current\);\s+disposeVapi\(vapiRef\.current\);/.test(workspaceSrc), 'unmount cleanup');
        assert.ok(!/try \{ vapiRef\.current\.stop\(\); \} catch/.test(workspaceSrc), 'no bare stop() that leaves listeners attached');
    });

    test('connection handling: stale instances ignored, mic errors surfaced, connection watchdog, no assistant-ID secrets in the frontend', () => {
        const start = workspaceSrc.slice(workspaceSrc.indexOf('const startVapiCall = useCallback'), workspaceSrc.indexOf('const toggleVapiMute'));
        assert.ok(start.includes('const current = () => vapiRef.current === vapi;'));
        for (const evt of ["'call-start'", "'speech-start'", "'speech-end'", "'volume-level'", "'message'", "'call-end'"]) {
            const handler = start.slice(start.indexOf(`vapi.on(${evt}`));
            assert.ok(handler.slice(0, 120).includes('if (!current()) return;') || handler.slice(0, 200).includes('if (!current()) return;'), `${evt} ignores stale instances`);
        }
        assert.ok(start.includes("vapi.on('error', failCall)") && start.includes("vapi.on('camera-error', failCall)"));
        assert.ok(start.includes('classifyVapiError(err).message'));
        assert.ok(start.includes('VAPI_CONNECT_TIMEOUT_MS') && start.includes('The voice connection timed out'));
        assert.ok(!/VAPI_PRIVATE|sk_live|private[_-]?key/i.test(workspaceSrc), 'only the public key is ever referenced in the browser');
    });

    test('every stored connection error goes through the text-only setter (no object can reach the JSX)', () => {
        assert.ok(workspaceSrc.includes('const setVapiConnectionError = useCallback((value) => setVapiConnectionErrorRaw('));
        assert.ok(!/setVapiConnectionErrorRaw\(/.test(workspaceSrc.replace(/const setVapiConnectionError = useCallback\(\(value\) => setVapiConnectionErrorRaw\([\s\S]*?\[\]\);/, '')),
            'the raw state setter is only used inside the sanitising wrapper');
        assert.ok(workspaceSrc.includes('toDisplayText(value,'));
    });

    test('the call duration is capped by the server and the section deadline also stops the call', () => {
        assert.ok(workspaceSrc.includes("else if (currentStage === 'interview') handleSubmitInterview();"), 'time expiry submits (which stops the call)');
    });
});
