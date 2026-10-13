import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentMockInterviewCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentMockInterview.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');

describe('Student Career Platform Phase 5 Frontend Test Suite', () => {

    test('1. App.jsx registers /student/interview route and imports StudentMockInterview', () => {
        assert.ok(appCode.includes("import StudentMockInterview from './pages/student/StudentMockInterview'"));
        assert.ok(appCode.includes('path="interview" element={<StudentMockInterview />}'));
    });

    test('2. StudentLayout navigation includes Mock Interview item with MessageSquare icon', () => {
        assert.ok(studentLayoutCode.includes('/student/interview'));
        assert.ok(studentLayoutCode.includes('Mock Interview'));
        assert.ok(studentLayoutCode.includes('MessageSquare'));
    });

    test('3. studentApi.js encapsulates all Phase 5 mock interview endpoints', () => {
        assert.ok(studentApiCode.includes('startMockInterview'));
        assert.ok(studentApiCode.includes('/api/student/mock-interview/start'));
        assert.ok(studentApiCode.includes('submitMockInterviewTurn'));
        assert.ok(studentApiCode.includes('/turn'));
        assert.ok(studentApiCode.includes('completeMockInterview'));
        assert.ok(studentApiCode.includes('/complete'));
        assert.ok(studentApiCode.includes('getMockInterviewHistory'));
        assert.ok(studentApiCode.includes('/api/student/mock-interview/history'));
        assert.ok(studentApiCode.includes('getMockInterviewDetail'));
    });

    test('4. StudentMockInterview renders track configuration and STAR guide', () => {
        assert.ok(studentMockInterviewCode.includes('Configure Your Practice Session'));
        assert.ok(studentMockInterviewCode.includes('Technical Depth'));
        assert.ok(studentMockInterviewCode.includes('Behavioral & HR'));
        assert.ok(studentMockInterviewCode.includes('How STAR Evaluation Works'));
        assert.ok(studentMockInterviewCode.includes('Situation'));
        assert.ok(studentMockInterviewCode.includes('Result'));
    });

    test('5. StudentMockInterview renders active interview turn with question and STAR response area', () => {
        assert.ok(studentMockInterviewCode.includes('Interviewer Question'));
        assert.ok(studentMockInterviewCode.includes('Your Response (STAR Format)'));
        assert.ok(studentMockInterviewCode.includes('Submit Answer'));
        assert.ok(studentMockInterviewCode.includes('Conclude Early'));
    });

    test('6. StudentMockInterview displays turn score, STAR breakdown, strengths and improvements', () => {
        assert.ok(studentMockInterviewCode.includes('Turn Evaluation Results'));
        assert.ok(studentMockInterviewCode.includes('Turn Score'));
        assert.ok(studentMockInterviewCode.includes('STAR Score'));
        assert.ok(studentMockInterviewCode.includes('Demonstrated Strengths'));
        assert.ok(studentMockInterviewCode.includes('High-Impact Refinements'));
    });

    test('7. StudentMockInterview renders comprehensive scorecard on session completion', () => {
        assert.ok(studentMockInterviewCode.includes('Mock Interview Scorecard'));
        assert.ok(studentMockInterviewCode.includes('STAR Structure'));
        assert.ok(studentMockInterviewCode.includes('Technical Depth'));
        assert.ok(studentMockInterviewCode.includes('Question-by-Question Transcript & Feedback'));
    });

    test('8. StudentMockInterview includes historical sessions log and review modal', () => {
        assert.ok(studentMockInterviewCode.includes('Previous Mock Interview Sessions'));
        assert.ok(studentMockInterviewCode.includes('Past Sessions'));
        assert.ok(studentMockInterviewCode.includes('View Report'));
    });
});
