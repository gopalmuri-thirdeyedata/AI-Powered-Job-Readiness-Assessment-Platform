import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSpoken, appendTranscript, describeSpeechError } from './src/utils/speechText.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, 'src', ...p), 'utf-8');

describe('Voice typing text', () => {
    test('1. spoken punctuation becomes real punctuation, attached to the word before it', () => {
        assert.equal(normalizeSpoken('I built the api full stop then I deployed it'), 'I built the api. then I deployed it');
        assert.equal(normalizeSpoken('first comma second comma third'), 'first, second, third');
        assert.equal(normalizeSpoken('did it work question mark'), 'did it work?');
        assert.equal(normalizeSpoken('great exclamation mark'), 'great!');
        assert.equal(normalizeSpoken('first part new line second part'), 'first part\nsecond part');
        assert.equal(normalizeSpoken('one new paragraph two'), 'one\n\ntwo');
    });

    test('2. ordinary words and technical terms are not turned into punctuation', () => {
        assert.equal(normalizeSpoken('I worked there for a period of two years'), 'I worked there for a period of two years');
        assert.equal(normalizeSpoken('we exported comma separated values'), 'we exported comma separated values');
        assert.equal(normalizeSpoken('the comma-delimited file'), 'the comma-delimited file');
        assert.equal(normalizeSpoken('it prints a new line character'), 'it prints a new line character');
        assert.equal(normalizeSpoken('the colon operator'), 'the colon operator');
    });

    test('3. blank or odd input never throws and never adds text', () => {
        assert.equal(normalizeSpoken(''), '');
        assert.equal(normalizeSpoken('   '), '');
        assert.equal(normalizeSpoken(null), '');
        assert.equal(normalizeSpoken(undefined), '');
        assert.equal(appendTranscript('Hello', ''), 'Hello');
        assert.equal(appendTranscript(undefined, ''), '');
    });

    test('4. dictated chunks join the answer with one space and a capital at the start of a sentence', () => {
        assert.equal(appendTranscript('', 'tell me about my project'), 'Tell me about my project');
        assert.equal(appendTranscript('I built an api', 'using fastapi'), 'I built an api using fastapi');
        assert.equal(appendTranscript('I built an api.', 'it served 200 users'), 'I built an api. It served 200 users');
        assert.equal(appendTranscript('Done.\n', 'next point'), 'Done.\nNext point');
        assert.equal(appendTranscript('I built an api ', 'quickly'), 'I built an api quickly');
        assert.equal(appendTranscript('Really', 'question mark'), 'Really?', 'punctuation attaches without a space');
    });

    test('5. whatever is already typed is never changed', () => {
        const typed = 'My own typed text, with Capitals and punctuation!';
        assert.ok(appendTranscript(typed, 'more words').startsWith(typed));
    });

    test('6. every recogniser error has a message that says what to do', () => {
        assert.match(describeSpeechError('not-allowed'), /blocked/i);
        assert.match(describeSpeechError('service-not-allowed'), /blocked/i);
        assert.match(describeSpeechError('audio-capture'), /no microphone/i);
        assert.match(describeSpeechError('network'), /internet/i);
        assert.match(describeSpeechError('something-new'), /type your answer/i);
    });
});

describe('Voice typing wiring', () => {
    const hook = read('hooks', 'useSpeechToText.js');
    const mock = read('pages', 'student', 'StudentMockInterview.jsx');
    const sim = read('pages', 'student', 'StudentPlacementSimulation.jsx');
    const ui = read('components', 'student-ui', 'VoiceInput.jsx');

    test('7. the hook restarts after the browser pauses it, ignores plain silence, and stops on unmount', () => {
        assert.ok(hook.includes('rec.continuous = true') && hook.includes('rec.interimResults = true'));
        assert.ok(hook.includes("event.error === 'no-speech'"), 'silence must not be reported as an error');
        assert.ok(hook.includes('restartTimerRef.current = setTimeout'));
        assert.ok(hook.includes('useEffect(() => stop, [stop])'), 'the microphone must not stay on after leaving the page');
    });

    test('8. browsers without speech recognition get no broken button', () => {
        assert.ok(hook.includes('window.SpeechRecognition || window.webkitSpeechRecognition'));
        assert.ok(ui.includes('if (!dictation?.supported) return null;'));
    });

    test('9. Mock Interview: spoken words go into the answer box and dictation stops on submit', () => {
        assert.ok(mock.includes('useSpeechToText({ onFinalText: (text) => setStudentResponse((prev) => appendTranscript(prev, text)) })'));
        assert.ok(mock.includes('<VoiceInputButton dictation={dictation} />') && mock.includes('<VoiceStatus dictation={dictation} />'));
        const submit = mock.slice(mock.indexOf('const handleSubmitAnswer'), mock.indexOf('const handleSubmitAnswer') + 160);
        assert.ok(submit.includes('dictation.stop()'));
    });

    test('10. Placement Simulation: both written rounds get voice typing, the code box does not', () => {
        assert.ok(sim.includes('techDictation') && sim.includes('hrDictation'));
        assert.ok(sim.includes('setTechResponse((prev) => appendTranscript(prev, text))'));
        assert.ok(sim.includes('setHrResponse((prev) => appendTranscript(prev, text))'));
        const codeBox = sim.slice(sim.indexOf('Solution Source Code (Python 3)'), sim.indexOf('value={codeSubmission}') + 200);
        assert.ok(!codeBox.includes('Dictation') && !codeBox.includes('VoiceInputButton'), 'voice typing would corrupt code');
        const submit = sim.slice(sim.indexOf('techDictation.stop()') - 80, sim.indexOf('techDictation.stop()') + 80);
        assert.ok(submit.includes('hrDictation.stop()') || sim.includes('hrDictation.stop()'));
    });

    test('11. the button shows a clear listening state and live text', () => {
        assert.ok(ui.includes('aria-pressed={listening}'));
        assert.ok(ui.includes('Listening…') && ui.includes('{interim ?'));
        assert.ok(ui.includes('role="alert"'), 'errors are announced');
    });
});
