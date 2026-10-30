// The ONE Candidate Dossier: what a complete candidate report contains, in which order, with which wording.
//
// Every complete report PrepWin produces for a candidate is rendered from the model built here:
//   admin Print (browser)  -> DossierPrintDocument.jsx (HTML)  \
//   admin Export           -> pdfRenderer.js (jsPDF)            }  all read buildDossierModel(...)
//   student Download       -> pdfRenderer.js (jsPDF)           /
// so content, order, wording and number formats cannot drift between entry points. The model holds display-ready strings only; the
// two renderers add nothing and calculate nothing (scores, statuses and times are whatever the server sent).
//
// Two audiences, one structure. The admin dossier carries everything. The student's own report is the server's whitelisted view
// (no answer keys, source code, candidate answers, transcript, proctoring, start/end times: see student_assessment_service). Those
// sections still appear, in the same place, with a one-line notice instead of data. Nothing is invented to fill the gap.

export const DOSSIER_TITLE = 'Candidate Dossier';
export const BRAND = {
    subtitle: 'Recruitment Assessment Intelligence',
    product: 'PrepWin',
    platformTitle: 'PrepWin — AI-Powered Job Readiness & Assessment Platform',
};
export const ADMIN_REPORT_URL = 'https://interviewer.learningpath.ai/admin/candidate-results';
export const STUDENT_REPORT_URL = 'https://interviewer.learningpath.ai';

/** Colours (rgb triplets) shared by both renderers: the HTML stylesheet reads them through rgbCss(). */
export const THEME = {
    brand: [93, 140, 44],        // #5d8c2c  THIRDEYE green
    brandDark: [76, 115, 36],    // #4c7324
    brandTint: [242, 248, 235],
    ink: [15, 23, 42],           // dark navy
    muted: [100, 116, 139],
    footerText: [71, 85, 105],
    panel: [248, 250, 252],
    headFill: [241, 245, 249],
    border: [203, 213, 225],
    rule: [226, 232, 240],
    good: [76, 115, 36],
    bad: [220, 38, 38],
    white: [255, 255, 255],
};
export const rgbCss = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** A4 page geometry in millimetres (both renderers: 15mm sides, 14mm top, footer band at the bottom). */
export const PAGE_MM = { width: 210, height: 297, side: 15, top: 14, footerBand: 20, footerGap: 6 };

// ------------------------------------------------------------------------------ formatting (same output as the admin screen)
export const formatScore = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);

export const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
};

/** "Generated Oct 30, 2026, 3:52 AM": the moment of generation, identical wording in the printed and the downloaded report. */
export const generatedStamp = (when = new Date()) => `Generated ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}%` : null);
const text = (v) => (v === null || v === undefined ? '' : String(v));
const list = (v) => (Array.isArray(v) ? v : []);

/** Status labels, identical to the admin UI's StatusBadge (parity is pinned by a test). */
export const STATUS_LABELS = {
    REGISTERED: 'Registered', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', TIMED_OUT: 'Timed out', ABANDONED: 'Abandoned',
    EVALUATION_PENDING: 'Evaluation pending', INFRASTRUCTURE_FAILURE: 'Platform error', MANUAL_REVIEW_REQUIRED: 'Under review',
    REVOKED_RETRIED: 'Archived (retake)', DRAFT: 'Draft', PUBLISHED: 'Published', EXPIRED: 'Link expired', CLOSED: 'Closed',
};
export const statusLabel = (key) => STATUS_LABELS[key] || text(key);
const timelineStatus = (s) => (s === 'EVALUATED' ? 'COMPLETED' : s === 'UNATTEMPTED' ? 'REGISTERED' : s);

export const SECTION_LABELS = { aptitude: 'Aptitude', coding: 'Coding', interview: 'AI Technical Interview' };
const LANGUAGE_LABELS = { java: 'Java', python: 'Python' };

/** The sections of a complete report, in print order. Each model section has exactly one of these kinds. */
export const SECTION_KINDS = ['candidate', 'scores', 'timeline', 'sitting', 'proctoring', 'aptitude', 'coding', 'interview', 'transcript'];

const NOTICES = {
    contact: 'Contact details are self-reported and unverified',
    notStarted: 'This candidate has registered but has not started the assessment.',
    incomplete: 'Overall is shown only when all three sections were completed. Earned section scores are preserved; unattempted sections have no score.',
    noData: 'No review data is available for this section.',
    restricted: 'This section is not included in the candidate copy of this report.',
    noKey: 'Correct answers are not included in the candidate copy of this report.',
    noCode: 'Submitted code is not included in the candidate copy of this report.',
    noAnswers: 'Candidate answers are not included in the candidate copy of this report.',
    proctoringIntro: 'Events are reported by the candidate\'s browser (fullscreen exit, tab or window switch, camera checks). They are evidence for your review, not an automatic verdict.',
};

/** Where one audience may not see data: a one-line notice in the section's place. */
const restricted = (kind, title) => ({ kind, title, restricted: NOTICES.restricted });

// ------------------------------------------------------------------------------ shared section builders
function scoreCards(scores, overall) {
    return {
        kind: 'scores',
        cards: [
            { label: 'Aptitude', value: formatScore(scores.aptitude) },
            { label: 'Coding', value: formatScore(scores.coding) },
            { label: 'Interview', value: formatScore(scores.interview) },
            { label: 'Overall (equal weight)', value: overall === null || overall === undefined ? 'INCOMPLETE' : formatScore(overall) },
        ],
        note: overall === null || overall === undefined ? NOTICES.incomplete : null,
    };
}

function timelineSection(rows) {
    return {
        kind: 'timeline',
        title: 'Timeline',
        columns: ['Section', 'Status', 'Started', 'Submitted', 'Time spent'],
        rows: rows.map((r) => ({
            cells: [SECTION_LABELS[r.section] || text(r.section), statusLabel(timelineStatus(r.status)), formatDate(r.started_at), formatDate(r.submitted_at), formatDuration(r.time_spent_seconds)],
            statusKey: timelineStatus(r.status),
        })),
    };
}

const joinLine = (label, items) => (items.length ? `${label}: ${items.join('; ')}` : '');
const metricsLine = (d) => [['Technical depth', pct(d.technical_depth_score)], ['Communication', pct(d.communication_score)]]
    .filter(([, v]) => v !== null).map(([label, v]) => `${label}: ${v}`).join(' · ');

/** aptitude / coding / interview from the per-section `details` of the report (admin) or the whitelisted section (student). */
function aptitudeSection(entry, { revealsKey }) {
    const d = entry?.details || {};
    const qs = list(d.questions);
    if (!qs.length) return { kind: 'aptitude', title: 'Aptitude review', empty: NOTICES.noData };
    return {
        kind: 'aptitude',
        title: `Aptitude review — ${d.correct}/${d.total} correct`,
        note: revealsKey ? null : NOTICES.noKey,
        items: qs.map((q, i) => ({
            n: i + 1,
            question: text(q.question),
            line: `Selected: ${text(q.selected) || '—'}${revealsKey ? ` · Correct answer: ${text(q.correct_key) || '—'}` : ''} · Result: ${q.is_correct ? 'Correct' : 'Incorrect'}`,
            ok: !!q.is_correct,
        })),
    };
}

function codingSection(entry, { revealsCode }) {
    const d = entry?.details || {};
    const ps = list(d.problems);
    if (!ps.length) return { kind: 'coding', title: 'Coding review', empty: NOTICES.noData };
    return {
        kind: 'coding',
        title: 'Coding review',
        note: revealsCode ? null : NOTICES.noCode,
        problems: ps.map((p) => {
            const lang = p.language ? (LANGUAGE_LABELS[String(p.language).toLowerCase()] || text(p.language)) : '';
            const cls = p.classification ? String(p.classification).replace(/_/g, ' ').toLowerCase() : '';
            const meta = [lang, p.total_tests !== undefined && p.total_tests !== null ? `Tests passed ${text(p.passed_tests ?? 0)}/${text(p.total_tests)}${p.tests ? ' (examples + hidden)' : ''}` : '', cls].filter(Boolean).join(' · ');
            return {
                heading: `${text(p.title) || 'Coding problem'}${p.score !== undefined && p.score !== null ? ` — ${p.score}%` : ''}`,
                meta,
                message: p.message ? text(p.message) : '',
                code: revealsCode && p.code ? text(p.code) : '',
            };
        }),
    };
}

function interviewSection(entry, { revealsAnswers }) {
    const d = entry?.details || {};
    const qs = list(d.questions);
    if (!qs.length) return { kind: 'interview', title: 'Interview responses', empty: NOTICES.noData };
    return {
        kind: 'interview',
        title: 'Interview responses',
        note: revealsAnswers ? null : NOTICES.noAnswers,
        intro: [
            d.summary ? text(d.summary) : '',
            metricsLine(d),
            joinLine('Key strengths', list(d.key_strengths).map(text).filter(Boolean)),
            joinLine('Areas for improvement', list(d.key_areas_for_improvement).map(text).filter(Boolean)),
        ].filter(Boolean),
        items: qs.map((q) => ({
            heading: `${text(q.question_text ?? q.question)}${q.score !== undefined && q.score !== null ? ` · ${q.score}%` : ''}`,
            response: revealsAnswers ? (text(q.response) || 'No answer') : '',
            notes: [
                q.topic ? `Topic: ${text(q.topic)}` : '',
                text(q.explanation ?? q.feedback),
                joinLine('Strengths', list(q.strengths).map(text).filter(Boolean)),
                joinLine('Gaps', list(q.gaps).map(text).filter(Boolean)),
            ].filter(Boolean),
        })),
    };
}

// ------------------------------------------------------------------------------ admin audience
const slug = (s) => String(s || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');

/** Candidate_Dossier_<Name>.pdf */
export const candidateDossierFileName = (data) => `Candidate_Dossier_${slug(data?.candidate?.name) || `Candidate_${data?.candidate?.id || 'Report'}`}.pdf`;

/** The admin dossier (GET /api/admin/recruitment/candidates/{id}/dossier) -> model. */
export function buildAdminDossierModel(data) {
    if (!data || typeof data !== 'object') throw new Error('Candidate dossier data is required.');
    const candidate = data.candidate || {};
    const job = data.job_role || {};
    const report = data.report;
    const sections = report?.sections || {};
    const fields = [
        { label: 'Email', value: text(candidate.email) || '—' },
        candidate.phone ? { label: 'Phone', value: text(candidate.phone) } : null,
        { label: 'Job role', value: text(job.title) || '—' },
        job.company_name ? { label: 'Company', value: text(job.company_name) } : null,
        { label: 'Registered', value: formatDate(candidate.registered_at) },
    ].filter(Boolean);

    const out = [{ kind: 'candidate', name: text(candidate.name), status: { key: data.status, label: statusLabel(data.status) }, fields, notice: NOTICES.contact }];
    if (!report) {
        out.push({ kind: 'message', text: NOTICES.notStarted });
    } else {
        out.push(scoreCards({ aptitude: sections.aptitude?.score, coding: sections.coding?.score, interview: sections.interview?.score }, report.overall_score));
        out.push(timelineSection(list(data.timeline)));
        const s = data.session;
        out.push({
            kind: 'sitting',
            text: s ? `Sitting started ${formatDate(s.started_at)}${s.finalized_at ? ` · ended ${formatDate(s.finalized_at)}` : ''}${s.rules_acknowledged_at ? ` · rules acknowledged ${formatDate(s.rules_acknowledged_at)}` : ''}${s.incident_reference_id ? ` · incident ${s.incident_reference_id}` : ''}` : '',
            empty: s ? '' : 'Sitting summary: no sitting data is available.',
        });
        const flagged = ['aptitude', 'coding', 'interview'].filter((k) => (sections[k]?.proctoring?.count || 0) > 0);
        const total = flagged.reduce((n, k) => n + sections[k].proctoring.count, 0);
        out.push({
            kind: 'proctoring',
            title: `Proctoring — ${total === 0 ? 'no integrity events recorded' : `${total} integrity event${total === 1 ? '' : 's'} recorded`}`,
            intro: NOTICES.proctoringIntro,
            groups: flagged.map((k) => ({ label: SECTION_LABELS[k], events: list(sections[k].proctoring.events).map((e) => `${text(e.type)}${e.timestamp ? ` · ${formatDate(e.timestamp)}` : ''}`) })),
        });
        out.push(aptitudeSection(sections.aptitude, { revealsKey: true }));
        out.push(codingSection(sections.coding, { revealsCode: true }));
        out.push(interviewSection(sections.interview, { revealsAnswers: true }));
        const turns = list(sections.interview?.details?.transcript);
        out.push(turns.length
            ? { kind: 'transcript', title: `Voice interview transcript (${turns.length} turns)`, turns: turns.map((t) => ({ speaker: t.role === 'ai' ? 'Interviewer' : 'Candidate', ai: t.role === 'ai', text: text(t.text) })) }
            : { kind: 'transcript', title: 'Voice interview transcript', empty: NOTICES.noData });
    }
    const retests = list(data.retests);
    if (retests.length) {
        out.push({
            kind: 'retests',
            title: 'Retest history',
            intro: 'Past retest attempts, for audit. The scores above are the current effective results; a completed retest\'s score is already included there.',
            columns: ['Section', 'Status', 'Previous score', 'Retest score', 'Assigned', 'Completed', 'Email', 'Reason'],
            rows: retests.map((r) => [
                text(r.label),
                `${String(r.status).replace(/_/g, ' ').toLowerCase()}${r.accepted_as_effective_score ? ' · current score' : ''}`,
                formatScore(r.original_score),
                formatScore(r.retest_score),
                `${formatDate(r.assigned_at)}${r.assigned_by ? ` · ${r.assigned_by}` : ''}`,
                formatDate(r.completed_at),
                r.email ? String(r.email.status).toLowerCase() : '—',
                text(r.reason) || '—',
            ]),
        });
    }
    return { audience: 'admin', fileName: candidateDossierFileName(data), reportUrl: ADMIN_REPORT_URL, sections: out };
}

// ------------------------------------------------------------------------------ student audience
const studentSlug = (s) => String(s || 'assessment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'assessment';

/** PrepWin-Assessment-Report-<role>-<date>.pdf */
export const studentReportFileName = (report, now = new Date()) => `PrepWin-Assessment-Report-${studentSlug(report?.assessment?.title)}-${now.toISOString().slice(0, 10)}.pdf`;

/**
 * The student's own report (GET /api/student-assessment/attempts/{id}/report) -> the same model.
 * That endpoint is a whitelist, so answer keys, code, candidate answers, the transcript, proctoring and start/end times are
 * not available here; their sections carry a notice. Start/submitted columns read "—" exactly as the admin dossier does for a missing time.
 */
export function buildStudentReportModel(report, now = new Date()) {
    if (!report || !Array.isArray(report.sections)) throw new Error('The report data is incomplete.');
    const by = Object.fromEntries(report.sections.map((s) => [s.key, s]));
    const asEntry = (s) => (s ? { details: s } : null);
    const assessment = report.assessment || {};
    const student = report.student || {};
    const status = report.overall_status === 'COMPLETED' || !report.overall_status ? 'COMPLETED' : report.overall_status;

    const fields = [
        { label: 'Email', value: text(student.email) || '—' },
        { label: 'Job role', value: text(assessment.title || assessment.role) || '—' },
        assessment.organization ? { label: 'Company', value: text(assessment.organization) } : null,
        report.completed_at ? { label: 'Completed', value: formatDate(report.completed_at) } : null,
    ].filter(Boolean);

    const out = [
        { kind: 'candidate', name: text(student.name), status: { key: status, label: statusLabel(status) }, fields, notice: null },
        scoreCards({ aptitude: by.aptitude?.score, coding: by.coding?.score, interview: by.interview?.score }, report.overall_score),
        timelineSection(['aptitude', 'coding', 'interview'].filter((k) => by[k]).map((k) => ({ section: k, status: by[k].status, started_at: null, submitted_at: null, time_spent_seconds: by[k].time_spent_seconds }))),
        { kind: 'sitting', text: '', empty: 'Sitting summary: not included in the candidate copy of this report.' },
        { ...restricted('proctoring', 'Proctoring') },
        aptitudeSection(asEntry(by.aptitude && { ...by.aptitude, correct: by.aptitude.summary?.correct, total: by.aptitude.summary?.total }), { revealsKey: false }),
        codingSection(asEntry(by.coding), { revealsCode: false }),
        interviewSection(asEntry(by.interview), { revealsAnswers: false }),
        { ...restricted('transcript', 'Voice interview transcript') },
    ];
    return { audience: 'student', fileName: studentReportFileName(report, now), reportUrl: STUDENT_REPORT_URL, sections: out };
}

/** Flattens a model to the text a reader would see, in order (used by the renderer-parity tests and the verification scripts). */
export function modelTextLines(model) {
    const out = [];
    const push = (...xs) => xs.flat(Infinity).filter((x) => x !== null && x !== undefined && String(x).trim() !== '').forEach((x) => out.push(String(x)));
    for (const s of model.sections) {
        if (s.kind === 'candidate') push(s.name, s.status.label, s.fields.flatMap((f) => [f.label, f.value]), s.notice);
        else if (s.kind === 'message') push(s.text);
        else if (s.kind === 'scores') push(s.cards.flatMap((c) => [c.label, c.value]), s.note);
        else if (s.kind === 'timeline') push(s.title, s.columns, s.rows.flatMap((r) => r.cells));
        else if (s.kind === 'sitting') push(s.text, s.empty);
        else if (s.kind === 'proctoring') push(s.title, s.restricted, s.intro, s.groups?.flatMap((g) => [g.label, g.events]));
        else if (s.kind === 'aptitude') push(s.title, s.empty, s.note, s.items?.flatMap((i) => [`${i.n}. ${i.question}`, i.line]));
        else if (s.kind === 'coding') push(s.title, s.empty, s.note, s.problems?.flatMap((p) => [p.heading, p.meta, p.message, p.code]));
        else if (s.kind === 'interview') push(s.title, s.empty, s.note, s.intro, s.items?.flatMap((i) => [i.heading, i.response, i.notes]));
        else if (s.kind === 'transcript') push(s.title, s.empty, s.restricted, s.turns?.flatMap((t) => [t.speaker, t.text]));
        else if (s.kind === 'retests') push(s.title, s.intro, s.columns, s.rows.flat());
    }
    return out;
}
