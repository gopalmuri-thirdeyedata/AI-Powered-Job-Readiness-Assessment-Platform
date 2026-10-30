// The shared PrepWin PDF "chrome": everything that makes a PrepWin PDF look like one product, independent of what the report says.
//   drawBrandHeader   report title (top-left), THIRDEYE logo + subtitle (left), PrepWin (right), green divider
//   drawFooters       divider + two footer rows on EVERY page: generated stamp | platform title | "n / total", then the report URL
//   pageGeometry      the A4 content box (15mm sides, 14mm top, footer band at the bottom)
//   tableOptions      the standard autoTable look (light header, thin borders, nothing past the footer)
//   safeText / loadDossierLogo   Latin-1 sanitising and the project's own /logo_main.png
// The Candidate Dossier renderer, the RoleReady report and the bulk exports all draw through these, so branding, margins and footer
// have exactly one implementation. Report CONTENT stays with each report.
import { BRAND, THEME as C, PAGE_MM, generatedStamp } from './model.js';

export const MM = 72 / 25.4;

const REPLACEMENTS = [
    [/[‘’‚′]/g, "'"], [/[“”„″]/g, '"'], [/[–—−]/g, '-'], [/…/g, '...'], [/[•●▪◦]/g, '-'], [/ /g, ' '],
    [/[✓✔]/g, '[Pass]'], [/[✗✘]/g, '[Fail]'], [/→/g, '->'], [/←/g, '<-'],
];

/** The built-in PDF fonts draw Latin-1 only: map the common typographic characters, drop the rest (never throws on odd input). */
export const safeText = (val) => {
    if (val == null) return '';
    let str = typeof val === 'string' ? val : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    for (const [p, r] of REPLACEMENTS) str = str.replace(p, r);
    return str.replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '').trim();
};

// ------------------------------------------------------------------------------ the THIRDEYE logo (the project's own asset)
const pngSize = (bytes) => {
    const sig = [0x89, 0x50, 0x4e, 0x47];
    if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
};

const toBase64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
};

/** Reads the logo file (/logo_main.png: the same one the app header uses) as { dataUrl, width, height }; null when it cannot be read. */
export async function loadDossierLogo(url = '/logo_main.png') {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const size = pngSize(bytes);
        return size ? { dataUrl: `data:image/png;base64,${toBase64(bytes)}`, ...size } : null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------------------ geometry and text
/** The A4 content box in points. `bottom` is the lowest y content may reach; the footer band starts below it. */
export const pageGeometry = (doc) => {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const left = PAGE_MM.side * MM;
    return {
        W, H, left, cw: W - left * 2,
        top: PAGE_MM.top * MM,
        footerLineY: H - PAGE_MM.footerBand * MM,
        bottom: H - (PAGE_MM.footerBand + PAGE_MM.footerGap) * MM,
    };
};

export const setFont = (doc, size, { bold = false, italic = false, color = C.ink, face = 'helvetica' } = {}) => {
    doc.setFont(face, bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
};

/** The standard autoTable look: light header, thin borders, margins that keep tables above the footer and below the top margin. */
export const tableOptions = (g, extra = {}) => ({
    margin: { left: g.left, right: g.left, top: g.top, bottom: g.H - g.bottom },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }, minCellHeight: 24, textColor: C.ink, lineColor: C.rule, lineWidth: 0.75, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: C.headFill, textColor: C.ink, fontStyle: 'bold', fontSize: 8 },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    ...extra,
});

// ------------------------------------------------------------------------------ header and footer
/**
 * Page-1 header. `title` is the report's own title. Returns the y where content may start.
 * Without a readable logo file a plain "ThirdEye Data" text stands in: the logo is never redrawn or approximated.
 */
export function drawBrandHeader(doc, g, { title, logo = null, y = g.top }) {
    setFont(doc, 17, { bold: true });
    doc.text(safeText(title), g.left, y, { baseline: 'top', maxWidth: g.cw });
    const titleLines = doc.splitTextToSize(safeText(title), g.cw).length;
    y += titleLines * 17 * 1.2 + 6;
    const logoH = 26;
    if (logo?.dataUrl) {
        doc.addImage(logo.dataUrl, 'PNG', g.left, y, logoH * (logo.width / logo.height), logoH);
    } else {
        setFont(doc, 14, { bold: true, color: C.brand });
        doc.text('ThirdEye Data', g.left, y + 6, { baseline: 'top' });
    }
    setFont(doc, 8, { color: C.muted });
    doc.text(BRAND.subtitle, g.left, y + logoH + 3, { baseline: 'top' });
    const rowBottom = y + logoH + 3 + 8 * 1.2;
    setFont(doc, 17, { bold: true });
    doc.text(BRAND.product, g.left + g.cw, rowBottom - 17 * 1.05, { baseline: 'top', align: 'right' });
    y = rowBottom + 7;
    doc.setDrawColor(...C.brand); doc.setLineWidth(1.5);
    doc.line(g.left, y, g.left + g.cw, y);
    return y + 12;
}

/**
 * Footer on every page (call once, after the last page exists: the total is then known).
 * `reportUrl` is optional: a report without a real destination gets one footer row and no invented link.
 */
export function drawFooters(doc, g, { reportUrl = null, now = new Date() } = {}) {
    const total = doc.getNumberOfPages();
    const stamp = generatedStamp(now);
    const r1 = g.footerLineY + 4 * MM;
    for (let p = 1; p <= total; p += 1) {
        doc.setPage(p);
        doc.setDrawColor(...C.border); doc.setLineWidth(0.5);
        doc.line(g.left, g.footerLineY, g.left + g.cw, g.footerLineY);
        setFont(doc, 7, { color: C.footerText });
        doc.text(safeText(stamp), g.left, r1, { baseline: 'top' });
        doc.text(safeText(BRAND.platformTitle), g.W / 2, r1, { baseline: 'top', align: 'center' });
        doc.text(`${p} / ${total}`, g.left + g.cw, r1, { baseline: 'top', align: 'right' });
        if (reportUrl) doc.textWithLink(reportUrl, g.left, r1 + 10, { url: reportUrl, baseline: 'top' });
    }
}
