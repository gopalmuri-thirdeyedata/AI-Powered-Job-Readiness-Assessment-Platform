import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
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
} from 'lucide-react';
import rolereadyApi from '../../services/rolereadyApi';
import RoleReadyNavbar from '../../components/RoleReadyNavbar';
import { markStudentTaskCompleted } from '../../hooks/useStudentTaskStatus';

const CircularGauge = ({ score = 0, size = 130, strokeWidth = 10 }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const validScore = Math.min(100, Math.max(0, Math.round(score)));
    const strokeDashoffset = circumference - (validScore / 100) * circumference;

    let strokeColor = '#10B981';
    if (validScore < 50) strokeColor = '#F43F5E';
    else if (validScore < 75) strokeColor = '#F59E0B';

    return (
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none">
                    {validScore}%
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400 mt-1">
                    Job Fit
                </span>
            </div>
        </div>
    );
};

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

const RoleReadyReport = () => {
    const { sessionUuid } = useParams();
    const [reportData, setReportData] = useState(null);
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
                <div className="rr-card p-8 max-w-md w-full space-y-5">
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
        overall_readiness_score = 0,
        aptitude_score = 0,
        coding_score = 0,
        interview_score = 0,
        final_report = {},
        completed_at
    } = reportData;
    const roundDetails = final_report.round_details || {};
    const matchScore = reportData.resume_to_jd_match_score ?? final_report.resume_to_jd_match_score;
    const skillGap = final_report.skill_gap_analysis || [];
    const recommendations = final_report.personalized_recommendations || [];
    const learningRoadmap = final_report.suggested_learning_roadmap || {};

    const readinessTier = final_report.readiness_tier || (overall_readiness_score >= 80 ? "Direct Role Ready" : "Foundation Strong");
    const skillsVerified = final_report.skills_verified || ["Algorithms", "Problem Solving"];
    const areasToImprove = final_report.areas_for_improvement || ["Algorithmic Optimization", "Architecture Depth"];
    const interviewBreakdown = final_report.interview_breakdown || [];
    const interviewTechDepth = typeof final_report.interview_technical_depth_score === 'number' 
        ? final_report.interview_technical_depth_score 
        : interview_score;
    const interviewComm = typeof final_report.interview_communication_score === 'number' 
        ? final_report.interview_communication_score 
        : interview_score;

    return (
        <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-emerald-100 selection:text-emerald-900 flex flex-col">
            <RoleReadyNavbar title="Assessment Report" />
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

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => window.print()}
                            className="rr-btn-secondary"
                        >
                            <Printer className="w-4 h-4" />
                            <span>Export PDF</span>
                        </button>
                        <Link
                            to="/assessment/setup"
                            className="rr-btn-primary"
                        >
                            New Assessment
                        </Link>
                    </div>
                </div>

                {/* Malpractice Disqualification Banner */}
                {final_report.is_disqualified && (
                    <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3 shadow-xs">
                        <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                        <div>
                            <h3 className="font-bold text-sm text-red-900">Assessment Disqualified (Malpractice Violations Recorded)</h3>
                            <p className="text-xs text-red-700 mt-1 leading-relaxed">
                                {final_report.disqualification_note || final_report.termination_reason || "Maximum proctoring violations reached during this assessment. Scores have been forfeited."}
                            </p>
                        </div>
                    </div>
                )}

                {/* Hero Readiness Overview Card */}
                <div className="rr-card p-8 flex flex-col md:flex-row md:items-center justify-between gap-8 border-l-4 border-[var(--brand)]">
                    <div className="space-y-4 max-w-xl">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)] text-xs font-semibold">
                            <Sparkles className="w-3.5 h-3.5 text-[var(--brand)]" />
                            <span className="text-[var(--rr-text-2)]">Composite Readiness Tier:</span>
                            <span className="text-[var(--brand-dark)] font-bold">{readinessTier}</span>
                        </div>

                        <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--rr-text)] leading-tight">
                            Overall Job Readiness: <span className="text-[var(--brand)]">{Math.round(overall_readiness_score)}%</span>
                        </h2>

                        <p className="text-sm text-[var(--rr-text-2)] leading-relaxed">
                            Based on your multi-round performance in role-specific aptitude, sandboxed coding challenges, and AI technical interview articulation against the verified target JD.
                        </p>
                    </div>

                    <div className="flex items-center justify-center shrink-0">
                        <CircularGauge score={overall_readiness_score} size={140} strokeWidth={11} />
                    </div>
                </div>

                {/* 3-Round Assessment Score Breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    {/* 1. Aptitude */}
                    <div className="rr-card p-6 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--rr-muted)]">Round 1</span>
                            <div className="w-8 h-8 rounded-lg bg-[var(--brand-light)] border border-[var(--brand-faint)] flex items-center justify-center text-[var(--brand)]">
                                <BrainCircuit className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Aptitude & Reasoning</h3>
                            <div className="text-3xl font-extrabold text-[var(--rr-text)] mt-1">{Math.round(aptitude_score)}%</div>
                        </div>
                        <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                            <div className="bg-[var(--brand)] h-full rounded-full" style={{ width: `${Math.min(100, Math.max(5, aptitude_score))}%` }} />
                        </div>
                        <p className="text-[11px] text-[var(--rr-muted)]">Quantitative & logic score</p>
                    </div>

                    {/* 2. Coding */}
                    <div className="rr-card p-6 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--rr-muted)]">Round 2</span>
                            <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                <Code2 className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Practical Coding</h3>
                            <div className="text-3xl font-extrabold text-[var(--rr-text)] mt-1">{Math.round(coding_score)}%</div>
                        </div>
                        <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                            <div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.min(100, Math.max(5, coding_score))}%` }} />
                        </div>
                        <p className="text-[11px] text-[var(--rr-muted)]">Hidden test suite execution</p>
                    </div>

                    {/* 3. Interview */}
                    <div className="rr-card p-6 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--rr-muted)]">Round 3</span>
                            <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                <MessageSquare className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[var(--rr-text)]">AI Technical Interview</h3>
                            <div className="text-3xl font-extrabold text-[var(--rr-text)] mt-1">{Math.round(interview_score)}%</div>
                        </div>
                        <div className="w-full bg-[var(--rr-border)] h-1.5 rounded-full overflow-hidden">
                            <div className="bg-amber-500 h-full rounded-full" style={{ width: `${Math.min(100, Math.max(5, interview_score))}%` }} />
                        </div>
                        <p className="text-[11px] text-[var(--rr-muted)]">Concept & communication depth</p>
                    </div>
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
                                <div key={i} className="p-3 rounded-lg border border-[var(--rr-border)] bg-[var(--rr-bg)] text-xs flex items-start gap-2.5">
                                    <span className={`mt-0.5 font-bold ${g.status === "Demonstrated" ? "text-emerald-600" : "text-amber-600"}`}>{g.status === "Demonstrated" ? "✓" : "!"}</span>
                                    <div>
                                        <p className="font-semibold text-[var(--rr-text)]">{g.skill} <span className="font-normal text-[var(--rr-muted)]">— {g.status}</span></p>
                                        <p className="text-[var(--rr-text-2)] mt-0.5">{g.evidence || g.recommendation}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Qualitative Skills Matrix & Areas for Improvement */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Verified Strengths */}
                    <div className="rr-card p-6 sm:p-7 space-y-4">
                        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--rr-border)]">
                            <CheckCircle2 className="w-5 h-5 text-[var(--rr-success)]" />
                            <h3 className="text-base font-bold text-[var(--rr-text)]">Competencies Met & Verified</h3>
                        </div>
                        <div className="space-y-2.5">
                            {skillsVerified.map((s, idx) => (
                                <div key={idx} className="flex items-center gap-2.5 text-sm text-[var(--rr-text-2)] p-2.5 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)]">
                                    <span className="text-[var(--rr-success)] font-bold">✓</span>
                                    <span>{s}</span>
                                </div>
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
                                <div key={idx} className="flex items-center gap-2.5 text-sm text-[var(--rr-text-2)] p-2.5 rounded-lg bg-[var(--rr-bg)] border border-[var(--rr-border)]">
                                    <span className="text-[var(--rr-warning)] font-bold">!</span>
                                    <span>{a}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Personalised next steps */}
                {(recommendations.length > 0 || Object.keys(learningRoadmap).length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                                <div className="space-y-2">
                                    {Object.entries(learningRoadmap).map(([wk, task]) => (
                                        <div key={wk} className="flex items-start gap-3 text-sm">
                                            <span className="shrink-0 px-2 py-0.5 rounded bg-[var(--rr-bg)] border border-[var(--rr-border)] text-[10px] font-bold uppercase text-[var(--rr-muted)]">{wk.replace("_", " ")}</span>
                                            <span className="text-[var(--rr-text-2)]">{task}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer Next Steps */}
                <div className="p-6 bg-[var(--rr-bg)] border border-[var(--rr-border)] rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                        <h4 className="text-sm font-bold text-[var(--rr-text)]">Ready to benchmark against another role?</h4>
                        <p className="text-xs text-[var(--rr-muted)] mt-0.5">Upload a different JD or refine your resume to take a new PrepWin assessment.</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                        <Link
                            to="/student/dashboard"
                            id="report-view-dashboard-btn"
                            className="px-4 py-2 rounded-xl border border-[var(--rr-border)] bg-[var(--rr-card)] hover:bg-[var(--rr-input)] text-xs font-semibold text-[var(--rr-text)] flex items-center gap-2 transition-colors shadow-2xs"
                        >
                            <LayoutDashboard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>View Performance Dashboard</span>
                        </Link>
                        <Link
                            to="/assessment/setup"
                            className="rr-btn-primary shrink-0"
                        >
                            <span>New Self-Assessment</span>
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>

    );
};

export default RoleReadyReport;
