import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
    Award, 
    FileText, 
    Target, 
    Building2, 
    CheckCircle2, 
    AlertTriangle, 
    ArrowUpRight, 
    Sparkles, 
    TrendingUp, 
    RefreshCw,
    Compass,
    Code2,
    MessageSquare,
    FolderGit2,
    Bot,
    Zap,
    BarChart3,
    ShieldCheck
} from 'lucide-react';
import studentApi from '../../services/studentApi';
import StudentOnboardingWizard from '../../components/student/StudentOnboardingWizard';

/* ─── Circular Score Gauge ─────────────────────────── */
const CircularScoreGauge = ({ score = 0, size = 110, strokeWidth = 8, label = "Readiness" }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const validScore = Math.min(100, Math.max(0, Math.round(score)));
    const strokeDashoffset = circumference - (validScore / 100) * circumference;

    // Color gradient definitions based on score
    let gradientId = 'gaugeGradEmerald';
    if (validScore < 50) {
        gradientId = 'gaugeGradRose';
    } else if (validScore < 75) {
        gradientId = 'gaugeGradAmber';
    }

    return (
        <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <defs>
                    <linearGradient id="gaugeGradEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#10B981" />
                        <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                    <linearGradient id="gaugeGradAmber" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#F59E0B" />
                        <stop offset="100%" stopColor="#D97706" />
                    </linearGradient>
                    <linearGradient id="gaugeGradRose" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#F43F5E" />
                        <stop offset="100%" stopColor="#E11D48" />
                    </linearGradient>
                </defs>
                {/* Background track */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    className="text-slate-100 dark:text-slate-800"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                />
                {/* Progress arc */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={`url(#${gradientId})`}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none">
                    {validScore}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">
                    / 100
                </span>
            </div>
        </div>
    );
};

const StudentDashboard = () => {
    const [dashboardData, setDashboardData] = useState(null);
    const [unifiedData, setUnifiedData] = useState(null);
    const [onboardingStatus, setOnboardingStatus] = useState(null);
    const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadDashboard = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [dashRes, unifiedRes, onbRes] = await Promise.allSettled([
                studentApi.getDashboard(),
                studentApi.getUnifiedDashboard(),
                studentApi.getOnboardingStatus()
            ]);

            if (dashRes.status === 'fulfilled') {
                setDashboardData(dashRes.value);
            } else {
                throw dashRes.reason;
            }

            if (unifiedRes.status === 'fulfilled') {
                setUnifiedData(unifiedRes.value);
            }

            if (onbRes.status === 'fulfilled') {
                setOnboardingStatus(onbRes.value);
            }
        } catch (err) {
            console.error('Failed to load student dashboard:', err);
            setError(err.response?.data?.detail || 'Unable to load dashboard data. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDashboard();
    }, []);

    // Time-based greeting helper
    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                        <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin" />
                    </div>
                </div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Synthesizing Readiness Analytics</h3>
                    <p className="text-slate-500 text-xs mt-1">Aggregating ATS scores, roadmaps, and interview benchmarks...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 rounded-3xl p-8 text-center shadow-lg">
                <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Unable to Load Dashboard</h2>
                <p className="text-slate-600 dark:text-slate-300 text-xs mb-6 leading-relaxed max-w-md mx-auto">{error}</p>
                <button
                    onClick={loadDashboard}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                    Retry Connection
                </button>
            </div>
        );
    }

    const {
        student_name,
        readiness_score = 0,
        resume_score = 0,
        target_role,
        target_company,
        strengths = [],
        areas_to_improve = [],
        resume_recommendations = [],
        readiness_breakdown = {},
        latest_resume_version
    } = dashboardData || {};

    // Multi-factor metrics from unified endpoint
    const roadmapStats = unifiedData?.roadmap || { completed_tasks: 0, total_tasks: 0 };
    const practiceStats = unifiedData?.practice || { solved_count: 0 };
    const interviewStats = unifiedData?.mock_interviews || { completed_sessions: 0, avg_score: 0 };
    const projectStats = unifiedData?.projects || { total_projects: 0 };
    const simulationStats = unifiedData?.placement_simulation || { score: null };
    const copilotSuggestions = unifiedData?.copilot_suggestions || [];

    const greeting = `${getGreeting()}, ${student_name || 'Student'}`;

    // Get readiness status label & badge
    const getReadinessBadge = (score) => {
        if (score >= 80) return { label: 'High Readiness', bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-500/30' };
        if (score >= 60) return { label: 'Intermediate', bg: 'bg-amber-50 dark:bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-500/30' };
        return { label: 'Building Foundation', bg: 'bg-rose-50 dark:bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-500/30' };
    };

    const readinessBadge = getReadinessBadge(readiness_score);

    return (
        <div className="space-y-8 animate-in fade-in duration-300 pb-12">
            {/* ─── Hero Header & Quick Actions ───────────────────── */}
            <div className="relative rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-sm overflow-hidden">
                {/* Ambient glow decoration */}
                <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-50 dark:bg-emerald-500/5 rounded-full blur-[90px] pointer-events-none" />

                <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs font-semibold mb-3">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>Campus Placement Command Center</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
                            {greeting}
                        </h1>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-2 max-w-2xl leading-relaxed">
                            Monitor your real-time placement readiness, target role skill benchmarks, and active campus drive preparations in one unified hub.
                        </p>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        <Link
                            to="/student/practice"
                            className="px-4 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-xs"
                        >
                            <Code2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>Solve DSA</span>
                        </Link>
                        <Link
                            to="/student/simulation"
                            className="px-4 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-xs"
                        >
                            <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <span>Simulate Drive</span>
                        </Link>
                        <Link
                            to="/student/resume"
                            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02]"
                        >
                            <FileText className="w-4 h-4" />
                            <span>Update Resume</span>
                        </Link>
                    </div>
                </div>
            </div>

            {/* ─── Onboarding Progress Banner ─────────────────────── */}
            {onboardingStatus && !onboardingStatus.is_onboarded && (
                <div className="bg-gradient-to-r from-emerald-50 via-white to-teal-50 dark:from-emerald-950/40 dark:via-slate-900/90 dark:to-slate-900 border border-emerald-200 dark:border-emerald-500/30 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-sm relative overflow-hidden">
                    <div className="flex items-start gap-4 relative z-10">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Complete Your Career Profile Setup</h3>
                                <span className="text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                                    Step {onboardingStatus.onboarding_step || 1} of 4
                                </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 max-w-2xl leading-relaxed">
                                Configure your dream companies, target roles, technical skills, and resume to unlock precision AI placement readiness scoring and personalized learning plans.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowOnboardingWizard(true)}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all shrink-0 cursor-pointer relative z-10"
                    >
                        <Zap className="w-4 h-4" />
                        <span>{onboardingStatus.onboarding_step > 1 ? 'Resume Setup Wizard' : 'Start Onboarding Wizard'}</span>
                    </button>
                </div>
            )}

            {/* ─── Top 4 High-Impact Metric Cards ────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* 1. Placement Readiness Hero Card */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between group hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all duration-200">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Placement Readiness
                        </span>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${readinessBadge.bg} ${readinessBadge.text} ${readinessBadge.border}`}>
                            {readinessBadge.label}
                        </div>
                    </div>

                    <div className="my-5 flex items-center justify-between gap-4">
                        <div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                    {Math.round(readiness_score)}
                                </span>
                                <span className="text-slate-400 font-medium text-sm">/ 100</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Multi-factor score</p>
                        </div>
                        <CircularScoreGauge score={readiness_score} size={84} strokeWidth={7} />
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                            <TrendingUp className="w-3.5 h-3.5" />
                            Live evaluation
                        </span>
                        <Link to="/student/simulation" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-0.5 font-medium">
                            Simulate <ArrowUpRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>

                {/* 2. Resume ATS Score */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between group hover:border-blue-300 dark:hover:border-blue-500/40 transition-all duration-200">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Resume Score
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                            <FileText className="w-4 h-4" />
                        </div>
                    </div>

                    <div className="my-5">
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                {Math.round(resume_score)}
                            </span>
                            <span className="text-slate-400 font-medium text-sm">/ 100</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
                            <div 
                                className="bg-gradient-to-r from-blue-600 to-cyan-500 h-full rounded-full transition-all duration-700"
                                style={{ width: `${Math.min(100, Math.max(5, resume_score))}%` }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400">
                            {latest_resume_version ? `Version V${latest_resume_version}` : 'No resume uploaded'}
                        </span>
                        <Link to="/student/resume" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 font-semibold flex items-center gap-0.5">
                            Analyze <ArrowUpRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>

                {/* 3. Target Role */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between group hover:border-amber-300 dark:hover:border-amber-500/40 transition-all duration-200">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Target Role
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <Target className="w-4 h-4" />
                        </div>
                    </div>

                    <div className="my-5">
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight line-clamp-1">
                            {target_role || 'Not Configured'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {target_role ? 'Role skill benchmark active' : 'Choose a role in profile'}
                        </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <Link to="/student/profile" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-0.5 font-medium">
                            Edit Role <ArrowUpRight className="w-3 h-3" />
                        </Link>
                        <Link to="/student/skill-gap" className="text-amber-600 dark:text-amber-400 hover:text-amber-700 font-semibold flex items-center gap-0.5">
                            Skill Gap <ArrowUpRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>

                {/* 4. Target Company */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between group hover:border-purple-300 dark:hover:border-purple-500/40 transition-all duration-200">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Target Company
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                            <Building2 className="w-4 h-4" />
                        </div>
                    </div>

                    <div className="my-5">
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
                            {target_company || 'Open to All'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {target_company ? 'Custom company standards' : 'General industry criteria'}
                        </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <Link to="/student/profile" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-0.5 font-medium">
                            Configure <ArrowUpRight className="w-3 h-3" />
                        </Link>
                        <Link to="/student/drives" className="text-purple-600 dark:text-purple-400 hover:text-purple-700 font-semibold flex items-center gap-0.5">
                            Campus Drives <ArrowUpRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* ─── Multi-Factor Preparation Hub ─────────────────── */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
                            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            Multi-Factor Preparation Hub
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Track the 5 core preparation pillars that formulate your placement score.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* 1. Roadmap Plan */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-cyan-400 rounded-2xl p-5 flex flex-col justify-between shadow-xs transition-all duration-200 group">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Roadmap Plan</span>
                                <div className="w-8 h-8 rounded-xl bg-cyan-50 dark:bg-cyan-500/15 border border-cyan-200 dark:border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                                    <Compass className="w-4 h-4" />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {roadmapStats.completed_tasks}
                                </span>
                                <span className="text-slate-500 dark:text-slate-400 text-xs">/ {roadmapStats.total_tasks || 0} tasks</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Daily curriculum pacing</p>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div 
                                    className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${roadmapStats.total_tasks ? Math.round((roadmapStats.completed_tasks / roadmapStats.total_tasks) * 100) : 0}%` }}
                                />
                            </div>
                        </div>
                        <Link to="/student/roadmap" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-cyan-600 dark:text-cyan-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Open Roadmap</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>

                    {/* 2. DSA & Aptitude Practice */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-400 rounded-2xl p-5 flex flex-col justify-between shadow-xs transition-all duration-200 group">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">DSA & Aptitude</span>
                                <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                    <Code2 className="w-4 h-4" />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {practiceStats.solved_count}
                                </span>
                                <span className="text-slate-500 dark:text-slate-400 text-xs">solved</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Algorithmic & reasoning questions</p>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div 
                                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(100, practiceStats.solved_count * 5)}%` }}
                                />
                            </div>
                        </div>
                        <Link to="/student/practice" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Practice Arena</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>

                    {/* 3. AI Mock Interviews */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 rounded-2xl p-5 flex flex-col justify-between shadow-xs transition-all duration-200 group">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Mock Interviews</span>
                                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <MessageSquare className="w-4 h-4" />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {interviewStats.completed_sessions}
                                </span>
                                {interviewStats.avg_score > 0 && (
                                    <span className="text-xs text-indigo-600 dark:text-indigo-300 font-semibold">
                                        ({Math.round(interviewStats.avg_score)}% avg)
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Completed panel sessions</p>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div 
                                    className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(100, interviewStats.avg_score || 0)}%` }}
                                />
                            </div>
                        </div>
                        <Link to="/student/interview" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Launch Interview</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>

                    {/* 4. Portfolio Projects */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-amber-400 rounded-2xl p-5 flex flex-col justify-between shadow-xs transition-all duration-200 group">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Project Analyzer</span>
                                <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                    <FolderGit2 className="w-4 h-4" />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {projectStats.total_projects}
                                </span>
                                <span className="text-slate-500 dark:text-slate-400 text-xs">analyzed</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Architecture & repo audits</p>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div 
                                    className="bg-amber-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(100, projectStats.total_projects * 33)}%` }}
                                />
                            </div>
                        </div>
                        <Link to="/student/projects" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Audit Project</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>

                    {/* 5. Placement Simulation */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-rose-400 rounded-2xl p-5 flex flex-col justify-between shadow-xs transition-all duration-200 group">
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Simulation Drive</span>
                                <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
                                    <Award className="w-4 h-4" />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                    {simulationStats.score !== null ? `${Math.round(simulationStats.score)}%` : 'Ready'}
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {simulationStats.score !== null ? 'Latest drive scorecard' : '4-round placement test'}
                            </p>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                                <div 
                                    className="bg-rose-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${simulationStats.score !== null ? Math.round(simulationStats.score) : 25}%` }}
                                />
                            </div>
                        </div>
                        <Link to="/student/simulation" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Simulate Drive</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* ─── Readiness Score Breakdown (6 Dimensions) ────────── */}
            {readiness_breakdown && Object.keys(readiness_breakdown).length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                Placement Readiness Breakdown
                            </h2>
                        </div>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">Algorithmic weighting</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
                        {[
                            { key: 'resume', label: 'Resume', color: '#3B82F6', barGrad: 'from-blue-500 to-indigo-500' },
                            { key: 'technical_skills', label: 'Technical Skills', color: '#10B981', barGrad: 'from-emerald-500 to-teal-500' },
                            { key: 'projects', label: 'Projects', color: '#F59E0B', barGrad: 'from-amber-500 to-orange-500' },
                            { key: 'experience', label: 'Experience', color: '#EC4899', barGrad: 'from-pink-500 to-rose-500' },
                            { key: 'education', label: 'Education', color: '#06B6D4', barGrad: 'from-cyan-500 to-blue-500' },
                            { key: 'ats_quality', label: 'ATS & Quality', color: '#8B5CF6', barGrad: 'from-purple-500 to-indigo-500' },
                        ].map(({ key, label, barGrad }) => {
                            const val = Math.round(readiness_breakdown[key] || 0);
                            return (
                                <div 
                                    key={key} 
                                    className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 rounded-2xl p-4 text-center transition-all"
                                >
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 block truncate mb-1">{label}</span>
                                    <span className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{val}%</span>
                                    <div className="w-full bg-slate-200/70 dark:bg-slate-700 h-1.5 rounded-full mt-2.5 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full bg-gradient-to-r ${barGrad} transition-all duration-700`}
                                            style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ─── Career Copilot Suggested Action Prompts ─────────── */}
            {copilotSuggestions.length > 0 && (
                <div className="bg-gradient-to-br from-emerald-50/60 via-white to-slate-50 dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-900 border border-emerald-200/90 dark:border-emerald-500/30 rounded-3xl p-6 shadow-sm">
                    <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
                            <Bot className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Career Copilot Recommendations</h2>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-500/20">
                                    AI Generated
                                </span>
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
                        Real-time guidance tailored to your target company benchmarks and identified skill gaps:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {copilotSuggestions.map((suggestion, idx) => (
                            <div 
                                key={idx}
                                className="p-3.5 bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-300 rounded-2xl text-xs text-slate-700 dark:text-slate-300 flex items-start gap-3 shadow-2xs transition-colors"
                            >
                                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                <span className="leading-relaxed">{suggestion}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ─── Strengths & Areas to Improve Grid ───────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Your Strengths */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm">
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Your Strengths</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">High-scoring assets from your resume and evaluations</p>
                        </div>
                    </div>
                    {strengths.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 italic py-4">
                            No strengths recorded yet. Upload your resume or update your skills in profile to highlight strengths.
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {strengths.map((str, idx) => (
                                <li key={idx} className="flex items-start gap-3 text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                                    <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                                        ✓
                                    </div>
                                    <span className="leading-relaxed">{str}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Areas to Improve */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm">
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Areas to Improve</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Identified skill shortages for {target_role || 'your target role'}</p>
                        </div>
                    </div>
                    {areas_to_improve.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 italic py-4">
                            Great work! No critical gaps identified currently.
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {areas_to_improve.map((area, idx) => (
                                <li key={idx} className="flex items-start gap-3 text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                                    <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                                        ⚠
                                    </div>
                                    <span className="leading-relaxed">{area}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* ─── Resume AI Recommendations ──────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm">
                <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Resume Recommendations</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Targeted tweaks to pass modern applicant tracking systems</p>
                        </div>
                    </div>
                    <Link
                        to="/student/resume"
                        className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1 transition-colors"
                    >
                        <span>Full Resume Report</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                </div>

                {resume_recommendations.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic py-4">
                        Upload your latest resume to receive AI-powered recommendations for improving your ATS score and placement opportunities.
                    </p>
                ) : (
                    <ol className="space-y-3">
                        {resume_recommendations.map((rec, idx) => (
                            <li key={idx} className="flex items-start gap-3 text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl p-3.5">
                                <span className="w-6 h-6 rounded-xl bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 border border-slate-200 dark:border-slate-600 shadow-2xs">
                                    {idx + 1}
                                </span>
                                <span className="leading-relaxed">{rec}</span>
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            {/* ─── Indicator Disclaimer ──────────────────────────── */}
            <div className="bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-5 py-3.5 flex items-start gap-3 text-xs text-slate-500 dark:text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                    <strong className="text-slate-700 dark:text-slate-300">Placement Readiness Indicator:</strong> This score represents an indicative preparation assessment based on your current resume, profile, technical credentials, and ATS criteria. It is an algorithmic benchmarking tool designed for guidance and is not a commercial guarantee of placement.
                </span>
            </div>

            {/* ─── Onboarding Wizard Modal ───────────────────────── */}
            <StudentOnboardingWizard
                isOpen={showOnboardingWizard}
                onClose={() => setShowOnboardingWizard(false)}
                onCompleted={() => {
                    setShowOnboardingWizard(false);
                    loadDashboard();
                }}
                initialProfile={dashboardData || {}}
            />
        </div>
    );
};

export default StudentDashboard;
