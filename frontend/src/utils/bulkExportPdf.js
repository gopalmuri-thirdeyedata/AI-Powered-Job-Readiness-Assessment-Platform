// The admin bulk PDF exports (candidate lists and the analytics summary), previously inline in their pages:
//   buildCandidatesFullPdf       Candidates page      -> "PrepWin - Full Candidate Dataset"
//   buildCandidateTablePdf       CandidateTable       -> "PrepWin - Candidate Assessment Dataset"
//   buildAnalyticsPdf            Analytics page       -> "PrepWin - Pipeline & Talent Intelligence Report"
// Content (titles, lines, tables, columns, rows, file names) is exactly what those handlers produced. Only the shared PrepWin look
// changed: header with the THIRDEYE logo, margins, table style, footer and "n / total" page numbers (candidateDossier/pdfChrome.js).
// These reports are not tied to a page of their own, so their footer carries no URL row.
import { THEME as C } from './candidateDossier/model.js';
import { MM, drawBrandHeader, drawFooters, loadDossierLogo, pageGeometry, safeText, setFont, tableOptions } from './candidateDossier/pdfChrome.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Starts a report: jsPDF + autoTable, page geometry, and the shared page-1 header. */
async function begin(title, { logo } = {}) {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const g = pageGeometry(doc);
    const logoFile = logo !== undefined ? logo : await loadDossierLogo();
    const ctx = { doc, g, autoTable, y: drawBrandHeader(doc, g, { title, logo: logoFile }) };

    /** A line of text (wrapped); kept on one page. */
    ctx.line = (text, { size = 9.5, bold = false, color = C.ink, indent = 0, gapAfter = 4 } = {}) => {
        setFont(doc, size, { bold, color });
        const lines = doc.splitTextToSize(safeText(text), g.cw - indent);
        const h = lines.length * size * 1.35;
        if (ctx.y + h > g.bottom) { doc.addPage(); ctx.y = g.top; }
        doc.text(lines, g.left + indent, ctx.y, { baseline: 'top', lineHeightFactor: 1.35 });
        ctx.y += h + gapAfter;
    };
    /** A section title that always stays with the table that follows it. */
    ctx.heading = (text) => {
        if (ctx.y + 11 * 1.35 + 60 > g.bottom) { doc.addPage(); ctx.y = g.top; }
        ctx.line(text, { size: 11, bold: true, gapAfter: 5 });
    };
    /** A table: shared look, compact rows (these lists can be long), header repeated on every page, never into the footer. */
    ctx.table = ({ head, body, columnStyles }) => {
        const base = tableOptions(g);
        autoTable(doc, tableOptions(g, {
            startY: ctx.y,
            head: [head.map((h) => safeText(h).toUpperCase())],
            body: body.map((r) => r.map((c) => safeText(c))),
            columnStyles,
            styles: { ...base.styles, fontSize: 8, minCellHeight: 0, cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 } },
            alternateRowStyles: { fillColor: C.panel },
        }));
        ctx.y = doc.lastAutoTable.finalY + 12;
    };
    ctx.finish = ({ now } = {}) => { drawFooters(doc, g, { reportUrl: null, now: now || new Date() }); return doc; };
    return ctx;
}

// ------------------------------------------------------------------------------ Candidates page (full dataset)
export async function buildCandidatesFullPdf(candidates, opts = {}) {
    const r = await begin('PrepWin - Full Candidate Dataset', opts);
    r.line(`Generated on: ${new Date().toLocaleString()} | Scope: FULL DATASET`, { color: C.muted });
    r.line(`Total Candidates: ${candidates.length}`, { color: C.muted, gapAfter: 10 });
    r.table({
        head: ['S.No', 'Name', 'Email', 'Role', 'Stage', 'Status', 'Score'],
        body: candidates.map((c, index) => [
            index + 1, c.name, c.email, c.role || 'N/A', c.stage, c.status, c.score !== undefined ? `${c.score}%` : '0%',
        ]),
        columnStyles: { 2: { cellWidth: 45 * MM } },   // 45 mm: the old pages measured in mm
    });
    return r.finish(opts);
}
export const candidatesFullFileName = () => `Candidates_Report_Full_${today()}.pdf`;
export async function downloadCandidatesFullPdf(candidates) {
    (await buildCandidatesFullPdf(candidates)).save(candidatesFullFileName());
}

// ------------------------------------------------------------------------------ CandidateTable (export rows of one scope)
export async function buildCandidateTablePdf(data, type, opts = {}) {
    const r = await begin('PrepWin - Candidate Assessment Dataset', opts);
    r.line(`Generated on: ${new Date().toLocaleString()} | Scope: ${type.toUpperCase()}`, { color: C.muted });
    r.line(`Total Candidates: ${data.length}`, { color: C.muted, gapAfter: 10 });
    r.table({
        head: ['S.No', 'Name', 'Email', 'Role', 'Stage', 'Status', 'AI Rec', 'Score'],
        body: data.map((row) => [
            row['S.No'], row.Name, row.Email, row['Job Role'], row['Current Stage'], row.Status, row['AI Recommendation'], row['Accuracy Score'],
        ]),
        columnStyles: { 2: { cellWidth: 40 * MM } },   // 40 mm
    });
    return r.finish(opts);
}
export const candidateTableFileName = (type) => `Candidates_Report_${type}_${today()}.pdf`;
export async function downloadCandidateTablePdf(data, type) {
    (await buildCandidateTablePdf(data, type)).save(candidateTableFileName(type));
}

// ------------------------------------------------------------------------------ Analytics page
export async function buildAnalyticsPdf({ kpi, funnelStages, recommendationData, roleInsights, selectedRoleFilter, selectedDateRange }, opts = {}) {
    const r = await begin('PrepWin - Pipeline & Talent Intelligence Report', opts);
    r.line(`Generated on: ${new Date().toLocaleString()} | Filter: ${selectedRoleFilter} | Date Range: ${selectedDateRange}`, { size: 9, color: C.muted, gapAfter: 10 });

    r.heading('Executive Summary Metrics:');
    r.line(`- Total Applicants Evaluated: ${kpi.total_applicants}`, { indent: 4, gapAfter: 2 });
    r.line(`- Active Pipeline Candidates: ${kpi.active_pipeline}`, { indent: 4, gapAfter: 2 });
    r.line(`- Overall Placement/Hired Rate: ${kpi.placement_rate}%`, { indent: 4, gapAfter: 2 });
    r.line(`- Average Overall Talent Score: ${kpi.avg_talent_score}%`, { indent: 4, gapAfter: 2 });
    r.line(`- Pipeline Health Score: ${kpi.pipeline_health_score}% (${kpi.pipeline_health_status})`, { indent: 4, gapAfter: 12 });

    r.heading('Recruitment Funnel Stage Distribution:');
    r.table({ head: ['Stage Name', 'Candidates', 'Conversion %'], body: funnelStages.map((item) => [item.stage, item.count, `${item.conversion_pct}%`]) });

    r.heading('AI Talent Recommendation Breakdown:');
    r.table({ head: ['Recommendation Tier', 'Count', 'Percentage'], body: recommendationData.map((item) => [item.name, item.value, `${item.percentage}%`]) });

    r.heading('Performance Insights by Job Role:');
    r.table({
        head: ['Job Role', 'Candidates', 'Avg Score', 'Placement Rate'],
        body: roleInsights.map((item) => [item.role, item.candidate_count, `${item.avg_score}%`, `${item.placement_rate}%`]),
    });
    return r.finish(opts);
}
export const analyticsFileName = () => `PrepWin_Analytics_Report_${today()}.pdf`;
export async function downloadAnalyticsPdf(data) {
    (await buildAnalyticsPdf(data)).save(analyticsFileName());
}
