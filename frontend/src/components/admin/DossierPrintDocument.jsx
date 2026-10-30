import React from 'react';
import { BRAND, DOSSIER_TITLE } from '../../utils/candidateDossier/model';

/**
 * The Candidate Dossier as printable HTML: it only draws the shared model (utils/candidateDossier/model.js), the same one the PDF
 * download is drawn from. It is invisible on screen and is what the browser prints (styles: utils/candidateDossier/printCss.js).
 */
const Pill = ({ label }) => <span className="dsr-pill"><i className="dsr-dot" aria-hidden="true" />{label}</span>;

const Box = ({ s, keep, children }) => (
    <section className={`dsr-section dsr-box${keep ? ' keep' : ''}`} data-section={s.kind}>
        <h3 className="dsr-boxtitle">{s.title}</h3>
        {s.restricted || s.empty ? <p className="notice">{s.restricted || s.empty}</p> : children}
    </section>
);

const Section = ({ s }) => {
    switch (s.kind) {
        case 'candidate':
            return (
                <section className="dsr-section dsr-candidate" data-section="candidate">
                    <div className="dsr-namerow"><h2 className="dsr-name">{s.name}</h2><Pill label={s.status.label} /></div>
                    <dl className="dsr-fields">{s.fields.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
                    {s.notice && <p className="dsr-notice">{s.notice}</p>}
                </section>
            );
        case 'message':
            return <p className="dsr-section dsr-para" data-section="message">{s.text}</p>;
        case 'scores':
            return (
                <section className="dsr-section" data-section="scores">
                    <div className="dsr-cards">{s.cards.map((c) => <div key={c.label} className="dsr-card"><p className="l">{c.label}</p><p className="v">{c.value}</p></div>)}</div>
                    {s.note && <p className="dsr-note">{s.note}</p>}
                </section>
            );
        case 'timeline':
            return (
                <section className="dsr-section" data-section="timeline">
                    <h3 className="dsr-h">{s.title}</h3>
                    <table className="dsr-table">
                        <thead><tr>{s.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>{s.rows.map((r, i) => <tr key={i}>{r.cells.map((cell, j) => (j === 1 ? <td key={j} className="st"><Pill label={cell} /></td> : <td key={j}>{cell}</td>))}</tr>)}</tbody>
                    </table>
                </section>
            );
        case 'retests':
            return (
                <section className="dsr-section" data-section="retests">
                    <h3 className="dsr-h">{s.title}</h3>
                    <p className="dsr-intro">{s.intro}</p>
                    <table className="dsr-table">
                        <thead><tr>{s.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
                    </table>
                </section>
            );
        case 'sitting':
            return <p className={`dsr-section dsr-para${s.text ? '' : ' empty'}`} data-section="sitting">{s.text || s.empty}</p>;
        case 'proctoring':
            return (
                <Box s={s} keep>
                    <p className="intro">{s.intro}</p>
                    {(s.groups || []).map((g) => (
                        <div key={g.label}><p className="dsr-group">{g.label}</p><ul className="dsr-events">{g.events.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                    ))}
                </Box>
            );
        case 'aptitude':
            return (
                <Box s={s}>
                    {s.note && <p className="notice">{s.note}</p>}
                    {(s.items || []).map((it) => <div key={it.n} className="dsr-item"><p className="q">{it.n}. {it.question}</p><p className={`r ${it.ok ? 'ok' : 'bad'}`}>{it.line}</p></div>)}
                </Box>
            );
        case 'coding':
            return (
                <Box s={s}>
                    {s.note && <p className="notice">{s.note}</p>}
                    {(s.problems || []).map((p, i) => (
                        <div key={i} className="dsr-item" style={p.code ? { breakInside: 'auto' } : undefined}>
                            <p className="q" style={{ breakAfter: 'avoid' }}>{p.heading}</p>
                            {p.meta && <p className="m" style={{ breakAfter: 'avoid' }}>{p.meta}</p>}
                            {p.message && <p className="e">{p.message}</p>}
                            {p.code && <pre className="dsr-code">{p.code}</pre>}
                        </div>
                    ))}
                </Box>
            );
        case 'interview':
            return (
                <Box s={s}>
                    {s.note && <p className="notice">{s.note}</p>}
                    {(s.intro || []).map((line, i) => <p key={i} className="intro">{line}</p>)}
                    {(s.items || []).map((it, i) => (
                        <div key={i} className="dsr-item">
                            <p className="q">{it.heading}</p>
                            {it.response && <p className="a">{it.response}</p>}
                            {it.notes.map((n, j) => <p key={j} className="m">{n}</p>)}
                        </div>
                    ))}
                </Box>
            );
        case 'transcript':
            return (
                <Box s={s}>
                    {(s.turns || []).map((t, i) => <div key={i} className="dsr-turn"><b>{t.speaker}</b><span>{t.text}</span></div>)}
                </Box>
            );
        default:
            return null;
    }
};

const DossierPrintDocument = ({ model }) => (
    <div className="pw-print-document" data-audience={model.audience}>
        <h1 className="dsr-title">{DOSSIER_TITLE}</h1>
        <div className="dsr-brandrow">
            <div>
                <img src="/logo_main.png" alt="ThirdEye Data" />
                <p className="dsr-sub">{BRAND.subtitle}</p>
            </div>
            <p className="dsr-product">{BRAND.product}</p>
        </div>
        {model.sections.map((s, i) => <Section key={`${s.kind}-${i}`} s={s} />)}
    </div>
);

export default DossierPrintDocument;
