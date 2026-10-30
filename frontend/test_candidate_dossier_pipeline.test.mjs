// The ONE Candidate Dossier pipeline: every complete candidate PDF (admin Print, admin Export, student Download) is drawn from the
// same model. These tests pin the content, the section order, the footer, the logo and the audit of who may produce a candidate PDF.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';
import { adminDossier, studentReport } from './test_support/dossierFixtures.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const png = fs.readFileSync(path.join(root, 'public/logo_main.png'));
const LOGO = { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
const NOW = new Date('2030-03-04T10:15:00');

const ORDER = ['candidate', 'scores', 'timeline', 'sitting', 'proctoring', 'aptitude', 'coding', 'interview', 'transcript'];
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();    // table headings are drawn upper-case by both renderers

/** Every string the PDF draws, in drawing order (jsPDF writes standard-font text as "(...) Tj"). */
const pdfPages = (doc) => doc.internal.pages.slice(1).map((ops) => {
    const stream = ops.join('\n');
    return [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join(' ');
});

const load = async () => {
    const model = await loadModule('src/utils/candidateDossier/model.js');
    const renderer = await loadModule('src/utils/candidateDossier/pdfRenderer.js');
    return { model, renderer };
};

describe('Shared Candidate Dossier model', () => {
    test('1. every complete report has the same sections in the same order, whoever asks for it', async () => {
        const { model: m } = await load();
        const cases = {
            'admin completed (long)': m.buildAdminDossierModel(adminDossier({ long: true })),
            'admin completed (short)': m.buildAdminDossierModel(adminDossier({ long: false })),
            'admin incomplete': m.buildAdminDossierModel(adminDossier({ long: false, incomplete: true })),
            'admin missing optional data': m.buildAdminDossierModel(adminDossier({ long: false, minimal: true })),
            'student': m.buildStudentReportModel(studentReport({ long: true })),
        };
        for (const [name, model] of Object.entries(cases)) {
            const kinds = model.sections.map((s) => s.kind).filter((k) => k !== 'retests');
            assert.deepEqual(kinds, ORDER, name);
        }
        assert.deepEqual(m.SECTION_KINDS, ORDER);
        // retest history is extra audit data of the admin copy and always comes last
        assert.equal(cases['admin completed (long)'].sections.at(-1).kind, 'retests');
        // a candidate who has not started has the existing single message, nothing invented
        const idle = m.buildAdminDossierModel(adminDossier({ notStarted: true }));
        assert.deepEqual(idle.sections.map((s) => s.kind), ['candidate', 'message']);
        assert.equal(idle.sections[1].text, 'This candidate has registered but has not started the assessment.');
    });

    test('2. values are the server\'s: nothing is recalculated or replaced by a placeholder', async () => {
        const { model: m } = await load();
        const d = adminDossier({ long: false });
        const model = m.buildAdminDossierModel(d);
        const by = Object.fromEntries(model.sections.map((s) => [s.kind, s]));
        assert.deepEqual(by.scores.cards.map((c) => c.value), ['85.0%', '90.0%', '87.5%', '87.5%']);
        assert.deepEqual(by.scores.cards.map((c) => c.label), ['Aptitude', 'Coding', 'Interview', 'Overall (equal weight)']);
        assert.equal(by.scores.note, null);
        assert.deepEqual(by.timeline.columns, ['Section', 'Status', 'Started', 'Submitted', 'Time spent']);
        assert.deepEqual(by.timeline.rows.map((r) => r.cells[0]), ['Aptitude', 'Coding', 'AI Technical Interview']);
        assert.equal(by.timeline.rows[0].cells[4], '20m 00s');
        assert.ok(by.sitting.text.startsWith('Sitting started ') && by.sitting.text.includes('rules acknowledged'));
        assert.ok(by.candidate.notice.includes('self-reported and unverified'));
        assert.deepEqual(by.candidate.fields.map((f) => f.label), ['Email', 'Phone', 'Job role', 'Company', 'Registered']);
        // incomplete: the existing INCOMPLETE rule, section scores kept, unattempted sections are named, not dropped
        const inc = m.buildAdminDossierModel(adminDossier({ long: false, incomplete: true }));
        const cards = inc.sections.find((s) => s.kind === 'scores');
        assert.deepEqual(cards.cards.map((c) => c.value), ['85.0%', '—', '—', 'INCOMPLETE']);
        assert.ok(cards.note.startsWith('Overall is shown only when all three sections were completed'));
        assert.equal(inc.sections.find((s) => s.kind === 'coding').empty, 'No review data is available for this section.');
        // missing optional data: rows are left out, never faked
        const min = m.buildAdminDossierModel(adminDossier({ long: false, minimal: true }));
        assert.deepEqual(min.sections[0].fields.map((f) => f.label), ['Email', 'Job role', 'Registered']);
        assert.equal(min.sections.find((s) => s.kind === 'transcript').empty, 'No review data is available for this section.');
    });

    test('3. the student copy carries the same sections but never the data the server withholds', async () => {
        const { model: m } = await load();
        const spiked = studentReport({ long: false });
        // even if a forbidden field slipped into the payload, the student copy must not print it
        spiked.sections[0].questions[0].correct_key = 'SECRET-KEY';
        spiked.sections[1].problems[0].code = 'SECRET-CODE';
        spiked.sections[2].questions[0].response = 'SECRET-ANSWER';
        const model = m.buildStudentReportModel(spiked);
        const all = m.modelTextLines(model).join('\n');
        for (const secret of ['SECRET-KEY', 'SECRET-CODE', 'SECRET-ANSWER']) assert.ok(!all.includes(secret), secret);
        const by = Object.fromEntries(model.sections.map((s) => [s.kind, s]));
        assert.ok(by.proctoring.restricted && by.transcript.restricted, 'proctoring and transcript stay in place with a notice');
        assert.ok(by.sitting.empty.includes('not included'));
        assert.ok(by.aptitude.note.includes('Correct answers are not included') && by.coding.note.includes('code is not included') && by.interview.note.includes('answers are not included'));
        assert.ok(!by.candidate.notice, 'the contact-verification notice is an administrator review note');
        assert.ok(by.aptitude.items.every((i) => !i.line.includes('Correct answer')));
    });

    test('4. for the same candidate the admin and student copies agree on every value both may see', async () => {
        const { model: m } = await load();
        const a = Object.fromEntries(m.buildAdminDossierModel(adminDossier({ long: true })).sections.map((s) => [s.kind, s]));
        const s = Object.fromEntries(m.buildStudentReportModel(studentReport({ long: true })).sections.map((x) => [x.kind, x]));
        assert.deepEqual(s.scores, a.scores);
        assert.equal(s.candidate.name, a.candidate.name);
        assert.deepEqual(s.candidate.fields.filter((f) => ['Email', 'Job role', 'Company'].includes(f.label)), a.candidate.fields.filter((f) => ['Email', 'Job role', 'Company'].includes(f.label)));
        assert.deepEqual(s.timeline.rows.map((r) => [r.cells[0], r.cells[1], r.cells[4]]), a.timeline.rows.map((r) => [r.cells[0], r.cells[1], r.cells[4]]));
        assert.equal(s.aptitude.title, a.aptitude.title);
        assert.deepEqual(s.aptitude.items.map((i) => [i.question, i.ok]), a.aptitude.items.map((i) => [i.question, i.ok]));
        assert.deepEqual(s.coding.problems.map((p) => p.heading), a.coding.problems.map((p) => p.heading));
        assert.deepEqual(s.coding.problems.map((p) => p.meta.split(' · ').slice(0, 2)), a.coding.problems.map((p) => p.meta.split(' · ').slice(0, 2)));
        assert.deepEqual(s.interview.items.map((i) => i.heading), a.interview.items.map((i) => i.heading));
        assert.deepEqual(s.interview.intro, a.interview.intro);
    });

    test('5. labels and number formats are the admin screen\'s', async () => {
        const { model: m } = await load();
        const ui = await loadModule('src/components/admin/adminUi.jsx');
        for (const [k, v] of Object.entries(ui.STATUS_META)) assert.equal(m.STATUS_LABELS[k], v.label, k);
        for (const v of [null, 0, 85, 87.55, 100]) assert.equal(m.formatScore(v), ui.formatScore(v));
        for (const v of [null, undefined, 0, 59, 1200]) assert.equal(m.formatDuration(v), ui.formatDuration(v));
        for (const v of [null, '', 'bad', '2026-10-25T11:00:00Z']) assert.equal(m.formatDate(v), ui.formatDate(v));
    });
});

describe('PDF renderer (admin Export and student Download)', () => {
    const build = async (model, opts = {}) => (await load()).renderer.renderDossierPdf(model, { logo: LOGO, now: NOW, ...opts });

    test('6. the PDF starts on page 1 and contains every line of the model, sections in order', async () => {
        const { model: m } = await load();
        for (const [name, model] of [
            ['admin long', m.buildAdminDossierModel(adminDossier({ long: true }))],
            ['admin incomplete', m.buildAdminDossierModel(adminDossier({ long: false, incomplete: true }))],
            ['admin minimal', m.buildAdminDossierModel(adminDossier({ long: false, minimal: true }))],
            ['admin not started', m.buildAdminDossierModel(adminDossier({ notStarted: true }))],
            ['student', m.buildStudentReportModel(studentReport({ long: true }), NOW)],
        ]) {
            const doc = await build(model);
            const pages = pdfPages(doc);
            assert.ok(pages[0].includes('Candidate Dossier') && pages[0].includes(model.sections[0].name), `${name}: page 1 holds the header and the candidate`);
            assert.ok(pages.every((p) => p.length > 40), `${name}: no blank page`);
            const flat = norm(pages.join(' '));
            const { renderer } = await load();
            for (const line of m.modelTextLines(model)) {
                const want = norm(renderer.safeText(line));
                if (want) assert.ok(flat.includes(want), `${name}: missing "${line.slice(0, 70)}"`);
            }
            // section headings appear in the model's order
            const heads = model.sections.map((s) => s.title).filter(Boolean).map((t) => norm(renderer.safeText(t)));
            let at = -1;
            for (const h of heads) { const i = flat.indexOf(h, at + 1); assert.ok(i > at, `${name}: "${h}" out of order`); at = i; }
        }
    });

    test('7. every page has the footer once: date, platform title, URL, and a "n / total" taken from the real page count', async () => {
        const { model: m } = await load();
        for (const model of [m.buildAdminDossierModel(adminDossier({ long: true })), m.buildAdminDossierModel(adminDossier({ long: false })), m.buildStudentReportModel(studentReport({ long: false }), NOW)]) {
            const doc = await build(model);
            const pages = pdfPages(doc);
            const total = pages.length;
            assert.ok(total >= 1);
            pages.forEach((text, i) => {
                assert.equal(text.split(m.BRAND.platformTitle.replace('—', '-')).length - 1, 1, `page ${i + 1}: one platform title`);
                assert.equal(text.split('Generated ').length - 1, 1, `page ${i + 1}: one generated stamp`);
                assert.ok(text.includes(`${i + 1} / ${total}`), `page ${i + 1} / ${total}`);
                assert.equal(text.split(model.reportUrl).length - 1, 1, `page ${i + 1}: report URL`);
            });
            assert.ok(pages[0].includes(m.generatedStamp(NOW)));
            const bytes = doc.output();
            assert.ok(bytes.includes(`/URI (${model.reportUrl})`), 'the URL is a clickable link');
            assert.ok(!pages.some((p) => p.includes('Candidate Assessment Dossier')));
        }
    });

    test('8. the THIRDEYE logo is the project\'s own PNG, drawn once at its own proportions; PrepWin is on the right', async () => {
        const { model: m } = await load();
        const model = m.buildAdminDossierModel(adminDossier({ long: false }));
        const doc = await build(model);
        const out = doc.output();
        const images = [...out.matchAll(/\/Subtype \/Image[^>]*?\/Width (\d+)\s*\/Height (\d+)|\/Width (\d+)\s*\/Height (\d+)[^>]*?\/Subtype \/Image/g)];
        assert.ok(images.length >= 1 && images.length <= 2, 'the logo (plus its transparency mask), nothing else');
        for (const im of images) assert.deepEqual([Number(im[1] || im[3]), Number(im[2] || im[4])], [LOGO.width, LOGO.height], 'original pixel size: proportions are untouched');
        const page1 = pdfPages(doc)[0];
        assert.ok(page1.indexOf('Candidate Dossier') < page1.indexOf('Recruitment Assessment Intelligence') && page1.indexOf('Recruitment Assessment Intelligence') < page1.indexOf('PrepWin'));
        const noLogo = await build(model, { logo: null });
        assert.equal((noLogo.output().match(/\/Subtype \/Image/g) || []).length, 0, 'no logo file: plain text, never a redrawn logo');
    });

    test('9. both public builders go through it: admin Export and student Download', async () => {
        const admin = await loadModule('src/utils/candidateDossierPdf.js');
        const student = await loadModule('src/utils/studentReportPdf.js');
        const a = await admin.buildCandidateDossierPdf(adminDossier({ long: false }), { logo: LOGO, now: NOW });
        const s = await student.buildReportPdf(studentReport({ long: false }), { logo: LOGO, now: NOW });
        const [pa, ps] = [pdfPages(a).join(' '), pdfPages(s).join(' ')];
        for (const needle of ['Candidate Dossier', 'Timeline', 'Aptitude review', 'Coding review', 'Interview responses', 'Voice interview transcript', 'Overall (equal weight)']) {
            assert.ok(pa.includes(needle) && ps.includes(needle), needle);
        }
        await assert.rejects(() => student.buildReportPdf({ sections: 'nope' }), /incomplete/);
        await assert.rejects(() => admin.buildCandidateDossierPdf(null), /required/i);
    });
});

describe('Print renderer (browser Print / Save as PDF) draws the same model', () => {
    const html = async (model) => {
        const { default: Doc } = await loadModule('src/components/admin/DossierPrintDocument.jsx');
        return renderToStaticMarkup(createElement(Doc, { model }));
    };
    const textOf = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"');

    test('10. same sections, same order, same text as the model (so as the PDF)', async () => {
        const { model: m } = await load();
        for (const model of [m.buildAdminDossierModel(adminDossier({ long: true })), m.buildAdminDossierModel(adminDossier({ long: false, incomplete: true })), m.buildAdminDossierModel(adminDossier({ notStarted: true })), m.buildStudentReportModel(studentReport({ long: false }))]) {
            const markup = await html(model);
            assert.deepEqual([...markup.matchAll(/data-section="([a-z]+)"/g)].map((x) => x[1]), model.sections.map((s) => s.kind));
            const flat = norm(textOf(markup));
            for (const line of m.modelTextLines(model)) assert.ok(flat.includes(norm(line)), `missing "${line.slice(0, 70)}"`);
            assert.ok(!markup.includes('Candidate Assessment Dossier') && !markup.includes('Official Evaluation Report'));
        }
    });

    test('11. header: title top-left, THIRDEYE logo and subtitle left, PrepWin right; the logo is the existing asset, once', async () => {
        const { model: m } = await load();
        const markup = await html(m.buildAdminDossierModel(adminDossier({ long: false })));
        const i = (s) => markup.indexOf(s);
        assert.ok(i('dsr-title') < i('dsr-brandrow') && i('logo_main.png') < i('Recruitment Assessment Intelligence') && i('Recruitment Assessment Intelligence') < i('dsr-product'));
        assert.equal((markup.match(/logo_main\.png/g) || []).length, 1);
        assert.ok(markup.includes('>PrepWin</p>'));
        assert.equal((markup.match(/class="dsr-card"/g) || []).length, 4);
    });

    test('12. print stylesheet: nothing else takes room, A4 margins leave no browser header, the footer is dynamic', async () => {
        const css = await loadModule('src/utils/candidateDossier/printCss.js');
        const model = await load();
        const text = css.PRINT_CSS;
        assert.ok(/body > \*:not\(\.pw-dossier-dialog\) \{ display: none !important; \}/.test(text), 'the app shell is display:none, not visibility:hidden');
        assert.ok(!/body \* \{/.test(text) && !/visibility: hidden/.test(text));
        const margin = text.match(/size: A4 portrait;\s+margin: ([\d.]+)mm ([\d.]+)mm ([\d.]+)mm;/);
        assert.ok(margin && Number(margin[1]) <= 8 && Number(margin[3]) >= 18, 'top margin below Chrome\'s header threshold, bottom reserves the footer');
        assert.ok(text.includes('content: counter(page) " / " counter(pages);'), 'page n / total come from the browser, never hard-coded');
        assert.ok(text.includes('box-decoration-break: clone'));
        assert.ok(!/(page-break|break)-(before|after): (page|always)/.test(text), 'no forced page breaks');
        assert.ok(/\.dsr-item \{ break-inside: avoid;/.test(text) && text.includes('display: table-header-group'), 'short items stay whole, table heads repeat');
        assert.ok(text.includes('.dsr-boxtitle') && text.includes('break-after: avoid'), 'headings stay with their content');
        assert.ok(!/#[0-9a-f]{3,6}\b/i.test(text), 'colours come from the shared theme tokens');
        const footer = css.printFooterCss({ reportUrl: model.model && 'https://example.test/r' }, NOW);
        assert.ok(footer.includes('"Generated ') && footer.includes('"\\A"') && footer.includes('https://example.test/r'));
        assert.ok(footer.includes('PrepWin — AI-Powered Job Readiness & Assessment Platform'));
    });
});

describe('Entry points and audit guard', () => {
    test('13. Print, Export and the student Download are wired to the shared pipeline', () => {
        const modal = read('src/components/admin/CandidateReportModal.jsx');
        assert.ok(modal.includes('buildAdminDossierModel(data)') && modal.includes('<DossierPrintDocument model={model} />') && modal.includes('window.print()'));
        assert.ok(modal.includes('downloadCandidateDossierPdf(data)') && modal.includes('onClick={exportPdf}'));
        assert.ok(modal.includes("window.addEventListener('beforeprint'") && /handlePrint = \(\) => \{\s+stampPrintFooter\(\);/.test(modal), 'footer date stamped for the button and Ctrl+P');
        assert.ok(modal.includes("classList.remove('dark')") && modal.includes("window.addEventListener('afterprint'"), 'printed on white paper whatever the theme');
        const adminPdf = read('src/utils/candidateDossierPdf.js');
        const studentPdf = read('src/utils/studentReportPdf.js');
        for (const src of [adminPdf, studentPdf]) assert.ok(src.includes("from './candidateDossier/pdfRenderer.js'") && src.includes("from './candidateDossier/model.js'") && !src.includes("import('jspdf')"), 'no private template');
        assert.ok(read('src/pages/candidate/StudentAssessmentComplete.jsx').includes('downloadStudentReport(report)'));
    });

    test('14. only known files may build a PDF; a new candidate report must use candidateDossier/ (guard against private templates)', () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) walk(rel);
                else if (/\.(jsx?|mjs)$/.test(e.name) && /jspdf/.test(read(rel))) hits.push(rel);
            }
        };
        walk('src');
        const allowed = {
            'src/utils/candidateDossier/pdfRenderer.js': 'THE candidate report renderer',
            'src/utils/reportPdf.js': 'RoleReady job-readiness report (its own content, drawn through the shared pdfChrome)',
            'src/utils/bulkExportPdf.js': 'admin bulk exports: Candidates, CandidateTable, Analytics (own content, shared pdfChrome)',
            'src/utils/resumeExport.js': 'resume document export', 'src/utils/resumeMeasure.js': 'resume layout measuring',
        };
        assert.deepEqual(hits.sort(), Object.keys(allowed).sort());
    });
});
