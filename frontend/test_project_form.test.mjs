import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseGithubRepoUrl, parseLiveUrl, splitTechStack, countWords, descriptionProgress, validateProjectForm,
    buildProjectPayload, formFromProject, formatReview, EMPTY_PROJECT_FORM, MIN_DESCRIPTION_WORDS,
} from './src/utils/projectForm.js';

const DESCRIPTION = 'An asynchronous in-memory caching engine built with FastAPI and Redis. It implements LRU eviction, distributed locking through Redlock and exposes Prometheus metrics.';
const goodForm = () => ({ ...EMPTY_PROJECT_FORM, title: 'Distributed Cache', description: DESCRIPTION, techStack: 'Python, FastAPI', githubUrl: 'https://github.com/alice/cache' });

describe('GitHub link', () => {
    test('1. valid links in every common shape become one canonical link', () => {
        for (const input of [
            'https://github.com/alice/cache', 'github.com/alice/cache', 'http://www.github.com/alice/cache/',
            'https://github.com/alice/cache.git', 'https://github.com/alice/cache/tree/main/src', '  https://github.com/alice/cache  ',
        ]) {
            const r = parseGithubRepoUrl(input);
            assert.equal(r.ok, true, input);
            assert.equal(r.url, 'https://github.com/alice/cache');
            assert.equal(r.owner, 'alice');
            assert.equal(r.repo, 'cache');
        }
    });

    test('2. every bad link says what to fix', () => {
        const cases = [
            ['', /add your github repository link/i], ['   ', /add your github repository link/i], [null, /add your github repository link/i],
            ['https://gitlab.com/alice/cache', /github repository link/i], ['https://example.com/a/b', /github repository link/i],
            ['https://github.com/alice', /profile, not a repository/i], ['https://github.com/', /full repository link/i],
            ['https://github.com/orgs/acme', /does not look like a repository/i], ['https://github.com/settings/profile', /does not look like a repository/i],
            ['https://github.com/-bad-/cache', /does not look like a repository/i], ['https://github.com/alice/ca che', /spaces/i],
            ['https://github.com/alice/..', /not valid|full repository link/i], // the browser collapses '..' itself
        ];
        for (const [input, message] of cases) {
            const r = parseGithubRepoUrl(input);
            assert.equal(r.ok, false, String(input));
            assert.match(r.error, message, String(input));
        }
    });

    test('3. the browser and the server agree on what is acceptable', () => {
        // the same cases the server tests use; if they ever drift apart a student would be told yes then no
        const accepted = ['github.com/Alice-1/My_Repo.v2', 'https://github.com/a/b'];
        const rejected = ['https://github.com/alice', 'https://github.com/orgs/acme/repos', 'https://github.com/alice/..'];
        accepted.forEach((u) => assert.equal(parseGithubRepoUrl(u).ok, true, u));
        rejected.forEach((u) => assert.equal(parseGithubRepoUrl(u).ok, false, u));
    });
});

describe('Other fields', () => {
    test('4. the live demo link is optional and normalised', () => {
        assert.deepEqual(parseLiveUrl(''), { ok: true, url: null });
        assert.deepEqual(parseLiveUrl('   '), { ok: true, url: null });
        assert.equal(parseLiveUrl('my-app.vercel.app').url, 'https://my-app.vercel.app');
        assert.equal(parseLiveUrl('https://my-app.vercel.app/demo').url, 'https://my-app.vercel.app/demo');
        assert.equal(parseLiveUrl('not a url').ok, false);
        assert.equal(parseLiveUrl('localhost').ok, false);
    });

    test('5. the tech stack is trimmed, de-duplicated and capped', () => {
        assert.deepEqual(splitTechStack(' Python , python,, FastAPI ,  '), ['Python', 'FastAPI']);
        assert.deepEqual(splitTechStack(''), []);
        assert.equal(splitTechStack(Array.from({ length: 50 }, (_, i) => `t${i}`).join(',')).length, 20);
        assert.equal(splitTechStack('x'.repeat(100))[0].length, 40);
    });

    test('6. the description counter reports words, characters and what is still missing', () => {
        assert.equal(countWords('  one two   three '), 3);
        assert.equal(countWords(''), 0);
        const short = descriptionProgress('too short');
        assert.deepEqual([short.words, short.enough, short.remainingWords], [2, false, MIN_DESCRIPTION_WORDS - 2]);
        assert.equal(descriptionProgress(DESCRIPTION).enough, true);
        // twenty tiny words is not enough characters
        assert.equal(descriptionProgress('a b c d e f g h i j k l m n o p q r s t').enough, false);
    });
});

describe('Whole form', () => {
    test('7. a complete project passes and its payload is canonical', () => {
        assert.deepEqual(validateProjectForm(goodForm()), {});
        const payload = buildProjectPayload({ ...goodForm(), githubUrl: 'github.com/alice/cache.git', liveUrl: 'my-app.dev', techStack: 'Python, python, Redis' });
        assert.equal(payload.github_url, 'https://github.com/alice/cache');
        assert.equal(payload.live_url, 'https://my-app.dev');
        assert.deepEqual(payload.tech_stack, ['Python', 'Redis']);
        assert.equal(payload.title, 'Distributed Cache');
    });

    test('8. a title and a proper description are mandatory, the GitHub link is optional', () => {
        const errors = validateProjectForm(EMPTY_PROJECT_FORM);
        assert.ok(errors.title && errors.description);
        assert.equal(errors.githubUrl, undefined, 'the GitHub link is optional');
        assert.match(errors.description, /at least 20 words \(0 so far\)/);
        assert.deepEqual(validateProjectForm({ ...goodForm(), githubUrl: '' }), {});
        assert.equal(buildProjectPayload({ ...goodForm(), githubUrl: '' }).github_url, null);
        assert.deepEqual(Object.keys(validateProjectForm({ ...goodForm(), githubUrl: 'https://gitlab.com/a/b' })), ['githubUrl']);
        assert.deepEqual(Object.keys(validateProjectForm({ ...goodForm(), description: 'Short.' })), ['description']);
        assert.deepEqual(Object.keys(validateProjectForm({ ...goodForm(), title: ' a ' })), ['title']);
    });

    test('9. filler text and over-long text are rejected', () => {
        assert.match(validateProjectForm({ ...goodForm(), description: 'word '.repeat(40) }).description, /repeats the same words/);
        assert.match(validateProjectForm({ ...goodForm(), description: `${DESCRIPTION} `.repeat(30) }).description, /under 4000/);
        assert.match(validateProjectForm({ ...goodForm(), title: 'x'.repeat(121) }).title, /under 120/);
    });

    test('10. an optional live link is only checked when something is typed', () => {
        assert.deepEqual(validateProjectForm({ ...goodForm(), liveUrl: '' }), {});
        assert.ok(validateProjectForm({ ...goodForm(), liveUrl: 'nope nope' }).liveUrl);
    });

    test('11. editing an existing project starts from its saved values', () => {
        const form = formFromProject({ title: 'T', description: DESCRIPTION, tech_stack: ['A', 'B'], github_url: 'https://github.com/a/b', live_url: null });
        assert.deepEqual(form, { title: 'T', description: DESCRIPTION, techStack: 'A, B', githubUrl: 'https://github.com/a/b', liveUrl: '' });
        assert.deepEqual(formFromProject(null), EMPTY_PROJECT_FORM);
    });
});

describe('Review text', () => {
    test('12. bold markers become real bold runs instead of literal asterisks', () => {
        const paragraphs = formatReview('**System Architecture**: solid scope.\n\n**Security Posture**: add auth.');
        assert.equal(paragraphs.length, 2);
        assert.deepEqual(paragraphs[0][0], { text: 'System Architecture', bold: true });
        assert.deepEqual(paragraphs[0][1], { text: ': solid scope.', bold: false });
        assert.ok(paragraphs.flat().every((s) => !s.text.includes('**')));
    });

    test('13. plain, empty and odd text never breaks', () => {
        assert.deepEqual(formatReview(''), []);
        assert.deepEqual(formatReview(null), []);
        assert.deepEqual(formatReview('just text'), [[{ text: 'just text', bold: false }]]);
        assert.deepEqual(formatReview('a ** b'), [[{ text: 'a ** b', bold: false }]]);
    });
});

import fs from 'node:fs';
const page = fs.readFileSync(new URL('./src/pages/student/StudentProjects.jsx', import.meta.url), 'utf-8');

describe('Projects page wiring', () => {
    test('14. the page validates before sending and shows errors inside the form', () => {
        assert.ok(page.includes('validateProjectForm(form)'));
        assert.ok(page.includes('buildProjectPayload(form)'));
        assert.ok(page.includes('formServerError'));
        assert.ok(page.includes('GitHub Repository URL (optional)'));
        assert.ok(page.includes('ReviewText'));
        assert.ok(!page.includes('whitespace-pre-line'));
    });
    test('15. after saving, the result is brought into view on small screens', () => {
        assert.ok(page.includes('scrollIntoView'));
        assert.ok(page.includes('setScrollToDetail'));
    });
});
