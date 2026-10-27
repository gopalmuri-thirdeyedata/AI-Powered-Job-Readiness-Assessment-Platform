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

    test('feedback is saved first, then the report downloads automatically, then the student goes to the dashboard', () => {
        const submit = report.slice(report.indexOf('const submitFeedback'), report.indexOf('const submitFeedback') + 600);
        assert.ok(submit.indexOf('rolereadyApi.submitFeedback') < submit.indexOf('await downloadReport()'));
        assert.ok(submit.indexOf('await downloadReport()') < submit.indexOf("navigate('/student/dashboard')"));
        assert.ok(report.includes("import { downloadReportPdf } from '../../utils/reportPdf'"));
        assert.ok(!report.includes("'afterprint'"), 'no print dialog on the normal path');
        assert.ok(report.includes('window.print()'), 'the print dialog stays only as the fallback when the PDF cannot be built');
    });

    test('the popup blocks submit under 20 words and is mobile friendly', () => {
        const modal = read('src', 'components', 'student-ui', 'FeedbackGateModal.jsx');
        assert.ok(modal.includes('disabled={!ready || busy}'));
        assert.ok(modal.includes('words >= MIN_FEEDBACK_WORDS'));
        assert.ok(/max-w-lg/.test(modal) && /p-4/.test(modal) && /sm:flex-row/.test(modal), 'fits a phone screen');
        assert.ok(modal.includes('role="dialog"') && modal.includes("e.key === 'Escape'"));
    });
});

describe('report PDF', () => {
    const REPORT = {
        target_role: 'Full Stack Engineer', target_company: 'ThirdEye Data', completed_at: '2026-10-27T10:00:00Z',
        overall_readiness_score: 78.5, aptitude_score: 80, coding_score: 70, interview_score: null, current_state: 'COMPLETED',
        final_report: {
            readiness_tier: 'Foundation Strong', skills_verified: ['Algorithms', 'REST — “design”'], areas_for_improvement: ['System design'],
            skill_gap_analysis: [{ skill: 'SQL', status: 'Gap', recommendation: 'Practise joins' }, { skill: 'Python', status: 'Demonstrated', evidence: 'Solved 3 of 3' }],
            interview_breakdown: [{ question_text: 'Explain indexes.', score: 62.4, category: 'SQL', evidence: 'Mentioned B-trees.' }],
            personalized_recommendations: ['Build a small API', 'Review indexing'],
            suggested_learning_roadmap: { 'Week 1': ['Read docs', { task: 'Practise SQL' }], 'Week 2': 'Mock interview' },
            round_details: { aptitude: { correct_count: 8, total_questions: 10 }, coding: { passed_hidden_tests: 2, total_hidden_tests: 3 } },
        },
    };

    test('the content covers scores, strengths, gaps, interview, recommendations and the plan', async () => {
        const { buildReportSections } = await loadModule('src/utils/reportPdf.js');
        const text = buildReportSections(REPORT).map((b) => b.text || `${b.k}: ${b.v}`).join('\n');
        for (const needle of ['Full Stack Engineer at ThirdEye Data', 'Overall readiness: 78.5%', 'AI technical interview: Not attempted',
            'Aptitude answers correct: 8 of 10', 'Coding hidden tests passed: 2 of 3', 'Skills demonstrated', 'System design', 'SQL (Gap): Practise joins',
            'Question 1 [SQL] (62%): Explain indexes.', 'Mentioned B-trees.', 'Build a small API', 'Week 1: Read docs; Practise SQL', 'Week 2: Mock interview']) {
            assert.ok(text.includes(needle), `report has: ${needle}`);
        }
    });

    test('typographic characters are made PDF-safe and odd input never throws', async () => {
        const { toPdfText, buildReportSections, reportFileName } = await loadModule('src/utils/reportPdf.js');
        assert.equal(toPdfText('REST — “design” • ok … 中'), 'REST - "design" - ok ...');
        assert.equal(toPdfText(null), '');
        assert.doesNotThrow(() => buildReportSections(null));
        assert.doesNotThrow(() => buildReportSections({ final_report: { skill_gap_analysis: [null, 5], interview_breakdown: [null], suggested_learning_roadmap: [1] } }));
        assert.equal(reportFileName({ target_role: 'Full Stack / Engineer!' }), 'full-stack-engineer-assessment-report.pdf');
        assert.equal(reportFileName({}), 'prepwin-assessment-report.pdf');
    });

    test('a real PDF file is produced, including a long report that spans several pages', async () => {
        const { buildReportPdf } = await loadModule('src/utils/reportPdf.js');
        const doc = await buildReportPdf(REPORT);
        const bytes = new Uint8Array(doc.output('arraybuffer'));
        assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
        assert.ok(bytes.length > 1500 && doc.getNumberOfPages() >= 1);
        const long = { ...REPORT, final_report: { ...REPORT.final_report, personalized_recommendations: Array.from({ length: 120 }, (_, i) => `Recommendation number ${i} with a reasonably long sentence so that it wraps across lines in the document`) } };
        const big = await buildReportPdf(long);
        assert.ok(big.getNumberOfPages() >= 3, 'long reports continue on new pages');
    });
});
