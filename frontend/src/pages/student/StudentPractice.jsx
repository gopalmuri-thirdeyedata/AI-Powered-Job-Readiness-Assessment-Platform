import React, { useState, useEffect } from 'react';
import { 
    Code2, 
    Brain, 
    CheckCircle2, 
    XCircle, 
    Play, 
    RotateCcw, 
    ChevronRight, 
    AlertTriangle, 
    Clock, 
    Award, 
    Check, 
    Layers, 
    Filter,
    RefreshCw,
    Sparkles,
    Terminal
} from 'lucide-react';
import studentApi from '../../services/studentApi';

const StudentPractice = () => {
    const [topics, setTopics] = useState([]);
    const [selectedTopic, setSelectedTopic] = useState('All');
    const [selectedCategory, setSelectedCategory] = useState('ALL'); // 'ALL' | 'CODING' | 'APTITUDE'
    const [questions, setQuestions] = useState([]);
    const [activeQuestion, setActiveQuestion] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // Coding practice state
    const [code, setCode] = useState('');
    const selectedLanguage = 'python'; // Practice workspace is Python-only

    // Aptitude practice state
    const [selectedOption, setSelectedOption] = useState('');

    // Submission execution state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState(null);

    useEffect(() => {
        loadTopicsAndQuestions();
    }, []);

    const loadTopicsAndQuestions = async () => {
        setIsLoading(true);
        try {
            const [topicsData, questionsData] = await Promise.all([
                studentApi.getPracticeTopics(),
                studentApi.getPracticeQuestions()
            ]);
            setTopics(topicsData || []);
            setQuestions(questionsData || []);
            if (questionsData && questionsData.length > 0) {
                selectQuestion(questionsData[0]);
            }
        } catch (error) {
            console.error('Failed to load practice data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const selectQuestion = (q) => {
        setActiveQuestion(q);
        setSubmissionResult(null);
        setSelectedOption('');

        if (q.category === 'CODING') {
            const starter = q.starter_code?.python || '';
            setCode(starter);
        }
    };

    const handleTopicFilter = async (topicName) => {
        setSelectedTopic(topicName);
        setIsLoading(true);
        try {
            const paramTopic = topicName === 'All' ? null : topicName;
            const paramCategory = selectedCategory === 'ALL' ? null : selectedCategory;
            const filtered = await studentApi.getPracticeQuestions(paramTopic, paramCategory);
            setQuestions(filtered || []);
            if (filtered && filtered.length > 0) {
                selectQuestion(filtered[0]);
            } else {
                setActiveQuestion(null);
            }
        } catch (error) {
            console.error('Failed to filter questions:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCategoryFilter = async (cat) => {
        setSelectedCategory(cat);
        setIsLoading(true);
        try {
            const paramCategory = cat === 'ALL' ? null : cat;
            const paramTopic = selectedTopic === 'All' ? null : selectedTopic;
            const filtered = await studentApi.getPracticeQuestions(paramTopic, paramCategory);
            setQuestions(filtered || []);
            if (filtered && filtered.length > 0) {
                selectQuestion(filtered[0]);
            } else {
                setActiveQuestion(null);
            }
        } catch (error) {
            console.error('Failed to filter category:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!activeQuestion) return;
        setIsSubmitting(true);
        setSubmissionResult(null);

        try {
            let res;
            if (activeQuestion.category === 'CODING') {
                res = await studentApi.submitPracticeAttempt(
                    activeQuestion.id,
                    code,
                    selectedLanguage,
                    null
                );
            } else {
                res = await studentApi.submitPracticeAttempt(
                    activeQuestion.id,
                    null,
                    null,
                    selectedOption
                );
            }
            setSubmissionResult(res);

            // If solved, mark locally and refresh topic counters
            if (res.is_correct) {
                setActiveQuestion(prev => ({ ...prev, is_solved: true }));
                setQuestions(prev => prev.map(q => q.id === activeQuestion.id ? { ...q, is_solved: true } : q));
                const updatedTopics = await studentApi.getPracticeTopics();
                setTopics(updatedTopics || []);
            }
        } catch (error) {
            console.error('Submission failed:', error);
            setSubmissionResult({
                is_correct: false,
                feedback: 'Execution encountered an unexpected error. Please check your submission format.'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const getDifficultyBadge = (diff) => {
        switch (diff) {
            case 'Easy':
                return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
            case 'Hard':
                return 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20';
            default:
                return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
        }
    };

    if (isLoading && !questions.length) {
        return (
            <div className="flex items-center justify-center min-h-[500px]">
                <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
                    <p className="text-slate-600 dark:text-slate-400 font-medium">Loading practice sandbox and test cases...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header & Category Controls */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                            <Code2 className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">DSA & Aptitude Practice Sandbox</h1>
                            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                                Server-evaluated coding challenges and placement aptitude drills
                            </p>
                        </div>
                    </div>

                    {/* Category Switcher */}
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                        {[
                            { key: 'ALL', label: 'All Modules' },
                            { key: 'CODING', label: 'DSA Coding' },
                            { key: 'APTITUDE', label: 'Aptitude' }
                        ].map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => handleCategoryFilter(key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                    selectedCategory === key
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Topic Pills */}
                <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 overflow-x-auto pb-1">
                    <button
                        onClick={() => handleTopicFilter('All')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                            selectedTopic === 'All'
                                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700'
                        }`}
                    >
                        All Topics ({questions.length})
                    </button>
                    {topics.map((t) => (
                        <button
                            key={t.topic}
                            onClick={() => handleTopicFilter(t.topic)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                                selectedTopic === t.topic
                                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 font-semibold'
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            <span>{t.topic}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                {t.solved_count}/{t.total_questions}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Split Screen Layout: Problem List & Problem Arena */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Questions List (4 cols) */}
                <div className="lg:col-span-4 space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                        <span>Available Problems ({questions.length})</span>
                    </div>

                    <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
                        {questions.map((q) => {
                            const isSelected = activeQuestion?.id === q.id;
                            return (
                                <div
                                    key={q.id}
                                    onClick={() => selectQuestion(q)}
                                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                        isSelected
                                            ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-500/60 dark:border-emerald-500/40 shadow-xs'
                                            : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            {q.is_solved ? (
                                                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            ) : (
                                                <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                                            )}
                                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-1">{q.title}</h4>
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${getDifficultyBadge(q.difficulty)}`}>
                                            {q.difficulty}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                        <span>{q.topic}</span>
                                        <span className="uppercase text-[9px] font-bold text-slate-400 dark:text-slate-500">{q.category}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column: Problem Workspace / Sandbox (8 cols) */}
                <div className="lg:col-span-8">
                    {!activeQuestion ? (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-500 dark:text-slate-400">
                            Select a practice problem from the list to begin solving.
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
                            {/* Problem Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${getDifficultyBadge(activeQuestion.difficulty)}`}>
                                            {activeQuestion.difficulty}
                                        </span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">Topic: <strong className="text-slate-900 dark:text-white">{activeQuestion.topic}</strong></span>
                                        {activeQuestion.is_solved && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1 font-semibold">
                                                <Check className="w-3 h-3" /> Solved
                                            </span>
                                        )}
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">{activeQuestion.title}</h2>
                                </div>

                                {/* Coding Language (Python only) */}
                                {activeQuestion.category === 'CODING' && (
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Language:</label>
                                        <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-medium">
                                            Python 3
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Problem Description */}
                            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">
                                {activeQuestion.description}
                            </div>

                            {/* Arena Type 1: CODING */}
                            {activeQuestion.category === 'CODING' && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            <Terminal className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                            <span>Source Code ({selectedLanguage})</span>
                                        </div>
                                    </div>

                                    {/* Editor Area */}
                                    <textarea
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        rows={12}
                                        spellCheck={false}
                                        className="w-full bg-slate-900 dark:bg-slate-950 border border-slate-300 dark:border-slate-700/80 rounded-xl p-4 font-mono text-sm text-emerald-400 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all resize-y"
                                        placeholder="Write your solution here..."
                                    />

                                    {/* Public Test Cases Preview */}
                                    {activeQuestion.public_test_cases?.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                                Public Sample Test Cases
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {activeQuestion.public_test_cases.map((tc, idx) => (
                                                    <div key={idx} className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 text-xs font-mono space-y-1">
                                                        <div className="text-slate-500 font-sans font-bold text-[10px]">Sample #{idx + 1}</div>
                                                        <div className="text-slate-700 dark:text-slate-300 truncate"><strong>Input:</strong> {tc.input}</div>
                                                        <div className="text-emerald-600 dark:text-emerald-400 truncate"><strong>Expected:</strong> {tc.expected_output}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Arena Type 2: APTITUDE */}
                            {activeQuestion.category === 'APTITUDE' && (
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        Select the correct answer:
                                    </h4>
                                    <div className="space-y-2.5">
                                        {activeQuestion.options?.map((opt) => {
                                            const isChecked = selectedOption === opt.key;
                                            return (
                                                <div
                                                    key={opt.key}
                                                    onClick={() => setSelectedOption(opt.key)}
                                                    className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                                                        isChecked
                                                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 text-slate-900 dark:text-white'
                                                            : 'bg-slate-50/60 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <span className={`w-6 h-6 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 border ${
                                                        isChecked
                                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                                    }`}>
                                                        {opt.key}
                                                    </span>
                                                    <span className="text-sm font-medium">{opt.text}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Submission Results Callout */}
                            {submissionResult && (
                                <div className={`p-4 rounded-xl border flex flex-col gap-2 ${
                                    submissionResult.is_correct
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                                        : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
                                }`}>
                                    <div className="flex items-center gap-2 font-bold text-sm">
                                        {submissionResult.is_correct ? (
                                            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                        ) : (
                                            <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                                        )}
                                        <span>
                                            {submissionResult.is_correct ? 'Correct! Problem Solved.' : 'Test Cases Incomplete / Incorrect'}
                                        </span>
                                    </div>

                                    <p className="text-xs leading-relaxed">{submissionResult.feedback}</p>

                                    {/* Public execution trace table */}
                                    {submissionResult.public_results?.length > 0 && (
                                        <div className="mt-2 space-y-1.5 font-mono text-xs">
                                            {submissionResult.public_results.map((tr) => (
                                                <div key={tr.test_case_number} className="bg-white/80 dark:bg-slate-950/80 border border-slate-200/60 dark:border-slate-800 p-2 rounded-lg flex items-center justify-between">
                                                    <span>Test Case #{tr.test_case_number}:</span>
                                                    <span className={tr.passed ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>
                                                        {tr.passed ? 'PASSED' : 'FAILED'} (Expected: {tr.expected_output}, Got: {tr.actual_output || 'None'})
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {submissionResult.explanation && (
                                        <div className="mt-2 pt-2 border-t border-emerald-500/20 text-xs text-slate-600 dark:text-slate-300">
                                            <strong>Concept Explanation:</strong> {submissionResult.explanation}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Footer / Submit Button */}
                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    All hidden test cases and answer keys are securely evaluated server-side.
                                </span>
                                <button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || (activeQuestion.category === 'APTITUDE' && !selectedOption)}
                                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm transition-all shadow-xs"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            Evaluating Sandbox...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="w-4 h-4 fill-white" />
                                            Submit Solution
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentPractice;
