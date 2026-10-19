import React, { useState, useEffect } from 'react';
import {
    Code2,
    CheckCircle2,
    XCircle,
    Play,
    Check,
    RefreshCw,
    Terminal,
} from 'lucide-react';
import { motion } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero, EmptyState } from '../../components/student-ui/StudentMotion';
import { EASE } from '../../components/home/primitives';

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
        <div className="space-y-5 sm:space-y-6 max-w-7xl mx-auto min-w-0">
            {/* Header & Category Controls */}
            <PageHero
                icon={Code2}
                eyebrow="Practice"
                title="DSA & Aptitude Practice Sandbox"
                subtitle="Server-evaluated coding challenges and placement aptitude drills"
                actions={(
                    /* Category Switcher */
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 w-full sm:w-auto">
                        {[
                            { key: 'ALL', label: 'All Modules' },
                            { key: 'CODING', label: 'DSA Coding' },
                            { key: 'APTITUDE', label: 'Aptitude' }
                        ].map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => handleCategoryFilter(key)}
                                className={`relative flex-1 sm:flex-none min-h-[40px] px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    selectedCategory === key
                                        ? 'text-slate-900 dark:text-white'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                {selectedCategory === key && (
                                    <motion.span
                                        layoutId="practice-category-pill"
                                        className="absolute inset-0 rounded-lg bg-white dark:bg-slate-900 shadow-xs"
                                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                                    />
                                )}
                                <span className="relative">{label}</span>
                            </button>
                        ))}
                    </div>
                )}
            >
                {/* Topic Pills */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    <button
                        onClick={() => handleTopicFilter('All')}
                        className={`relative min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
                            selectedTopic === 'All'
                                ? 'text-emerald-700 dark:text-emerald-400 border-transparent'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-700'
                        }`}
                    >
                        {selectedTopic === 'All' && (
                            <motion.span
                                layoutId="practice-topic-pill"
                                className="absolute inset-0 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30"
                                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                            />
                        )}
                        <span className="relative">All Topics ({questions.length})</span>
                    </button>
                    {topics.map((t) => (
                        <button
                            key={t.topic}
                            onClick={() => handleTopicFilter(t.topic)}
                            className={`relative min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 border ${
                                selectedTopic === t.topic
                                    ? 'text-emerald-700 dark:text-emerald-400 border-transparent font-semibold'
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            {selectedTopic === t.topic && (
                                <motion.span
                                    layoutId="practice-topic-pill"
                                    className="absolute inset-0 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30"
                                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                                />
                            )}
                            <span className="relative">{t.topic}</span>
                            <span className="relative text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                {t.solved_count}/{t.total_questions}
                            </span>
                        </button>
                    ))}
                </div>
            </PageHero>

            {/* Split Screen Layout: Problem List & Problem Arena */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
                {/* Left Column: Questions List (4 cols) */}
                <div className="lg:col-span-4 space-y-3 min-w-0">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                        <span>Available Problems ({questions.length})</span>
                    </div>

                    <div className="space-y-2 max-h-[340px] lg:max-h-[700px] overflow-y-auto pr-1">
                        {questions.map((q, qi) => {
                            const isSelected = activeQuestion?.id === q.id;
                            return (
                                <motion.div
                                    key={q.id}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: Math.min(qi, 10) * 0.04, ease: EASE }}
                                    onClick={() => selectQuestion(q)}
                                    className={`p-3.5 min-h-[56px] rounded-xl border transition-[transform,box-shadow,border-color,background-color] duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-md ${
                                        isSelected
                                            ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-500/60 dark:border-emerald-500/40 shadow-xs'
                                            : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
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
                                </motion.div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column: Problem Workspace / Sandbox (8 cols) */}
                <div className="lg:col-span-8 min-w-0">
                    {!activeQuestion ? (
                        <EmptyState
                            icon={Code2}
                            title="Select a practice problem from the list to begin solving."
                        />
                    ) : (
                        <motion.div key={activeQuestion.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xs space-y-5 sm:space-y-6">
                            {/* Problem Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
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
                                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white break-words">{activeQuestion.title}</h2>
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
                            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words font-sans">
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
                                        className="w-full bg-slate-900 dark:bg-slate-950 border border-slate-300 dark:border-slate-700/80 rounded-xl p-4 font-mono text-sm text-emerald-400 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all resize-y min-h-[220px] sm:min-h-[260px] overflow-x-auto"
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
                                                    <div key={idx} className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 text-xs font-mono space-y-1 min-w-0 hover:-translate-y-0.5 hover:shadow-sm transition-all">
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
                                                    className={`p-4 min-h-[52px] rounded-xl border transition-all cursor-pointer flex items-center gap-3 hover:-translate-y-0.5 active:scale-[0.99] ${
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
                                <motion.div
                                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ duration: 0.4, ease: EASE }}
                                    className={`p-4 rounded-xl border flex flex-col gap-2 ${
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
                                            {submissionResult.public_results.map((tr, ti) => (
                                                <motion.div
                                                    key={tr.test_case_number}
                                                    initial={{ opacity: 0, x: -12 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ duration: 0.35, delay: 0.15 + ti * 0.08, ease: EASE }}
                                                    className={`bg-white/80 dark:bg-slate-950/80 border border-l-4 p-2 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 min-w-0 ${
                                                        tr.passed ? 'border-slate-200/60 dark:border-slate-800 border-l-emerald-500' : 'border-slate-200/60 dark:border-slate-800 border-l-rose-500'
                                                    }`}
                                                >
                                                    <span className="flex items-center gap-1.5 shrink-0">
                                                        {tr.passed
                                                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                            : <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />}
                                                        Test Case #{tr.test_case_number}:
                                                    </span>
                                                    <span className={`break-words min-w-0 ${tr.passed ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}`}>
                                                        {tr.passed ? 'PASSED' : 'FAILED'} (Expected: {tr.expected_output}, Got: {tr.actual_output || 'None'})
                                                    </span>
                                                </motion.div>
                                            ))}
                                        </div>
                                    )}

                                    {submissionResult.explanation && (
                                        <div className="mt-2 pt-2 border-t border-emerald-500/20 text-xs text-slate-600 dark:text-slate-300">
                                            <strong>Concept Explanation:</strong> {submissionResult.explanation}
                                        </div>
                                    )}
                                </motion.div>
                            )}

                            {/* Footer / Submit Button */}
                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    All hidden test cases and answer keys are securely evaluated server-side.
                                </span>
                                <button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || (activeQuestion.category === 'APTITUDE' && !selectedOption)}
                                    className="inline-flex items-center justify-center gap-2 px-6 h-12 sm:h-11 w-full sm:w-auto rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-bold text-sm transition-all shadow-xs cursor-pointer disabled:cursor-not-allowed active:scale-95"
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
                        </motion.div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentPractice;
