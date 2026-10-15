import React, { useState, useEffect } from 'react';
import { 
    Calendar, 
    CheckCircle2, 
    Clock, 
    Sparkles, 
    RotateCcw, 
    Target, 
    Layers, 
    BookOpen, 
    Code2, 
    Brain, 
    FileText, 
    Compass, 
    ChevronRight,
    RefreshCw,
    Filter,
    Check,
    AlertCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import studentApi from '../../services/studentApi';

const CATEGORY_CONFIG = {
    DSA: { label: 'DSA & Algorithms', color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', icon: Code2 },
    TECHNICAL_SKILL: { label: 'Technical Stack', color: 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-500/20', icon: Layers },
    APTITUDE: { label: 'Aptitude & Reasoning', color: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20', icon: Brain },
    SYSTEM_DESIGN: { label: 'System Design', color: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/20', icon: BookOpen },
    RESUME: { label: 'Resume & Portfolio', color: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20', icon: FileText },
    MOCK_INTERVIEW: { label: 'Mock Interview', color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', icon: Compass }
};

const StudentRoadmap = () => {
    const [roadmap, setRoadmap] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeWeek, setActiveWeek] = useState(1);
    const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'COMPLETED'
    const [isUpdatingTaskId, setIsUpdatingTaskId] = useState(null);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [showRegenConfirm, setShowRegenConfirm] = useState(false);

    useEffect(() => {
        loadRoadmap();
    }, []);

    const loadRoadmap = async () => {
        setIsLoading(true);
        try {
            const data = await studentApi.getRoadmap();
            setRoadmap(data);
            if (data?.current_week) {
                setActiveWeek(data.current_week);
            }
        } catch (error) {
            console.error('Failed to load roadmap:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTaskStatusChange = async (task, newStatus) => {
        setIsUpdatingTaskId(task.id);
        try {
            await studentApi.updateDailyTaskStatus(task.id, newStatus);
            // Refresh roadmap data to update progress counts
            const updated = await studentApi.getRoadmap();
            setRoadmap(updated);
        } catch (error) {
            console.error('Failed to update task status:', error);
        } finally {
            setIsUpdatingTaskId(null);
        }
    };

    const handleRegenerateRoadmap = async () => {
        setIsRegenerating(true);
        setShowRegenConfirm(false);
        try {
            const updated = await studentApi.generateRoadmap(roadmap?.target_role, true);
            setRoadmap(updated);
        } catch (error) {
            console.error('Failed to regenerate roadmap:', error);
        } finally {
            setIsRegenerating(false);
        }
    };

    if (isLoading && !roadmap) {
        return (
            <div className="flex items-center justify-center min-h-[500px]">
                <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
                    <p className="text-slate-600 dark:text-slate-400 font-medium">Constructing personalized preparation roadmap...</p>
                </div>
            </div>
        );
    }

    const currentWeekData = roadmap?.weeks?.find(w => w.week_number === activeWeek) || roadmap?.weeks?.[0];

    const filteredTasks = (currentWeekData?.tasks || []).filter(task => {
        if (statusFilter === 'ALL') return true;
        if (statusFilter === 'COMPLETED') return task.status === 'COMPLETED';
        if (statusFilter === 'PENDING') return task.status === 'PENDING' || task.status === 'IN_PROGRESS';
        return true;
    });

    const completionRate = roadmap?.completion_rate || 0;

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            {/* Header & Overview Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                                <Calendar className="w-6 h-6" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{roadmap?.title}</h1>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-semibold">
                                        Active Plan
                                    </span>
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                                    Target Role: <strong className="text-slate-900 dark:text-white">{roadmap?.target_role}</strong> · {roadmap?.total_weeks} Weeks Curriculum
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Progress Stat & Regenerate Launcher */}
                    <div className="flex items-center gap-4 self-start md:self-auto">
                        <div className="text-right hidden sm:block">
                            <div className="text-2xl font-extrabold text-slate-900 dark:text-white">
                                {roadmap?.completed_tasks || 0} / {roadmap?.total_tasks || 0}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">tasks completed ({completionRate}%)</div>
                        </div>

                        <button
                            onClick={() => setShowRegenConfirm(true)}
                            disabled={isRegenerating}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-all shadow-xs"
                            title="Regenerate roadmap based on updated skills while keeping completed tasks"
                        >
                            <RotateCcw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                            Regenerate
                        </button>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                        <span>Roadmap Completion Progress</span>
                        <span className="font-bold text-slate-900 dark:text-white">{completionRate}%</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div 
                            className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(completionRate, 100)}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Regeneration Confirmation Dialog */}
            {showRegenConfirm && (
                <div className="bg-slate-50 dark:bg-slate-900 border border-emerald-500/30 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Regenerate Preparation Plan?</h4>
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                                This re-evaluates your latest skill gaps and recalibrates pending tasks. Your <strong>{roadmap?.completed_tasks || 0} completed task(s) will be strictly preserved</strong>.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                        <button
                            onClick={() => setShowRegenConfirm(false)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleRegenerateRoadmap}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs"
                        >
                            Confirm & Regenerate
                        </button>
                    </div>
                </div>
            )}

            {/* Week Selection Tabs & Filter Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Week Tabs */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
                    {roadmap?.weeks?.map((w) => (
                        <button
                            key={w.week_number}
                            onClick={() => setActiveWeek(w.week_number)}
                            className={`px-4 py-2 rounded-xl font-semibold text-xs transition-all whitespace-nowrap flex items-center gap-2 ${
                                activeWeek === w.week_number
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200/90 dark:border-slate-800 shadow-xs'
                            }`}
                        >
                            <span>Week {w.week_number}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                activeWeek === w.week_number ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                            }`}>
                                {w.completed_count}/{w.total_count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2 self-start md:self-auto">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Filter:</span>
                    {['ALL', 'PENDING', 'COMPLETED'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setStatusFilter(f)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                statusFilter === f 
                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' 
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {f === 'ALL' ? 'All' : f === 'PENDING' ? 'Active' : 'Done'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Week Title & Description */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl px-5 py-3.5 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{currentWeekData?.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {currentWeekData?.completed_count} of {currentWeekData?.total_count} daily milestones completed
                    </p>
                </div>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Week {activeWeek} of {roadmap?.total_weeks}
                </div>
            </div>

            {/* Daily Task Cards List */}
            <div className="space-y-4">
                {filteredTasks.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                        No tasks match the selected filter.
                    </div>
                ) : (
                    filteredTasks.map((task) => {
                        const isCompleted = task.status === 'COMPLETED';
                        const isInProgress = task.status === 'IN_PROGRESS';
                        const catConfig = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.TECHNICAL_SKILL;
                        const CatIcon = catConfig.icon;

                        return (
                            <div 
                                key={task.id}
                                className={`border rounded-2xl p-5 transition-all shadow-xs ${
                                    isCompleted 
                                        ? 'bg-slate-50/60 dark:bg-slate-900/60 border-emerald-500/30' 
                                        : isInProgress
                                        ? 'bg-white dark:bg-slate-800/90 border-2 border-emerald-500/50'
                                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                    {/* Task Checkbox & Main Info */}
                                    <div className="flex items-start gap-4 flex-1">
                                        {/* Status Toggle Button */}
                                        <button
                                            onClick={() => {
                                                const nextStatus = isCompleted ? 'PENDING' : 'COMPLETED';
                                                handleTaskStatusChange(task, nextStatus);
                                            }}
                                            disabled={isUpdatingTaskId === task.id}
                                            className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                                                isCompleted
                                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                                    : 'border-slate-300 dark:border-slate-600 hover:border-emerald-500 bg-slate-50 dark:bg-slate-800'
                                            }`}
                                            title={isCompleted ? 'Mark as Incomplete' : 'Mark as Completed'}
                                        >
                                            {isCompleted && <Check className="w-4 h-4 stroke-[3]" />}
                                        </button>

                                        <div className="space-y-1.5 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                                    Day {task.day_number}
                                                </span>
                                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${catConfig.color}`}>
                                                    <CatIcon className="w-3 h-3" />
                                                    {catConfig.label}
                                                </span>
                                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                    <Clock className="w-3 h-3" />
                                                    {task.estimated_minutes} mins
                                                </span>
                                            </div>

                                            <h4 className={`text-base font-bold transition-colors ${
                                                isCompleted ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-900 dark:text-white'
                                            }`}>
                                                {task.title}
                                            </h4>

                                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                                {task.description}
                                            </p>

                                            {/* Why Recommended Callout */}
                                            {task.why_recommended && (
                                                <div className="pt-2 flex items-start gap-1.5 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                                    <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                                    <span><strong>Why Recommended:</strong> {task.why_recommended}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Status Menu */}
                                    <div className="flex items-center gap-2 self-end sm:self-start">
                                        {!isCompleted && (
                                            <button
                                                onClick={() => handleTaskStatusChange(task, isInProgress ? 'PENDING' : 'IN_PROGRESS')}
                                                disabled={isUpdatingTaskId === task.id}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                    isInProgress 
                                                        ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40' 
                                                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                }`}
                                            >
                                                {isInProgress ? 'In Progress' : 'Start Task'}
                                            </button>
                                        )}
                                        {isCompleted && (
                                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default StudentRoadmap;
