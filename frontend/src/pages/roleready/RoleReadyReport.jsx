import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
    Award,
    CheckCircle2,
    AlertTriangle,
    ArrowRight,
    BrainCircuit,
    Code2,
    MessageSquare,
    TrendingUp,
    Printer,
    Sparkles,
    RefreshCw,
    LayoutDashboard,
    ChevronDown,
    ChevronUp,
    Lightbulb,
    Quote,
    Clock,
    ShieldCheck,
    ShieldAlert,
    Target,
    CalendarDays,
    Lock,
} from 'lucide-react';
import rolereadyApi from '../../services/rolereadyApi';
import { useAssessmentLock } from '../../context/AssessmentLockContext';
import FeedbackGateModal from '../../components/student-ui/FeedbackGateModal';
import { downloadReportPdf } from '../../utils/reportPdf';
import RoleReadyNavbar from '../../components/RoleReadyNavbar';
import { markStudentTaskCompleted } from '../../hooks/useStudentTaskStatus';
import { motion } from 'framer-motion';
import { Counter } from '../../components/home/primitives';
import {
    PrintStyles, Rv, AnimBar, ConfettiBurst, AnimatedGauge as CircularGauge,
    SectionNav, SummaryStrip, PlanTimeline,
} from '../../components/report-ui/ReportMotion';

const formatDuration = (seconds = 0) => {
    const m = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

const RoundMeta = ({ meta }) => {
    if (!meta) return null;
    const limit = meta.time_limit_minutes ? ` / ${meta.time_limit_minutes}m allowed` : "";
    const flagged = meta.violation_count > 0;
    return (
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold">
            <span className="px-2.5 py-1 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)] text-[var(--rr-text-2)] flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> {formatDuration(meta.time_spent_seconds)}{limit}
            </span>
            <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${flagged
                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"}`}>
                {flagged ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                {flagged ? `${meta.violation_count} proctoring flag${meta.violation_count > 1 ? "s" : ""}` : "No proctoring flags"}
            </span>
        </div>
    );
};

// A section score, or "Not attempted" when the attempt never reached that section (null is never shown as 0%).
const ScoreFigure = ({ value }) => (typeof value === 'number'
    ? <Counter to={Math.round(value)} suffix="%" />
    : <span className="text-slate-400 text-xl font-bold">Not attempted</span>);

const RoleReadyReport = () => {
    const { sessionUuid } = useParams();
    const { promptContactAdmin } = useAssessmentLock();
    const navigate = useNavigate();
    const [reportData, setReportData] = useState(null);

    // Feedback gate: downloading the report or opening the dashboard needs a written feedback (20+ words) first.
    const [feedbackDone, setFeedbackDone] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);      // 'download' | 'dashboard' while the popup is open
    useEffect(() => {
        let cancelled = false;
        rolereadyApi.getFeedbackStatus(sessionUuid)
            .then((status) => { if (!cancelled && status?.submitted) setFeedbackDone(true); })
            .catch(() => { /* unknown: the popup is shown and the server decides */ });
        return () => { cancelled = true; };
    }, [sessionUuid]);

    // The report is saved as a PDF file (no print dialog). If the PDF cannot be built, the browser's print / save-as-PDF dialog is the
    // fallback, so the student always gets their report.
    const downloadReport = useCallback(async () => {
        try {
            await downloadReportPdf(reportData);
        } catch (err) {
            console.error('Report PDF failed, falling back to print:', err);
            window.print();
        }
    }, [reportData]);

    const requireFeedback = async (action) => {
        if (!feedbackDone) { setPendingAction(action); return; }
        if (action === 'download') await downloadReport();
        else navigate('/student/dashboard');
    };
    // Submitting the feedback downloads the report automatically, then the student is taken to the dashboard.
    const submitFeedback = async (text) => {
        await rolereadyApi.submitFeedback(sessionUuid, text);
        setFeedbackDone(true);
        setPendingAction(null);
        await downloadReport();
        setTimeout(() => navigate('/student/dashboard'), 600);       // let the browser start the file download first
    };
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedQuestion, setExpandedQuestion] = useState(0);

    // The interview is scored in the background after submit, so the report may not be ready yet.
    // Poll until it is, then show it (no manual refresh needed).
    const reportStatus = reportData?.report_status;
    const isPending = reportStatus === "PROCESSING";
    const [waitedSeconds, setWaitedSeconds] = useState(0);
    const [isRetrying, setIsRetrying] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const fetchReport = async () => {
            try {
                const data = await rolereadyApi.getReport(sessionUuid);
                if (cancelled) return;
                setReportData(data);
                if (data.report_status === "READY" || data.report_status === undefined) markStudentTaskCompleted();
                setError(null);
            } catch (err) {
                if (cancelled) return;
                console.error("Failed to fetch report:", err);
                setError(err.response?.data?.detail || "Could not load report.");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchReport();
        return () => { cancelled = true; };
    }, [sessionUuid]);

    useEffect(() => {
        if (!isPending) return undefined;
        const poll = setInterval(async () => {
            try {
                setReportData(await rolereadyApi.getReport(sessionUuid));
            } catch (err) {
                console.error("Report poll failed:", err);
            }
        }, 2500);
        const tick = setInterval(() => setWaitedSeconds(w => w + 1), 1000);
        return () => { clearInterval(poll); clearInterval(tick); };
    }, [isPending, sessionUuid]);

    const handleRetryEvaluation = async () => {
        setIsRetrying(true);
        try {
            await rolereadyApi.retryInterviewEvaluation(sessionUuid);
            setWaitedSeconds(0);
            setReportData(await rolereadyApi.getReport(sessionUuid));
        } catch (err) {
            setError(err.response?.data?.detail || "Could not restart the evaluation.");
        } finally {
            setIsRetrying(false);
        }
    };

    if (isLoading) {
        return (
            <div className="rr-page flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-[var(--brand)] animate-spin" />
                <p className="rr-muted-text text-sm font-medium">Synthesizing Job-Readiness Dossier...</p>
            </div>
        );
    }

    if (reportData && (isPending || reportStatus === "FAILED")) {
        const failed = reportStatus === "FAILED";
        const steps = ["Interview submitted", "Scoring answers and communication", "Building your job-readiness dossier"];
        const activeStep = Math.min(steps.length - 1, 1 + Math.floor(waitedSeconds / 10));
        return (
            <div className="rr-page flex flex-col items-center justify-center p-6 text-center">
                <div className="rr-card p-5 sm:p-8 max-w-md w-full space-y-5">
                    {failed ? <AlertTriangle className="w-10 h-10 text-[var(--rr-warning)] mx-auto" /> : <RefreshCw className="w-10 h-10 text-[var(--brand)] animate-spin mx-auto" />}
                    <div>
                        <h2 className="text-lg font-bold text-[var(--rr-text)]">{failed ? "Evaluation did not finish" : "Preparing your report"}</h2>
                        <p className="text-sm text-[var(--rr-muted)] mt-1.5">
                            {failed
                                ? "Your answers are saved. Restart the evaluation to generate your report."
                                : "Your interview is being scored. This page updates automatically, so you can stay here."}
                        </p>
                    </div>
                    {!failed && (
                        <ul className="space-y-2 text-left text-sm">
                            {steps.map((label, i) => (
                                <li key={label} className={`flex items-center gap-2.5 ${i <= activeStep ? "text-[var(--rr-text)]" : "text-[var(--rr-muted)]"}`}>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i < activeStep ? "bg-emerald-500 text-white" : i === activeStep ? "bg-[var(--brand)] text-white animate-pulse" : "bg-[var(--rr-border)]"}`}>
                                        {i < activeStep ? "✓" : i + 1}
                                    </span>
                                    {label}
                                </li>
                            ))}
                        </ul>
                    )}
                    {failed && (
                        <button type="button" onClick={handleRetryEvaluation} disabled={isRetrying} className="rr-btn-primary w-full justify-center disabled:opacity-60">
                            {isRetrying ? "Restarting..." : "Retry evaluation"}
                        </button>
                    )}
                    <Link to="/student/dashboard" className="block text-xs font-semibold text-[var(--rr-muted)] hover:text-[var(--rr-text)]">Back to dashboard</Link>
                </div>
            </div>
        );
    }

    if (error || !reportData) {
        return (
            <div className="rr-page flex flex-col items-center justify-center p-6 text-center">
                <AlertTriangle className="w-12 h-12 text-[var(--rr-error)] mb-3" />
                <h2 className="text-lg font-bold text-[var(--rr-text)]">Dossier Unavailable</h2>
                <p className="text-sm mt-1 text-[var(--rr-muted)]">{error || "No report found."}</p>
                <Link to="/assessment/setup" className="mt-5 rr-btn-primary">
                    Assessment Setup
                </Link>
            </div>
        );
    }

    const {
        target_role,
        target_company,
        overall_readiness_score = null,
        aptitude_score = null,
        coding_score = null,
        interview_score = null,
        final_report = {},
        completed_at
    } = reportData;
    // An attempt that did not complete every section has NO overall score and no score for sections it never reached
    // (the server reports null; a missing section is never shown as a zero).
    const overallIncomplete = typeof overall_readiness_score !== 'number';
    const isTimedOut = reportData.current_state === 'TIMED_OUT';
    const legacyScoring = reportData.scoring_model === 'legacy_weighted_25_40_35';
    const pctOf = (v) => (typeof v === 'number' ? v : 0);

    const roundDetails = final_report.round_details || {};
    const matchScore = reportData.resume_to_jd_match_score ?? final_report.resume_to_jd_match_score;
    const skillGap = final_report.skill_gap_analysis || [];
    const recommendations = final_report.personalized_recommendations || [];
    const learningRoadmap = final_report.suggested_learning_roadmap || {};

    const readinessTier = final_report.readiness_tier || (overallIncomplete ? "Incomplete" : (overall_readiness_score >= 80 ? "Direct Role Ready" : "Foundation Strong"));
    const skillsVerified = final_report.skills_verified || ["Algorithms", "Problem Solving"];
    const areasToImprove = final_report.areas_for_improvement || ["Algorithmic Optimization", "Architecture Depth"];
    const interviewBreakdown = final_report.interview_breakdown || [];
    const interviewTechDepth = typeof final_report.interview_technical_depth_score === 'number' 
        ? final_report.interview_technical_depth_score 
        : pctOf(interview_score);
    const interviewComm = typeof final_report.interview_communication_score === 'number' 
        ? final_report.interview_communication_score 
        : pctOf(interview_score);

    const isDisqualified = !!final_report.is_disqualified;
    const isStrong = !isDisqualified && !overallIncomplete && overall_readiness_score >= 80;
    const needsSupport = isDisqualified || overallIncomplete || overall_readiness_score < 50;
    const strengthsCount = skillsVerified.length + skillGap.filter(g => g.status === "Demonstrated").length;
    const gapsCount = areasToImprove.length + skillGap.filter(g => g.status !== "Demonstrated").length;
    const nextStepsCount = recommendations.length + Object.keys(learningRoadmap).length;

    return (
        <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-emerald-100 selection:text-emerald-900 flex flex-col overflow-x-hidden">
            <PrintStyles />
            <RoleReadyNavbar title="Assessment Report" showDashboard={false} />
            <FeedbackGateModal
                open={!!pendingAction}
                onClose={() => setPendingAction(null)}
                onSubmit={submitFeedback}
                actionLabel={pendingAction === 'download' ? 'download your report' : 'open your dashboard'}
            />
            <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
                {/* Header Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[var(--rr-border)]">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--brand-light)] border border-[var(--brand-faint)] text-[var(--brand-dark)] text-xs font-semibold mb-2">
                            <Award className="w-3.5 h-3.5" />
                            <span>Verified Assessment Dossier</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--rr-text)] tracking-tight">
                            PrepWin Job-Readiness Report
                        </h1>
                        <p className="text-sm text-[var(--rr-text-2)] mt-1">
                            Role: <strong className="text-[var(--rr-text)]">{target_role}</strong> {target_company && `• Target: ${target_company}`}
                        </p>
                        {completed_at && (
                            <p className="text-xs text-[var(--rr-muted)] mt-1 flex items-center gap-1.5">
                                <CalendarDays className="w-3.5 h-3.5" />
                                Completed {new Date(completed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            id="report-export-pdf-btn"
                            type="button"
                            onClick={() => requireFeedback('download')}
                            className="rr-btn-secondary"
                        >
                            <Printer className="w-4 h-4" />
                            <span>Export PDF</span>
                        </button>
                        <button
                            type="button"
                            onClick={promptContactAdmin}
                            className="rr-btn-primary"
                        >
                            <Lock className="w-4 h-4" />
                            New Assessment
                        </button>
                    </div>
                </div>

                {/* Time-out banner: the 60-minute overall limit ended the attempt */}
                {isTimedOut && (
                    <Rv className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3 shadow-xs">
                        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                            <h3 className="font-bold text-sm">Assessment closed: the 60-minute time limit was reached</h3>
                            <p className="text-xs mt-1 leading-relaxed">Scores earned in the sections you completed are shown below. An overall score is only calculated when all three sections are complete, and sections you did not reach have no score.</p>
                        </div>
                    </Rv>
                )}

                {/* Malpractice Disqualification Banner */}
                {isDisqualified && (
                    <Rv className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3 shadow-xs">
                        <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                        <div>
                            <h3 className="font-bold text-sm text-red-900">Assessment Disqualified (Malpractice Violations Recorded)</h3>
                            <p className="text-xs text-red-700 mt-1 leading-relaxed">
                                {final_report.disqualification_note || final_report.termination_reason || "Maximum proctoring violations reached during this assessment. Scores have been forfeited."}
                            </p>
                        </div>
                    </Rv>
                )}

                <SectionNav />

                {/* Hero Readiness Overview Card */}
                <Rv id="sec-overview" className="scroll-mt-20 space-y-4">
                <div className={`rr-card relative overflow-hidden p-5 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5 sm:gap-8 border-l-4 ${needsSupport ? 'border-slate-400' : 'border-[var(--brand)]'}`}>
                    {isStrong && <ConfettiBurst />}
                    {!needsSupport && (
                        <div aria-hidden="true" className="pw-noprint pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full bg-emerald-400/10 blur-3xl animate-pw-blob" />
                    )}
                    <div className="relative space-y-4 max-w-xl min-w-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)] text-xs font-semibold">
                            <Sparkles className="w-3.5 h-3.5 text-[var(--brand)]" />
                            <span className="text-[var(--rr-text-2)]">Composite Readiness Tier:</span>
                            <span className="text-[var(--brand-dark)] font-bold">{readinessTier}</span>
                        </div>

                        <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--rr-text)] leading-tight">
                            Overall Job Readiness: <span className="text-[var(--brand)]">{overallIncomplete ? 'Incomplete' : <Counter to={Math.round(overall_readiness_score)} suffix="%" />}</span>
                        </h2>
                        {!overallIncomplete && (
                            <p className="text-[11px] text-[var(--rr-muted)]">
                                {legacyScoring
                                    ? 'This result was scored with the previous weighting (25% aptitude, 40% coding, 35% interview). New assessments weigh the three sections equally.'
                                    : 'Overall = (Aptitude + Coding + Interview) / 3: each section counts equally.'}
                            </p>
                        )}

                        <p className="text-sm text-[var(--rr-text-2)] leading-relaxed">
                            Based on your multi-round performance in role-specific aptitude, sandboxed coding challenges, and AI technical interview articulation against the verified target JD.
                        </p>
                        {isStrong && (
                            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                Great work. You are showing strong role readiness. Keep the momentum going.
                            </p>
                        )}
                        {needsSupport && (
                            <div className="rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)] p-3 text-sm text-[var(--rr-text-2)]">
                                <strong className="text-[var(--rr-text)]">What to do next:</strong> a report is a starting point, not a verdict. Review your gaps and follow the improvement plan below, then take a new assessment when you are ready.
                                <button type="button" onClick={() => document.getElementById('sec-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="pw-noprint ml-2 inline-flex items-center min-h-[40px] font-bold text-[var(--brand-dark)] underline underline-offset-2">
                                    Jump to the plan
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="relative flex items-center justify-center shrink-0">
                        {overallIncomplete
                            ? <div className="w-[140px] h-[140px] rounded-full border-[11px] border-[var(--rr-border)] flex items-center justify-center text-xs font-bold text-[var(--rr-muted)]">No overall score</div>
                            : <CircularGauge score={overall_readiness_score} size={140} strokeWidth={11} />}
                    </div>
                </div>
                <SummaryStrip strengths={strengthsCount} gaps={gapsCount} next={nextStepsCount} />
                </Rv>

                {/* 3-Round Assessment Score Breakdown */}
                <div id="sec-rounds" className="scroll-mt-20 grid grid-cols-1 sm:grid-cols-3 gap-5">
                    {/* 1. Aptitude */}
                    <Rv delay={0} className="h-full">
                    <div className="rr-card p-6 space-y-3 h-full hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--rr-muted)]">Round 1</span>
                            <div className="w-8 h-8 rounded-lg bg-[var(--brand-light)] border border-[var(--brand-faint)] flex items-center justify-center text-[var(--brand)]">
                                <BrainCircuit className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Aptitude & Reasoning</h3>
                            <div className="text-3xl font-extrabold text-[var(--rr-text)] mt-1"><ScoreFigure value={aptitude_score} /></div>
                        </div>
                        <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                            <AnimBar className="bg-[var(--brand)]" pct={Math.min(100, Math.max(typeof aptitude_score === 'number' ? 5 : 0, pctOf(aptitude_score)))} delay={0.3} />
                        </div>
                        <p className="text-[11px] text-[var(--rr-muted)]">Quantitative & logic score</p>
                    </div>
                    </Rv>

                    {/* 2. Coding */}
                    <Rv delay={0.12} className="h-full">
                    <div className="rr-card p-6 space-y-3 h-full hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--rr-muted)]">Round 2</span>
                            <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                <Code2 className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Practical Coding</h3>
                            <div className="text-3xl font-extrabold text-[var(--rr-text)] mt-1"><ScoreFigure value={coding_score} /></div>
                        </div>
                        <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                            <AnimBar className="bg-blue-500" pct={Math.min(100, Math.max(typeof coding_score === 'number' ? 5 : 0, pctOf(coding_score)))} delay={0.3} />
                        </div>
                        <p className="text-[11px] text-[var(--rr-muted)]">Hidden test suite execution</p>
                    </div>
                    </Rv>

                    {/* 3. Interview */}
                    <Rv delay={0.24} className="h-full">
                    <div className="rr-card p-6 space-y-3 h-full hover:-translate-y-1 hover:shadow-lg transition-[transform,box-shadow] duration-300">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--rr-muted)]">Round 3</span>
                            <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                <MessageSquare className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[var(--rr-text)]">AI Technical Interview</h3>
                            <div className="text-3xl font-extrabold text-[var(--rr-text)] mt-1"><ScoreFigure value={interview_score} /></div>
                        </div>
                        <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                            <AnimBar className="bg-amber-500" pct={Math.min(100, Math.max(typeof interview_score === 'number' ? 5 : 0, pctOf(interview_score)))} delay={0.3} />
                        </div>
                        <p className="text-[11px] text-[var(--rr-muted)]">Concept & communication depth</p>
                    </div>
                    </Rv>
                </div>

                {/* 5-Question AI Technical Interview Defense & Evidence */}
                {interviewBreakdown && interviewBreakdown.length > 0 && (
                    <div className="rr-card p-6 sm:p-7 space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--rr-border)]">
                            <div>
                                <div className="flex items-center gap-2">
                                    <MessageSquare className="w-5 h-5 text-amber-500" />
                                    <h3 className="text-lg font-bold text-[var(--rr-text)]">
                                        AI Technical Interview — 5-Question Defense & Evidence
                                    </h3>
                                </div>
                                <p className="text-xs text-[var(--rr-muted)] mt-1">
                                    Granular question-by-question evaluation assessing technical correctness, depth, STAR structure, and actionable improvements.
                                </p>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-semibold flex-wrap">
                                <div className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    Technical Depth: <strong className="font-bold">{Math.round(interviewTechDepth)}%</strong>
                                </div>
                                <div className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                    Communication: <strong className="font-bold">{Math.round(interviewComm)}%</strong>
                                </div>
                            </div>
                        </div>

                        {/* 5 Question Cards */}
                        <div className="space-y-3.5">
                            {interviewBreakdown.map((q, idx) => {
                                const isExpanded = expandedQuestion === idx;
                                const score = Math.round(q.score || 0);
                                const status = q.status || (score >= 80 ? 'correct' : score >= 50 ? 'partially_correct' : 'incomplete');

                                const statusBadge = {
                                    correct: { label: 'Verified / Strong', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
                                    partially_correct: { label: 'Partially Demonstrated', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
                                    incomplete: { label: 'Incomplete / Shallow', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800' },
                                    incorrect: { label: 'Needs Rework', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800' },
                                    unanswered: { label: 'Unanswered', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700' }
                                }[status] || { label: status, color: 'bg-slate-100 text-slate-700 border-slate-200' };

                                return (
                                    <div
                                        key={idx}
                                        className="rounded-xl border border-[var(--rr-border)] bg-[var(--rr-bg)] overflow-hidden transition-all duration-200"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setExpandedQuestion(isExpanded ? null : idx)}
                                            className="w-full text-left p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-[var(--rr-card)] transition-colors"
                                        >
                                            <div className="flex items-start sm:items-center gap-3 min-w-0">
                                                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
                                                    Q{idx + 1}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--rr-card)] border border-[var(--rr-border)] text-[var(--rr-muted)]">
                                                            {q.category || 'Technical Defense'}
                                                        </span>
                                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusBadge.color}`}>
                                                            {statusBadge.label}
                                                        </span>
                                                    </div>
                                                    <h4 className="text-sm font-bold text-[var(--rr-text)] truncate">
                                                        {q.question_text || `Question ${idx + 1}`}
                                                    </h4>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-right">
                                                    <span className={`text-base font-extrabold ${score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : score >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                        {score}%
                                                    </span>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronUp className="w-4 h-4 text-[var(--rr-muted)]" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4 text-[var(--rr-muted)]" />
                                                )}
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="px-4 sm:px-6 pb-6 pt-2 border-t border-[var(--rr-border)] space-y-4 bg-[var(--rr-card)]">
                                                {/* Full Question & Criteria */}
                                                <div>
                                                    <p className="text-xs font-semibold text-[var(--rr-text)] leading-relaxed">
                                                        {q.question_text}
                                                    </p>
                                                    {q.evaluation_criteria && (
                                                        <p className="text-[11px] text-[var(--rr-muted)] mt-1 italic">
                                                            Evaluation Criteria: {q.evaluation_criteria}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Candidate Evidence Quote */}
                                                {q.evidence && (
                                                    <div className="p-3 rounded-lg bg-[var(--rr-bg)] border-l-2 border-amber-500 text-xs text-[var(--rr-text-2)] flex items-start gap-2">
                                                        <Quote className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                                        <p className="italic">"{q.evidence}"</p>
                                                    </div>
                                                )}

                                                {/* Evaluator Analysis */}
                                                {q.explanation && (
                                                    <p className="text-xs text-[var(--rr-text-2)] leading-relaxed">
                                                        {q.explanation}
                                                    </p>
                                                )}

                                                {/* Strengths & Knowledge Gaps */}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                                    <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
                                                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            Demonstrated Strengths
                                                        </span>
                                                        <ul className="text-xs text-[var(--rr-text-2)] space-y-1 list-disc list-inside">
                                                            {(q.demonstrated_strengths || []).map((str, sIdx) => (
                                                                <li key={sIdx}>{str}</li>
                                                            ))}
                                                            {(!q.demonstrated_strengths || q.demonstrated_strengths.length === 0) && (
                                                                <li className="text-[var(--rr-muted)] italic list-none">None demonstrated</li>
                                                            )}
                                                        </ul>
                                                    </div>

                                                    <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-1.5">
                                                        <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                                            <AlertTriangle className="w-3.5 h-3.5" />
                                                            Identified Knowledge Gaps
                                                        </span>
                                                        <ul className="text-xs text-[var(--rr-text-2)] space-y-1 list-disc list-inside">
                                                            {(q.knowledge_gaps || []).map((gap, gIdx) => (
                                                                <li key={gIdx}>{gap}</li>
                                                            ))}
                                                            {(!q.knowledge_gaps || q.knowledge_gaps.length === 0) && (
                                                                <li className="text-[var(--rr-muted)] italic list-none">No critical gaps identified</li>
                                                            )}
                                                        </ul>
                                                    </div>
                                                </div>

                                                {/* Actionable Advice */}
                                                {q.actionable_advice && (
                                                    <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-[var(--rr-text-2)] flex items-start gap-2">
                                                        <Lightbulb className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                                                        <div>
                                                            <strong className="text-blue-600 dark:text-blue-400 font-semibold">Actionable Recommendation: </strong>
                                                            <span>{q.actionable_advice}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Round-by-round detail: aptitude & coding evidence */}
                {(roundDetails.aptitude || roundDetails.coding) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {roundDetails.aptitude && (
                            <div className="rr-card p-6 sm:p-7 space-y-4">
                                <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--rr-border)]">
                                    <BrainCircuit className="w-5 h-5 text-[var(--brand)]" />
                                    <h3 className="text-base font-bold text-[var(--rr-text)]">
                                        Aptitude — {roundDetails.aptitude.correct_count}/{roundDetails.aptitude.total_questions} correct
                                    </h3>
                                </div>
                                <RoundMeta meta={roundDetails.aptitude} />
                                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                                    {roundDetails.aptitude.questions.map((q, i) => (
                                        <details key={i} className="rounded-lg border border-[var(--rr-border)] bg-[var(--rr-bg)]">
                                            <summary className="cursor-pointer list-none p-3 flex items-start gap-2.5 text-xs">
                                                <span className={`mt-0.5 font-bold ${q.is_correct ? "text-emerald-600" : "text-rose-600"}`}>{q.is_correct ? "✓" : "✗"}</span>
                                                <span className="font-semibold text-[var(--rr-text)] leading-snug">Q{i + 1}. {q.question}</span>
                                            </summary>
                                            <div className="px-3 pb-3 text-xs text-[var(--rr-text-2)] space-y-1.5">
                                                <p>Your answer: <strong>{q.your_answer}</strong></p>
                                                {q.explanation && <p className="italic">{q.explanation}</p>}
                                            </div>
                                        </details>
                                    ))}
                                </div>
                            </div>
                        )}

                        {roundDetails.coding && (
                            <div className="rr-card p-6 sm:p-7 space-y-4">
                                <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--rr-border)]">
                                    <Code2 className="w-5 h-5 text-blue-500" />
                                    <h3 className="text-base font-bold text-[var(--rr-text)]">
                                        Coding — {roundDetails.coding.passed_hidden_tests}/{roundDetails.coding.total_hidden_tests} hidden tests passed
                                    </h3>
                                </div>
                                <RoundMeta meta={roundDetails.coding} />
                                <div className="space-y-2.5">
                                    {roundDetails.coding.problems.map((p, i) => (
                                        <div key={i} className="p-3.5 rounded-lg border border-[var(--rr-border)] bg-[var(--rr-bg)] space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-sm font-bold text-[var(--rr-text)] truncate">{p.title || `Problem ${i + 1}`}</span>
                                                <span className="text-sm font-extrabold text-[var(--rr-text)]">{Math.round(p.score || 0)}%</span>
                                            </div>
                                            <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                                                <div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.min(100, p.score || 0)}%` }} />
                                            </div>
                                            <p className="text-[11px] text-[var(--rr-muted)]">
                                                {p.passed_tests}/{p.total_tests} tests passed{p.language ? ` • ${p.language}` : ""}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Interview proctoring / time summary */}
                {roundDetails.interview && (
                    <div className="rr-card p-5 flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-sm font-bold text-[var(--rr-text)] flex items-center gap-2"><MessageSquare className="w-4 h-4 text-amber-500" /> AI Interview session</h3>
                        <RoundMeta meta={roundDetails.interview} />
                    </div>
                )}

                {/* Feedback summaries */}
                {(final_report.technical_feedback || final_report.communication_feedback) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {final_report.technical_feedback && (
                            <div className="rr-card p-6 space-y-2">
                                <h3 className="text-sm font-bold text-[var(--rr-text)] flex items-center gap-2"><Code2 className="w-4 h-4 text-blue-500" /> Technical Feedback</h3>
                                <p className="text-sm text-[var(--rr-text-2)] leading-relaxed">{final_report.technical_feedback}</p>
                            </div>
                        )}
                        {final_report.communication_feedback && (
                            <div className="rr-card p-6 space-y-2">
                                <h3 className="text-sm font-bold text-[var(--rr-text)] flex items-center gap-2"><MessageSquare className="w-4 h-4 text-amber-500" /> Communication Feedback</h3>
                                <p className="text-sm text-[var(--rr-text-2)] leading-relaxed">{final_report.communication_feedback}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Resume vs JD skill-gap analysis */}
                {skillGap.length > 0 && (
                    <Rv id="sec-skills" className="scroll-mt-20">
                    <div className="rr-card p-6 sm:p-7 space-y-4">
                        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--rr-border)] flex-wrap">
                            <div className="flex items-center gap-2.5">
                                <Target className="w-5 h-5 text-[var(--brand)]" />
                                <h3 className="text-base font-bold text-[var(--rr-text)]">Skill Gap vs Job Description</h3>
                            </div>
                            {typeof matchScore === "number" && (
                                <span className="px-3 py-1 rounded-lg bg-[var(--brand-light)] border border-[var(--brand-faint)] text-xs font-bold text-[var(--brand-dark)]">
                                    Resume ↔ JD match: {Math.round(matchScore)}%
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {skillGap.map((g, i) => (
                                <Rv key={i} delay={Math.min(i, 8) * 0.05} y={14}>
                                <div className={`h-full p-3 rounded-lg border text-xs flex items-start gap-2.5 hover:-translate-y-0.5 transition-transform ${g.status === "Demonstrated" ? "border-emerald-300/60 bg-emerald-500/5 dark:border-emerald-800" : "border-amber-300/60 bg-amber-500/5 dark:border-amber-800"}`}>
                                    {g.status === "Demonstrated"
                                        ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-label="Demonstrated" />
                                        : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-label="Gap" />}
                                    <div className="min-w-0 break-words">
                                        <p className="font-semibold text-[var(--rr-text)]">{g.skill} <span className="font-normal text-[var(--rr-muted)]">— {g.status}</span></p>
                                        <p className="text-[var(--rr-text-2)] mt-0.5">{g.evidence || g.recommendation}</p>
                                    </div>
                                </div>
                                </Rv>
                            ))}
                        </div>
                    </div>
                    </Rv>
                )}

                {/* Qualitative Skills Matrix & Areas for Improvement */}
                <div id={skillGap.length > 0 ? undefined : "sec-skills"} className="scroll-mt-20 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Verified Strengths */}
                    <div className="rr-card p-6 sm:p-7 space-y-4">
                        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--rr-border)]">
                            <CheckCircle2 className="w-5 h-5 text-[var(--rr-success)]" />
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Competencies Met & Verified</h3>
                        </div>
                        <div className="space-y-2.5">
                            {skillsVerified.map((s, idx) => (
                                <Rv key={idx} delay={Math.min(idx, 8) * 0.06} y={12}>
                                <div className="flex items-center gap-2.5 text-sm text-[var(--rr-text-2)] p-2.5 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)]">
                                    <CheckCircle2 className="w-4 h-4 shrink-0 text-[var(--rr-success)]" />
                                    <span className="min-w-0 break-words">{s}</span>
                                </div>
                                </Rv>
                            ))}
                        </div>
                    </div>

                    {/* Areas to Improve */}
                    <div className="rr-card p-6 sm:p-7 space-y-4">
                        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--rr-border)]">
                            <AlertTriangle className="w-5 h-5 text-[var(--rr-warning)]" />
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Targeted Remediation Areas</h3>
                        </div>
                        <div className="space-y-2.5">
                            {areasToImprove.map((a, idx) => (
                                <Rv key={idx} delay={Math.min(idx, 8) * 0.06} y={12}>
                                <div className="flex items-center gap-2.5 text-sm text-[var(--rr-text-2)] p-2.5 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)]">
                                    <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--rr-warning)]" />
                                    <span className="min-w-0 break-words">{a}</span>
                                </div>
                                </Rv>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Personalised next steps */}
                {(recommendations.length > 0 || Object.keys(learningRoadmap).length > 0) && (
                    <div id="sec-plan" className="scroll-mt-20 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {recommendations.length > 0 && (
                            <div className="rr-card p-6 sm:p-7 space-y-3">
                                <h3 className="text-base font-bold text-[var(--rr-text)] flex items-center gap-2"><Lightbulb className="w-5 h-5 text-blue-500" /> Recommendations</h3>
                                <ul className="space-y-2 text-sm text-[var(--rr-text-2)] list-disc list-inside">
                                    {recommendations.map((r, i) => <li key={i}>{r}</li>)}
                                </ul>
                            </div>
                        )}
                        {Object.keys(learningRoadmap).length > 0 && (
                            <div className="rr-card p-6 sm:p-7 space-y-3">
                                <h3 className="text-base font-bold text-[var(--rr-text)] flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-600" /> 4-Week Improvement Plan</h3>
                                <PlanTimeline entries={Object.entries(learningRoadmap)} />
                            </div>
                        )}
                    </div>
                )}

                {/* Footer Next Steps */}
                <Rv>
                <div className="relative overflow-hidden p-4 sm:p-6 bg-gradient-to-r from-emerald-500/10 via-[var(--rr-bg)] to-blue-500/10 bg-[length:200%_100%] animate-pw-shimmer motion-reduce:animate-none border border-[var(--rr-border)] rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                        <h4 className="text-sm font-bold text-[var(--rr-text)]">Ready to benchmark against another role?</h4>
                        <p className="text-xs text-[var(--rr-muted)] mt-0.5">Upload a different JD or refine your resume to take a new PrepWin assessment.</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                        <button
                            type="button"
                            id="report-view-dashboard-btn"
                            onClick={() => requireFeedback('dashboard')}
                            className="px-4 py-2 rounded-xl border border-[var(--rr-border)] bg-[var(--rr-card)] hover:bg-[var(--rr-input)] text-xs font-semibold text-[var(--rr-text)] flex items-center gap-2 transition-colors shadow-2xs cursor-pointer"
                        >
                            <LayoutDashboard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>View Performance Dashboard</span>
                        </button>
                        <button
                            type="button"
                            onClick={promptContactAdmin}
                            className="rr-btn-primary shrink-0 relative overflow-hidden group"
                        >
                            <span className="pw-noprint pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent -skew-x-12 group-hover:left-[150%] transition-[left] duration-700 motion-reduce:hidden" aria-hidden="true" />
                            <span className="relative">New Self-Assessment</span>
                            <Lock className="w-4 h-4 relative" />
                        </button>
                    </div>
                </div>
                </Rv>
            </div>
        </div>

    );
};

export default RoleReadyReport;
