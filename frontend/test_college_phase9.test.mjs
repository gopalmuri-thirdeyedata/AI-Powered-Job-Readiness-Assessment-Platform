import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const collegeApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'collegeApi.js'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');
const collegeLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'CollegeLayout.jsx'), 'utf-8');
const collegeDashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'college', 'CollegeDashboard.jsx'), 'utf-8');
const collegeStudentsCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'college', 'CollegeStudents.jsx'), 'utf-8');
const collegeDrivesCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'college', 'CollegeDrives.jsx'), 'utf-8');
const studentDrivesCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDrives.jsx'), 'utf-8');

describe('College Placement Officer & Drives Phase 9 Frontend Test Suite', () => {

    test('1. App.jsx registers /college routes and /student/drives route', () => {
        assert.ok(appCode.includes("import CollegeLayout from './layouts/CollegeLayout'"));
        assert.ok(appCode.includes("import CollegeDashboard from './pages/college/CollegeDashboard'"));
        assert.ok(appCode.includes("import CollegeStudents from './pages/college/CollegeStudents'"));
        assert.ok(appCode.includes("import CollegeDrives from './pages/college/CollegeDrives'"));
        assert.ok(appCode.includes("import StudentDrives from './pages/student/StudentDrives'"));
        assert.ok(appCode.includes('path="/college" element={<CollegeLayout />}'));
        assert.ok(appCode.includes('path="drives" element={<StudentDrives />}'));
    });

    test('2. collegeApi.js encapsulates all Phase 9 college administration endpoints', () => {
        assert.ok(collegeApiCode.includes('getOverview()'));
        assert.ok(collegeApiCode.includes('/api/college/overview'));
        assert.ok(collegeApiCode.includes('getStudents'));
        assert.ok(collegeApiCode.includes('/api/college/students'));
        assert.ok(collegeApiCode.includes('getDrives'));
        assert.ok(collegeApiCode.includes('/api/college/drives'));
        assert.ok(collegeApiCode.includes('createDrive'));
        assert.ok(collegeApiCode.includes('getDriveApplications'));
        assert.ok(collegeApiCode.includes('updateApplicationStatus'));
        assert.ok(collegeApiCode.includes('/status'));
    });

    test('3. studentApi.js encapsulates student campus drive interaction endpoints', () => {
        assert.ok(studentApiCode.includes('getAvailableDrives()'));
        assert.ok(studentApiCode.includes('/api/student/drives'));
        assert.ok(studentApiCode.includes('applyToDrive('));
        assert.ok(studentApiCode.includes('/apply'));
        assert.ok(studentApiCode.includes('getDriveApplications()'));
    });

    test('4. CollegeLayout.jsx implements college placement administration shell and navigation', () => {
        assert.ok(collegeLayoutCode.includes('College Placement Office'));
        assert.ok(collegeLayoutCode.includes('/college/dashboard'));
        assert.ok(collegeLayoutCode.includes('/college/students'));
        assert.ok(collegeLayoutCode.includes('/college/drives'));
        assert.ok(collegeLayoutCode.includes('Cohort Overview'));
    });

    test('5. CollegeDashboard.jsx displays cohort analytics, tier breakdown, and skill gaps', () => {
        assert.ok(collegeDashboardCode.includes('Cohort Placement & Readiness Intelligence'));
        assert.ok(collegeDashboardCode.includes('High Readiness (≥ 75%)'));
        assert.ok(collegeDashboardCode.includes('Moderate Readiness (50-74%)'));
        assert.ok(collegeDashboardCode.includes('At-Risk Tier (&lt; 50%)'));
        assert.ok(collegeDashboardCode.includes('Top Technical Skills in Cohort'));
        assert.ok(collegeDashboardCode.includes('Cohort Skill Deficits & Training Needs'));
    });

    test('6. CollegeStudents.jsx renders student roster with search and filter controls', () => {
        assert.ok(collegeStudentsCode.includes('Student Placement Roster'));
        assert.ok(collegeStudentsCode.includes('Search student by name'));
        assert.ok(collegeStudentsCode.includes('All Branches'));
        assert.ok(collegeStudentsCode.includes('All Readiness Tiers'));
        assert.ok(collegeStudentsCode.includes('readiness_score'));
    });

    test('7. CollegeDrives.jsx provides drive creation and applicant review management', () => {
        assert.ok(collegeDrivesCode.includes('Campus Placement Drives'));
        assert.ok(collegeDrivesCode.includes('Create Placement Drive'));
        assert.ok(collegeDrivesCode.includes('package_lpa'));
        assert.ok(collegeDrivesCode.includes('minimum_cgpa'));
        assert.ok(collegeDrivesCode.includes('Applicants for'));
        assert.ok(collegeDrivesCode.includes('SHORTLISTED'));
        assert.ok(collegeDrivesCode.includes('PLACED'));
    });

    test('8. StudentDrives.jsx renders on-campus drives with real-time eligibility check', () => {
        assert.ok(studentDrivesCode.includes('Campus Placement Drives'));
        assert.ok(studentDrivesCode.includes('Available Drives'));
        assert.ok(studentDrivesCode.includes('My Applications'));
        assert.ok(studentDrivesCode.includes('ELIGIBLE'));
        assert.ok(studentDrivesCode.includes('INELIGIBLE'));
        assert.ok(studentDrivesCode.includes('Apply to Drive'));
    });
});
