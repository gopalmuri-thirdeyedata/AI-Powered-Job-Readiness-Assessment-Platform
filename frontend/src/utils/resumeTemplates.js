// Shared definition of the three ATS-friendly resume templates.
// The preview, the PDF export and the DOCX export all render the same block list with the same theme,
// so what the student previews is what they download.
//
// All templates are single column with standard section headings and no tables, icons or images,
// which is what applicant-tracking parsers read best.

export const PAGE_WIDTH_PT = 595; // A4 width in points
export const PAGE_HEIGHT_PT = 842;

export const TEMPLATES = [
    {
        id: 'classic',
        name: 'Classic',
        description: 'Traditional serif layout with ruled section headings. Safe for every ATS.',
    },
    {
        id: 'modern',
        name: 'Modern',
        description: 'Clean sans-serif layout with accent-coloured section headings.',
    },
    {
        id: 'compact',
        name: 'Compact',
        description: 'Tighter spacing and smaller type, aimed at fitting everything on one page.',
    },
];

// Sizes are in points. fonts: 'times' | 'helvetica' map to jsPDF built-ins; css/docx names are for the other two.
export const THEMES = {
    classic: {
        pdfFont: 'times', cssFont: '"Times New Roman", Times, serif', docxFont: 'Times New Roman',
        nameSize: 22, contactSize: 10, headingSize: 11.5, bodySize: 10.5, entrySize: 11,
        accent: '#111111', headingUpper: true, headingRule: true, nameAlign: 'center',
        margin: 46, sectionGap: 11, lineGap: 1.3, bulletGap: 2,
    },
    modern: {
        pdfFont: 'helvetica', cssFont: 'Arial, Helvetica, sans-serif', docxFont: 'Arial',
        nameSize: 24, contactSize: 10, headingSize: 11.5, bodySize: 10.5, entrySize: 11,
        accent: '#0F766E', headingUpper: true, headingRule: false, nameAlign: 'left',
        margin: 46, sectionGap: 12, lineGap: 1.35, bulletGap: 2.5,
    },
    compact: {
        pdfFont: 'helvetica', cssFont: 'Arial, Helvetica, sans-serif', docxFont: 'Arial',
        nameSize: 19, contactSize: 9, headingSize: 10, bodySize: 9, entrySize: 9.5,
        accent: '#1F2937', headingUpper: true, headingRule: true, nameAlign: 'left',
        margin: 34, sectionGap: 7, lineGap: 1.22, bulletGap: 1,
    },
};

// jsPDF's built-in fonts only contain the Windows-1252 (WinAnsi) characters. A line holding anything else, such
// as the "↗" link arrow that PDFs leave behind, is written with huge letter spacing and runs off the page. All
// resume text therefore goes through pdfSafe() first, so the preview, the PDF and the DOCX show identical text.
const WIN_ANSI_EXTRAS = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
const SAFE_REPLACEMENTS = {
    '\u2192': '->', '\u2190': '<-', '\u2011': '-', '\u2010': '-', '\u2212': '-', '\u00A0': ' ', '\u2009': ' ',
    '\u202F': ' ', '\u2002': ' ', '\u2003': ' ', '\u25AA': '\u2022', '\u25CF': '\u2022', '\u25E6': '\u2022',
    '\u2043': '-', '\u00AD': '', '\u200B': '', '\uFEFF': '',
};

export const pdfSafe = (text) => {
    let out = '';
    for (const ch of String(text ?? '')) {
        const code = ch.codePointAt(0);
        if (Object.prototype.hasOwnProperty.call(SAFE_REPLACEMENTS, ch)) out += SAFE_REPLACEMENTS[ch];
        else if (ch === '\n' || ch === '\t' || ch === '\r') out += ' ';
        else if ((code >= 32 && code <= 126) || (code >= 161 && code <= 255) || WIN_ANSI_EXTRAS.has(ch)) out += ch;
        // anything else (arrows, symbols, emoji, non-Latin scripts) cannot be drawn by the PDF fonts and is dropped
    }
    return out.replace(/ {2,}/g, ' ');
};

const clean = (v) => (typeof v === 'string' ? pdfSafe(v).trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);
const joinParts = (parts, sep) => parts.map(clean).filter(Boolean).join(sep);

/**
 * Turns the structured resume returned by the API into a flat list of render blocks.
 * Sections with no content are omitted. Nothing is added that is not in the data.
 *
 * Block types: name, contact, heading, para, entry {left, right, sub}, bullet
 */
export const buildBlocks = (data) => {
    const d = data || {};
    const blocks = [];

    const name = clean(d.name);
    if (name) blocks.push({ t: 'name', text: name });

    const contact = d.contact || {};
    const contactLine = joinParts([contact.email, contact.phone, contact.location, ...list(contact.links)], '  |  ');
    if (contactLine) blocks.push({ t: 'contact', text: contactLine });

    const summary = clean(d.summary);
    if (summary) {
        blocks.push({ t: 'heading', text: 'Summary' });
        blocks.push({ t: 'para', text: summary });
    }

    const skills = list(d.skills);
    if (skills.length) {
        blocks.push({ t: 'heading', text: 'Skills' });
        blocks.push({ t: 'para', text: skills.join(', ') });
    }

    const experience = (d.experience || []).filter((e) => e && (clean(e.title) || clean(e.company)));
    if (experience.length) {
        blocks.push({ t: 'heading', text: 'Experience' });
        experience.forEach((e) => {
            blocks.push({ t: 'entry', left: clean(e.title) || clean(e.company), right: clean(e.dates), sub: clean(e.title) ? clean(e.company) : '' });
            list(e.bullets).forEach((b) => blocks.push({ t: 'bullet', text: b }));
        });
    }

    const projects = (d.projects || []).filter((p) => p && clean(p.name));
    if (projects.length) {
        blocks.push({ t: 'heading', text: 'Projects' });
        projects.forEach((p) => {
            const tech = list(p.tech);
            blocks.push({ t: 'entry', left: clean(p.name), right: clean(p.dates), sub: tech.length ? `Technologies: ${tech.join(', ')}` : '' });
            if (clean(p.description)) blocks.push({ t: 'para', text: clean(p.description) });
            list(p.bullets).forEach((b) => blocks.push({ t: 'bullet', text: b }));
        });
    }

    const education = (d.education || []).filter((e) => e && (clean(e.degree) || clean(e.institution)));
    if (education.length) {
        blocks.push({ t: 'heading', text: 'Education' });
        education.forEach((e) => {
            blocks.push({ t: 'entry', left: clean(e.degree) || clean(e.institution), right: clean(e.dates), sub: clean(e.degree) ? clean(e.institution) : '' });
            if (clean(e.details)) blocks.push({ t: 'para', text: clean(e.details) });
        });
    }

    const certs = list(d.certifications);
    if (certs.length) {
        blocks.push({ t: 'heading', text: 'Certifications' });
        certs.forEach((c) => blocks.push({ t: 'bullet', text: c }));
    }

    const achievements = list(d.achievements);
    if (achievements.length) {
        blocks.push({ t: 'heading', text: 'Achievements' });
        achievements.forEach((a) => blocks.push({ t: 'bullet', text: a }));
    }

    return blocks;
};

export const headingText = (theme, text) => (theme.headingUpper ? text.toUpperCase() : text);

export const exportFileName = (data, templateId, ext) => {
    const base = clean(data?.name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Resume';
    const tpl = TEMPLATES.find((t) => t.id === templateId)?.name || 'Resume';
    return `${base}_Resume_${tpl}.${ext}`;
};
