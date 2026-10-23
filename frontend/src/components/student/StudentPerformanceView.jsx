import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
    Award,
    CheckCircle2,
    Clock,
    TrendingUp,
    TrendingDown,
    Activity,
    BarChart3,
    ArrowUpRight,
    Eye,
    RefreshCw,
    AlertTriangle,
    Sparkles,
    ChevronRight,
    ChevronLeft,
    Search,
    Code2,
    MessageSquare,
    Target,
    X,
    ShieldCheck,
    HelpCircle,
    Zap,
    Compass,
    ArrowRight,
} from 'lucide-react';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip
} from 'recharts';
import studentApi from '../../services/studentApi';
import { PageHero, StatCard, AnimatedBar, EmptyState } from '../student-ui/StudentMotion';
import { Reveal, Counter, EASE } from '../home/primitives';

/* ─── Score Color Helper ──────────────────────────── */
const getScoreColor = (score) => {
    if (score === null || score === undefined) return { text: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', border: 'border-slate-200 dark:border-slate-700' };
    if (score >= 75) return { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-500/15', border: 'border-emerald-200 dark:border-emerald-500/30' };
    if (score >= 50) return { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/15', border: 'border-amber-200 dark:border-amber-500/30' };
    return { text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-500/15', border: 'border-rose-200 dark:border-rose-500/30' };
};

/* ─── Custom Recharts Tooltip ─────────────────────── */
const CustomTrendTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const item = payload[0].payload;
        const color = getScoreColor(item.score);
        return (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-2xl shadow-xl text-xs space-y-1.5 z-50">
                <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-slate-900 dark:text-white">{item.test_name}</span>
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold border ${color.bg} ${color.text} ${color.border}`}>
                        {item.score}%
                    </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between gap-2">
                    <span>{item.category}</span>
                    <span>{item.formatted_date}</span>
                </div>
            </div>
        );
    }
    return null;
};

/* ─── Assessment Details Modal ────────────────────── */
const AssessmentDetailModal = ({ isOpen, onClose, assessment, onOpenReport }) => {
    const [detailData, setDetailData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [fetchError, setFetchError] = useState(null);

    useEffect(() => {
        if (!isOpen || !assessment) {
            setDetailData(null);
            return;
        }

        setIsLoading(true);
        setFetchError(null);

        studentApi.getPerformanceAssessmentDetail(assessment.category_key, assessment.raw_id)
            .then(data => {
                setDetailData(data);
                setIsLoading(false);
            })
            .catch(err => {
                console.error("Failed to load assessment detail:", err);
                setFetchError(err.response?.data?.detail || "Could not retrieve detailed results.");
                setIsLoading(false);
            });
    }, [isOpen, assessment]);

    if (!isOpen || !assessment) return null;

    const data = detailData || assessment;
    const scoreColor = getScoreColor(data.overall_score !== undefined ? data.overall_score : data.score);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-xs"
        >
            <motion.div
                initial={{ opacity: 0, y: 40, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Modal Header */}
                <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
                    <div>
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[11px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {data.category}
                            </span>
                            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${data.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'}`}>
                                {data.status}
                            </span>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                            {data.test_name}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Completed on {data.formatted_date} {data.duration_minutes ? `• Duration: ${data.duration_minutes} mins` : ''}
                        </p>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
                    {isLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                            <span className="text-xs">Loading detailed assessment breakdown...</span>
                        </div>
                    ) : fetchError ? (
                        <div className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl text-xs text-rose-700 dark:text-rose-300">
                            {fetchError}
                        </div>
                    ) : (
                        <>
                            {/* Score Overview Banner */}
                            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                                <div>
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Overall Score</span>
                                    <p className="text-xs text-slate-400 mt-0.5">Normalized benchmark result</p>
                                </div>
                                <div className="text-right">
                                    <span className={`text-3xl font-extrabold tracking-tight ${scoreColor.text}`}>
                                        {data.overall_score !== undefined && data.overall_score !== null
                                            ? (Number.isFinite(Number(data.overall_score)) ? <Counter to={Number(data.overall_score)} suffix="%" /> : `${data.overall_score}%`)
                                            : (data.score !== null ? (Number.isFinite(Number(data.score)) ? <Counter to={Number(data.score)} suffix="%" /> : `${data.score}%`) : 'In Progress')}
                                    </span>
                                </div>
                            </div>

                            {/* Round / Section Breakdown */}
                            {((data.round_details && data.round_details.length > 0) || (data.rounds_summary && data.rounds_summary.length > 0)) && (
                                <div className="space-y-3">
                                    <h3 className="text-xs uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">
                                        Section & Round Performance
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {(data.round_details || data.rounds_summary).map((round, idx) => {
                                            const rColor = getScoreColor(round.score);
                                            return (
                                                <motion.div
                                                    key={idx}
                                                    initial={{ opacity: 0, y: 14 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.4, delay: 0.1 + Math.min(idx, 8) * 0.06, ease: EASE }}
                                                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 shadow-2xs space-y-2"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                                            {round.round_name}
                                                        </span>
                                                        <span className={`text-xs font-extrabold px-2 py-0.5 rounded-md border ${rColor.bg} ${rColor.text} ${rColor.border}`}>
                                                            {round.score}%
                                                        </span>
                                                    </div>
                                                    <AnimatedBar value={round.score} tone={round.score >= 75 ? 'emerald' : round.score >= 50 ? 'amber' : 'rose'} height="h-1.5" label={`${round.round_name} score`} />
                                                    {round.feedback && (
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed italic line-clamp-2">
                                                            {round.feedback}
                                                        </p>
                                                    )}
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Executive Summary */}
                            {data.evaluation_summary && (
                                <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-500/30 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                    <span className="font-bold text-emerald-800 dark:text-emerald-300 block">Performance Summary:</span>
                                    <p className="leading-relaxed">{data.evaluation_summary}</p>
                                </div>
                            )}

                            {/* Strengths & Weaknesses */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {data.strengths && data.strengths.length > 0 && (
                                    <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                            <CheckCircle2 className="w-4 h-4" />
                                            <span>Demonstrated Strengths</span>
                                        </div>
                                        <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                            {data.strengths.map((str, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <span className="text-emerald-500 font-bold">•</span>
                                                    <span>{str}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {((data.weaknesses && data.weaknesses.length > 0) || (data.areas_to_improve && data.areas_to_improve.length > 0)) && (
                                    <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                                            <AlertTriangle className="w-4 h-4" />
                                            <span>Areas Needing Work</span>
                                        </div>
                                        <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                            {(data.weaknesses || data.areas_to_improve).map((wk, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <span className="text-amber-500 font-bold">•</span>
                                                    <span>{wk}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2.5 min-h-[40px] text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        Close
                    </button>
                    {data.report_url && (
                        <Link
                            to={data.report_url}
                            className="px-5 py-2.5 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02]"
                        >
                            <span>Open Full Assessment Dossier</span>
                            <ArrowUpRight className="w-4 h-4" />
                        </Link>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
};

/* ─── Main Student Performance View Component ────── */
const StudentPerformanceView = () => {
    const reduceMotion = useReducedMotion();
    const [perfData, setPerfData] = useState(null);
    const [historyData, setHistoryData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters and pagination for history table
    const [selectedCategory, setSelectedCategory] = useState('ALL');
    const [selectedStatus, setSelectedStatus] = useState('ALL');
    const [sortBy, setSortBy] = useState('date_desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');

    // Modal state for viewing assessment details
    const [selectedAssessment, setSelectedAssessment] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Trends filter (category filter for trend graph)
    const [trendFilter, setTrendFilter] = useState('ALL');

    const loadPerformanceData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [dashboardRes, histRes] = await Promise.all([
                studentApi.getPerformanceDashboard(),
                studentApi.getPerformanceHistory({
                    category: selectedCategory,
                    status: selectedStatus,
                    sortBy: sortBy,
                    page: currentPage,
                    pageSize: 8
                })
            ]);
            setPerfData(dashboardRes);
            setHistoryData(histRes);
        } catch (err) {
            console.error("Failed to load student performance data:", err);
            setError(err.response?.data?.detail || "Unable to retrieve performance metrics. Please verify network connectivity.");
        } finally {
            setIsLoading(false);
        }
    };

    // Reload history on filter/page change
    useEffect(() => {
        studentApi.getPerformanceHistory({
            category: selectedCategory,
            status: selectedStatus,
            sortBy: sortBy,
            page: currentPage,
            pageSize: 8
        })
            .then(res => setHistoryData(res))
            .catch(err => console.error("Failed to filter history:", err));
    }, [selectedCategory, selectedStatus, sortBy, currentPage]);

    useEffect(() => {
        loadPerformanceData();
    }, []);

    // Filtered trends points
    const filteredTrendPoints = useMemo(() => {
        if (!perfData?.trends?.data_points) return [];
        if (trendFilter === 'ALL') return perfData.trends.data_points;
        return perfData.trends.data_points.filter(p => p.category_key === trendFilter);
    }, [perfData, trendFilter]);

    // Client-side search on history
    const filteredHistoryItems = useMemo(() => {
        if (!historyData?.items) return [];
        if (!searchQuery.trim()) return historyData.items;
        const q = searchQuery.toLowerCase();
        return historyData.items.filter(i =>
            i.test_name.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q)
        );
    }, [historyData, searchQuery]);

    const handleOpenDetail = (item) => {
        setSelectedAssessment(item);
        setIsModalOpen(true);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center animate-pw-float motion-reduce:animate-none">
                    <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin" />
                </div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Synthesizing Student Performance Analytics</h3>
                    <p className="text-slate-500 text-xs mt-1">Aggregating historical test scores, skills proficiency, and trends...</p>
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
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Unable to Load Performance Dashboard</h2>
                <p className="text-slate-600 dark:text-slate-300 text-xs mb-6 leading-relaxed max-w-md mx-auto">{error}</p>
                <button
                    onClick={loadPerformanceData}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                    Retry Connection
                </button>
            </div>
        );
    }

    const { overview, summary, trends, skills_analysis, recommended_next_steps, recent_activity } = perfData || {};

    const trendColor = trends?.trend_status === 'improving'
        ? { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-500/15', border: 'border-emerald-200 dark:border-emerald-500/30', icon: TrendingUp }
        : trends?.trend_status === 'declining'
        ? { text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-500/15', border: 'border-rose-200 dark:border-rose-500/30', icon: TrendingDown }
        : trends?.trend_status === 'stable'
        ? { text: 'text-cyan-700 dark:text-cyan-300', bg: 'bg-cyan-50 dark:bg-cyan-500/15', border: 'border-cyan-200 dark:border-cyan-500/30', icon: Activity }
        : { text: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800', border: 'border-slate-200 dark:border-slate-700', icon: HelpCircle };

    const TrendIcon = trendColor.icon;

    return (
        <div className="space-y-6 sm:space-y-8 pb-12">
            {/* ─── SECTION A: WELCOME & OVERVIEW ──────────────────── */}
            <PageHero
                icon={Sparkles}
                eyebrow="Student Performance & Analytics"
                title={`Welcome back, ${overview?.student_name || 'Student'}`}
                subtitle="Track your verified test scores, monitor progress across multiple assessment rounds, pinpoint high-yield skills, and review your historical test dossiers."
                actions={(
                    <>
                        <Link
                            to="/student/simulation"
                            className="px-4 py-2.5 min-h-[40px] rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
                        >
                            <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <span>Simulate Drive</span>
                        </Link>
                        <Link
                            to="/student/interview"
                            className="px-4 py-2.5 min-h-[40px] rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
                        >
                            <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            <span>Mock Interview</span>
                        </Link>
                        <Link
                            to="/student/practice"
                            className="px-4 py-2.5 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                        >
                            <Code2 className="w-4 h-4" />
                            <span>DSA Practice</span>
                        </Link>
                    </>
                )}
            >
{/* In-progress Active Test Alert Banner */}
                {overview?.has_active_test && overview.active_test_message && (
                    <div className="pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                                <Clock className="w-4 h-4 animate-pulse" />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-slate-900 dark:text-white">Active Assessment In Progress</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{overview.active_test_message}</p>
                            </div>
                        </div>
                        <Link
                            to="/student/simulation"
                            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0 shadow-xs"
                        >
                            <span>Resume Assessment</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                )}
            </PageHero>

            {/* ─── SECTION B: COMPACT 4-CARD PERFORMANCE SUMMARY ──── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
                {/* 1. Total Tests Completed */}
                <StatCard
                    label="Tests Completed"
                    icon={CheckCircle2}
                    tone="emerald"
                    value={summary?.total_tests_completed || 0}
                    hint={summary?.total_tests_completed === 1 ? '1 valid attempt finalized' : 'Evaluated attempts finalized'}
                    footnote="Excludes in-progress tests"
                />

                {/* 2. Average Score */}
                <StatCard
                    label="Average Score"
                    icon={BarChart3}
                    tone="blue"
                    delay={0.08}
                    value={summary?.average_score !== null && summary?.average_score !== undefined ? (Number.isFinite(Number(summary.average_score)) ? Number(summary.average_score) : `${summary.average_score}`) : 'N/A'}
                    suffix={summary?.average_score !== null && summary?.average_score !== undefined ? '%' : ''}
                    hint={summary?.average_score !== null ? 'Mean completed score' : 'No completed tests yet'}
                    footnote={summary?.improvement_rate !== null ? `${summary.improvement_rate > 0 ? '+' : ''}${summary.improvement_rate}% recent delta` : 'Consistent calculation'}
                />

                {/* 3. Best Performance */}
                <StatCard
                    label="Best Performance"
                    icon={Award}
                    tone="amber"
                    delay={0.16}
                    value={summary?.best_performance ? (Number.isFinite(Number(summary.best_performance.score)) ? Number(summary.best_performance.score) : `${summary.best_performance.score}`) : 'N/A'}
                    suffix={summary?.best_performance ? '%' : ''}
                    hint={<span className="block truncate">{summary?.best_performance ? summary.best_performance.test_name : 'Awaiting first score'}</span>}
                    footnote={summary?.best_performance ? summary.best_performance.formatted_date : 'Benchmark highest score'}
                />

                {/* 4. Tests In Progress */}
                <StatCard
                    label="Tests In Progress"
                    icon={Clock}
                    tone="purple"
                    delay={0.24}
                    value={summary?.tests_in_progress || 0}
                    hint={summary?.tests_in_progress > 0 ? 'Active attempts to finalize' : 'No pending attempts'}
                    footnote={summary?.tests_in_progress > 0 ? 'Action required' : 'All scores up-to-date'}
                />
            </div>

            {/* ─── SECTION C: INTERACTIVE PERFORMANCE TRENDS ───────── */}
            <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                Performance Trajectory Over Time
                            </h2>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Chronological test results reflecting score improvements and consistency.
                        </p>
                    </div>

                    {/* Trend Status Indicator Pill */}
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                        <div className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${trendColor.bg} ${trendColor.text} ${trendColor.border}`}>
                            <TrendIcon className="w-3.5 h-3.5" />
                            <span className="capitalize">{trends?.trend_status?.replace('_', ' ') || 'Stable'}</span>
                        </div>
                    </div>
                </div>

                {/* Trend Narrative Message */}
                {trends?.trend_message && (
                    <div className="px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>{trends.trend_message}</span>
                    </div>
                )}

                {/* Category Filtering Tabs for Trend */}
                <div className="flex flex-wrap items-center gap-2">
                    {[
                        { label: 'All Assessments', key: 'ALL' },
                        { label: 'RoleReady', key: 'ROLEREADY' },
                        { label: 'Simulations', key: 'SIMULATION' },
                        { label: 'Mock Interviews', key: 'MOCK_INTERVIEW' },
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setTrendFilter(tab.key)}
                            className={`px-3.5 py-2.5 sm:py-2 min-h-[40px] rounded-xl text-xs font-semibold transition-all active:scale-95 cursor-pointer ${trendFilter === tab.key ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Recharts Area Chart */}
                {filteredTrendPoints.length === 0 ? (
                    <EmptyState
                        icon={Activity}
                        title="No Assessment Data in This Category"
                        body="Complete an assessment to populate your historical performance trajectory."
                    />
                ) : filteredTrendPoints.length === 1 ? (
                    <div className="py-8 bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-6 text-center border border-slate-200/80 dark:border-slate-700/80">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Single Test Completed</span>
                        <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mb-1 tabular-nums">
                            {filteredTrendPoints[0].score}%
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                            {filteredTrendPoints[0].test_name} on {filteredTrendPoints[0].formatted_date}.
                        </p>
                        <p className="text-[11px] text-slate-400 mt-2">
                            A trend line will connect automatically once you complete a second assessment.
                        </p>
                    </div>
                ) : (
                    <div className="h-64 sm:h-72 w-full pt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={filteredTrendPoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="scoreTrendGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                                <XAxis
                                    dataKey="formatted_date"
                                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                                    axisLine={{ stroke: '#E2E8F0' }}
                                    tickLine={false}
                                />
                                <YAxis
                                    domain={[0, 100]}
                                    ticks={[0, 25, 50, 75, 100]}
                                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip content={<CustomTrendTooltip />} />
                                <Area
                                    isAnimationActive={!reduceMotion}
                                    animationDuration={1400}
                                    animationEasing="ease-out"
                                    type="monotone"
                                    dataKey="score"
                                    stroke="#10B981"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#scoreTrendGradient)"
                                    dot={{ r: 4, fill: '#10B981', stroke: '#FFFFFF', strokeWidth: 2 }}
                                    activeDot={{ r: 6, fill: '#059669', stroke: '#FFFFFF', strokeWidth: 2 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </Reveal>

            {/* ─── SECTION D: PREVIOUS TESTS & ASSESSMENT HISTORY ─── */}
            <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                            Assessment History & Test Dossiers
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Review your completed tests, inspect section scores, and track past performances.
                        </p>
                    </div>

                    {/* Filter controls */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Search Input */}
                        <div className="relative w-full sm:w-auto">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                placeholder="Search test name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full sm:w-auto pl-8 pr-3 py-2.5 sm:py-2 min-h-[40px] rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 focus:border-emerald-500 transition-all"
                            />
                        </div>

                        {/* Category Dropdown */}
                        <select
                            value={selectedCategory}
                            onChange={(e) => { setSelectedCategory(e.target.value); setCurrentPage(1); }}
                            className="flex-1 sm:flex-none min-w-0 px-3 py-2.5 sm:py-2 min-h-[40px] rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                        >
                            <option value="ALL">All Categories</option>
                            <option value="ROLEREADY">RoleReady</option>
                            <option value="SIMULATION">Placement Simulations</option>
                            <option value="MOCK_INTERVIEW">Mock Interviews</option>
                            <option value="ASSIGNED">Recruiter Assigned</option>
                        </select>

                        {/* Status Dropdown */}
                        <select
                            value={selectedStatus}
                            onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
                            className="flex-1 sm:flex-none min-w-0 px-3 py-2.5 sm:py-2 min-h-[40px] rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                        >
                            <option value="ALL">All Statuses</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="IN_PROGRESS">In Progress</option>
                            <option value="ABANDONED">Abandoned</option>
                            <option value="TIMED_OUT">Timed out</option>
                        </select>

                        {/* Sort Dropdown */}
                        <select
                            value={sortBy}
                            onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
                            className="flex-1 sm:flex-none min-w-0 px-3 py-2.5 sm:py-2 min-h-[40px] rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                        >
                            <option value="date_desc">Newest First</option>
                            <option value="date_asc">Oldest First</option>
                            <option value="score_desc">Highest Score</option>
                            <option value="score_asc">Lowest Score</option>
                        </select>
                    </div>
                </div>

                {/* History Items List */}
                {filteredHistoryItems.length === 0 ? (
                    <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                        <Clock className="w-8 h-8 text-emerald-500 mx-auto mb-2 animate-pw-float motion-reduce:animate-none" />
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No Assessment Records Found</h4>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                            {searchQuery || selectedCategory !== 'ALL' || selectedStatus !== 'ALL'
                                ? "No assessments match the selected search or filter criteria."
                                : "You have not completed any formal assessments yet."}
                        </p>
                        {(searchQuery || selectedCategory !== 'ALL' || selectedStatus !== 'ALL') && (
                            <button
                                onClick={() => { setSearchQuery(''); setSelectedCategory('ALL'); setSelectedStatus('ALL'); }}
                                className="mt-3 px-3 py-1.5 text-xs text-emerald-600 font-semibold hover:underline"
                            >
                                Reset filters
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredHistoryItems.map((item, itemIdx) => {
                            const scoreColor = getScoreColor(item.score);
                            return (
                                <motion.div
                                    key={item.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.45, delay: Math.min(itemIdx, 8) * 0.05, ease: EASE }}
                                    className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                                >
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                                                {item.test_name}
                                            </span>
                                            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                {item.category}
                                            </span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'}`}>
                                                {item.status}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                                            <span>Date: {item.formatted_date}</span>
                                            {item.duration_minutes && <span>Duration: {item.duration_minutes}m</span>}
                                        </div>

                                        {/* Round summaries mini-pills */}
                                        {item.rounds_summary && item.rounds_summary.length > 0 && (
                                            <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                                {item.rounds_summary.map((r, rIdx) => (
                                                    <span
                                                        key={rIdx}
                                                        className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                                    >
                                                        {r.round_name.split(':')[0]}: {r.score}%
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-200/60 dark:border-slate-700/60">
                                        <div className="text-left md:text-right">
                                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                                                Score
                                            </span>
                                            <span className={`text-xl font-extrabold ${scoreColor.text}`}>
                                                {item.score !== null ? `${item.score}%` : '—'}
                                            </span>
                                        </div>

                                        <button
                                            onClick={() => handleOpenDetail(item)}
                                            className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer group-hover:border-emerald-300"
                                        >
                                            <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            <span>View Details</span>
                                        </button>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                )}

                {/* Pagination */}
                {historyData && historyData.total_pages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                        <span>
                            Page {historyData.page} of {historyData.total_pages} ({historyData.total_count} total records)
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                disabled={currentPage <= 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                disabled={currentPage >= historyData.total_pages}
                                onClick={() => setCurrentPage(p => Math.min(historyData.total_pages, p + 1))}
                                className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </Reveal>

            {/* ─── SECTION F: SKILLS & STRENGTHS ANALYSIS ──────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Evaluated Skills Performance (Assessment-derived) */}
                <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                    Evaluated Skill Proficiency
                                </h2>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Derived from runtime coding challenges, aptitude accuracy, and interview scores.
                            </p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20">
                            Assessment Verified
                        </span>
                    </div>

                    {!skills_analysis?.has_evaluation_data || skills_analysis?.assessment_skills?.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-500 italic">
                            Complete an assessment or practice problems to compute runtime skill benchmarks.
                        </div>
                    ) : (
                        <div className="space-y-3.5 pt-1">
                            {skills_analysis.assessment_skills.map((skill, idx) => {
                                const sColor = getScoreColor(skill.score);
                                return (
                                    <div key={idx} className="space-y-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                                                {skill.skill}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sColor.bg} ${sColor.text} ${sColor.border}`}>
                                                    {skill.level}
                                                </span>
                                                <span className="font-extrabold text-slate-900 dark:text-white">
                                                    {skill.score}%
                                                </span>
                                            </div>
                                        </div>
                                        <AnimatedBar value={skill.score} tone={skill.score >= 75 ? 'emerald' : skill.score >= 50 ? 'amber' : 'rose'} label={`${skill.skill} proficiency`} />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Reveal>

                {/* Stated vs Evaluated Comparison & Resume Skills */}
                <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-4 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                    Profile & Stated Skills
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Skills extracted from your latest resume and profile configurations.
                                </p>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Resume Estimate
                            </span>
                        </div>

                        {skills_analysis?.resume_skills?.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-6">
                                Upload a resume in the Resume tab to extract profile skills.
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2 pt-4">
                                {skills_analysis.resume_skills.map((sk, idx) => (
                                    <span
                                        key={idx}
                                        className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 text-xs font-medium"
                                    >
                                        {sk}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Explanatory Distinction Callout */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/70 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2.5">
                        <HelpCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <span>
                            <strong>Assessment vs. Resume:</strong> Evaluated skill scores represent runtime accuracy in actual tests; resume estimates indicate stated technologies.
                        </span>
                    </div>
                </Reveal>
            </div>

            {/* ─── SECTION G: RECOMMENDED NEXT STEPS ───────────────── */}
            {recommended_next_steps && recommended_next_steps.length > 0 && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                            Recommended Next Steps
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Data-driven recommendations to strengthen identified weaknesses and advance preparation.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {recommended_next_steps.map((step, stepIdx) => (
                            <motion.div
                                key={step.id}
                                initial={reduceMotion ? false : { opacity: 0, y: 24 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: '-40px' }}
                                transition={{ duration: 0.5, delay: Math.min(stepIdx, 6) * 0.1, ease: EASE }}
                                whileHover={reduceMotion ? undefined : { y: -4 }}
                                className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between group hover:border-emerald-300 transition-all"
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${step.priority === 'high' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                                            {step.priority === 'high' ? 'High Impact' : 'Recommended'}
                                        </span>
                                        <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 transition-colors">
                                        {step.title}
                                    </h3>
                                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                                        {step.description}
                                    </p>
                                </div>

                                <Link
                                    to={step.action_url}
                                    className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-between group-hover:translate-x-0.5 transition-transform"
                                >
                                    <span>{step.action_label}</span>
                                    <ArrowUpRight className="w-4 h-4" />
                                </Link>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )}

            {/* ─── SECTION H: RECENT ACTIVITY TIMELINE ─────────────── */}
            {recent_activity && recent_activity.length > 0 && (
                <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-xs space-y-4">
                    <div className="flex items-center gap-2">
                        <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                            Recent Assessment & Learning Activity
                        </h2>
                    </div>

                    <div className="space-y-3 pt-1">
                        {recent_activity.map((act, actIdx) => (
                            <motion.div
                                key={act.id}
                                initial={reduceMotion ? false : { opacity: 0, x: -16 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true, margin: '-30px' }}
                                transition={{ duration: 0.4, delay: Math.min(actIdx, 8) * 0.05, ease: EASE }}
                                className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 text-xs"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                                        {act.type === 'practice' ? <Code2 className="w-4 h-4" /> :
                                         act.type === 'roadmap' ? <Compass className="w-4 h-4" /> :
                                         act.type === 'interview' ? <MessageSquare className="w-4 h-4" /> :
                                         <Award className="w-4 h-4" />}
                                    </div>
                                    <div>
                                        <span className="font-bold text-slate-900 dark:text-white block">
                                            {act.title}
                                        </span>
                                        <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                                            {act.description}
                                        </span>
                                    </div>
                                </div>
                                <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                                    {act.formatted_time}
                                </span>
                            </motion.div>
                        ))}
                    </div>
                </Reveal>
            )}

            {/* Assessment Details Modal */}
            <AssessmentDetailModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                assessment={selectedAssessment}
            />
        </div>
    );
};

export default StudentPerformanceView;
