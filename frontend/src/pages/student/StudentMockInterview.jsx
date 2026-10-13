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
    Award, 
    Clock, 
    History, 
    ArrowRight, 
    RotateCcw, 
    ChevronRight, 
    ShieldCheck, 
    Lightbulb,
    Target
} from 'lucide-react';
import studentApi from '../../services/studentApi';

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
            {/* Header banner */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                        <MessageSquare className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            AI Mock Interview & Communication Coach
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-500/30">
                                STAR Rubric
                            </span>
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                            Practice behavioral and technical interview questions with instant STAR structure grading.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {viewMode !== 'SETUP' && (
                        <button
                            onClick={() => setViewMode('SETUP')}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium text-sm transition-all border border-slate-200 dark:border-slate-700 shadow-xs flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4" />
                            New Session
                        </button>
                    )}
                    <button
                        onClick={fetchHistory}
                        disabled={isLoadingHistory}
                        className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 rounded-xl font-medium text-sm transition-all border border-emerald-200 dark:border-emerald-500/30 shadow-xs flex items-center gap-2"
                    >
                        <History className="w-4 h-4" />
                        Past Sessions
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-xl flex items-center gap-3 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* VIEW 1: SETUP SCREEN */}
            {viewMode === 'SETUP' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
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
                                {[
                                    { id: 'TECHNICAL', label: 'Technical Depth', desc: 'Architecture, DB, logic & coding tradeoffs' },
                                    { id: 'HR', label: 'Behavioral & HR', desc: 'Leadership, teamwork, conflict & STAR stories' },
                                    { id: 'MIXED', label: 'Comprehensive', desc: 'Balanced technical & situational questions' }
                                ].map(track => (
                                    <button
                                        key={track.id}
                                        type="button"
                                        onClick={() => setInterviewType(track.id)}
                                        className={`p-4 rounded-xl border text-left transition-all ${
                                            interviewType === track.id
                                                ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500 ring-1 ring-emerald-500/30'
                                                : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400'
                                        }`}
                                    >
                                        <p className={`font-semibold text-sm ${interviewType === track.id ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-800 dark:text-slate-200'}`}>
                                            {track.label}
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{track.desc}</p>
                                    </button>
                                ))}
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
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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
                                className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <Sparkles className="w-4 h-4" />
                                {loading ? 'Initializing Session...' : 'Start Mock Interview (4 Turns)'}
                            </button>
                        </div>
                    </div>

                    {/* Information / STAR Tips */}
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-6 space-y-4">
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
                            ].map(item => (
                                <div key={item.tag} className="flex items-start gap-3 p-2.5 rounded-lg bg-white dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800">
                                    <span className="w-6 h-6 flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold rounded text-xs shrink-0">
                                        {item.tag}
                                    </span>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">{item.title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* VIEW 2: ACTIVE INTERVIEW SESSION */}
            {viewMode === 'INTERVIEW' && activeTurn && (
                <div className="space-y-6">
                    {/* Status header */}
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-center gap-3">
                            <span className="px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold text-xs border border-emerald-200 dark:border-emerald-500/30">
                                Question {activeTurn.turn_number} of 4
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                {currentInterview.interview_type} Track • {currentInterview.target_role}
                            </span>
                        </div>
                        <button
                            onClick={handleConcludeEarly}
                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        >
                            Conclude Early
                        </button>
                    </div>

                    {/* AI Question Box */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs relative overflow-hidden">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 shrink-0">
                                <Bot className="w-6 h-6" />
                            </div>
                            <div className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                    Interviewer Question
                                </span>
                                <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                                    "{activeTurn.question_text}"
                                </h3>
                            </div>
                        </div>
                    </div>

                    {/* If answer has not been submitted for this turn */}
                    {!turnFeedback && (
                        <form onSubmit={handleSubmitAnswer} className="space-y-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 space-y-3 shadow-xs">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                        <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                        Your Response (STAR Format)
                                    </label>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                        {wordCount} words {wordCount < 40 && '(Aim for 40-100 words for complete STAR scoring)'}
                                    </span>
                                </div>
                                <textarea
                                    value={studentResponse}
                                    onChange={(e) => setStudentResponse(e.target.value)}
                                    rows={6}
                                    placeholder="Structure your answer: Situation/Task -> Concrete actions you took -> Quantifiable results and learnings..."
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none font-sans leading-relaxed"
                                    required
                                />
                                <div className="flex items-center justify-between pt-2">
                                    <p className="text-xs text-slate-500">
                                        💡 Tip: Use action verbs like "built", "designed", "optimized", and state the outcome.
                                    </p>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || !studentResponse.trim()}
                                        className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
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
                        <div className="bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 space-y-6 shadow-xs animate-fadeIn">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                                <div>
                                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                        Turn Evaluation Results
                                    </span>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                        Performance on Question {turnFeedback.turn_number}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Turn Score</p>
                                        <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{turnFeedback.score}%</p>
                                    </div>
                                    <div className="text-right pl-3 border-l border-slate-200 dark:border-slate-700">
                                        <p className="text-xs text-slate-500 dark:text-slate-400">STAR Score</p>
                                        <p className="text-xl font-extrabold text-teal-600 dark:text-teal-400">{turnFeedback.star_score}%</p>
                                    </div>
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
                                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2"
                                >
                                    {turnFeedback.is_finished ? 'View Complete Interview Report' : 'Proceed to Next Question'}
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* VIEW 3: COMPLETED INTERVIEW REPORT */}
            {viewMode === 'COMPLETED' && currentInterview && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
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

                            <div className="flex items-center gap-6">
                                <div className="text-center p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Overall Score</p>
                                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{currentInterview.overall_score}%</p>
                                </div>
                                <div className="text-center p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">STAR Structure</p>
                                    <p className="text-2xl font-black text-teal-600 dark:text-teal-400">{currentInterview.star_structure_score}%</p>
                                </div>
                                <div className="text-center p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Technical Depth</p>
                                    <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{currentInterview.technical_accuracy_score}%</p>
                                </div>
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
                                {currentInterview.turns?.map((turn) => (
                                    <div key={turn.id} className="p-5 rounded-xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800 space-y-3">
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
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Bottom action buttons */}
                        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={fetchHistory}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-2"
                            >
                                <History className="w-4 h-4" />
                                View All Sessions
                            </button>
                            <button
                                onClick={() => setViewMode('SETUP')}
                                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Start Another Mock Interview
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* VIEW 4: PAST SESSIONS HISTORY */}
            {viewMode === 'HISTORY' && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
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
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-xs transition-all shadow-xs"
                        >
                            Start New Session
                        </button>
                    </div>

                    {historyList.length === 0 ? (
                        <div className="py-12 text-center text-slate-500 dark:text-slate-400 space-y-3">
                            <MessageSquare className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600" />
                            <p className="text-sm">No previous interview sessions found.</p>
                            <button
                                onClick={() => setViewMode('SETUP')}
                                className="px-4 py-2 bg-emerald-50 dark:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-600/40 transition-colors"
                            >
                                Launch First Session
                            </button>
                        </div>
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
                                    {historyList.map((item) => (
                                        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
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
                                                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
                                                >
                                                    View Report
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StudentMockInterview;
