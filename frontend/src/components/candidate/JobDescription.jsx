import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * The job description on the candidate assessment opening page.
 * Displays a concise initial job overview (short role summary + compact key skills tags)
 * with a single collapsible control to view the complete job description.
 *
 * Safe rendering: builds React elements only without HTML injection.
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

/** Extract a concise 2-3 line role summary from the JD content. */
export const extractRoleSummary = (raw, title = '') => {
    if (!raw) return '';
    const text = String(raw).replace(/\r\n?/g, '\n');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    let summary = '';
    let inSummaryHeading = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('```') || /^[-*_]{3,}$/.test(line)) continue;

        if (/^#{1,6}\s*(?:about\s+(?:the\s+)?(?:role|job|us|position)|role\s+overview|job\s+overview|summary|overview)\b/i.test(line)) {
            inSummaryHeading = true;
            continue;
        }

        if (/^#{1,6}\s+/.test(line)) {
            if (inSummaryHeading) break;
            continue;
        }

        if (/^[-*+•\d.]\s+/.test(line)) {
            if (!summary && inSummaryHeading) {
                summary = line.replace(/^[-*+•\d.]\s+/, '');
                break;
            }
            continue;
        }

        if (/^(?:key\s+skills|technical\s+skills|required\s+skills|skills|tech\s+stack)\s*:/i.test(line)) {
            continue;
        }

        const cleanLine = line.replace(/^[*_`#]+|[*_`#]+$/g, '').trim();
        if (title && cleanLine.toLowerCase() === title.trim().toLowerCase()) {
            continue;
        }
        if (!inSummaryHeading && i === 0 && cleanLine.length < 40 && lines[i + 1] && !lines[i + 1].startsWith('#')) {
            continue;
        }

        summary = line;
        break;
    }

    if (!summary) {
        for (const line of lines) {
            if (/^#{1,6}\s+/.test(line)) continue;
            summary = line.replace(/^[-*+•\d.]\s+/, '');
            break;
        }
    }

    if (summary.length > 220) {
        const sentenceEnd = summary.indexOf('. ', 120);
        if (sentenceEnd > 0 && sentenceEnd <= 220) {
            summary = summary.slice(0, sentenceEnd + 1);
        } else {
            const lastSpace = summary.lastIndexOf(' ', 210);
            summary = (lastSpace > 100 ? summary.slice(0, lastSpace) : summary.slice(0, 210)).trim() + '...';
        }
    }

    return summary;
};

/** Extract key skills from inline labels or dedicated Skills headings in the JD text. */
export const extractKeySkills = (raw) => {
    if (!raw) return [];
    const text = String(raw).replace(/\r\n?/g, '\n');
    const skills = [];

    // Pattern 1: Inline label: "Key Skills:", "Skills:", "Tech Stack:", etc.
    const inlineMatches = text.matchAll(/(?:key\s+skills|technical\s+skills|required\s+skills|core\s+skills|tech\s+stack|technologies|skills)\s*:\s*([^\n\r]+)/gi);
    for (const match of inlineMatches) {
        if (match && match[1]) {
            const parts = match[1].split(/[,/•;|]+/).map((s) => s.trim().replace(/^[\*\-_`\s]+|[\*\-_`\.\s]+$/g, ''));
            for (const p of parts) {
                if (p && p.length <= 32 && !/^(and|or|etc|with|in|including)$/i.test(p)) {
                    skills.push(p);
                }
            }
        }
    }

    // Pattern 2: Heading for Skills followed by list or paragraph
    const lines = text.split('\n');
    let inSkillsSection = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (/^#{1,6}\s*(?:key\s+skills|technical\s+skills|required\s+skills|core\s+skills|tech\s+stack|technologies|skills)\b/i.test(line)) {
            inSkillsSection = true;
            continue;
        }
        if (inSkillsSection) {
            if (/^#{1,6}\s+/.test(line)) break;
            const bullet = line.match(/^[-*+•\d.]\s*(.*)/);
            const content = bullet ? bullet[1] : line;
            const parts = content.split(/[,/•;|]+/).map((s) => s.trim().replace(/^[\*\-_`\s]+|[\*\-_`\.\s]+$/g, ''));
            for (const p of parts) {
                if (p && p.length <= 32 && !/^(and|or|etc|with|in|including)$/i.test(p)) {
                    skills.push(p);
                }
            }
        }
    }

    const seen = new Set();
    const deduped = [];
    for (const s of skills) {
        const lower = s.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            deduped.push(s);
        }
    }
    return deduped.slice(0, 8);
};

const blockLength = (b) => (b.items ? b.items.reduce((n, s) => n + s.length, 0) : b.text.length);

/** Backwards-compatible preview helper if required by external tests or tools. */
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

const JobDescription = ({ text, title = '', budget = 650, className = '' }) => {
    const blocks = useMemo(() => parseDescription(text), [text]);
    const summary = useMemo(() => extractRoleSummary(text, title), [text, title]);
    const skills = useMemo(() => extractKeySkills(text), [text]);
    const [expanded, setExpanded] = useState(false);

    if (!blocks.length) return null;

    const hasFullDetails = blocks.length > 1 || (summary && text.trim().length > summary.trim().length + 15) || skills.length > 0;

    if (!hasFullDetails) {
        return (
            <div data-testid="job-description" className={`text-sm leading-relaxed text-slate-700 dark:text-slate-300 break-words [overflow-wrap:anywhere] ${className}`}>
                <div className="space-y-2">{blocks.map((b, i) => <Block key={i} block={b} index={i} />)}</div>
            </div>
        );
    }

    return (
        <div data-testid="job-description" className={`text-sm leading-relaxed text-slate-700 dark:text-slate-300 break-words [overflow-wrap:anywhere] ${className}`}>
            {/* 1. Concise Overview: 2-3 line role summary */}
            {summary && (
                <p data-testid="role-summary" className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 line-clamp-3">
                    {renderInline(summary)}
                </p>
            )}

            {/* 2. Compact Key Skills tags (if available) */}
            {skills.length > 0 && (
                <div data-testid="key-skills" className="flex flex-wrap items-center gap-1.5 pt-2" aria-label="Key skills">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-0.5">Key skills:</span>
                    {skills.map((skill, idx) => (
                        <span
                            key={idx}
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60"
                        >
                            {skill}
                        </span>
                    ))}
                </div>
            )}

            {/* 3. Collapsible Control */}
            <div className="pt-2.5">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    aria-controls="full-job-description"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#4c7324] dark:text-[#9fd05a] hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60 cursor-pointer"
                >
                    <span>{expanded ? 'Hide Full Job Description' : 'View Full Job Description'}</span>
                    <ChevronDown size={14} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* 4. Complete Full JD: hidden by default, expanded on click */}
            <div
                id="full-job-description"
                data-testid="full-job-description"
                className={expanded
                    ? "mt-3 pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                    : "hidden"}
            >
                {blocks.map((b, i) => (
                    <Block key={i} block={b} index={i} />
                ))}
            </div>
        </div>
    );
};

export default JobDescription;
