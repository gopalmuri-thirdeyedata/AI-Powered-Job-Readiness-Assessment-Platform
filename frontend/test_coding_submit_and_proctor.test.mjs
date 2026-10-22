import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadyAssessment.jsx'), 'utf-8');
const handler = page.slice(page.indexOf('const handleSubmitCoding'), page.indexOf('const continueToInterview'));

describe('Coding submit experience and proctor boxes', () => {
    test('1. coding submit no longer uses a blocking alert', () => {
        assert.ok(!handler.includes('alert('), 'handleSubmitCoding must not call alert()');
        assert.ok(handler.includes('setCodingSubmitError'));
    });

    test('2. a busy sandbox (503) and a lost connection get distinct inline messages', () => {
        assert.ok(handler.includes('status === 503'));
        assert.ok(handler.includes('!err.response'));
        assert.ok(page.includes('role="alert"'));
    });

    test('3. submit button offers retry after a failure and is guarded against double submits', () => {
        assert.ok(page.includes('Retry Submission'));
        assert.ok(handler.includes('if (isSubmittingCoding || codingSubmitResult) return;'));
    });

    test('4. each round submit shows the full-screen analysing overlay while evaluating', () => {
        assert.ok(page.includes("import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay'"));
        for (const flag of ['isSubmittingApt', 'isSubmittingCoding', 'isSubmittingInterview']) {
            assert.ok(page.includes(`open={${flag}}`), `${flag} must open the overlay`);
        }
        assert.ok(page.includes('Evaluating your code'));
        assert.ok(page.includes('Comparing outputs with the hidden tests'));
        // grading runs in the background, so the student is held for about 15 seconds at most
        assert.ok(page.includes('expectedMs={15000}'));
        const overlay = fs.readFileSync(path.join(__dirname, 'src', 'components', 'AssessmentLoadingOverlay.jsx'), 'utf-8');
        assert.ok(overlay.includes('stageIntervalMs = 2300'));
    });

    test('5. successful submit shows a submitted card with per-problem results and a continue button', () => {
        assert.ok(page.includes('id="coding-submitted-card"'));
        assert.ok(page.includes('Coding round submitted'));
        assert.ok(page.includes('tests passed'));
        assert.ok(page.includes('id="continue-to-interview-btn"'));
        assert.ok(page.includes('onClick={continueToInterview}'));
    });

    test('6. interview is only provisioned when the student continues, not inside the submit handler', () => {
        assert.ok(!handler.includes('loadInterview()'));
        const cont = page.slice(page.indexOf('const continueToInterview'), page.indexOf('const continueToInterview') + 220);
        assert.ok(cont.includes("setCurrentStage('interview')") && cont.includes('loadInterview()'));
    });

    test('7. green person box is drawn in the compact coding-round preview too', () => {
        const feed = page.slice(page.indexOf('const ProctorCameraFeed'), page.indexOf('const renderedBoxes') + 400);
        assert.ok(feed.includes('if (showDiagnostics) {'));
        assert.ok(!feed.includes('showDiagnostics && !compact'));
        assert.ok(page.includes("compact ? 'Person' : 'Candidate Verified'"));
        assert.ok(page.includes("'#16A34A'"));
    });
});
