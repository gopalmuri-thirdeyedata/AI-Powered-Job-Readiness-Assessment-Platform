import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    timedProgress, stageForProgress, START_PERCENT, EXPECTED_END_PERCENT, MAX_WAITING_PERCENT,
} from './src/utils/progressTiming.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, 'src', ...p), 'utf-8');

describe('Timed progress bar', () => {
    test('1. it starts at 4%, is halfway at half the time, and reaches 96% when the expected time is up', () => {
        assert.equal(timedProgress(0, 5000), START_PERCENT);
        assert.equal(timedProgress(2500, 5000), (START_PERCENT + EXPECTED_END_PERCENT) / 2);
        assert.equal(timedProgress(5000, 5000), EXPECTED_END_PERCENT);
    });

    test('2. it only ever moves forward, second by second', () => {
        let previous = -1;
        for (let t = 0; t <= 60000; t += 100) {
            const value = timedProgress(t, 5000);
            assert.ok(value >= previous, `went backwards at ${t}ms`);
            previous = value;
        }
    });

    test('3. a slow server keeps it creeping, but it never claims 100% by itself', () => {
        assert.ok(timedProgress(10000, 5000) > EXPECTED_END_PERCENT);
        assert.ok(timedProgress(10000, 5000) < MAX_WAITING_PERCENT);
        assert.equal(timedProgress(25000, 5000), MAX_WAITING_PERCENT);
        assert.equal(timedProgress(10 * 60 * 1000, 5000), MAX_WAITING_PERCENT);
        for (const t of [0, 1, 4999, 5000, 5001, 30000, 1e9]) assert.ok(timedProgress(t, 5000) < 100);
    });

    test('4. bad input cannot break the bar', () => {
        assert.equal(timedProgress(-500, 5000), START_PERCENT);
        assert.equal(timedProgress(NaN, 5000), START_PERCENT);
        assert.equal(timedProgress(undefined, 5000), START_PERCENT);
        assert.ok(Number.isFinite(timedProgress(1000, 0)));
        assert.ok(Number.isFinite(timedProgress(1000, undefined)));
    });

    test('5. the steps are spread evenly across the bar and the last one is current at the end', () => {
        const stages = 4;
        const sequence = [];
        for (let t = 0; t <= 5000; t += 50) {
            const step = stageForProgress(timedProgress(t, 5000), stages);
            if (sequence[sequence.length - 1] !== step) sequence.push(step);
        }
        assert.deepEqual(sequence, [0, 1, 2, 3], 'each of the four steps becomes current once, in order');
        assert.equal(stageForProgress(timedProgress(60000, 5000), stages), stages - 1);
        assert.equal(stageForProgress(0, stages), 0);
        assert.equal(stageForProgress(50, 0), 0);
    });

    test('6. each step gets a fair share of the 5 seconds', () => {
        const stages = 4;
        const firstSeen = {};
        for (let t = 0; t <= 5000; t += 10) {
            const step = stageForProgress(timedProgress(t, 5000), stages);
            if (!(step in firstSeen)) firstSeen[step] = t;
        }
        assert.ok(firstSeen[1] > 1000 && firstSeen[1] < 1500);
        assert.ok(firstSeen[2] > 2300 && firstSeen[2] < 2700);
        assert.ok(firstSeen[3] > 3600 && firstSeen[3] < 4000);
    });
});

describe('Overlay and submit wiring', () => {
    const overlay = read('components', 'AssessmentLoadingOverlay.jsx');
    const page = read('pages', 'roleready', 'RoleReadyAssessment.jsx');

    test('7. the overlay follows the timed helper and fills to 100% with every step checked when done', () => {
        assert.ok(overlay.includes('timedProgress(Date.now() - openedAtRef.current, expectedMs)'));
        assert.ok(overlay.includes('if (open && done) { setProgress(100); setActive(stages.length); }'));
        assert.ok(overlay.includes('Math.max(p, target)'), 'progress must never go backwards');
    });

    test('8. aptitude uses the 5 second bar, then flashes 100% before the coding round starts', () => {
        assert.ok(page.includes('expectedMs={MIN_SUBMIT_ANIMATION_MS}'));
        const apt = page.slice(page.indexOf('const handleSubmitAptitude'), page.indexOf('// ── Round 2: Coding Operations'));
        const hold = apt.indexOf('await holdAnimation(submitStartedAt)');
        const done = apt.indexOf('setSubmitDone(true)');
        const stage = apt.indexOf("setCurrentStage('coding')");
        assert.ok(hold > 0 && done > hold && stage > done, 'order must be: hold, show 100%, then switch round');
        assert.ok(apt.includes('setSubmitDone(false)'), 'the flag is reset afterwards');
    });

    test('9. all three overlays receive the done flag and the finish state is cleared in every finally block', () => {
        assert.equal((page.match(/done=\{submitDone\}/g) || []).length, 3);
        assert.ok((page.match(/setSubmitDone\(false\)/g) || []).length >= 3);
    });
});
