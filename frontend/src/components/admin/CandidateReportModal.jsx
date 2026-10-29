import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Loader2, Printer, RefreshCw, RotateCcw, ShieldCheck, ThumbsDown, Trash2, X } from 'lucide-react';
import ConfirmationModal from '../ConfirmationModal';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { StatusBadge, Toast, copyText, dangerGhostBtn, formatDate, formatDuration, formatScore, ghostBtn, ghostBtnSm, inputCls, primaryBtn, thCls } from './adminUi';

const SECTION_LABELS = { aptitude: 'Aptitude', coding: 'Coding', interview: 'AI Technical Interview' };

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .pw-print-root, .pw-print-root * { visibility: visible !important; }
  .pw-print-root { position: absolute !important; left: 0; top: 0; width: 100%; max-height: none !important; overflow: visible !important; box-shadow: none !important; }
  .pw-no-print { display: none !important; }
}`;

const Score = ({ label, value, big }) => (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className={`${big ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums text-slate-900 dark:text-white mt-1`}>{formatScore(value)}</p>
    </div>
);

const CandidateReportModal = ({ candidateId, onClose, onChanged }) => {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [toast, setToast] = useState(null);
    const [confirm, setConfirm] = useState(null); // 'revoke'
    const [justify, setJustify] = useState(null); // { kind: 'retake' | 'reject' }
    const [justification, setJustification] = useState('');
    const [retakeLink, setRetakeLink] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminApi.dossier(candidateId));
        } catch (err) {
            setError(errorMessage(err, 'Unable to load this candidate.'));
        } finally {
            setLoading(false);
        }
    }, [candidateId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !confirm && !justify) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, confirm, justify]);

    const act = async (name, fn, okMessage) => {
        setBusy(name);
        try {
            const res = await fn();
            setToast({ message: okMessage });
            if (onChanged) onChanged();
            return res;
        } catch (err) {
            setToast({ type: 'error', message: errorMessage(err, 'The action failed.') });
            return null;
        } finally {
            setBusy('');
        }
    };

    const doRevoke = async () => {
        setConfirm(null);
        const res = await act('revoke', () => adminApi.revokeRegistration(candidateId), 'Registration reset. The candidate can register again.');
        if (res) onClose();
    };

    const doJustified = async () => {
        const kind = justify.kind;
        const text = justification.trim();
        if (text.length < 10) return setToast({ type: 'error', message: 'Enter a justification of at least 10 characters (it is recorded in the audit log).' });
        setJustify(null);
        setJustification('');
        if (kind === 'retake') {
            const res = await act('retake', () => adminApi.authorizeRetake(candidateId, text), 'Retake authorized and recorded in the audit log.');
            if (res) {
                const link = res.share_token ? `${window.location.origin}/assessment/join/${res.share_token}?registration_token=${encodeURIComponent(res.registration_token)}` : '';
                setRetakeLink(link);
                load();
            }
        } else {
            const res = await act('reject', () => adminApi.rejectReview(candidateId, text), 'Review closed without a retake.');
            if (res) load();
        }
    };

    const doRetry = async () => {
        const res = await act('retry', () => adminApi.retryEvaluation(candidateId), 'Evaluation re-run.');
        if (res) load();
    };

    const exportJson = () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `candidate-${candidateId}-dossier.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const report = data?.report;
    const sections = report?.sections || {};

    return (
        <div className="pw-admin fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Candidate dossier">
            <style>{PRINT_CSS}</style>
            <div className="pw-print-root w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-xl bg-white dark:bg-[var(--pw-surface)] border border-slate-200 dark:border-slate-800 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.35)]">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
                    <h2 className="pw-section-title">Candidate Dossier</h2>
                    <div className="pw-no-print flex items-center gap-2">
                        {data && <button type="button" className={ghostBtnSm} onClick={() => window.print()}><Printer size={14} /> Print</button>}
                        {data && <button type="button" className={ghostBtnSm} onClick={exportJson}><Download size={14} /> Export</button>}
                        <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer" aria-label="Close dossier"><X size={18} /></button>
                    </div>
                </div>

                <div className="p-5 sm:p-6 space-y-6">
                    {loading && <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2 py-8" role="status"><Loader2 size={15} className="animate-spin" /> Loading dossier...</p>}
                    {error && <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm" role="alert">{error}</div>}

                    {data && (
                        <>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white break-words">{data.candidate.name}</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 break-words">{data.candidate.email} · {data.candidate.phone}</p>
                                    <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400 mt-1">{data.job_role?.title} · Registered {formatDate(data.candidate.registered_at)} · Contact details are self-reported and unverified</p>
                                </div>
                                <StatusBadge status={data.status} />
                            </div>

                            {report ? (
                                <>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <Score label="Aptitude" value={sections.aptitude?.score} />
                                        <Score label="Coding" value={sections.coding?.score} />
                                        <Score label="Interview" value={sections.interview?.score} />
                                        <div className="rounded-lg border border-[#5d8c2c]/40 bg-[#5d8c2c]/10 dark:border-emerald-500/40 dark:bg-emerald-950/30 p-3.5">
                                            <p className="text-xs font-medium text-[#4c7324] dark:text-[#9fd05a]">Overall (equal weight)</p>
                                            <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white mt-1">{report.overall_score === null ? 'INCOMPLETE' : formatScore(report.overall_score)}</p>
                                        </div>
                                    </div>
                                    {report.overall_score === null && <p className="text-xs text-slate-500 dark:text-slate-400">Overall is shown only when all three sections were completed. Earned section scores are preserved; unattempted sections have no score.</p>}

                                    <div>
                                        <h4 className="pw-card-title mb-3">Timeline</h4>
                                        <div className="pw-scroll-x rounded-lg border border-slate-200 dark:border-slate-800">
                                            <table className="w-full text-sm min-w-[36rem]">
                                                <thead className="bg-slate-50 dark:bg-slate-950/50"><tr><th className={thCls}>Section</th><th className={thCls}>Status</th><th className={thCls}>Started</th><th className={thCls}>Submitted</th><th className={thCls}>Time spent</th></tr></thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {(data.timeline || []).map((t) => (
                                                        <tr key={t.section}><td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{SECTION_LABELS[t.section]}</td><td className="px-4 py-2.5"><StatusBadge status={t.status === 'EVALUATED' ? 'COMPLETED' : t.status === 'UNATTEMPTED' ? 'REGISTERED' : t.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : t.status} /></td><td className="px-4 py-2.5 text-[13px] text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(t.started_at)}</td><td className="px-4 py-2.5 text-[13px] text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(t.submitted_at)}</td><td className="px-4 py-2.5 text-[13px] text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDuration(t.time_spent_seconds)}</td></tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {data.session && <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400 mt-3">Sitting started {formatDate(data.session.started_at)}{data.session.finalized_at ? ` · ended ${formatDate(data.session.finalized_at)}` : ''}{data.session.rules_acknowledged_at ? ` · rules acknowledged ${formatDate(data.session.rules_acknowledged_at)}` : ''}{data.session.incident_reference_id ? ` · incident ${data.session.incident_reference_id}` : ''}</p>}
                                    </div>

                                    {(() => {
                                        const flagged = ['aptitude', 'coding', 'interview'].filter((k) => (sections[k]?.proctoring?.count || 0) > 0);
                                        const total = flagged.reduce((n, k) => n + sections[k].proctoring.count, 0);
                                        return (
                                            <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-4 py-3.5">
                                                <summary className="cursor-pointer select-none font-semibold text-sm text-slate-900 dark:text-white rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50">Proctoring — {total === 0 ? 'no integrity events recorded' : `${total} integrity event${total === 1 ? '' : 's'} recorded`}</summary>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Events are reported by the candidate&apos;s browser (fullscreen exit, tab or window switch, camera checks). They are evidence for your review, not an automatic verdict.</p>
                                                {flagged.map((k) => (
                                                    <div key={k} className="mt-2">
                                                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{SECTION_LABELS[k]}</p>
                                                        <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-400">
                                                            {sections[k].proctoring.events.map((e, i) => <li key={i}>{e.type}{e.timestamp ? ` · ${formatDate(e.timestamp)}` : ''}</li>)}
                                                        </ul>
                                                    </div>
                                                ))}
                                            </details>
                                        );
                                    })()}

                                    {sections.aptitude?.details?.questions && (
                                        <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-4 py-3.5">
                                            <summary className="cursor-pointer select-none font-semibold text-sm text-slate-900 dark:text-white rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50">Aptitude review — {sections.aptitude.details.correct}/{sections.aptitude.details.total} correct</summary>
                                            <ol className="list-decimal pl-5 mt-3 space-y-2 text-sm">
                                                {sections.aptitude.details.questions.map((q) => (
                                                    <li key={q.id}><span className="font-semibold">{q.question}</span>
                                                        <p className={`text-xs ${q.is_correct ? 'text-[#4c7324] dark:text-[#9fd05a]' : 'text-red-600 dark:text-red-400'}`}>Selected: {q.selected || '—'} · Correct: {q.correct_key} {q.is_correct ? '✓' : '✗'}</p></li>
                                                ))}
                                            </ol>
                                        </details>
                                    )}
                                    {sections.coding?.details?.problems && (
                                        <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-4 py-3.5">
                                            <summary className="cursor-pointer select-none font-semibold text-sm text-slate-900 dark:text-white rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50">Coding review</summary>
                                            <div className="mt-3 space-y-3 text-sm">
                                                {sections.coding.details.problems.map((p) => (
                                                    <div key={p.id}>
                                                        <p className="font-semibold">{p.title}{p.score !== undefined && p.score !== null ? ` — ${p.score}%` : ''}{p.language ? <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{p.language === 'java' ? 'Java' : 'Python'}</span> : null}</p>
                                                        {p.total_tests !== undefined && <p className="text-xs text-slate-500 dark:text-slate-400">Tests passed {p.passed_tests}/{p.total_tests}{p.tests ? ' (examples + hidden)' : ''} · {String(p.classification || '').replace(/_/g, ' ').toLowerCase()}</p>}
                                                        {p.message && <p className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">{p.message}</p>}
                                                        {p.code && <pre className="mt-1 rounded-lg bg-slate-100 dark:bg-slate-950 p-2 text-xs overflow-x-auto whitespace-pre-wrap">{p.code}</pre>}
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    )}
                                    {sections.interview?.details?.questions && (
                                        <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 px-4 py-3.5">
                                            <summary className="cursor-pointer select-none font-semibold text-sm text-slate-900 dark:text-white rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50">Interview responses</summary>
                                            <div className="mt-3 space-y-3 text-sm">
                                                {sections.interview.details.summary && <p className="text-xs text-slate-600 dark:text-slate-400">{sections.interview.details.summary}</p>}
                                                {sections.interview.details.questions.map((q) => (
                                                    <div key={q.id}>
                                                        <p className="font-semibold">{q.question_text} {q.score !== undefined && <span className="text-xs text-slate-500 dark:text-slate-400">· {q.score}%</span>}</p>
                                                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{q.response || <em className="text-slate-400">No answer</em>}</p>
                                                        {q.explanation && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{q.explanation}</p>}
                                                    </div>
                                                ))}
                                                {(sections.interview.details.transcript || []).length > 0 && (
                                                    <details>
                                                        <summary className="cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-300">Voice interview transcript ({sections.interview.details.transcript.length} turns)</summary>
                                                        <ul className="mt-2 space-y-1 text-xs">
                                                            {sections.interview.details.transcript.map((t, i) => (
                                                                <li key={i} className={t.role === 'ai' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}><b>{t.role === 'ai' ? 'Interviewer' : 'Candidate'}:</b> {t.text}</li>
                                                            ))}
                                                        </ul>
                                                    </details>
                                                )}
                                            </div>
                                        </details>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-slate-600 dark:text-slate-400">This candidate has registered but has not started the assessment.</p>
                            )}

                            {retakeLink && (
                                <div className="rounded-lg border border-[#5d8c2c]/40 bg-[#5d8c2c]/10 dark:border-emerald-500/40 dark:bg-emerald-950/30 p-4 space-y-3">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Single-use retake link (shown once — send it to the candidate)</p>
                                    <input readOnly value={retakeLink} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-xs`} aria-label="Retake link" />
                                    <button type="button" className={primaryBtn} onClick={async () => setToast((await copyText(retakeLink)) ? { message: 'Retake link copied.' } : { type: 'error', message: 'Copy failed.' })}><Copy size={14} /> Copy link</button>
                                </div>
                            )}

                            <div className="pw-no-print flex flex-wrap gap-2 pt-5 border-t border-slate-100 dark:border-slate-800">
                                {data.actions.can_revoke && <button type="button" className={dangerGhostBtn} disabled={!!busy} onClick={() => setConfirm('revoke')}><Trash2 size={14} /> Reset registration</button>}
                                {data.actions.can_authorize_retake && <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => setJustify({ kind: 'retake' })}><ShieldCheck size={14} /> Authorize outage retake</button>}
                                {data.actions.can_reject_review && <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => setJustify({ kind: 'reject' })}><ThumbsDown size={14} /> Reject review (no retake)</button>}
                                {data.actions.can_retry_evaluation && <button type="button" className={ghostBtn} disabled={!!busy} onClick={doRetry}>{busy === 'retry' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry evaluation</button>}
                                <button type="button" className={ghostBtn} onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <ConfirmationModal
                isOpen={confirm === 'revoke'} onClose={() => setConfirm(null)} onConfirm={doRevoke} type="danger" confirmText="Reset registration"
                title="Reset this registration?"
                message="Use this only when the candidate asked for it and you verified their identity. The stale registration is removed so they can register again."
            />

            {justify && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl bg-white dark:bg-[var(--pw-surface)] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.35)]">
                        <h3 className="pw-section-title">{justify.kind === 'retake' ? 'Authorize outage retake' : 'Reject review'}</h3>
                        <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{justify.kind === 'retake'
                            ? 'The current attempt is archived and the candidate receives a fresh single-use link. This is recorded in the audit log.'
                            : 'The attempt is closed as abandoned with no retake. This is recorded in the audit log.'}</p>
                        <textarea className={inputCls} rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Justification (required, min 10 characters)" aria-label="Justification" />
                        <div className="flex justify-end gap-2">
                            <button type="button" className={ghostBtn} onClick={() => { setJustify(null); setJustification(''); }}>Cancel</button>
                            <button type="button" className={primaryBtn} onClick={doJustified}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}
            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
};

export default CandidateReportModal;
