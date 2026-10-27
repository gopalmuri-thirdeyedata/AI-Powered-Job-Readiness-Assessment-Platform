import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');

describe('Student assessments are locked behind the contact-admin popup', () => {
    test('1. the popup tells the student to contact the admin and has a Cancel button', () => {
        const modal = read('src', 'components', 'student-ui', 'ContactAdminModal.jsx');
        assert.ok(modal.includes('contact your admin'));
        assert.ok(modal.includes('Cancel'));
        assert.ok(modal.includes("e.key === 'Escape'"), 'Escape must close the popup');
        assert.ok(modal.includes('role="dialog"'));
    });

    test('2. one provider at the app root renders the popup for every page', () => {
        const app = read('src', 'App.jsx');
        assert.ok(app.includes('<AssessmentLockProvider>'));
        const ctx = read('src', 'context', 'AssessmentLockContext.jsx');
        assert.ok(ctx.includes('ASSESSMENT_START_LOCKED = true'));
        assert.ok(ctx.includes('<ContactAdminModal'));
    });

    test('3. the setup page blocks starting, including Enter-key form submits', () => {
        const setup = read('src', 'pages', 'roleready', 'RoleReadySetup.jsx');
        assert.ok(/if \(ASSESSMENT_START_LOCKED\) \{\s*promptContactAdmin\(\);\s*return;/.test(setup));
        assert.ok(setup.includes('to="/student/dashboard"'), 'the Dashboard button must still work');
    });

    test('4. no student dashboard, layout or report button links straight to /assessment/setup', () => {
        for (const file of [
            ['src', 'pages', 'student', 'StudentDashboard.jsx'],
            ['src', 'layouts', 'StudentLayout.jsx'],
            ['src', 'components', 'student-ui', 'AssessmentRequiredGate.jsx'],
        ]) {
            const src = read(...file);
            assert.ok(!src.includes('to="/assessment/setup"'), `${file.at(-1)} must not link to /assessment/setup`);
            assert.ok(src.includes('promptContactAdmin'), `${file.at(-1)} must use the contact-admin popup`);
        }
        const report = read('src', 'pages', 'roleready', 'RoleReadyReport.jsx');
        assert.ok(report.includes('onClick={promptContactAdmin}'));
    });
});
