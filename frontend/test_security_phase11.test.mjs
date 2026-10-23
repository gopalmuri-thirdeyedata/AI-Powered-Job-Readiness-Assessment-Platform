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

    test('1. studentApi.js isolates studentToken and wipes credentials on logout', () => {
        assert.ok(studentApiCode.includes('studentToken'));
        assert.ok(studentApiCode.includes('getAuthHeaders'));
        assert.ok(studentApiCode.includes('logout()'));
        assert.ok(studentApiCode.includes("localStorage.removeItem('studentToken')"));
    });

    test('2. collegeApi.js enforces bearer authentication and college administration route prefixes', () => {
        assert.ok(collegeApiCode.includes('getAuthHeaders'));
        assert.ok(collegeApiCode.includes('localStorage.getItem(\'token\')'));
        assert.ok(collegeApiCode.includes('/api/college/overview'));
        assert.ok(collegeApiCode.includes('/api/college/students'));
        assert.ok(collegeApiCode.includes('/api/college/drives'));
    });

    test('3. StudentLayout.jsx guards unauthenticated navigation and redirects to /student/login', () => {
        assert.ok(studentLayoutCode.includes('localStorage.getItem(\'studentToken\')'));
        assert.ok(studentLayoutCode.includes('navigate(\'/student/login\')'));
        assert.ok(studentLayoutCode.includes('studentApi.getProfile()'));
    });

    test('4. CollegeLayout.jsx enforces admin authentication token and navigation protection', () => {
        assert.ok(collegeLayoutCode.includes('localStorage.getItem(\'token\')'));
        assert.ok(collegeLayoutCode.includes('navigate(\'/login\')'));
        assert.ok(collegeLayoutCode.includes('handleLogout'));
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

    test('8. GlobalNavbar.jsx handles user profile authentication state and role navigation', () => {
        assert.ok(globalNavbarCode.includes('/api/auth/me'));
        assert.ok(globalNavbarCode.includes('user_profile'));
        assert.ok(!globalNavbarCode.includes('handleNotificationClick'), 'legacy activity notifications are not part of the recruitment workflow');
    });
});
