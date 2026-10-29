import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, RotateCcw, X } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { Toast, copyText, dangerGhostBtnSm, formatDate, formatScore, ghostBtn, ghostBtnSm, inputCls, primaryBtn, thCls } from './adminUi';

const RETEST_STATUS = {
    ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', SUBMITTED: 'Evaluating', EVALUATION_PENDING: 'Evaluation pending',
    COMPLETED: 'Completed', ABANDONED: 'Abandoned', CANCELLED: 'Cancelled', EXPIRED: 'Expired',
};

const EMAIL_STATUS = { PENDING: 'Email pending', SENT: 'Email sent', FAILED: 'Email failed' };

/**
 * A bare "Not Found" is FastAPI's answer for a route the running server does not have (a handler that exists but finds no record says
 * what it could not find, e.g. "Candidate not found."), so it means the backend process predates this feature and must be restarted.
 */
export const retestErrorMessage = (err, fallback) => (
    err?.response?.status === 404 && err?.response?.data?.detail === 'Not Found'
        ? 'The server does not have the retest API (HTTP 404 Not Found). The backend is running an older version: restart it so it loads the latest code.'
        : errorMessage(err, fallback));

/** The link an administrator hands to the candidate. Accountless candidates need its token; students just sign in as usual. */
export const retestLink = (retest) => `${window.location.origin}/assessment/retest/${retest.retest_uuid}${retest.access_token ? `?token=${encodeURIComponent(retest.access_token)}` : ''}`;

/**
 * Assign a retest for one or more sections of a candidate's finished attempt.
 * Everything shown (candidate, role, status, current score per section, open retests) is read from the backend; nothing here changes a score.
 * The candidate is not asked to register again: a student signs in as before, an accountless candidate opens the one-time link shown after assignment.
 */
const RetestModal = ({ candidateId, onClose, onAssigned }) => {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState([]);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [assigned, setAssigned] = useState(null);   // the response of a successful assignment (links shown once)
    const [toast, setToast] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminApi.retestOverview(candidateId));
        } catch (err) {
            setError(retestErrorMessage(err, 'Unable to load this candidate.'));
        } finally {
            setLoading(false);
        }
    }, [candidateId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, busy]);

    const toggle = (key) => setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

    const assign = async () => {
        if (busy) return;
        if (selected.length === 0) { setToast({ type: 'error', message: 'Select at least one section to retest.' }); return; }
        setBusy(true);
        try {
            const res = await adminApi.assignRetests(candidateId, selected, reason.trim());
            setAssigned(res);
            setSelected([]);
            setReason('');
            setToast(res.email?.status === 'SENT'
                ? { message: `Retest assigned. An email was sent to ${res.email.to}.` }
                : { type: 'error', message: 'Retest assigned, but the email could not be sent. See the notice below.' });
            if (onAssigned) onAssigned();
            load();
        } catch (err) {
            setToast({ type: 'error', message: retestErrorMessage(err, 'The retest could not be assigned.') });
        } finally {
            setBusy(false);
        }
    };

    const act = async (fn, okMessage) => {
        setBusy(true);
        try {
            await fn();
            setToast({ message: okMessage });
            if (onAssigned) onAssigned();
            load();
        } catch (err) {
            setToast({ type: 'error', message: retestErrorMessage(err, 'The action failed.') });
        } finally {
            setBusy(false);
        }
    };

    // Retry a FAILED candidate email. It never creates another assignment; the server refuses to re-send one that was already sent.
    const resendEmail = async (retestUuid) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await adminApi.resendRetestEmail(retestUuid);
            setAssigned({ retests: res.retests.filter((r) => r.status === 'ASSIGNED'), email: res.email, student_account: res.student_account });
            setToast(res.email?.status === 'SENT' ? { message: `Email sent to ${res.email.to}.` } : { type: 'error', message: 'The email could not be sent again. See the notice below.' });
            if (onAssigned) onAssigned();
            load();
        } catch (err) {
            setToast({ type: 'error', message: retestErrorMessage(err, 'The email could not be sent.') });
        } finally {
            setBusy(false);
        }
    };

    const copy = async (retest) => setToast((await copyText(retestLink(retest))) ? { message: 'Retest link copied.' } : { type: 'error', message: 'Copy failed.' });
    const canAssign = !!data?.eligible && selected.length > 0 && !busy;

    return (
        <div className="pw-admin fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Assign retest">
            <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-white dark:bg-[var(--pw-surface)] border border-slate-200 dark:border-slate-800 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.35)]">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
                    <h2 className="pw-section-title">Assign retest</h2>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer" aria-label="Close retest dialog"><X size={18} /></button>
                </div>

                <div className="p-5 sm:p-6 space-y-5">
                    {loading && !data && <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2 py-8" role="status"><Loader2 size={15} className="animate-spin" /> Loading candidate...</p>}
                    {error && <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm" role="alert">{error}</div>}

                    {data && (
                        <>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Candidate</dt><dd className="font-semibold text-slate-900 dark:text-white break-words">{data.candidate.name}</dd></div>
                                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Email</dt><dd className="text-slate-700 dark:text-slate-300 break-all">{data.candidate.email}</dd></div>
                                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Job role</dt><dd className="text-slate-700 dark:text-slate-300 break-words">{data.job_role.title}</dd></div>
                                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Assessment status</dt><dd className="text-slate-700 dark:text-slate-300">{String(data.attempt_state).replace(/_/g, ' ')}</dd></div>
                            </dl>

                            {!data.eligible && <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-3 text-sm" role="status">{data.ineligible_reason}</div>}

                            <fieldset disabled={!data.eligible || busy} className="space-y-2">
                                <legend className="pw-card-title mb-2">Sections to retest</legend>
                                <div className="pw-scroll-x rounded-lg border border-slate-200 dark:border-slate-800">
                                    <table className="w-full text-sm min-w-[26rem]">
                                        <thead className="bg-slate-50 dark:bg-slate-950/50"><tr><th className={thCls}>Section</th><th className={`${thCls} text-right`}>Current score</th><th className={`${thCls} text-center`}>Select</th></tr></thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {data.sections.map((s) => {
                                                const open = s.active_retest;
                                                const id = `retest-section-${s.key}`;
                                                return (
                                                    <tr key={s.key}>
                                                        <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200"><label htmlFor={id}>{s.label}</label>{open && <span className="ml-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Retest {RETEST_STATUS[open.status]?.toLowerCase() || open.status.toLowerCase()}</span>}</td>
                                                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatScore(s.score)}</td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            <input id={id} type="checkbox" className="h-4 w-4 accent-[#5d8c2c] cursor-pointer disabled:cursor-not-allowed" checked={selected.includes(s.key)} disabled={!!open} onChange={() => toggle(s.key)} aria-label={`Retest ${s.label}`} />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Only the sections you select are repeated. The other scores, the registration and the original attempt stay exactly as they are; the overall score is recalculated once a retest has been evaluated.</p>
                            </fieldset>

                            <label className="block">
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Reason (optional)</span>
                                <textarea className={`${inputCls} mt-1`} rows={3} maxLength={1000} value={reason} disabled={!data.eligible || busy} onChange={(e) => setReason(e.target.value)} placeholder="For example: the code runner failed during the original sitting" aria-label="Retest reason" />
                            </label>

                            {assigned && (() => {
                                const sent = assigned.email?.status === 'SENT';
                                const links = assigned.retests.filter((r) => r.status === 'ASSIGNED' && (r.access_token || assigned.student_account));
                                return (
                                    <div className={`rounded-lg border p-4 space-y-3 ${sent ? 'border-[#5d8c2c]/40 bg-[#5d8c2c]/10 dark:border-emerald-500/40 dark:bg-emerald-950/30' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'}`} role={sent ? 'status' : 'alert'}>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Retest assigned</p>
                                        {sent ? (
                                            <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="retest-email-status">Email sent to {assigned.email.to}. {assigned.student_account
                                                ? 'The candidate signs in with their existing student account from the link; they are not asked to register again.'
                                                : 'The link in it identifies the candidate: no registration or sign-in is needed.'} Sent means the mail server accepted the message.</p>
                                        ) : (
                                            <>
                                                <p className="text-sm text-amber-900 dark:text-amber-200" data-testid="retest-email-status">The retest is saved, but the email to {assigned.email?.to || 'the candidate'} was not sent{assigned.email?.error ? `: ${assigned.email.error}` : '.'} The candidate has not been notified yet.</p>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button type="button" className={primaryBtn} disabled={busy} onClick={() => resendEmail(assigned.retests[0].retest_uuid)}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry email</button>
                                                    <span className="text-xs text-slate-600 dark:text-slate-400">or hand the link over yourself:</span>
                                                </div>
                                                {links.map((r) => (
                                                    <div key={r.retest_uuid} className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-medium w-28">{r.label}</span>
                                                        <input readOnly value={retestLink(r)} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-xs flex-1 min-w-[12rem]`} aria-label={`Retest link for ${r.label}`} />
                                                        <button type="button" className={ghostBtnSm} onClick={() => copy(r)}><Copy size={14} /> Copy</button>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                );
                            })()}

                            {data.history.length > 0 && (
                                <div>
                                    <h3 className="pw-card-title mb-2">Retest history</h3>
                                    <ul className="space-y-2">
                                        {data.history.map((r) => (
                                            <li key={r.retest_uuid} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-[13px] flex flex-wrap items-center justify-between gap-2">
                                                <span><b>{r.label}</b> · {RETEST_STATUS[r.status] || r.status} · assigned {formatDate(r.assigned_at)}{['ASSIGNED', 'IN_PROGRESS'].includes(r.status) ? ` · valid until ${formatDate(r.expires_at)}` : ''}{r.status === 'COMPLETED' ? ` · ${formatScore(r.original_score)} → ${formatScore(r.retest_score)}` : ''}{r.email ? <span className={`ml-2 text-xs font-semibold ${r.email.status === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`} title={r.email.error || undefined}>{EMAIL_STATUS[r.email.status] || r.email.status}</span> : null}</span>
                                                <span className="flex gap-2">
                                                    {r.status === 'ASSIGNED' && r.email?.status === 'FAILED' && <button type="button" className={ghostBtnSm} disabled={busy} onClick={() => resendEmail(r.retest_uuid)}>Resend email</button>}
                                                    {r.status === 'EVALUATION_PENDING' && <button type="button" className={ghostBtnSm} disabled={busy} onClick={() => act(() => adminApi.retryRetestEvaluation(r.retest_uuid), 'Evaluation re-run.')}>Retry evaluation</button>}
                                                    {['ASSIGNED', 'IN_PROGRESS', 'EVALUATION_PENDING'].includes(r.status) && <button type="button" className={dangerGhostBtnSm} disabled={busy} onClick={() => act(() => adminApi.cancelRetest(r.retest_uuid), 'Retest cancelled.')}>Cancel retest</button>}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
                                <button type="button" className={primaryBtn} disabled={!canAssign} onClick={assign}>
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Assign Retest
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
};

export default RetestModal;
