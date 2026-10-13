import React, { useState, useEffect } from 'react';
import { 
    Award, 
    CheckCircle2, 
    AlertCircle, 
    Clock, 
    ArrowRight, 
    Code2, 
    FileQuestion, 
    Bot, 
    User, 
    RotateCcw, 
    History, 
    Sparkles, 
    ChevronRight, 
    ShieldCheck, 
    TrendingUp,
    Send
} from 'lucide-react';
import studentApi from '../../services/studentApi';

const StudentPlacementSimulation = () => {
    // Mode: 'SETUP' | 'SIMULATION' | 'REPORT' | 'HISTORY'
    const [viewMode, setViewMode] = useState('SETUP');
    const [targetRole, setTargetRole] = useState('Full Stack Developer');
    const [availableRoles, setAvailableRoles] = useState([]);

    // Active simulation state
    const [simulation, setSimulation] = useState(null);
    const [currentRoundNumber, setCurrentRoundNumber] = useState(1);
    const [activeRoundData, setActiveRoundData] = useState(null);

    // Round input states
    const [aptitudeAnswers, setAptitudeAnswers] = useState({});
    const [codeSubmission, setCodeSubmission] = useState('def two_sum(nums, target):\n    # Write your solution\n    lookup = {}\n    for i, n in enumerate(nums):\n        if target - n in lookup:\n            return [lookup[target - n], i]\n        lookup[n] = i\n    return []\n');
    const [techResponse, setTechResponse] = useState('');
    const [hrResponse, setHrResponse] = useState('');

    // UI & History states
    const [historyList, setHistoryList] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
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

        // Check if there is an active in-progress simulation
        studentApi.getActiveSimulation()
            .then(active => {
                if (active) {
                    setSimulation(active);
                    setCurrentRoundNumber(active.current_round);
                    const roundObj = active.rounds.find(r => r.round_number === active.current_round);
                    setActiveRoundData(roundObj || active.rounds[0]);
                    setViewMode('SIMULATION');
                }
            })
            .catch(() => {});
    }, []);

    const handleStartSimulation = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await studentApi.startSimulation(targetRole);
            setSimulation(data);
            setCurrentRoundNumber(1);
            setActiveRoundData(data.rounds[0]);
            setAptitudeAnswers({});
            setTechResponse('');
            setHrResponse('');
            setViewMode('SIMULATION');
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to start simulation drive.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitRound = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        let payload = {};
        if (currentRoundNumber === 1) {
            payload = { answers: aptitudeAnswers };
        } else if (currentRoundNumber === 2) {
            payload = { code: codeSubmission };
        } else if (currentRoundNumber === 3) {
            payload = { response: techResponse };
        } else if (currentRoundNumber === 4) {
            payload = { response: hrResponse };
        }

        try {
            const result = await studentApi.submitSimulationRound(
                simulation.id,
                currentRoundNumber,
                payload
            );

            if (result.is_simulation_finished) {
                // Fetch full report
                const completed = await studentApi.getSimulation(simulation.id);
                setSimulation(completed);
                setViewMode('REPORT');
            } else {
                // Refresh simulation to get next round
                const refreshed = await studentApi.getSimulation(simulation.id);
                setSimulation(refreshed);
                setCurrentRoundNumber(result.next_round);
                const nextRoundObj = refreshed.rounds.find(r => r.round_number === result.next_round);
                setActiveRoundData(nextRoundObj);
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to submit round.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const list = await studentApi.getSimulationHistory();
            setHistoryList(list || []);
            setViewMode('HISTORY');
        } catch (err) {
            setError('Failed to load past simulation records.');
        } finally {
            setLoading(false);
        }
    };

    const handleViewReport = async (simId) => {
        setLoading(true);
        try {
            const detail = await studentApi.getSimulation(simId);
            setSimulation(detail);
            setViewMode('REPORT');
        } catch (err) {
            setError('Failed to load simulation scorecard.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header banner */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                        <Award className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            End-to-End Campus Placement Drive Simulation
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-500/30">
                                4 Rounds
                            </span>
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                            Simulate authentic aptitude, coding, technical design, and HR rounds under timed pressure.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {viewMode !== 'SETUP' && (
                        <button
                            onClick={() => setViewMode('SETUP')}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm transition-all border border-slate-200 dark:border-slate-700 shadow-xs flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4" />
                            New Drive
                        </button>
                    )}
                    <button
                        onClick={fetchHistory}
                        className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 rounded-xl font-medium text-sm transition-all border border-emerald-200 dark:border-emerald-500/30 shadow-xs flex items-center gap-2"
                    >
                        <History className="w-4 h-4" />
                        Past Drives
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-xl flex items-center gap-3 text-sm">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* VIEW 1: SETUP SCREEN */}
            {viewMode === 'SETUP' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            Configure Your Placement Drive Simulation
                        </h2>

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

                        {/* Round Breakdown Cards */}
                        <div className="space-y-3">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                4 Sequential Drive Rounds
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[
                                    { num: 'Round 1', title: 'Aptitude & Reasoning', desc: 'Quantitative, logical reasoning, and data interpretation MCQs.', weight: '20%' },
                                    { num: 'Round 2', title: 'Coding Assessment', desc: 'Algorithmic DSA problem with public and hidden test cases.', weight: '35%' },
                                    { num: 'Round 3', title: 'Technical Interview', desc: 'Architecture, trade-offs, and backend design depth.', weight: '25%' },
                                    { num: 'Round 4', title: 'HR & Behavioral', desc: 'STAR structure, team conflicts, and ownership.', weight: '20%' }
                                ].map(r => (
                                    <div key={r.num} className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{r.num}</span>
                                            <span className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 rounded">Weight: {r.weight}</span>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">{r.title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{r.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={handleStartSimulation}
                                disabled={loading}
                                className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <Award className="w-4 h-4" />
                                {loading ? 'Initializing Drive...' : 'Launch Placement Drive Simulation'}
                            </button>
                        </div>
                    </div>

                    {/* Right column: Placement Drive Info */}
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-6 space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="w-5 h-5" />
                            <h3 className="font-semibold text-slate-900 dark:text-slate-200 text-sm">Authentic Placement Evaluation</h3>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            Completing a full simulation directly enhances your <strong>Placement Readiness Score</strong> and gives you an objective assessment across all evaluation filters used by top recruiters.
                        </p>
                        <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                            <p className="font-semibold text-emerald-700 dark:text-emerald-300">Confidentiality Guarantee:</p>
                            <p>Answer keys and hidden test cases are executed strictly server-side in sandbox environments.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* VIEW 2: ACTIVE SIMULATION WIZARD */}
            {viewMode === 'SIMULATION' && simulation && activeRoundData && (
                <div className="space-y-6">
                    {/* Stepper progress indicator */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { num: 1, label: 'Aptitude' },
                                { num: 2, label: 'Coding' },
                                { num: 3, label: 'Technical' },
                                { num: 4, label: 'HR' }
                            ].map(step => {
                                const isCurrent = step.num === currentRoundNumber;
                                const isDone = step.num < currentRoundNumber;
                                return (
                                    <div
                                        key={step.num}
                                        className={`p-3 rounded-xl border text-center transition-all ${
                                            isCurrent
                                                ? 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30 font-bold'
                                                : isDone
                                                    ? 'bg-slate-50 dark:bg-slate-900/60 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                                    : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                                        }`}
                                    >
                                        <p className="text-[11px] font-bold">Round {step.num}</p>
                                        <p className="text-xs font-semibold truncate">{step.label}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ROUND 1: APTITUDE */}
                    {currentRoundNumber === 1 && (
                        <form onSubmit={handleSubmitRound} className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                            <div>
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Round 1 Assessment</span>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">Quantitative & Logical Aptitude Section</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Answer the following questions to clear the initial recruitment screening round.</p>
                            </div>

                            <div className="space-y-6">
                                {(activeRoundData.round_data?.questions || []).map((q, idx) => (
                                    <div key={q.id} className="p-5 rounded-xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 space-y-3">
                                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                                            Question {idx + 1}: {q.question}
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                            {q.options?.map(opt => (
                                                <label
                                                    key={opt.key}
                                                    className={`p-3 rounded-lg border cursor-pointer flex items-center gap-3 transition-colors ${
                                                        aptitudeAnswers[q.id] === opt.key
                                                            ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500 text-slate-900 dark:text-white'
                                                            : 'bg-white dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name={q.id}
                                                        value={opt.key}
                                                        checked={aptitudeAnswers[q.id] === opt.key}
                                                        onChange={() => setAptitudeAnswers({ ...aptitudeAnswers, [q.id]: opt.key })}
                                                        className="text-emerald-600 focus:ring-0"
                                                    />
                                                    <span className="font-bold text-xs">{opt.key}.</span>
                                                    <span className="text-xs">{opt.text}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Send className="w-4 h-4" />
                                    {isSubmitting ? 'Evaluating Section...' : 'Submit Round 1 & Advance to Coding'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ROUND 2: CODING */}
                    {currentRoundNumber === 2 && (
                        <form onSubmit={handleSubmitRound} className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                            <div>
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Round 2 Assessment</span>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                                    {activeRoundData.round_data?.title || 'Technical Coding Assessment'}
                                </h2>
                                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                                    {activeRoundData.round_data?.description}
                                </p>
                            </div>

                            {/* Public Sample Test Cases */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sample Test Cases</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {(activeRoundData.round_data?.public_test_cases || []).map((tc, idx) => (
                                        <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-mono">
                                            <p className="text-slate-500 dark:text-slate-400">Input: {tc.input}</p>
                                            <p className="text-emerald-600 dark:text-emerald-400 font-bold">Expected: {tc.expected_output}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Code input */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                    Solution Source Code (Python 3)
                                </label>
                                <textarea
                                    value={codeSubmission}
                                    onChange={(e) => setCodeSubmission(e.target.value)}
                                    rows={10}
                                    className="w-full p-4 bg-slate-900 dark:bg-slate-950 font-mono text-xs text-emerald-400 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                    required
                                />
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Code2 className="w-4 h-4" />
                                    {isSubmitting ? 'Evaluating Code in Sandbox...' : 'Submit Code & Advance to Technical Round'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ROUND 3: TECHNICAL INTERVIEW */}
                    {currentRoundNumber === 3 && (
                        <form onSubmit={handleSubmitRound} className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                            <div>
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Round 3 Assessment</span>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">System Design & Technical Architecture Round</h2>
                            </div>

                            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">Architectural Prompt:</p>
                                <p className="text-base font-medium text-slate-800 dark:text-slate-200">
                                    "{activeRoundData.round_data?.question}"
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                    Your Architectural Solution & Justification
                                </label>
                                <textarea
                                    value={techResponse}
                                    onChange={(e) => setTechResponse(e.target.value)}
                                    rows={7}
                                    placeholder="Explain your high-level component architecture, caching strategies, database schema, index choices, and fault tolerance..."
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none font-sans leading-relaxed"
                                    required
                                />
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Send className="w-4 h-4" />
                                    {isSubmitting ? 'Evaluating Technical Response...' : 'Submit Round 3 & Advance to HR Round'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ROUND 4: HR INTERVIEW */}
                    {currentRoundNumber === 4 && (
                        <form onSubmit={handleSubmitRound} className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                            <div>
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Round 4 Assessment</span>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">Behavioral & HR Round (Final Round)</h2>
                            </div>

                            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                                <p className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1">Behavioral Question:</p>
                                <p className="text-base font-medium text-slate-800 dark:text-slate-200">
                                    "{activeRoundData.round_data?.question}"
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                    Your STAR-Method Response
                                </label>
                                <textarea
                                    value={hrResponse}
                                    onChange={(e) => setHrResponse(e.target.value)}
                                    rows={7}
                                    placeholder="Situation -> Task -> Action -> Result..."
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none font-sans leading-relaxed"
                                    required
                                />
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Award className="w-4 h-4" />
                                    {isSubmitting ? 'Finalizing Simulation...' : 'Complete Simulation & Generate Report'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {/* VIEW 3: COMPREHENSIVE REPORT */}
            {viewMode === 'REPORT' && simulation && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
                        <div>
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-500/30">
                                Campus Drive Completed
                            </span>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                                Placement Simulation Comprehensive Scorecard
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Target Role: {simulation.target_role} • Weighted Drive Score
                            </p>
                        </div>

                        <div className="text-center p-4 bg-slate-50 dark:bg-slate-900/80 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Overall Drive Score</p>
                            <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{simulation.overall_score}%</p>
                        </div>
                    </div>

                    {/* 4 Rounds Scorecard Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                            { label: 'Round 1: Aptitude', score: simulation.aptitude_score, weight: '20%' },
                            { label: 'Round 2: Coding', score: simulation.coding_score, weight: '35%' },
                            { label: 'Round 3: Tech Interview', score: simulation.technical_interview_score, weight: '25%' },
                            { label: 'Round 4: HR Interview', score: simulation.hr_interview_score, weight: '20%' }
                        ].map(r => (
                            <div key={r.label} className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 text-center space-y-1">
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase">{r.label}</span>
                                <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{r.score}%</p>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">Weight: {r.weight}</span>
                            </div>
                        ))}
                    </div>

                    {/* Executive Summary */}
                    {simulation.report_summary && (
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Executive Drive Assessment</p>
                            {simulation.report_summary}
                        </div>
                    )}

                    {/* Bottom action buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={fetchHistory}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-2"
                        >
                            <History className="w-4 h-4" />
                            View Past Drives
                        </button>
                        <button
                            onClick={() => setViewMode('SETUP')}
                            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-xs flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Start Another Drive Simulation
                        </button>
                    </div>
                </div>
            )}

            {/* VIEW 4: PAST DRIVES HISTORY */}
            {viewMode === 'HISTORY' && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                <History className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                Previous Placement Simulation Drives
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Review your past multi-round performances and track readiness trends.
                            </p>
                        </div>
                        <button
                            onClick={() => setViewMode('SETUP')}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-xs transition-all shadow-xs"
                        >
                            New Drive
                        </button>
                    </div>

                    {historyList.length === 0 ? (
                        <div className="py-12 text-center text-slate-500 dark:text-slate-400 space-y-3">
                            <Award className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600" />
                            <p className="text-sm">No previous placement simulations recorded.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        <th className="py-3 px-4">Target Role</th>
                                        <th className="py-3 px-4">Status</th>
                                        <th className="py-3 px-4">Aptitude</th>
                                        <th className="py-3 px-4">Coding</th>
                                        <th className="py-3 px-4">Tech</th>
                                        <th className="py-3 px-4">HR</th>
                                        <th className="py-3 px-4">Overall</th>
                                        <th className="py-3 px-4 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {historyList.map(item => (
                                        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                                            <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-200">{item.target_role}</td>
                                            <td className="py-3.5 px-4">
                                                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                                                    item.status === 'COMPLETED'
                                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                                                        : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">{item.aptitude_score}%</td>
                                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">{item.coding_score}%</td>
                                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">{item.technical_interview_score}%</td>
                                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">{item.hr_interview_score}%</td>
                                            <td className="py-3.5 px-4 font-bold text-emerald-600 dark:text-emerald-400">{item.overall_score}%</td>
                                            <td className="py-3.5 px-4 text-right">
                                                <button
                                                    onClick={() => handleViewReport(item.id)}
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

export default StudentPlacementSimulation;
