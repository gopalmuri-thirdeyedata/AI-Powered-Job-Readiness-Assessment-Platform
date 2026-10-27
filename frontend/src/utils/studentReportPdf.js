// The student's assessment report as a PDF, built in the browser (jsPDF, like the other PrepWin exports) from the report the server
// releases AFTER the exam review is saved. Nothing is calculated here: every score and sentence comes from the server's report.

const BRAND = [93, 140, 44];
const GREY = [100, 100, 100];

const pct = (v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '-');
const minutes = (s) => (s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '-');
const LABELS = { aptitude: 'Aptitude', coding: 'Coding', interview: 'AI Technical Interview' };

const slug = (s) => String(s || 'assessment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'assessment';

export const reportFileName = (report, now = new Date()) =>
    `PrepWin-Assessment-Report-${slug(report?.assessment?.title)}-${now.toISOString().slice(0, 10)}.pdf`;

/** Builds the PDF document (jsPDF instance). Throws if the report is not a usable report object. */
export async function buildReportPdf(report) {
    if (!report || !Array.isArray(report.sections)) throw new Error('The report data is incomplete.');
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF();
    const left = 14;
    let y = 20;
    const ensure = (needed = 12) => { if (y + needed > 280) { doc.addPage(); y = 20; } };
    const heading = (text, size = 13) => { ensure(14); doc.setFontSize(size); doc.setTextColor(...BRAND); doc.text(text, left, y); y += 7; };
    const para = (text, color = [40, 40, 40]) => {
        doc.setFontSize(10); doc.setTextColor(...color);
        for (const line of doc.splitTextToSize(String(text), 182)) { ensure(6); doc.text(line, left, y); y += 5; }
        y += 1;
    };
    const table = (head, body, opts = {}) => {
        if (!body.length) return;
        autoTable(doc, { startY: y, head: [head], body, theme: 'striped', headStyles: { fillColor: BRAND }, styles: { fontSize: 8, cellPadding: 2 }, ...opts });
        y = doc.lastAutoTable.finalY + 6;
    };

    doc.setFontSize(18); doc.setTextColor(...BRAND); doc.text('PrepWin - Assessment Report', left, y); y += 8;
    doc.setFontSize(10); doc.setTextColor(...GREY);
    doc.text(`${report.assessment?.title || 'Assessment'}${report.assessment?.organization ? ` | ${report.assessment.organization}` : ''}`, left, y); y += 5;
    doc.text(`${report.student?.name || ''} (${report.student?.email || ''})`, left, y); y += 5;
    if (report.completed_at) { doc.text(`Completed: ${new Date(report.completed_at).toLocaleString()}`, left, y); y += 5; }
    y += 3;

    heading('Overall result', 14);
    para(`Overall score: ${pct(report.overall_score)}   |   Status: ${report.overall_status || '-'}`);
    table(['Section', 'Status', 'Score', 'Time spent'],
        report.sections.map((s) => [s.label || LABELS[s.key] || s.key, s.status || '-', pct(s.score), minutes(s.time_spent_seconds)]));

    for (const s of report.sections) {
        heading(s.label || LABELS[s.key] || s.key);
        if (s.key === 'aptitude') {
            if (s.summary && s.summary.total != null) para(`Correct answers: ${s.summary.correct} of ${s.summary.total}`);
            table(['#', 'Question', 'Your answer', 'Result'],
                (s.questions || []).map((q, i) => [i + 1, q.question || '', q.selected || '-', q.is_correct ? 'Correct' : 'Incorrect']),
                { columnStyles: { 1: { cellWidth: 100 } } });
        } else if (s.key === 'coding') {
            table(['Problem', 'Language', 'Tests passed', 'Score'],
                (s.problems || []).map((p) => [p.title || '', p.language || '-', `${p.passed_tests ?? '-'} / ${p.total_tests ?? '-'}`, pct(p.score)]));
        } else if (s.key === 'interview') {
            if (s.summary) para(s.summary);
            if (s.technical_depth_score != null || s.communication_score != null) {
                para(`Technical depth: ${pct(s.technical_depth_score)}   |   Communication: ${pct(s.communication_score)}`);
            }
            if ((s.key_strengths || []).length) { para('Strengths', BRAND); (s.key_strengths).forEach((t) => para(`- ${t}`)); }
            if ((s.key_areas_for_improvement || []).length) { para('Areas for improvement', BRAND); (s.key_areas_for_improvement).forEach((t) => para(`- ${t}`)); }
            table(['Topic', 'Question', 'Score', 'Feedback'],
                (s.questions || []).map((q) => [q.topic || '', q.question || '', pct(q.score), q.feedback || '']),
                { columnStyles: { 1: { cellWidth: 55 }, 3: { cellWidth: 60 } } });
        }
    }
    return doc;
}

/**
 * Builds the PDF and hands it to the browser's download mechanism. Resolves with the file name once the download has been
 * INITIATED; a browser cannot confirm that the user finished saving the file.
 */
export async function downloadStudentReport(report) {
    const doc = await buildReportPdf(report);
    const name = reportFileName(report);
    doc.save(name);
    return name;
}
