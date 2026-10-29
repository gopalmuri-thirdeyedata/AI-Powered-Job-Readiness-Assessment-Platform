// Pure helpers for the LeetCode-style coding workspace (no React, no network), so they can be unit tested on their own.

export const VERDICTS = {
    ACCEPTED: { label: 'Accepted', tone: 'good' },
    WRONG_ANSWER: { label: 'Wrong Answer', tone: 'bad' },
    RUNTIME_ERROR: { label: 'Runtime Error', tone: 'bad' },
    TIME_LIMIT_EXCEEDED: { label: 'Time Limit Exceeded', tone: 'warn' },
    COMPILE_ERROR: { label: 'Compile Error', tone: 'warn' },
    OUTPUT_ERROR: { label: 'Output Error', tone: 'warn' },
};

export const verdictInfo = (verdict) => VERDICTS[verdict] || { label: String(verdict || 'Unknown'), tone: 'warn' };

export const TONE_CLASSES = {
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-rose-600 dark:text-rose-400',
    warn: 'text-amber-600 dark:text-amber-400',
};

export const DIFFICULTY_CLASSES = {
    Easy: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
    Medium: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
    Hard: 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',
};

export const formatRuntime = (ms) => (ms === null || ms === undefined ? '–' : `${Math.max(0, Math.round(ms))} ms`);

export const formatMemory = (kb) => {
    if (!kb) return '–';
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
};

/**
 * The server sends `detail` as a string for our endpoints, but FastAPI validation errors are arrays and some guards send objects.
 * Always reduce it to text so it can be rendered as a React child.
 */
export const errorMessage = (err, fallback = 'Something went wrong. Please try again.') => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
        return detail.map((d) => (typeof d === 'string' ? d : d?.msg)).filter(Boolean).join('; ') || fallback;
    }
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message;
    if (err?.response?.status === 429) return 'Too many requests. Please wait a few seconds.';
    if (!err?.response && err?.message) return 'Cannot reach the server. Check your connection.';
    return fallback;
};

// ── Drafts (per problem, per browser). Storage can throw (private mode, blocked data), so every access is guarded. ──
export const draftKey = (slug) => `prepwin_coding_draft:${slug}`;

export const loadDraft = (slug, storage = globalThis.localStorage) => {
    try {
        return storage?.getItem(draftKey(slug)) ?? null;
    } catch {
        return null;
    }
};

export const saveDraft = (slug, code, storage = globalThis.localStorage) => {
    try {
        storage?.setItem(draftKey(slug), code);
    } catch {
        /* a draft is a convenience, never an error */
    }
};

export const clearDraft = (slug, storage = globalThis.localStorage) => {
    try {
        storage?.removeItem(draftKey(slug));
    } catch {
        /* ignore */
    }
};

/** Unsaved draft first, then the student's last submission, then the starter template. */
export const pickInitialCode = ({ draft, lastCode, starter }) => {
    if (typeof draft === 'string' && draft.trim()) return draft;
    if (typeof lastCode === 'string' && lastCode.trim()) return lastCode;
    return starter || '';
};

// ── LeetCode shortcuts: Ctrl/Cmd + ' runs, Ctrl/Cmd + Enter submits ──
export const isRunShortcut = (e) => !!e && (e.ctrlKey || e.metaKey) && (e.key === "'" || e.code === 'Quote');
export const isSubmitShortcut = (e) => !!e && (e.ctrlKey || e.metaKey) && e.key === 'Enter';

// ── Problem statements: a small, safe subset of markdown (paragraphs, bullet lists, `code`, **bold**). Never HTML. ──
export const parseInline = (text) => {
    const tokens = [];
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let last = 0;
    let match;
    const source = String(text ?? '');
    while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) tokens.push({ type: 'text', value: source.slice(last, match.index) });
        const raw = match[0];
        tokens.push(raw.startsWith('`') ? { type: 'code', value: raw.slice(1, -1) } : { type: 'bold', value: raw.slice(2, -2) });
        last = match.index + raw.length;
    }
    if (last < source.length) tokens.push({ type: 'text', value: source.slice(last) });
    return tokens;
};

export const parseBlocks = (text) => {
    const blocks = [];
    String(text ?? '').split(/\n{2,}/).forEach((chunk) => {
        const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
        if (!lines.length) return;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
            blocks.push({ type: 'list', items: lines.map((l) => l.replace(/^\s*[-*]\s+/, '')) });
        } else {
            blocks.push({ type: 'paragraph', text: lines.join(' ') });
        }
    });
    return blocks;
};

export const statusLabel = { todo: 'Todo', attempted: 'Attempted', solved: 'Solved' };

// ── Activity heatmap: the last `days` days as week columns (Sunday first), each cell { date, count, level 0-4 } or null padding ──
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const heatLevel = (count) => {
    if (!count) return 0;
    if (count < 2) return 1;
    if (count < 4) return 2;
    if (count < 7) return 3;
    return 4;
};

export const buildHeatmap = (activity = {}, days = 84, today = new Date()) => {
    // The server counts submissions per UTC day, so the grid is laid out in UTC days too (otherwise near midnight a day lands in the wrong cell)
    const cells = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
        const key = d.toISOString().slice(0, 10);
        const count = Number(activity?.[key]) || 0;
        cells.push({ date: key, count, level: heatLevel(count), weekday: d.getUTCDay() });
    }
    const padded = [...Array(cells[0]?.weekday || 0).fill(null), ...cells];
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
    return weeks;
};

export const HEAT_CLASSES = [
    'bg-slate-100 dark:bg-slate-800',
    'bg-emerald-200 dark:bg-emerald-900',
    'bg-emerald-300 dark:bg-emerald-700',
    'bg-emerald-400 dark:bg-emerald-600',
    'bg-emerald-600 dark:bg-emerald-400',
];
