import React, { useState, useEffect } from 'react';
import {
    MessageSquare,
    Bot,
    User,
    Sparkles,
    Send,
    CheckCircle2,
    AlertCircle,
    TrendingUp,
    History,
    ArrowRight,
    RotateCcw,
    Lightbulb,
    Target,
    Cpu,
    Users,
    Layers,
    Check,
    Brain,
    ScanText,
    ListChecks,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero, EmptyState } from '../../components/student-ui/StudentMotion';
import { Counter, EASE } from '../../components/home/primitives';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';
import { VoiceInputButton, VoiceStatus } from '../../components/student-ui/VoiceInput';
import useSpeechToText from '../../hooks/useSpeechToText';
import { appendTranscript } from '../../utils/speechText';

const RING_COLORS = { emerald: '#10b981', teal: '#14b8a6', blue: '#3b82f6', amber: '#f59e0b' };

/** Animated circular score meter (count-up + stroke draw). Purely presentational. */
const ScoreRing = ({ value, label, tone = 'emerald', size = 92 }) => {
    const reduce = useReducedMotion();
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    const stroke = 8;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const target = c * (1 - v / 100);
    return (
        <div className="flex flex-col items-center text-center min-w-0">
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
                    <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-slate-800" />
                    <motion.circle
                        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
                        stroke={RING_COLORS[tone] || RING_COLORS.emerald}
                        strokeDasharray={c}
                        initial={{ strokeDashoffset: reduce ? target : c }}
                        animate={{ strokeDashoffset: target }}
                        transition={{ duration: 1.2, ease: EASE, delay: 0.15 }}
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-lg sm:text-xl font-black tabular-nums text-slate-900 dark:text-white">
                    <Counter to={Math.round(v)} suffix="%" />
                </div>
            </div>
            <p className="mt-2 text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
        </div>
    );
};

const TRACKS = [
    { id: 'TECHNICAL', label: 'Technical Depth', desc: 'Architecture, DB, logic & coding tradeoffs', icon: Cpu },
    { id: 'HR', label: 'Behavioral & HR', desc: 'Leadership, teamwork, conflict & STAR stories', icon: Users },
    { id: 'MIXED', label: 'Comprehensive', desc: 'Balanced technical & situational questions', icon: Layers },
];

const START_STAGES = [
    { icon: ScanText, label: 'Reading your target role' },
    { icon: Brain, label: 'Choosing questions for your track' },
    { icon: ListChecks, label: 'Preparing the STAR rubric' },
    { icon: MessageSquare, label: 'Warming up your interviewer' },
];
const START_TIPS = [
    'Answer like you are talking to a real interviewer: Situation, Task, Action, Result.',
    'Numbers make answers memorable. Mention latency, users, or time saved.',
    'You can conclude early any time, but 4 questions gives the fullest scorecard.',
];

const StudentMockInterview = () => {
    // Mode: 'SETUP' | 'INTERVIEW' | 'COMPLETED' | 'HISTORY'
    const [viewMode, setViewMode] = useState('SETUP');
    const [interviewType, setInterviewType] = useState('TECHNICAL');
    const [targetRole, setTargetRole] = useState('Full Stack Developer');
    const [availableRoles, setAvailableRoles] = useState([]);
    
    // Active session state
    const [currentInterview, setCurrentInterview] = useState(null);
    const [activeTurn, setActiveTurn] = useState(null);
    const [studentResponse, setStudentResponse] = useState('');
    // voice typing: spoken words are added to the answer box as they are recognised
    const dictation = useSpeechToText({ onFinalText: (text) => setStudentResponse((prev) => appendTranscript(prev, text)) });
    const [turnFeedback, setTurnFeedback] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // History & UI State
    const [historyList, setHistoryList] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Load initial target role & available roles from profile/taxonomy
        studentApi.getProfile()
            .then(p => {
                if (p.target_role) setTargetRole(p.target_role);
            })
            .catch(() => {});

        studentApi.getTargetRoles()
            .then(roles => {
                if (roles && roles.length > 0) {
                    setAvailableRoles(roles.map(r => r.title));
                }
            })
            .catch(() => {});
    }, []);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const data = await studentApi.getMockInterviewHistory();
            setHistoryList(data || []);
            setViewMode('HISTORY');
        } catch (err) {
            setError('Failed to load interview history');
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const handleStartInterview = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await studentApi.startMockInterview(interviewType, targetRole);
            setCurrentInterview(data);
            if (data.turns && data.turns.length > 0) {
                setActiveTurn(data.turns[data.turns.length - 1]);
            }
            setTurnFeedback(null);
            setStudentResponse('');
            setViewMode('INTERVIEW');
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to start interview session');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitAnswer = async (e) => {
        e.preventDefault();
        dictation.stop();
        if (!studentResponse.trim()) return;

        setIsSubmitting(true);
        setError(null);
        try {
            const feedback = await studentApi.submitMockInterviewTurn(
                currentInterview.id, 
                studentResponse
            );
            setTurnFeedback(feedback);

            if (feedback.is_finished) {
                // Fetch completed interview details
                const updated = await studentApi.getMockInterviewDetail(currentInterview.id);
                setCurrentInterview(updated);
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to evaluate response');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleProceedToNext = async () => {
        if (turnFeedback?.is_finished) {
            setViewMode('COMPLETED');
            return;
        }

        // Fetch refreshed interview details to get newly created turn
        try {
            const refreshed = await studentApi.getMockInterviewDetail(currentInterview.id);
            setCurrentInterview(refreshed);
            const latestTurn = refreshed.turns.find(t => t.student_response === null);
            setActiveTurn(latestTurn || refreshed.turns[refreshed.turns.length - 1]);
            setTurnFeedback(null);
            setStudentResponse('');
        } catch (err) {
            setError('Could not advance to next question.');
        }
    };

    const handleConcludeEarly = async () => {
        if (!window.confirm('Are you sure you want to conclude this interview session early?')) return;
        setLoading(true);
        try {
            const completed = await studentApi.completeMockInterview(currentInterview.id);
            setCurrentInterview(completed);
            setViewMode('COMPLETED');
        } catch (err) {
            setError('Failed to conclude interview session.');
        } finally {
            setLoading(false);
        }
    };

    const handleViewDetail = async (id) => {
        setLoading(true);
        try {
            const detail = await studentApi.getMockInterviewDetail(id);
            setCurrentInterview(detail);
            setViewMode('COMPLETED');
        } catch (err) {
            setError('Failed to load interview details.');
        } finally {
            setLoading(false);
        }
    };

    const wordCount = studentResponse.trim() ? studentResponse.trim().split(/\s+/).length : 0;

    return (
        <div className="space-y-6">
            <AssessmentLoadingOverlay
                open={loading}
                title={viewMode === 'SETUP' ? 'Starting your interview' : viewMode === 'INTERVIEW' ? 'Wrapping up your session' : 'Loading your report'}
                subtitle={viewMode === 'SETUP' ? `${targetRole} - ${interviewType} track` : 'Hang tight, this only takes a moment.'}
                stages={START_STAGES}
                tips={START_TIPS}
                footnote="Please keep this page open."
            />

            {/* Header banner */}
            <PageHero
                icon={MessageSquare}
                eyebrow="STAR Rubric"
                title="AI Mock Interview & Communication Coach"
                subtitle="Practice behavioral and technical interview questions with instant STAR structure grading."
                actions={(
                    <>
                        {viewMode !== 'SETUP' && (
                            <button
                                onClick={() => setViewMode('SETUP')}
                                className="px-4 min-h-[44px] bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium text-sm transition-all border border-slate-200 dark:border-slate-700 shadow-xs flex items-center gap-2 active:scale-95"
                            >
                                <RotateCcw className="w-4 h-4" />
                                New Session
                            </button>
                        )}
                        <button
                            onClick={fetchHistory}
                            disabled={isLoadingHistory}
                            className="px-4 min-h-[44px] bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 rounded-xl font-medium text-sm transition-all border border-emerald-200 dark:border-emerald-500/30 shadow-xs flex items-center gap-2 active:scale-95"
                        >
                            <History className="w-4 h-4" />
                            Past Sessions
                        </button>
                    </>
                )}
            />

            {error && (
                <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-xl flex items-center gap-3 text-sm animate-fadeIn">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* VIEW 1: SETUP SCREEN */}
            {viewMode === 'SETUP' && (
                <motion.div
                    key="setup"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="grid grid-cols-1 lg:grid-cols-3 gap-6"
                >
                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-6">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            Configure Your Practice Session
                        </h2>

                        {/* Interview Type Selector */}
                        <div className="space-y-3">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Interview Track
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {TRACKS.map(track => {
                                    const selected = interviewType === track.id;
                                    const TrackIcon = track.icon;
                                    return (
                                        <motion.button
                                            key={track.id}
                                            type="button"
                                            onClick={() => setInterviewType(track.id)}
                                            whileHover={{ y: -3 }}
                                            whileTap={{ scale: 0.98 }}
                                            aria-pressed={selected}
                                            className={`relative p-4 min-h-[88px] rounded-xl border text-left transition-colors ${
                                                selected
                                                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500'
                                                    : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400'
                                            }`}
                                        >
                                            {selected && (
                                                <motion.span
                                                    layoutId="mock-track-highlight"
                                                    aria-hidden="true"
                                                    className="absolute inset-0 rounded-xl ring-2 ring-emerald-500/60 shadow-lg shadow-emerald-500/10"
                                                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                                />
                                            )}
                                            <div className="relative flex items-start gap-3">
                                                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${selected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                                                    <TrackIcon className="w-4 h-4" />
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className={`font-semibold text-sm ${selected ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-800 dark:text-slate-200'}`}>
                                                        {track.label}
                                                    </p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{track.desc}</p>
                                                </div>
                                                {selected && <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                                            </div>
                                        </motion.button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Target Role Selector */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Target Engineering Role
                            </label>
                            <select
                                value={targetRole}
                                onChange={(e) => setTargetRole(e.target.value)}
                                className="w-full px-4 py-2.5 min-h-[44px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                            >
                                {availableRoles.length > 0 ? (
                                    availableRoles.map(r => <option key={r} value={r}>{r}</option>)
                                ) : (
                                    <>
                                        <option value="Full Stack Developer">Full Stack Developer</option>
                                        <option value="Backend Engineer">Backend Engineer</option>
                                        <option value="Software Engineer">Software Engineer</option>
                                    </>
                                )}
                            </select>
                        </div>

                        {/* Start Action */}
                        <div className="pt-2">
                            <button
                                onClick={handleStartInterview}
                                disabled={loading}
                                className="w-full sm:w-auto px-6 h-11 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all shadow-xs hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                            >
                                <Sparkles className="w-4 h-4" />
                                {loading ? 'Initializing Session...' : 'Start Mock Interview (4 Turns)'}
                            </button>
                        </div>
                    </div>

                    {/* Information / STAR Tips */}
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                            <Lightbulb className="w-5 h-5" />
                            <h3 className="font-semibold text-slate-900 dark:text-slate-200 text-sm">How STAR Evaluation Works</h3>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            Interviews are evaluated using industry-standard rubrics:
                        </p>
                        <div className="space-y-3">
                            {[
                                { tag: 'S', title: 'Situation', desc: 'Describe the context, project scope, or technical challenge.' },
                                { tag: 'T', title: 'Task', desc: 'Identify your specific engineering deliverable or problem statement.' },
                                { tag: 'A', title: 'Action', desc: 'Detail the concrete architecture, tools, code, or tradeoffs you made.' },
                                { tag: 'R', title: 'Result', desc: 'Quantify the outcome (e.g., latency -40%, bug eliminated, team delivery).' }
                            ].map((item, idx) => (
                                <motion.div
                                    key={item.tag}
                                    initial={{ opacity: 0, x: 16 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.45, delay: 0.15 + idx * 0.08, ease: EASE }}
                                    className="flex items-start gap-3 p-2.5 rounded-lg bg-white dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800"
                                >
                                    <span className="w-6 h-6 flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold rounded text-xs shrink-0">
                                        {item.tag}
                                    </span>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">{item.title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </motion.div>
            )}

            {/* VIEW 2: ACTIVE INTERVIEW SESSION */}
            {viewMode === 'INTERVIEW' && activeTurn && (
                <div className="space-y-6 max-w-3xl mx-auto">
                    {/* Status header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold text-xs border border-emerald-200 dark:border-emerald-500/30">
                                Question {activeTurn.turn_number} of 4
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                {currentInterview.interview_type} Track • {currentInterview.target_role}
                            </span>
                        </div>
                        <button
                            onClick={handleConcludeEarly}
                            className="text-xs min-h-[40px] px-2 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        >
                            Conclude Early
                        </button>
                        <div className="basis-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={Math.max(0, activeTurn.turn_number - (turnFeedback ? 0 : 1))} aria-label="Interview progress">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                                initial={false}
                                animate={{ width: `${Math.min(100, (Math.max(0, activeTurn.turn_number - (turnFeedback ? 0 : 1)) / 4) * 100)}%` }}
                                transition={{ duration: 0.6, ease: EASE }}
                            />
                        </div>
                    </div>

                    {/* AI Question Box */}
                    <motion.div
                        key={`q-${activeTurn.turn_number}`}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs relative overflow-hidden"
                    >
                        <div className="flex items-start gap-3 sm:gap-4">
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 shrink-0">
                                <Bot className="w-6 h-6" />
                            </div>
                            <div className="space-y-2 min-w-0">
                                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                    Interviewer Question
                                </span>
                                <h3 className="text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100 leading-relaxed break-words">
                                    "{activeTurn.question_text}"
                                </h3>
                            </div>
                        </div>
                    </motion.div>

                    {/* If answer has not been submitted for this turn */}
                    {!turnFeedback && (
                        <form onSubmit={handleSubmitAnswer} className="space-y-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-3 shadow-xs focus-within:border-emerald-400/70 transition-colors">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                        <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                        Your Response (STAR Format)
                                    </label>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                        {wordCount} words {wordCount < 40 && '(Aim for 40-100 words for complete STAR scoring)'}
                                    </span>
                                    <VoiceInputButton dictation={dictation} />
                                </div>
                                <textarea
                                    value={studentResponse}
                                    onChange={(e) => setStudentResponse(e.target.value)}
                                    rows={6}
                                    placeholder="Structure your answer: Situation/Task -> Concrete actions you took -> Quantifiable results and learnings..."
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none font-sans leading-relaxed"
                                    required
                                />
                                <VoiceStatus dictation={dictation} />
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                                    <p className="text-xs text-slate-500">
                                        💡 Tip: Use action verbs like "built", "designed", "optimized", and state the outcome.
                                    </p>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || !studentResponse.trim()}
                                        className="px-6 h-11 w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all shadow-xs active:scale-[0.98] flex items-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        <Send className="w-4 h-4" />
                                        {isSubmitting ? 'Evaluating Response...' : 'Submit Answer'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}

                    {/* Turn Feedback Panel (Displayed after turn submission) */}
                    {turnFeedback && (
                        <motion.div
                            initial={{ opacity: 0, y: 18 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, ease: EASE }}
                            className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                                <div>
                                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                        Turn Evaluation Results
                                    </span>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                        Performance on Question {turnFeedback.turn_number}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-4">
                                    <ScoreRing value={turnFeedback.score} label="Turn Score" tone="emerald" size={76} />
                                    <ScoreRing value={turnFeedback.star_score} label="STAR Score" tone="teal" size={76} />
                                </div>
                            </div>

                            {/* Detailed feedback text */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                {turnFeedback.feedback}
                            </div>

                            {/* Strengths & Improvements */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                        <CheckCircle2 className="w-4 h-4" /> Demonstrated Strengths
                                    </p>
                                    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                        {turnFeedback.strengths?.map((s, idx) => (
                                            <li key={idx} className="flex items-start gap-2">
                                                <span className="text-emerald-600 dark:text-emerald-400">•</span>
                                                <span>{s}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                        <TrendingUp className="w-4 h-4" /> High-Impact Refinements
                                    </p>
                                    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                        {turnFeedback.improvements?.map((imp, idx) => (
                                            <li key={idx} className="flex items-start gap-2">
                                                <span className="text-amber-600 dark:text-amber-400">•</span>
                                                <span>{imp}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            {/* Action to proceed */}
                            <div className="flex justify-end pt-2">
                                <button
                                    onClick={handleProceedToNext}
                                    className="px-6 h-11 w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all shadow-xs active:scale-[0.98] flex items-center gap-2 cursor-pointer"
                                >
                                    {turnFeedback.is_finished ? 'View Complete Interview Report' : 'Proceed to Next Question'}
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </div>
            )}

            {/* VIEW 3: COMPLETED INTERVIEW REPORT */}
            {viewMode === 'COMPLETED' && currentInterview && (
                <div className="space-y-6">
                    <motion.div
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.55, ease: EASE }}
                        className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-6"
                    >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pb-6 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-500/30">
                                    Interview Complete
                                </span>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                                    {currentInterview.interview_type} Mock Interview Scorecard
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Target Role: {currentInterview.target_role} • Evaluated with STAR Rubric
                                </p>
                            </div>

                            <div className="grid grid-cols-3 gap-2 sm:gap-6 items-start">
                                <ScoreRing value={currentInterview.overall_score} label="Overall Score" tone="emerald" size={92} />
                                <ScoreRing value={currentInterview.star_structure_score} label="STAR Structure" tone="teal" size={92} />
                                <ScoreRing value={currentInterview.technical_accuracy_score} label="Technical Depth" tone="blue" size={92} />
                            </div>
                        </div>

                        {/* Executive Summary */}
                        {currentInterview.feedback_summary && (
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                <p className="font-semibold text-slate-900 dark:text-slate-200 text-xs uppercase tracking-wider mb-1">
                                    Executive Feedback Summary
                                </p>
                                {currentInterview.feedback_summary}
                            </div>
                        )}

                        {/* Turn-by-Turn Question Breakdown */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Question-by-Question Transcript & Feedback
                            </h3>
                            <div className="space-y-4">
                                {currentInterview.turns?.map((turn, tIdx) => (
                                    <motion.div
                                        key={turn.id}
                                        initial={{ opacity: 0, y: 16 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true, margin: '-30px' }}
                                        transition={{ duration: 0.5, delay: Math.min(tIdx, 3) * 0.06, ease: EASE }}
                                        className="p-4 sm:p-5 rounded-xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800 space-y-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                                Question {turn.turn_number}
                                            </span>
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20">
                                                Score: {turn.turn_score}%
                                            </span>
                                        </div>
                                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                            "{turn.question_text}"
                                        </p>
                                        {turn.student_response && (
                                            <div className="p-3 bg-white dark:bg-slate-950/80 rounded-lg border border-slate-200/80 dark:border-slate-800/80 text-xs text-slate-700 dark:text-slate-300">
                                                <p className="text-[10px] uppercase font-bold text-slate-500 mb-1">Your Response:</p>
                                                {turn.student_response}
                                            </div>
                                        )}
                                        {turn.feedback && (
                                            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                                                Coach: {turn.feedback}
                                            </p>
                                        )}
                                    </motion.div>
                                ))}
                            </div>
                        </div>

                        {/* Bottom action buttons */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={fetchHistory}
                                className="px-4 min-h-[44px] justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-2"
                            >
                                <History className="w-4 h-4" />
                                View All Sessions
                            </button>
                            <button
                                onClick={() => setViewMode('SETUP')}
                                className="px-6 h-11 justify-center bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all shadow-xs active:scale-[0.98] flex items-center gap-2 cursor-pointer"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Start Another Mock Interview
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* VIEW 4: PAST SESSIONS HISTORY */}
            {viewMode === 'HISTORY' && (
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-4"
                >
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                <History className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                Previous Mock Interview Sessions
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Track your communication improvement and STAR score trends over time.
                            </p>
                        </div>
                        <button
                            onClick={() => setViewMode('SETUP')}
                            className="px-4 min-h-[40px] bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-medium text-xs transition-all shadow-xs active:scale-95 cursor-pointer"
                        >
                            Start New Session
                        </button>
                    </div>

                    {historyList.length === 0 ? (
                        <EmptyState
                            icon={MessageSquare}
                            title="No previous interview sessions found."
                            body="Your first mock interview ends with a full STAR scorecard."
                            action={(
                                <button
                                    onClick={() => setViewMode('SETUP')}
                                    className="px-4 min-h-[44px] bg-emerald-50 dark:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-600/40 transition-colors"
                                >
                                    Launch First Session
                                </button>
                            )}
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        <th className="py-3 px-4">Track</th>
                                        <th className="py-3 px-4">Target Role</th>
                                        <th className="py-3 px-4">Status</th>
                                        <th className="py-3 px-4">Overall Score</th>
                                        <th className="py-3 px-4">Date</th>
                                        <th className="py-3 px-4 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {historyList.map((item, hIdx) => (
                                        <motion.tr
                                            key={item.id}
                                            initial={{ opacity: 0, x: -12 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.4, delay: Math.min(hIdx, 10) * 0.04, ease: EASE }}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                                        >
                                            <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-200">
                                                {item.interview_type}
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                                                {item.target_role}
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                                                    item.status === 'COMPLETED'
                                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                                                        : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 font-bold text-emerald-600 dark:text-emerald-400">
                                                {item.overall_score > 0 ? `${item.overall_score}%` : '—'}
                                            </td>
                                            <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">
                                                {new Date(item.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-3.5 px-4 text-right">
                                                <button
                                                    onClick={() => handleViewDetail(item.id)}
                                                    className="px-3 min-h-[36px] whitespace-nowrap bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
                                                >
                                                    View Report
                                                </button>
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>
            )}
        </div>
    );
};

export default StudentMockInterview;
