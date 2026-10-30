// Admin Candidate Dossier -> PDF file (the Export button).
// Content and layout live in the shared Candidate Dossier pipeline (./candidateDossier/): the model (model.js) is the same one the
// browser Print view and the student's report are rendered from; this file only wires the admin dossier into it.
import { buildAdminDossierModel, candidateDossierFileName } from './candidateDossier/model.js';
import { loadDossierLogo, renderDossierPdf, safeText } from './candidateDossier/pdfRenderer.js';

export { candidateDossierFileName, safeText };

/**
 * Builds the Candidate Dossier PDF document.
 * @param {object} data - The candidate dossier returned by the backend admin API.
 * @returns {Promise<jsPDF>} The populated jsPDF document.
 */
export async function buildCandidateDossierPdf(data, options = {}) {
    const model = buildAdminDossierModel(data);                        // throws "Candidate dossier data is required." for bad input
    const logo = options.logo !== undefined ? options.logo : await loadDossierLogo();
    return renderDossierPdf(model, { logo, now: options.now });
}

/** Generates the PDF and triggers the browser download; resolves with the file name. */
export async function downloadCandidateDossierPdf(data) {
    const doc = await buildCandidateDossierPdf(data);
    const fileName = candidateDossierFileName(data);
    doc.save(fileName);
    return fileName;
}
