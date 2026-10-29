import React, { useMemo, useState } from 'react';

/**
 * The job description on the assessment opening page. The server sends it as text that an administrator typed or uploaded, usually
 * Markdown (`## Heading`, `**bold**`, `- bullet`) and sometimes plain text.
 *
 * This is a deliberately small renderer that builds React ELEMENTS only: nothing is ever turned into HTML, so a `<script>` or `<img onerror>`
 * inside a description is shown as harmless visible text, and the only thing that can become a link is an explicit http(s) URL.
 * Supported: # headings, **bold** / __bold__, *italic*, `code`, [text](https://...), - / * / + / numbered lists and paragraphs; a plain-text
 * description (no Markdown at all) renders as one paragraph per line. A long description starts as a compact preview with Show more / Show less.
 */

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>\s?/;
const INLINE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Text -> blocks: { type: 'heading', level, text } | { type: 'p', text } | { type: 'ul' | 'ol', items: string[] }. */
export const parseDescription = (raw) => {
    const blocks = [];
    let list = null;
    const flush = () => { list = null; };
    for (const line of String(raw ?? '').replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || RULE.test(trimmed) || FENCE.test(trimmed)) { flush(); continue; }
        const heading = HEADING.exec(trimmed);
        if (heading) {
            flush();
            if (heading[1]) blocks.push({ type: 'heading', level: /^#+/.exec(trimmed)[0].length, text: heading[1] });
            continue;
        }
        const bullet = BULLET.exec(line);
        const numbered = bullet ? null : NUMBERED.exec(line);
        const item = bullet || numbered;
        if (item) {
            const type = bullet ? 'ul' : 'ol';
            if (!list || list.type !== type) { list = { type, items: [] }; blocks.push(list); }
            list.items.push(item[1].trim());
            continue;
        }
        flush();
        blocks.push({ type: 'p', text: trimmed.replace(QUOTE, '') });
    }
    return blocks;
};

/** Inline Markdown -> React nodes (strings are escaped by React; nothing is ever injected as HTML). */
export const renderInline = (text, keyPrefix = 'i') => {
    const out = [];
    let last = 0;
    let n = 0;
    for (const m of String(text).matchAll(INLINE)) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const key = `${keyPrefix}-${n++}`;
        if (m[1] !== undefined || m[2] !== undefined) out.push(<strong key={key} className="font-semibold text-slate-900 dark:text-slate-100">{renderInline(m[1] ?? m[2], key)}</strong>);
        else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
        else if (m[4] !== undefined) out.push(<code key={key} className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[0.85em]">{m[4]}</code>);
        else out.push(<a key={key} href={m[6]} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-[#4c7324] dark:text-[#9fd05a] underline underline-offset-2">{m[5]}</a>);
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
};

const blockLength = (b) => (b.items ? b.items.reduce((n, s) => n + s.length, 0) : b.text.length);

/** The blocks shown in the collapsed preview: as many as fit the character budget (always at least the first). A long list is cut between items. */
export const previewBlocks = (blocks, budget = 650) => {
    let used = 0;
    const shown = [];
    for (const b of blocks) {
        const len = blockLength(b);
        if (used + len <= budget) { shown.push(b); used += len; continue; }
        if (b.items) {
            const items = [];
            for (const it of b.items) {
                if (used + it.length > budget && (items.length || shown.length)) break;
                items.push(it);
                used += it.length;
            }
            if (items.length) shown.push({ ...b, items });
        } else if (!shown.length) {
            shown.push(b);
        }
        break;
    }
    return shown;
};

const totalLength = (blocks) => blocks.reduce((n, b) => n + blockLength(b), 0);

const Block = ({ block, index }) => {
    const key = `b${index}`;
    if (block.type === 'heading') {
        const cls = block.level <= 2 ? 'text-base font-bold text-slate-900 dark:text-slate-100 pt-1' : 'text-sm font-bold text-slate-900 dark:text-slate-100 pt-0.5';
        const Tag = block.level <= 2 ? 'h3' : 'h4';
        return <Tag className={cls}>{renderInline(block.text, key)}</Tag>;
    }
    if (block.type === 'ul' || block.type === 'ol') {
        const Tag = block.type;
        return (
            <Tag className={`${block.type === 'ul' ? 'list-disc' : 'list-decimal'} pl-5 space-y-1 marker:text-[#5d8c2c]`}>
                {block.items.map((it, i) => <li key={i} className="pl-0.5">{renderInline(it, `${key}-${i}`)}</li>)}
            </Tag>
        );
    }
    return <p>{renderInline(block.text, key)}</p>;
};

const JobDescription = ({ text, budget = 650, className = '' }) => {
    const blocks = useMemo(() => parseDescription(text), [text]);
    const [expanded, setExpanded] = useState(false);
    if (!blocks.length) return null;
    const shown = expanded ? blocks : previewBlocks(blocks, budget);
    const collapsible = expanded || totalLength(shown) < totalLength(blocks);
    return (
        <div data-testid="job-description" className={`text-sm leading-relaxed text-slate-700 dark:text-slate-300 break-words [overflow-wrap:anywhere] ${className}`}>
            <div className="space-y-2">{shown.map((b, i) => <Block key={i} block={b} index={i} />)}</div>
            {collapsible && (
                <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
                    className="mt-2 rounded-md text-sm font-semibold text-[#4c7324] dark:text-[#9fd05a] hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60">
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
};

export default JobDescription;
