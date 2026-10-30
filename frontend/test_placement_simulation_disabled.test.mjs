// Placement Simulation is switched off in BOTH student experiences (the real student portal and the admin "Student Dashboard Demo").
// These tests pin that no navigation entry, route, card, button or filter leads to it, and that every other student page is untouched.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

const REMAINING = ['Dashboard', 'Skill Gap', 'Roadmap', 'Coding', 'Practice', 'Mock Interview', 'Projects', 'Resume Analyzer', 'Resume Formatter', 'Profile'];

describe('Placement Simulation: navigation', () => {
    test('1. the sidebar list has exactly the other ten items, in their order, with their paths', async () => {
        const { navItems, primaryNavItems, allNavItems } = await loadModule('src/layouts/StudentLayout.jsx');
        assert.deepEqual(navItems.map((n) => n.label), REMAINING);
        assert.deepEqual(navItems.map((n) => n.path), ['/student/dashboard', '/student/skill-gap', '/student/roadmap', '/student/coding', '/student/practice',
            '/student/interview', '/student/projects', '/student/resume', '/student/resume-formatter', '/student/profile']);
        assert.equal(allNavItems.length, 10);
        assert.deepEqual(primaryNavItems.map((n) => n.label), ['Dashboard', 'Skill Gap', 'Roadmap', 'Coding', 'Practice'], 'the mobile bar is unchanged');
        assert.ok(navItems.every((n) => !/simulation/i.test(n.label + n.path)));
    });

    test('2. the demo sidebar is built from that same list, so the demo has no entry either', () => {
        const demo = read('src/layouts/StudentDemoLayout.jsx');
        assert.ok(demo.includes("import { navItems } from './StudentLayout'") && demo.includes('navItems.map('), 'one list feeds both sidebars');
        assert.ok(!/simulation/i.test(demo));
    });

    test('3. demo link mapping no longer knows the page', async () => {
        const { DEMO_PAGES, demoPathFor } = await loadModule('src/utils/studentDemo.js');
        assert.ok(!DEMO_PAGES.includes('simulation'));
        assert.equal(demoPathFor('/student/simulation'), null);
        assert.equal(demoPathFor('/student/hub/simulation'), null);
        assert.equal(demoPathFor('/student/interview'), '/admin/student-demo/interview', 'neighbouring pages still map');
    });
});

describe('Placement Simulation: routes', () => {
    const app = read('src/App.jsx');

    test('4. no route renders the page and nothing imports it; each old address redirects inside its own portal', () => {
        assert.ok(!app.includes('StudentPlacementSimulation'));
        const redirects = [...app.matchAll(/<Route path="([^"]*simulation)" element=\{<Navigate to="([^"]+)" replace \/>\} \/>/g)].map((m) => [m[1], m[2]]);
        assert.deepEqual(redirects, [['simulation', '/admin/student-demo'], ['simulation', '/student/hub'], ['/student/simulation', '/student/dashboard']]);
        // every redirect target is a real route
        for (const to of ['/admin/student-demo', '/student/hub', '/student/dashboard']) assert.ok(app.includes(`path="${to}"`), to);
    });

    test('5. the other student routes are all still there (demo, hub and /student/*)', () => {
        for (const slug of ['skill-gap', 'roadmap', 'practice', 'coding', 'interview', 'projects', 'resume', 'resume-formatter', 'profile']) {
            assert.ok(app.includes(`<Route path="/student/${slug}"`), `/student/${slug}`);
            assert.ok(app.includes(`<Route path="${slug}"`), `${slug} (demo and hub)`);
        }
        assert.equal((app.match(/<Route path="coding\/:slug"/g) || []).length, 2);
    });

    test('6. the assessment gate and the background preload no longer mention it', () => {
        const layout = read('src/layouts/StudentLayout.jsx');
        assert.ok(!/imulation/.test(layout));
        for (const page of ['StudentDashboard', 'StudentSkillGap', 'StudentRoadmap', 'StudentPractice', 'StudentCoding', 'StudentMockInterview', 'StudentProjects', 'StudentResumeUpload', 'StudentProfile']) {
            assert.ok(layout.includes(`import('../pages/student/${page}')`), `${page} is still preloaded`);
        }
    });
});

describe('Placement Simulation: no entry points left in the student interface', () => {
    test('7. dashboard: no card, button or link, and the card row is a 4-column grid again', () => {
        const dash = read('src/pages/student/StudentDashboard.jsx');
        assert.ok(!/\/student\/simulation|Simulate Drive|Simulation Drive|Placement Sim|placement_simulation|simulationStats|Try a placement drive/.test(dash));
        assert.ok(dash.includes('lg:grid-cols-4 gap-4'), 'four remaining cards fill the row');
        assert.ok(!dash.includes('lg:grid-cols-5 gap-4'));
        assert.ok(dash.includes(': null;') && dash.includes('{nextAction && ('), 'the suggested-action card simply is not shown when there is nothing left to suggest');
        for (const link of ['/student/practice', '/student/resume', '/student/roadmap', '/student/projects', 'startAssessment']) assert.ok(dash.includes(link), `${link} still there`);
    });

    test('8. performance view: no Simulate button, no resume-into-simulation link, no Simulations tab or filter option', () => {
        const view = read('src/components/student/StudentPerformanceView.jsx');
        assert.ok(!/\/student\/simulation|Simulate Drive|'SIMULATION'|"SIMULATION"|Placement Simulations|key: 'SIMULATION'/.test(view));
        for (const keep of ["key: 'ROLEREADY'", "key: 'MOCK_INTERVIEW'", '/student/interview', '/student/practice', 'Active Assessment In Progress']) assert.ok(view.includes(keep), keep);
    });

    test('9. demo sample data shows nothing about it', async () => {
        const data = await loadModule('src/services/studentDemoData.js');
        const text = JSON.stringify(data.default || data);
        assert.ok(!/placement_simulation|Placement Simulations|Placement Drive Simulation|SIMULATION/.test(text) && !/"simulation":/.test(text));
        const roadmap = read('src/services/demo/skillGapRoadmap.js');
        assert.ok(!/placement simulation/i.test(roadmap));
    });

    test('10. no student-facing source links to /student/simulation any more', () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) walk(rel);
                else if (/\.(jsx?|mjs)$/.test(e.name) && /(?<!\/api)\/student\/simulation|student-demo\/simulation/.test(read(rel))) hits.push(rel);
            }
        };
        walk('src');
        assert.deepEqual(hits.sort(), ['src/App.jsx'], 'only the redirect in App.jsx remains');
    });
});
