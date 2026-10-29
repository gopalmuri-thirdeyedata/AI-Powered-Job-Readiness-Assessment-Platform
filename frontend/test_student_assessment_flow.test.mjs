import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const rel = (c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`;
// The SAME vectors the backend tests use: the live counter and the server can never disagree.
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backend', 'tests', 'data', 'word_count_cases.json'), 'utf-8'));

const REPORT = {
    assessment: { title: 'Backend Engineer', role: 'Backend Engineer', organization: 'Acme' },
    student: { name: 'Maya Patel', email: 'maya@students.example.org' },
    completed_at: '2030-01-15T10:00:00+00:00', overall_score: 88.5, overall_status: 'COMPLETED', scoring_model: 'equal_v1',
    sections: [
        { key: 'aptitude', label: 'Aptitude', status: 'EVALUATED', score: 80, time_spent_seconds: 600, summary: { correct: 12, total: 15 },
            questions: [{ question: 'What is 2+2?', selected: 'B', is_correct: true }] },
        { key: 'coding', label: 'Coding', status: 'EVALUATED', score: 100, time_spent_seconds: 900,
            problems: [{ title: 'Sum', language: 'python', passed_tests: 4, total_tests: 4, score: 100 }] },
        { key: 'interview', label: 'AI Technical Interview', status: 'EVALUATED', score: 85, time_spent_seconds: 700, summary: 'Clear answers.',
            key_strengths: ['Structure'], key_areas_for_improvement: ['Depth'], questions: [{ topic: 'SQL', question: 'Joins?', score: 85, feedback: 'Good' }] },
    ],
};

describe('Invited-student workflow (UI)', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = {}; globalThis.__axiosHandler = undefined; });

    // ---------------------------------------------------------------- review rules
    test('word counter matches the shared backend vectors exactly', async () => {
        const { countWords } = await loadModule('src/utils/wordCount.js');
        for (const c of CASES) assert.equal(countWords(c.text), c.words, c.name);
        assert.equal(countWords(null), 0);
        assert.equal(countWords(undefined), 0);
    });

    test('30 words is the threshold: 29 is rejected with a clear message, 30 and more are accepted', async () => {
        const { MIN_REVIEW_WORDS, reviewProblem, countWords } = await loadModule('src/utils/wordCount.js');
        const n = (k) => Array.from({ length: k }, () => 'w').join(' ');
        assert.equal(MIN_REVIEW_WORDS, 30);
        assert.match(reviewProblem(''), /at least 30 words/);
        assert.match(reviewProblem('   \n\t '), /at least 30 words/);
        assert.match(reviewProblem(n(18)), /Write 12 more words/);
        assert.match(reviewProblem(n(29)), /Write 1 more word\./);
        assert.equal(reviewProblem(n(30)), '');
        assert.equal(reviewProblem(n(31)), '');
        assert.match(reviewProblem(`  ${n(29)}\n\n   `), /Write 1 more word\./, 'padding and trailing line breaks do not lift 29 words to 30');
        assert.equal(countWords(`  ${n(29)}\n\n   `), 29, 'spaces and line breaks add no words');
        assert.equal(countWords(`${n(15)}\n\n\n${n(15)}`), 30, 'repeated line breaks separate words, they do not merge or add them');
    });

    // ---------------------------------------------------------------- API contract
    test('API: the student endpoints send no identity, no role and no registration details', async () => {
        const { studentAssessmentApi } = await loadModule('src/services/recruitmentApi.js');
        await studentAssessmentApi.access('TOKEN');
        await studentAssessmentApi.result('TOKEN');
        await studentAssessmentApi.submitReview('uuid-1', 'my review text');
        await studentAssessmentApi.getReport('uuid-1');
        const [access, result, review, report] = globalThis.__axiosCalls;
        assert.equal(rel(access), 'POST /api/student-assessment/TOKEN/access');
        assert.deepEqual(access.body, {}, 'nothing is sent: the server knows the signed-in student');
        assert.equal(rel(result), 'GET /api/student-assessment/TOKEN/result');
        assert.equal(rel(review), 'POST /api/student-assessment/attempts/uuid-1/review');
        assert.deepEqual(review.body, { review: 'my review text' }, 'only the review text: never a student id or role');
        assert.equal(rel(report), 'GET /api/student-assessment/attempts/uuid-1/report');
        assert.ok(globalThis.__axiosCalls.every((c) => !('Authorization' in c.headers)), 'the HttpOnly session cookie is the credential');
    });

    // ---------------------------------------------------------------- report PDF
    test('the report PDF is built from the server report only, and the file name is stable', async () => {
        const { buildReportPdf, reportFileName } = await loadModule('src/utils/studentReportPdf.js');
        assert.equal(reportFileName(REPORT, new Date('2030-02-03T00:00:00Z')), 'PrepWin-Assessment-Report-backend-engineer-2030-02-03.pdf');
        const doc = await buildReportPdf(REPORT);
        const bytes = Buffer.from(doc.output('arraybuffer'));
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.ok(bytes.length > 2000);
        await assert.rejects(() => buildReportPdf(null), /incomplete/);
        await assert.rejects(() => buildReportPdf({ sections: 'nope' }), /incomplete/);
    });

    // ---------------------------------------------------------------- page wiring
    test('the link page asks for email + password only: the old name / phone registration form is gone from this workflow', () => {
        const entry = read('src/pages/candidate/SharedAssessmentEntry.jsx');
        assert.ok(!entry.includes('CandidateRegistrationModal') && !entry.includes('candidateApi.register') && !entry.includes('handleRegister'));
        assert.ok(entry.includes('<StudentAccessLogin') && entry.includes('studentAssessmentApi.access'));
        const login = read('src/components/candidate/StudentAccessLogin.jsx');
        assert.ok(login.includes("import { login, logout } from '../../auth/authSession'"), 'the existing login, not a second authentication system');
        const inputs = login.match(/<input[\s\S]*?\/>/g) || [];
        assert.equal(inputs.length, 2, 'exactly email and password');
        assert.ok(inputs[0].includes('type="email"') && inputs[1].includes("type={show ? 'text' : 'password'}"));
        for (const tag of inputs) assert.ok(!/phone|full ?name|tel/i.test(tag), 'no name / phone field');
        const labels = (login.match(/<span className="text-xs font-bold[^>]*>([^<]+)<\/span>/g) || []).map((s) => s.replace(/<[^>]+>/g, ''));
        assert.deepEqual(labels, ['Email address', 'Password']);
        assert.ok(login.includes("data.role !== 'STUDENT'") && login.includes('await logout()'), 'an administrator is refused and not left signed in');
        // the account check and the redirect to the instructions keep the intended assessment: same URL, no query hand-off of identity
        assert.ok(entry.includes('navigate(instructionsPath, { replace: true })'));
        assert.ok(!entry.includes('candidateApi.start'), 'access never starts the attempt');
        assert.ok(entry.includes('registration_token') && entry.includes('handedToken'), 'the admin-authorised retake hand-off is untouched');
    });

    // ---------------------------------------------------------------- retake links
    test('retake: the token is only ever sent with the signed-in account, and only after the server has validated it', async () => {
        const { studentAssessmentApi, candidateApi } = await loadModule('src/services/recruitmentApi.js');
        await candidateApi.registrationInfo('SHARE', 'RETAKE');
        await studentAssessmentApi.access('SHARE', 'RETAKE');
        await studentAssessmentApi.access('SHARE');
        const [info, withToken, plain] = globalThis.__axiosCalls;
        assert.equal(rel(info), 'POST /api/public/assessment/SHARE/registration-info');
        assert.equal(info.headers['X-Registration-Token'], 'RETAKE');
        assert.equal(rel(withToken), 'POST /api/student-assessment/SHARE/access');
        assert.deepEqual(withToken.body, { retake_token: 'RETAKE' });
        assert.deepEqual(plain.body, {}, 'no token unless there is one');
    });

    test('retake: the entry page shows the login for a student retake, never saves the token before sign-in, and reads no redirect parameter', () => {
        const entry = read('src/pages/candidate/SharedAssessmentEntry.jsx');
        assert.ok(entry.includes('candidateApi.registrationInfo(shareToken, handedToken)'));
        assert.ok(entry.includes('info.student_login_required') && entry.includes("setRetake({ phase: 'login'"));
        const before = entry.slice(entry.indexOf('candidateApi.registrationInfo'), entry.indexOf('}, [handedToken, meta, shareToken'));
        const studentBranch = before.slice(before.indexOf('if (info.student_login_required)'), before.indexOf('} else {'));
        assert.ok(!studentBranch.includes('saveRegistration') && !studentBranch.includes('navigate('), 'a student retake token is not stored or followed before sign-in');
        assert.ok(entry.includes('studentAssessmentApi.access(shareToken, handedToken || undefined)'), 'the token travels with the signed-in account');
        assert.ok(entry.includes('This link cannot be used'), 'an invalid or used link is explained');
        for (const f of ['src/pages/candidate/SharedAssessmentEntry.jsx', 'src/components/candidate/StudentAccessLogin.jsx', 'src/pages/candidate/StudentAssessmentComplete.jsx']) {
            assert.ok(!/searchParams\.get\('(next|redirect|returnTo|return_to|continue|url)'\)/.test(read(f)), `${f} never reads a redirect target from the URL`);
        }
        // only the application's own routes are ever navigated to
        const targets = [...entry.matchAll(/navigate\(([^,)]+)/g)].map((m) => m[1].trim());
        assert.ok(targets.every((t) => ['instructionsPath', 'completePath', "'/student/dashboard'"].includes(t)), targets.join(', '));
    });

    test('the instructions page and the single start call site are unchanged', () => {
        const instructions = read('src/pages/candidate/ExamInstructions.jsx');
        assert.ok(instructions.includes('saveAcknowledgement(shareToken)') && !instructions.includes('candidateApi.start('));
        const adapter = read('src/services/assessmentApi.js');
        assert.equal(adapter.split('candidateApi.start(').length - 1, 1, 'exactly one call site for the backend start request');
    });

    test('completion page: counter, disabled Submit until 30 words, Download locked until the SERVER says the review is saved', () => {
        const src = read('src/pages/candidate/StudentAssessmentComplete.jsx');
        assert.ok(src.includes('{saved ? saved.word_count : words} / {MIN_REVIEW_WORDS} words'));
        assert.ok(src.includes('const canSubmit = !saved && !saving && !problem;') && src.includes('disabled={!canSubmit}'));
        assert.ok(src.includes('const saved = attempt.review;'), 'saved state comes from the server result, not from local component state');
        assert.ok(src.includes('const canDownload = !!saved && attempt.report_ready'));
        assert.ok(src.includes('disabled={!canDownload}'));
        assert.ok(src.includes('Submit your review to unlock your report.'));
        assert.ok(src.includes('Your review has been saved'));
        assert.ok(src.includes('studentAssessmentApi.submitReview(attempt.session_uuid, text)') && src.includes('studentAssessmentApi.getReport(attempt.session_uuid)'));
    });

    test('redirect: starts only after the download has been initiated, 5-10 s, once, cleaned up, never on failure, to the student dashboard', async () => {
        const mod = await loadModule('src/pages/candidate/StudentAssessmentComplete.jsx');
        assert.equal(mod.DASHBOARD_PATH, '/student/dashboard');
        assert.ok(mod.REDIRECT_SECONDS >= 5 && mod.REDIRECT_SECONDS <= 10);
        const src = read('src/pages/candidate/StudentAssessmentComplete.jsx');
        // the countdown effect depends only on `started`; ticks use a functional update so unrelated renders cannot restart it
        const timer = src.slice(src.indexOf('const started = '), src.indexOf('if (!isLoaded)'));
        assert.ok(timer.includes('setInterval') && timer.includes('return () => clearInterval(id)'), 'the interval is cleared on unmount');
        assert.ok(timer.includes('if (!started) return undefined;') && timer.includes('[started]'));
        assert.ok(timer.includes('setSecondsLeft((s) => s - 1)'));
        assert.ok(timer.includes("navigate(DASHBOARD_PATH, { replace: true })") && timer.includes('started && secondsLeft <= 0'));
        // 'started' is set only after the PDF hand-off resolved; the failure path sets 'error' and never touches the timer
        const download = src.slice(src.indexOf('const startDownload'), src.indexOf('return (\n        <CandidateShell'));
        assert.ok(download.indexOf('await downloadStudentReport(report)') < download.indexOf("phase: 'started'"));
        assert.ok(download.includes("phase: 'error'") && !/catch[\s\S]*navigate\(/.test(download), 'no redirect when the download fails');
        assert.ok(!src.includes('/admin'), 'never the admin dashboard');
        assert.ok(src.includes('Your report download has started.') && !/download(ed)? (is )?complete|finished downloading/i.test(src), 'only claims that it started');
    });

    test('finishing as a signed-in student leads to the completion page; other candidates keep the old screen; route is registered', () => {
        const page = read('src/pages/candidate/RecruitmentAssessmentPage.jsx');
        assert.ok(page.includes('hasStudentAccess(shareToken)') && page.includes('/complete'));
        assert.ok(page.includes('Thank you. Your responses have been received and will be reviewed by the hiring team.'));
        const app = read('src/App.jsx');
        assert.ok(app.includes('path="/assessment/join/:shareToken/complete"') && app.includes('StudentAssessmentComplete'));
        const session = read('src/services/assessmentSession.js');
        assert.ok(session.includes('saveStudentAccess') && !/localStorage/.test(session.replace(/Nothing candidate-related is ever written to localStorage\./, '').replace(/localStorage, sessionStorage/g, '')), 'still sessionStorage only');
    });

    test('no notification system and SMTP invitations / manual copy are untouched', () => {
        for (const f of ['src/pages/candidate/StudentAssessmentComplete.jsx', 'src/components/candidate/StudentAccessLogin.jsx']) {
            assert.ok(!/notification|Notification/.test(read(f)), f);
        }
        assert.ok(read('src/components/admin/ShareWithStudents.jsx').includes('Send Invitation'));
        assert.ok(read('src/components/admin/SharedLinkField.jsx').includes('Copy link'));
    });
});
