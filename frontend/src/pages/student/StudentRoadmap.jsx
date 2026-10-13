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
    DSA: { label: 'DSA & Algorithms', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: Code2 },
    TECHNICAL_SKILL: { label: 'Technical Stack', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', icon: Layers },
    APTITUDE: { label: 'Aptitude & Reasoning', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: Brain },
    SYSTEM_DESIGN: { label: 'System Design', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: BookOpen },
    RESUME: { label: 'Resume & Portfolio', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: FileText },
    MOCK_INTERVIEW: { label: 'Mock Interview', color: 'bg-teal-500/10 text-teal-400 border-teal-500/20', icon: Compass }
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
                    <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                    <p className="text-slate-400 font-medium">Constructing personalized preparation roadmap...</p>
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
            <div className="bg-slate-800/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                <Calendar className="w-6 h-6" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-2xl font-bold text-white tracking-tight">{roadmap?.title}</h1>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                                        Active Plan
                                    </span>
                                </div>
                                <p className="text-slate-400 text-sm mt-0.5">
                                    Target Role: <strong className="text-white">{roadmap?.target_role}</strong> · {roadmap?.total_weeks} Weeks Curriculum
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Progress Stat & Regenerate Launcher */}
                    <div className="flex items-center gap-4 self-start md:self-auto">
                        <div className="text-right hidden sm:block">
                            <div className="text-2xl font-extrabold text-white">
                                {roadmap?.completed_tasks || 0} / {roadmap?.total_tasks || 0}
                            </div>
                            <div className="text-xs text-slate-400">tasks completed ({completionRate}%)</div>
                        </div>

                        <button
                            onClick={() => setShowRegenConfirm(true)}
                            disabled={isRegenerating}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold transition-all"
                            title="Regenerate roadmap based on updated skills while keeping completed tasks"
                        >
                            <RotateCcw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                            Regenerate
                        </button>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-6 pt-5 border-t border-slate-700/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                        <span>Roadmap Completion Progress</span>
                        <span className="font-bold text-white">{completionRate}%</span>
                    </div>
                    <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden">
                        <div 
                            className="bg-gradient-to-r from-indigo-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(completionRate, 100)}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Regeneration Confirmation Dialog */}
            {showRegenConfirm && (
                <div className="bg-slate-900/90 border border-indigo-500/40 rounded-2xl p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-indigo-400 shrink-0" />
                        <div>
                            <h4 className="text-sm font-bold text-white">Regenerate Preparation Plan?</h4>
                            <p className="text-xs text-slate-400">
                                This re-evaluates your latest skill gaps and recalibrates pending tasks. Your <strong>{roadmap?.completed_tasks || 0} completed task(s) will be strictly preserved</strong>.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                        <button
                            onClick={() => setShowRegenConfirm(false)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleRegenerateRoadmap}
                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/20"
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
                            className={`px-4 py-2.5 rounded-xl font-semibold text-xs transition-all whitespace-nowrap flex items-center gap-2 ${
                                activeWeek === w.week_number
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                                    : 'bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700/50'
                            }`}
                        >
                            <span>Week {w.week_number}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                activeWeek === w.week_number ? 'bg-indigo-700 text-indigo-200' : 'bg-slate-900 text-slate-400'
                            }`}>
                                {w.completed_count}/{w.total_count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2 self-start md:self-auto">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-400 font-medium">Filter:</span>
                    {['ALL', 'PENDING', 'COMPLETED'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setStatusFilter(f)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                statusFilter === f 
                                    ? 'bg-slate-700 text-white' 
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            {f === 'ALL' ? 'All' : f === 'PENDING' ? 'Active' : 'Done'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Week Title & Description */}
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-5 py-3.5 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-white">{currentWeekData?.title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {currentWeekData?.completed_count} of {currentWeekData?.total_count} daily milestones completed
                    </p>
                </div>
                <div className="text-xs font-semibold text-indigo-400">
                    Week {activeWeek} of {roadmap?.total_weeks}
                </div>
            </div>

            {/* Daily Task Cards List */}
            <div className="space-y-4">
                {filteredTasks.length === 0 ? (
                    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-8 text-center text-slate-400 text-sm">
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
                                className={`border rounded-2xl p-5 transition-all shadow-md ${
                                    isCompleted 
                                        ? 'bg-slate-900/60 border-emerald-500/30' 
                                        : isInProgress
                                        ? 'bg-slate-800/90 border-indigo-500/50'
                                        : 'bg-slate-800/80 border-slate-700/60 hover:border-slate-600'
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
                                                    ? 'bg-emerald-500 border-emerald-500 text-white'
                                                    : 'border-slate-600 hover:border-indigo-400 bg-slate-900'
                                            }`}
                                            title={isCompleted ? 'Mark as Incomplete' : 'Mark as Completed'}
                                        >
                                            {isCompleted && <Check className="w-4 h-4 stroke-[3]" />}
                                        </button>

                                        <div className="space-y-1.5 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                    Day {task.day_number}
                                                </span>
                                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${catConfig.color}`}>
                                                    <CatIcon className="w-3 h-3" />
                                                    {catConfig.label}
                                                </span>
                                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                                    <Clock className="w-3 h-3" />
                                                    {task.estimated_minutes} mins
                                                </span>
                                            </div>

                                            <h4 className={`text-base font-bold transition-colors ${
                                                isCompleted ? 'text-slate-400 line-through' : 'text-white'
                                            }`}>
                                                {task.title}
                                            </h4>

                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                {task.description}
                                            </p>

                                            {/* Why Recommended Callout */}
                                            {task.why_recommended && (
                                                <div className="pt-2 flex items-start gap-1.5 text-xs text-indigo-300">
                                                    <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
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
                                                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' 
                                                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                                                }`}
                                            >
                                                {isInProgress ? 'In Progress' : 'Start Task'}
                                            </button>
                                        )}
                                        {isCompleted && (
                                            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
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
