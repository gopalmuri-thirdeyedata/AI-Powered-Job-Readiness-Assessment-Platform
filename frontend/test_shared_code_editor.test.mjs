// One student code editor: the Assessment coding round, the Coding page and the Practice page all render CodeEditorPanel.
// These tests pin that no second Monaco editor exists in the student portal and that the panel keeps the assessment's behaviour.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

describe('the shared code editor panel', () => {
    const render = async (props) => {
        const { default: Panel } = await loadModule('src/components/coding/CodeEditorPanel.jsx');
        return renderToStaticMarkup(React.createElement(Panel, { code: 'print(1)', onCodeChange: () => {}, onReset: () => {}, ...props }));
    };

    test('1. toolbar, Monaco and Ln/Col status bar in one panel; the language and model path reach the editor', async () => {
        const html = await render({ language: 'java', path: 'problem-7.java', themeIsDark: true });
        assert.match(html, /data-monaco/);
        assert.match(html, /data-language="java"/);
        assert.match(html, /data-path="problem-7\.java"/);
        assert.match(html, / Code<\/span>/);
        assert.match(html, /Ln 1, Col 1/);
        assert.match(html, /Autosaved/);
    });

    test('2. a single language shows the static label; two or more give the dropdown (as in the assessment)', async () => {
        const one = await render({ language: 'python' });
        assert.match(one, />Python3</);
        assert.doesNotMatch(one, /aria-label="Programming language"/);
        const many = await render({ language: 'cpp', onLanguageChange: () => {}, languageOptions: [{ value: 'python', label: 'Python3' }, { value: 'cpp', label: 'C++' }] });
        assert.match(many, /aria-label="Programming language"/);
        assert.match(many, /<option value="cpp"[^>]* selected/);
    });

    test('3. status text is the page\'s: Practice stores no draft, so it does not claim "Autosaved"', async () => {
        const html = await render({ saved: '' });
        assert.doesNotMatch(html, /Autosaved/);
        assert.match(html, /Ln 1, Col 1/);
    });

    test('4. options: assessment protection (no context menu / dropped text) is opt-in; shortcuts bind only when given', () => {
        const panel = read('src/components/coding/CodeEditorPanel.jsx');
        assert.ok(panel.includes('contextmenu: false, dropIntoEditor: { enabled: false }') && panel.includes('options={protectedInput ? PROTECTED_EDITOR_OPTIONS : EDITOR_OPTIONS}'));
        assert.ok(panel.includes('if (runRef.current) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote') && panel.includes('if (submitRef.current) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter'));
        assert.ok(panel.includes("theme={dark ? 'vs-dark' : 'light'}"));
    });
});

describe('who renders it', () => {
    test('5. the assessment workspace keeps its behaviour: same path, run hook, theme, protection, language dropdown', () => {
        const ws = read('src/components/coding/AssessmentCodingWorkspace.jsx');
        assert.ok(ws.includes('<CodeEditorPanel'));
        for (const piece of ['path={`problem-${problem.id}.${language}`}', 'onRun={onRun}', 'onToggleTheme={onToggleTheme}', 'themeIsDark={dark}', 'protectedInput={!PROTECTION_TEST_MODE}',
            'languageOptions={languageOptions}', 'onLanguageChange={onLanguageChange}', 'languageDisabled={running}', 'saved="Autosaved"']) assert.ok(ws.includes(piece), piece);
        assert.ok(ws.includes('export const casesFromRun') && ws.includes('export const runSummary'), 'result presentation is unchanged');
        const page = read('src/pages/roleready/RoleReadyAssessment.jsx');
        assert.ok(page.includes('<AssessmentCodingWorkspace') && page.includes('api.runCode(') && !page.includes('@monaco-editor/react'), 'the assessment page still runs code through its own API and no longer carries an unused Monaco import');
    });

    test('6. the Coding page: shared editor, its own Run / Submit endpoints (now sending the language) and Ctrl shortcuts, draft autosave', () => {
        const page = read('src/pages/student/StudentCodingProblem.jsx');
        assert.ok(page.includes('<CodeEditorPanel') && page.includes('language={language}') && page.includes('onRun={() => runRef.current()}') && page.includes('onSubmit={() => submitRef.current()}'));
        assert.ok(page.includes('codingApi.run(slug, code, null, language)') && page.includes('codingApi.submit(slug, code, language)'), 'execution stays on the student coding endpoints');
        assert.ok(page.includes('saveDraft(') && page.includes('if (running || submitting) return;'), 'drafts kept, duplicate requests refused');
        assert.ok(!page.includes('@monaco-editor/react'));
    });

    test('7. the Practice page: shared editor on coding questions only, Submit stays the execution path and cannot be sent twice', () => {
        const page = read('src/pages/student/StudentPractice.jsx');
        assert.ok(page.includes('<CodeEditorPanel') && page.includes('language={selectedLanguage}') && page.includes('path={`practice-${activeQuestion.id}.${selectedLanguage}`}') && page.includes('saved=""'));
        assert.equal((page.match(/<CodeEditorPanel/g) || []).length, 1);
        assert.ok(page.indexOf('<CodeEditorPanel') > page.indexOf("activeQuestion.category === 'CODING' && ("), 'only inside the CODING arena');
        assert.ok(page.includes('if (!activeQuestion || isSubmitting) return;') && page.includes('studentApi.submitPracticeAttempt('));
        assert.ok(page.includes('Select the correct answer:') && page.includes('Public Sample Test Cases'), 'aptitude questions and samples are untouched');
        assert.ok(!page.includes('@monaco-editor/react'));
    });

    test('8. no other student-portal file renders a Monaco editor (the legacy candidate page is a different product)', () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) walk(rel);
                else if (/\.(jsx?|mjs)$/.test(e.name) && read(rel).includes("'@monaco-editor/react'")) hits.push(rel);
            }
        };
        walk('src');
        assert.deepEqual(hits.sort(), ['src/components/coding/CodeEditorPanel.jsx', 'src/pages/candidate/CandidateCodingAssessment.jsx']);
    });

    test('9. features without code input get no editor: dashboard, skill gap, roadmap, mock interview, projects, resume, profile, coding list', () => {
        for (const f of ['StudentDashboard', 'StudentSkillGap', 'StudentRoadmap', 'StudentMockInterview', 'StudentProjects', 'StudentResumeUpload', 'StudentResumeFormatter', 'StudentProfile', 'StudentCoding']) {
            const src = read(`src/pages/student/${f}.jsx`);
            assert.ok(!src.includes('CodeEditorPanel') && !src.includes('monaco'), f);
        }
    });

    test('10. the execution services are untouched: three API clients, no new endpoint, no browser-side execution', () => {
        const coding = read('src/services/codingApi.js');
        assert.ok(coding.includes('/problems/${encodeURIComponent(slug)}/run') && coding.includes('/submit'));
        const student = read('src/services/studentApi.js');
        assert.ok(student.includes('/api/student/practice/submit'));
        assert.ok(!/\/api\/student\/practice\/(run|execute)/.test(student), 'no new Practice run endpoint was invented');
        for (const f of ['src/components/coding/CodeEditorPanel.jsx', 'src/pages/student/StudentPractice.jsx', 'src/pages/student/StudentCodingProblem.jsx']) {
            const src = read(f);
            assert.ok(!/\beval\(|new Function\(|new Worker\(|pyodide/i.test(src), `${f} never runs code in the browser`);
        }
    });
});

describe('one language list: the Assessment\'s', () => {
    test('11. Coding and Practice build their dropdown from the Assessment\'s helpers and declare no language list of their own', async () => {
        const { LANGUAGE_OPTIONS, languageOptionsFor, problemLanguages, starterFor, defaultLanguage } = await loadModule('src/utils/codingLanguages.js');
        assert.deepEqual(Object.keys(LANGUAGE_OPTIONS), ['python', 'java', 'cpp', 'c']);
        assert.deepEqual(Object.values(LANGUAGE_OPTIONS).map((o) => o.label), ['Python3', 'Java', 'C++', 'C']);
        const problem = { languages: ['python', 'java', 'cpp', 'c'], starter_code: { python: 'P', java: 'J', cpp: 'C', c: 'X' } };
        assert.deepEqual(languageOptionsFor(problem), [{ value: 'python', label: 'Python3' }, { value: 'java', label: 'Java' }, { value: 'cpp', label: 'C++' }, { value: 'c', label: 'C' }]);
        assert.equal(defaultLanguage(problem), 'python');
        assert.equal(starterFor(problem, 'cpp'), 'C');
        assert.deepEqual(languageOptionsFor({ languages: ['python'], starter_code: { python: 'P' } }), [{ value: 'python', label: 'Python3' }], 'a Python-only problem keeps the static label');
        assert.deepEqual(problemLanguages({ starter_code: { python: 'P' } }), ['python'], 'old payloads (no languages) still work, e.g. the demo');
        for (const f of ['src/pages/student/StudentCodingProblem.jsx', 'src/pages/student/StudentPractice.jsx']) {
            const src = read(f);
            assert.ok(src.includes("from '../../utils/codingLanguages'") && src.includes('languageOptionsFor('), f);
            assert.ok(!/label:\s*'(Python3?|Java|C\+\+)'/.test(src) && !/<option value="(java|cpp)"/.test(src), `${f} has no language list of its own`);
        }
    });

    test('12. the languages travel to the existing endpoints: Coding run/submit and Practice submit', () => {
        const coding = read('src/services/codingApi.js');
        assert.ok(coding.includes("async run(slug, code, customInput, language = 'python')") && coding.includes('custom_input: customInput ?? null, language'));
        assert.ok(coding.includes("async submit(slug, code, language = 'python')") && coding.includes('{ code, language }'));
        const practice = read('src/pages/student/StudentPractice.jsx');
        assert.ok(practice.includes('activeQuestion.id,\r\n                    code,\r\n                    selectedLanguage') || /activeQuestion\.id,\s*code,\s*selectedLanguage/.test(practice), 'Practice sends the chosen language');
        assert.ok(!/\/api\/student\/practice\/(run|execute)/.test(read('src/services/studentApi.js')), 'still no new endpoint');
    });

    test('13. each page keeps the code of every language, starts on Python and never switches mid-run', () => {
        const coding = read('src/pages/student/StudentCodingProblem.jsx');
        assert.ok(coding.includes('buffersRef') && coding.includes("useState('python')") && coding.includes('languageDisabled={running || submitting}') && coding.includes('if (!languageView || next === language || running || submitting) return;'));
        assert.ok(coding.includes("draftId = (slug, language = 'python')") && coding.includes("language === 'python' ? '' :"), 'Python keeps its original draft key');
        const practice = read('src/pages/student/StudentPractice.jsx');
        assert.ok(practice.includes('buffersRef') && practice.includes('languageDisabled={isSubmitting}') && practice.includes('if (!activeQuestion || next === selectedLanguage || isSubmitting) return;'));
        assert.ok(!practice.includes('Python 3'), 'the old static badge is gone: the language is chosen in the editor toolbar');
    });

    test('14. the Assessment itself is untouched by this change', () => {
        const ws = read('src/components/coding/AssessmentCodingWorkspace.jsx');
        assert.ok(ws.includes('const languageOptions = offered.map((l) => ({ value: l, label: LANGUAGE_OPTIONS[l].label }));') && ws.includes('problemLanguages(problem)'));
        assert.ok(!ws.includes('languageOptionsFor'), 'the assessment keeps its own inline list exactly as it was');
    });
});
