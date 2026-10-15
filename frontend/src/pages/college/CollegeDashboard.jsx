import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Users,
    Award,
    AlertTriangle,
    Building2,
    CheckCircle2,
    TrendingUp,
    ArrowUpRight,
    RefreshCw,
    Sparkles,
    Target,
    BookOpen,
} from 'lucide-react';
import collegeApi from '../../services/collegeApi';

const CollegeDashboard = () => {
    const [overview, setOverview] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadOverview = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await collegeApi.getOverview();
            setOverview(data);
        } catch (err) {
            console.error('Failed to load college overview:', err);
            setError(err.response?.data?.detail || 'Failed to load cohort analytics.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadOverview();
    }, []);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
                <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                <p className="text-slate-400 text-sm">Loading cohort readiness analytics...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="max-w-2xl mx-auto bg-slate-800/80 border border-rose-500/30 rounded-2xl p-8 text-center">
                <AlertTriangle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-white mb-2">Unable to load cohort overview</h2>
                <p className="text-slate-300 text-sm mb-6">{error}</p>
                <button
                    onClick={loadOverview}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition-all"
                >
                    Try Again
                </button>
            </div>
        );
    }

    const {
        total_students = 0,
        average_readiness_score = 0,
        high_readiness_count = 0,
        moderate_readiness_count = 0,
        at_risk_count = 0,
        total_drives = 0,
        active_drives = 0,
        total_applications = 0,
        total_placed = 0,
        top_cohort_skills = [],
        common_skill_gaps = [],
        branch_distribution = {}
    } = overview || {};

    const highPct = total_students ? Math.round((high_readiness_count / total_students) * 100) : 0;
    const modPct = total_students ? Math.round((moderate_readiness_count / total_students) * 100) : 0;
    const riskPct = total_students ? Math.round((at_risk_count / total_students) * 100) : 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                        Cohort Placement & Readiness Intelligence
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Executive oversight of student placement preparedness, skill gaps, and campus hiring drives.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        to="/college/drives"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl flex items-center gap-2 shadow-sm transition-all"
                    >
                        <Building2 className="w-4 h-4" />
                        <span>Manage Placement Drives</span>
                    </Link>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
                {/* 1. Total Students */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Total Enrolled</span>
                        <Users className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <span className="text-3xl font-extrabold text-white tracking-tight">{total_students}</span>
                        <p className="text-xs text-slate-400 mt-1">Active student profiles</p>
                    </div>
                    <Link to="/college/students" className="mt-3 text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-medium">
                        View Roster <ArrowUpRight className="w-3 h-3" />
                    </Link>
                </div>

                {/* 2. Average Readiness */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Avg Readiness</span>
                        <Award className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl font-extrabold text-white tracking-tight">{average_readiness_score}</span>
                            <span className="text-slate-400 text-sm">/ 100</span>
                        </div>
                        <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                            <div 
                                className="bg-emerald-500 h-full rounded-full"
                                style={{ width: `${Math.min(100, Math.max(5, average_readiness_score))}%` }}
                            />
                        </div>
                    </div>
                    <span className="mt-3 text-[11px] text-slate-400">Cohort mean score</span>
                </div>

                {/* 3. At-Risk Students */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase font-bold tracking-wider text-slate-400">At-Risk Count</span>
                        <AlertTriangle className="w-5 h-5 text-rose-400" />
                    </div>
                    <div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl font-extrabold text-white tracking-tight">{at_risk_count}</span>
                            <span className="text-xs text-rose-400 font-medium">({riskPct}%)</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">Readiness below 50%</p>
                    </div>
                    <Link to="/college/students?min_readiness=0" className="mt-3 text-[11px] text-rose-400 hover:underline flex items-center gap-1 font-medium">
                        Target Interventions <ArrowUpRight className="w-3 h-3" />
                    </Link>
                </div>

                {/* 4. Active Placement Drives */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Campus Drives</span>
                        <Building2 className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl font-extrabold text-white tracking-tight">{active_drives}</span>
                            <span className="text-xs text-slate-400">active ({total_drives} total)</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{total_applications} applications submitted</p>
                    </div>
                    <Link to="/college/drives" className="mt-3 text-[11px] text-cyan-400 hover:underline flex items-center gap-1 font-medium">
                        Manage Drives <ArrowUpRight className="w-3 h-3" />
                    </Link>
                </div>

                {/* 5. Placed Candidates */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Placed Students</span>
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <span className="text-3xl font-extrabold text-white tracking-tight">{total_placed}</span>
                        <p className="text-xs text-slate-400 mt-1">Confirmed offers</p>
                    </div>
                    <span className="mt-3 text-[11px] text-slate-400">Campus placements</span>
                </div>
            </div>

            {/* Readiness Tier Distribution Breakdown */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-bold text-white">Placement Readiness Tier Distribution</h2>
                    </div>
                    <span className="text-xs text-slate-400">Cohort Segmentation</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* High Tier */}
                    <div className="bg-slate-900/60 border border-emerald-500/30 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-emerald-400">High Readiness (≥ 75%)</span>
                            <span className="text-xs font-bold text-white">{high_readiness_count} students</span>
                        </div>
                        <div className="my-2.5">
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">{highPct}%</span>
                                <span className="text-xs text-emerald-400">Placement-ready</span>
                            </div>
                            <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
                                <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${highPct}%` }} />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-400">Suitable for Tier 1 / product company hiring drives.</p>
                    </div>

                    {/* Moderate Tier */}
                    <div className="bg-slate-900/60 border border-amber-500/30 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-amber-400">Moderate Readiness (50-74%)</span>
                            <span className="text-xs font-bold text-white">{moderate_readiness_count} students</span>
                        </div>
                        <div className="my-2.5">
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">{modPct}%</span>
                                <span className="text-xs text-amber-400">Fast improvement</span>
                            </div>
                            <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
                                <div className="bg-amber-500 h-full rounded-full" style={{ width: `${modPct}%` }} />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-400">Need targeted mock interviews and ATS resume revisions.</p>
                    </div>

                    {/* At-Risk Tier */}
                    <div className="bg-slate-900/60 border border-rose-500/30 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-rose-400">At-Risk Tier (&lt; 50%)</span>
                            <span className="text-xs font-bold text-white">{at_risk_count} students</span>
                        </div>
                        <div className="my-2.5">
                            <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">{riskPct}%</span>
                                <span className="text-xs text-rose-400">Immediate action</span>
                            </div>
                            <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
                                <div className="bg-rose-500 h-full rounded-full" style={{ width: `${riskPct}%` }} />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-400">Requires foundational DSA practice and structured roadmap.</p>
                    </div>
                </div>
            </div>

            {/* Top Skills & Common Curriculum Gaps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Skills in Cohort */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700/60">
                        <Sparkles className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-bold text-white">Top Technical Skills in Cohort</h2>
                    </div>
                    {top_cohort_skills.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No skill profiles recorded yet.</p>
                    ) : (
                        <div className="space-y-3">
                            {top_cohort_skills.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs">
                                    <span className="text-slate-200 font-medium">{item.skill}</span>
                                    <div className="flex items-center gap-3">
                                        <div className="w-28 bg-slate-700 h-2 rounded-full overflow-hidden hidden sm:block">
                                            <div 
                                                className="bg-indigo-500 h-full rounded-full"
                                                style={{ width: `${item.percentage}%` }}
                                            />
                                        </div>
                                        <span className="text-slate-400 text-[11px] w-14 text-right">
                                            {item.count} ({item.percentage}%)
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Common Skill Gaps & Deficits */}
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700/60">
                        <Target className="w-5 h-5 text-amber-400" />
                        <h2 className="text-base font-bold text-white">Cohort Skill Deficits & Training Needs</h2>
                    </div>
                    {common_skill_gaps.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No critical skill gaps identified across cohort.</p>
                    ) : (
                        <div className="space-y-3">
                            {common_skill_gaps.map((gap, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        <span className="text-slate-200 font-medium">{gap.skill}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-28 bg-slate-700 h-2 rounded-full overflow-hidden hidden sm:block">
                                            <div 
                                                className="bg-amber-500 h-full rounded-full"
                                                style={{ width: `${gap.percentage}%` }}
                                            />
                                        </div>
                                        <span className="text-amber-400 text-[11px] w-20 text-right font-medium">
                                            {gap.missing_students_count} missing ({gap.percentage}%)
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Branch Distribution */}
            {Object.keys(branch_distribution).length > 0 && (
                <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                        <BookOpen className="w-5 h-5 text-cyan-400" />
                        <h2 className="text-base font-bold text-white">Branch Enrollment Distribution</h2>
                    </div>
                    <div className="flex flex-wrap gap-2.5 pt-2">
                        {Object.entries(branch_distribution).map(([branch, count]) => (
                            <div 
                                key={branch}
                                className="px-3.5 py-2 bg-slate-900/80 border border-slate-700 rounded-xl flex items-center gap-2 text-xs"
                            >
                                <span className="text-slate-300 font-medium">{branch}</span>
                                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[11px] font-bold">
                                    {count}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CollegeDashboard;
