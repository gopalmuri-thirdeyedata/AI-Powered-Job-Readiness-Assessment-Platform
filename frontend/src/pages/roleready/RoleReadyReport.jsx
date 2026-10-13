import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
    Award, 
    CheckCircle2, 
    AlertTriangle, 
    ArrowRight, 
    FileText, 
    BrainCircuit, 
    Code2, 
    MessageSquare, 
    TrendingUp, 
    Share2, 
    Printer, 
    Sparkles, 
    Building2,
    RefreshCw,
    LayoutDashboard
} from 'lucide-react';
import rolereadyApi from '../../services/rolereadyApi';
import RoleReadyNavbar from '../../components/RoleReadyNavbar';

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

const RoleReadyReport = () => {
    const { sessionUuid } = useParams();
    const [reportData, setReportData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchReport = async () => {
            try {
                const data = await rolereadyApi.getReport(sessionUuid);
                setReportData(data);
            } catch (err) {
                console.error("Failed to fetch report:", err);
                setError(err.response?.data?.detail || "Could not load report.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchReport();
    }, [sessionUuid]);

    if (isLoading) {
        return (
            <div className="rr-page flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-[var(--brand)] animate-spin" />
                <p className="rr-muted-text text-sm font-medium">Synthesizing Job-Readiness Dossier...</p>
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
        final_report = {}
    } = reportData;

    const readinessTier = final_report.readiness_tier || (overall_readiness_score >= 80 ? "Direct Role Ready" : "Foundation Strong");
    const skillsVerified = final_report.skills_verified || ["Algorithms", "Problem Solving"];
    const areasToImprove = final_report.areas_for_improvement || ["Algorithmic Optimization", "Architecture Depth"];

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
