import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, Maximize2, Minimize2, Moon, RotateCcw, Sun } from 'lucide-react';

// Building blocks of the LeetCode-style workspace, shared by the Coding page and the assessment coding round so both look and behave the same.

export const EDITOR_OPTIONS = {
    minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, automaticLayout: true,
    tabSize: 4, insertSpaces: true, wordWrap: 'on', padding: { top: 12 }, renderLineHighlight: 'line',
};

export const useIsDark = () => {
    const read = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const [dark, setDark] = useState(read);
    useEffect(() => {
        const observer = new MutationObserver(() => setDark(read()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    return dark;
};

/** Drag (or arrow-key) a divider; `axis` is 'x' for a vertical bar between columns, 'y' for a horizontal bar between rows. */
export const Splitter = ({ axis, containerRef, value, onChange, min, max, label }) => {
    const dragging = useRef(false);
    const move = useCallback((clientX, clientY) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        const pct = axis === 'x' ? ((clientX - box.left) / box.width) * 100 : ((clientY - box.top) / box.height) * 100;
        onChange(Math.min(max, Math.max(min, pct)));
    }, [axis, containerRef, max, min, onChange]);

    useEffect(() => {
        const onMove = (e) => { if (dragging.current) move(e.clientX, e.clientY); };
        const onUp = () => { dragging.current = false; document.body.style.userSelect = ''; };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    }, [move]);

    const step = (delta) => onChange(Math.min(max, Math.max(min, value + delta)));
    return (
        <div
            role="separator"
            aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
            aria-label={label}
            aria-valuenow={Math.round(value)}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onPointerDown={(e) => { e.preventDefault(); dragging.current = true; document.body.style.userSelect = 'none'; }}
            onKeyDown={(e) => {
                const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
                const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
                if (e.key === back) { e.preventDefault(); step(-2); }
                if (e.key === fwd) { e.preventDefault(); step(2); }
            }}
            className={`hidden lg:flex shrink-0 items-center justify-center group focus:outline-none ${axis === 'x' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'}`}
        >
            <span className={`rounded-full bg-slate-300 dark:bg-slate-700 group-hover:bg-emerald-400 group-focus-visible:bg-emerald-500 transition-colors ${axis === 'x' ? 'w-1 h-10' : 'h-1 w-10'}`} />
        </div>
    );
};

export const Pane = ({ className = '', children }) => (
    <div className={`rounded-xl border border-slate-200 dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] overflow-hidden min-w-0 ${className}`}>{children}</div>
);

export const TabButton = ({ active, onClick, children, icon: Icon, disabled }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        role="tab"
        aria-selected={active}
        className={`min-h-[40px] lg:min-h-[34px] px-3 inline-flex items-center gap-1.5 text-xs sm:text-[13px] font-medium rounded-md whitespace-nowrap transition-colors ${
            active ? 'bg-white dark:bg-[#3a3a3a] text-slate-900 dark:text-white shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}
    >
        {Icon && <Icon className="w-3.5 h-3.5" />}{children}
    </button>
);

export const Block = ({ label, children }) => (
    <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{label}</p>
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 dark:bg-[#2b2b2b] border border-slate-200 dark:border-transparent px-3 py-2 text-xs sm:text-[13px] font-mono text-slate-800 dark:text-slate-100 max-h-48 overflow-auto">{children === '' || children === null || children === undefined ? '(empty)' : children}</pre>
    </div>
);


const DOT = { passed: 'bg-emerald-500', ran: 'bg-sky-500', skipped: 'bg-slate-300' };

/**
 * The result of a run, one chip per test case and the selected case's details. Every case is
 * { status: 'passed'|'failed'|'error'|'tle'|'ran'|'skipped', custom?, input, expected?, actual?, error?, stdout? }.
 */
export const CaseViewer = ({ cases, index, onIndex }) => {
    const active = cases[index];
    return (
        <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Test cases">
                {cases.map((c, i) => (
                    <button key={i} type="button" role="tab" aria-selected={index === i} onClick={() => onIndex(i)}
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 ${index === i ? 'border-transparent bg-slate-200 dark:bg-[#3a3a3a] text-slate-900 dark:text-white' : 'border-transparent bg-slate-100 dark:bg-[#2b2b2b] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333]'}`}>
                        <span className={`w-2 h-2 rounded-full ${DOT[c.status] || 'bg-rose-500'}`} />
                        {c.custom ? 'Custom' : `Case ${i + 1}`}
                    </button>
                ))}
            </div>
            {active && (
                <div className="space-y-2">
                    <Block label="Input">{active.input}</Block>
                    {active.error ? <Block label="Error">{active.error}</Block> : active.status !== 'skipped' && <Block label="Your output">{active.actual}</Block>}
                    {!active.custom && active.expected !== undefined && active.expected !== null && <Block label="Expected">{active.expected}</Block>}
                    {!!active.stdout && <Block label="Stdout">{active.stdout}</Block>}
                </div>
            )}
        </>
    );
};


// The strip above the left and console panes: the tabs sit on a slightly darker bar, like LeetCode's.
export const TAB_BAR = 'flex items-center gap-1 px-2 py-1.5 bg-slate-100 dark:bg-[#282828] border-b border-slate-200 dark:border-[#2f2f2f] overflow-x-auto shrink-0';
export const SLIM_LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

/** The workspace colour scheme the candidate picked (dark like LeetCode by default); kept in this browser only. */
export const useWorkspaceTheme = () => {
    const read = () => { try { return localStorage.getItem('pw-coding-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
    const [theme, setTheme] = useState(read);
    const toggle = useCallback(() => setTheme((t) => {
        const next = t === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('pw-coding-theme', next); } catch { /* the choice just is not remembered */ }
        return next;
    }), []);
    return [theme, toggle];
};

/** Editor header: the "Code" title, the language, and the few tools a coding round needs (reset, colour scheme, expand). */
export const EditorToolbar = ({ onReset, onToggleTheme, themeIsDark, expanded, onToggleExpand, hint }) => (
    <div className="flex items-center gap-2 px-3 min-h-[40px] bg-slate-100 dark:bg-[#282828] border-b border-slate-200 dark:border-[#2f2f2f] shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100"><Code2 className="w-4 h-4 text-emerald-500" /> Code</span>
        <span className="ml-2 inline-flex items-center rounded-md bg-white dark:bg-[#3a3a3a] px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-200">Python3</span>
        {hint && <span className="hidden md:inline text-[11px] text-slate-400 truncate">{hint}</span>}
        <span className="ml-auto inline-flex items-center gap-0.5">
            {onToggleTheme && (
                <button type="button" onClick={onToggleTheme} className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#3a3a3a]"
                    aria-label={themeIsDark ? 'Switch to the light theme' : 'Switch to the dark theme'} title={themeIsDark ? 'Light theme' : 'Dark theme'}>
                    {themeIsDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
            )}
            <button type="button" onClick={onReset} className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#3a3a3a]" aria-label="Reset to starter code" title="Reset code"><RotateCcw className="w-4 h-4" /></button>
            {onToggleExpand && (
                <button type="button" onClick={onToggleExpand} className="hidden lg:inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#3a3a3a]"
                    aria-label={expanded ? 'Show the problem again' : 'Expand the editor'} title={expanded ? 'Restore layout' : 'Expand editor'}>
                    {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
            )}
        </span>
    </div>
);

/** "Saved" on the left, "Ln 3, Col 9" on the right, under the editor. */
export const EditorStatusBar = ({ saved = 'Saved', position }) => (
    <div className="flex items-center justify-between px-3 min-h-[28px] text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#1e1e1e] border-t border-slate-200 dark:border-[#2f2f2f] shrink-0">
        <span>{saved}</span>
        <span className="tabular-nums">Ln {position?.line || 1}, Col {position?.col || 1}</span>
    </div>
);

/** Tracks the cursor of a Monaco editor for the status bar. Use `track` as (part of) the editor's onMount. */
export const useCursorPosition = () => {
    const [position, setPosition] = useState({ line: 1, col: 1 });
    const track = useCallback((editor) => {
        const p = editor.getPosition();
        if (p) setPosition({ line: p.lineNumber, col: p.column });
        editor.onDidChangeCursorPosition((e) => setPosition({ line: e.position.lineNumber, col: e.position.column }));
    }, []);
    return [position, track];
};
