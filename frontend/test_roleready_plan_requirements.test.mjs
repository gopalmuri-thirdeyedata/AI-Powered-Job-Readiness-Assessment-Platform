import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8');
const appCode = read('./src/App.jsx');
const assessmentCode = read('./src/pages/roleready/RoleReadyAssessment.jsx');
const tailwindCode = read('./tailwind.config.js');

describe('RoleReady implementation plan - frontend requirements', () => {
    test('REQ-02: /student/dashboard renders StudentDashboard instead of redirecting to setup', () => {
        assert.ok(!appCode.includes('path="/student/dashboard" element={<Navigate'));
        const route = appCode.slice(appCode.indexOf('path="/student/dashboard"'));
        assert.ok(route.slice(0, 200).includes('<StudentLayout />'));
        assert.ok(route.slice(0, 300).includes('<StudentDashboard />'));
    });

    test('REQ-06: the coding editor offers a language choice only for problems that carry several starters; every other problem stays Python', () => {
        assert.ok(assessmentCode.includes('const handleLanguageChange'));
        assert.ok(assessmentCode.includes('problemLanguages(problem).includes(language)'), 'a language the problem does not offer cannot be selected');
        assert.ok(assessmentCode.includes('DEFAULT_LANGUAGE'), 'Python remains the default and the fallback');
        assert.ok(!/java/i.test(assessmentCode.replace(/javascript/gi, '')), 'the language list lives in utils/codingLanguages.js, not hard-coded in the page');
    });

    test('Timers hydrate from the server-authoritative remaining_seconds for all three rounds', () => {
        // one helper reads the server's figures; every load path (aptitude, coding, interview + its fallback, session restore) uses it
        assert.strictEqual(assessmentCode.split("typeof res.remaining_seconds === 'number'").length - 1, 1);
        assert.strictEqual(assessmentCode.split("typeof res.overall_remaining_seconds === 'number'").length - 1, 1);
        assert.ok(assessmentCode.split('syncTiming(').length - 1 >= 6);
    });

    test('Canonical limits are shown: 20 minutes per section, 60 overall, equal split (no 15/30/15 left)', () => {
        assert.ok(assessmentCode.includes('aptitude: 20 * 60') && assessmentCode.includes('coding: 20 * 60') && assessmentCode.includes('interview: 20 * 60'));
        assert.ok(!assessmentCode.includes("mins: '15 Mins'") && !assessmentCode.includes("mins: '30 Mins'"));
        assert.strictEqual(assessmentCode.split("mins: '20 Mins'").length - 1, 3);
        assert.ok(assessmentCode.includes('aria-label="Overall time remaining"'), 'the overall 60-minute countdown is displayed');
    });

    test('REQ-15: brand palette tokens are unchanged', () => {
        assert.ok(tailwindCode.includes('#5d8c2c'));
        assert.ok(tailwindCode.includes('#00AEEF'));
        assert.ok(tailwindCode.includes('#F7F9FC'));
        assert.ok(tailwindCode.includes('#0B1220'));
    });

    test('Existing action labels are preserved', () => {
        assert.ok(assessmentCode.includes('Submit All & Unlock Interview'));
    });
});

describe('Student navigation destinations resolve to the intended modules', () => {
    const layoutCode = read('./src/layouts/StudentLayout.jsx');
    const expected = {
        'skill-gap': 'StudentSkillGap', roadmap: 'StudentRoadmap', practice: 'StudentPractice', coding: 'StudentCoding',
        interview: 'StudentMockInterview', simulation: 'StudentPlacementSimulation', projects: 'StudentProjects', resume: 'StudentResumeUpload', 'resume-formatter': 'StudentResumeFormatter', profile: 'StudentProfile',
    };
    const hubBlock = appCode.slice(appCode.indexOf('<Route path="/student/hub"'), appCode.indexOf('{/* College Placement'));
    const [hubPart, aliasPart] = hubBlock.split('<Route element={<StudentLayout />}>');

    test('each /student/<module> alias renders the intended existing component inside StudentLayout', () => {
        assert.ok(aliasPart, 'alias layout route missing');
        for (const [slug, comp] of Object.entries(expected)) {
            assert.ok(aliasPart.includes(`<Route path="/student/${slug}" element={<${comp} />} />`), slug);
        }
    });

    test('compatibility routes under /student/hub map to the same components', () => {
        for (const [slug, comp] of Object.entries(expected)) {
            assert.ok(hubPart.includes(`<Route path="${slug}" element={<${comp} />} />`), slug);
        }
    });

    test('components are the existing lazily imported pages (no duplicate pages)', () => {
        for (const comp of Object.values(expected)) {
            assert.ok(appCode.includes(`const ${comp} = lazy(() => import('./pages/student/${comp}'))`), comp);
        }
    });

    test('every sidebar link is served by a route', () => {
        const navPaths = [...layoutCode.matchAll(/path: '(\/student\/[a-z-]+)'/g)].map(m => m[1]);
        assert.strictEqual(navPaths.length, 11);
        for (const p of navPaths) {
            const slug = p.replace('/student/', '');
            assert.ok(slug === 'dashboard' || slug in expected, `${p} has no route`);
        }
        assert.ok(appCode.includes('path="/student/dashboard"'));
    });
});

describe('Interview integration capabilities', () => {
    test('RoleReady student assessment integrates conversational interview', () => {
        assert.ok(assessmentCode.includes('handleSubmitInterview'));
    });
});
