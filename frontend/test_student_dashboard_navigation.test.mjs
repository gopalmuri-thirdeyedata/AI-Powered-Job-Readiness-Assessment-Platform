import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Student Dashboard Navigation & Routing Test Suite', () => {

    test('1. RoleReadyNavbar provides prominent link to /student/dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'RoleReadyNavbar.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'RoleReadyNavbar must link to /student/dashboard');
        assert.ok(fileContent.includes('Dashboard'), 'RoleReadyNavbar must have Dashboard text or label');
    });

    test('2. PublicNavbar exposes Student Dashboard option when logged in', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'PublicNavbar.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'PublicNavbar must link to /student/dashboard');
        assert.ok(fileContent.includes('Student Dashboard'), 'PublicNavbar must render "Student Dashboard" label');
    });

    test('3. GlobalNavbar provides Student Dashboard option for STUDENT role', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'GlobalNavbar.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'GlobalNavbar must contain /student/dashboard');
        assert.ok(fileContent.includes('Student Dashboard'), 'GlobalNavbar must render "Student Dashboard"');
    });

    test('4. Home.jsx routes authenticated students to their dashboard and admins to the admin dashboard (by server-verified role)', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Home.jsx'), 'utf-8');
        assert.ok(fileContent.includes("navigate('/student/dashboard'"), 'Home.jsx must navigate students to /student/dashboard');
        assert.ok(fileContent.includes("role === 'STUDENT'") && fileContent.includes('isAdminRole(role)'), 'the role comes from the verified session');
        assert.ok(fileContent.includes("navigate('/admin/dashboard'"), 'Home.jsx must navigate admins to /admin/dashboard');
    });

    test('5. LoginModal.jsx sends students to /student/dashboard unless the server says otherwise', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'components', 'LoginModal.jsx'), 'utf-8');
        assert.ok(fileContent.includes("'/student/dashboard'"), 'LoginModal.jsx must fall back to /student/dashboard');
        assert.ok(fileContent.includes('data.redirect'), 'the destination is the one the server returned');
    });

    test('6. App.jsx redirects /student to /student/dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
        assert.ok(fileContent.includes('to="/student/dashboard"'), 'App.jsx must redirect /student to /student/dashboard');
    });

    test('7. StudentLayout.jsx follows the server-verified session (cookie), with no token juggling', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
        assert.ok(fileContent.includes('useAuth'), 'StudentLayout must handle auth cleanly');
        assert.ok(!/clerk/i.test(fileContent) && !fileContent.includes('studentToken'), 'no Clerk sync and no stored student token');
    });

    test('8. RoleReadySetup.jsx has a link or navigation to Student Dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadySetup.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'RoleReadySetup must link to /student/dashboard');
    });

    test('9. RoleReadyReport.jsx has a link or navigation to Student Dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadyReport.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'RoleReadyReport must link to /student/dashboard');
    });

    test('10. StudentLayout.jsx retains functional Take Assessment header button', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
        assert.ok(fileContent.includes('to="/assessment/setup"'), 'StudentLayout must link to /assessment/setup in header');
        assert.ok(fileContent.includes('Take Assessment'), 'StudentLayout must render "Take Assessment" button');
        assert.ok(fileContent.includes('id="student-topbar-assessment-btn"'), 'StudentLayout must retain assessment button ID');
    });

    test('11. StudentLayout.jsx sidebar excludes redundant Role Assessment item and preserves remaining items', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
        assert.ok(!fileContent.includes("label: 'Role Assessment'"), 'Sidebar navItems must not include Role Assessment');
        assert.ok(!fileContent.includes('label: "Role Assessment"'), 'Sidebar navItems must not include Role Assessment');
        
        // Confirm all remaining items exist (Resume became Resume Analyzer, Resume Formatter was added)
        const expectedItems = [
            'Dashboard', 'Skill Gap', 'Roadmap', 'Practice', 'Mock Interview',
            'Placement Simulation', 'Projects', 'Resume Analyzer', 'Resume Formatter', 'Profile'
        ];
        for (const item of expectedItems) {
            assert.ok(fileContent.includes(`label: '${item}'`), `Sidebar must retain ${item}`);
        }
    });
});

