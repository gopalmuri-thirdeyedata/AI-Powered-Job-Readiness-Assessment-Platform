// Shared PrepWin PDF look (candidateDossier/pdfChrome.js) on the reports that are NOT a Candidate Dossier:
// the RoleReady job-readiness report and the three admin bulk exports. Content stays each report's own; header, margins, table style,
// footer and page numbers are the shared ones.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';
import { analyticsData, candidatesList, roleReadyReport, tableRows } from './test_support/bulkFixtures.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const png = fs.readFileSync(path.join(root, 'public/logo_main.png'));
const LOGO = { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
const NOW = new Date('2030-03-04T10:15:00');
const opts = { logo: LOGO, now: NOW };
const flat = (s) => String(s).replace(/\s+/g, '').toLowerCase();

const pages = (doc) => doc.internal.pages.slice(1).map((ops) => [...ops.join('\n').matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join(' '));

/** The shared look every one of these PDFs must have. */
const assertSharedLook = async (doc, name, { url = false } = {}) => {
    const chrome = await loadModule('src/utils/candidateDossier/pdfChrome.js');
    const model = await loadModule('src/utils/candidateDossier/model.js');
    const ps = pages(doc);
    const total = ps.length;
    ps.forEach((t, i) => {
        assert.equal(t.split('Generated ' + '').length - 1 >= 1, true, `${name} p${i + 1}: generated stamp`);
        assert.equal(t.split(model.BRAND.platformTitle.replace('—', '-')).length - 1, 1, `${name} p${i + 1}: one platform title`);
        assert.ok(t.includes(`${i + 1} / ${total}`), `${name} p${i + 1}: "${i + 1} / ${total}"`);
        assert.equal(t.includes('https://'), url, `${name} p${i + 1}: footer URL row only where a real destination exists`);
        assert.equal(t.split('Recruitment Assessment Intelligence').length - 1, i === 0 ? 1 : 0, `${name} p${i + 1}: brand header on page 1 only`);
    });
    assert.ok(ps[0].indexOf('Recruitment Assessment Intelligence') < ps[0].indexOf('PrepWin', ps[0].indexOf('Recruitment Assessment Intelligence')), `${name}: PrepWin sits right of the logo block`);
    assert.ok(ps.every((t) => t.length > 60), `${name}: no blank page`);
    const out = doc.output();
    assert.ok((out.match(/\/Subtype \/Image/g) || []).length >= 1, `${name}: the THIRDEYE logo file is embedded`);
    assert.ok(typeof chrome.drawBrandHeader === 'function');
};

describe('Shared PDF chrome', () => {
    test('1. geometry and table options keep everything above the footer band, inside the margins', async () => {
        const { jsPDF } = await loadModule('test_support/jspdfEntry.mjs');
        const chrome = await loadModule('src/utils/candidateDossier/pdfChrome.js');
        const g = chrome.pageGeometry(new jsPDF({ unit: 'pt', format: 'a4' }));
        const mm = chrome.MM;
        assert.ok(Math.abs(g.left - 15 * mm) < 0.01 && Math.abs(g.top - 14 * mm) < 0.01);
        assert.ok(g.bottom < g.footerLineY && g.footerLineY < g.H && Math.abs(g.H - g.footerLineY - 20 * mm) < 0.01);
        const t = chrome.tableOptions(g);
        assert.equal(t.margin.bottom, g.H - g.bottom, 'tables stop above the footer');
        assert.equal(t.margin.top, g.top, 'tables continue below the top margin on later pages');
        assert.equal(t.showHead, 'everyPage');
        assert.equal(t.rowPageBreak, 'avoid');
    });
});

describe('RoleReady report (student Export PDF)', () => {
    test('2. content is exactly what buildReportSections produces; header, footer and numbering are the shared ones', async () => {
        const m = await loadModule('src/utils/reportPdf.js');
        for (const long of [false, true]) {
            const data = roleReadyReport({ long });
            const doc = await m.buildReportPdf(data, opts);
            await assertSharedLook(doc, `roleready ${long ? 'long' : 'short'}`);
            const text = flat(pages(doc).join(' '));
            for (const b of m.buildReportSections(data)) {
                const want = b.t === 'kv' ? `${b.k}: ${b.v}` : b.text;
                assert.ok(text.includes(flat(want)), `missing "${want.slice(0, 60)}"`);
            }
            // the report's own title stays the title
            assert.ok(pages(doc)[0].includes('PrepWin Job-Readiness Report'));
        }
        assert.ok((await m.buildReportPdf(roleReadyReport({ long: true }), opts)).getNumberOfPages() >= 3, 'long reports continue on new pages');
    });

    test('3. sections keep their order (scores, skills, gaps, interview, recommendations, plan)', async () => {
        const m = await loadModule('src/utils/reportPdf.js');
        const doc = await m.buildReportPdf(roleReadyReport({ long: false }), opts);
        const t = pages(doc).join(' ');
        let at = -1;
        for (const h of ['Scores', 'Skills demonstrated', 'Areas to improve', 'Skill gap analysis', 'AI technical interview', 'Recommendations', 'Improvement plan']) {
            const i = t.indexOf(h, at + 1);                    // "AI technical interview" is also a score label inside Scores
            assert.ok(i > at, `${h} present and after the previous section`);
            at = i;
        }
    });

    test('4. Export and the print fallback are untouched', () => {
        const page = read('src/pages/roleready/RoleReadyReport.jsx');
        assert.ok(page.includes("import { downloadReportPdf } from '../../utils/reportPdf'") && page.includes('await downloadReportPdf(reportData)') && page.includes('window.print()'));
        const pdf = read('src/utils/reportPdf.js');
        assert.ok(pdf.includes('export const downloadReportPdf') && pdf.includes('doc.save(reportFileName(reportData))') && pdf.includes("from './candidateDossier/pdfChrome.js'"));
    });
});

describe('Admin bulk exports', () => {
    test('5. Candidates (full dataset): same title, lines, columns and rows; shared look', async () => {
        const m = await loadModule('src/utils/bulkExportPdf.js');
        for (const n of [6, 70]) {
            const list = candidatesList(n);
            const doc = await m.buildCandidatesFullPdf(list, opts);
            await assertSharedLook(doc, `candidates ${n}`);
            const text = flat(pages(doc).join(' '));
            assert.ok(text.includes(flat('PrepWin - Full Candidate Dataset')) && text.includes(flat('| Scope: FULL DATASET')) && text.includes(flat(`Total Candidates: ${n}`)));
            for (const h of ['S.No', 'Name', 'Email', 'Role', 'Stage', 'Status', 'Score']) assert.ok(text.includes(flat(h)), h);
            list.forEach((c) => {
                for (const v of [c.name, c.email, c.role || 'N/A', c.stage, c.status, c.score !== undefined ? `${c.score}%` : '0%']) assert.ok(text.includes(flat(v)), `row value ${v}`);
            });
            if (n === 70) assert.ok(doc.getNumberOfPages() >= 2);
        }
    });

    test('6. CandidateTable export: same title, scope line, 8 columns and every row', async () => {
        const m = await loadModule('src/utils/bulkExportPdf.js');
        const rows = tableRows(70);
        const doc = await m.buildCandidateTablePdf(rows, 'filtered', opts);
        await assertSharedLook(doc, 'candidate table');
        const text = flat(pages(doc).join(' '));
        assert.ok(text.includes(flat('PrepWin - Candidate Assessment Dataset')) && text.includes(flat('| Scope: FILTERED')) && text.includes(flat('Total Candidates: 70')));
        for (const h of ['S.No', 'Name', 'Email', 'Role', 'Stage', 'Status', 'AI Rec', 'Score']) assert.ok(text.includes(flat(h)), h);
        rows.forEach((r) => { for (const k of ['Name', 'Email', 'Job Role', 'Current Stage', 'Status', 'AI Recommendation', 'Accuracy Score']) assert.ok(text.includes(flat(r[k])), `${k}: ${r[k]}`); });
    });

    test('7. Analytics export: same metrics lines and the three tables, in the same order', async () => {
        const m = await loadModule('src/utils/bulkExportPdf.js');
        const data = analyticsData(60);
        const doc = await m.buildAnalyticsPdf(data, opts);
        await assertSharedLook(doc, 'analytics');
        const t = pages(doc).join(' ');
        const text = flat(t);
        const needles = ['PrepWin - Pipeline & Talent Intelligence Report', 'Filter: All Roles | Date Range: Last 30 Days', 'Executive Summary Metrics:',
            '- Total Applicants Evaluated: 1280', '- Active Pipeline Candidates: 342', '- Overall Placement/Hired Rate: 18.5%', '- Average Overall Talent Score: 71.2%',
            '- Pipeline Health Score: 84% (Healthy)', 'Recruitment Funnel Stage Distribution:', 'AI Talent Recommendation Breakdown:', 'Performance Insights by Job Role:'];
        let at = -1;
        for (const n of needles) { const i = text.indexOf(flat(n)); assert.ok(i > at, `"${n}" present and in order`); at = i; }
        data.funnelStages.forEach((s) => { assert.ok(text.includes(flat(s.stage)) && text.includes(flat(`${s.conversion_pct}%`))); });
        data.recommendationData.forEach((r) => assert.ok(text.includes(flat(r.name)) && text.includes(flat(`${r.percentage}%`))));
        data.roleInsights.forEach((r) => assert.ok(text.includes(flat(r.role)) && text.includes(flat(`${r.placement_rate}%`))));
        assert.ok(doc.getNumberOfPages() >= 2);
    });

    test('8. the pages call the shared builders and keep their file names; no page owns a private jsPDF template any more', async () => {
        const m = await loadModule('src/utils/bulkExportPdf.js');
        assert.match(m.candidatesFullFileName(), /^Candidates_Report_Full_\d{4}-\d\d-\d\d\.pdf$/);
        assert.match(m.candidateTableFileName('filtered'), /^Candidates_Report_filtered_\d{4}-\d\d-\d\d\.pdf$/);
        assert.match(m.analyticsFileName(), /^PrepWin_Analytics_Report_\d{4}-\d\d-\d\d\.pdf$/);
        const [cands, table, analytics] = ['src/pages/Candidates.jsx', 'src/components/CandidateTable.jsx', 'src/pages/Analytics.jsx'].map(read);
        assert.ok(cands.includes('await downloadCandidatesFullPdf(candidates);') && table.includes('await downloadCandidateTablePdf(data, type);'));
        assert.ok(analytics.includes('await downloadAnalyticsPdf({ kpi, funnelStages, recommendationData, roleInsights, selectedRoleFilter, selectedDateRange });'));
        for (const src of [cands, table, analytics]) assert.ok(!/jspdf/.test(src), 'no private jsPDF code in the page');
        assert.ok(table.includes('No data available to export.') && cands.includes('No candidate data available to export.'), 'the empty-data alerts are unchanged');
    });
});
