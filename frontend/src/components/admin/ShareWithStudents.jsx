import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Send } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { ErrorBanner, cardCls, formatDate, ghostBtn, inputCls, primaryBtn } from './adminUi';

// The server accepts at most 50 students per request; larger selections are sent as consecutive requests.
export const INVITE_CHUNK = 50;

export const chunk = (ids, size = INVITE_CHUNK) => {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
    return out;
};

const SENT_HINT = 'Accepted by the mail server. Delivery to the inbox is not confirmed.';

/** Status shown for a student: the outcome of the latest send in this panel wins over the stored invitation status. */
export const statusOf = (student, outcome) => {
    if (outcome) {
        if (outcome.status === 'sent') return { key: 'SENT', label: 'Sent', hint: SENT_HINT };
        if (outcome.status === 'failed') return { key: 'FAILED', label: 'Failed', hint: outcome.reason };
        return { key: outcome.reason?.startsWith('Already') ? 'SENT' : 'PENDING', label: outcome.reason?.startsWith('Already') ? 'Already sent' : 'In progress', hint: outcome.reason };
    }
    const inv = student.invitation;
    if (!inv) return null;
    if (inv.status === 'SENT') return { key: 'SENT', label: 'Sent', hint: SENT_HINT };
    if (inv.status === 'FAILED') return { key: 'FAILED', label: 'Failed', hint: inv.error };
    return { key: 'PENDING', label: 'Pending', hint: 'An invitation is being sent.' };
};

const BADGE = {
    SENT: 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:text-[#9fd05a]',
    FAILED: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
    PENDING: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
};

/**
 * Optional "Share with Students" panel of one published assessment: pick existing students and e-mail them the shared link.
 * Everything here is additive: the link field above it (Copy link / Preview) keeps working whether or not this panel is used.
 * Who may be invited, whether the link is still valid and what was actually sent are all decided by the server.
 */
const ShareWithStudents = ({ role, onToast }) => {
    const [students, setStudents] = useState([]);
    const [meta, setMeta] = useState({ total: 0, truncated: false, canSend: true, reason: null, emailConfigured: true, expiresAt: null });
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState(() => new Set());
    const [sending, setSending] = useState(false);
    const [outcomes, setOutcomes] = useState({}); // student id -> latest { status, reason } from this panel
    const [summary, setSummary] = useState(null);
    const [sendError, setSendError] = useState('');
    const selectAllRef = useRef(null);
    const requestSeq = useRef(0);

    const load = useCallback(async (q) => {
        const seq = ++requestSeq.current;
        setLoading(true);
        setError('');
        try {
            const data = await adminApi.listShareStudents(role.id, q);
            if (seq !== requestSeq.current) return; // a newer search superseded this one
            setStudents(data.items || []);
            setMeta({ total: data.total ?? 0, truncated: !!data.truncated, canSend: data.can_send !== false, reason: data.cannot_send_reason,
                emailConfigured: data.email_configured !== false, expiresAt: data.link_expires_at });
        } catch (err) {
            if (seq === requestSeq.current) setError(errorMessage(err, 'Unable to load students.'));
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [role.id]);

    useEffect(() => {
        const t = setTimeout(() => load(query.trim()), query ? 300 : 0);
        return () => clearTimeout(t);
    }, [query, load]);

    const visibleIds = useMemo(() => students.map((s) => s.id), [students]);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    const someVisibleSelected = visibleIds.some((id) => selected.has(id));

    useEffect(() => {
        if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }, [someVisibleSelected, allVisibleSelected]);

    const toggle = (id) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const toggleAll = () => setSelected((prev) => {
        const next = new Set(prev);
        if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id)); else visibleIds.forEach((id) => next.add(id));
        return next;
    });

    const failedIds = useMemo(() => students.filter((s) => statusOf(s, outcomes[s.id])?.key === 'FAILED').map((s) => s.id), [students, outcomes]);

    const send = async (ids) => {
        if (sending || ids.length === 0) return;
        setSending(true);
        setSendError('');
        setSummary(null);
        const totals = { sent: 0, failed: 0, skipped: 0 };
        let stopped = false;
        try {
            for (const part of chunk(ids)) {
                const data = await adminApi.sendInvitations(role.id, part);
                setOutcomes((prev) => ({ ...prev, ...Object.fromEntries(data.results.map((r) => [r.student_id, r])) }));
                Object.keys(totals).forEach((k) => { totals[k] += data.summary?.[k] || 0; });
            }
        } catch (err) {
            stopped = true;
            setSendError(errorMessage(err, 'Unable to send invitations.'));
        } finally {
            setSending(false);
        }
        setSummary({ ...totals, stopped });
        if (totals.sent > 0 && totals.failed === 0 && !stopped) onToast?.({ message: `${totals.sent} invitation${totals.sent === 1 ? '' : 's'} sent.` });
        else if (totals.failed > 0 || stopped) onToast?.({ type: 'error', message: 'Some invitations were not sent. See the status of each student.' });
        load(query.trim());
    };

    const canSend = meta.canSend && meta.emailConfigured;

    return (
        <div className={`${cardCls} mt-3 p-4 space-y-3`} aria-label={`Share ${role.title} with students`} data-testid="share-with-students">
            <div>
                <h4 className="font-bold text-slate-900 dark:text-white">Share with Students</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    E-mail the link above to students you choose. This is optional: you can always copy the link and share it yourself.
                    Students still register and take the assessment through the same link.
                </p>
            </div>

            {!meta.emailConfigured && (
                <p className="text-sm rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 px-3 py-2" role="status">
                    E-mail sending is not configured on the server, so invitations cannot be sent. Copy the link above to share it manually.
                </p>
            )}
            {meta.emailConfigured && !meta.canSend && meta.reason && (
                <p className="text-sm rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 px-3 py-2" role="status">{meta.reason}</p>
            )}

            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="search" className={`${inputCls} pl-9`} placeholder="Search students by name or email" value={query}
                    onChange={(e) => setQuery(e.target.value)} aria-label="Search students" maxLength={100} />
            </div>

            {error && <ErrorBanner onRetry={() => load(query.trim())}>{error}</ErrorBanner>}

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <label className="flex items-center gap-3 px-3 py-2 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={visibleIds.length === 0 || sending} aria-label="Select all students" />
                    Select all{query.trim() ? ' matching' : ''} ({visibleIds.length})
                </label>
                <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800" aria-label="Students">
                    {loading && students.length === 0 && <li className="px-3 py-4 text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading students...</li>}
                    {!loading && !error && students.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">{query.trim() ? 'No students match your search.' : 'There are no students to invite yet.'}</li>}
                    {students.map((s) => {
                        const st = statusOf(s, outcomes[s.id]);
                        return (
                            <li key={s.id}>
                                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} disabled={sending} aria-label={`Select ${s.name || s.email}`} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{s.name || '—'}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{s.email}</span>
                                    </span>
                                    {st && (
                                        <span className="text-right shrink-0 max-w-[45%]">
                                            <span title={st.hint || undefined} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${BADGE[st.key]}`}>{st.label}</span>
                                            {st.key === 'FAILED' && st.hint && <span className="block text-[11px] text-red-600 dark:text-red-400 mt-0.5">{st.hint}</span>}
                                        </span>
                                    )}
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </div>
            {meta.truncated && <p className="text-xs text-slate-500">Showing the first {students.length} of {meta.total} students. Use the search to narrow the list.</p>}

            <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={primaryBtn} disabled={!canSend || sending || selected.size === 0} onClick={() => send([...selected])}>
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {sending ? 'Sending...' : 'Send Invitation'}
                </button>
                {failedIds.length > 0 && (
                    <button type="button" className={ghostBtn} disabled={!canSend || sending} onClick={() => send(failedIds)}>Retry failed ({failedIds.length})</button>
                )}
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300" data-testid="selected-count" aria-live="polite">{selected.size} selected</span>
                {selected.size > 0 && !sending && <button type="button" className="text-xs font-semibold text-slate-500 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>}
            </div>
            {meta.expiresAt && <p className="text-xs text-slate-500 dark:text-slate-400">The e-mail tells students the link expires {formatDate(meta.expiresAt)}.</p>}

            {sendError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{sendError}</p>}
            {summary && (
                <p className="text-sm text-slate-700 dark:text-slate-300" role="status" data-testid="send-summary">
                    {summary.sent} sent · {summary.failed} failed · {summary.skipped} skipped{summary.stopped ? ' · sending stopped early' : ''}.
                    {' '}<span className="text-xs text-slate-500">&ldquo;Sent&rdquo; means the mail server accepted the message; delivery to the inbox is not confirmed.</span>
                </p>
            )}
        </div>
    );
};

export default ShareWithStudents;
