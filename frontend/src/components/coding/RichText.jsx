import React from 'react';
import { parseBlocks, parseInline } from '../../utils/codingPlatform';

// Renders a problem statement. Text is only ever placed in React text nodes (never as HTML), so a statement cannot inject markup.
const Inline = ({ text }) => parseInline(text).map((t, i) => {
    if (t.type === 'code') return <code key={i} className="text-[0.85em] bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded px-1 py-0.5 font-mono">{t.value}</code>;
    if (t.type === 'bold') return <strong key={i} className="font-semibold text-slate-900 dark:text-white">{t.value}</strong>;
    return <React.Fragment key={i}>{t.value}</React.Fragment>;
});

const RichText = ({ text, className = '' }) => (
    <div className={`space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${className}`}>
        {parseBlocks(text).map((b, i) => (b.type === 'list' ? (
            <ul key={i} className="list-disc pl-5 space-y-1">{b.items.map((item, j) => <li key={j}><Inline text={item} /></li>)}</ul>
        ) : (
            <p key={i}><Inline text={b.text} /></p>
        )))}
    </div>
);

export default RichText;
