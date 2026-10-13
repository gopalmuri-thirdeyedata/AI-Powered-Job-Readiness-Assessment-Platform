import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentPracticeCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentPractice.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');

describe('Student Career Platform Phase 4 Frontend Test Suite', () => {

    test('1. App.jsx registers /student/practice route and imports StudentPractice', () => {
        assert.ok(appCode.includes('import StudentPractice from \'./pages/student/StudentPractice\''));
        assert.ok(appCode.includes('path="practice" element={<StudentPractice />}'));
    });

    test('2. StudentLayout navigation includes Practice item', () => {
        assert.ok(studentLayoutCode.includes('/student/practice'));
        assert.ok(studentLayoutCode.includes('Practice'));
    });

    test('3. studentApi.js encapsulates all Phase 4 practice endpoints', () => {
        assert.ok(studentApiCode.includes('getPracticeTopics'));
        assert.ok(studentApiCode.includes('/api/student/practice/topics'));
        assert.ok(studentApiCode.includes('getPracticeQuestions'));
        assert.ok(studentApiCode.includes('/api/student/practice/questions'));
        assert.ok(studentApiCode.includes('submitPracticeAttempt'));
        assert.ok(studentApiCode.includes('/api/student/practice/submit'));
    });

    test('4. StudentPractice renders category controls and topic pills', () => {
        assert.ok(studentPracticeCode.includes('DSA & Aptitude Practice Sandbox'));
        assert.ok(studentPracticeCode.includes('DSA Coding'));
        assert.ok(studentPracticeCode.includes('Aptitude'));
        assert.ok(studentPracticeCode.includes('All Topics'));
    });

    test('5. StudentPractice renders a Python-only coding workspace with public test cases', () => {
        assert.ok(studentPracticeCode.includes('Source Code'));
        assert.ok(studentPracticeCode.includes('Python 3'));
        assert.ok(!studentPracticeCode.includes('JavaScript'));
        assert.ok(!studentPracticeCode.includes('<option value="java'));
        assert.ok(studentPracticeCode.includes('Public Sample Test Cases'));
    });

    test('6. StudentPractice renders aptitude MCQ choice selection', () => {
        assert.ok(studentPracticeCode.includes('Select the correct answer:'));
        assert.ok(studentPracticeCode.includes('selectedOption === opt.key'));
    });

    test('7. StudentPractice displays execution feedback and test case comparison', () => {
        assert.ok(studentPracticeCode.includes('submissionResult.is_correct'));
        assert.ok(studentPracticeCode.includes('Test Case #'));
        assert.ok(studentPracticeCode.includes('Concept Explanation:'));
    });

    test('8. StudentPractice keeps evaluation secure with server-side validation notice', () => {
        assert.ok(studentPracticeCode.includes('All hidden test cases and answer keys are securely evaluated server-side'));
        assert.ok(studentPracticeCode.includes('Submit Solution'));
    });
});
