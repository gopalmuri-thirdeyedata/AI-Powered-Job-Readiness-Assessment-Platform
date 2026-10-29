// Multi-language assessment coding round: the pure helpers are exercised directly, and the workspace is rendered with a typed problem.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';

const load = () => loadModule('src/utils/codingLanguages.js');

const TYPED = {
    id: 'C1', title: 'Two Sum', difficulty: 'Easy', description: 'Return the indices of the two numbers that add up to target.',
    constraints: '2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9',
    function_name: 'twoSum', params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]',
    languages: ['python', 'java', 'cpp', 'c'],
    starter_code: { python: 'class Solution:\n    def twoSum(self, nums, target):\n        pass\n', java: 'class Solution {}\n', cpp: 'class Solution {};\n', c: 'int* twoSum();\n' },
    public_test_cases: [
        { id: 'C1-p1', input: 'nums = [2,7,11,15]\ntarget = 9', args: ['[2,7,11,15]', '9'], expected_output: '[0,1]', explanation: '2 + 7 = 9' },
        { id: 'C1-p2', input: 'nums = [3,2,4]\ntarget = 6', args: ['[3,2,4]', '6'], expected_output: '[1,2]' },
    ],
};
const OLD = { id: '1', title: 'Sum', difficulty: 'Easy', description: 'Add.', input_format: 'two ints', output_format: 'their sum', constraints: '', starter_code: { python: 'class Solution:\n    pass\n' },
    public_test_cases: [{ id: 'p1', input: '1\n2', expected_output: '3' }] };

describe('language helpers', () => {
    test('a problem offers the languages it sends, in order; old problems stay Python only', async () => {
        const { problemLanguages, defaultLanguage } = await load();
        assert.deepEqual(problemLanguages(TYPED), ['python', 'java', 'cpp', 'c']);
        assert.deepEqual(problemLanguages({ starter_code: { cpp: 'x', python: 'y' } }), ['cpp', 'python'], 'derived from the starters when `languages` is missing');
        assert.deepEqual(problemLanguages({ languages: ['rust', 'java'], starter_code: {} }), ['java'], 'unknown languages are dropped');
        assert.deepEqual(problemLanguages(OLD), ['python']);
        assert.deepEqual(problemLanguages({}), ['python']);
        assert.equal(defaultLanguage(TYPED), 'python');
        assert.equal(defaultLanguage({ languages: ['java', 'cpp'] }), 'java');
    });

    test('the starter is the server\'s, or a comment-only stub in the right comment style', async () => {
        const { starterFor } = await load();
        assert.equal(starterFor(TYPED, 'java'), 'class Solution {}\n');
        assert.match(starterFor({ title: 'X' }, 'python'), /^# Write your Python solution for X\ndef solve\(\):/);
        assert.match(starterFor({ title: 'X' }, 'cpp'), /^\/\/ Write your C\+\+ solution for X/);
        assert.match(starterFor({ title: 'X', starter_code: { c: '   ' } }, 'c'), /^\/\/ Write your C solution/);
    });
});

describe('test case inputs', () => {
    test('display text is split into labeled fields and joined back for the description', async () => {
        const { parseLabeledInput, inlineInput } = await load();
        assert.deepEqual(parseLabeledInput('nums = [2,7]\ntarget = 9'), [{ name: 'nums', value: '[2,7]' }, { name: 'target', value: '9' }]);
        assert.equal(parseLabeledInput('1\n2'), null, 'old-style stdin text is not labeled');
        assert.equal(inlineInput('nums = [2,7]\ntarget = 9'), 'nums = [2,7], target = 9');
        assert.equal(inlineInput('1\n2'), '1\n2');
    });

    test('a custom case is sent only when it is complete and different from the examples', async () => {
        const { customInputFor, customInputIssue, exampleValues } = await load();
        assert.deepEqual(exampleValues(TYPED, TYPED.public_test_cases[0]), ['[2,7,11,15]', '9']);
        assert.equal(customInputFor(TYPED, undefined), null, 'no custom case');
        assert.equal(customInputFor(TYPED, ['[2,7,11,15]', '9']), null, 'a copy of an example already runs');
        assert.equal(customInputFor(TYPED, ['[3,2,4]', ' 6 ']), null, 'whitespace does not make it new');
        assert.equal(customInputFor(TYPED, ['[1,2,3]', '5']), '[1,2,3]\n5');
        assert.equal(customInputFor(TYPED, ['[1,\n2,3]', '5']), '[1, 2,3]\n5', 'a field never spans two lines (one value per line)');
        assert.equal(customInputFor(TYPED, ['[1,2,3]', '']), null, 'incomplete');
        assert.match(customInputIssue(TYPED, ['[1,2,3]', '  ']), /every field/);
        assert.equal(customInputIssue(TYPED, ['[1,2,3]', '5']), null);
        assert.equal(customInputFor(OLD, ['1']), null, 'old-style problems have no custom case');
    });

    test('constraints become bullet lines', async () => {
        const { constraintLines } = await load();
        assert.deepEqual(constraintLines('- 1 <= n <= 10\n\n* a != b '), ['1 <= n <= 10', 'a != b']);
        assert.deepEqual(constraintLines('-10^9 <= nums[i] <= 10^9'), ['-10^9 <= nums[i] <= 10^9'], 'a negative bound is not a bullet');
        assert.deepEqual(constraintLines(''), []);
    });
});

describe('workspace rendering', () => {
    const render = async (problem, props = {}) => {
        const { default: Workspace } = await loadModule('src/components/coding/AssessmentCodingWorkspace.jsx');
        return renderToStaticMarkup(React.createElement(Workspace, {
            problem, code: '', onCodeChange: () => {}, onReset: () => {}, onRun: () => {}, running: false, result: null, error: '', themeIsDark: true, ...props,
        }));
    };

    test('a typed problem gets the language dropdown, LeetCode-style examples, bullet constraints and labeled testcase fields', async () => {
        const html = await render(TYPED, { language: 'cpp', onLanguageChange: () => {} });
        assert.match(html, /aria-label="Programming language"/);
        for (const label of ['Python3', 'Java', 'C\\+\\+', '>C<']) assert.match(html, new RegExp(`>${label.replace('>', '').replace('<', '')}</option>`));
        assert.match(html, /<option value="cpp"[^>]* selected/);
        assert.match(html, /Example 1:/);
        assert.match(html, /Input: <\/span>nums = \[2,7,11,15\], target = 9/);
        assert.match(html, /<ul class="list-disc/);
        assert.match(html, /2 &lt;= nums.length &lt;= 10\^4/);
        assert.match(html, /nums =<\/label>|>nums =</);
        assert.match(html, /aria-label="Add a custom testcase"/);
        assert.match(html, /Hidden tests are graded when you submit the section/);
    });

    test('an open custom case is editable, one field per parameter', async () => {
        const html = await render(TYPED, { language: 'python', onLanguageChange: () => {}, customFields: ['[1,2]', '3'], onCustomFieldsChange: () => {} });
        assert.match(html, /aria-label="Remove the custom testcase"/);
        assert.equal((html.match(/<textarea/g) || []).length, 0, 'the examples are shown until the Custom chip is selected');
    });

    test('an old-style problem keeps the static Python3 label, the Input / Output blocks and the plain Testcase tab', async () => {
        const html = await render(OLD, { language: 'python', onLanguageChange: () => {} });
        assert.doesNotMatch(html, /aria-label="Programming language"/);
        assert.match(html, />Python3</);
        assert.match(html, /two ints/);
        assert.doesNotMatch(html, /Add a custom testcase/);
        assert.match(html, /Run checks these 1 example against your code\./);
    });

    test('verdicts and cases: compile errors, timeouts and wrong answers are told apart', async () => {
        const { runSummary, casesFromRun } = await loadModule('src/components/coding/AssessmentCodingWorkspace.jsx');
        assert.equal(runSummary({ error_type: 'Compilation Error' }).label, 'Compile Error');
        assert.equal(runSummary({ error_type: 'Time Limit Exceeded' }).label, 'Time Limit Exceeded');
        assert.equal(runSummary({ all_passed: true, test_results: [] }).label, 'Accepted');
        assert.equal(runSummary({ all_passed: false, test_results: [{ passed: false }] }).label, 'Wrong Answer');
        const cases = casesFromRun({ test_results: [
            { passed: true }, { passed: false, error_type: 'Time Limit Exceeded', timed_out: true }, { passed: false }, { passed: false, error_type: 'Runtime Error', error: 'boom' },
            { custom: true, passed: null, actual_output: '7' }, { custom: true, error: 'bad', error_type: 'Runtime Error' },
        ] });
        assert.deepEqual(cases.map((c) => c.status), ['passed', 'tle', 'failed', 'error', 'ran', 'error']);

        const html = await render(TYPED, { language: 'java', onLanguageChange: () => {}, result: {
            all_passed: false, error_type: 'Compilation Error', stderr: 'Main.java:3: error: missing return statement',
            test_results: [{ input: 'nums = [1]\ntarget = 1', expected_output: '[0]', actual_output: '', error: 'Main.java:3: error: missing return statement', error_type: 'Compilation Error', passed: false }],
        } });
        // the Result tab is only opened by an effect, so check the pieces that render server-side
        assert.match(html, /Test Result/);
    });
});

describe('coding top bar', () => {
    test('one bar: problem switcher, Run + Submit as a pill group, timers and camera slots; the submit label comes from the page', async () => {
        const { default: Bar } = await loadModule('src/components/coding/CodingTopBar.jsx');
        const html = renderToStaticMarkup(React.createElement(Bar, {
            problems: [{ id: 'C1' }, { id: 'C2' }], index: 1, onSelect: () => {}, onRun: () => {}, onSubmit: () => {},
            submitLabel: 'Submit All & Unlock Interview', submitShortLabel: 'Submit', status: React.createElement('span', null, '19:28'), camera: React.createElement('i', null, 'cam'),
        }));
        assert.match(html, /data-testid="coding-top-bar"/);
        assert.match(html, /role="group" aria-label="Run and submit"/);
        assert.match(html, /Problem 1/); assert.match(html, /Problem 2/);
        assert.match(html, /aria-selected="true"[^>]*>(<span[^>]*><\/span>)?Problem 2/, 'the selected problem is marked');
        assert.ok(html.includes('Submit All &amp; Unlock Interview') && html.includes('>Submit<'), 'full and short submit labels');
        assert.ok(html.includes('19:28') && html.includes('cam'), 'timer and camera slots');
        const running = renderToStaticMarkup(React.createElement(Bar, { problems: [{ id: 'C1' }], running: true, submitting: true }));
        assert.match(running, /Running…/);
        assert.equal((running.match(/disabled=""/g) || []).length, 2, 'Run and Submit are disabled while busy');
    });
});
