import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appCode = fs.readFileSync(path.join(__dirname, 'src', 'App.jsx'), 'utf-8');
const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const studentProjectsCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentProjects.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');

describe('Student Career Platform Phase 6 Frontend Test Suite', () => {

    test('1. App.jsx registers /student/projects route and imports StudentProjects', () => {
        assert.ok(appCode.includes("import StudentProjects from './pages/student/StudentProjects'"));
        assert.ok(appCode.includes('path="projects" element={<StudentProjects />}'));
    });

    test('2. StudentLayout navigation includes Projects item with FolderGit2 icon', () => {
        assert.ok(studentLayoutCode.includes('/student/projects'));
        assert.ok(studentLayoutCode.includes('Projects'));
        assert.ok(studentLayoutCode.includes('FolderGit2'));
    });

    test('3. studentApi.js encapsulates all Phase 6 project endpoints', () => {
        assert.ok(studentApiCode.includes('getProjects'));
        assert.ok(studentApiCode.includes('/api/student/projects'));
        assert.ok(studentApiCode.includes('createProject'));
        assert.ok(studentApiCode.includes('updateProject'));
        assert.ok(studentApiCode.includes('deleteProject'));
        assert.ok(studentApiCode.includes('analyzeProject'));
        assert.ok(studentApiCode.includes('/analyze'));
    });

    test('4. StudentProjects renders banner and project creation modal trigger', () => {
        assert.ok(studentProjectsCode.includes('Technical Projects & Architecture Review'));
        assert.ok(studentProjectsCode.includes('Portfolio Intelligence'));
        assert.ok(studentProjectsCode.includes('Add Project'));
    });

    test('5. StudentProjects renders project cards with completeness score and links', () => {
        assert.ok(studentProjectsCode.includes('Completeness'));
        assert.ok(studentProjectsCode.includes('completeness_score'));
        assert.ok(studentProjectsCode.includes('github_url'));
        assert.ok(studentProjectsCode.includes('live_url'));
    });

    test('6. StudentProjects displays system design and architectural critique section', () => {
        assert.ok(studentProjectsCode.includes('AI Architecture Review'));
        assert.ok(studentProjectsCode.includes('System Design & Architecture Critique'));
        assert.ok(studentProjectsCode.includes('Refresh Review'));
    });

    test('7. StudentProjects renders predicted technical interview questions', () => {
        assert.ok(studentProjectsCode.includes('Predicted Technical Interview Questions'));
        assert.ok(studentProjectsCode.includes('suggested_interview_questions'));
    });

    test('8. StudentProjects renders ATS-ready STAR bullet points with copy clipboard action', () => {
        assert.ok(studentProjectsCode.includes('ATS Resume Bullet Points (STAR Format)'));
        assert.ok(studentProjectsCode.includes('bullet_point_improvements'));
        assert.ok(studentProjectsCode.includes('handleCopyBullet'));
        assert.ok(studentProjectsCode.includes('navigator.clipboard.writeText'));
    });
});
