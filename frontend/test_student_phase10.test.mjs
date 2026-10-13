import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');
const studentDashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDashboard.jsx'), 'utf-8');
const onboardingWizardCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'student', 'StudentOnboardingWizard.jsx'), 'utf-8');

describe('Student Enrollment & Onboarding Phase 10 Frontend Test Suite', () => {

    test('1. StudentOnboardingWizard.jsx exists and defines 4-step wizard interface', () => {
        assert.ok(onboardingWizardCode.includes('StudentOnboardingWizard'));
        assert.ok(onboardingWizardCode.includes('currentStep'));
        assert.ok(onboardingWizardCode.includes('Step {currentStep} of 4'));
        assert.ok(onboardingWizardCode.includes('Career Readiness Onboarding'));
    });

    test('2. StudentOnboardingWizard implements Step 1 Target Role and Target Company configuration', () => {
        assert.ok(onboardingWizardCode.includes('COMMON_ROLES'));
        assert.ok(onboardingWizardCode.includes('Full Stack Developer'));
        assert.ok(onboardingWizardCode.includes('targetRole'));
        assert.ok(onboardingWizardCode.includes('targetCompany'));
        assert.ok(onboardingWizardCode.includes('Target Dream Company (Optional)'));
    });

    test('3. StudentOnboardingWizard implements Step 2 Academic Background inputs', () => {
        assert.ok(onboardingWizardCode.includes('collegeName'));
        assert.ok(onboardingWizardCode.includes('branch'));
        assert.ok(onboardingWizardCode.includes('graduationYear'));
        assert.ok(onboardingWizardCode.includes('cgpa'));
        assert.ok(onboardingWizardCode.includes('College / University'));
        assert.ok(onboardingWizardCode.includes('Current CGPA (Out of 10.0)'));
    });

    test('4. StudentOnboardingWizard implements Step 3 Interactive Skills Selection with tags', () => {
        assert.ok(onboardingWizardCode.includes('SUGGESTED_SKILLS'));
        assert.ok(onboardingWizardCode.includes('handleAddSkill'));
        assert.ok(onboardingWizardCode.includes('handleRemoveSkill'));
        assert.ok(onboardingWizardCode.includes('customSkill'));
        assert.ok(onboardingWizardCode.includes('Suggested Skills:'));
    });

    test('5. StudentOnboardingWizard implements Step 4 Resume upload and final submission', () => {
        assert.ok(onboardingWizardCode.includes('resumeFile'));
        assert.ok(onboardingWizardCode.includes('handleFinalizeOnboarding'));
        assert.ok(onboardingWizardCode.includes('completeOnboarding'));
        assert.ok(onboardingWizardCode.includes('Complete & Launch Career Hub'));
    });

    test('6. studentApi.js exposes all Phase 10 onboarding API endpoints', () => {
        assert.ok(studentApiCode.includes('getOnboardingStatus()'));
        assert.ok(studentApiCode.includes('/api/student/onboarding/status'));
        assert.ok(studentApiCode.includes('saveOnboardingStep(stepData)'));
        assert.ok(studentApiCode.includes('/api/student/onboarding/step'));
        assert.ok(studentApiCode.includes('completeOnboarding('));
        assert.ok(studentApiCode.includes('/api/student/onboarding/complete'));
    });

    test('7. StudentDashboard.jsx queries onboarding status and displays progress banner for new students', () => {
        assert.ok(studentDashboardCode.includes('getOnboardingStatus'));
        assert.ok(studentDashboardCode.includes('onboardingStatus'));
        assert.ok(studentDashboardCode.includes('showOnboardingWizard'));
        assert.ok(studentDashboardCode.includes('Complete Your Career Profile Setup'));
        assert.ok(studentDashboardCode.includes('Step {onboardingStatus.onboarding_step || 1} of 4'));
    });

    test('8. StudentDashboard.jsx mounts and controls StudentOnboardingWizard modal with refresh callback', () => {
        assert.ok(studentDashboardCode.includes("import StudentOnboardingWizard from '../../components/student/StudentOnboardingWizard'"));
        assert.ok(studentDashboardCode.includes('<StudentOnboardingWizard'));
        assert.ok(studentDashboardCode.includes('isOpen={showOnboardingWizard}'));
        assert.ok(studentDashboardCode.includes('onClose={() => setShowOnboardingWizard(false)}'));
        assert.ok(studentDashboardCode.includes('loadDashboard()'));
    });
});
