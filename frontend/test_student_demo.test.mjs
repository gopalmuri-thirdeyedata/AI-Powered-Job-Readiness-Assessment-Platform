import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoStudentApi, demoUnavailable } from './src/services/studentDemoApi.js';
import { DEMO_FORMATTED_RESUME, DEMO_RESUME_ANALYSIS, DEMO_JD_ANALYSIS, DEMO_SAMPLE_JOB_DESCRIPTION } from './src/services/studentDemoData.js';
import { STUDENT_DEMO_BASE, isStudentDemoPath, demoPathFor } from './src/utils/studentDemo.js';
import { buildBlocks } from './src/utils/resumeTemplates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8').replace(/\r\n/g, '\n');

describe('Student Dashboard Demo', () => {
    test('1. demo routes: only /admin/student-demo and below count, and real student links map to their demo page', () => {
        assert.equal(STUDENT_DEMO_BASE, '/admin/student-demo');
        assert.ok(isStudentDemoPath('/admin/student-demo') && isStudentDemoPath('/admin/student-demo/resume'));
        for (const other of ['/student/dashboard', '/admin/dashboard', '/admin/student-demos', '/']) assert.ok(!isStudentDemoPath(other), other);
        assert.equal(demoPathFor('/student/dashboard'), '/admin/student-demo');
        assert.equal(demoPathFor('/student/dashboard?tab=readiness'), '/admin/student-demo?tab=readiness');
        assert.equal(demoPathFor('/student/resume'), '/admin/student-demo/resume');
        assert.equal(demoPathFor('/student/resume-formatter/'), '/admin/student-demo/resume-formatter');
        for (const page of ['skill-gap', 'roadmap', 'practice', 'coding', 'interview', 'simulation', 'projects', 'profile']) {
            assert.equal(demoPathFor(`/student/${page}`), `/admin/student-demo/${page}`, page);
        }
        assert.equal(demoPathFor('/student/coding/two-sum'), '/admin/student-demo/coding/two-sum');
        assert.equal(demoPathFor('/student/hub/roadmap'), '/admin/student-demo/roadmap');
        for (const outside of ['/student/unknown', '/student/roadmap/extra', '/student/login', '/assessment/abc/report', '/assessment/setup']) assert.equal(demoPathFor(outside), null, outside);
    });

    test('2. the dashboard data is complete: scores, assessments, trends, performance tab and onboarding', async () => {
        const dash = await demoStudentApi.getDashboard();
        assert.ok(dash.student_name && dash.readiness_score > 0 && dash.resume_score > 0);
        assert.ok(dash.strengths.length && dash.areas_to_improve.length && dash.resume_recommendations.length);
        assert.ok(Object.keys(dash.readiness_breakdown).length >= 6);

        const unified = await demoStudentApi.getUnifiedDashboard();
        assert.ok(unified.roadmap.total_tasks > 0 && unified.practice.solved_count > 0 && unified.projects.total_projects > 0);
        assert.equal((await demoStudentApi.getOnboardingStatus()).is_onboarded, true, 'no onboarding wizard in the demo');

        const hist = await demoStudentApi.getAssessmentHistory();
        assert.ok(hist.total_completed > 0 && hist.assessments.length === hist.total_attempted && hist.trends.length && hist.areas_for_improvement.length);
        assert.equal(hist.active_session, null);
        for (const a of hist.assessments) assert.ok(a.is_completed && !a.report_url, 'no link out of the demo to a real report');

        const perf = await demoStudentApi.getPerformanceDashboard();
        assert.ok(perf.summary.total_tests_completed > 0 && perf.trends.data_points.length && perf.skills_analysis.assessment_skills.length);
        assert.ok(perf.recommended_next_steps.length && perf.recent_activity.length);
    });

    test('3. the performance history filters, sorts and pages like the real endpoint, and every row opens a detail', async () => {
        const all = await demoStudentApi.getPerformanceHistory({ page: 1, pageSize: 8 });
        assert.ok(all.total_count >= 5 && all.total_pages === 1);
        const mock = await demoStudentApi.getPerformanceHistory({ category: 'MOCK_INTERVIEW' });
        assert.ok(mock.items.length > 0 && mock.items.every((i) => i.category_key === 'MOCK_INTERVIEW'));
        assert.equal((await demoStudentApi.getPerformanceHistory({ status: 'ABANDONED' })).total_count, 0);
        const high = await demoStudentApi.getPerformanceHistory({ sortBy: 'score_desc' });
        assert.deepEqual(high.items.map((i) => i.score), [...high.items.map((i) => i.score)].sort((a, b) => b - a));
        for (const item of all.items) {
            const detail = await demoStudentApi.getPerformanceAssessmentDetail(item.category_key, item.raw_id);
            assert.equal(detail.test_name, item.test_name);
        }
    });

    test('4. Resume Analyzer opens with a saved sample resume and analysis; any upload shows it again', async () => {
        const saved = await demoStudentApi.getResume();
        assert.equal(saved.id, DEMO_RESUME_ANALYSIS.id);
        assert.ok(saved.version && saved.file_name && saved.overall_score > 0 && saved.analysis_json.technical_skills.skills.length);
        assert.ok(saved.recommendations.length && saved.strengths.length && saved.weaknesses.length && saved.missing_information.length);
        assert.equal((await demoStudentApi.uploadResume({ name: 'whatever.pdf' })).version, saved.version);
        const jd = await demoStudentApi.analyzeResumeWithJd({ resumeId: 1, jobDescription: 'x' });
        assert.equal(jd.match_score, DEMO_JD_ANALYSIS.match_score);
        assert.ok(['Strong', 'Good', 'Partial', 'Weak'].includes(jd.fit_verdict) && jd.matched_skills.length && jd.missing_skills.length);
        assert.ok(DEMO_SAMPLE_JOB_DESCRIPTION.trim().length >= 50, 'long enough to enable the Analyze button as it opens');
    });

    test('5. Resume Formatter has a complete sample resume for every section the three templates draw', async () => {
        const data = await demoStudentApi.formatResume({ resumeId: 1 });
        assert.equal(data.name, DEMO_FORMATTED_RESUME.name);
        const headings = buildBlocks(data).filter((b) => b.t === 'heading').map((b) => b.text);
        assert.deepEqual(headings, ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Achievements']);
        assert.equal(data.ai_generated, true, 'no "AI was unavailable" warning');
    });

    test('6. every other studentApi method rejects instead of reaching the network', async () => {
        await assert.rejects(demoUnavailable('updateProfile')(), (e) => e.response.status === 404 && /demo/.test(e.response.data.detail));
        assert.equal(demoStudentApi.saveOnboardingStep, undefined);
        assert.equal(demoStudentApi.completeOnboarding, undefined);
    });

    test('7. wiring: studentApi answers from sample data on a demo route, and the demo files never import the network client', () => {
        const api = read('src/services/studentApi.js');
        assert.ok(api.includes('new Proxy(realStudentApi') && api.includes('isStudentDemo()') && api.includes('demoStudentApi[name] || demoUnavailable(name)'));
        for (const f of ['src/services/studentDemoApi.js', 'src/services/studentDemoData.js', 'src/utils/studentDemo.js', 'src/layouts/StudentDemoLayout.jsx']) {
            assert.ok(!/from\s+['"]axios['"]|fetch\(|XMLHttpRequest|rolereadyApi|authSession/.test(read(f)), `${f} makes no network call`);
        }
    });

    test('8. wiring: the route sits under the admin guard, outside the student guard, and the sidebar links to it', () => {
        const app = read('src/App.jsx');
        const start = app.indexOf('path="/admin/student-demo"');
        assert.ok(start > 0);
        const block = app.slice(start, app.indexOf('</Route>', start));
        assert.ok(block.includes('<AdminGuard><StudentDemoLayout /></AdminGuard>'));
        for (const [route, el] of [['skill-gap', 'StudentSkillGap'], ['roadmap', 'StudentRoadmap'], ['practice', 'StudentPractice'], ['coding', 'StudentCoding'],
            ['coding/:slug', 'StudentCodingProblem'], ['interview', 'StudentMockInterview'], ['simulation', 'StudentPlacementSimulation'], ['projects', 'StudentProjects'],
            ['resume', 'StudentResumeUpload'], ['resume-formatter', 'StudentResumeFormatter'], ['profile', 'StudentProfile']]) {
            assert.ok(block.includes(`path="${route}" element={<${el} />}`), route);
        }
        assert.ok(block.includes('<Route index element={<StudentDashboard />} />'));
        assert.ok(!block.includes('<StudentLayout'), 'no student session or assessment checks');
        assert.ok(read('src/layouts/DashboardLayout.jsx').includes('label="Student Dashboard Demo" path={STUDENT_DEMO_BASE}'));
    });

    test('9. wiring: the resume tools open prefilled in the demo, and the demo never touches the real student browser state', () => {
        const fmt = read('src/pages/student/StudentResumeFormatter.jsx');
        assert.ok(fmt.includes('useState(() => (isStudentDemo() ? DEMO_FORMATTED_RESUME : null))'));
        assert.ok(fmt.includes('!demo && isUserLoaded && user?.id'), 'no saved-resume read/write in the demo');
        const jd = read('src/components/student-ui/ResumeJdAnalyzer.jsx');
        assert.ok(jd.includes('isStudentDemo() ? DEMO_SAMPLE_JOB_DESCRIPTION') && jd.includes('isStudentDemo() ? DEMO_JD_ANALYSIS'));
        const task = read('src/hooks/useStudentTaskStatus.js');
        for (const fn of ['markStudentTaskCompleted', 'clearStudentTaskCompleted']) {
            assert.match(task, new RegExp(`export const ${fn} = \\(email = null\\) => \\{\\n    if \\(isStudentDemo\\(\\)\\) return;`), fn);
        }
        const layout = read('src/layouts/StudentDemoLayout.jsx');
        assert.ok(layout.includes('startAssessment') && layout.includes('onClickCapture') && layout.includes('demoPathFor(href)'));
    });

    test('10. every studentApi / codingApi method a demo page calls has a demo handler (nothing falls through to the network)', async () => {
        const pages = ['StudentDashboard', 'StudentSkillGap', 'StudentRoadmap', 'StudentPractice', 'StudentCoding', 'StudentCodingProblem', 'StudentMockInterview',
            'StudentPlacementSimulation', 'StudentProjects', 'StudentResumeUpload', 'StudentResumeFormatter', 'StudentProfile'].map((n) => `src/pages/student/${n}.jsx`);
        const extra = ['src/components/student/StudentPerformanceView.jsx', 'src/components/student/CareerCopilotDrawer.jsx', 'src/components/student-ui/ResumeJdAnalyzer.jsx',
            'src/hooks/useStudentTaskStatus.js', 'src/layouts/StudentDemoLayout.jsx'];
        const used = new Set();
        for (const f of [...pages, ...extra]) for (const m of read(f).matchAll(/studentApi\.(\w+)/g)) used.add(m[1]);
        // StudentOnboardingWizard only opens for a student who is not onboarded; the demo student is.
        const missing = [...used].filter((name) => typeof demoStudentApi[name] !== 'function');
        assert.deepEqual(missing, []);
        const { codingHandlers } = await import('./src/services/demo/practiceCoding.js');
        const codingUsed = new Set();
        for (const f of ['src/pages/student/StudentCoding.jsx', 'src/pages/student/StudentCodingProblem.jsx']) for (const m of read(f).matchAll(/codingApi\.(\w+)/g)) codingUsed.add(m[1]);
        assert.deepEqual([...codingUsed].filter((n) => typeof codingHandlers[n] !== 'function'), []);
        assert.ok(read('src/services/codingApi.js').includes('isStudentDemo()'), 'codingApi answers from sample data in the demo');
        for (const f of fs.readdirSync(path.join(__dirname, 'src/services/demo'))) {
            assert.ok(!/from\s+['"]axios['"]|fetch\(|XMLHttpRequest/.test(read(`src/services/demo/${f}`)), `${f} makes no network call`);
        }
    });
});
