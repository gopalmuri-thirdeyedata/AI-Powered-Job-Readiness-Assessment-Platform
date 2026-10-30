// jsPDF renderer for the Candidate Dossier model (model.js). Used by every report that is DOWNLOADED as a PDF (admin Export, student
// Download). The browser-print renderer (DossierPrintDocument.jsx) draws the same model with the same measurements, so a saved
// print and a downloaded PDF carry the same sections, in the same order, in the same design.
//
// Layout: A4, 15mm sides, 14mm top, a footer band (20mm) whose divider line sits above two footer rows on EVERY page. Page numbers
// are written in a second pass, after the final page count is known. Sections are boxed lists that flow across pages; short items
// (a question, a card, a panel) are kept together and headings never end a page.
import { DOSSIER_TITLE, THEME as C } from './model.js';
import { drawBrandHeader, drawFooters, loadDossierLogo, pageGeometry, safeText, setFont, tableOptions } from './pdfChrome.js';

// Branding, footer, table look, Latin-1 sanitising and the logo loader are shared with the other PrepWin PDFs: see pdfChrome.js.
export { loadDossierLogo, safeText };

// ------------------------------------------------------------------------------ renderer
/**
 * @param {object} model   buildAdminDossierModel(...) or buildStudentReportModel(...)
 * @param {object} [opts]  { logo: { dataUrl, width, height } | null, now: Date }
 */
export async function renderDossierPdf(model, { logo = null, now = new Date() } = {}) {
    if (!model || !Array.isArray(model.sections)) throw new Error('Candidate dossier data is required.');
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const g = pageGeometry(doc);
    const { H, left, cw, top, bottom } = g;                               // content never goes below `bottom`
    const GAP = 12;
    let y = top;

    const font = (size, opts) => setFont(doc, size, opts);
    const T = (s) => safeText(s);
    const newPage = () => { doc.addPage(); y = top; };
    const ensure = (h) => { if (y + h > bottom) newPage(); };

    // ---- flow units (one text line or one drawn element) -------------------------------------------------------------------
    // A unit is { h, draw(x, y, w), keepNext }. Boxes lay units out across pages, then draw the box outline(s) and the units.
    const textUnits = (str, { size = 9, bold = false, italic = false, color = C.ink, face = 'helvetica', width, indent = 0, before = 0, after = 0, maxKeep = 12, bullet = false } = {}) => {
        font(size, { bold, italic, color, face });
        const lh = size * 1.35;
        const lines = doc.splitTextToSize(T(str), width - indent);
        return lines.map((line, i) => ({
            h: lh + (i === 0 ? before : 0) + (i === lines.length - 1 ? after : 0),
            keepNext: lines.length <= maxKeep && i < lines.length - 1,
            draw: (x, yy) => {
                font(size, { bold, italic, color, face });
                const ty = yy + (i === 0 ? before : 0);
                if (bullet && i === 0) { doc.setFillColor(...color); doc.circle(x + 4, ty + size * 0.62, 1.4, 'F'); }
                doc.text(line, x + indent, ty, { baseline: 'top' });
            },
        }));
    };
    const heading = (title, width) => {
        const lines = textUnits(title, { size: 10.5, bold: true, width });
        const last = lines[lines.length - 1];
        const base = last.draw;
        last.h += 10;
        last.draw = (x, yy, w) => {
            base(x, yy);
            doc.setDrawColor(...C.rule); doc.setLineWidth(0.75);
            doc.line(x, yy + 10.5 * 1.35 + 3.5, x + w, yy + 10.5 * 1.35 + 3.5);
        };
        lines.forEach((u) => { u.keepNext = true; });
        return lines;
    };
    const chain = (units) => { units.forEach((u, i) => { u.keepNext = i < units.length - 1; }); return units; };

    /** A bordered panel whose units flow across pages; each page gets its own closed segment. */
    const box = (units) => {
        const padX = 10;
        const padY = 8;
        const innerX = left + padX;
        const innerW = cw - padX * 2;
        const fullH = bottom - top;
        const groups = [];
        let cur = [];
        units.forEach((u) => { cur.push(u); if (!u.keepNext) { groups.push(cur); cur = []; } });
        if (cur.length) groups.push(cur);

        let yy = y;
        let page = 0;
        let segStart = null;
        const segs = [];
        const placed = [];
        const open = () => { segStart = yy; yy += padY; };
        const close = () => { yy += padY; segs.push({ page, y0: segStart, y1: yy }); segStart = null; };
        const nextPage = () => { if (segStart !== null) close(); page += 1; yy = top; };
        for (const g of groups) {
            const gh = g.reduce((n, u) => n + u.h, 0);
            const fits = gh + padY * 2 <= fullH;
            if (segStart === null) {
                if (yy + padY * 2 + gh > bottom && fits) { page += 1; yy = top; }
                open();
            } else if (yy + gh + padY > bottom && fits) {
                nextPage(); open();
            }
            for (const u of g) {
                if (!fits && yy + u.h + padY > bottom) { nextPage(); open(); }
                placed.push({ u, page, y: yy });
                yy += u.h;
            }
        }
        close();

        const base = doc.getNumberOfPages();
        const goTo = (p) => { while (doc.getNumberOfPages() < base + p) doc.addPage(); doc.setPage(base + p); };
        // colour state lives in each page's own content stream: set it again after every page switch
        segs.forEach((s) => {
            goTo(s.page);
            doc.setDrawColor(...C.border); doc.setLineWidth(0.75); doc.setFillColor(...C.panel);
            doc.roundedRect(left, s.y0, cw, s.y1 - s.y0, 4, 4, 'FD');
        });
        placed.forEach((p) => { goTo(p.page); p.u.draw(innerX, p.y, innerW); });
        goTo(page);
        y = yy + GAP;
    };

    const title = (str) => {
        font(11, { bold: true });
        const h = 11 * 1.35 + 6;
        return { h, draw: (x, yy) => { font(11, { bold: true }); doc.text(T(str), x, yy, { baseline: 'top' }); }, keepNext: true };
    };

    // ---- 1. header (page 1 only): title, THIRDEYE logo + subtitle left, PrepWin right, green divider ---------------------------
    y = drawBrandHeader(doc, g, { title: DOSSIER_TITLE, logo, y });

    // ---- sections ------------------------------------------------------------------------------------------------------------
    const tableCommon = (extra) => tableOptions(g, extra);

    const drawCandidate = (s) => {
        const colW = (cw - 14) / 2;
        font(9.5);
        const cells = s.fields.map((f) => {
            font(9.5);
            return { label: f.label, lines: doc.splitTextToSize(T(f.value), colW) };
        });
        const rows = [];
        for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
        const rowH = (r) => 8 * 1.35 + 2 + Math.max(...r.map((c) => c.lines.length)) * 9.5 * 1.35 + 6;
        const nameH = 14 * 1.3 + 8;
        let noticeLines = [];
        if (s.notice) { font(8.5, { italic: true }); noticeLines = doc.splitTextToSize(T(s.notice), cw); }
        const total = nameH + rows.reduce((n, r) => n + rowH(r), 0) + noticeLines.length * 8.5 * 1.35;
        ensure(total);
        font(14, { bold: true });
        doc.text(T(s.name) || '-', left, y, { baseline: 'top', maxWidth: cw - 110 });
        // status pill (right)
        font(8, { bold: true, color: C.brandDark });
        const label = T(s.status.label);
        const pw = doc.getTextWidth(label) + 24;
        doc.setFillColor(...C.brandTint); doc.setDrawColor(...C.brand); doc.setLineWidth(0.5);
        doc.roundedRect(left + cw - pw, y, pw, 16, 8, 8, 'FD');
        doc.setFillColor(...C.brand); doc.circle(left + cw - pw + 9, y + 8, 2.2, 'F');
        font(8, { bold: true, color: C.brandDark });
        doc.text(label, left + cw - pw + 15, y + 4, { baseline: 'top' });
        y += nameH;
        rows.forEach((r) => {
            r.forEach((c, i) => {
                const x = left + i * (colW + 14);
                font(8, { color: C.muted });
                doc.text(T(c.label), x, y, { baseline: 'top' });
                font(9.5);
                doc.text(c.lines, x, y + 8 * 1.35 + 2, { baseline: 'top', lineHeightFactor: 1.35 });
            });
            y += rowH(r);
        });
        if (noticeLines.length) {
            font(8.5, { italic: true, color: C.muted });
            doc.text(noticeLines, left, y, { baseline: 'top', lineHeightFactor: 1.35 });
            y += noticeLines.length * 8.5 * 1.35;
        }
        y += GAP;
    };

    const drawScores = (s) => {
        const cardW = (cw - 8) / 2;
        const cardH = 47;
        let noteLines = [];
        if (s.note) { font(8.5, { color: C.muted }); noteLines = doc.splitTextToSize(T(s.note), cw); }
        ensure(cardH * 2 + 8 + (noteLines.length ? noteLines.length * 8.5 * 1.35 + 6 : 0));
        s.cards.forEach((card, i) => {
            const x = left + (i % 2) * (cardW + 8);
            const yy = y + Math.floor(i / 2) * (cardH + 8);
            doc.setFillColor(...C.white); doc.setDrawColor(...C.border); doc.setLineWidth(0.75);
            doc.roundedRect(x, yy, cardW, cardH, 4, 4, 'FD');
            font(8.5, { color: C.muted });
            doc.text(T(card.label), x + 10, yy + 8, { baseline: 'top' });
            font(16, { bold: true });
            doc.text(T(card.value), x + 10, yy + 8 + 8.5 * 1.2 + 3, { baseline: 'top' });
        });
        y += cardH * 2 + 8;
        if (noteLines.length) {
            font(8.5, { color: C.muted });
            doc.text(noteLines, left, y + 6, { baseline: 'top', lineHeightFactor: 1.35 });
            y += noteLines.length * 8.5 * 1.35 + 6;
        }
        y += GAP;
    };

    const drawTable = (s, { statusColumn = -1 } = {}) => {
        ensure(11 * 1.35 + 6 + 60);
        font(11, { bold: true });
        doc.text(T(s.title), left, y, { baseline: 'top' });
        y += 11 * 1.35 + 6;
        if (s.intro) {
            font(8.5, { color: C.muted });
            const lines = doc.splitTextToSize(T(s.intro), cw);
            doc.text(lines, left, y - 2, { baseline: 'top', lineHeightFactor: 1.35 });
            y += lines.length * 8.5 * 1.35 + 4;
        }
        const rows = s.rows.map((r) => (r.cells || r));
        autoTable(doc, tableCommon({
            startY: y,
            head: [s.columns.map((c) => T(c).toUpperCase())],
            body: rows.map((r) => r.map(T)),
            columnStyles: statusColumn >= 0 ? { [statusColumn]: { cellWidth: 96 } } : {},
            didParseCell: (d) => { if (statusColumn >= 0 && d.section === 'body' && d.column.index === statusColumn) d.cell.text = ['']; },
            didDrawCell: (d) => {
                if (statusColumn < 0 || d.section !== 'body' || d.column.index !== statusColumn) return;
                const label = T(rows[d.row.index][statusColumn]);
                font(8, { bold: true, color: C.brandDark });
                const pw = doc.getTextWidth(label) + 22;
                const px = d.cell.x + 6;
                const py = d.cell.y + d.cell.height / 2 - 8;
                doc.setFillColor(...C.brandTint); doc.setDrawColor(...C.brand); doc.setLineWidth(0.5);
                doc.roundedRect(px, py, pw, 16, 8, 8, 'FD');
                doc.setFillColor(...C.brand); doc.circle(px + 9, py + 8, 2.2, 'F');
                font(8, { bold: true, color: C.brandDark });
                doc.text(label, px + 15, py + 4, { baseline: 'top' });
            },
        }));
        y = doc.lastAutoTable.finalY + GAP;
    };

    const drawNote = (str, opts = {}) => {
        const lines = doc.splitTextToSize(T(str), cw);
        font(opts.size || 9.5, { color: C.muted, italic: !!opts.italic });
        ensure(lines.length * (opts.size || 9.5) * 1.35);
        doc.text(lines, left, y, { baseline: 'top', lineHeightFactor: 1.35 });
        y += lines.length * (opts.size || 9.5) * 1.35 + GAP;
    };

    const innerW = cw - 20;
    const notice = (str) => textUnits(str, { size: 8.5, italic: true, color: C.muted, width: innerW });

    const boxFor = (s) => {
        const u = [...heading(s.title, innerW)];
        if (s.restricted || s.empty) { u.push(...notice(s.restricted || s.empty)); u[u.length - 1].keepNext = false; return u; }
        if (s.kind === 'proctoring') {
            u.push(...textUnits(s.intro, { size: 8.5, color: C.muted, width: innerW, after: 4 }));
            s.groups.forEach((g) => {
                u.push(...textUnits(g.label, { size: 8, bold: true, width: innerW, before: 2 }));
                g.events.forEach((e) => u.push(...textUnits(e, { size: 8, width: innerW, indent: 12, bullet: true, color: C.footerText })));
            });
            chain(u);
        } else if (s.kind === 'aptitude') {
            if (s.note) u.push(...textUnits(s.note, { size: 8.5, italic: true, color: C.muted, width: innerW, after: 4 }));
            u[u.length - 1].keepNext = true;
            s.items.forEach((it) => {
                u.push(...chain([
                    ...textUnits(`${it.n}. ${it.question}`, { size: 9.5, bold: true, width: innerW, before: 4 }),
                    ...textUnits(it.line, { size: 8.5, color: it.ok ? C.good : C.bad, width: innerW, indent: 12, after: 2 }),
                ]));
            });
        } else if (s.kind === 'coding') {
            if (s.note) u.push(...textUnits(s.note, { size: 8.5, italic: true, color: C.muted, width: innerW, after: 4 }));
            u[u.length - 1].keepNext = true;
            s.problems.forEach((p) => {
                const head = [
                    ...textUnits(p.heading, { size: 9.5, bold: true, width: innerW, before: 4 }),
                    ...(p.meta ? textUnits(p.meta, { size: 8.5, color: C.muted, width: innerW }) : []),
                    ...(p.message ? textUnits(p.message, { size: 8.5, color: C.bad, width: innerW }) : []),
                ];
                const code = p.code ? p.code.split('\n').flatMap((ln) => textUnits(ln.replace(/\t/g, '    ') || ' ', { size: 7.5, face: 'courier', width: innerW - 12, maxKeep: 0 })) : [];
                code.forEach((cu) => {
                    const base = cu.draw;
                    cu.draw = (x, yy, w) => { doc.setFillColor(...C.white); doc.setDrawColor(...C.rule); doc.setLineWidth(0.5); doc.rect(x, yy - 0.5, w, cu.h + 1, 'F'); base(x + 6, yy); };
                });
                head.forEach((x) => { x.keepNext = true; });
                code.forEach((cu, i) => { cu.keepNext = i === 0 && code.length > 1; });
                if (!code.length) head[head.length - 1].keepNext = false;
                const item = [...head, ...code];
                item[item.length - 1].h += 4;
                u.push(...item);
            });
        } else if (s.kind === 'interview') {
            if (s.note) u.push(...textUnits(s.note, { size: 8.5, italic: true, color: C.muted, width: innerW, after: 4 }));
            s.intro.forEach((line) => u.push(...textUnits(line, { size: 8.5, color: C.muted, width: innerW, after: 3 })));
            u[u.length - 1].keepNext = true;
            s.items.forEach((it) => {
                const item = [
                    ...textUnits(it.heading, { size: 9.5, bold: true, width: innerW, before: 4 }),
                    ...(it.response ? textUnits(it.response, { size: 9.5, width: innerW }) : []),
                    ...it.notes.flatMap((n) => textUnits(n, { size: 8.5, color: C.muted, width: innerW })),
                ];
                item[item.length - 1].h += 4;
                u.push(...(item.length <= 18 ? chain(item) : item));
            });
        } else if (s.kind === 'transcript') {
            u[u.length - 1].keepNext = true;
            s.turns.forEach((t) => {
                const lines = textUnits(t.text, { size: 8, width: innerW - 66, maxKeep: 8 });
                lines.forEach((lu, i) => {
                    const base = lu.draw;
                    lu.draw = (x, yy) => {
                        if (i === 0) { font(8, { bold: true }); doc.text(T(t.speaker), x, yy, { baseline: 'top' }); }   // label first: reading order
                        base(x + 66, yy);
                    };
                });
                lines[lines.length - 1].h += 3;
                u.push(...lines);
            });
        }
        u[u.length - 1].keepNext = false;
        return u;
    };

    for (const s of model.sections) {
        if (s.kind === 'candidate') drawCandidate(s);
        else if (s.kind === 'message') drawNote(s.text);
        else if (s.kind === 'scores') drawScores(s);
        else if (s.kind === 'timeline') drawTable(s, { statusColumn: 1 });
        else if (s.kind === 'retests') drawTable(s);
        else if (s.kind === 'sitting') drawNote(s.text || s.empty, { italic: !s.text });
        else box(boxFor(s));
    }

    // ---- footer on every page (second pass: the total is known) -----------------------------------------------------------------
    drawFooters(doc, g, { reportUrl: model.reportUrl, now });
    doc.setProperties({ title: `${DOSSIER_TITLE} - ${T(model.sections[0]?.name)}`.trim(), creator: 'PrepWin' });
    return doc;
}
