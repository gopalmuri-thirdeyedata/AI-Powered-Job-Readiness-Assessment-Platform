import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');
const studentDashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDashboard.jsx'), 'utf-8');
const performanceViewCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'student', 'StudentPerformanceView.jsx'), 'utf-8');
const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');

describe('Student Performance Dashboard Frontend Test Suite', () => {

    test('1. studentApi.js encapsulates all Phase 11 performance endpoints', () => {
        assert.ok(studentApiCode.includes('getPerformanceDashboard()'), 'Defines getPerformanceDashboard');
        assert.ok(studentApiCode.includes('/api/student/performance/dashboard'), 'Points to /api/student/performance/dashboard');
        assert.ok(studentApiCode.includes('getPerformanceHistory(params = {})'), 'Defines getPerformanceHistory');
        assert.ok(studentApiCode.includes('/api/student/performance/history'), 'Points to /api/student/performance/history');
        assert.ok(studentApiCode.includes('getPerformanceAssessmentDetail(assessmentType, assessmentId)'), 'Defines getPerformanceAssessmentDetail');
        assert.ok(studentApiCode.includes('/api/student/performance/assessment/'), 'Points to /api/student/performance/assessment/');
    });

    test('2. StudentPerformanceView.jsx renders Section A Welcome & Overview with active test banner', () => {
        assert.ok(performanceViewCode.includes('Student Performance & Analytics'), 'Displays title');
        assert.ok(performanceViewCode.includes('Welcome back,'), 'Displays personalized greeting');
        assert.ok(performanceViewCode.includes('overview?.has_active_test'), 'Checks for active in-progress test');
        assert.ok(performanceViewCode.includes('Active Assessment In Progress'), 'Displays active test notice');
        assert.ok(performanceViewCode.includes('Resume Assessment'), 'Provides resume test CTA');
    });

    test('3. StudentPerformanceView.jsx renders Section B Compact 4-Card Performance Summary', () => {
        assert.ok(performanceViewCode.includes('Tests Completed'), 'Card 1: Total Tests Completed');
        assert.ok(performanceViewCode.includes('summary?.total_tests_completed'), 'Displays completed count');
        assert.ok(performanceViewCode.includes('Average Score'), 'Card 2: Average Score');
        assert.ok(performanceViewCode.includes('summary?.average_score'), 'Displays true average score');
        assert.ok(performanceViewCode.includes('Best Performance'), 'Card 3: Best Performance');
        assert.ok(performanceViewCode.includes('summary?.best_performance'), 'Displays best performance score');
        assert.ok(performanceViewCode.includes('Tests In Progress'), 'Card 4: Tests In Progress');
        assert.ok(performanceViewCode.includes('summary?.tests_in_progress'), 'Displays in progress count');
    });

    test('4. StudentPerformanceView.jsx renders Section C Interactive Recharts Performance Trends', () => {
        assert.ok(performanceViewCode.includes('Performance Trajectory Over Time'), 'Renders trend title');
        assert.ok(performanceViewCode.includes('AreaChart'), 'Uses Recharts AreaChart');
        assert.ok(performanceViewCode.includes('Area'), 'Uses Recharts Area element');
        assert.ok(performanceViewCode.includes('CustomTrendTooltip'), 'Renders custom tooltip');
        assert.ok(performanceViewCode.includes('trendFilter'), 'Supports category filtering on trend');
        assert.ok(performanceViewCode.includes('Single Test Completed'), 'Handles single test dataset safely');
        assert.ok(performanceViewCode.includes('No Assessment Data in This Category'), 'Handles empty dataset safely');
    });

    test('5. StudentPerformanceView.jsx renders Section D Assessment History with search, filters, and pagination', () => {
        assert.ok(performanceViewCode.includes('Assessment History & Test Dossiers'), 'Renders history heading');
        assert.ok(performanceViewCode.includes('searchQuery'), 'Supports search input');
        assert.ok(performanceViewCode.includes('selectedCategory'), 'Supports category filtering');
        assert.ok(performanceViewCode.includes('selectedStatus'), 'Supports status filtering');
        assert.ok(performanceViewCode.includes('sortBy'), 'Supports sorting by score and date');
        assert.ok(performanceViewCode.includes('currentPage'), 'Supports pagination');
        assert.ok(performanceViewCode.includes('rounds_summary'), 'Displays round-by-round pill breakdown');
    });

    test('6. StudentPerformanceView.jsx renders Section E Assessment Detail Modal with scores and feedback', () => {
        assert.ok(performanceViewCode.includes('AssessmentDetailModal'), 'Defines detail modal');
        assert.ok(performanceViewCode.includes('Section & Round Performance'), 'Displays round section performance');
        assert.ok(performanceViewCode.includes('Demonstrated Strengths'), 'Displays verified strengths');
        assert.ok(performanceViewCode.includes('Areas Needing Work'), 'Displays weak areas');
        assert.ok(performanceViewCode.includes('Open Full Assessment Dossier'), 'Links to full report dossier when available');
    });

    test('7. StudentPerformanceView.jsx renders Section F Skills & Strengths Analysis distinguishing evaluated vs resume', () => {
        assert.ok(performanceViewCode.includes('Evaluated Skill Proficiency'), 'Renders evaluated skills title');
        assert.ok(performanceViewCode.includes('Assessment Verified'), 'Badges assessment verified skills');
        assert.ok(performanceViewCode.includes('Profile & Stated Skills'), 'Contrasts with resume skills');
        assert.ok(performanceViewCode.includes('Resume Estimate'), 'Badges resume estimated skills');
        assert.ok(performanceViewCode.includes('Assessment vs. Resume:'), 'Explains score distinction clearly');
    });

    test('8. StudentPerformanceView.jsx renders Section G Recommended Next Steps linking to functional modules', () => {
        assert.ok(performanceViewCode.includes('Recommended Next Steps'), 'Renders next steps heading');
        assert.ok(performanceViewCode.includes('step.action_url'), 'Links to dynamic functional action URL');
        assert.ok(performanceViewCode.includes('step.action_label'), 'Renders action label');
        assert.ok(performanceViewCode.includes('High Impact'), 'Badges high priority recommendations');
    });

    test('9. StudentPerformanceView.jsx renders Section H Recent Activity Timeline', () => {
        assert.ok(performanceViewCode.includes('Recent Assessment & Learning Activity'), 'Renders activity heading');
        assert.ok(performanceViewCode.includes('recent_activity'), 'Maps recent activity stream');
        assert.ok(performanceViewCode.includes('formatted_time'), 'Displays friendly timestamp');
    });

    test('10. StudentDashboard.jsx integrates StudentPerformanceView with Segmented View Switcher', () => {
        assert.ok(studentDashboardCode.includes('StudentPerformanceView'), 'Imports StudentPerformanceView');
        assert.ok(studentDashboardCode.includes('Performance & Analytics'), 'Switcher includes Performance tab');
        assert.ok(studentDashboardCode.includes('Readiness & Profile Hub'), 'Switcher includes Readiness tab');
        assert.ok(studentDashboardCode.includes('activeTab'), 'Controls view toggle state');
        assert.ok(studentDashboardCode.includes('<StudentPerformanceView />'), 'Renders Performance View on performance tab');
    });

    test('11. App.jsx registers /student/performance route', () => {
        assert.ok(appCode.includes('path="/student/performance"'), 'Registers /student/performance route');
    });
});
