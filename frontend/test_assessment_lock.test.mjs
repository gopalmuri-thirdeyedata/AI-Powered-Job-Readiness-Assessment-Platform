import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');

describe('Student assessments are locked until an admin grants access', () => {
    test('1. the popup tells the student to contact the admin and has a Cancel button', () => {
        const modal = read('src', 'components', 'student-ui', 'ContactAdminModal.jsx');
        assert.ok(modal.includes('contact your admin'));
        assert.ok(modal.includes('Cancel'));
        assert.ok(modal.includes("e.key === 'Escape'"), 'Escape must close the popup');
        assert.ok(modal.includes('role="dialog"'));
    });

    test('2. one provider inside the router renders the popup for every page and mirrors the server-side access', () => {
        const app = read('src', 'App.jsx');
        assert.ok(app.includes('<AssessmentLockProvider>'));
        assert.ok(app.indexOf('<Router>') < app.indexOf('<AssessmentLockProvider>'), 'the provider navigates, so it must sit inside the Router');
        const ctx = read('src', 'context', 'AssessmentLockContext.jsx');
        assert.ok(!ctx.includes('ASSESSMENT_START_LOCKED'), 'no hard-coded lock: the server decides per student');
        assert.ok(ctx.includes('getAssessmentAccess'));
        assert.ok(ctx.includes('<ContactAdminModal'));
        assert.ok(/catch \{\s*if \(alive\.current\) setGranted\(false\);/.test(ctx), 'a failed access check must fail closed');
    });

    test('3. the setup page re-reads access on submit (Enter key included) and handles a server refusal', () => {
        const setup = read('src', 'pages', 'roleready', 'RoleReadySetup.jsx');
        assert.ok(/if \(!\(await refreshAccess\(\)\)\) \{\s*promptContactAdmin\(\);\s*return;/.test(setup));
        assert.ok(setup.includes("failureCode(err) === 'ASSESSMENT_ACCESS_LOCKED'"));
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
            assert.ok(src.includes('startAssessment'), `${file.at(-1)} must use the access-aware start handler`);
        }
        const report = read('src', 'pages', 'roleready', 'RoleReadyReport.jsx');
        assert.ok(report.includes('onClick={startAssessment}'));
    });

    test('5. User Management lets an admin grant / revoke a student with a confirmation', () => {
        const page = read('src', 'pages', 'admin', 'UserManagementPage.jsx');
        assert.ok(page.includes('Access Granted') && page.includes('Access Locked'));
        assert.ok(page.includes('setAccessConfirm(u)'), 'the button must open the confirmation first');
        assert.ok(page.includes('userManagementApi.setAssessmentAccess'));
        assert.ok(/canManage && u\.role === 'STUDENT' && \(\s*<button[\s\S]{0,80}setAccessConfirm/.test(page), 'only manageable students get the action');
        const api = read('src', 'services', 'userManagementApi.js');
        assert.ok(api.includes('/assessment-access'));
    });

    test('6. Details modal supports assessment access toggle and updates status immediately', () => {
        const page = read('src', 'pages', 'admin', 'UserManagementPage.jsx');
        assert.ok(page.includes('details-assessment-access-btn'), 'details modal must have assessment access toggle button');
        assert.ok(page.includes('onToggleAssessmentAccess'), 'details dialog receives toggle handler');
        assert.ok(page.includes('assessment_access_granted: nextGranted'), 'state is updated immediately upon API success');
    });
});
