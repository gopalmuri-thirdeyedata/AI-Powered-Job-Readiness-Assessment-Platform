import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Download, FileText, Loader2, RefreshCw, RotateCcw, ShieldAlert, UserCheck } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import { panelCls, primaryBtnCls } from '../../components/candidate/AssessmentBrief';
import { errorMessage, studentAssessmentApi } from '../../services/recruitmentApi';
import { useAuth } from '../../auth/useAuth';
import { downloadStudentReport } from '../../utils/studentReportPdf';
import { MIN_REVIEW_WORDS, countWords, reviewProblem } from '../../utils/wordCount';

export const DASHBOARD_PATH = '/student/dashboard';
export const REDIRECT_SECONDS = 8; // inside the required 5-10 second window

// One surface for every card on this page: 1px slate border, 16px radius, restrained shadow, theme-aware.
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs';
const primary = primaryBtnCls;
const ghost = 'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-sm px-4 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60';
const step = 'text-[11px] font-bold uppercase tracking-wide text-[#4c7324] dark:text-[#9fd05a]';
const greenIcon = 'inline-flex shrink-0 items-center justify-center rounded-full bg-[#5d8c2c]/10 text-[#4c7324] ring-1 ring-inset ring-[#5d8c2c]/25 dark:bg-[#5d8c2c]/20 dark:text-[#9fd05a] dark:ring-[#5d8c2c]/30';

/** Section retests an administrator assigned to this student: opened with the same sign-in, nothing to register again. */
const RetestsAssigned = ({ retests, onOpen }) => (!retests || retests.length === 0 ? null : (
    <section aria-label="Retests assigned to you" className="rounded-xl border border-[#5d8c2c]/30 bg-[#5d8c2c]/10 px-4 py-3 text-left space-y-2">
        <h2 className="text-sm font-extrabold">Retest assigned</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">The hiring team gave you another chance at the section{retests.length > 1 ? 's' : ''} below. Only that section is affected.</p>
        <ul className="space-y-2">
            {retests.map((r) => (
                <li key={r.retest_uuid} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{r.label}{r.job_title ? <span className="font-normal text-slate-500 dark:text-slate-400"> · {r.job_title}</span> : null}{r.expires_at ? <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">Valid until {new Date(r.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span> : null}</span>
                    <button type="button" className={primary} onClick={() => onOpen(r.retest_uuid)}><RotateCcw size={14} /> Start {r.label} retest</button>
                </li>
            ))}
        </ul>
    </section>
));

const Notice = ({ icon: Icon = ShieldAlert, title, children, action }) => (
    <CandidateShell>
        <div className={`${card} p-8 text-center`}>
            <Icon className="mx-auto text-slate-400 mb-3" size={36} />
            <h1 className="text-xl font-extrabold">{title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{children}</p>
            {action}
        </div>
    </CandidateShell>
);

/**
 * Completion page of an invited student: /assessment/join/:shareToken/complete
 *   1. confirms the submission,
 *   2. collects the mandatory exam review (at least 30 words; the server enforces it again),
 *   3. unlocks Download Report only once the SERVER says the review is saved (a reload keeps it unlocked, a browser trick cannot),
 *   4. after the download has been started, shows a countdown and then returns the student to their dashboard.
 * Nothing here recalculates a score: the report is whatever the server releases for this student's own attempt.
 *
 * Layout: a compact confirmation card, then the review (step 1) and the report (step 2) side by side from the lg breakpoint (stacked below
 * it), as two cards of one surface; the two action buttons sit on the same bottom line. The browser has already left fullscreen by now
 * (the assessment workspace releases it when the final submission is accepted), so nothing on this page touches fullscreen.
 */
const StudentAssessmentComplete = () => {
    const { shareToken } = useParams();
    const navigate = useNavigate();
    const { user, isLoaded, isSignedIn } = useAuth();
    const isStudent = isSignedIn && user?.role === 'STUDENT';

    const [data, setData] = useState(null);                 // { assessment, student, attempt }
    const [loadError, setLoadError] = useState(null);       // { status, message }
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [reviewError, setReviewError] = useState('');
    const [download, setDownload] = useState({ phase: 'idle', message: '' }); // idle | preparing | started | error
    const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

    const load = useCallback(async () => {
        try {
            const res = await studentAssessmentApi.result(shareToken);
            setData(res);
            setLoadError(null);
            return res;
        } catch (err) {
            setLoadError({ status: err?.response?.status, message: errorMessage(err, 'Unable to load your assessment result right now.') });
            return null;
        }
    }, [shareToken]);

    useEffect(() => { if (isStudent) load(); }, [isStudent, load]);

    // Countdown: starts once, only when the download has been started, and is cleaned up on unmount. Renders do not restart it.
    const started = download.phase === 'started';
    useEffect(() => {
        if (!started) return undefined;
        const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
        return () => clearInterval(id);
    }, [started]);
    useEffect(() => {
        if (started && secondsLeft <= 0) navigate(DASHBOARD_PATH, { replace: true });
    }, [started, secondsLeft, navigate]);

    if (!isLoaded) return <CandidateShell><div className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading...</div></CandidateShell>;
    if (!isSignedIn) return <Navigate to={`/assessment/join/${shareToken}`} replace />;
    if (!isStudent) {
        // Signed in, but not as a student (e.g. an administrator). The recovery is this assessment's own student sign-in: the join page keeps the
        // assessment context, explains the account mismatch and offers the sign-out. Nothing is signed out or bypassed from here.
        return (
            <CandidateShell>
                <section aria-labelledby="account-required-title" className={`${card} mx-auto mt-4 sm:mt-10 w-full max-w-xl p-6 sm:p-8 text-center`}>
                    <span className={`${greenIcon} mx-auto h-12 w-12`}><UserCheck size={24} aria-hidden="true" /></span>
                    <h1 id="account-required-title" className="mt-4 text-xl sm:text-2xl font-extrabold tracking-tight">Student account required</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">You must sign in with the student account associated with this assessment.</p>
                    <button type="button" className={`${primary} mt-6 w-full sm:w-auto sm:px-8`} onClick={() => navigate(`/assessment/join/${shareToken}`)}>Go to Student Login</button>
                </section>
            </CandidateShell>
        );
    }
    if (loadError) {
        return (
            <Notice title={loadError.status === 404 ? 'No assessment found' : 'Unable to load your result'}
                action={<div className="mt-4 flex justify-center gap-2">
                    {loadError.status !== 404 && <button type="button" className={primary} onClick={load}><RefreshCw size={14} /> Try again</button>}
                    <button type="button" className={ghost} onClick={() => navigate(DASHBOARD_PATH)}>Go to my dashboard</button>
                </div>}>
                {loadError.message}
            </Notice>
        );
    }
    if (!data) return <CandidateShell><div className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading your result...</div></CandidateShell>;

    const attempt = data.attempt;
    if (attempt.in_progress) {
        return <Notice title="Assessment in progress">Your assessment is still running in another window. You can write your review after you submit all three sections.</Notice>;
    }
    if (!attempt.submitted) {
        return (
            <Notice title="Assessment closed"
                action={<div className="mt-4 space-y-3">
                    <RetestsAssigned retests={data.retests} onOpen={(id) => navigate(`/assessment/retest/${id}`)} />
                    <button type="button" className={primary} onClick={() => navigate(DASHBOARD_PATH)}>Go to my dashboard</button>
                </div>}>
                This assessment ended before all sections were submitted, so there is no review or report to complete.
            </Notice>
        );
    }

    const words = countWords(text);
    const saved = attempt.review;                                    // the server is the source of truth
    const problem = reviewProblem(text);
    const canSubmit = !saved && !saving && !problem;
    const canDownload = !!saved && attempt.report_ready && download.phase !== 'preparing' && !started;
    const shownWords = saved ? saved.word_count : words;
    const progress = Math.min(100, Math.round((shownWords / MIN_REVIEW_WORDS) * 100));

    const submitReview = async () => {
        if (!canSubmit) return;
        setSaving(true);
        setReviewError('');
        try {
            const summary = await studentAssessmentApi.submitReview(attempt.session_uuid, text);
            setData((d) => ({ ...d, attempt: summary }));
        } catch (err) {
            if (err?.response?.status === 409) await load();         // e.g. already saved from another window: show the truth
            setReviewError(errorMessage(err, 'Your review could not be saved. Please try again.'));
        } finally {
            setSaving(false);
        }
    };

    const startDownload = async () => {
        if (!canDownload) return;
        setDownload({ phase: 'preparing', message: '' });
        try {
            const report = await studentAssessmentApi.getReport(attempt.session_uuid);
            await downloadStudentReport(report);                     // resolves once the browser has been handed the file
            setSecondsLeft(REDIRECT_SECONDS);
            setDownload({ phase: 'started', message: '' });
        } catch (err) {
            if (err?.response?.status === 403 || err?.response?.status === 409) load();   // the server's view changed: re-read it
            setDownload({ phase: 'error', message: errorMessage(err, 'Your report could not be prepared. Please try again.') });
        }
    };

    return (
        <CandidateShell maxWidth="max-w-5xl">
            <div className="space-y-4">
                <section aria-label="Submission confirmation" className={`${card} p-4 sm:p-5`}>
                    <div className="flex items-start gap-3.5">
                        <span className={`${greenIcon} h-11 w-11`}><CheckCircle2 size={22} /></span>
                        <div className="min-w-0">
                            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">Assessment submitted</h1>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 break-words">
                                Thank you{data.student?.name ? `, ${data.student.name}` : ''}. Your responses for <b>{data.assessment?.title}</b> have been received.
                            </p>
                        </div>
                    </div>
                    {!attempt.completed && (
                        <p className={`${panelCls} mt-3 px-3 py-2 text-[13px] leading-5 text-slate-700 dark:text-slate-300`} role="status">
                            {attempt.report_message || 'Your assessment is still being evaluated.'} You can write your review now.
                            <button type="button" onClick={load} className="ml-2 font-bold text-[#4c7324] dark:text-[#9fd05a] underline underline-offset-2">Refresh</button>
                        </p>
                    )}
                </section>

                <RetestsAssigned retests={data.retests} onOpen={(id) => navigate(`/assessment/retest/${id}`)} />

                <div className="grid gap-4 lg:grid-cols-5">
                    <section aria-label="Exam review" className={`${card} p-4 sm:p-5 lg:col-span-3 flex flex-col`}>
                        <p className={step}>Step 1</p>
                        <h2 className="text-lg font-extrabold leading-snug">Exam review</h2>
                        <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-400 mt-0.5">
                            Tell us about your experience of this exam. A review of at least {MIN_REVIEW_WORDS} words is required before you can download your report.
                        </p>
                        <textarea
                            value={saved ? saved.text : text} onChange={(e) => setText(e.target.value)}
                            readOnly={!!saved} rows={5} aria-label="Exam review" aria-describedby="review-counter review-help"
                            placeholder="How was the exam? Were the instructions clear? How did the sections feel?"
                            className="mt-3 w-full min-h-[120px] resize-y rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm leading-6 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c] read-only:bg-slate-50 dark:read-only:bg-slate-900"
                        />
                        <div aria-hidden="true" className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div className="h-full rounded-full bg-[#5d8c2c] transition-[width] duration-200" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1 text-sm">
                                <span id="review-counter" data-testid="word-counter" aria-live="polite"
                                    className={`block font-semibold ${shownWords >= MIN_REVIEW_WORDS ? 'text-[#4c7324] dark:text-[#9fd05a]' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {saved ? saved.word_count : words} / {MIN_REVIEW_WORDS} words
                                </span>
                                {!saved && words > 0 && problem && <span id="review-help" role="alert" className="block text-[13px] leading-5 text-slate-600 dark:text-slate-400">{problem}</span>}
                                {reviewError && <span role="alert" className="flex items-start gap-1.5 text-[13px] leading-5 text-red-700 dark:text-red-300"><AlertCircle size={14} className="mt-0.5 shrink-0" /> {reviewError}</span>}
                                {saved && (
                                    <span role="status" data-testid="review-saved" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#4c7324] dark:text-[#9fd05a]">
                                        <CheckCircle2 size={15} /> Your review has been saved. Thank you for your feedback.
                                    </span>
                                )}
                            </div>
                            {!saved && (
                                <button type="button" className={`${primary} w-full sm:w-auto sm:shrink-0`} disabled={!canSubmit} onClick={submitReview}>
                                    {saving && <Loader2 size={15} className="animate-spin" />} Submit Review
                                </button>
                            )}
                        </div>
                    </section>

                    <section aria-label="Assessment report" className={`${card} p-4 sm:p-5 lg:col-span-2 flex flex-col`}>
                        <p className={step}>Step 2</p>
                        <h2 className="text-lg font-extrabold leading-snug">Assessment report</h2>
                        <div className="mt-3 flex-1 space-y-3">
                            {!saved && (
                                <p className={`${panelCls} flex items-start gap-2.5 px-3 py-2.5 text-[13px] leading-5 text-slate-600 dark:text-slate-400`}>
                                    <FileText size={16} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
                                    <span>Submit your review to unlock your report. The review must be submitted before the report becomes available.</span>
                                </p>
                            )}
                            {saved && !attempt.report_ready && <p className={`${panelCls} px-3 py-2.5 text-[13px] leading-5 text-slate-600 dark:text-slate-400`}>{attempt.report_message || 'Your report is not ready yet.'}</p>}
                            {saved && attempt.report_ready && (
                                <p data-testid="report-ready" className="flex items-start gap-2.5 rounded-xl border border-[#5d8c2c]/30 bg-[#5d8c2c]/10 px-3 py-2.5 text-[13px] leading-5 font-semibold text-[#3f6320] dark:text-[#9fd05a]">
                                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> Your report is ready to download.
                                </p>
                            )}
                            {download.phase === 'error' && <p role="alert" data-testid="download-error" className="flex items-start gap-2 text-[13px] leading-5 text-red-700 dark:text-red-300"><AlertCircle size={15} className="mt-0.5 shrink-0" /> {download.message}</p>}
                            {started && (
                                <div role="status" data-testid="download-started" className="rounded-xl border border-[#5d8c2c]/30 bg-[#5d8c2c]/10 px-3 py-2.5 text-[13px] leading-5">
                                    <p className="font-semibold text-[#3f6320] dark:text-[#9fd05a]">Your report download has started.</p>
                                    <p className="mt-1 text-slate-700 dark:text-slate-300">Taking you to your dashboard in <b data-testid="redirect-countdown">{Math.max(secondsLeft, 0)}</b> seconds.</p>
                                    <button type="button" className={`${ghost} mt-2`} onClick={() => navigate(DASHBOARD_PATH, { replace: true })}>Go to dashboard now</button>
                                </div>
                            )}
                        </div>
                        <button type="button" className={`${primary} mt-4 w-full`} disabled={!canDownload} onClick={startDownload}>
                            {download.phase === 'preparing' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                            {download.phase === 'preparing' ? 'Preparing report...' : download.phase === 'error' ? 'Try download again' : 'Download Report'}
                        </button>
                    </section>
                </div>
            </div>
        </CandidateShell>
    );
};

export default StudentAssessmentComplete;
