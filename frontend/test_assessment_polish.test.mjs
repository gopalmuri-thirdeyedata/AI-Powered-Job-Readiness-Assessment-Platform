import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const entrySrc = read('src/pages/candidate/SharedAssessmentEntry.jsx');
const loginSrc = read('src/components/candidate/StudentAccessLogin.jsx');
const completeSrc = read('src/pages/candidate/StudentAssessmentComplete.jsx');
const jdSrc = read('src/components/candidate/JobDescription.jsx');
const workspaceSrc = read('src/pages/roleready/RoleReadyAssessment.jsx');
const hookSrc = read('src/hooks/useAssessmentFullscreen.js');

const MARKDOWN = [
    '## Machine Learning Engineer',
    '',
    '**Experience:** 3+ years building *production* models',
    '',
    '### Responsibilities',
    '- Train and evaluate models',
    '- Ship `FastAPI` services',
    '',
    '1. Apply',
    '2. Interview',
    '',
    'See [our site](https://example.com/jobs) for more.',
].join('\n');

describe('Opening page: the job description renders Markdown safely', () => {
    test('1. headings, bold, italic, code, bullet and numbered lists and links render as elements; no Markdown symbols are left', async () => {
        const { default: JobDescription } = await loadModule('src/components/candidate/JobDescription.jsx');
        const html = renderToStaticMarkup(React.createElement(JobDescription, { text: MARKDOWN }));
        assert.match(html, /<h3[^>]*>Machine Learning Engineer<\/h3>/);
        assert.match(html, /<h4[^>]*>Responsibilities<\/h4>/);
        assert.match(html, /<strong[^>]*>Experience:<\/strong> 3\+ years building <em>production<\/em> models/);
        assert.match(html, /<ul[^>]*>\s*<li[^>]*>Train and evaluate models<\/li><li[^>]*>Ship <code[^>]*>FastAPI<\/code> services<\/li><\/ul>/);
        assert.match(html, /<ol[^>]*><li[^>]*>Apply<\/li><li[^>]*>Interview<\/li><\/ol>/);
        assert.match(html, /<a href="https:\/\/example.com\/jobs" target="_blank" rel="noopener noreferrer nofollow"[^>]*>our site<\/a>/);
        const visible = html.replace(/<[^>]+>/g, '');
        assert.ok(!/##|\*\*|`|\]\(/.test(visible), `no raw Markdown symbols: ${visible}`);
    });

    test('2. a plain-text description still works: one paragraph per line, nothing dropped', async () => {
        const { default: JobDescription, parseDescription } = await loadModule('src/components/candidate/JobDescription.jsx');
        assert.deepEqual(parseDescription('We are hiring a data analyst.\nSQL and Excel required.'), [
            { type: 'p', text: 'We are hiring a data analyst.' }, { type: 'p', text: 'SQL and Excel required.' },
        ]);
        const html = renderToStaticMarkup(React.createElement(JobDescription, { text: 'Plain text only, 5 - 7 years * of experience' }));
        assert.match(html, /<p>Plain text only, 5 - 7 years \* of experience<\/p>/);
        assert.equal(renderToStaticMarkup(React.createElement(JobDescription, { text: '   ' })), '', 'an empty description renders nothing');
    });

    test('3. unsafe content is never executed: HTML is shown as text, only http(s) links become links', async () => {
        const { default: JobDescription } = await loadModule('src/components/candidate/JobDescription.jsx');
        const evil = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[click](javascript:alert(1))', '[data](data:text/html;base64,AAAA)', '**<b onclick=x>bold</b>**'].join('\n');
        const html = renderToStaticMarkup(React.createElement(JobDescription, { text: evil }));
        assert.ok(!/<script|<img|<b onclick|href="javascript|href="data/i.test(html), html);
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'shown as inert text');
        assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(jdSrc), 'the renderer never produces HTML strings');
        assert.ok(!/dompurify|marked|require\(/i.test(jdSrc), 'no new library');
    });

    test('4. a long description starts as a preview with Show more (and the full text is still reachable)', async () => {
        const { default: JobDescription, parseDescription, previewBlocks } = await loadModule('src/components/candidate/JobDescription.jsx');
        const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(10)}`).join('\n\n');
        const blocks = parseDescription(long);
        const shown = previewBlocks(blocks, 650);
        assert.ok(shown.length >= 1 && shown.length < blocks.length, 'the preview is a prefix');
        const html = renderToStaticMarkup(React.createElement(JobDescription, { text: long }));
        assert.match(html, /<button[^>]*aria-expanded="false"[^>]*>Show more<\/button>/);
        assert.ok(html.includes('Paragraph 0 ') && !html.includes('Paragraph 29 '), 'collapsed: the end is not rendered');
        assert.ok(jdSrc.includes("expanded ? 'Show less' : 'Show more'"));
        const list = parseDescription(Array.from({ length: 24 }, (_, i) => `- Requirement ${i}: ${'detail '.repeat(18)}`).join('\n'));
        assert.equal(list.length, 1, 'one long list');
        const listPreview = previewBlocks(list, 650);
        assert.ok(listPreview[0].items.length >= 1 && listPreview[0].items.length < 24, 'a long list is cut between items, not shown whole');
        assert.ok(renderToStaticMarkup(React.createElement(JobDescription, { text: 'x\n' + list[0].items.map((i) => `- ${i}`).join('\n') })).includes('Show more'));
        const short = renderToStaticMarkup(React.createElement(JobDescription, { text: MARKDOWN }));
        assert.ok(!short.includes('Show more'), 'a short description has no toggle');
        assert.ok(jdSrc.includes('break-words') && jdSrc.includes('overflow-wrap:anywhere'), 'long words / URLs cannot break the layout');
    });

    test('5. the page renders the server text through JobDescription (not as a raw paragraph)', () => {
        assert.ok(entrySrc.includes('<JobDescription text={meta.description_snippet} />'));
        assert.ok(!/<p[^>]*>\{meta\.description_snippet\}<\/p>/.test(entrySrc));
        assert.ok(read('package.json').includes('"react-dom"') && !/dompurify|"marked"|react-markdown/.test(read('package.json')), 'no dependency was added');
    });
});

describe('Opening page: layout and sign-in', () => {
    test('6. one framed page: overview (title, description, three section cards) beside the sign-in card from lg, stacked below', () => {
        assert.ok(entrySrc.includes('lg:grid-cols-5') && entrySrc.includes('lg:col-span-3') && entrySrc.includes('lg:col-span-2'));
        assert.ok(entrySrc.includes('grid gap-3 sm:grid-cols-3'), 'three columns when wide, stacked when narrow');
        assert.ok(entrySrc.includes('<SectionCard caption={`Section ${i + 1}`} label={s.label} minutes={s.minutes}'), 'section data comes from the server metadata');
        assert.ok(!/\b(?:20|60)\b minutes|minutes: 20/.test(entrySrc), 'no hard-coded durations');
        assert.ok(entrySrc.includes('{meta.total_duration_minutes} minutes total') && entrySrc.includes('{meta.title}'));
        assert.ok(!/(?:bg|border|text)-(?:amber|orange|yellow)-/.test(entrySrc + loginSrc), 'no warning-coloured panels');
        assert.ok(!/(?<!min-)\bh-\[|max-h-/.test(entrySrc + loginSrc + jdSrc), 'no fixed heights that could clip content');
    });

    test('7. the sign-in card keeps its heading, fields, handlers and login behaviour; fields share one height and a themed border', () => {
        assert.ok(loginSrc.includes('Sign in to start'));
        assert.ok(loginSrc.includes("import { login, logout } from '../../auth/authSession'") && loginSrc.includes('await login(email.trim(), password)'));
        assert.ok(loginSrc.includes("data.role !== 'STUDENT'") && loginSrc.includes('await logout()'));
        assert.ok(loginSrc.includes("setError('Enter your email address and password.')"), 'the empty-field message is unchanged');
        assert.equal((loginSrc.match(/\$\{inputCls\}/g) || []).length, 2, 'both fields use the same classes');
        assert.ok(/inputCls = '[^']*\bh-11\b/.test(loginSrc), 'one consistent 44px field height');
        assert.ok(loginSrc.includes('aria-invalid') && loginSrc.includes('focus:ring-2 focus:ring-[#5d8c2c]/30'), 'validation + focus states');
        assert.ok(loginSrc.includes('${primaryBtnCls} w-full') && loginSrc.includes('disabled={busy}') && loginSrc.includes('animate-spin'), 'prominent brand button with disabled + loading states');
        assert.ok(loginSrc.includes('border-slate-300 dark:border-slate-700') && loginSrc.includes('bg-white dark:bg-slate-950'));
    });

    test('8. authentication, session and access flow in the entry page are untouched', () => {
        for (const needle of ['studentAssessmentApi.access(shareToken, handedToken || undefined)', "saveRegistration(shareToken, res.registration_token)", 'navigate(instructionsPath, { replace: true })',
            'res.attempt?.submitted || res.retests?.length', "setAccess({ phase: 'blocked'", 'logout()', '<StudentAccessLogin assessmentTitle={meta.title} />', 'candidateApi.registrationInfo(shareToken, handedToken)']) {
            assert.ok(entrySrc.includes(needle), needle);
        }
    });
});

describe('Completion page', () => {
    test('9. headings, wording and the review / report rules are preserved', () => {
        for (const needle of ['Assessment submitted</h1>', 'aria-label="Exam review"', '>Exam review</h2>', '>Assessment report</h2>', 'Submit Review', 'Download Report',
            'Thank you{data.student?.name ?', 'Your responses for <b>{data.assessment?.title}</b> have been received.',
            'const canSubmit = !saved && !saving && !problem;', 'const canDownload = !!saved && attempt.report_ready && download.phase !==', 'Submit your review to unlock your report.',
            'studentAssessmentApi.submitReview(attempt.session_uuid, text)', 'studentAssessmentApi.getReport(attempt.session_uuid)', "import { MIN_REVIEW_WORDS, countWords, reviewProblem } from '../../utils/wordCount'"]) {
            assert.ok(completeSrc.includes(needle), needle);
        }
        assert.ok(!/MIN_REVIEW_WORDS\s*=/.test(completeSrc), 'the 30-word minimum still lives in utils/wordCount');
        assert.ok(completeSrc.includes('disabled={!canSubmit}') && completeSrc.includes('disabled={!canDownload}'));
    });

    test('10. confirmation -> review -> report: three cards of one surface; the counter sits directly under the textarea; the report is gated by the same conditions', () => {
        const confirmation = completeSrc.indexOf('aria-label="Submission confirmation"');
        const review = completeSrc.indexOf('aria-label="Exam review"');
        const report = completeSrc.indexOf('aria-label="Assessment report"');
        assert.ok(confirmation > 0 && confirmation < review && review < report, 'reading order');
        assert.equal((completeSrc.slice(confirmation).match(/className=\{`\$\{card\} /g) || []).length, 3, 'confirmation, review and report share the one card style');
        assert.ok(/const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'/.test(completeSrc));
        const reviewBlock = completeSrc.slice(review, report);
        assert.ok(reviewBlock.indexOf('<textarea') < reviewBlock.indexOf('data-testid="word-counter"') && reviewBlock.indexOf('data-testid="word-counter"') < reviewBlock.indexOf('Submit Review'), 'textarea, then counter, then the button');
        assert.ok(completeSrc.includes('lg:grid-cols-5') && completeSrc.includes('lg:col-span-3') && completeSrc.includes('lg:col-span-2'));
        assert.ok(completeSrc.includes('rows={5}') && completeSrc.includes('min-h-[120px]') && completeSrc.includes('resize-y'), 'comfortable but not dominant');
        const reportBlock = completeSrc.slice(report);
        assert.ok(reportBlock.includes('data-testid="report-ready"') && reportBlock.includes('saved && attempt.report_ready'), 'reports availability from the server state');
        assert.ok(!/(?:bg|border|text)-(?:amber|orange|yellow)-/.test(completeSrc), 'no yellow panels');
    });

    test('11. the success confirmation is shown only for a submitted attempt, after the existing guards', () => {
        const guard = completeSrc.indexOf('if (!attempt.submitted)');
        assert.ok(guard > 0 && guard < completeSrc.indexOf('Assessment submitted</h1>'), 'the in-progress / closed notices return before the confirmation');
        assert.ok(!/fullscreen/i.test(completeSrc.replace(/^ \*.*$/gm, '')), 'the completion page never requests or toggles fullscreen');
    });
});

describe('Fullscreen: leave it only when the assessment is over', () => {
    const withDocument = async (doc, fn) => {
        const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
        Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
        try { return await fn(); } finally { if (had) Object.defineProperty(globalThis, 'document', had); else delete globalThis.document; }
    };

    test('12. exitFullscreenSafely: no-op when not fullscreen; one request for concurrent calls; true only after a real exit', async () => {
        const { exitFullscreenSafely } = await loadModule('src/utils/exitFullscreen.js');
        let calls = 0;
        const doc = { fullscreenElement: null, exitFullscreen() { calls += 1; return new Promise((r) => setTimeout(() => { doc.fullscreenElement = null; r(); }, 5)); } };
        await withDocument(doc, async () => {
            assert.equal(await exitFullscreenSafely(), false);
            assert.equal(calls, 0, 'nothing to exit');
            doc.fullscreenElement = {};
            const [a, b] = await Promise.all([exitFullscreenSafely(), exitFullscreenSafely()]);
            assert.deepEqual([a, b], [true, true]);
            assert.equal(calls, 1, 'no duplicate exit request');
            assert.equal(await exitFullscreenSafely(), false);
            assert.equal(calls, 1, 'already out: no further call');
        });
    });

    test('13. a refusing browser never throws and is not assumed to have exited', async () => {
        const { exitFullscreenSafely } = await loadModule('src/utils/exitFullscreen.js');
        const rejecting = { fullscreenElement: {}, exitFullscreen: () => Promise.reject(new Error('denied')) };
        const throwing = { fullscreenElement: {}, exitFullscreen: () => { throw new Error('sync'); } };
        const ignoring = { fullscreenElement: {}, exitFullscreen: () => Promise.resolve() };      // resolves but the browser stays fullscreen
        const unsupported = { fullscreenElement: {} };
        const warn = console.warn; console.warn = () => {};
        try {
            for (const [name, doc] of Object.entries({ rejecting, throwing, ignoring, unsupported })) {
                await withDocument(doc, async () => assert.equal(await exitFullscreenSafely(), false, name));
            }
            await withDocument(rejecting, async () => { assert.equal(await exitFullscreenSafely(), false, 'a later call is not stuck behind the failed one'); });
        } finally { console.warn = warn; }
    });

    test('14. the workspace leaves fullscreen in ONE place: finishAssessment, before onFinished; intermediate sections never touch it', () => {
        assert.equal((workspaceSrc.match(/releaseFullscreenRef\.current\?\.\(\)/g) || []).length, 1);
        const finish = workspaceSrc.slice(workspaceSrc.indexOf('const finishAssessment = useCallback'), workspaceSrc.indexOf('}, [onFinished, navigate, sessionUuid]);'));
        assert.ok(finish.indexOf('releaseFullscreenRef.current?.()') > 0 && finish.indexOf('releaseFullscreenRef.current?.()') < finish.indexOf('onFinished(outcome)'), 'the exit is requested without being awaited, so the completion page never waits for it');
        assert.ok(!/exitFullscreen|document\.fullscreenElement\s*&&\s*document\.exit/.test(workspaceSrc), 'no scattered direct exit calls');
        assert.ok(workspaceSrc.includes('releaseFullscreenRef.current = releaseFullscreen;'));
        for (const handler of ['handleSubmitAptitude', 'handleSubmitCoding', 'handleStartAssessment']) {
            const start = workspaceSrc.indexOf(`const ${handler} = async`);
            const body = workspaceSrc.slice(start, workspaceSrc.indexOf('\n    };', start));
            assert.ok(!/releaseFullscreen/.test(body), `${handler} does not release fullscreen directly`);
        }
    });

    test('15. finishAssessment is reached only when the assessment is over: after an accepted final submission, or when the server closed it', () => {
        const interview = workspaceSrc.slice(workspaceSrc.indexOf('const handleSubmitInterview = async'), workspaceSrc.indexOf('// ── Auto-submit handlers'));
        assert.ok(interview.indexOf('await api.submitInterview(') < interview.indexOf("finishAssessment('completed')"), 'finish only after the server accepted the final section');
        const failure = interview.slice(interview.indexOf('} catch (err) {'));
        const finishInCatch = [...failure.matchAll(/finishAssessment\(/g)].length;
        assert.equal(finishInCatch, 1, 'the failure path finishes only for a closed attempt');
        assert.ok(failure.indexOf('isClosedAttemptStatus(err?.response?.status)') < failure.indexOf("finishAssessment('closed')"));
        assert.ok(failure.includes('setInterviewSubmitError(interviewSubmitErrorMessage(err))') && failure.includes('setShowEndInterviewModal(true)'), 'a failed submission stays on the screen for a retry');
        const aptitude = workspaceSrc.slice(workspaceSrc.indexOf('const handleSubmitAptitude = async'), workspaceSrc.indexOf('// ── Round 2: Coding Operations'));
        assert.ok(aptitude.indexOf("if (retestSection) { finishAssessment('completed'); return; }") > aptitude.indexOf('await api.submitAptitude('), 'a retest ends after its one section was accepted');
        assert.ok(!/catch \(err\) \{[^]*finishAssessment/.test(aptitude.slice(aptitude.indexOf('} catch (err) {'))), 'a failed aptitude submission never finishes');
        const timeExpired = workspaceSrc.slice(workspaceSrc.indexOf('const handleTimeExpired = () => {'), workspaceSrc.indexOf('const handleAutoSubmitDueToMalpractice'));
        assert.ok(timeExpired.includes('handleSubmitAptitude()') && timeExpired.includes('handleSubmitCoding()') && timeExpired.includes('handleSubmitInterview()') && !/finish|Fullscreen/.test(timeExpired), 'a timeout runs the same submit handlers, so it exits only when that submission is the final one');
    });

    test('16. the hook switches enforcement off BEFORE asking the browser to leave, so the exit is not a violation; entry enforcement is unchanged', () => {
        const release = hookSrc.slice(hookSrc.indexOf('const releaseFullscreen = useCallback'), hookSrc.indexOf('/**\r\n     * fullscreenchange event listener') > 0 ? hookSrc.indexOf('/**\r\n     * fullscreenchange event listener') : hookSrc.indexOf('/**\n     * fullscreenchange event listener'));
        assert.ok(release.indexOf('isCompletedRef.current = true') >= 0 && release.indexOf('isCompletedRef.current = true') < release.indexOf('exitFullscreenSafely()'));
        assert.ok(release.includes('enabledRef.current = false') && release.includes('clearRecoveryTimer()') && release.includes('setIsRecoveryOpen(false)'));
        assert.ok(hookSrc.includes('releaseFullscreen,') && hookSrc.includes("import { exitFullscreenSafely } from '../utils/exitFullscreen'"));
        for (const kept of ['if (!enabledRef.current || isCompletedRef.current) return;', 'if (!hasEnteredRef.current) return;', 'onRecoveryTimeoutRef.current()', 'const [isGateOpen, setIsGateOpen] = useState(enabled && !isCompleted);']) {
            assert.ok(hookSrc.includes(kept), kept);
        }
        assert.ok(workspaceSrc.includes('enabled: currentStage !== \'instructions\' && currentStage !== \'device_check\' && !sessionData?.is_completed,'), 'enforcement still follows the active stages');
    });
});

describe('Branding: the ThirdEye Data logo in the shared candidate header', () => {
    const shellSrc = read('src/components/candidate/CandidateShell.jsx');
    const header = shellSrc.slice(shellSrc.indexOf('<header'), shellSrc.indexOf('</header>'));

    test('17. the header uses the app\'s one existing logo asset, unstretched, with alt text; PrepWin and the Candidate Assessment label are kept', () => {
        assert.ok(fs.existsSync(path.join(__dirname, 'public', 'logo_main.png')), 'the existing asset');
        assert.equal((header.match(/<img /g) || []).length, 1, 'exactly one logo');
        assert.ok(header.includes('src="/logo_main.png"') && header.includes('alt="ThirdEye Data"'));
        assert.ok(header.includes('h-7 w-auto') && header.includes('object-contain') && header.includes('width="115" height="28"'), 'fixed height, automatic width: never stretched');
        assert.ok(header.includes('>PrepWin</span>') && header.includes('>Candidate Assessment</span>'));
        assert.ok(header.includes('h-14'), 'the header keeps its 56px height');
        assert.ok(!/<(?:footer)/.test(shellSrc), 'no footer was added');
    });

    test('18. both pages get it through the shell and render no second logo of their own', () => {
        assert.ok(entrySrc.includes('<CandidateShell') && completeSrc.includes('<CandidateShell'));
        for (const src of [entrySrc, completeSrc, loginSrc]) assert.ok(!/logo_main|<img /.test(src), 'no duplicate logo');
    });
});

describe('Student account required page', () => {
    const start = completeSrc.indexOf('if (!isStudent) {');
    const block = completeSrc.slice(start, completeSrc.indexOf('if (loadError) {'));

    test('19. same guard as before; compact centred card; required wording; one action to the assessment\'s own student sign-in', () => {
        assert.ok(completeSrc.includes('if (!isSignedIn) return <Navigate to={`/assessment/join/${shareToken}`} replace />;'), 'signed-out visitors: unchanged');
        assert.ok(completeSrc.includes('const isStudent = isSignedIn && user?.role === \'STUDENT\';') && start > completeSrc.indexOf('if (!isSignedIn)'), 'the condition is unchanged');
        assert.ok(block.includes('Student account required</h1>') && block.includes('You must sign in with the student account associated with this assessment.'));
        assert.ok(block.includes('max-w-xl') && block.includes('mx-auto') && block.includes('${card}') && block.includes('p-6 sm:p-8'), '576px card, centred, the shared card surface');
        assert.ok(block.includes('Go to Student Login') && block.includes('navigate(`/assessment/join/${shareToken}`)'), 'the existing join / student sign-in route, assessment context kept');
        assert.ok(!/logout|\/login|auth=login|admin|setState|fetch|studentAssessmentApi/.test(block.replace(/^\s*\/\/.*$/gm, '')), 'no sign-out, admin login, or data call from this page');
        assert.ok(block.includes('${primary}') && block.includes('${greenIcon}') && !/(?:bg|border|text)-(?:amber|orange|yellow|red)-/.test(block), 'brand button and icon, no warning colours');
    });
});
