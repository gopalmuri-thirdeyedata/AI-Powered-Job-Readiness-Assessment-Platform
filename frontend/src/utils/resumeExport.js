import {
    THEMES, PAGE_WIDTH_PT, PAGE_HEIGHT_PT, buildBlocks, headingText, exportFileName,
} from './resumeTemplates.js';
import {
    layoutResume, BULLET_GLYPH, BULLET_MARKER_OFFSET, BULLET_TEXT_INDENT, MUTED_COLOR, ENTRY_GAP_BEFORE, ENTRY_GAP_AFTER_SUB,
    PARA_GAP_AFTER, HEADING_GAP_AFTER, HEADING_GAP_AFTER_RULE, HEADING_RULE_OFFSET,
} from './resumeLayout.js';
import { getMeasure } from './resumeMeasure.js';

const hexToRgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const saveBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * PDF drawn from the shared layout: the exact coordinates the preview shows. Real text calls (not a
 * screenshot), so the text stays selectable and readable by ATS parsers.
 */
export const downloadResumePdf = async (data, templateId) => {
    const { jsPDF } = await import('jspdf');
    const measure = await getMeasure();
    const { pages } = layoutResume(data, templateId, measure);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    pages.forEach((pg, pi) => {
        if (pi > 0) doc.addPage();
        pg.items.forEach((it) => {
            if (it.k === 'rule') {
                doc.setDrawColor(...hexToRgb(it.color));
                doc.setLineWidth(it.width);
                doc.line(it.x1, it.y1, it.x2, it.y2);
            } else {
                doc.setFont(it.font, it.style);
                doc.setFontSize(it.size);
                doc.setTextColor(...hexToRgb(it.color));
                doc.text(it.text, it.x, it.y, { align: it.align });
            }
        });
    });

    doc.save(exportFileName(data, templateId, 'pdf'));
};

/**
 * DOCX with real heading and list paragraphs. It uses the same fonts, sizes, margins, spacing and bullet
 * indents as the preview/PDF, with exact line heights, so Word wraps and spaces the page the same way.
 */
export const downloadResumeDocx = async (data, templateId) => {
    const {
        Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType, HeadingLevel,
        LevelFormat, LineRuleType,
    } = await import('docx');
    const theme = THEMES[templateId];
    const blocks = buildBlocks(data);
    const accent = theme.accent.replace('#', '');
    const muted = MUTED_COLOR.replace('#', '');
    const marginTwips = Math.round(theme.margin * 20);
    const textWidthTwips = Math.round((PAGE_WIDTH_PT - theme.margin * 2) * 20);
    const half = (pt) => Math.round(pt * 2); // docx sizes are half-points
    const twips = (pt) => Math.round(pt * 20);
    // Exact line pitch = the preview's line height, so lines sit where the preview puts them
    const para = (size, before = 0, after = 0) => ({
        before: twips(before),
        after: twips(after),
        line: twips(size * theme.lineGap),
        lineRule: LineRuleType.EXACT,
    });
    const run = (text, opts = {}) => new TextRun({ text, font: theme.docxFont, ...opts });
    const centered = theme.nameAlign === 'center';

    const children = blocks.map((b) => {
        switch (b.t) {
            case 'name':
                return new Paragraph({
                    alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: para(theme.nameSize, 0, PARA_GAP_AFTER),
                    children: [run(b.text, { bold: true, size: half(theme.nameSize), color: templateId === 'modern' ? accent : '111111' })],
                });
            case 'contact':
                return new Paragraph({
                    alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: para(theme.contactSize, 0, PARA_GAP_AFTER),
                    children: [run(b.text, { size: half(theme.contactSize), color: muted })],
                });
            case 'heading':
                return new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    keepNext: true,
                    spacing: para(theme.headingSize, theme.sectionGap, theme.headingRule ? HEADING_GAP_AFTER_RULE : HEADING_GAP_AFTER),
                    border: theme.headingRule ? { bottom: { style: BorderStyle.SINGLE, size: 5, color: accent, space: HEADING_RULE_OFFSET } } : undefined,
                    children: [run(headingText(theme, b.text), { bold: true, size: half(theme.headingSize), color: accent })],
                });
            case 'para':
                return new Paragraph({
                    spacing: para(theme.bodySize, 0, PARA_GAP_AFTER),
                    children: [run(b.text, { size: half(theme.bodySize) })],
                });
            case 'entry': {
                const paras = [new Paragraph({
                    spacing: para(theme.entrySize, ENTRY_GAP_BEFORE, 0),
                    keepNext: true,
                    tabStops: [{ type: TabStopType.RIGHT, position: textWidthTwips }],
                    children: [
                        run(b.left, { bold: true, size: half(theme.entrySize) }),
                        ...(b.right ? [run(`\t${b.right}`, { size: half(theme.entrySize) })] : []),
                    ],
                })];
                if (b.sub) {
                    paras.push(new Paragraph({
                        spacing: para(theme.bodySize, 0, ENTRY_GAP_AFTER_SUB),
                        keepNext: true,
                        children: [run(b.sub, { italics: true, size: half(theme.bodySize), color: muted })],
                    }));
                }
                return paras;
            }
            case 'bullet':
                return new Paragraph({
                    numbering: { reference: 'resume-bullets', level: 0 },
                    spacing: para(theme.bodySize, 0, theme.bulletGap),
                    children: [run(b.text, { size: half(theme.bodySize) })],
                });
            default:
                return new Paragraph({ children: [] });
        }
    }).flat();

    const doc = new Document({
        creator: 'PrepWin',
        title: `${data?.name || 'Resume'} - Resume`,
        numbering: {
            config: [{
                reference: 'resume-bullets',
                levels: [{
                    level: 0,
                    format: LevelFormat.BULLET,
                    text: BULLET_GLYPH,
                    alignment: AlignmentType.LEFT,
                    style: {
                        // bullet glyph at the margin offset, wrapped text at the bullet text indent (as in the preview)
                        paragraph: { indent: { left: twips(BULLET_TEXT_INDENT), hanging: twips(BULLET_TEXT_INDENT - BULLET_MARKER_OFFSET) } },
                        run: { font: theme.docxFont, size: half(theme.bodySize) },
                    },
                }],
            }],
        },
        sections: [{
            properties: {
                page: {
                    size: { width: twips(PAGE_WIDTH_PT), height: twips(PAGE_HEIGHT_PT) },
                    margin: { top: marginTwips, bottom: marginTwips, left: marginTwips, right: marginTwips },
                },
            },
            children,
        }],
    });
    saveBlob(await Packer.toBlob(doc), exportFileName(data, templateId, 'docx'));
};
