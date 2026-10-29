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
const shellSrc = read('src/components/candidate/CandidateShell.jsx');
const briefSrc = read('src/components/candidate/AssessmentBrief.jsx');
const instructionsSrc = read('src/pages/candidate/ExamInstructions.jsx');
const retestSrc = read('src/pages/candidate/RetestAssessmentPage.jsx');
const entrySrc = read('src/pages/candidate/SharedAssessmentEntry.jsx');

describe('Layout: one wide, centred container shared by the header and the content', () => {
    test('1. the content is a capped, centred container; the header has its own fixed site-width container with the brand left-aligned (it never follows the content cap)', () => {
        assert.ok(shellSrc.includes("maxWidth = 'max-w-3xl'"), 'short forms and notices keep the narrow default');
        const header = shellSrc.slice(shellSrc.indexOf('<header'), shellSrc.indexOf('</header>'));
        const main = shellSrc.slice(shellSrc.indexOf('<main'), shellSrc.indexOf('</main>'));
        assert.ok(main.includes('${maxWidth} mx-auto') && main.includes('px-4 sm:px-6 lg:px-8'), 'cap + margin-inline:auto + responsive padding');
        assert.ok(header.includes('max-w-6xl mx-auto') && header.includes('justify-start') && header.includes('px-4 sm:px-6 lg:px-8') && header.includes('h-14'), 'fixed site width, left-aligned, same side padding, 56px');
        assert.ok(!header.includes('maxWidth') && !/justify-(?:center|between|around|evenly)|text-center|mx-auto[^"]*w-/.test(header), 'nothing in the header can centre the brand or tie it to the page width');
        assert.ok(main.includes('w-full') && main.includes('py-6 sm:py-8'), 'compact vertical padding');
    });

    test('2. the instructions and retest pages ask for the wide container; the other candidate pages are untouched', () => {
        assert.equal((instructionsSrc.match(/maxWidth="max-w-6xl" framed/g) || []).length, 2, 'loading state and content use the wide, framed container');
        assert.ok(retestSrc.includes('<CandidateShell maxWidth="max-w-6xl" framed>'));
        assert.equal((entrySrc.match(/maxWidth="max-w-6xl" framed/g) || []).length, 2, 'the opening page (loading state and content) uses the same wide, framed container; its error notices keep the narrow default');
        assert.ok(!/(?<!min-)\bh-\[|style=\{\{\s*height|max-h-/.test(instructionsSrc + retestSrc + briefSrc), 'no fixed or maximum heights that could clip text (min-heights are touch targets)');
        assert.ok(!instructionsSrc.includes('p-6 sm:p-8 shadow-xs space-y-6'), 'the old nested card around the whole page is gone');
    });
});

describe('Colour and theme: neutral tokens, no warning panels', () => {
    test('3. no amber / orange / yellow anywhere on the two pre-assessment screens or their shared parts', () => {
        for (const [name, src] of Object.entries({ instructionsSrc, retestSrc, briefSrc })) {
            assert.ok(!/(?:bg|border|text|marker|ring|from|to)-(?:amber|orange|yellow|red)-\d/.test(src), `${name}: warning colours`);
            assert.ok(!/border-l-\d/.test(src), `${name}: no vertical accent borders`);
            assert.ok(!/#[0-9a-f]{3,6}\b/i.test(src.replace(/#5d8c2c|#4c7324|#9fd05a/gi, '')), `${name}: only the PrepWin brand hex values`);
        }
    });

    test('4. every surface has a light AND a dark counterpart (slate tokens + brand green)', () => {
        for (const needle of ['bg-white dark:bg-slate-900', 'border-slate-200 dark:border-slate-800', 'text-slate-900 dark:text-slate-100', 'text-slate-600 dark:text-slate-400', 'bg-slate-50 dark:bg-slate-950/40', 'ring-slate-200 dark:bg-slate-800 dark:text-slate-300']) {
            assert.ok(briefSrc.includes(needle), needle);
        }
        assert.ok(briefSrc.includes('bg-[#5d8c2c] hover:bg-[#4c7324]') && briefSrc.includes('min-h-[44px]'), 'primary button: brand green, hover, 44px touch target');
        assert.ok(briefSrc.includes('disabled:bg-slate-200 disabled:text-slate-400') && briefSrc.includes('dark:disabled:bg-slate-800'), 'disabled is a clearly different neutral, not a faded green');
        assert.ok(briefSrc.includes('focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60'), 'visible keyboard focus');
        assert.ok(briefSrc.includes('dark:border-slate-600 dark:bg-slate-800 accent-[#5d8c2c]') && instructionsSrc.includes('className={checkboxCls}'), 'the confirmation checkbox follows the theme');
    });
});

describe('Assessment Rules card', () => {
    test('5. five short rules in a neutral "Assessment Rules" card: nothing collapsed, nothing long', async () => {
        const brief = await loadModule('src/components/candidate/AssessmentBrief.jsx');
        const rules = brief.fullAssessmentRules({ sections: [{ minutes: 20 }, { minutes: 20 }, { minutes: 20 }], totalMinutes: 60 });
        assert.equal(rules.length, 5);
        assert.ok(rules.every((r) => r.text.split(/[.!?]\s/).length <= 2 && r.text.length <= 80), 'each rule is one short sentence (two for the time limit)');
        const html = renderToStaticMarkup(React.createElement(brief.RulesCard, { rules }));
        assert.match(html, /aria-label="Assessment Rules"/);
        assert.match(html, /<h2[^>]*>.*Assessment Rules<\/h2>/);
        for (const r of rules) assert.ok(html.includes(r.title) && html.includes(r.text.replace(/'/g, '&#x27;')) || html.includes(r.text), r.title);
        assert.equal((html.match(/<li /g) || []).length, 5, 'exactly five rows');
        assert.ok(!html.includes('<details') && !html.includes('Read the full rules'), 'no accordion: the extra rules are removed, not hidden');
        assert.ok(!html.includes('Rules of Assessment') && !/amber|orange|yellow/.test(html));
        assert.ok(html.includes('sm:grid-cols-2'), 'two-column layout from the sm breakpoint');
        assert.ok(!('RuleGroups' in brief), 'the grouped long-rules renderer is gone');
    });

    test('5b. the rules are rows in ONE bordered neutral panel: info icon, bold labels, light dividers (not a card per rule, not a warning banner)', () => {
        const rulesBlock = briefSrc.slice(briefSrc.indexOf('export const RulesCard'));
        assert.ok(rulesBlock.includes('${panelCls}') && rulesBlock.includes('<Info size={17}') && !rulesBlock.includes('ShieldCheck'));
        assert.ok(rulesBlock.includes('border-t border-slate-200 dark:border-slate-700/70 py-2.5 first:border-t-0'), 'rows are separated by light dividers');
        assert.ok(rulesBlock.includes('text-sm font-bold') && rulesBlock.includes('text-[13px] leading-5'), 'bold label + short description');
        assert.ok(rulesBlock.includes('sm:grid-cols-2') && rulesBlock.includes('col-span-full'));
        assert.ok(!/<li[^>]*(?:rounded|shadow|bg-)/.test(rulesBlock), 'no rule is wrapped in its own card');
    });

    test('6. section cards share one structure (icon, caption, name, duration) so a row of them is equal height', async () => {
        const brief = await loadModule('src/components/candidate/AssessmentBrief.jsx');
        const html = renderToStaticMarkup(React.createElement(brief.SectionCard, { caption: 'Section 3', label: 'AI Technical Interview', minutes: 20, icon: brief.SECTION_ICONS.interview }));
        assert.ok(html.includes('Section 3') && html.includes('AI Technical Interview') && html.includes('20 minutes') && html.includes('h-full') && html.includes('break-words'));
        assert.ok(instructionsSrc.includes('grid gap-3 sm:grid-cols-3') && instructionsSrc.includes('Maximum overall duration: {total} minutes'));
        assert.ok(instructionsSrc.includes('Your timer has <b>not</b> started'), 'wording the workflow tests rely on is unchanged');
        assert.ok(instructionsSrc.includes('id="instructions-ack"') && instructionsSrc.includes('Continue to Device Check') && instructionsSrc.includes('saveAcknowledgement(shareToken)'));
    });
});

describe('Section retest: only the assigned section', () => {
    test('7. the retest page never references the three-section overview, the overall limit or the other sections', () => {
        for (const forbidden of ['meta.sections', 'DEFAULT_SECTIONS', 'total_duration_minutes', 'Maximum overall duration', 'Section {', 'idx + 1', 'sections in order']) {
            assert.ok(!retestSrc.includes(forbidden), `retest page must not contain ${forbidden}`);
        }
        assert.ok(retestSrc.includes('{info.label} Retest</h1>'), '"Aptitude Retest" / "Coding Retest" / "AI Technical Interview Retest"');
        assert.ok(retestSrc.includes('minutes={info.minutes} format={info.format}'), 'duration and format come from the server response');
        assert.ok(retestSrc.includes('You are retaking only the {info.label} section. Your other sections are unaffected.'));
    });

    test('8. a retest shows three short rules of its own (one attempt, submit on time, stay on screen); no whole-assessment rules', async () => {
        const brief = await loadModule('src/components/candidate/AssessmentBrief.jsx');
        const rules = brief.retestRules({ minutes: 20 });
        assert.deepEqual(rules.map((r) => [r.title, r.text]), [
            ['One Attempt', 'You cannot restart after starting.'],
            ['Submit on Time', 'You have 20 minutes. Submit before the timer ends.'],
            ['Stay on Screen', 'Avoid refreshing, closing the tab, or switching windows.'],
        ]);
        for (const r of rules) assert.ok(!/section|60|overall|next|previous|three/i.test(r.text), `retest rule mentions only this retest: ${r.text}`);
        assert.ok(retestSrc.includes('retestRules({ minutes: info.minutes })'));
        assert.ok(!retestSrc.includes('info.rules') && !retestSrc.includes('normalizeRules') && !retestSrc.includes('<details'), 'the server\'s whole-assessment rule groups are never used for a retest');
        assert.ok(retestSrc.includes('lg:grid-cols-5') && retestSrc.includes('lg:col-span-2') && retestSrc.includes('lg:col-span-3'), 'details + rules share one row, no empty column');
    });

    test('9. the retest workflow, validity display, sign-in and acknowledgement are unchanged', () => {
        for (const needle of ['SIGN_IN_REQUIRED', 'You do not need to register again.', 'retestApi.info(retestUuid, token)', 'createRetestAssessmentApi', 'retestSection={info.section}',
          'can no longer be started or submitted', 'Continue to device check', "setPhase('ready')", 'HEARTBEAT_MS']) {
            assert.ok(retestSrc.includes(needle), needle);
        }
        assert.ok(briefSrc.includes('data-testid="retest-valid-until"'), 'the validity note lives with the validity row of the retest card');
    });
});

describe('Visual structure: one framed container, bordered cards, focused retest card', () => {
    test('10. the instructions and retest screens sit in ONE bordered, softly shadowed 16px frame on a darker page background', () => {
        assert.ok(shellSrc.includes("framed ? 'bg-slate-100 dark:bg-slate-950' : 'bg-slate-50 dark:bg-slate-950'"), 'the page background contrasts with the white frame');
        assert.ok(shellSrc.includes('rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm'), '1px border, theme surface, very subtle shadow, 16px radius');
        assert.ok(shellSrc.includes('data-testid="assessment-frame"'));
        for (const src of [instructionsSrc, retestSrc]) assert.ok(src.includes('framed>'));
    });

    test('11. panels inside the frame are 12px, 1px-bordered and tinted; section cards get a restrained green hover', async () => {
        assert.ok(briefSrc.includes("panelCls = 'rounded-xl border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-950/40'"));
        const brief = await loadModule('src/components/candidate/AssessmentBrief.jsx');
        const html = renderToStaticMarkup(React.createElement(brief.SectionCard, { caption: 'Section 1', label: 'Aptitude', minutes: 20, icon: brief.SECTION_ICONS.aptitude }));
        for (const needle of ['rounded-xl border', 'hover:border-[#5d8c2c]/50', 'h-full', 'Section 1', 'Aptitude', '20 minutes', 'rounded-full']) assert.ok(html.includes(needle), needle);
        assert.ok(!/shadow-(?:md|lg|xl)|gradient/.test(briefSrc + shellSrc), 'no heavy shadows or gradients');
    });

    test('12. the retest card is ONE focused card: title, duration badge, format and validity; the type comes from the server\'s section, not from text', async () => {
        const brief = await loadModule('src/components/candidate/AssessmentBrief.jsx');
        const html = renderToStaticMarkup(React.createElement(brief.RetestSectionCard, { label: 'Aptitude', minutes: 20, format: '15 multiple-choice questions', validUntil: 'Oct 30, 2026, 5:35 PM', validNote: 'After this time…', icon: brief.SECTION_ICONS.aptitude }));
        for (const needle of ['Retest section', 'Aptitude', '20 minutes', 'rounded-full', '15 multiple-choice questions', 'Valid until Oct 30, 2026, 5:35 PM', 'aria-label="Retest details"']) assert.ok(html.includes(needle), needle);
        assert.ok(retestSrc.includes('SECTION_ICONS[info.section]') && retestSrc.includes('info.format') && retestSrc.includes('info.minutes'), 'driven by the response fields, never by matching visible text');
        assert.ok(!/\.includes\(['"`](?:Aptitude|Coding|Interview)|label\s*===|label\.(?:match|test)/.test(retestSrc), 'no string matching on section names');
    });

    test('13. controls: 44px primary buttons with a distinct disabled state, themed 20px checkbox, same labels', () => {
        assert.ok(briefSrc.includes('checkboxCls =') && briefSrc.includes('h-5 w-5') && briefSrc.includes('dark:bg-slate-800 accent-[#5d8c2c]'));
        assert.ok(instructionsSrc.includes('className={checkboxCls} id="instructions-ack"') && retestSrc.includes('className={checkboxCls}'));
        assert.ok(instructionsSrc.includes('Continue to Device Check') && retestSrc.includes('Continue to device check'), 'labels unchanged');
        assert.ok(instructionsSrc.includes('disabled={!acknowledged}') && retestSrc.includes('disabled={!accepted}'), 'still locked until the rules are accepted');
    });
});
