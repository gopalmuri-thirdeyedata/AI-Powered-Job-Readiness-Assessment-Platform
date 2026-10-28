import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
   Shared admin design system. Every Admin Workspace page and dialog builds on the class strings and components in this file,
   so spacing, radii, heights, colours and focus rings change in one place. Tokens (index.css `--pw-*`) follow the `.dark` class.
   Sizes: controls 40px (compact 32px), card radius 12px, spacing in 4px steps.
   ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const TONES = {
    neutral: { cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', dot: 'bg-slate-400' },
    brand: { cls: 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-[#9fd05a] dark:border-emerald-800/60', dot: 'bg-[#5d8c2c] dark:bg-emerald-400' },
    info: { cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900', dot: 'bg-blue-500' },
    warning: { cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900', dot: 'bg-amber-500' },
    danger: { cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900', dot: 'bg-red-500' },
    orange: { cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900', dot: 'bg-orange-500' },
    violet: { cls: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900', dot: 'bg-violet-500' },
};

export const STATUS_META = {
    REGISTERED: { label: 'Registered', cls: TONES.neutral.cls, dot: TONES.neutral.dot },
    IN_PROGRESS: { label: 'In progress', cls: TONES.info.cls, dot: TONES.info.dot },
    COMPLETED: { label: 'Completed', cls: TONES.brand.cls, dot: TONES.brand.dot },
    TIMED_OUT: { label: 'Timed out', cls: TONES.warning.cls, dot: TONES.warning.dot },
    ABANDONED: { label: 'Abandoned', cls: TONES.danger.cls, dot: TONES.danger.dot },
    EVALUATION_PENDING: { label: 'Evaluation pending', cls: TONES.violet.cls, dot: TONES.violet.dot },
    INFRASTRUCTURE_FAILURE: { label: 'Platform error', cls: TONES.orange.cls, dot: TONES.orange.dot },
    MANUAL_REVIEW_REQUIRED: { label: 'Under review', cls: TONES.orange.cls, dot: TONES.orange.dot },
    REVOKED_RETRIED: { label: 'Archived (retake)', cls: TONES.neutral.cls, dot: TONES.neutral.dot },
    DRAFT: { label: 'Draft', cls: TONES.neutral.cls, dot: TONES.neutral.dot },
    PUBLISHED: { label: 'Published', cls: TONES.brand.cls, dot: TONES.brand.dot },
    EXPIRED: { label: 'Link expired', cls: TONES.warning.cls, dot: TONES.warning.dot },
    CLOSED: { label: 'Closed', cls: TONES.danger.cls, dot: TONES.danger.dot },
};

export const badgeBase = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap shadow-[0_1px_0_rgba(255,255,255,0.6)_inset] dark:shadow-none';

/** Generic pill for non-status labels (roles, blueprint source, access). `tone` is one of neutral | brand | info | warning | danger | orange | violet. */
export const Badge = ({ tone = 'neutral', dot = false, icon: Icon, children, className = '' }) => {
    const t = TONES[tone] || TONES.neutral;
    return (
        <span className={`${badgeBase} ${t.cls} ${className}`}>
            {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />}
            {Icon && <Icon size={12} className="shrink-0" aria-hidden="true" />}
            {children}
        </span>
    );
};

export const StatusBadge = ({ status }) => {
    const meta = STATUS_META[status] || { label: status, cls: STATUS_META.REGISTERED.cls, dot: STATUS_META.REGISTERED.dot };
    return (
        <span className={`${badgeBase} ${meta.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
            {meta.label}
        </span>
    );
};

export const formatScore = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);

export const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
};

/* Surfaces */
export const cardCls = 'rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[var(--pw-surface)] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.10)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors';

/* Controls: 40px high, 12px-ish radius family, one focus treatment */
export const inputCls = 'w-full min-h-[40px] rounded-lg border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-slate-950/70 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] dark:shadow-none text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3 py-2 text-sm hover:border-slate-400/70 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/25 dark:focus:ring-emerald-500/30 focus:border-[#5d8c2c] dark:focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors';
export const labelCls = 'block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5';
export const hintCls = 'text-xs text-slate-500 dark:text-slate-400 mt-1.5';

const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold text-sm leading-5 min-h-[40px] px-4 py-2 whitespace-nowrap select-none cursor-pointer transition-[background-color,border-color,color,box-shadow] duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';
export const primaryBtn = `${btnBase} bg-[#5d8c2c] hover:bg-[#4c7324] dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(63,111,37,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.4)] focus-visible:ring-[#5d8c2c]/60`;
export const ghostBtn = `${btnBase.replace('font-semibold', 'font-medium')} border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-slate-800/70 shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:shadow-none hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-400/70 dark:hover:border-slate-600 text-slate-700 dark:text-slate-200 focus-visible:ring-slate-400/60`;
export const dangerBtn = `${btnBase} bg-red-600 hover:bg-red-700 text-white shadow-sm focus-visible:ring-red-500/60`;
/** Outlined destructive action (Deactivate, Reset registration): neutral until hovered so it never competes with the primary action. */
export const dangerGhostBtn = `${btnBase.replace('font-semibold', 'font-medium')} border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-slate-800/70 shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:shadow-none text-slate-700 dark:text-slate-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:border-red-900 dark:hover:text-red-300 focus-visible:ring-red-500/50`;
/** Compact (32px) variants for table rows and card toolbars; icon-only buttons must pass an aria-label. */
export const ghostBtnSm = ghostBtn.replace('min-h-[40px] px-4 py-2', 'min-h-[32px] px-3 py-1 text-[13px]');
export const dangerGhostBtnSm = dangerGhostBtn.replace('min-h-[40px] px-4 py-2', 'min-h-[32px] px-3 py-1 text-[13px]');
export const primaryBtnSm = primaryBtn.replace('min-h-[40px] px-4 py-2', 'min-h-[32px] px-3 py-1 text-[13px]');
export const iconBtn = `${ghostBtnSm.replace('px-3', 'px-0')} w-8`;
export const linkBtn = 'font-semibold text-[#4c7324] dark:text-[#9fd05a] hover:underline underline-offset-2 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50';

/* Tables */
export const tableWrapCls = `${cardCls} overflow-hidden`;
export const thCls = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400 whitespace-nowrap';
export const tdCls = 'px-4 py-3 align-middle';
export const theadCls = 'bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800';
export const tbodyCls = 'divide-y divide-slate-100 dark:divide-slate-800/70';
export const trCls = 'hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors';

export const Toast = ({ toast, onClose }) => {
    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(onClose, 4500);
        return () => clearTimeout(t);
    }, [toast, onClose]);
    if (!toast) return null;
    const ok = toast.type !== 'error';
    return (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 z-[120] sm:max-w-sm" role="status" aria-live="polite">
            <div className={`flex items-start gap-3 rounded-xl border border-l-4 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_32px_-12px_rgba(15,23,42,0.28)] text-sm font-medium bg-white dark:bg-slate-900 ${ok ? 'border-slate-200 dark:border-slate-700 border-l-[#5d8c2c] dark:border-l-emerald-500 text-slate-800 dark:text-slate-100' : 'border-red-200 dark:border-red-900 border-l-red-500 text-red-700 dark:text-red-300'}`}>
                {ok ? <CheckCircle2 size={18} className="text-[#5d8c2c] dark:text-emerald-400 mt-px shrink-0" /> : <AlertCircle size={18} className="mt-px shrink-0" />}
                <span className="flex-1 leading-5">{toast.message}</span>
                <button type="button" onClick={onClose} aria-label="Dismiss" className="-mr-1 -mt-0.5 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-opacity cursor-pointer"><X size={14} /></button>
            </div>
        </div>
    );
};

export const copyText = async (text) => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through to the legacy path */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
};

/** One-line purpose statement + optional Refresh at the top of every workspace panel (the tab already names the panel). */
export const PanelIntro = ({ children, onRefresh, loading = false }) => (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400 max-w-4xl">{children}</p>
        {onRefresh && (
            <button
                type="button"
                className={`${ghostBtn} shrink-0 self-start`}
                onClick={onRefresh}
                disabled={loading}
                aria-label={loading ? 'Refreshing data...' : 'Refresh data'}
            >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
        )}
    </div>
);

export const ErrorBanner = ({ children, onRetry }) => (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm leading-5" role="alert">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{children}</span>
        {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2 shrink-0 rounded cursor-pointer hover:no-underline">Try again</button>}
    </div>
);

export const LoadingRow = ({ children = 'Loading...' }) => (
    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 py-8 justify-center" role="status"><Loader2 size={14} className="animate-spin" /> {children}</p>
);

/** Empty state: says what is missing and offers the one next step (never implies the system is broken). */
export const EmptyState = ({ icon: Icon, title, children, action }) => (
    <div className="rounded-xl border border-dashed border-slate-300/90 dark:border-slate-700 bg-gradient-to-b from-white to-slate-50/70 dark:from-slate-900/40 dark:to-slate-900/10 px-6 py-8 sm:py-10 text-center">
        {Icon && (
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#5d8c2c]/10 dark:bg-emerald-500/10 text-[#4c7324] dark:text-emerald-300 ring-1 ring-[#5d8c2c]/20 dark:ring-emerald-500/20">
                <Icon size={20} aria-hidden="true" />
            </span>
        )}
        <h3 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h3>
        {children && <p className="text-sm leading-6 text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">{children}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
);
