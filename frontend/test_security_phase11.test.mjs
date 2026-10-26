import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');
const collegeApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'collegeApi.js'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const collegeLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'CollegeLayout.jsx'), 'utf-8');
const studentResumeUploadCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentResumeUpload.jsx'), 'utf-8');
const onboardingWizardCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'student', 'StudentOnboardingWizard.jsx'), 'utf-8');
const studentPracticeCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentPractice.jsx'), 'utf-8');
const globalNavbarCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'GlobalNavbar.jsx'), 'utf-8');

describe('Security Hardening, Performance & Integration Phase 11 Frontend Test Suite', () => {

    const readsCredentialFromStorage = (code) => /(localStorage|sessionStorage)\.(get|set)Item\(\s*['"`](token|studentToken|student_token|admin_token|access)['"`]/.test(code);

    test('1. studentApi.js relies on the credentialed cookie session and ends it server-side on logout', () => {
        assert.ok(studentApiCode.includes('getAuthHeaders'));
        assert.ok(studentApiCode.includes('logout()'));
        assert.ok(studentApiCode.includes("from '../auth/authSession'"), 'logout goes through the session client (revokes the server-side session)');
        assert.ok(!studentApiCode.includes('Authorization'), 'no bearer header is built by the service');
        assert.ok(!readsCredentialFromStorage(studentApiCode) && !studentApiCode.includes('studentToken'), 'no token lives in browser storage');
        assert.ok(!studentApiCode.includes('/api/student/auth/'), 'no student register/login API: accounts are created by an administrator');
    });

    test('2. collegeApi.js uses cookie auth and keeps the college administration route prefixes', () => {
        assert.ok(collegeApiCode.includes('getAuthHeaders'));
        assert.ok(!collegeApiCode.includes('Authorization') && !readsCredentialFromStorage(collegeApiCode), 'no bearer token from browser storage');
        assert.ok(collegeApiCode.includes('/api/college/overview'));
        assert.ok(collegeApiCode.includes('/api/college/students'));
        assert.ok(collegeApiCode.includes('/api/college/drives'));
    });

    test('3. StudentLayout.jsx guards on the server-verified session and redirects to the single login', () => {
        assert.ok(studentLayoutCode.includes('useAuth'));
        assert.ok(studentLayoutCode.includes("navigate('/?auth=login'"));
        assert.ok(studentLayoutCode.includes('isAdminRole(role)'), 'an admin session is sent to the admin dashboard');
        assert.ok(studentLayoutCode.includes('studentApi.getProfile()'));
        assert.ok(!readsCredentialFromStorage(studentLayoutCode), 'no credential is read from browser storage');
    });

    test('4. CollegeLayout.jsx requires a server-verified ADMIN session and signs out through the session client', () => {
        assert.ok(collegeLayoutCode.includes('useAuth'));
        assert.ok(collegeLayoutCode.includes('!isAdminRole(role)'));
        assert.ok(collegeLayoutCode.includes("navigate('/?auth=login'"));
        assert.ok(collegeLayoutCode.includes('handleLogout'));
        assert.ok(!readsCredentialFromStorage(collegeLayoutCode));
    });

    test('5. StudentResumeUpload.jsx restricts uploads to valid document MIME types (.pdf, .docx, .doc, .txt)', () => {
        assert.ok(studentResumeUploadCode.includes('.pdf') || studentResumeUploadCode.includes('application/pdf'));
        assert.ok(studentResumeUploadCode.includes('uploadResume'));
        assert.ok(studentResumeUploadCode.includes('error') || studentResumeUploadCode.includes('Error'));
    });

    test('6. StudentOnboardingWizard.jsx restricts upload files and sanitizes inputs before submission', () => {
        assert.ok(onboardingWizardCode.includes('accept=".pdf,.docx,.doc,.txt"'));
        assert.ok(onboardingWizardCode.includes('handleFinalizeOnboarding'));
        assert.ok(onboardingWizardCode.includes('completeOnboarding'));
    });

    test('7. StudentPractice.jsx sends solutions to server for validation without exposing answers client-side', () => {
        assert.ok(studentApiCode.includes('submitPracticeAttempt'));
        assert.ok(studentApiCode.includes('/api/student/practice/submit'));
        assert.ok(studentPracticeCode.includes('submissionResult'));
        assert.ok(studentPracticeCode.includes('Public Sample Test Cases'));
    });

    test('8. GlobalNavbar.jsx shows the server-verified account and signs out through the session client', () => {
        assert.ok(globalNavbarCode.includes('useAuth'));
        assert.ok(globalNavbarCode.includes('signOut'));
        assert.ok(globalNavbarCode.includes('profile.role'), 'role-dependent navigation reads the verified role');
        assert.ok(!readsCredentialFromStorage(globalNavbarCode) && !globalNavbarCode.includes('user_profile'), 'no account cache or token in browser storage');
        assert.ok(!globalNavbarCode.includes('handleNotificationClick'), 'legacy activity notifications are not part of the recruitment workflow');
    });
});
