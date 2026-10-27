import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, 'src', ...p), 'utf-8');

describe('Skill Gap shows required skills for any role', () => {
    const page = read('pages', 'student', 'StudentSkillGap.jsx');

    test('1. skill chips animate on their own, not through the parent stagger that plays once', () => {
        const chip = page.slice(page.indexOf('const SkillChip'), page.indexOf('/** Circular match gauge'));
        assert.ok(!chip.includes('<StaggerItem'), 'SkillChip must not depend on the parent stagger variants');
        assert.ok(chip.includes('initial=') && chip.includes('animate={{ opacity: 1, y: 0 }}'));
    });

    test('2. missing and growth chips are rendered with an index so they animate in order', () => {
        assert.ok(page.includes('missing_required?.map((skill, i)'));
        assert.ok(page.includes('missing_preferred?.map((skill, i)'));
    });

    test('3. shared Stagger replays when its set of items changes', () => {
        const motion = read('components', 'student-ui', 'StudentMotion.jsx');
        const stagger = motion.slice(motion.indexOf('export const Stagger'), motion.indexOf('export const StaggerItem'));
        assert.ok(stagger.includes('itemsKey') && stagger.includes('key={itemsKey}'));
    });
});

describe('Round submit animation holds before the next round', () => {
    const page = read('pages', 'roleready', 'RoleReadyAssessment.jsx');

    test('4. the animation stays up for at least 5 seconds', () => {
        assert.ok(page.includes('const MIN_SUBMIT_ANIMATION_MS = 5000;'));
        assert.ok(page.includes('const holdAnimation = async (startedAt)'));
    });

    test('5. aptitude: the hold happens before the coding round is started (its server clock must not run behind the animation)', () => {
        const apt = page.slice(page.indexOf('const handleSubmitAptitude'), page.indexOf('// ── Round 2: Coding Operations'));
        const hold = apt.indexOf('await holdAnimation(submitStartedAt)');
        assert.ok(hold > 0, 'aptitude must hold the animation');
        assert.ok(hold < apt.indexOf("setCurrentStage('coding')"), 'hold must come before switching stage');
        assert.ok(hold < apt.indexOf('loadCoding()'), 'hold must come before starting the coding round');
    });

    test('6. coding and interview also hold before moving on', () => {
        const cod = page.slice(page.indexOf('const handleSubmitCoding'), page.indexOf('const continueToInterview'));
        assert.ok(cod.includes('await holdAnimation(submitStartedAt)'));
        const itv = page.slice(page.indexOf('const handleSubmitInterview'), page.indexOf('// ── Auto-submit handlers'));
        // A failed interview submission is no longer "completed anyway" (it keeps the screen and offers a retry), so only the SUCCESS path
        // holds the animation; the failure path must never present the assessment as finished.
        assert.equal((itv.match(/await holdAnimation\(submitStartedAt\)/g) || []).length, 1, 'the success path holds');
        const failure = itv.slice(itv.indexOf('} catch'));
        assert.ok(!failure.includes('holdAnimation') && failure.includes('interviewSubmitLockRef.current = false'), 'the failure path allows a retry and does not hold or complete');
    });
});

describe('Campus Drives is removed from the student app', () => {
    test('7. no sidebar entry, no gate entry, no student routes, no page', () => {
        const layout = read('layouts', 'StudentLayout.jsx');
        assert.ok(!layout.includes("label: 'Campus Drives'"));
        assert.ok(!layout.includes("'/student/drives'"));
        const app = read('App.jsx');
        assert.ok(!app.includes('/student/drives') && !app.includes('StudentDrives'));
        assert.ok(!fs.existsSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDrives.jsx')));
    });
});

describe('Resume Formatter remembers the last generated resume', () => {
    const page = read('pages', 'student', 'StudentResumeFormatter.jsx');

    test('8. result is saved per student and restored on return', () => {
        assert.ok(page.includes('const STORAGE_PREFIX'));
        assert.ok(page.includes('`${STORAGE_PREFIX}:${user.id}`'), 'storage is keyed by the signed-in student');
        assert.ok(page.includes('writeSaved(storageKey, { data, selected, savedAt, sourceLabel })'));
        assert.ok(page.includes('readSaved(storageKey)') && page.includes('setResumeData(saved.data)'));
    });

    test('9. storage failures are guarded and never break the page', () => {
        for (const fn of ['readSaved', 'writeSaved', 'removeSaved']) {
            const body = page.slice(page.indexOf(`const ${fn}`), page.indexOf(`const ${fn}`) + 400);
            assert.ok(body.includes('try {') && body.includes('catch'), `${fn} must be wrapped in try/catch`);
        }
    });

    test('10. a failed generate keeps the earlier result on screen', () => {
        const gen = page.slice(page.indexOf('const generate = async'), page.indexOf('const download = async'));
        const catchBlock = gen.slice(gen.indexOf('} catch (err) {'), gen.indexOf('} finally {'));
        assert.ok(!catchBlock.includes('setResumeData(null)'));
    });

    test('11. restored result is labelled, with a way to clear it and the chosen template remembered', () => {
        assert.ok(page.includes('id="fmt-restored-banner"') && page.includes('Showing your last generated resume'));
        assert.ok(page.includes('id="fmt-clear-saved"') && page.includes('removeSaved(storageKey)'));
        assert.ok(page.includes('writeSaved(storageKey, { ...saved, selected })'));
    });
});
