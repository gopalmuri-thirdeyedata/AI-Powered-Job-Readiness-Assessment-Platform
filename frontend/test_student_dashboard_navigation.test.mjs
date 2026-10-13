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

    test('4. Home.jsx redirects authenticated students to /student/dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'Home.jsx'), 'utf-8');
        assert.ok(fileContent.includes("navigate('/student/dashboard'"), 'Home.jsx must navigate to /student/dashboard');
    });

    test('5. StudentLogin.jsx defaults destination to /student/dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentLogin.jsx'), 'utf-8');
        assert.ok(fileContent.includes("'/student/dashboard'"), 'StudentLogin.jsx must fallback to /student/dashboard');
    });

    test('6. App.jsx redirects /student to /student/dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
        assert.ok(fileContent.includes('to="/student/dashboard"'), 'App.jsx must redirect /student to /student/dashboard');
    });

    test('7. StudentLayout.jsx syncs Clerk session or token smoothly', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
        assert.ok(fileContent.includes('clerk-sync') || fileContent.includes('useUser') || fileContent.includes('studentToken'), 'StudentLayout must handle auth cleanly');
    });

    test('8. RoleReadySetup.jsx has a link or navigation to Student Dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadySetup.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'RoleReadySetup must link to /student/dashboard');
    });

    test('9. RoleReadyReport.jsx has a link or navigation to Student Dashboard', () => {
        const fileContent = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadyReport.jsx'), 'utf-8');
        assert.ok(fileContent.includes('/student/dashboard'), 'RoleReadyReport must link to /student/dashboard');
    });
});
