// Downloads the student's assessment report as a PDF file (real text, not a screenshot).
//  buildReportSections(reportData)  pure: the report data -> a flat list of blocks (unit tested without a browser)
//  buildReportPdf(reportData)       draws the blocks with jsPDF and returns the document
//  downloadReportPdf(reportData)    builds it and saves "<role>-assessment-report.pdf"

const PAGE = { width: 595.28, height: 841.89, margin: 48 };    // A4, points
const COLORS = { ink: [15, 23, 42], muted: [100, 116, 139], brand: [5, 150, 105], rule: [203, 213, 225] };

const REPLACEMENTS = [
    [/[‘’‚′]/g, "'"], [/[“”„″]/g, '"'], [/[–—−]/g, '-'],
    [/…/g, '...'], [/[•●▪◦]/g, '-'], [/ /g, ' '], [/[✓✔]/g, '+'], [/→/g, '->'],
];

/** The built-in PDF fonts only draw Latin-1: map the common typographic characters, drop the rest (never throw on odd input). */
export const toPdfText = (value) => {
    let text = value == null ? '' : (typeof value === 'string' ? value : (typeof value === 'object' ? JSON.stringify(value) : String(value)));
    REPLACEMENTS.forEach(([pattern, to]) => { text = text.replace(pattern, to); });
    return text.replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '').replace(/[ \t]+/g, ' ').trim();
};

const pct = (value) => (typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100) / 100}%` : 'Not attempted');
const list = (value) => (Array.isArray(value) ? value : []);

const roadmapText = (value) => (Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item : (item?.task || item?.title || item?.description || JSON.stringify(item)))).join('; ')
    : toPdfText(value));

/** Blocks: { t: 'title' | 'h' | 'p' | 'kv' | 'bullet' | 'gap', ... } */
export const buildReportSections = (reportData = {}) => {
    const r = reportData || {};
    const fr = r.final_report || {};
    const out = [];
    const heading = (text) => out.push({ t: 'h', text });
    const bullets = (items) => items.map(toPdfText).filter(Boolean).forEach((text) => out.push({ t: 'bullet', text }));

    out.push({ t: 'title', text: 'PrepWin Job-Readiness Report' });
    const role = [r.target_role, r.target_company && `at ${r.target_company}`].filter(Boolean).join(' ');
    if (role) out.push({ t: 'p', text: `Role: ${role}` });
    if (r.completed_at) {
        const when = new Date(r.completed_at);
        if (!Number.isNaN(when.getTime())) out.push({ t: 'p', text: `Completed: ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` });
    }

    heading('Scores');
    out.push({ t: 'kv', k: 'Overall readiness', v: pct(r.overall_readiness_score) });
    out.push({ t: 'kv', k: 'Aptitude', v: pct(r.aptitude_score) });
    out.push({ t: 'kv', k: 'Coding', v: pct(r.coding_score) });
    out.push({ t: 'kv', k: 'AI technical interview', v: pct(r.interview_score) });
    const match = r.resume_to_jd_match_score ?? fr.resume_to_jd_match_score;
    if (typeof match === 'number') out.push({ t: 'kv', k: 'Resume to job description match', v: pct(match) });
    if (fr.readiness_tier) out.push({ t: 'kv', k: 'Readiness level', v: toPdfText(fr.readiness_tier) });
    if (r.current_state === 'TIMED_OUT') out.push({ t: 'p', text: 'This attempt ended when the time limit was reached; sections not reached are not scored.' });

    const rd = fr.round_details || {};
    if (rd.aptitude && typeof rd.aptitude === 'object') {
        out.push({ t: 'kv', k: 'Aptitude answers correct', v: `${rd.aptitude.correct_count ?? 0} of ${rd.aptitude.total_questions ?? 0}` });
    }
    if (rd.coding && typeof rd.coding === 'object') {
        out.push({ t: 'kv', k: 'Coding hidden tests passed', v: `${rd.coding.passed_hidden_tests ?? 0} of ${rd.coding.total_hidden_tests ?? 0}` });
    }

    if (list(fr.skills_verified).length) { heading('Skills demonstrated'); bullets(fr.skills_verified); }
    if (list(fr.areas_for_improvement).length) { heading('Areas to improve'); bullets(fr.areas_for_improvement); }

    const gap = list(fr.skill_gap_analysis);
    if (gap.length) {
        heading('Skill gap analysis');
        gap.forEach((g) => out.push({ t: 'bullet', text: `${toPdfText(g?.skill)} (${toPdfText(g?.status)}): ${toPdfText(g?.evidence || g?.recommendation)}` }));
    }

    const interview = list(fr.interview_breakdown);
    if (interview.length) {
        heading('AI technical interview');
        interview.forEach((q, i) => {
            const score = typeof q?.score === 'number' ? `${Math.round(q.score)}%` : 'n/a';
            const category = toPdfText(q?.category);
            out.push({ t: 'p', bold: true, text: `Question ${i + 1}${category ? ` [${category}]` : ''} (${score}): ${toPdfText(q?.question_text || q?.question)}` });
            const note = toPdfText(q?.evidence || q?.explanation || q?.feedback);
            if (note) out.push({ t: 'p', text: note });
        });
    }

    if (list(fr.personalized_recommendations).length) { heading('Recommendations'); bullets(fr.personalized_recommendations); }
    const roadmap = fr.suggested_learning_roadmap && typeof fr.suggested_learning_roadmap === 'object' ? Object.entries(fr.suggested_learning_roadmap) : [];
    if (roadmap.length) {
        heading('Improvement plan');
        roadmap.forEach(([week, tasks]) => out.push({ t: 'bullet', text: `${toPdfText(week)}: ${roadmapText(tasks)}` }));
    }
    return out;
};

export const reportFileName = (reportData) => {
    const slug = toPdfText(reportData?.target_role).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `${slug || 'prepwin'}-assessment-report.pdf`;
};

/** Draws the report and returns the jsPDF document (nothing is saved). */
export const buildReportPdf = async (reportData) => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const width = PAGE.width - PAGE.margin * 2;
    let y = PAGE.margin;

    const ensure = (needed) => {
        if (y + needed > PAGE.height - PAGE.margin) { doc.addPage(); y = PAGE.margin; }
    };
    const write = (text, { size = 10, bold = false, color = COLORS.ink, indent = 0, gapAfter = 4 } = {}) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(text, width - indent);
        const lineHeight = size * 1.35;
        lines.forEach((line) => { ensure(lineHeight); doc.text(line, PAGE.margin + indent, y + size); y += lineHeight; });
        y += gapAfter;
    };

    buildReportSections(reportData).forEach((b) => {
        if (b.t === 'title') {
            write(b.text, { size: 20, bold: true, color: COLORS.brand, gapAfter: 6 });
        } else if (b.t === 'h') {
            ensure(34);
            y += 8;
            write(b.text, { size: 13, bold: true, gapAfter: 2 });
            doc.setDrawColor(...COLORS.rule);
            doc.line(PAGE.margin, y, PAGE.margin + width, y);
            y += 8;
        } else if (b.t === 'kv') {
            write(`${b.k}: ${b.v}`, { gapAfter: 2 });
        } else if (b.t === 'bullet') {
            write(`- ${b.text}`, { indent: 10, gapAfter: 3 });
        } else {
            write(b.text, { bold: !!b.bold, color: b.bold ? COLORS.ink : COLORS.muted, gapAfter: 4 });
        }
    });

    return doc;
};

/** Builds the PDF and saves it as a file download. */
export const downloadReportPdf = async (reportData) => {
    const doc = await buildReportPdf(reportData);
    doc.save(reportFileName(reportData));
};
