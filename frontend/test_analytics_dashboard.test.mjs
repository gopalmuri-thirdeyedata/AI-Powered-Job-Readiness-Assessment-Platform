import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const analyticsCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Analytics.jsx'), 'utf-8');
const drawerCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'analytics', 'CandidateDetailDrawer.jsx'), 'utf-8');

describe('Recruitment Intelligence Dashboard Upgrades Test Suite', () => {

    test('1. Zero Fabricated / Mock Data: Purged getDemoCandidates, demoMode, and Sarah Jenkins', () => {
        assert.ok(!analyticsCode.includes('getDemoCandidates'), 'getDemoCandidates must be removed');
        assert.ok(!analyticsCode.includes('Sarah Jenkins'), 'Sarah Jenkins mock candidate must be removed');
        assert.ok(!analyticsCode.includes('demoMode'), 'demoMode toggle must be removed');
        assert.ok(!analyticsCode.includes('demo-'), 'No demo- id generators');
    });

    test('2. Backend API Integration: Fetches real analytics, candidates, and activity logs', () => {
        assert.ok(analyticsCode.includes('/api/dashboard/analytics/'), 'Must call backend /api/dashboard/analytics/');
        assert.ok(analyticsCode.includes('/api/resume/candidates/'), 'Must call backend /api/resume/candidates/');
        assert.ok(analyticsCode.includes('/api/dashboard/activity/'), 'Must call backend /api/dashboard/activity/');
    });

    test('3. Top Header Controls: Date range filter, role selector, live mode, and multi-format export', () => {
        // Date range options
        assert.ok(analyticsCode.includes('DATE_RANGE_OPTIONS'), 'Must define date range options');
        assert.ok(analyticsCode.includes("'today'"));
        assert.ok(analyticsCode.includes("'7d'"));
        assert.ok(analyticsCode.includes("'30d'"));
        assert.ok(analyticsCode.includes("'90d'"));
        assert.ok(analyticsCode.includes("'1y'"));

        // Live mode polling
        assert.ok(analyticsCode.includes('liveMode'), 'Must support liveMode');
        assert.ok(analyticsCode.includes('30000'), 'Must poll every 30s when liveMode is active');

        // Multi-format export
        assert.ok(analyticsCode.includes('handleExportPDF'), 'Must support PDF export');
        assert.ok(analyticsCode.includes('handleExportWord'), 'Must support Word export');
        assert.ok(analyticsCode.includes('handleExportExcel'), 'Must support Excel export');
    });

    test('4. Pipeline Bottleneck Alert and Drill-down Filtering', () => {
        assert.ok(analyticsCode.includes('Pipeline Bottleneck Detected'), 'Must render bottleneck alert');
        assert.ok(analyticsCode.includes('handleFunnelStageClick'), 'Must support clicking stage to filter');
    });

    test('5. Round-wise Performance & Score Distribution Metric Switchers', () => {
        assert.ok(analyticsCode.includes('roundMetricType'), 'Must support roundMetricType toggle');
        assert.ok(analyticsCode.includes("'pass_rate'"), 'Must support pass_rate toggle');
        assert.ok(analyticsCode.includes('distributionMetric'), 'Must support distributionMetric switcher');
        assert.ok(analyticsCode.includes("'resume'"), 'Must support resume distribution metric');
        assert.ok(analyticsCode.includes("'aptitude'"), 'Must support aptitude distribution metric');
        assert.ok(analyticsCode.includes("'coding'"), 'Must support coding distribution metric');
        assert.ok(analyticsCode.includes("'interview'"), 'Must support interview distribution metric');
    });

    test('6. Skills Intelligence & Requires Attention Sections', () => {
        assert.ok(analyticsCode.includes('Skills Intelligence'), 'Must include skills intelligence section');
        assert.ok(analyticsCode.includes('Requires Recruiter Attention'), 'Must include attention required section');
        assert.ok(analyticsCode.includes('handleReScreenUnscored'), 'Must support rescreening unscored resumes');
    });

    test('7. Candidate Leaderboard & Detail Drawer Integration', () => {
        assert.ok(analyticsCode.includes('CandidateDetailDrawer'), 'Must render CandidateDetailDrawer');
        assert.ok(analyticsCode.includes('handleViewCandidate'), 'Must support viewing candidate profile in drawer');
    });

    test('8. Candidate Detail Drawer Privacy: Strictly Recruiter Brief, No Internal AI Reasoning Leak', () => {
        assert.ok(drawerCode.includes('Recruiter Evaluation Brief'), 'Must have Recruiter Evaluation Brief');
        assert.ok(!drawerCode.includes('system_prompt'), 'Must not expose system_prompt');
        assert.ok(!drawerCode.includes('chain_of_thought'), 'Must not expose chain_of_thought');
        assert.ok(!drawerCode.includes('internal_reasoning'), 'Must not expose internal_reasoning');
        assert.ok(!drawerCode.includes('test_cases'), 'Must not expose secret test cases');
        assert.ok(drawerCode.includes('Resume Screening'), 'Must render resume score');
        assert.ok(drawerCode.includes('Aptitude Round'), 'Must render aptitude score');
        assert.ok(drawerCode.includes('Coding Challenge'), 'Must render coding score');
        assert.ok(drawerCode.includes('Technical Interview'), 'Must render interview score');
    });
});
