import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const studentLayoutCode = fs.readFileSync(path.join(__dirname, 'src', 'layouts', 'StudentLayout.jsx'), 'utf-8');
const copilotDrawerCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'student', 'CareerCopilotDrawer.jsx'), 'utf-8');
const studentDashboardCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'student', 'StudentDashboard.jsx'), 'utf-8');
const studentApiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'studentApi.js'), 'utf-8');

describe('Student Career Platform Phase 8 Frontend Test Suite', () => {

    test('1. studentApi.js defines sendCopilotMessage targeting /api/student/copilot/chat', () => {
        assert.ok(studentApiCode.includes('sendCopilotMessage(content)'));
        assert.ok(studentApiCode.includes('/api/student/copilot/chat'));
    });

    test('2. studentApi.js defines getCopilotHistory and clearCopilotHistory endpoints', () => {
        assert.ok(studentApiCode.includes('getCopilotHistory()'));
        assert.ok(studentApiCode.includes('/api/student/copilot/history'));
        assert.ok(studentApiCode.includes('clearCopilotHistory()'));
    });

    test('3. studentApi.js defines getUnifiedDashboard targeting /api/student/dashboard/unified', () => {
        assert.ok(studentApiCode.includes('getUnifiedDashboard()'));
        assert.ok(studentApiCode.includes('/api/student/dashboard/unified'));
    });

    test('4. StudentLayout.jsx mounts CareerCopilotDrawer for universal access across student pages', () => {
        assert.ok(studentLayoutCode.includes("import CareerCopilotDrawer from '../components/student/CareerCopilotDrawer'"));
        assert.ok(studentLayoutCode.includes('<CareerCopilotDrawer />'));
    });

    test('5. CareerCopilotDrawer.jsx renders floating trigger launcher and slide-out drawer', () => {
        assert.ok(copilotDrawerCode.includes('Career Copilot'));
        assert.ok(copilotDrawerCode.includes('fixed bottom-6 right-6'));
        assert.ok(copilotDrawerCode.includes('fixed inset-y-0 right-0'));
        assert.ok(copilotDrawerCode.includes('Grounded AI'));
    });

    test('6. CareerCopilotDrawer.jsx provides contextual prompt suggestions and history clearance', () => {
        assert.ok(copilotDrawerCode.includes('Recommended Questions:'));
        assert.ok(copilotDrawerCode.includes('handleClearHistory'));
        assert.ok(copilotDrawerCode.includes('studentApi.clearCopilotHistory'));
        assert.ok(copilotDrawerCode.includes('handleSendMessage'));
    });

    test('7. StudentDashboard.jsx fetches and integrates unified dashboard preparatory metrics', () => {
        assert.ok(studentDashboardCode.includes('studentApi.getUnifiedDashboard()'));
        assert.ok(studentDashboardCode.includes('roadmapStats'));
        assert.ok(studentDashboardCode.includes('practiceStats'));
        assert.ok(studentDashboardCode.includes('interviewStats'));
        assert.ok(studentDashboardCode.includes('projectStats'));
        assert.ok(!studentDashboardCode.includes('simulationStats'), 'Placement Simulation is switched off');
    });

    test('8. StudentDashboard.jsx displays Multi-Factor Preparation Hub and Copilot recommendations', () => {
        assert.ok(studentDashboardCode.includes('Multi-Factor Preparation Hub'));
        assert.ok(studentDashboardCode.includes('Career Copilot Recommendations'));
        assert.ok(studentDashboardCode.includes('copilotSuggestions'));
        assert.ok(studentDashboardCode.includes('Placement Readiness Breakdown'));
    });
});
