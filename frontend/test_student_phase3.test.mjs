import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentRoadmapCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentRoadmap.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');

describe('Student Career Platform Phase 3 Frontend Test Suite', () => {

    test('1. App.jsx registers /student/roadmap route and imports StudentRoadmap', () => {
        assert.ok(appCode.includes('import StudentRoadmap from \'./pages/student/StudentRoadmap\''));
        assert.ok(appCode.includes('path="roadmap" element={<StudentRoadmap />}'));
    });

    test('2. StudentLayout navigation includes Roadmap item', () => {
        assert.ok(studentLayoutCode.includes('/student/roadmap'));
        assert.ok(studentLayoutCode.includes('Roadmap'));
    });

    test('3. studentApi.js encapsulates all Phase 3 roadmap endpoints', () => {
        assert.ok(studentApiCode.includes('getRoadmap'));
        assert.ok(studentApiCode.includes('/api/student/roadmap'));
        assert.ok(studentApiCode.includes('generateRoadmap'));
        assert.ok(studentApiCode.includes('/api/student/roadmap/generate'));
        assert.ok(studentApiCode.includes('updateDailyTaskStatus'));
        assert.ok(studentApiCode.includes('/api/student/daily-tasks/'));
    });

    test('4. StudentRoadmap renders plan title, target role and progress gauge', () => {
        assert.ok(studentRoadmapCode.includes('Active Plan'));
        assert.ok(studentRoadmapCode.includes('Target Role:'));
        assert.ok(studentRoadmapCode.includes('tasks completed'));
        assert.ok(studentRoadmapCode.includes('Roadmap Completion Progress'));
    });

    test('5. StudentRoadmap renders week navigation tabs and status filters', () => {
        assert.ok(studentRoadmapCode.includes('Week {w.week_number}'));
        assert.ok(studentRoadmapCode.includes('Filter:'));
        assert.ok(studentRoadmapCode.includes('setStatusFilter'));
    });

    test('6. StudentRoadmap renders task cards with category, effort and recommendation callout', () => {
        assert.ok(studentRoadmapCode.includes('Day {task.day_number}'));
        assert.ok(studentRoadmapCode.includes('estimated_minutes'));
        assert.ok(studentRoadmapCode.includes('Why Recommended:'));
        assert.ok(studentRoadmapCode.includes('CATEGORY_CONFIG'));
    });

    test('7. StudentRoadmap supports interactive status toggling and completed state', () => {
        assert.ok(studentRoadmapCode.includes('handleTaskStatusChange'));
        assert.ok(studentRoadmapCode.includes('COMPLETED'));
        assert.ok(studentRoadmapCode.includes('IN_PROGRESS'));
        assert.ok(studentRoadmapCode.includes('Start Task'));
    });

    test('8. StudentRoadmap includes safe regeneration dialog preserving completed progress', () => {
        assert.ok(studentRoadmapCode.includes('Regenerate Preparation Plan?'));
        assert.ok(studentRoadmapCode.includes('completed task(s) will be strictly preserved'));
        assert.ok(studentRoadmapCode.includes('handleRegenerateRoadmap'));
    });
});
