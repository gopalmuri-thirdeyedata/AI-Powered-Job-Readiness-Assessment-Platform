import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import { errorMessage, studentAssessmentApi } from '../../services/recruitmentApi';
import { useAuth } from '../../auth/useAuth';
import { downloadStudentReport } from '../../utils/studentReportPdf';
import { MIN_REVIEW_WORDS, countWords, reviewProblem } from '../../utils/wordCount';

export const DASHBOARD_PATH = '/student/dashboard';
export const REDIRECT_SECONDS = 8; // inside the required 5-10 second window

const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-6 py-2.5 transition-colors';
const ghost = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-sm px-4 py-2.5 transition-colors';

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
        return <Notice title="Student account required">This page belongs to student accounts. Sign in with the student account that took the assessment.</Notice>;
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
                action={<button type="button" className={`${primary} mt-4`} onClick={() => navigate(DASHBOARD_PATH)}>Go to my dashboard</button>}>
                This assessment ended before all sections were submitted, so there is no review or report to complete.
            </Notice>
        );
    }

    const words = countWords(text);
    const saved = attempt.review;                                    // the server is the source of truth
    const problem = reviewProblem(text);
    const canSubmit = !saved && !saving && !problem;
    const canDownload = !!saved && attempt.report_ready && download.phase !== 'preparing' && !started;

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
        <CandidateShell>
            <div className={`${card} p-6 sm:p-8 space-y-6`}>
                <div className="text-center">
                    <CheckCircle2 className="mx-auto text-[#5d8c2c] mb-3" size={44} />
                    <h1 className="text-2xl font-extrabold tracking-tight">Assessment submitted</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                        Thank you{data.student?.name ? `, ${data.student.name}` : ''}. Your responses for <b>{data.assessment?.title}</b> have been received.
                    </p>
                    {!attempt.completed && (
                        <p className="mt-3 text-sm rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2" role="status">
                            {attempt.report_message || 'Your assessment is still being evaluated.'} You can write your review now.
                            <button type="button" onClick={load} className="ml-2 font-bold underline">Refresh</button>
                        </p>
                    )}
                </div>

                <section aria-label="Exam review" className="space-y-2">
                    <h2 className="text-lg font-extrabold">Exam review</h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Tell us about your experience of this exam. A review of at least {MIN_REVIEW_WORDS} words is required before you can download your report.
                    </p>
                    <textarea
                        value={saved ? saved.text : text} onChange={(e) => setText(e.target.value)}
                        readOnly={!!saved} rows={7} aria-label="Exam review" aria-describedby="review-counter review-help"
                        placeholder="How was the exam? Were the instructions clear? How did the sections feel?"
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c] read-only:bg-slate-50 dark:read-only:bg-slate-900"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span id="review-counter" data-testid="word-counter" aria-live="polite"
                            className={`font-semibold ${(saved ? saved.word_count : words) >= MIN_REVIEW_WORDS ? 'text-[#4c7324] dark:text-[#9fd05a]' : 'text-slate-500 dark:text-slate-400'}`}>
                            {saved ? saved.word_count : words} / {MIN_REVIEW_WORDS} words
                        </span>
                        {!saved && words > 0 && problem && <span id="review-help" role="alert" className="text-amber-700 dark:text-amber-300">{problem}</span>}
                    </div>
                    {reviewError && <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300"><AlertCircle size={15} className="mt-0.5 shrink-0" /> {reviewError}</p>}
                    {saved && (
                        <p role="status" data-testid="review-saved" className="flex items-center gap-2 text-sm font-semibold text-[#4c7324] dark:text-[#9fd05a]">
                            <CheckCircle2 size={15} /> Your review has been saved. Thank you for your feedback.
                        </p>
                    )}
                    {!saved && (
                        <button type="button" className={primary} disabled={!canSubmit} onClick={submitReview}>
                            {saving && <Loader2 size={15} className="animate-spin" />} Submit Review
                        </button>
                    )}
                </section>

                <section aria-label="Assessment report" className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-5">
                    <h2 className="text-lg font-extrabold">Assessment report</h2>
                    {!saved && <p className="text-sm text-slate-500 dark:text-slate-400">Submit your review to unlock your report.</p>}
                    {saved && !attempt.report_ready && <p className="text-sm text-slate-500 dark:text-slate-400">{attempt.report_message || 'Your report is not ready yet.'}</p>}
                    <button type="button" className={primary} disabled={!canDownload} onClick={startDownload}>
                        {download.phase === 'preparing' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        {download.phase === 'preparing' ? 'Preparing report...' : download.phase === 'error' ? 'Try download again' : 'Download Report'}
                    </button>
                    {download.phase === 'error' && <p role="alert" data-testid="download-error" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300"><AlertCircle size={15} className="mt-0.5 shrink-0" /> {download.message}</p>}
                    {started && (
                        <div role="status" data-testid="download-started" className="rounded-xl border border-[#5d8c2c]/30 bg-[#5d8c2c]/10 px-4 py-3 text-sm">
                            <p className="font-semibold text-[#3f6320] dark:text-[#9fd05a]">Your report download has started.</p>
                            <p className="mt-1 text-slate-700 dark:text-slate-300">Taking you to your dashboard in <b data-testid="redirect-countdown">{Math.max(secondsLeft, 0)}</b> seconds.</p>
                            <button type="button" className={`${ghost} mt-2`} onClick={() => navigate(DASHBOARD_PATH, { replace: true })}>Go to dashboard now</button>
                        </div>
                    )}
                </section>
            </div>
        </CandidateShell>
    );
};

export default StudentAssessmentComplete;
