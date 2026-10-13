import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const authGuardCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'RoleReadyAuthGuard.jsx'), 'utf-8');
const studentLoginCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentLogin.jsx'), 'utf-8');
const publicNavbarCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'PublicNavbar.jsx'), 'utf-8');
const homeCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Home.jsx'), 'utf-8');
const dashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Dashboard.jsx'), 'utf-8');
const dashboardLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'DashboardLayout.jsx'), 'utf-8');
const clerkGuardCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'ClerkAdminGuard.jsx'), 'utf-8');
const candidateLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'CandidateLayout.jsx'), 'utf-8');
const collegeLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'CollegeLayout.jsx'), 'utf-8');
const globalNavbarCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'GlobalNavbar.jsx'), 'utf-8');
const rolereadyApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'rolereadyApi.js'), 'utf-8');
const candidatePortalCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'CandidateInvitationPortal.jsx'), 'utf-8');

describe('RoleReady Critical Repair — Authentication, Routing, and Integration Test Suite', () => {

    test('1. App.jsx protects all RoleReady assessment routes with RoleReadyAuthGuard', () => {
        assert.ok(appCode.includes('RoleReadyAuthGuard'), 'App.jsx must import RoleReadyAuthGuard');
        assert.ok(appCode.includes('<RoleReadyAuthGuard><RoleReadySetup /></RoleReadyAuthGuard>'), 'RoleReadySetup route must be guarded');
        assert.ok(appCode.includes('<RoleReadyAuthGuard><RoleReadyAssessment /></RoleReadyAuthGuard>'), 'RoleReadyAssessment route must be guarded');
        assert.ok(appCode.includes('<RoleReadyAuthGuard><RoleReadyReport /></RoleReadyAuthGuard>'), 'RoleReadyReport route must be guarded');
    });

    test('2. RoleReadyAuthGuard inspects session tokens and safely preserves redirect query', () => {
        assert.ok(authGuardCode.includes('studentToken') || authGuardCode.includes('token'), 'Guard must check session tokens');
        assert.ok(authGuardCode.includes('invitationToken'), 'Guard must check invitationToken');
        assert.ok(authGuardCode.includes('/?auth=student') || authGuardCode.includes('redirect'), 'Unauthenticated users must be routed to student authentication');
    });

    test('3. StudentLogin parses and honors the return destination query parameter', () => {
        assert.ok(studentLoginCode.includes('useSearchParams'), 'StudentLogin must use useSearchParams');
        assert.ok(studentLoginCode.includes('redirectParam'), 'StudentLogin must retrieve redirect param');
        assert.ok(studentLoginCode.includes('navigate(destination)'), 'StudentLogin must navigate to destination upon login');
    });

    test('4. PublicNavbar provides distinct flows for Student Assessment and Enterprise Sign In', () => {
        assert.ok(publicNavbarCode.includes('handleStudentClick'), 'PublicNavbar must define handleStudentClick');
        assert.ok(publicNavbarCode.includes('handleAdminClick'), 'PublicNavbar must define handleAdminClick');
        assert.ok(publicNavbarCode.includes('Student Sign In'), 'PublicNavbar must label student sign-in clearly');
        assert.ok(publicNavbarCode.includes('Admin Sign In') || publicNavbarCode.includes('Enterprise Workspace'), 'PublicNavbar must label admin sign-in clearly');
    });

    test('5. Home.jsx provides distinct student and admin authentication entry points', () => {
        assert.ok(homeCode.includes('openStudentSignIn'), 'Home.jsx must define openStudentSignIn');
        assert.ok(homeCode.includes('openAdminSignIn'), 'Home.jsx must define openAdminSignIn');
        assert.ok(homeCode.includes('ClerkAuthModal'), 'Home.jsx must integrate ClerkAuthModal');
    });

    test('6. Dashboard.jsx replaces old Hiring Control Panel and legacy command center with Assessment Management', () => {
        assert.ok(!dashboardCode.includes('Hiring Control Panel'), 'Old Hiring Control Panel title must not exist');
        assert.ok(dashboardCode.includes('Assessment Management'), 'Dashboard must render Assessment Management');
        assert.ok(dashboardCode.includes('Upload student resumes, send assessment invitations, and review results.'), 'Dashboard must have exact description');
        assert.ok(dashboardCode.includes('Assessment Tracking'), 'Dashboard must feature Assessment Tracking');
        assert.ok(dashboardCode.includes('listBatches') || dashboardCode.includes('getTrackingData'), 'Dashboard must load assessment tracking data');
        assert.ok(dashboardCode.includes('dispatchBatch') || dashboardCode.includes('createBatch'), 'Dashboard must support dispatching assessments');
        assert.ok(dashboardCode.includes('getBatchReport'), 'Dashboard must provide consolidated recruitment reports');
    });

    test('7. DashboardLayout replaces old navigation and Branding with RoleReady', () => {
        assert.ok(!dashboardLayoutCode.includes('Recruitment Pipeline'), 'Legacy Recruitment Pipeline section title must be replaced');
        assert.ok(dashboardLayoutCode.includes('RoleReady Assessment Suite'), 'DashboardLayout must render RoleReady Assessment Suite');
        assert.ok(!dashboardLayoutCode.includes('HiringAI</span>'), 'Mobile header must not render HiringAI branding');
        assert.ok(dashboardLayoutCode.includes('RoleReady</span>'), 'Mobile header must render RoleReady branding');
    });

    test('8. Active layout and guard components use RoleReady branding', () => {
        assert.ok(!clerkGuardCode.includes('HiringAI</span>'), 'ClerkAdminGuard must not render legacy HiringAI');
        assert.ok(clerkGuardCode.includes('RoleReady'), 'ClerkAdminGuard must render RoleReady');
        assert.ok(!candidateLayoutCode.includes('HiringAI</span>'), 'CandidateLayout must not render legacy HiringAI');
        assert.ok(candidateLayoutCode.includes('RoleReady</span>'), 'CandidateLayout must render RoleReady');
        assert.ok(!collegeLayoutCode.includes('HiringAI\n'), 'CollegeLayout must not render legacy HiringAI');
        assert.ok(collegeLayoutCode.includes('RoleReady'), 'CollegeLayout must render RoleReady');
        assert.ok(globalNavbarCode.includes('RoleReady Platform'), 'GlobalNavbar must render RoleReady Platform for platform admin');
    });

    test('9. Candidate invitation portal and API service persist and send invitation tokens', () => {
        assert.ok(candidatePortalCode.includes('localStorage.setItem(\'invitationToken\''), 'CandidateInvitationPortal must persist invitationToken');
        assert.ok(rolereadyApiCode.includes('X-Invitation-Token'), 'rolereadyApi must send X-Invitation-Token header');
    });
});
