import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';

export const STATUS_META = {
    REGISTERED: { label: 'Registered', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
    IN_PROGRESS: { label: 'In progress', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900' },
    COMPLETED: { label: 'Completed', cls: 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-[#9fd05a] dark:border-emerald-800/60' },
    TIMED_OUT: { label: 'Timed out', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900' },
    ABANDONED: { label: 'Abandoned', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900' },
    EVALUATION_PENDING: { label: 'Evaluation pending', cls: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900' },
    INFRASTRUCTURE_FAILURE: { label: 'Platform error', cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900' },
    MANUAL_REVIEW_REQUIRED: { label: 'Under review', cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900' },
    REVOKED_RETRIED: { label: 'Archived (retake)', cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' },
    DRAFT: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
    PUBLISHED: { label: 'Published', cls: 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-[#9fd05a] dark:border-emerald-800/60' },
    EXPIRED: { label: 'Link expired', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900' },
    CLOSED: { label: 'Closed', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900' },
};

export const StatusBadge = ({ status }) => {
    const meta = STATUS_META[status] || { label: status, cls: STATUS_META.REGISTERED.cls };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${meta.cls}`}>{meta.label}</span>;
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

export const cardCls = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs transition-colors';
export const inputCls = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 dark:focus:ring-emerald-500/30 focus:border-[#5d8c2c] dark:focus:border-emerald-500 transition-colors';
export const primaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] dark:bg-emerald-600 dark:hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-2 transition-colors shadow-xs cursor-pointer';
export const ghostBtn = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-semibold text-sm px-3.5 py-2 transition-colors shadow-2xs cursor-pointer';

export const Toast = ({ toast, onClose }) => {
    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(onClose, 4500);
        return () => clearTimeout(t);
    }, [toast, onClose]);
    if (!toast) return null;
    const ok = toast.type !== 'error';
    return (
        <div className="fixed bottom-6 right-6 z-[120] max-w-sm" role="status" aria-live="polite">
            <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg text-sm font-semibold bg-white dark:bg-slate-900 ${ok ? 'border-[#5d8c2c]/40 text-slate-800 dark:text-slate-100' : 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
                {ok ? <CheckCircle2 size={16} className="text-[#5d8c2c] mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                <span className="flex-1">{toast.message}</span>
                <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X size={14} /></button>
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
    <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-3xl">{children}</p>
        {onRefresh && (
            <button
                type="button"
                className={`${ghostBtn} shrink-0`}
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
    <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm" role="alert">
        <span>{children}</span>
        {onRetry && <button type="button" onClick={onRetry} className="font-bold underline shrink-0">Try again</button>}
    </div>
);

export const LoadingRow = ({ children = 'Loading...' }) => (
    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 py-6 justify-center" role="status"><Loader2 size={14} className="animate-spin" /> {children}</p>
);

/** Empty state: says what is missing and offers the one next step (never implies the system is broken). */
export const EmptyState = ({ icon: Icon, title, children, action }) => (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-6 py-10 text-center">
        {Icon && <Icon size={28} className="mx-auto text-slate-400 mb-2" />}
        <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{title}</h3>
        {children && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">{children}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
);
