import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');

describe('Assessment-required gate for new students', () => {
    const layout = read('src', 'layouts', 'StudentLayout.jsx');

    test('1. shared gate component uses the access-aware start handler (contact-admin popup while locked) instead of linking to the setup page', () => {
        const gate = read('src', 'components', 'student-ui', 'AssessmentRequiredGate.jsx');
        assert.ok(gate.includes('Initial Assessment Required'));
        assert.ok(gate.includes('onClick={startAssessment}'));
        assert.ok(!gate.includes('to="/assessment/setup"'));
        assert.ok(gate.includes('Start Your Assessment Now'));
    });

    test('2. layout gates every assessment-dependent sidebar page', () => {
        for (const p of ['skill-gap', 'roadmap', 'practice', 'interview', 'simulation', 'projects', 'dashboard']) {
            assert.ok(layout.includes(`'/student/${p}':`), `${p} must be gated`);
        }
    });

    test('3. resume tools and profile stay open to new students', () => {
        const block = layout.slice(layout.indexOf('ASSESSMENT_GATED_PATHS = {'), layout.indexOf('const gatedFeatureFor'));
        for (const p of ['resume', 'resume-formatter', 'profile']) {
            assert.ok(!block.includes(`'/student/${p}'`), `${p} must not be gated`);
        }
    });

    test('4. gate shows only when the server confirmed no attempts, never on a failed check', () => {
        assert.ok(layout.includes('isConfirmedNew ? ('));
        assert.ok(layout.includes('<AssessmentRequiredGate feature={gatedFeature} />'));
    });

    test('5. dashboard reuses the shared gate', () => {
        assert.ok(read('src', 'pages', 'student', 'StudentDashboard.jsx').includes('<AssessmentRequiredGate />'));
    });
});
