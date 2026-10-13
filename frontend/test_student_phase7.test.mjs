import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentSimCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentPlacementSimulation.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');

describe('Student Career Platform Phase 7 Frontend Test Suite', () => {

    test('1. App.jsx registers /student/simulation route and imports StudentPlacementSimulation', () => {
        assert.ok(appCode.includes("import StudentPlacementSimulation from './pages/student/StudentPlacementSimulation'"));
        assert.ok(appCode.includes('path="simulation" element={<StudentPlacementSimulation />}'));
    });

    test('2. StudentLayout navigation includes Placement Simulation item with Award icon', () => {
        assert.ok(studentLayoutCode.includes('/student/simulation'));
        assert.ok(studentLayoutCode.includes('Placement Simulation'));
        assert.ok(studentLayoutCode.includes('Award'));
    });

    test('3. studentApi.js encapsulates all Phase 7 placement simulation endpoints', () => {
        assert.ok(studentApiCode.includes('startSimulation'));
        assert.ok(studentApiCode.includes('/api/student/simulation/start'));
        assert.ok(studentApiCode.includes('getActiveSimulation'));
        assert.ok(studentApiCode.includes('/api/student/simulation/active'));
        assert.ok(studentApiCode.includes('getSimulation'));
        assert.ok(studentApiCode.includes('submitSimulationRound'));
        assert.ok(studentApiCode.includes('/round/'));
        assert.ok(studentApiCode.includes('getSimulationHistory'));
        assert.ok(studentApiCode.includes('/api/student/simulation/history'));
    });

    test('4. StudentPlacementSimulation renders 4-round breakdown on drive setup', () => {
        assert.ok(studentSimCode.includes('End-to-End Campus Placement Drive Simulation'));
        assert.ok(studentSimCode.includes('Configure Your Placement Drive Simulation'));
        assert.ok(studentSimCode.includes('Aptitude & Reasoning'));
        assert.ok(studentSimCode.includes('Coding Assessment'));
        assert.ok(studentSimCode.includes('Technical Interview'));
        assert.ok(studentSimCode.includes('HR & Behavioral'));
    });

    test('5. StudentPlacementSimulation renders Round 1 Aptitude MCQs', () => {
        assert.ok(studentSimCode.includes('Quantitative & Logical Aptitude Section'));
        assert.ok(studentSimCode.includes('aptitudeAnswers'));
        assert.ok(studentSimCode.includes('Submit Round 1 & Advance to Coding'));
    });

    test('6. StudentPlacementSimulation renders Round 2 Coding Sandbox with test cases', () => {
        assert.ok(studentSimCode.includes('Sample Test Cases'));
        assert.ok(studentSimCode.includes('codeSubmission'));
        assert.ok(studentSimCode.includes('Submit Code & Advance to Technical Round'));
    });

    test('7. StudentPlacementSimulation renders Technical Architecture & HR STAR interview rounds', () => {
        assert.ok(studentSimCode.includes('System Design & Technical Architecture Round'));
        assert.ok(studentSimCode.includes('Behavioral & HR Round (Final Round)'));
        assert.ok(studentSimCode.includes('Your STAR-Method Response'));
        assert.ok(studentSimCode.includes('Complete Simulation & Generate Report'));
    });

    test('8. StudentPlacementSimulation displays comprehensive 4-round scorecard and history', () => {
        assert.ok(studentSimCode.includes('Placement Simulation Comprehensive Scorecard'));
        assert.ok(studentSimCode.includes('Overall Drive Score'));
        assert.ok(studentSimCode.includes('Previous Placement Simulation Drives'));
        assert.ok(studentSimCode.includes('Executive Drive Assessment'));
    });
});
