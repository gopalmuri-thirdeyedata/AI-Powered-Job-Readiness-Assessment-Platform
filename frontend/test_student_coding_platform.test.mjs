// LeetCode-style coding workspace: the pure helpers are exercised directly; wiring (routes, nav, gate, API paths) is checked in the source.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf-8');
const load = () => loadModule('src/utils/codingPlatform.js');

describe('codingPlatform helpers', () => {
    test('every server verdict has a label and a tone; unknown ones degrade safely', async () => {
        const { verdictInfo } = await load();
        for (const v of ['ACCEPTED', 'WRONG_ANSWER', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'COMPILE_ERROR', 'OUTPUT_ERROR']) {
            const info = verdictInfo(v);
            assert.ok(info.label && ['good', 'bad', 'warn'].includes(info.tone), v);
        }
        assert.equal(verdictInfo('ACCEPTED').tone, 'good');
        assert.equal(verdictInfo('SOMETHING_NEW').label, 'SOMETHING_NEW');
        assert.equal(verdictInfo(undefined).label, 'Unknown');
    });

    test('errorMessage always returns text, never an object a React child could choke on', async () => {
        const { errorMessage } = await load();
        const err = (detail, status = 400) => ({ response: { status, data: { detail } } });
        assert.equal(errorMessage(err('Write some code first.')), 'Write some code first.');
        assert.equal(errorMessage(err([{ msg: 'field required' }, { msg: 'too long' }], 422)), 'field required; too long');
        assert.equal(errorMessage(err({ code: 'X', message: 'Locked' }, 403)), 'Locked');
        assert.equal(typeof errorMessage(err({ code: 'X' }, 403)), 'string');
        assert.match(errorMessage({ response: { status: 429, data: {} } }), /wait/i);
        assert.match(errorMessage({ message: 'Network Error' }), /reach the server/i);
        assert.equal(errorMessage(null, 'fallback'), 'fallback');
    });

    test('drafts survive a missing or throwing storage and round-trip through a working one', async () => {
        const { loadDraft, saveDraft, clearDraft, draftKey } = await load();
        const store = new Map();
        const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
        saveDraft('two-sum', 'print(1)', ok);
        assert.equal(loadDraft('two-sum', ok), 'print(1)');
        assert.ok(store.has(draftKey('two-sum')));
        clearDraft('two-sum', ok);
        assert.equal(loadDraft('two-sum', ok), null);
        const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
        assert.equal(loadDraft('x', boom), null);
        assert.doesNotThrow(() => { saveDraft('x', 'y', boom); clearDraft('x', boom); });
        assert.equal(loadDraft('x', undefined), null);
    });

    test('the editor starts from the draft, then the last submission, then the starter', async () => {
        const { pickInitialCode } = await load();
        assert.equal(pickInitialCode({ draft: 'D', lastCode: 'L', starter: 'S' }), 'D');
        assert.equal(pickInitialCode({ draft: '  ', lastCode: 'L', starter: 'S' }), 'L');
        assert.equal(pickInitialCode({ draft: null, lastCode: null, starter: 'S' }), 'S');
        assert.equal(pickInitialCode({}), '');
    });

    test("LeetCode shortcuts: Ctrl/Cmd + ' runs and Ctrl/Cmd + Enter submits", async () => {
        const { isRunShortcut, isSubmitShortcut } = await load();
        assert.ok(isRunShortcut({ ctrlKey: true, key: "'" }));
        assert.ok(isRunShortcut({ metaKey: true, code: 'Quote' }));
        assert.ok(!isRunShortcut({ key: "'" }));
        assert.ok(isSubmitShortcut({ ctrlKey: true, key: 'Enter' }));
        assert.ok(!isSubmitShortcut({ key: 'Enter' }));
        assert.ok(!isRunShortcut(null) && !isSubmitShortcut(undefined));
    });

    test('statements parse to safe tokens: markup stays text, code and bold are recognised', async () => {
        const { parseInline, parseBlocks } = await load();
        assert.deepEqual(parseInline('Return `nums` and **all** of <b>it</b>'), [
            { type: 'text', value: 'Return ' }, { type: 'code', value: 'nums' }, { type: 'text', value: ' and ' },
            { type: 'bold', value: 'all' }, { type: 'text', value: ' of <b>it</b>' },
        ]);
        assert.deepEqual(parseBlocks('First paragraph\nstill first\n\n- a\n- b\n\nLast'), [
            { type: 'paragraph', text: 'First paragraph still first' }, { type: 'list', items: ['a', 'b'] }, { type: 'paragraph', text: 'Last' },
        ]);
        assert.deepEqual(parseBlocks(''), []);
    });

    test('runtime and memory are shown in friendly units', async () => {
        const { formatRuntime, formatMemory } = await load();
        assert.equal(formatRuntime(12.4), '12 ms');
        assert.equal(formatRuntime(null), '–');
        assert.equal(formatMemory(512), '512 KB');
        assert.equal(formatMemory(2048), '2.0 MB');
        assert.equal(formatMemory(0), '–');
    });
});

describe('activity heatmap', () => {
    test('colour levels step up with the number of submissions', async () => {
        const { heatLevel } = await load();
        assert.deepEqual([0, 1, 2, 3, 4, 6, 7, 50].map(heatLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
    });

    test('twelve weeks end today, line up on weekdays and carry each day\'s count', async () => {
        const { buildHeatmap } = await load();
        const today = new Date(Date.UTC(2026, 9, 28, 20, 0));      // Wednesday 28 Oct 2026 (UTC)
        const weeks = buildHeatmap({ '2026-10-28': 3, '2026-10-20': 1, '2000-01-01': 9 }, 84, today);
        const cells = weeks.flat().filter(Boolean);
        assert.equal(cells.length, 84);
        assert.equal(cells.at(-1).date, '2026-10-28');
        assert.equal(cells.at(-1).count, 3);
        assert.equal(cells.at(-1).level, 2);
        assert.equal(cells.find((c) => c.date === '2026-10-20').level, 1);
        assert.ok(weeks.slice(0, -1).every((w) => w.length === 7), 'every full week has seven rows');
        weeks.forEach((w) => w.forEach((cell, row) => { if (cell) assert.equal(cell.weekday, row, `${cell.date} sits on its weekday row`); }));
        assert.ok(!cells.some((c) => c.date === '2000-01-01'), 'activity outside the window is ignored');
    });

    test('an empty or missing activity map still produces a full grid of empty cells', async () => {
        const { buildHeatmap } = await load();
        for (const input of [undefined, null, {}]) {
            const cells = buildHeatmap(input, 84, new Date(Date.UTC(2026, 0, 15))).flat().filter(Boolean);
            assert.equal(cells.length, 84);
            assert.ok(cells.every((c) => c.count === 0 && c.level === 0));
        }
    });
});

describe('coding workspace wiring', () => {
    test('the list offers a daily problem, a heatmap and bookmarks, and the workspace can bookmark too', () => {
        const list = read('src', 'pages', 'student', 'StudentCoding.jsx');
        const problem = read('src', 'pages', 'student', 'StudentCodingProblem.jsx');
        const api = read('src', 'services', 'codingApi.js');
        assert.ok(list.includes('Problem of the day') && list.includes('ActivityHeatmap') && list.includes('toggleBookmark'));
        assert.ok(list.includes('aria-pressed={p.bookmarked}') && list.includes('min-h-[44px] min-w-[44px]'), 'the star is a labelled, 44px tap target');
        assert.ok(problem.includes('handleBookmark') && problem.includes('aria-pressed={!!problem.bookmarked}'));
        assert.ok(api.includes('/bookmark') && api.includes('bookmarked'));
    });

    const app = read('src', 'App.jsx');
    const layout = read('src', 'layouts', 'StudentLayout.jsx');
    const api = read('src', 'services', 'codingApi.js');
    const problem = read('src', 'pages', 'student', 'StudentCodingProblem.jsx');
    const list = read('src', 'pages', 'student', 'StudentCoding.jsx');

    test('routes exist under both student prefixes, lazily loaded', () => {
        assert.ok(app.includes("lazy(() => import('./pages/student/StudentCoding'))"));
        assert.ok(app.includes("lazy(() => import('./pages/student/StudentCodingProblem'))"));
        assert.ok(app.includes('path="/student/coding"') && app.includes('path="/student/coding/:slug"'));
        assert.ok(app.includes('path="coding"') && app.includes('path="coding/:slug"'));
    });

    test('the sidebar links to Coding and problem pages are gated like the list', () => {
        assert.ok(layout.includes("path: '/student/coding'"));
        assert.ok(layout.includes("'/student/coding': "));
        assert.ok(layout.includes("startsWith('/student/coding/')"));
    });

    test('the API client talks only to the student coding endpoints and builds no credentials', () => {
        for (const piece of ['/api/student/coding', '/problems', '/run', '/submit', '/submissions']) assert.ok(api.includes(piece), piece);
        assert.ok(!/localStorage|Authorization|Bearer/.test(api));
    });

    test('the workspace is Python only, Monaco based, with run, submit, read-only example cases and a locked solution', () => {
        assert.ok(problem.includes("language=\"python\""));
        assert.ok(!/language=\{?['"]java/.test(problem) && !/javascript|cpp/i.test(problem.replace(/Monaco|Editor/g, '')));
        for (const piece of ['handleRun', 'handleSubmit', 'Case ', 'Solve this problem to unlock', 'beats_runtime_pct', 'Autosaved']) {
            assert.ok(problem.includes(piece), piece);
        }
    });

    test('mobile layout: a section switcher below lg and tap targets of at least 44px', () => {
        assert.ok(problem.includes('lg:hidden') && problem.includes("['problem', 'Problem']") && problem.includes("['console', 'Console']"));
        assert.ok(problem.includes('min-h-[44px]'));
        assert.ok(list.includes('min-h-[44px]') && list.includes('overflow-x-auto'));
    });

    test('errors are always reduced to text before rendering', () => {
        assert.ok(problem.includes('errorMessage(err') && list.includes('errorMessage(err'));
        assert.ok(!/setActionError\(err\.response/.test(problem));
    });

    test('statements are rendered as text nodes, never as HTML', () => {
        const rich = read('src', 'components', 'coding', 'RichText.jsx');
        assert.ok(!rich.includes('dangerouslySetInnerHTML'));
        assert.ok(!problem.includes('dangerouslySetInnerHTML') && !list.includes('dangerouslySetInnerHTML'));
    });

    test('the assessment coding round is multi-language only where the problem offers it (typed problems), Python everywhere else', () => {
        const ws = read('src', 'pages', 'roleready', 'RoleReadyAssessment.jsx');
        assert.ok(!/java/i.test(ws.replace(/javascript/gi, '')), 'no language names hard-coded in the shared workspace page');
        assert.ok(ws.includes('problemLanguages') && ws.includes('handleLanguageChange') && ws.includes('codeBuffersRef'), 'language choice and per-language buffers');
        assert.ok(ws.includes('DEFAULT_LANGUAGE'), 'Python is still the default');
        const panel = read('src', 'components', 'coding', 'AssessmentCodingWorkspace.jsx');
        assert.ok(panel.includes('languageOptions={languageOptions}') && panel.includes('onLanguageChange={onLanguageChange}'), 'the toolbar gets the language dropdown');
        const student = read('src', 'pages', 'student', 'StudentCodingProblem.jsx');
        assert.ok(!student.includes('languageOptions'), 'the Python-only Coding page keeps its static Python3 label');
    });

    test('the assessment page shows API errors as text and runs public tests with Ctrl/Cmd + quote', () => {
        const ws = read('src', 'pages', 'roleready', 'RoleReadyAssessment.jsx');
        assert.ok(ws.includes("import { errorMessage } from '../../utils/codingPlatform'"));
        assert.ok(!/setError\(err\.response\?\.data\?\.detail/.test(ws), 'a { code, message } detail can no longer be rendered as an object');
        const panel = read('src', 'components', 'coding', 'AssessmentCodingWorkspace.jsx');
        assert.ok(panel.includes('monaco.KeyCode.Quote') && panel.includes('runRef.current()'), 'Ctrl/Cmd + quote runs the tests in the one shared workspace');
    });

    test('both coding screens share the LeetCode look: toolbar, status bar, tab bars, Accepted / Wrong Answer, dark by default in the assessment', () => {
        const parts = read('src', 'components', 'coding', 'workspaceParts.jsx');
        for (const piece of ['export const EditorToolbar', 'export const EditorStatusBar', 'export const useCursorPosition', 'export const useWorkspaceTheme', 'export const TAB_BAR', '>Python3<', 'Ln {position']) {
            assert.ok(parts.includes(piece), `shared parts have: ${piece}`);
        }
        const assessment = read('src', 'components', 'coding', 'AssessmentCodingWorkspace.jsx');
        const student = read('src', 'pages', 'student', 'StudentCodingProblem.jsx');
        for (const [name, src] of [['assessment', assessment], ['student', student]]) {
            assert.ok(src.includes('<EditorToolbar') && src.includes('<EditorStatusBar') && src.includes('TAB_BAR') && src.includes('Test Result'), `${name} workspace uses the shared pieces`);
        }
        assert.ok(assessment.includes("label: 'Accepted'") && assessment.includes('Wrong Answer'));
        const page = read('src', 'pages', 'roleready', 'RoleReadyAssessment.jsx');
        assert.ok(page.includes('useWorkspaceTheme()') && page.includes("workspaceTheme === 'dark' ? 'dark' : ''") && page.includes("const codingDark = codingWorkspaceActive && workspaceTheme === 'dark'"), 'the assessment coding area is dark unless the candidate switches to light');
        assert.ok(page.includes('{!codingWorkspaceActive && (') && page.includes('<CodingTopBar'), 'the coding workspace has ONE compact bar and no global header');
        assert.ok(page.includes("lg:h-[100dvh] lg:overflow-hidden"), 'the coding workspace fills the window height with no page scroll on a desktop');
        assert.ok(!/Solutions|Editorial/.test(assessment), 'nothing that could show the answer is offered in the assessment');
    });
});
