import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentDashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDashboard.jsx'), 'utf-8');
const studentResumeCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentResumeUpload.jsx'), 'utf-8');
const studentProfileCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentProfile.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');
const globalNavbarCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'GlobalNavbar.jsx'), 'utf-8');

describe('Student Career Platform Phase 1 Frontend Test Suite', () => {

    test('1. App.jsx registers dedicated /student routes and protects student layout', () => {
        assert.ok(appCode.includes("path=\"/student/login\""));
        assert.ok(appCode.includes("path=\"/student\""));
        assert.ok(appCode.includes("path=\"dashboard\""));
        assert.ok(appCode.includes("path=\"resume\""));
        assert.ok(appCode.includes("path=\"profile\""));
        assert.ok(appCode.includes("StudentDashboard"));
        assert.ok(appCode.includes("StudentResumeUpload"));
        assert.ok(appCode.includes("StudentProfile"));
        assert.ok(!appCode.includes("StudentLogin"), 'the separate student sign-in/registration page is gone: one login for everyone');
    });

    test('2. StudentLayout implements dedicated Student Career Hub navigation and auth guard', () => {
        assert.ok(studentLayoutCode.includes('/student/dashboard'));
        assert.ok(studentLayoutCode.includes('/student/resume'));
        assert.ok(studentLayoutCode.includes('/student/profile'));
        assert.ok(studentLayoutCode.includes('useAuth'), 'the layout follows the server-verified session');
        assert.ok(!studentLayoutCode.includes('studentToken'), 'no stored student token');
        assert.ok(studentLayoutCode.includes('Student Career Hub'));
        assert.ok(studentLayoutCode.includes('handleLogout'));
    });

    test('3. StudentDashboard displays all required Phase 1 metrics, indicators and recommendations', () => {
        // Placement Readiness Indicator & Disclaimer
        assert.ok(studentDashboardCode.includes('Placement Readiness'));
        assert.ok(studentDashboardCode.includes('Placement Readiness Indicator'));
        assert.ok(studentDashboardCode.includes('/ 100'));

        // Resume Score & Target Role/Company
        assert.ok(studentDashboardCode.includes('Resume Score'));
        assert.ok(studentDashboardCode.includes('Target Role'));
        assert.ok(studentDashboardCode.includes('Target Company'));

        // Your Strengths (✓) and Areas to Improve (⚠)
        assert.ok(studentDashboardCode.includes('Your Strengths'));
        assert.ok(studentDashboardCode.includes('Areas to Improve'));
        assert.ok(studentDashboardCode.includes('✓'));
        assert.ok(studentDashboardCode.includes('⚠'));

        // Resume Recommendations
        assert.ok(studentDashboardCode.includes('Resume Recommendations'));

        // 6-dimension readiness breakdown
        assert.ok(studentDashboardCode.includes('technical_skills'));
        assert.ok(studentDashboardCode.includes('ats_quality'));
    });

    test('4. StudentResumeUpload supports PDF/DOCX, versions V1/V2, 9-dimension analysis and missing info', () => {
        // Formats & Versions
        assert.ok(studentResumeCode.includes('.pdf,.docx,.doc'));
        assert.ok(studentResumeCode.includes('Version V'));

        // 9 Structured dimensions
        assert.ok(studentResumeCode.includes('Technical Skills'));
        assert.ok(studentResumeCode.includes('Soft Skills'));
        assert.ok(studentResumeCode.includes('Projects'));
        assert.ok(studentResumeCode.includes('Education'));
        assert.ok(studentResumeCode.includes('Experience'));
        assert.ok(studentResumeCode.includes('Certifications'));
        assert.ok(studentResumeCode.includes('DSA'));
        assert.ok(studentResumeCode.includes('ATS Compatibility'));
        assert.ok(studentResumeCode.includes('Quality'));

        // Missing information & anti-hallucination notice
        assert.ok(studentResumeCode.includes('Missing Information'));
        assert.ok(studentResumeCode.includes('never invents'));

        // Recommendations
        assert.ok(studentResumeCode.includes('Improvement Recommendations'));
    });

    test('5. StudentProfile allows selecting target role, optional company, education, and skills', () => {
        // Target Roles (the role list now lives in the shared profile form module)
        const profileFormCode = fs.readFileSync(path.join(__dirname, 'src', 'utils', 'profileForm.js'), 'utf-8');
        assert.ok(studentProfileCode.includes('COMMON_ROLES.map'));
        assert.ok(profileFormCode.includes('Software Engineer'));
        assert.ok(profileFormCode.includes('Full Stack Developer'));
        assert.ok(profileFormCode.includes('Python Developer'));
        assert.ok(profileFormCode.includes('Java Developer'));
        assert.ok(profileFormCode.includes('Data Engineer'));

        // Optional target company
        assert.ok(studentProfileCode.includes('Target Company'));

        // Education & graduation year
        assert.ok(studentProfileCode.includes('Graduation Year'));
        assert.ok(studentProfileCode.includes('Degree & Branch'));

        // Current skills
        assert.ok(studentProfileCode.includes('Current Skills'));
        assert.ok(studentProfileCode.includes('handleAddSkill'));
        assert.ok(studentProfileCode.includes('onRemove={() => setField(\'skills\''));
    });

    test('6. Student API service encapsulates all /api/student endpoints (cookie session, no token headers)', () => {
        assert.ok(studentApiCode.includes('/api/student/profile'));
        assert.ok(studentApiCode.includes('/api/student/resume/upload'));
        assert.ok(studentApiCode.includes('/api/student/resume'));
        assert.ok(studentApiCode.includes('/api/student/readiness'));
        assert.ok(studentApiCode.includes('/api/student/dashboard'));
        assert.ok(!studentApiCode.includes('/api/student/auth/login') && !studentApiCode.includes('/api/student/auth/register'), 'no student login/registration API: accounts are created by an administrator, sign-in is the single login');
        assert.ok(!studentApiCode.includes('studentToken') && !studentApiCode.includes('Authorization'), 'cookie session: no token headers or stored token');
    });

    test('7. there is no separate student login/registration/demo-account page: /student/login is an alias of the single login', () => {
        assert.ok(!fs.existsSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentLogin.jsx')));
        assert.match(appCode, /path="\/student\/login" element=\{<Navigate to="\/\?auth=login" replace \/>\}/);
    });

    test('8. GlobalNavbar conditionally displays Student Career Hub for STUDENT role', () => {
        assert.ok(globalNavbarCode.includes("profile.role === 'STUDENT'"));
        assert.ok(globalNavbarCode.includes('/student/dashboard'));
    });

    test('9. Existing Recruiter & Candidate routes remain completely intact', () => {
        // Recruiter
        assert.ok(appCode.includes('path="/dashboard"'));
        assert.ok(appCode.includes('path="/resume-screening"'));
        assert.ok(appCode.includes('path="/coding-round"'));
        assert.ok(appCode.includes('path="/aptitude-round"'));
        assert.ok(appCode.includes('path="/technical-interview"'));
        assert.ok(appCode.includes('path="/candidates"'));
        assert.ok(appCode.includes('path="/analytics"'));

        // Candidate
        assert.ok(appCode.includes('path="/portal"'));
        assert.ok(appCode.includes('path="assessment/coding"'));
        assert.ok(appCode.includes('path="assessment/aptitude"'));
        assert.ok(appCode.includes('path="assessment/interview"'));
    });
});
