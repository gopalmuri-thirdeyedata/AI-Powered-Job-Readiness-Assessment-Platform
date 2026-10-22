// Single page-layout engine for the Resume Formatter.
//
// The layout is computed once, as positioned text lines and rules in PDF points. The on-screen preview draws
// these items as SVG, the PDF export draws the very same coordinates, and the DOCX export reuses the same
// fonts, sizes, spacing and indents. That is what keeps "what you preview" and "what you download" identical.
//
// Text is measured with jsPDF's own font metrics (Helvetica/Times), so line breaks are the ones the PDF uses.
//
// Two rules mirror how Word lays out paragraphs, so the DOCX comes out the same:
//   1. The gap between two blocks is the LARGER of the first one's space-after and the next one's space-before
//      (they do not add up).
//   2. A job/education title wraps across the full width, and its date sits right-aligned on the title's last
//      line, or on a line of its own when it does not fit there.

import { THEMES, PAGE_WIDTH_PT, PAGE_HEIGHT_PT, buildBlocks, headingText } from './resumeTemplates.js';

export const BODY_COLOR = '#1e1e1e';
export const MUTED_COLOR = '#464646';
export const BULLET_GLYPH = '•';
export const BULLET_MARKER_OFFSET = 3; // bullet glyph sits this far inside the left margin
export const BULLET_TEXT_INDENT = 12; // wrapped bullet text starts this far inside the left margin
export const ENTRY_GAP_BEFORE = 3;
export const ENTRY_GAP_AFTER_SUB = 1; // space after an entry's subtitle line
export const PARA_GAP_AFTER = 2;
export const HEADING_GAP_AFTER = 3;
export const HEADING_GAP_AFTER_RULE = 3.6;
export const HEADING_RULE_OFFSET = 1.5;
export const HEADING_RULE_WIDTH = 0.625; // 5 eighths of a point, the DOCX border size
const ENTRY_DATE_MIN_GAP = 4; // a date never touches the end of the title text

/** Greedy word wrap using the supplied width function. Over-long words are broken by character. */
export const wrapText = (text, maxWidth, widthOf) => {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (widthOf(candidate) <= maxWidth) {
            line = candidate;
            continue;
        }
        if (line) {
            lines.push(line);
            line = '';
        }
        if (widthOf(word) > maxWidth) {
            let chunk = '';
            for (const ch of word) {
                if (chunk && widthOf(chunk + ch) > maxWidth) {
                    lines.push(chunk);
                    chunk = ch;
                } else {
                    chunk += ch;
                }
            }
            line = chunk;
        } else {
            line = word;
        }
    }
    if (line) lines.push(line);
    return lines;
};

/**
 * @param {object} data        structured resume from the API
 * @param {string} templateId  classic | modern | compact
 * @param {(text:string, font:string, style:string, size:number)=>number} measure  width in points
 * @returns {{pages: Array<{items: object[]}>, theme: object}}
 *   items: {k:'text', text, x, y(baseline), font, style, size, color, align} | {k:'rule', x1, y1, x2, y2, color, width}
 */
export const layoutResume = (data, templateId, measure) => {
    const theme = THEMES[templateId];
    const blocks = buildBlocks(data);
    const left = theme.margin;
    const right = PAGE_WIDTH_PT - theme.margin;
    const width = right - left;
    const bottom = PAGE_HEIGHT_PT - theme.margin;
    const pages = [{ items: [] }];
    let y = theme.margin;
    let pending = 0; // space-after of the previous block, collapsed with the next block's space-before

    const page = () => pages[pages.length - 1];
    const newPage = () => {
        pages.push({ items: [] });
        y = theme.margin;
        pending = 0;
    };
    const lineHeight = (size) => size * theme.lineGap;
    const atTop = () => y <= theme.margin + 0.01;
    const before = (pt) => {
        if (!atTop()) y += Math.max(pending, pt); // spacing at the top of a page collapses away
        pending = 0;
    };
    const after = (pt) => { pending = pt; };
    const ensure = (h) => { if (y + h > bottom && !atTop()) newPage(); };
    const widthFn = (font, style, size) => (t) => measure(t, font, style, size);

    const putLine = (text, { x, font, style = 'normal', size, color = BODY_COLOR, align = 'left', extra = null }) => {
        const h = lineHeight(size);
        ensure(h);
        const baseline = y + (h - size) / 2 + size * 0.8;
        if (text) page().items.push({ k: 'text', text, x, y: baseline, font, style, size, color, align });
        if (extra) page().items.push({ k: 'text', y: baseline, font, style: 'normal', size, color, ...extra });
        y += h;
    };

    const heightOf = (lines, size) => lines.length * lineHeight(size);

    blocks.forEach((b) => {
        if (b.t === 'name') {
            const lines = wrapText(b.text, width, widthFn(theme.pdfFont, 'bold', theme.nameSize));
            const color = templateId === 'modern' ? theme.accent : '#111111';
            const centered = theme.nameAlign === 'center';
            before(0);
            lines.forEach((l) => putLine(l, {
                x: centered ? PAGE_WIDTH_PT / 2 : left, font: theme.pdfFont, style: 'bold', size: theme.nameSize,
                color, align: centered ? 'center' : 'left',
            }));
            after(PARA_GAP_AFTER);
        } else if (b.t === 'contact') {
            const lines = wrapText(b.text, width, widthFn(theme.pdfFont, 'normal', theme.contactSize));
            const centered = theme.nameAlign === 'center';
            before(0);
            lines.forEach((l) => putLine(l, {
                x: centered ? PAGE_WIDTH_PT / 2 : left, font: theme.pdfFont, size: theme.contactSize,
                color: MUTED_COLOR, align: centered ? 'center' : 'left',
            }));
            after(PARA_GAP_AFTER);
        } else if (b.t === 'heading') {
            // keep a heading together with the first lines of its section
            ensure(Math.max(pending, theme.sectionGap) + lineHeight(theme.headingSize) + HEADING_GAP_AFTER + 2 * lineHeight(theme.bodySize));
            before(theme.sectionGap);
            putLine(headingText(theme, b.text), {
                x: left, font: theme.pdfFont, style: 'bold', size: theme.headingSize, color: theme.accent,
            });
            if (theme.headingRule) {
                page().items.push({
                    k: 'rule', x1: left, y1: y + HEADING_RULE_OFFSET, x2: right, y2: y + HEADING_RULE_OFFSET,
                    color: theme.accent, width: HEADING_RULE_WIDTH,
                });
                y += HEADING_RULE_OFFSET + HEADING_RULE_WIDTH;
            }
            after(theme.headingRule ? HEADING_GAP_AFTER_RULE : HEADING_GAP_AFTER);
        } else if (b.t === 'para') {
            before(0);
            wrapText(b.text, width, widthFn(theme.pdfFont, 'normal', theme.bodySize)).forEach((l) => putLine(l, {
                x: left, font: theme.pdfFont, size: theme.bodySize,
            }));
            after(PARA_GAP_AFTER);
        } else if (b.t === 'entry') {
            const titleWidth = widthFn(theme.pdfFont, 'bold', theme.entrySize);
            const leftLines = wrapText(b.left, width, titleWidth);
            const lastWidth = leftLines.length ? titleWidth(leftLines[leftLines.length - 1]) : 0;
            const dateWidth = b.right ? measure(b.right, theme.pdfFont, 'normal', theme.entrySize) : 0;
            // the date shares the title's last line when it fits there, otherwise it gets a right-aligned line
            const dateOnOwnLine = Boolean(b.right) && lastWidth + ENTRY_DATE_MIN_GAP + dateWidth > width;
            const titleRows = leftLines.length + (dateOnOwnLine ? 1 : 0);
            const subLines = b.sub ? wrapText(b.sub, width, widthFn(theme.pdfFont, 'italic', theme.bodySize)) : [];
            // keep the entry title, its subtitle and the first bullet line together
            ensure(
                Math.max(pending, ENTRY_GAP_BEFORE) + titleRows * lineHeight(theme.entrySize)
                + heightOf(subLines, theme.bodySize) + lineHeight(theme.bodySize),
            );
            before(ENTRY_GAP_BEFORE);
            leftLines.forEach((l, i) => putLine(l, {
                x: left, font: theme.pdfFont, style: 'bold', size: theme.entrySize,
                extra: b.right && !dateOnOwnLine && i === leftLines.length - 1 ? { text: b.right, x: right, align: 'right' } : null,
            }));
            if (dateOnOwnLine) {
                putLine('', { x: left, font: theme.pdfFont, size: theme.entrySize, extra: { text: b.right, x: right, align: 'right' } });
            }
            subLines.forEach((l) => putLine(l, {
                x: left, font: theme.pdfFont, style: 'italic', size: theme.bodySize, color: MUTED_COLOR,
            }));
            after(subLines.length ? ENTRY_GAP_AFTER_SUB : 0);
        } else if (b.t === 'bullet') {
            const lines = wrapText(b.text, width - BULLET_TEXT_INDENT, widthFn(theme.pdfFont, 'normal', theme.bodySize));
            before(0);
            lines.forEach((l, i) => putLine(l, {
                x: left + BULLET_TEXT_INDENT, font: theme.pdfFont, size: theme.bodySize,
                extra: i === 0 ? { text: BULLET_GLYPH, x: left + BULLET_MARKER_OFFSET, align: 'left' } : null,
            }));
            after(theme.bulletGap);
        }
    });

    return { pages, theme };
};
