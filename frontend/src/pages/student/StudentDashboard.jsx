import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
    LayoutDashboard,
    Award,
    FileText,
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
    ShieldCheck,
    ClipboardList,
    Clock,
    PlayCircle,
    XCircle,
    ArrowRight,
} from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import studentApi from '../../services/studentApi';
import StudentOnboardingWizard from '../../components/student/StudentOnboardingWizard';
import StudentPerformanceView from '../../components/student/StudentPerformanceView';
import AssessmentRequiredGate from '../../components/student-ui/AssessmentRequiredGate';
import { PageHero, Stagger, StaggerItem, EmptyState } from '../../components/student-ui/StudentMotion';
import { Counter, EASE } from '../../components/home/primitives';
import useStudentTaskStatus, { markStudentTaskCompleted, clearStudentTaskCompleted } from '../../hooks/useStudentTaskStatus';

/* ─── Animated gradient progress bar (fills when scrolled into view) ── */
const GradBar = ({ value = 0, grad = 'from-emerald-600 to-teal-500', height = 'h-2', className = '', track = 'bg-slate-100 dark:bg-slate-800' }) => {
    const reduce = useReducedMotion();
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    return (
        <div className={`w-full ${track} ${height} rounded-full overflow-hidden ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
            <motion.div
                className={`h-full rounded-full bg-gradient-to-r ${grad}`}
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${v}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.0, ease: EASE }}
            />
        </div>
    );
};

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
    const { user } = useUser();
    const { hasCompletedTask, isLoading: isTaskStatusLoading, isConfirmedNew } = useStudentTaskStatus(user);

    const [searchParams, setSearchParams] = useSearchParams();
    const urlTab = searchParams.get('tab');

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const d = new Date(dateString);
            return isNaN(d.getTime()) ? dateString : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            return dateString;
        }
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const d = new Date(dateString);
            return isNaN(d.getTime()) ? dateString : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return dateString;
        }
    };
    const reduceMotion = useReducedMotion();
    const [activeTab, setActiveTab] = useState(urlTab === 'readiness' ? 'readiness' : 'performance');
    // Sub-view inside the Readiness hub: switching it is purely in-page (no route change, no refetch)
    const [section, setSection] = useState('all');
    const [dashboardData, setDashboardData] = useState(null);
    const [unifiedData, setUnifiedData] = useState(null);
    const [onboardingStatus, setOnboardingStatus] = useState(null);
    const [assessmentHistory, setAssessmentHistory] = useState(null);
    const [historyFilter, setHistoryFilter] = useState('ALL'); // 'ALL' | 'COMPLETED' | 'IN_PROGRESS'
    const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    const handleTabChange = (newTab) => {
        setActiveTab(newTab);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('tab', newTab);
            return next;
        }, { replace: true });
    };

    const loadDashboard = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [dashRes, unifiedRes, onbRes, histRes] = await Promise.allSettled([
                studentApi.getDashboard(),
                studentApi.getUnifiedDashboard(),
                studentApi.getOnboardingStatus(),
                studentApi.getAssessmentHistory()
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

            if (histRes.status === 'fulfilled') {
                setAssessmentHistory(histRes.value);
                const completedCount = Number(histRes.value?.total_completed || 0);
                const attemptedCount = Number(histRes.value?.total_attempted || 0);
                // Any attempt keeps past tests reachable; a student with zero attempts sees the take-assessment screen
                if (completedCount > 0 || attemptedCount > 0) {
                    markStudentTaskCompleted();
                } else {
                    clearStudentTaskCompleted();
                }
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

    // Still verifying whether this student has any assessments: avoid flashing the empty state
    if (!hasCompletedTask && isTaskStatusLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
                <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin" />
                <p className="text-slate-500 text-xs">Checking your assessments...</p>
            </div>
        );
    }

    // Strict Gating: students the server confirmed have no assessments never see dashboard statistics or data
    if (!hasCompletedTask && isConfirmedNew) {
        return <AssessmentRequiredGate />;
    }

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
            <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 rounded-2xl p-8 text-center shadow-lg">
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

    // Next best action: derived only from data already loaded above
    const nextAction = assessmentHistory?.active_session?.continue_url
        ? { to: assessmentHistory.active_session.continue_url, icon: PlayCircle, label: 'Continue your unfinished assessment', hint: 'Pick up where you left off and finish all three rounds.' }
        : !resume_score
            ? { to: '/student/resume', icon: FileText, label: 'Upload your resume for an ATS score', hint: 'Unlocks precise readiness scoring and recommendations.' }
            : !roadmapStats.total_tasks
                ? { to: '/student/roadmap', icon: Compass, label: 'Build your personalised roadmap', hint: 'Turn your skill gaps into a day-by-day plan.' }
                : !practiceStats.solved_count
                    ? { to: '/student/practice', icon: Code2, label: 'Solve your first DSA problem', hint: 'Practice builds the coding score that recruiters weigh most.' }
                    : { to: '/student/simulation', icon: Award, label: 'Try a placement drive simulation', hint: 'Test yourself end-to-end under real drive conditions.' };

    return (
        <div className="space-y-6 animate-in fade-in duration-300 pb-12">
            {/* ─── Dashboard View Segmented Switcher ────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-4 pb-1">
                <div className="relative flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 max-w-full overflow-x-auto student-scrollbar">
                    {[
                        { id: 'performance', label: 'Performance & Analytics', Icon: BarChart3 },
                        { id: 'readiness', label: 'Readiness & Profile Hub', Icon: Sparkles },
                    ].map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => handleTabChange(id)}
                            className={`relative px-3.5 sm:px-4 py-2.5 min-h-[40px] rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap ${activeTab === id ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            {activeTab === id && (
                                <motion.span
                                    layoutId="student-dash-tab-pill"
                                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                                    className="absolute inset-0 rounded-xl bg-white dark:bg-slate-900 shadow-xs border border-emerald-200/80 dark:border-emerald-500/20"
                                />
                            )}
                            <Icon className="relative w-3.5 h-3.5" />
                            <span className="relative">{label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── View Content ────────────────────────────────────── */}
            {activeTab === 'performance' ? (
                <StudentPerformanceView />
            ) : (
                <div className="space-y-8 animate-in fade-in duration-200">
                    {/* ─── Hero Header & Quick Actions ───────────────────── */}
                    <PageHero
                        icon={Sparkles}
                        eyebrow="Campus Placement Command Center"
                        title={greeting}
                        subtitle="Monitor your real-time placement readiness, target role skill benchmarks, and active campus drive preparations in one unified hub."
                        actions={
                            <>
                                <Link
                                    to="/assessment/setup"
                                    className="px-4 py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 text-white text-xs font-semibold flex items-center gap-2 shadow-md shadow-emerald-600/20 hover:-translate-y-0.5 hover:shadow-lg transition-all cursor-pointer"
                                >
                                    <Sparkles className="w-4 h-4" />
                                    <span>Start New Assessment</span>
                                </Link>
                                <Link
                                    to="/student/practice"
                                    className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-50 hover:bg-white dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all shadow-xs hover:-translate-y-0.5 hover:shadow-md active:scale-95 cursor-pointer"
                                >
                                    <Code2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>Solve DSA</span>
                                </Link>
                                <Link
                                    to="/student/simulation"
                                    className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-50 hover:bg-white dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all shadow-xs hover:-translate-y-0.5 hover:shadow-md active:scale-95 cursor-pointer"
                                >
                                    <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                    <span>Simulate Drive</span>
                                </Link>
                                <Link
                                    to="/student/resume"
                                    className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-50 hover:bg-white dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all shadow-xs hover:-translate-y-0.5 hover:shadow-md active:scale-95 cursor-pointer"
                                >
                                    <FileText className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                    <span>Resume</span>
                                </Link>
                            </>
                        }
                    >
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 max-w-full">
                                <span className="text-slate-400 font-medium shrink-0">Target Role:</span>
                                <strong className="text-slate-800 dark:text-slate-200 font-semibold truncate">{target_role || 'Software Engineer'}</strong>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 max-w-full">
                                <span className="text-slate-400 font-medium shrink-0">Target Company:</span>
                                <strong className="text-slate-800 dark:text-slate-200 font-semibold truncate">{target_company || 'Top Tech & Product Firms'}</strong>
                            </div>
                            <Link
                                to="/student/skill-gap"
                                className="inline-flex items-center gap-1 min-h-[40px] px-1 text-emerald-600 dark:text-emerald-400 font-bold hover:underline"
                            >
                                <span>Skill Gap</span>
                                <ArrowUpRight className="w-3 h-3" />
                            </Link>
                        </div>
                    </PageHero>

            {/* ─── Next Best Action (derived from loaded data only) ── */}
            {nextAction && (
                <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                >
                    <Link
                        to={nextAction.to}
                        className="group flex items-center gap-3 sm:gap-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-500/30 bg-gradient-to-r from-emerald-50 via-white to-teal-50 dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900 px-4 py-3.5 min-h-[56px] shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all"
                    >
                        <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                            <nextAction.icon className="w-5 h-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Next best action</span>
                            <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{nextAction.label}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{nextAction.hint}</span>
                        </span>
                        <ArrowRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 transition-transform group-hover:translate-x-1" />
                    </Link>
                </motion.div>
            )}

            {/* ─── Unfinished Assessment Alert Banner ─────────────── */}
            {assessmentHistory?.active_session && (
                <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5 shadow-xs">
                    <div className="flex items-start gap-3.5">
                        <div className="w-11 h-11 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                            <Clock className="w-5 h-5 animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50">
                                    Assessment In Progress
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    Current Stage: <strong className="text-slate-800 dark:text-slate-200 capitalize">{assessmentHistory.active_session.current_state?.toLowerCase().replace(/_/g, ' ')}</strong>
                                </span>
                            </div>
                            <h4 className="text-base font-bold text-slate-900 dark:white mt-1">
                                {assessmentHistory.active_session.target_role || 'Software Engineer'} Assessment
                            </h4>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                                You left an assessment unfinished. Continue now to complete your aptitude, coding, and interview rounds.
                            </p>
                        </div>
                    </div>
                    <Link
                        to={assessmentHistory.active_session.continue_url}
                        className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-all shrink-0 cursor-pointer"
                    >
                        <PlayCircle className="w-4 h-4" />
                        <span>Continue Assessment</span>
                    </Link>
                </div>
            )}

            {/* ─── Onboarding Progress Banner ─────────────────────── */}
            {onboardingStatus && !onboardingStatus.is_onboarded && (
                <div className="bg-gradient-to-r from-emerald-50 via-white to-teal-50 dark:from-emerald-950/40 dark:via-slate-900/90 dark:to-slate-900 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-sm relative overflow-hidden">
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
            <Stagger className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
                {/* 1. Total Assessments (Attempted & Completed) */}
<StaggerItem className="h-full [&>*]:h-full">
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 flex flex-col justify-between group hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all duration-200">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Assessments
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                            <ClipboardList className="w-4 h-4" />
                        </div>
                    </div>

                    <div className="my-5">
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                <Counter to={Number(assessmentHistory?.total_attempted) || 0} />
                            </span>
                            <span className="text-slate-400 font-medium text-xs">
                                attempted • {assessmentHistory?.total_completed ?? 0} completed
                            </span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
                            <div 
                                className="bg-gradient-to-r from-emerald-600 to-teal-500 h-full rounded-full transition-all duration-700"
                                style={{
                                    width: `${assessmentHistory?.total_attempted ? Math.min(100, Math.round(((assessmentHistory.total_completed || 0) / assessmentHistory.total_attempted) * 100)) : 0}%`
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400">
                            {assessmentHistory?.total_attempted ? `${Math.round(((assessmentHistory.total_completed || 0) / assessmentHistory.total_attempted) * 100)}% completion rate` : 'No attempts yet'}
                        </span>
                        <button type="button" onClick={() => setSection('assessments')} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 font-semibold flex items-center gap-0.5 cursor-pointer">
                            History <ArrowUpRight className="w-3 h-3" />
                        </button>
                    </div>
                </div>
</StaggerItem>

                {/* 2. Latest Assessment Score & Date */}
<StaggerItem className="h-full [&>*]:h-full">
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 flex flex-col justify-between group hover:border-purple-300 dark:hover:border-purple-500/40 transition-all duration-200">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                            Latest Assessment
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                            <Award className="w-4 h-4" />
                        </div>
                    </div>

                    <div className="my-5">
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                {assessmentHistory?.latest_assessment?.overall_readiness_score !== undefined
                                    ? `${Math.round(assessmentHistory.latest_assessment.overall_readiness_score)}%`
                                    : 'N/A'
                                }
                            </span>
                            <span className="text-slate-400 font-medium text-xs">
                                {assessmentHistory?.latest_assessment ? 'overall score' : 'no score'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                            {assessmentHistory?.latest_assessment?.target_role || 'No recent assessment'}
                        </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400">
                            {assessmentHistory?.latest_assessment?.created_at ? formatDate(assessmentHistory.latest_assessment.created_at) : 'Take first assessment'}
                        </span>
                        {assessmentHistory?.latest_assessment?.report_url ? (
                            <Link to={assessmentHistory.latest_assessment.report_url} className="text-purple-600 dark:text-purple-400 hover:text-purple-700 font-semibold flex items-center gap-0.5">
                                Report <ArrowUpRight className="w-3 h-3" />
                            </Link>
                        ) : (
                            <Link to="/assessment/setup" className="text-purple-600 dark:text-purple-400 hover:text-purple-700 font-semibold flex items-center gap-0.5">
                                Start <ArrowUpRight className="w-3 h-3" />
                            </Link>
                        )}
                    </div>
                </div>
</StaggerItem>

                {/* 3. Placement Readiness Hero Card */}
<StaggerItem className="h-full [&>*]:h-full">
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 flex flex-col justify-between group hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all duration-200">
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
                                    <Counter to={Math.round(readiness_score) || 0} />
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
</StaggerItem>

                {/* 4. Resume ATS Score */}
<StaggerItem className="h-full [&>*]:h-full">
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 flex flex-col justify-between group hover:border-blue-300 dark:hover:border-blue-500/40 transition-all duration-200">
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
                                <Counter to={Math.round(resume_score) || 0} />
                            </span>
                            <span className="text-slate-400 font-medium text-sm">/ 100</span>
                        </div>
                        <GradBar value={Math.min(100, Math.max(5, resume_score))} grad="from-blue-600 to-cyan-500" height="h-2" track="bg-slate-100 dark:bg-slate-800" className="mt-3" />
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
</StaggerItem>
            </Stagger>

            {/* ─── Section View Switcher Tabs ────────────────────── */}
            <div className="flex items-center gap-2 border-b border-slate-200/80 dark:border-slate-800 pb-3 overflow-x-auto student-scrollbar">
                {[
                    { id: 'all', label: 'Overview', icon: LayoutDashboard },
                    { id: 'assessments', label: `My Assessments (${assessmentHistory?.total_attempted ?? 0})`, icon: ClipboardList },
                    { id: 'results', label: `Results (${assessmentHistory?.total_completed ?? 0})`, icon: Award },
                    { id: 'progress', label: 'Progress & Improvements', icon: TrendingUp },
                ].map(tab => {
                    const active = section === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setSection(tab.id)}
                            className={`relative flex items-center gap-2 px-4 py-2.5 min-h-[40px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
                                active
                                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                                    : 'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ─── Previous Assessment Records (My Assessments) ─── */}
            {(section === 'all' || section === 'assessments') && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
                                <ClipboardList className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                Previous Assessment Records
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Historical records of your RoleReady aptitude, coding, and interview rounds.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Filter Pills */}
                            <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs border border-slate-200/70 dark:border-slate-700">
                                {['ALL', 'COMPLETED', 'IN_PROGRESS'].map(filter => (
                                    <button
                                        key={filter}
                                        onClick={() => setHistoryFilter(filter)}
                                        className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                                            historyFilter === filter
                                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        {filter === 'ALL' ? 'All' : filter === 'COMPLETED' ? 'Completed' : 'In Progress'}
                                    </button>
                                ))}
                            </div>

                            <Link
                                to="/assessment/setup"
                                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer shrink-0"
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Start Assessment</span>
                            </Link>
                        </div>
                    </div>

                    {/* Assessment Records Content */}
                    {(() => {
                        const allRecords = assessmentHistory?.assessments || [];
                        const filteredRecords = allRecords.filter(item => {
                            if (historyFilter === 'COMPLETED') return item.is_completed;
                            if (historyFilter === 'IN_PROGRESS') return !item.is_completed;
                            return true;
                        });

                        if (allRecords.length === 0) {
                            return (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-10 text-center shadow-xs">
                                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto mb-4">
                                        <ClipboardList className="w-8 h-8" />
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white">No Past Assessments Found</h3>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                                        You haven't attempted any RoleReady job assessments yet. Complete your first 3-stage assessment to evaluate your aptitude, coding in Python or Java, and AI interview readiness.
                                    </p>
                                    <div className="mt-6 flex justify-center">
                                        <Link
                                            to="/assessment/setup"
                                            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            <span>Take Your First Assessment</span>
                                        </Link>
                                    </div>
                                </div>
                            );
                        }

                        if (filteredRecords.length === 0) {
                            return (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                                    No assessments found matching the "{historyFilter.toLowerCase().replace('_', ' ')}" filter.
                                </div>
                            );
                        }

                        return (
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                                {/* Desktop Table */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800 text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                                            <tr>
                                                <th className="py-3.5 px-5">Role & Company</th>
                                                <th className="py-3.5 px-4">Date Taken</th>
                                                <th className="py-3.5 px-3 text-center">Aptitude</th>
                                                <th className="py-3.5 px-3 text-center">Coding</th>
                                                <th className="py-3.5 px-3 text-center">Interview</th>
                                                <th className="py-3.5 px-4 text-center">Overall Score</th>
                                                <th className="py-3.5 px-4">Status</th>
                                                <th className="py-3.5 px-5 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                                            {filteredRecords.map((item) => (
                                                <tr key={item.session_uuid || item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                    <td className="py-4 px-5">
                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                            {item.target_role || 'Software Engineer'}
                                                        </div>
                                                        <div className="text-[11px] text-slate-400 mt-0.5">
                                                            {item.target_company || 'ThirdEye Data'}
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                                                        {formatDateTime(item.created_at)}
                                                    </td>
                                                    <td className="py-4 px-3 text-center">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200">
                                                            {item.aptitude_score}%
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-3 text-center">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200">
                                                            {item.coding_score}%
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-3 text-center">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200">
                                                            {item.interview_score}%
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-4 text-center">
                                                        <span className={`inline-block px-2.5 py-1 rounded-full font-extrabold text-xs ${
                                                            item.overall_readiness_score >= 80 
                                                                ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' 
                                                                : item.overall_readiness_score >= 60 
                                                                ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300' 
                                                                : 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                                        }`}>
                                                            {Math.round(item.overall_readiness_score)}%
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-4 whitespace-nowrap">
                                                        {item.is_disqualified ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30">
                                                                <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                                                                Disqualified
                                                            </span>
                                                        ) : item.is_completed ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
                                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                                Completed
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                                                                <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                                                In Progress
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-4 px-5 text-right whitespace-nowrap">
                                                        {item.is_completed ? (
                                                            <Link
                                                                to={item.report_url}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold transition-all"
                                                            >
                                                                <FileText className="w-3.5 h-3.5" />
                                                                <span>View Report</span>
                                                            </Link>
                                                        ) : (
                                                            <Link
                                                                to={item.continue_url}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-all shadow-xs"
                                                            >
                                                                <PlayCircle className="w-3.5 h-3.5" />
                                                                <span>Continue</span>
                                                            </Link>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Responsive Card List */}
                                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                                    {filteredRecords.map((item) => (
                                        <div key={item.session_uuid || item.id} className="p-4 space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="font-bold text-slate-900 dark:text-white text-sm">
                                                        {item.target_role || 'Software Engineer'}
                                                    </div>
                                                    <div className="text-xs text-slate-400">
                                                        {item.target_company || 'ThirdEye Data'} • {formatDate(item.created_at)}
                                                    </div>
                                                </div>
                                                {item.is_disqualified ? (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-300">
                                                        Disqualified
                                                    </span>
                                                ) : item.is_completed ? (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                        Completed
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300">
                                                        In Progress
                                                    </span>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-4 gap-2 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl text-center">
                                                <div>
                                                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Aptitude</div>
                                                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5">{item.aptitude_score}%</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Coding</div>
                                                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5">{item.coding_score}%</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-slate-400 font-semibold uppercase">Interview</div>
                                                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5">{item.interview_score}%</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase">Overall</div>
                                                    <div className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 mt-0.5">{Math.round(item.overall_readiness_score)}%</div>
                                                </div>
                                            </div>

                                            <div className="flex justify-end pt-1">
                                                {item.is_completed ? (
                                                    <Link
                                                        to={item.report_url}
                                                        className="w-full text-center py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-xs"
                                                    >
                                                        View Full Report →
                                                    </Link>
                                                ) : (
                                                    <Link
                                                        to={item.continue_url}
                                                        className="w-full text-center py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs"
                                                    >
                                                        Continue Assessment →
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* ─── Progress Trends & Areas for Improvement ───────── */}
            {(section === 'all' || section === 'progress') && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
                    {/* Progress Trends Bar Chart / Visual Timeline */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
                            <div>
                                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                    Progress Trends &amp; Score Trajectory
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Chronological assessment history illustrating your overall readiness progression.
                                </p>
                            </div>
                            <span className="text-[11px] font-semibold text-slate-400">
                                {assessmentHistory?.trends?.length || 0} historical milestones
                            </span>
                        </div>

                        {(!assessmentHistory?.trends || assessmentHistory.trends.length === 0) ? (
                            <EmptyState
                                icon={TrendingUp}
                                title="Your trajectory starts here"
                                body="No assessment trend records available yet. Complete your first assessment to track score progression over time."
                                action={<Link to="/assessment/setup" className="px-5 py-2.5 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition-all"><Sparkles className="w-4 h-4" /><span>Take an assessment</span></Link>}
                            />
                        ) : (
                            <div className="space-y-4">
                                {assessmentHistory.trends.map((tr, idx) => (
                                    <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <div>
                                                <span className="font-bold text-xs text-slate-900 dark:text-white">{tr.role}</span>
                                                <span className="text-[11px] text-slate-400 ml-2">{tr.date}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400">Readiness:</span>
                                                <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{tr.overall}%</span>
                                            </div>
                                        </div>

                                        {/* Overall bar */}
                                        <GradBar value={Math.min(100, Math.max(5, tr.overall))} grad="from-emerald-600 to-teal-500" height="h-2" track="bg-slate-200/80 dark:bg-slate-700" className="mb-3" />

                                        {/* Round mini-breakdown */}
                                        <div className="grid grid-cols-3 gap-2 text-center text-[11px] pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                                            <div>
                                                <span className="text-slate-400">Aptitude: </span>
                                                <strong className="text-slate-700 dark:text-slate-200">{tr.aptitude}%</strong>
                                            </div>
                                            <div>
                                                <span className="text-slate-400">Coding: </span>
                                                <strong className="text-slate-700 dark:text-slate-200">{tr.coding}%</strong>
                                            </div>
                                            <div>
                                                <span className="text-slate-400">Interview: </span>
                                                <strong className="text-slate-700 dark:text-slate-200">{tr.interview}%</strong>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Areas for Improvement */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-xs">
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                    Areas for Improvement (Based on Past Performance)
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Identified round weaknesses &lt; 75% benchmark with actionable focus areas.
                                </p>
                            </div>
                            <Link to="/student/skill-gap" className="text-xs text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1 hover:underline">
                                <span>Deep Gap Analysis</span>
                                <ArrowUpRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        {(!assessmentHistory?.areas_for_improvement || assessmentHistory.areas_for_improvement.length === 0) ? (
                            <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                                <p className="font-semibold text-slate-700 dark:text-slate-300">Exceptional Track Record!</p>
                                <p className="mt-1">All your completed rounds are performing above the 75% placement benchmark.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {assessmentHistory.areas_for_improvement.map((area, idx) => (
                                    <div key={idx} className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/40 rounded-2xl flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center justify-between gap-2 mb-1.5">
                                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                                                    {area.round}
                                                </span>
                                                {area.score > 0 && (
                                                    <span className="text-xs font-extrabold text-amber-700 dark:text-amber-400">
                                                        {area.score}% avg
                                                    </span>
                                                )}
                                            </div>
                                            <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-2">
                                                {area.topic}
                                            </h4>
                                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                                                {area.recommendation}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ─── Dedicated Assessment Results View ─────────────── */}
            {section === 'results' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <Award className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                Assessment Results &amp; Scorecards
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Comprehensive evaluation dossiers from your completed multi-stage assessments.
                            </p>
                        </div>
                    </div>

                    {(() => {
                        const completed = (assessmentHistory?.assessments || []).filter(a => a.is_completed);
                        if (completed.length === 0) {
                            return (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-10 text-center shadow-xs">
                                    <div className="w-16 h-16 rounded-2xl bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 mx-auto mb-4">
                                        <Award className="w-8 h-8" />
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white">No Completed Results Yet</h3>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                                        Once you finish an assessment session (Aptitude, Coding, and Technical Interview), your comprehensive evaluation dossier will be published here.
                                    </p>
                                    <div className="mt-6 flex justify-center">
                                        <Link
                                            to="/assessment/setup"
                                            className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            <span>Start An Assessment</span>
                                        </Link>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {completed.map((sess) => (
                                    <div key={sess.session_uuid || sess.id} className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center justify-between gap-2 mb-3">
                                                <span className="text-xs font-bold text-slate-900 dark:text-white">
                                                    {sess.target_role}
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {formatDate(sess.created_at)}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between gap-4 my-4 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl">
                                                <div>
                                                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Overall Readiness</span>
                                                    <span className="text-3xl font-extrabold text-slate-900 dark:text-white">{Math.round(sess.overall_readiness_score)}%</span>
                                                </div>
                                                <CircularScoreGauge score={sess.overall_readiness_score} size={64} strokeWidth={6} />
                                            </div>

                                            <div className="grid grid-cols-3 gap-2 text-center text-xs py-2">
                                                <div className="p-2 bg-slate-50/80 dark:bg-slate-800/40 rounded-xl">
                                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Aptitude</span>
                                                    <span className="font-bold text-slate-800 dark:text-slate-200">{sess.aptitude_score}%</span>
                                                </div>
                                                <div className="p-2 bg-slate-50/80 dark:bg-slate-800/40 rounded-xl">
                                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Coding</span>
                                                    <span className="font-bold text-slate-800 dark:text-slate-200">{sess.coding_score}%</span>
                                                </div>
                                                <div className="p-2 bg-slate-50/80 dark:bg-slate-800/40 rounded-xl">
                                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Interview</span>
                                                    <span className="font-bold text-slate-800 dark:text-slate-200">{sess.interview_score}%</span>
                                                </div>
                                            </div>
                                        </div>

                                        <Link
                                            to={sess.report_url}
                                            className="mt-4 w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all hover:scale-[1.01]"
                                        >
                                            <FileText className="w-4 h-4" />
                                            <span>View Full Evaluation Dossier</span>
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* ─── Multi-Factor Preparation Hub ─────────────────── */}
            {section === 'all' && (
            <>
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

                <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* 1. Roadmap Plan */}
<StaggerItem className="h-full [&>*]:h-full">
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
                            <GradBar value={roadmapStats.total_tasks ? Math.round((roadmapStats.completed_tasks / roadmapStats.total_tasks) * 100) : 0} grad="from-cyan-500 to-cyan-400" height="h-1.5" track="bg-slate-100 dark:bg-slate-800" className="mt-3" />
                        </div>
                        <Link to="/student/roadmap" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-cyan-600 dark:text-cyan-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Open Roadmap</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
</StaggerItem>

                    {/* 2. DSA & Aptitude Practice */}
<StaggerItem className="h-full [&>*]:h-full">
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
                            <GradBar value={Math.min(100, practiceStats.solved_count * 5)} grad="from-emerald-500 to-emerald-400" height="h-1.5" track="bg-slate-100 dark:bg-slate-800" className="mt-3" />
                        </div>
                        <Link to="/student/practice" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Practice Arena</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
</StaggerItem>

                    {/* 3. AI Mock Interviews */}
<StaggerItem className="h-full [&>*]:h-full">
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
                            <GradBar value={Math.min(100, interviewStats.avg_score || 0)} grad="from-indigo-500 to-indigo-400" height="h-1.5" track="bg-slate-100 dark:bg-slate-800" className="mt-3" />
                        </div>
                        <Link to="/student/interview" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Launch Interview</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
</StaggerItem>

                    {/* 4. Portfolio Projects */}
<StaggerItem className="h-full [&>*]:h-full">
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
                            <GradBar value={Math.min(100, projectStats.total_projects * 33)} grad="from-amber-500 to-amber-400" height="h-1.5" track="bg-slate-100 dark:bg-slate-800" className="mt-3" />
                        </div>
                        <Link to="/student/projects" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Audit Project</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
</StaggerItem>

                    {/* 5. Placement Simulation */}
<StaggerItem className="h-full [&>*]:h-full">
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
                            <GradBar value={simulationStats.score !== null ? Math.round(simulationStats.score) : 25} grad="from-rose-500 to-rose-400" height="h-1.5" track="bg-slate-100 dark:bg-slate-800" className="mt-3" />
                        </div>
                        <Link to="/student/simulation" className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center justify-between group-hover:translate-x-0.5 transition-transform">
                            <span>Simulate Drive</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
</StaggerItem>
            </Stagger>
            </div>

            {/* ─── Readiness Score Breakdown (6 Dimensions) ────────── */}
            {readiness_breakdown && Object.keys(readiness_breakdown).length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                Placement Readiness Breakdown
                            </h2>
                        </div>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">Resume baseline + your real activity</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5">
                        {[
                            { key: 'resume', label: 'Resume', color: '#3B82F6', barGrad: 'from-blue-500 to-indigo-500' },
                            { key: 'technical_skills', label: 'Technical Skills', color: '#10B981', barGrad: 'from-emerald-500 to-teal-500' },
                            { key: 'projects', label: 'Projects', color: '#F59E0B', barGrad: 'from-amber-500 to-orange-500' },
                            { key: 'experience', label: 'Experience', color: '#EC4899', barGrad: 'from-pink-500 to-rose-500' },
                            { key: 'education', label: 'Education', color: '#06B6D4', barGrad: 'from-cyan-500 to-blue-500' },
                            { key: 'ats_quality', label: 'ATS & Quality', color: '#8B5CF6', barGrad: 'from-purple-500 to-indigo-500' },
                            // Activity signals only appear once the student has actually done them
                            { key: 'assessment', label: 'Role Assessment', color: '#0EA5E9', barGrad: 'from-sky-500 to-blue-500' },
                            { key: 'interview', label: 'Mock Interviews', color: '#6366F1', barGrad: 'from-indigo-500 to-violet-500' },
                            { key: 'practice', label: 'Practice', color: '#22C55E', barGrad: 'from-green-500 to-emerald-500' },
                            { key: 'roadmap', label: 'Roadmap Progress', color: '#14B8A6', barGrad: 'from-teal-500 to-cyan-500' },
                            { key: 'simulation', label: 'Placement Sim', color: '#F43F5E', barGrad: 'from-rose-500 to-pink-500' },
                        ].filter(({ key }) => readiness_breakdown[key] !== undefined).map(({ key, label, barGrad }) => {
                            const val = Math.round(readiness_breakdown[key] || 0);
                            return (
                                <div 
                                    key={key} 
                                    className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 rounded-2xl p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md"
                                >
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 block truncate mb-1">{label}</span>
                                    <span className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{val}%</span>
                                    <GradBar value={Math.min(100, Math.max(0, val))} grad={barGrad} height="h-1.5" track="bg-slate-200/70 dark:bg-slate-700" className="mt-2.5" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ─── Career Copilot Suggested Action Prompts ─────────── */}
            {copilotSuggestions.length > 0 && (
                <div className="bg-gradient-to-br from-emerald-50/60 via-white to-slate-50 dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-900 border border-emerald-200/90 dark:border-emerald-500/30 rounded-2xl p-6 shadow-sm">
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
                                className="p-3.5 bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-300 hover:-translate-y-0.5 hover:shadow-sm rounded-2xl text-xs text-slate-700 dark:text-slate-300 flex items-start gap-3 shadow-2xs transition-all"
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
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-sm">
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
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-sm">
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
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-sm">
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
            </>
            )}

            {/* ─── Indicator Disclaimer ──────────────────────────── */}
            <div className="bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-5 py-3.5 flex items-start gap-3 text-xs text-slate-500 dark:text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                    <strong className="text-slate-700 dark:text-slate-300">Placement Readiness Indicator:</strong> This score represents an indicative preparation assessment based on your current resume, profile, technical credentials, and ATS criteria. It is an algorithmic benchmarking tool designed for guidance and is not a commercial guarantee of placement.
                </span>
            </div>
            </div>
            )}

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
