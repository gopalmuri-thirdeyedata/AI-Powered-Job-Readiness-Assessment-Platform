// Print stylesheet of the Candidate Dossier (browser Print / Save as PDF). Colours and page geometry come from model.js, the same
// tokens the jsPDF renderer uses, so a saved print and a downloaded PDF have the same design.
//
// What it does, and why:
//  * the rest of the app is display:none while printing (hidden-but-laid-out content used to push the report behind a blank page 1);
//  * the on-screen dossier is hidden and DossierPrintDocument (the shared model, drawn as HTML) is printed instead;
//  * the footer is built from @page margin boxes, so Chrome numbers the pages and knows the total. The top page margin stays <= 8mm
//    on purpose: Chrome only prints its own date/title header above that, and that header must not come back.
import { BRAND, PAGE_MM, THEME as C, generatedStamp, rgbCss } from './model.js';

const cssString = (s) => `"${String(s).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
const col = (name) => rgbCss(C[name]);

const TOP_MARGIN_MM = 8;                                   // <= Chrome's header threshold
const PAD_TOP_MM = PAGE_MM.top - TOP_MARGIN_MM;            // repeated on every page by box-decoration-break: clone

/** Footer text for the @page margin boxes: the only part of the print stylesheet that changes between prints. */
export const printFooterCss = (model, when = new Date()) => `@page {
  @bottom-left { content: ${cssString(generatedStamp(when))} "\\A" ${cssString(model?.reportUrl || '')}; }
  @bottom-center { content: ${cssString(BRAND.platformTitle)}; }
}`;

const FOOTER_BOX = `font-family: 'Inter', system-ui, sans-serif; font-size: 7pt; line-height: 10pt; color: ${col('footerText')}; vertical-align: top; padding-top: 4mm; border-top: 0.5pt solid ${col('border')}; white-space: pre; overflow: visible;`;

export const PRINT_CSS = `
.pw-print-document { display: none; }
@page {
  size: A4 portrait;
  margin: ${TOP_MARGIN_MM}mm ${PAGE_MM.side}mm ${PAGE_MM.footerBand}mm;
  @bottom-left { ${FOOTER_BOX} text-align: left; }
  @bottom-center { ${FOOTER_BOX} width: 78mm; text-align: center; }
  @bottom-right { ${FOOTER_BOX} content: counter(page) " / " counter(pages); text-align: right; }
}
@media print {
  html, body {
    background: ${col('white')} !important;
    color: ${col('ink')} !important;
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body > *:not(.pw-dossier-dialog) { display: none !important; }
  .pw-dossier-dialog {
    position: static !important;
    display: block !important;
    inset: auto !important;
    width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    background: transparent !important;
    backdrop-filter: none !important;
    padding: 0 !important;
    margin: 0 !important;
    z-index: auto !important;
  }
  .pw-dossier-dialog > *:not(.pw-print-root) { display: none !important; }
  .pw-print-root {
    position: static !important;
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    max-height: none !important;
    height: auto !important;
    overflow: visible !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    background: ${col('white')} !important;
    padding: ${PAD_TOP_MM}mm 0 ${PAGE_MM.footerGap}mm !important;
    margin: 0 !important;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .pw-print-root > *:not(.pw-print-document) { display: none !important; }
  .pw-print-document {
    display: block;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 9.5pt;
    line-height: 1.35;
    color: ${col('ink')};
  }
  .pw-print-document * { box-sizing: border-box; margin: 0; padding: 0; background: none; color: inherit; box-shadow: none; }
  .pw-print-document p, .pw-print-document h1, .pw-print-document h2, .pw-print-document h3, .pw-print-document dd, .pw-print-document dt { font-weight: normal; }

  /* header: title, THIRDEYE logo + subtitle left / PrepWin right, green divider */
  .dsr-title { font-size: 17pt; line-height: 1.2; font-weight: 700 !important; letter-spacing: -0.01em; margin-bottom: 6pt; }
  .dsr-brandrow { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 7pt; margin-bottom: 12pt; border-bottom: 1.5pt solid ${col('brand')}; break-after: avoid; }
  .dsr-brandrow img { display: block; height: 26pt; width: auto; }
  .dsr-sub { margin-top: 3pt; font-size: 8pt; line-height: 1.2; color: ${col('muted')} !important; }
  .dsr-product { font-size: 17pt; line-height: 1; font-weight: 700 !important; letter-spacing: -0.01em; text-align: right; }

  .dsr-section { margin-bottom: 12pt; }
  .dsr-candidate { break-inside: avoid; }
  .dsr-namerow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12pt; margin-bottom: 8pt; }
  .dsr-name { font-size: 14pt; line-height: 1.3; font-weight: 700 !important; }
  .dsr-pill { display: inline-flex; align-items: center; gap: 5pt; height: 16pt; padding: 0 9pt; border: 0.5pt solid ${col('brand')}; border-radius: 8pt; background: ${col('brandTint')} !important; color: ${col('brandDark')} !important; font-size: 8pt; font-weight: 700 !important; white-space: nowrap; }
  .dsr-dot { display: inline-block; width: 4.4pt; height: 4.4pt; border-radius: 50%; background: ${col('brand')} !important; }
  .dsr-fields { display: grid; grid-template-columns: 1fr 1fr; column-gap: 14pt; }
  .dsr-fields > div { padding-bottom: 6pt; }
  .dsr-fields dt { font-size: 8pt; color: ${col('muted')} !important; }
  .dsr-fields dd { font-size: 9.5pt; margin-top: 2pt; overflow-wrap: anywhere; }
  .dsr-notice { font-size: 8.5pt; font-style: italic; color: ${col('muted')} !important; }
  .dsr-note { font-size: 8.5pt; color: ${col('muted')} !important; margin-top: 6pt; }

  .dsr-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8pt; break-inside: avoid; }
  .dsr-card { height: 47pt; padding: 8pt 10pt; border: 0.75pt solid ${col('border')}; border-radius: 4pt; background: ${col('white')} !important; }
  .dsr-card .l { font-size: 8.5pt; line-height: 1.2; color: ${col('muted')} !important; }
  .dsr-card .v { margin-top: 3pt; font-size: 16pt; line-height: 1.15; font-weight: 700 !important; }

  .dsr-h { font-size: 11pt; line-height: 1.35; font-weight: 700 !important; margin-bottom: 6pt; break-after: avoid; }
  .dsr-intro { font-size: 8.5pt; color: ${col('muted')} !important; margin: -2pt 0 4pt; break-after: avoid; }
  .dsr-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .dsr-table thead { display: table-header-group; }
  .dsr-table tr { break-inside: avoid; }
  .dsr-table th, .dsr-table td { border: 0.75pt solid ${col('rule')}; padding: 4pt 6pt; text-align: left; vertical-align: middle; }
  .dsr-table th { background: ${col('headFill')} !important; font-size: 8pt; font-weight: 700 !important; text-transform: uppercase; }
  .dsr-table td.st { width: 96pt; }
  .dsr-para { font-size: 9.5pt; color: ${col('muted')} !important; }
  .dsr-para.empty { font-style: italic; }

  /* boxed sections: Proctoring, Aptitude, Coding, Interview, Transcript */
  .dsr-box { padding: 8pt 10pt; border: 0.75pt solid ${col('border')}; border-radius: 4pt; background: ${col('panel')} !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .dsr-box.keep { break-inside: avoid; }
  .dsr-boxtitle { font-size: 10.5pt; line-height: 1.35; font-weight: 700 !important; padding-bottom: 3.5pt; border-bottom: 0.75pt solid ${col('rule')}; margin-bottom: 6pt; break-after: avoid; }
  .dsr-boxtitle + * { break-before: avoid; }
  .dsr-box .intro { font-size: 8.5pt; color: ${col('muted')} !important; margin-bottom: 4pt; }
  .dsr-box .notice { font-size: 8.5pt; font-style: italic; color: ${col('muted')} !important; margin-bottom: 4pt; }
  .dsr-item { break-inside: avoid; padding-top: 4pt; padding-bottom: 2pt; }
  .dsr-item .q { font-size: 9.5pt; font-weight: 700 !important; }
  .dsr-item .a { font-size: 9.5pt; }
  .dsr-item .m { font-size: 8.5pt; color: ${col('muted')} !important; }
  .dsr-item .r { font-size: 8.5pt; padding-left: 12pt; }
  .dsr-item .r.ok { color: ${col('good')} !important; }
  .dsr-item .r.bad { color: ${col('bad')} !important; }
  .dsr-item .e { font-size: 8.5pt; color: ${col('bad')} !important; }
  .dsr-group { font-size: 8pt; font-weight: 700 !important; margin-top: 2pt; }
  .dsr-events { list-style: disc; padding-left: 12pt; font-size: 8pt; color: ${col('footerText')} !important; }
  .dsr-code { margin-top: 2pt; padding: 0 6pt; background: ${col('white')} !important; font-family: 'Courier New', monospace; font-size: 7.5pt; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
  .dsr-turn { display: grid; grid-template-columns: 66pt 1fr; break-inside: avoid; font-size: 8pt; padding-bottom: 3pt; }
  .dsr-turn b { font-weight: 700 !important; }
}`;
