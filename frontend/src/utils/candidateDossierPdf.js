// PrepWin Candidate Assessment Dossier PDF Export
// Generates a professional, multi-page A4 document with real text, styled tables,
// score summaries, proctoring integrity details, and section reviews.

const PAGE = {
    width: 595.28,   // A4 in points (72 points/inch)
    height: 841.89,
    margin: 40,
    topMargin: 40,
    bottomMargin: 45,
};

const COLORS = {
    brandGreen: [93, 140, 44],      // #5d8c2c
    brandDark: [76, 115, 36],       // #4c7324
    brandLightBg: [242, 248, 235],  // #f2f8eb
    inkMain: [15, 23, 42],          // #0f172a
    inkMuted: [100, 116, 139],      // #64748b
    cardBg: [248, 250, 252],        // #f8fafc
    borderColor: [226, 232, 240],   // #e2e8f0
    passGreen: [22, 163, 74],       // #16a34a
    failRed: [220, 38, 38],         // #dc2626
    white: [255, 255, 255],
};

const SECTION_LABELS = {
    aptitude: 'Aptitude',
    coding: 'Coding',
    interview: 'AI Technical Interview',
};

const REPLACEMENTS = [
    [/[‘’‚′]/g, "'"],
    [/[“”„″]/g, '"'],
    [/[–—−]/g, '-'],
    [/…/g, '...'],
    [/[•●▪◦]/g, '-'],
    [/\u00A0/g, ' '],
    [/[✓✔]/g, '[Pass]'],
    [/[✗✘]/g, '[Fail]'],
    [/→/g, '->'],
    [/←/g, '<-'],
];

/** Clean and normalize text for safe rendering with standard jsPDF fonts (WinAnsi/Latin-1). */
export const safeText = (val) => {
    if (val == null) return '';
    let str = typeof val === 'string' ? val : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    for (const [p, r] of REPLACEMENTS) {
        str = str.replace(p, r);
    }
    return str.replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '').trim();
};

const formatScore = (val) => (typeof val === 'number' && Number.isFinite(val) ? `${Math.round(val * 10) / 10}%` : '—');

const formatDate = (iso) => {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return safeText(iso);
        return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return safeText(iso);
    }
};

const formatDuration = (sec) => {
    if (!sec || sec < 0) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
};

/** Generate a clean, sanitized filename for download, e.g. Candidate_Dossier_Suprit.pdf */
export const candidateDossierFileName = (data) => {
    const rawName = data?.candidate?.name || '';
    const cleanName = String(rawName)
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '_');
    const namePart = cleanName || `Candidate_${data?.candidate?.id || 'Report'}`;
    return `Candidate_Dossier_${namePart}.pdf`;
};

/**
 * Builds the Candidate Assessment Dossier PDF document.
 * @param {object} data - The candidate dossier returned by the backend admin API.
 * @returns {Promise<jsPDF>} The populated jsPDF document.
 */
export async function buildCandidateDossierPdf(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Candidate dossier data is required.');
    }

    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const left = PAGE.margin;
    const contentWidth = PAGE.width - PAGE.margin * 2;
    let y = PAGE.topMargin;

    const ensureSpace = (needed) => {
        if (y + needed > PAGE.height - PAGE.bottomMargin) {
            doc.addPage();
            y = PAGE.topMargin;
        }
    };

    const sectionHeading = (title, subtitle = null) => {
        ensureSpace(subtitle ? 34 : 24);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...COLORS.brandDark);
        doc.text(safeText(title), left, y);
        y += 13;
        if (subtitle) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(...COLORS.inkMuted);
            doc.text(safeText(subtitle), left, y);
            y += 11;
        }
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. BRAND HEADER
    // ─────────────────────────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...COLORS.brandGreen);
    doc.text('PrepWin', left, y + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.inkMuted);
    doc.text('Recruitment Assessment Intelligence', left + 88, y + 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...COLORS.inkMain);
    doc.text('Candidate Assessment Dossier', left + contentWidth, y + 2, { align: 'right' });

    y += 18;
    doc.setDrawColor(...COLORS.brandGreen);
    doc.setLineWidth(1.5);
    doc.line(left, y, left + contentWidth, y);
    y += 12;

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. CANDIDATE PROFILE & JOB ROLE OVERVIEW
    // ─────────────────────────────────────────────────────────────────────────────
    const candidate = data.candidate || {};
    const jobRole = data.job_role || {};
    const roleWithCompany = `${jobRole.title || '—'}${jobRole.company_name ? ` · ${jobRole.company_name}` : ''}`;
    const statusText = safeText(data.status || 'REGISTERED');

    const metaRows = [
        [
            { content: 'Candidate Name:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: safeText(candidate.name || '—'), styles: { fontStyle: 'bold', textColor: COLORS.inkMain } },
            { content: 'Assessment Status:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: statusText, styles: { fontStyle: 'bold', textColor: COLORS.brandDark } },
        ],
        [
            { content: 'Email Address:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: safeText(candidate.email || '—') },
            { content: 'Job Role:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: safeText(roleWithCompany) },
        ],
        [
            { content: 'Phone Number:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: safeText(candidate.phone || '—') },
            { content: 'Registered On:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: formatDate(candidate.registered_at) },
        ],
    ];

    if (data.session) {
        const sess = data.session;
        metaRows.push([
            { content: 'Session Window:', styles: { fontStyle: 'bold', textColor: COLORS.inkMuted } },
            { content: `Started: ${formatDate(sess.started_at)}`, colSpan: 3 },
        ]);
    }

    autoTable(doc, {
        startY: y,
        margin: { left, right: PAGE.margin },
        body: metaRows,
        theme: 'plain',
        styles: {
            fontSize: 9,
            cellPadding: 3.5,
            textColor: COLORS.inkMain,
        },
        columnStyles: {
            0: { cellWidth: 95, fontStyle: 'bold' },
            2: { cellWidth: 105, fontStyle: 'bold' },
        },
    });

    y = doc.lastAutoTable.finalY + 12;

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. ASSESSMENT SCORE SUMMARY
    // ─────────────────────────────────────────────────────────────────────────────
    const report = data.report;
    const sections = report?.sections || {};

    sectionHeading('Assessment Score Summary');

    const overallScoreVal = report?.overall_score;
    const overallScoreDisplay = overallScoreVal === null || overallScoreVal === undefined ? 'INCOMPLETE' : formatScore(overallScoreVal);

    autoTable(doc, {
        startY: y,
        margin: { left, right: PAGE.margin },
        head: [['Aptitude', 'Coding', 'AI Technical Interview', 'Overall (Equal Weight)']],
        body: [[
            formatScore(sections.aptitude?.score),
            formatScore(sections.coding?.score),
            formatScore(sections.interview?.score),
            overallScoreDisplay,
        ]],
        theme: 'plain',
        headStyles: {
            fillColor: COLORS.cardBg,
            textColor: COLORS.inkMuted,
            fontSize: 8.5,
            fontStyle: 'bold',
            halign: 'center',
            cellPadding: 5,
            lineWidth: 0.5,
            lineColor: COLORS.borderColor,
        },
        styles: {
            fontSize: 12,
            fontStyle: 'bold',
            halign: 'center',
            textColor: COLORS.inkMain,
            cellPadding: 8,
            lineWidth: 0.5,
            lineColor: COLORS.borderColor,
        },
        columnStyles: {
            3: {
                fillColor: COLORS.brandLightBg,
                textColor: COLORS.brandDark,
            },
        },
    });

    y = doc.lastAutoTable.finalY + 4;

    if (overallScoreVal === null || overallScoreVal === undefined) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(...COLORS.inkMuted);
        doc.text('Overall score is computed with equal weighting once all assessment rounds are completed.', left, y + 6);
        y += 12;
    } else {
        y += 6;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. ASSESSMENT TIMELINE
    // ─────────────────────────────────────────────────────────────────────────────
    const timelineItems = data.timeline || [];
    if (timelineItems.length > 0) {
        sectionHeading('Assessment Timeline');

        const timelineRows = timelineItems.map((t) => [
            safeText(SECTION_LABELS[t.section] || t.section),
            safeText(t.status === 'EVALUATED' ? 'COMPLETED' : t.status),
            formatDate(t.started_at),
            formatDate(t.submitted_at),
            formatDuration(t.time_spent_seconds),
        ]);

        autoTable(doc, {
            startY: y,
            margin: { left, right: PAGE.margin },
            head: [['Section', 'Status', 'Started', 'Submitted', 'Time Spent']],
            body: timelineRows,
            theme: 'striped',
            headStyles: {
                fillColor: COLORS.brandDark,
                textColor: COLORS.white,
                fontSize: 8.5,
                fontStyle: 'bold',
                cellPadding: 4,
            },
            styles: {
                fontSize: 8.5,
                cellPadding: 4,
                textColor: COLORS.inkMain,
            },
            alternateRowStyles: {
                fillColor: COLORS.cardBg,
            },
        });

        y = doc.lastAutoTable.finalY + 12;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. PROCTORING INTEGRITY
    // ─────────────────────────────────────────────────────────────────────────────
    const flagged = ['aptitude', 'coding', 'interview'].filter((k) => (sections[k]?.proctoring?.count || 0) > 0);
    const totalIntegrityEvents = flagged.reduce((n, k) => n + sections[k].proctoring.count, 0);

    sectionHeading(
        `Proctoring Integrity — ${totalIntegrityEvents === 0 ? 'No integrity events recorded' : `${totalIntegrityEvents} integrity event(s) recorded`}`,
        'Automated telemetry monitors fullscreen retention, window/tab switching, and camera visibility.'
    );

    if (totalIntegrityEvents === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...COLORS.passGreen);
        doc.text('✓ All proctoring checks passed cleanly with no integrity infractions.', left, y);
        y += 14;
    } else {
        const proctorRows = [];
        flagged.forEach((k) => {
            const secLabel = SECTION_LABELS[k] || k;
            (sections[k].proctoring.events || []).forEach((e) => {
                proctorRows.push([
                    secLabel,
                    safeText(e.type || 'FLAGGED_EVENT'),
                    formatDate(e.timestamp),
                ]);
            });
        });

        autoTable(doc, {
            startY: y,
            margin: { left, right: PAGE.margin },
            head: [['Section', 'Integrity Event Type', 'Recorded Timestamp']],
            body: proctorRows,
            theme: 'striped',
            headStyles: {
                fillColor: COLORS.brandDark,
                textColor: COLORS.white,
                fontSize: 8,
                fontStyle: 'bold',
                cellPadding: 3.5,
            },
            styles: {
                fontSize: 8,
                cellPadding: 3.5,
                textColor: COLORS.inkMain,
            },
        });

        y = doc.lastAutoTable.finalY + 12;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. APTITUDE ROUND REVIEW
    // ─────────────────────────────────────────────────────────────────────────────
    const aptitudeDetails = sections.aptitude?.details;
    if (aptitudeDetails?.questions && aptitudeDetails.questions.length > 0) {
        const correctCount = aptitudeDetails.correct ?? 0;
        const totalCount = aptitudeDetails.total ?? aptitudeDetails.questions.length;
        sectionHeading(`Aptitude Review — ${correctCount}/${totalCount} Correct (${formatScore(sections.aptitude?.score)})`);

        const aptRows = aptitudeDetails.questions.map((q, i) => [
            String(i + 1),
            safeText(q.question),
            safeText(q.selected || 'No answer'),
            safeText(q.correct_key || '—'),
            q.is_correct ? 'Correct' : 'Incorrect',
        ]);

        autoTable(doc, {
            startY: y,
            margin: { left, right: PAGE.margin },
            head: [['#', 'Question', 'Candidate Selected', 'Correct Key', 'Result']],
            body: aptRows,
            theme: 'striped',
            headStyles: {
                fillColor: COLORS.brandDark,
                textColor: COLORS.white,
                fontSize: 8,
                fontStyle: 'bold',
                cellPadding: 3.5,
            },
            styles: {
                fontSize: 8,
                cellPadding: 3.5,
                textColor: COLORS.inkMain,
            },
            columnStyles: {
                0: { cellWidth: 20, halign: 'center' },
                3: { cellWidth: 60, halign: 'center' },
                4: { cellWidth: 55, halign: 'center' },
            },
            didParseCell: (hookData) => {
                if (hookData.section === 'body' && hookData.column.index === 4) {
                    if (hookData.cell.raw === 'Correct') {
                        hookData.cell.styles.textColor = COLORS.passGreen;
                        hookData.cell.styles.fontStyle = 'bold';
                    } else {
                        hookData.cell.styles.textColor = COLORS.failRed;
                        hookData.cell.styles.fontStyle = 'bold';
                    }
                }
            },
        });

        y = doc.lastAutoTable.finalY + 12;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. CODING ROUND REVIEW
    // ─────────────────────────────────────────────────────────────────────────────
    const codingDetails = sections.coding?.details;
    if (codingDetails?.problems && codingDetails.problems.length > 0) {
        sectionHeading(`Coding Review — Score: ${formatScore(sections.coding?.score)}`);

        codingDetails.problems.forEach((p, idx) => {
            ensureSpace(45);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(...COLORS.inkMain);
            const probTitle = `Problem ${idx + 1}: ${safeText(p.title || 'Coding Problem')}`;
            const probMeta = `${p.language ? ` (${p.language.toUpperCase()})` : ''} · Score: ${p.score != null ? `${p.score}%` : '—'} · Passed: ${p.passed_tests ?? 0}/${p.total_tests ?? 0} tests`;
            doc.text(`${probTitle}${probMeta}`, left, y);
            y += 11;

            if (p.classification) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(...COLORS.inkMuted);
                doc.text(`Classification: ${safeText(p.classification).replace(/_/g, ' ')}`, left, y);
                y += 10;
            }

            if (p.message) {
                ensureSpace(14);
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(8);
                doc.setTextColor(...COLORS.failRed);
                doc.text(`Error/Notice: ${safeText(p.message)}`, left, y);
                y += 10;
            }

            if (p.code) {
                const codeLines = doc.splitTextToSize(safeText(p.code), contentWidth - 16);
                const blockHeight = Math.min(codeLines.length * 9 + 12, 280);

                autoTable(doc, {
                    startY: y,
                    margin: { left, right: PAGE.margin },
                    body: [[codeLines.slice(0, 35).join('\n') + (codeLines.length > 35 ? '\n... [truncated for PDF export]' : '')]],
                    theme: 'plain',
                    styles: {
                        font: 'courier',
                        fontSize: 7.5,
                        textColor: COLORS.inkMain,
                        fillColor: COLORS.cardBg,
                        lineWidth: 0.5,
                        lineColor: COLORS.borderColor,
                        cellPadding: 6,
                    },
                });

                y = doc.lastAutoTable.finalY + 10;
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. AI TECHNICAL INTERVIEW
    // ─────────────────────────────────────────────────────────────────────────────
    const interviewDetails = sections.interview?.details;
    if (interviewDetails?.questions && interviewDetails.questions.length > 0) {
        sectionHeading(`AI Technical Interview — Score: ${formatScore(sections.interview?.score)}`);

        if (interviewDetails.summary) {
            ensureSpace(20);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(...COLORS.inkMain);
            for (const line of doc.splitTextToSize(safeText(interviewDetails.summary), contentWidth)) {
                ensureSpace(10);
                doc.text(line, left, y);
                y += 10;
            }
            y += 4;
        }

        const interviewRows = interviewDetails.questions.map((q, i) => [
            String(i + 1),
            safeText(q.question_text),
            q.score != null ? `${q.score}%` : '—',
            safeText(q.response || 'No response recorded'),
            safeText(q.explanation || '—'),
        ]);

        autoTable(doc, {
            startY: y,
            margin: { left, right: PAGE.margin },
            head: [['#', 'Interview Question', 'Score', 'Candidate Answer', 'Evaluator Feedback']],
            body: interviewRows,
            theme: 'striped',
            headStyles: {
                fillColor: COLORS.brandDark,
                textColor: COLORS.white,
                fontSize: 8,
                fontStyle: 'bold',
                cellPadding: 4,
            },
            styles: {
                fontSize: 8,
                cellPadding: 4,
                textColor: COLORS.inkMain,
            },
            columnStyles: {
                0: { cellWidth: 20, halign: 'center' },
                2: { cellWidth: 40, halign: 'center' },
            },
        });

        y = doc.lastAutoTable.finalY + 12;

        // Transcript turns if available
        const transcriptTurns = interviewDetails.transcript || [];
        if (transcriptTurns.length > 0) {
            sectionHeading(`Voice Interview Transcript (${transcriptTurns.length} turns)`);

            const transcriptRows = transcriptTurns.map((t) => [
                t.role === 'ai' ? 'Interviewer' : 'Candidate',
                safeText(t.text),
            ]);

            autoTable(doc, {
                startY: y,
                margin: { left, right: PAGE.margin },
                head: [['Speaker', 'Dialogue']],
                body: transcriptRows,
                theme: 'striped',
                headStyles: {
                    fillColor: COLORS.cardBg,
                    textColor: COLORS.inkMuted,
                    fontSize: 8,
                    fontStyle: 'bold',
                    cellPadding: 3.5,
                },
                styles: {
                    fontSize: 8,
                    cellPadding: 3.5,
                    textColor: COLORS.inkMain,
                },
                columnStyles: {
                    0: { cellWidth: 80, fontStyle: 'bold' },
                },
            });

            y = doc.lastAutoTable.finalY + 12;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 9. RETEST HISTORY (AUDIT TRAIL)
    // ─────────────────────────────────────────────────────────────────────────────
    const retests = data.retests || [];
    if (retests.length > 0) {
        sectionHeading(
            'Retest History (Audit Trail)',
            'Past retest attempts for compliance. The scores above reflect the current effective results.'
        );

        const retestRows = retests.map((r) => [
            safeText(r.label || '—'),
            safeText(String(r.status || '').replace(/_/g, ' ').toLowerCase()),
            formatScore(r.original_score),
            formatScore(r.retest_score),
            formatDate(r.assigned_at),
            formatDate(r.completed_at),
            safeText(r.reason || '—'),
        ]);

        autoTable(doc, {
            startY: y,
            margin: { left, right: PAGE.margin },
            head: [['Section', 'Status', 'Orig. Score', 'Retest Score', 'Assigned', 'Completed', 'Reason']],
            body: retestRows,
            theme: 'striped',
            headStyles: {
                fillColor: COLORS.brandDark,
                textColor: COLORS.white,
                fontSize: 8,
                fontStyle: 'bold',
                cellPadding: 3.5,
            },
            styles: {
                fontSize: 8,
                cellPadding: 3.5,
                textColor: COLORS.inkMain,
            },
        });

        y = doc.lastAutoTable.finalY + 12;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 10. RUNNING FOOTER & PAGINATION (APPLIED ACROSS ALL PAGES)
    // ─────────────────────────────────────────────────────────────────────────────
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);

        // Footer rule
        doc.setDrawColor(...COLORS.borderColor);
        doc.setLineWidth(0.5);
        doc.line(left, PAGE.height - 28, left + contentWidth, PAGE.height - 28);

        // Footer text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.inkMuted);
        doc.text('PrepWin Recruitment Intelligence — Confidential Candidate Dossier', left, PAGE.height - 18);
        doc.text(`Page ${p} of ${totalPages}`, left + contentWidth, PAGE.height - 18, { align: 'right' });
    }

    return doc;
}

/**
 * Generates the PDF and triggers the browser download.
 * @param {object} data - The candidate dossier data object.
 * @returns {Promise<string>} The filename that was downloaded.
 */
export async function downloadCandidateDossierPdf(data) {
    const doc = await buildCandidateDossierPdf(data);
    const fileName = candidateDossierFileName(data);
    doc.save(fileName);
    return fileName;
}
