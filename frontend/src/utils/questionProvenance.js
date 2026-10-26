// Pure helper: turns a question's verified source info into badge labels. Every part is optional and hidden when missing.
// Only questions taken from a verified source carry `provenance`; questions written by the AI never do.

const MAX_COMPANY_CHARS = 60;

/** -> [{ key, text }]. Empty array when there is nothing verified to show. */
export const provenanceLabels = (provenance, currentYear = new Date().getFullYear(), styleCompany = '') => {
    const labels = [];
    const style = typeof styleCompany === 'string' ? styleCompany.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPANY_CHARS) : '';
    if (!provenance || typeof provenance !== 'object') return style ? [{ key: 'style', text: `Company style: ${style}` }] : [];

    const company = typeof provenance.company === 'string' ? provenance.company.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPANY_CHARS) : '';
    if (company) labels.push({ key: 'company', text: company });

    const times = Number(provenance.times_asked);
    if (company && Number.isInteger(times) && times >= 1) {
        labels.push({ key: 'times', text: times === 1 ? 'Asked once' : `Asked ${times} times` });
    }

    const year = Number(provenance.year);
    if (Number.isInteger(year) && year >= 1990 && year <= currentYear + 1) labels.push({ key: 'year', text: String(year) });

    // no verified company: still show the company the questions were prepared for, worded as a style, not as a claim
    if (!company && style) labels.unshift({ key: 'style', text: `Company style: ${style}` });
    return labels;
};
