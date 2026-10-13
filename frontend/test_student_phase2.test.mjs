import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentSkillGapCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentSkillGap.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');
const studentDashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDashboard.jsx'), 'utf-8');

describe('Student Career Platform Phase 2 Frontend Test Suite', () => {

    test('1. App.jsx registers /student/skill-gap route and imports StudentSkillGap', () => {
        assert.ok(appCode.includes('import StudentSkillGap from \'./pages/student/StudentSkillGap\''));
        assert.ok(appCode.includes('path="skill-gap" element={<StudentSkillGap />}'));
    });

    test('2. StudentLayout navigation includes Skill Gap item', () => {
        assert.ok(studentLayoutCode.includes('/student/skill-gap'));
        assert.ok(studentLayoutCode.includes('Skill Gap'));
    });

    test('3. studentApi.js encapsulates all Phase 2 skill intelligence endpoints', () => {
        assert.ok(studentApiCode.includes('getTargetRoles'));
        assert.ok(studentApiCode.includes('/api/student/target-roles'));
        assert.ok(studentApiCode.includes('getSkillGap'));
        assert.ok(studentApiCode.includes('/api/student/skill-gap'));
        assert.ok(studentApiCode.includes('simulateSkillGap'));
        assert.ok(studentApiCode.includes('/api/student/skill-gap/analyze'));
        assert.ok(studentApiCode.includes('getCareerPaths'));
        assert.ok(studentApiCode.includes('/api/student/career-paths'));
    });

    test('4. StudentSkillGap renders role benchmark switcher and match gauge', () => {
        assert.ok(studentSkillGapCode.includes('Target Benchmark:'));
        assert.ok(studentSkillGapCode.includes('Role Match Score'));
        assert.ok(studentSkillGapCode.includes('weighted alignment'));
        assert.ok(studentSkillGapCode.includes('Core Requirements'));
    });

    test('5. StudentSkillGap separates mandatory required from preferred skills', () => {
        assert.ok(studentSkillGapCode.includes('Mandatory Required Skills'));
        assert.ok(studentSkillGapCode.includes('Preferred & Bonus Skills'));
        assert.ok(studentSkillGapCode.includes('Missing Required Skills'));
        assert.ok(studentSkillGapCode.includes('Acquired Advantages'));
        assert.ok(studentSkillGapCode.includes('Growth Opportunities'));
    });

    test('6. StudentSkillGap integrates What-If interactive skill simulator', () => {
        assert.ok(studentSkillGapCode.includes('"What If?" Skill Simulator'));
        assert.ok(studentSkillGapCode.includes('Add to Simulation'));
        assert.ok(studentSkillGapCode.includes('Reset Simulation'));
        assert.ok(studentSkillGapCode.includes('simulatedSkills'));
    });

    test('7. StudentSkillGap includes interview process stages and cross-role matrix', () => {
        assert.ok(studentSkillGapCode.includes('Typical Interview Stages'));
        assert.ok(studentSkillGapCode.includes('Cross-Role Fit Assessment'));
        assert.ok(studentSkillGapCode.includes('Strategic Guidance'));
    });

    test('8. StudentDashboard links directly to Skill Gap analysis', () => {
        assert.ok(studentDashboardCode.includes('/student/skill-gap'));
        assert.ok(studentDashboardCode.includes('Skill Gap'));
    });
});
