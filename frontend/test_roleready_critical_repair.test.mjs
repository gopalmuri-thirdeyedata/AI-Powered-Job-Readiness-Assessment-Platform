import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const authGuardCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'RoleReadyAuthGuard.jsx'), 'utf-8');
const loginModalCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'LoginModal.jsx'), 'utf-8');
const publicNavbarCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'PublicNavbar.jsx'), 'utf-8');
const homeCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Home.jsx'), 'utf-8');
const dashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Dashboard.jsx'), 'utf-8');
const dashboardLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'DashboardLayout.jsx'), 'utf-8');
const adminGuardCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'AdminGuard.jsx'), 'utf-8');
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

    test('2. RoleReadyAuthGuard trusts the server-verified session, honours invitation tokens and routes everyone else to the single login', () => {
        assert.ok(authGuardCode.includes('useAuth'), 'Guard must read the server-verified session');
        assert.ok(authGuardCode.includes('invitationToken'), 'Guard must check invitationToken');
        assert.ok(authGuardCode.includes('/?auth=login'), 'Unauthenticated users must be routed to the single login');
        assert.ok(!/localStorage\.(get|set)Item\((['"])(student_?[Tt]oken|token|admin_token)/.test(authGuardCode), 'no credential is read from browser storage');
    });

    test('3. LoginModal is the one login: server-decided destination, no sign-up, no secret persisted', () => {
        assert.ok(loginModalCode.includes("from '../auth/authSession'"), 'LoginModal must sign in through the cookie-session client');
        assert.ok(loginModalCode.includes('data.redirect'), 'the destination comes from the server response (role verified server-side)');
        assert.ok(!/sign ?up|register/i.test(loginModalCode.replace(/Accounts are created by your administrator[^<]*/, '')), 'no sign-up path in the login');
        assert.ok(!/localStorage|sessionStorage/.test(loginModalCode), 'the login never writes to browser storage');
        assert.ok(!/clerk/i.test(loginModalCode), 'no Clerk dependency');
        assert.ok(!appCode.includes('/signup'), 'App.jsx must not route a public sign-up page');
    });

    test('4. PublicNavbar offers a single Sign In that opens the one login', () => {
        assert.ok(publicNavbarCode.includes('handleSignInClick'), 'PublicNavbar must define handleSignInClick');
        assert.ok(publicNavbarCode.includes('onOpenSignIn'), 'PublicNavbar must open the login modal through onOpenSignIn');
        assert.ok(publicNavbarCode.includes('Sign In'), 'PublicNavbar must label sign-in clearly');
        assert.ok(!publicNavbarCode.includes('Student Sign In') && !publicNavbarCode.includes('Admin Sign In'), 'one login, not two portals');
    });

    test('5. Home.jsx opens the single LoginModal and routes signed-in users by their server-verified role', () => {
        assert.ok(homeCode.includes('openSignIn'), 'Home.jsx must define openSignIn');
        assert.ok(homeCode.includes('LoginModal'), 'Home.jsx must integrate LoginModal');
        assert.ok(!homeCode.includes('ClerkAuthModal'), 'Clerk modal is gone');
    });

    test('6. Dashboard.jsx replaces old Hiring Control Panel and legacy command center with Assessment Management', () => {
        assert.ok(!dashboardCode.includes('Hiring Control Panel'), 'Old Hiring Control Panel title must not exist');
        assert.ok(dashboardCode.includes('Assessment Management'), 'Dashboard must render Assessment Management');
        assert.ok(dashboardCode.includes('Create job assessments, share assessment links, and review candidate results.'), 'Dashboard describes the shared-link workflow');
        assert.ok(!dashboardCode.includes('Upload student resumes, send assessment invitations'), 'the old invitation description no longer misdescribes the workspace');
        assert.ok(!dashboardCode.includes('dispatchBatch') && !dashboardCode.includes('getTrackingData'), 'the legacy email-invitation flow is not part of the workspace');
    });

    test('7. DashboardLayout replaces old navigation and Branding with PrepWin', () => {
        assert.ok(!dashboardLayoutCode.includes('Recruitment Pipeline'), 'Legacy Recruitment Pipeline section title must be replaced');
        assert.ok(dashboardLayoutCode.includes('PrepWin Assessment Suite'), 'DashboardLayout must render PrepWin Assessment Suite');
        assert.ok(!dashboardLayoutCode.includes('HiringAI</span>'), 'Mobile header must not render HiringAI branding');
        assert.ok(dashboardLayoutCode.includes('PrepWin</span>'), 'Mobile header must render PrepWin branding');
    });

    test('8. Active layout and guard components use PrepWin branding', () => {
        assert.ok(!adminGuardCode.includes('HiringAI</span>'), 'AdminGuard must not render legacy HiringAI');
        assert.ok(adminGuardCode.includes('PrepWin'), 'AdminGuard must render PrepWin');
        assert.ok(!candidateLayoutCode.includes('HiringAI</span>'), 'CandidateLayout must not render legacy HiringAI');
        assert.ok(candidateLayoutCode.includes('PrepWin</span>'), 'CandidateLayout must render PrepWin');
        assert.ok(!collegeLayoutCode.includes('HiringAI\n'), 'CollegeLayout must not render legacy HiringAI');
        assert.ok(collegeLayoutCode.includes('PrepWin'), 'CollegeLayout must render PrepWin');
        assert.ok(globalNavbarCode.includes('PrepWin'), 'GlobalNavbar must render PrepWin branding');
    });

    test('9. Candidate invitation portal and API service persist and send invitation tokens', () => {
        assert.ok(candidatePortalCode.includes('localStorage.setItem(\'invitationToken\''), 'CandidateInvitationPortal must persist invitationToken');
        assert.ok(rolereadyApiCode.includes('X-Invitation-Token'), 'rolereadyApi must send X-Invitation-Token header');
    });
});
