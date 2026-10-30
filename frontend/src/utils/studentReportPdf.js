// The student's assessment report as a PDF, from the report the server releases AFTER the exam review is saved.
// It is the same Candidate Dossier as the administrator's (shared model + renderer in ./candidateDossier/). The server's report is a
// whitelist (no answer keys, code, candidate answers, transcript, proctoring or start/end times), so those sections show a
// notice instead of data. Nothing is calculated here: every score and sentence comes from the server's report.
import { buildStudentReportModel, studentReportFileName } from './candidateDossier/model.js';
import { loadDossierLogo, renderDossierPdf } from './candidateDossier/pdfRenderer.js';

export const reportFileName = studentReportFileName;

/** Builds the PDF document (jsPDF instance). Throws if the report is not a usable report object. */
export async function buildReportPdf(report, options = {}) {
    const model = buildStudentReportModel(report);                     // throws "The report data is incomplete."
    const logo = options.logo !== undefined ? options.logo : await loadDossierLogo();
    return renderDossierPdf(model, { logo, now: options.now });
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
