import React, { useCallback, useEffect, useRef, useState } from 'react';

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
    <div className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-w-0 ${className}`}>{children}</div>
);

export const TabButton = ({ active, onClick, children, icon: Icon, disabled }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        role="tab"
        aria-selected={active}
        className={`min-h-[44px] lg:min-h-[40px] px-3 sm:px-4 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
            active ? 'border-emerald-500 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}
    >
        {Icon && <Icon className="w-3.5 h-3.5" />}{children}
    </button>
);

export const Block = ({ label, children }) => (
    <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{label}</p>
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs sm:text-[13px] font-mono text-slate-800 dark:text-slate-100 max-h-48 overflow-auto">{children === '' || children === null || children === undefined ? '(empty)' : children}</pre>
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
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 ${index === i ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
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
