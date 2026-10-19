import React, { useState, useEffect } from 'react';
import {
    Calendar,
    CheckCircle2,
    Clock,
    Sparkles,
    RotateCcw,
    Layers,
    BookOpen,
    Code2,
    Brain,
    FileText,
    Compass,
    RefreshCw,
    Filter,
    Check,
    AlertCircle,
    ScanSearch,
    CalendarRange,
    ListChecks,
    Scale,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero, Stagger, StaggerItem, AnimatedBar } from '../../components/student-ui/StudentMotion';
import { Counter, EASE } from '../../components/home/primitives';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';

const CATEGORY_CONFIG = {
    DSA: { label: 'DSA & Algorithms', color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', icon: Code2 },
    TECHNICAL_SKILL: { label: 'Technical Stack', color: 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-500/20', icon: Layers },
    APTITUDE: { label: 'Aptitude & Reasoning', color: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20', icon: Brain },
    SYSTEM_DESIGN: { label: 'System Design', color: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/20', icon: BookOpen },
    RESUME: { label: 'Resume & Portfolio', color: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20', icon: FileText },
    MOCK_INTERVIEW: { label: 'Mock Interview', color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', icon: Compass }
};

const ROADMAP_STAGES = [
    { icon: ScanSearch, label: 'Reading your skill gaps' },
    { icon: CalendarRange, label: 'Planning 4 weeks' },
    { icon: ListChecks, label: 'Assigning daily tasks' },
    { icon: Scale, label: 'Balancing DSA and aptitude' },
];
const ROADMAP_TIPS = [
    'Small daily wins beat weekend marathons.',
    'Tasks you already completed are never touched.',
    'Tap Start Task to mark what you are working on today.',
];

/** Circular completion ring derived from completion_rate. */
const ProgressRing = ({ value = 0 }) => {
    const reduce = useReducedMotion();
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    const r = 26;
    const c = 2 * Math.PI * r;
    return (
        <svg viewBox="0 0 64 64" className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 -rotate-90" aria-hidden="true">
            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-slate-100 dark:stroke-slate-800" />
            <motion.circle
                cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
                stroke="#10b981"
                strokeDasharray={c}
                initial={reduce ? false : { strokeDashoffset: c }}
                animate={{ strokeDashoffset: c * (1 - pct / 100) }}
                transition={{ duration: 1.2, ease: EASE }}
            />
        </svg>
    );
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
            <AssessmentLoadingOverlay
                open
                title="Building your roadmap"
                subtitle="Constructing personalized preparation roadmap..."
                stages={ROADMAP_STAGES}
                tips={ROADMAP_TIPS}
                footnote="Please keep this page open. This usually takes a few seconds."
            />
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
    const totalTasks = roadmap?.total_tasks || 0;
    const doneTasks = roadmap?.completed_tasks || 0;
    const weekLeft = Math.max(0, (currentWeekData?.total_count || 0) - (currentWeekData?.completed_count || 0));
    const weekPct = currentWeekData?.total_count ? Math.round(((currentWeekData?.completed_count || 0) / currentWeekData.total_count) * 100) : 0;

    return (
        <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto min-w-0">
            <AssessmentLoadingOverlay
                open={isRegenerating}
                title="Building your roadmap"
                subtitle="Your completed tasks stay exactly as they are."
                stages={ROADMAP_STAGES}
                tips={ROADMAP_TIPS}
                footnote="Please keep this page open. This usually takes a few seconds."
            />

            {/* Header & Overview Card */}
            <PageHero
                icon={Calendar}
                eyebrow="Active Plan"
                title={roadmap?.title}
                subtitle={(
                    <>
                        Target Role: <strong className="text-slate-900 dark:text-white">{roadmap?.target_role}</strong> · {roadmap?.total_weeks} Weeks Curriculum
                    </>
                )}
                actions={(
                    <div className="flex items-center gap-4 sm:gap-5 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="flex items-center gap-3">
                            <ProgressRing value={completionRate} />
                            <div>
                                <div className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                                    <Counter to={doneTasks} /> / {totalTasks}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">tasks completed ({completionRate}%)</div>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowRegenConfirm(true)}
                            disabled={isRegenerating}
                            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-all shadow-xs active:scale-95"
                            title="Regenerate roadmap based on updated skills while keeping completed tasks"
                        >
                            <RotateCcw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                            Regenerate
                        </button>
                    </div>
                )}
            >
                {/* Progress Bar */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2 gap-3">
                        <span>Roadmap Completion Progress</span>
                        <span className="font-bold text-slate-900 dark:text-white tabular-nums">{completionRate}%</span>
                    </div>
                    <AnimatedBar value={Math.min(completionRate, 100)} tone="emerald" height="h-2.5" label="Roadmap completion" />
                    {totalTasks > 0 && (
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {doneTasks >= totalTasks
                                ? 'Every task done. Outstanding work!'
                                : doneTasks > 0
                                    ? `${totalTasks - doneTasks} to go. Keep the momentum going.`
                                    : 'Complete your first task to get the ball rolling.'}
                        </p>
                    )}
                </div>
            </PageHero>

            {/* Regeneration Confirmation Dialog */}
            <AnimatePresence>
                {showRegenConfirm && (
                    <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.98 }}
                        transition={{ duration: 0.25 }}
                        className="bg-slate-50 dark:bg-slate-900 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4"
                    >
                        <div className="flex items-start sm:items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <div>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Regenerate Preparation Plan?</h4>
                                <p className="text-xs text-slate-600 dark:text-slate-400">
                                    This re-evaluates your latest skill gaps and recalibrates pending tasks. Your <strong>{roadmap?.completed_tasks || 0} completed task(s) will be strictly preserved</strong>.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 justify-end">
                            <button
                                onClick={() => setShowRegenConfirm(false)}
                                className="min-h-[44px] px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRegenerateRoadmap}
                                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs active:scale-95"
                            >
                                Confirm & Regenerate
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Week Selection Tabs & Filter Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
                {/* Week Tabs */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 -mx-1 px-1 min-w-0">
                    {roadmap?.weeks?.map((w) => (
                        <button
                            key={w.week_number}
                            onClick={() => setActiveWeek(w.week_number)}
                            className={`relative min-h-[44px] px-4 py-2 rounded-xl font-semibold text-xs transition-colors whitespace-nowrap flex items-center gap-2 shrink-0 ${
                                activeWeek === w.week_number
                                    ? 'text-white shadow-xs'
                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200/90 dark:border-slate-800 shadow-xs'
                            }`}
                        >
                            {activeWeek === w.week_number && (
                                <motion.span
                                    layoutId="roadmap-week-pill"
                                    className="absolute inset-0 rounded-xl bg-emerald-600"
                                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                                />
                            )}
                            <span className="relative">Week {w.week_number}</span>
                            <span className={`relative text-[10px] px-1.5 py-0.5 rounded-full ${
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
                            className={`relative min-h-[40px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                statusFilter === f
                                    ? 'text-slate-900 dark:text-white'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {statusFilter === f && (
                                <motion.span
                                    layoutId="roadmap-filter-pill"
                                    className="absolute inset-0 rounded-lg bg-slate-200 dark:bg-slate-700"
                                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                                />
                            )}
                            <span className="relative">{f === 'ALL' ? 'All' : f === 'PENDING' ? 'Active' : 'Done'}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Week Title & Description */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-4 sm:px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{currentWeekData?.title}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {currentWeekData?.completed_count} of {currentWeekData?.total_count} daily milestones completed
                            {weekLeft > 0 ? ` · ${weekLeft} left this week` : currentWeekData?.total_count ? ' · week cleared' : ''}
                        </p>
                    </div>
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                        Week {activeWeek} of {roadmap?.total_weeks}
                    </div>
                </div>
                <AnimatedBar key={activeWeek} value={weekPct} tone="emerald" height="h-1.5" className="mt-3" label="Week progress" />
            </div>

            {/* Daily Task Cards List */}
            <div className="relative space-y-3 sm:space-y-4 sm:pl-6">
                <div aria-hidden="true" className="hidden sm:block absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-emerald-300 via-slate-200 to-transparent dark:from-emerald-700 dark:via-slate-800" />
                {filteredTasks.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                        No tasks match the selected filter.
                    </div>
                ) : (
                    <Stagger key={`${activeWeek}-${statusFilter}`} className="space-y-3 sm:space-y-4" gap={0.06}>
                    {filteredTasks.map((task) => {
                        const isCompleted = task.status === 'COMPLETED';
                        const isInProgress = task.status === 'IN_PROGRESS';
                        const catConfig = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.TECHNICAL_SKILL;
                        const CatIcon = catConfig.icon;

                        return (
                            <StaggerItem key={task.id} className="relative">
                                <span aria-hidden="true" className={`hidden sm:block absolute -left-6 top-6 w-[15px] h-[15px] rounded-full border-2 transition-colors ${
                                    isCompleted ? 'bg-emerald-500 border-emerald-500' : isInProgress ? 'bg-white dark:bg-slate-900 border-emerald-500' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                                }`} />
                            <div
                                className={`border rounded-2xl p-4 sm:p-5 transition-all shadow-xs hover:-translate-y-0.5 hover:shadow-md ${
                                    isCompleted
                                        ? 'bg-slate-50/60 dark:bg-slate-900/60 border-emerald-500/30'
                                        : isInProgress
                                        ? 'bg-white dark:bg-slate-800/90 border-2 border-emerald-500/50'
                                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                    {/* Task Checkbox & Main Info */}
                                    <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                                        {/* Status Toggle Button */}
                                        <button
                                            onClick={() => {
                                                const nextStatus = isCompleted ? 'PENDING' : 'COMPLETED';
                                                handleTaskStatusChange(task, nextStatus);
                                            }}
                                            disabled={isUpdatingTaskId === task.id}
                                            className="relative w-10 h-10 -m-2 shrink-0 flex items-center justify-center group"
                                            title={isCompleted ? 'Mark as Incomplete' : 'Mark as Completed'}
                                        >
                                            <span className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all group-active:scale-90 ${
                                                isCompleted
                                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                                    : 'border-slate-300 dark:border-slate-600 group-hover:border-emerald-500 bg-slate-50 dark:bg-slate-800'
                                            }`}>
                                                <AnimatePresence initial={false}>
                                                    {isCompleted && (
                                                        <motion.span
                                                            key="check"
                                                            initial={{ scale: 0, rotate: -45 }}
                                                            animate={{ scale: 1, rotate: 0 }}
                                                            exit={{ scale: 0 }}
                                                            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                                                            className="flex"
                                                        >
                                                            <Check className="w-4 h-4 stroke-[3]" />
                                                        </motion.span>
                                                    )}
                                                </AnimatePresence>
                                            </span>
                                            {isUpdatingTaskId === task.id && (
                                                <span aria-hidden="true" className="absolute inset-1 rounded-lg border-2 border-emerald-400/60 border-t-transparent animate-spin" />
                                            )}
                                        </button>

                                        <div className="space-y-1.5 flex-1 min-w-0">
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

                                            <h4 className={`text-base font-bold transition-colors break-words ${
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
                                                className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
                                                    isInProgress
                                                        ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40'
                                                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                }`}
                                            >
                                                {isInProgress ? 'In Progress' : 'Start Task'}
                                            </button>
                                        )}
                                        {isCompleted && (
                                            <motion.span
                                                initial={{ opacity: 0, scale: 0.85 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20"
                                            >
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                                            </motion.span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            </StaggerItem>
                        );
                    })}
                    </Stagger>
                )}
            </div>
        </div>
    );
};

export default StudentRoadmap;
