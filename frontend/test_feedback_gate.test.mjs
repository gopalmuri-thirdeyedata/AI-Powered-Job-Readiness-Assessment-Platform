// The 20-word feedback gate on the report page: word counting (pure) and source guards for the wiring.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');

describe('countWords', () => {
    test('counts words, ignores punctuation-only tokens and extra spaces', async () => {
        const { countWords, MIN_FEEDBACK_WORDS } = await loadModule('src/utils/feedbackWords.js');
        assert.equal(MIN_FEEDBACK_WORDS, 20);
        assert.equal(countWords(''), 0);
        assert.equal(countWords('   '), 0);
        assert.equal(countWords('-- -- -- ...'), 0);
        assert.equal(countWords('one  two\nthree\tfour'), 4);
        assert.equal(countWords("don't well-known it's"), 3);
        assert.equal(countWords(Array(19).fill('word').join(' ')), 19);
        assert.equal(countWords(Array(20).fill('word').join(' ')), 20);
        assert.equal(countWords('नमस्ते दुनिया'), 2, 'non-latin words count too');
    });
});

describe('report page wiring', () => {
    const report = read('src', 'pages', 'roleready', 'RoleReadyReport.jsx');

    test('download and dashboard both go through the feedback gate', () => {
        assert.ok(report.includes("requireFeedback('download')"));
        assert.ok(report.includes("requireFeedback('dashboard')"));
        assert.ok(!report.includes('onClick={() => window.print()}'), 'no ungated download');
        assert.ok(!/to="\/student\/dashboard"\s+id="report-view-dashboard-btn"/.test(report), 'no ungated dashboard link');
        assert.ok(report.includes('showDashboard={false}'), 'the navbar shortcut to the dashboard is hidden on the report');
    });

    test('feedback is saved first, then the student is taken to the dashboard', () => {
        const submit = report.slice(report.indexOf('const submitFeedback'), report.indexOf('const submitFeedback') + 500);
        assert.ok(submit.indexOf('rolereadyApi.submitFeedback') < submit.indexOf('runGatedAction'));
        assert.ok(report.includes("navigate('/student/dashboard')"));
        assert.ok(report.includes("'afterprint'"), 'a download finishes before the redirect');
    });

    test('the popup blocks submit under 20 words and is mobile friendly', () => {
        const modal = read('src', 'components', 'student-ui', 'FeedbackGateModal.jsx');
        assert.ok(modal.includes('disabled={!ready || busy}'));
        assert.ok(modal.includes('words >= MIN_FEEDBACK_WORDS'));
        assert.ok(/max-w-lg/.test(modal) && /p-4/.test(modal) && /sm:flex-row/.test(modal), 'fits a phone screen');
        assert.ok(modal.includes('role="dialog"') && modal.includes("e.key === 'Escape'"));
    });
});
