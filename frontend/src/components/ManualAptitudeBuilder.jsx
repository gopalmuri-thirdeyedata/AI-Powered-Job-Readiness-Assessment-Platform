import React, { useState } from 'react';
import {
    Plus, Trash2, Edit2, CheckCircle2, AlertCircle,
    Award, BarChart2, Layers, Check, X, HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const QUESTION_TYPES = [
    { id: 'mcq', label: 'Multiple Choice', desc: 'Single correct answer from multiple options' },
    { id: 'true_false', label: 'True / False', desc: 'Binary true or false proposition' },
    { id: 'short_answer', label: 'Short Answer', desc: 'Direct text or keyword answer' },
];

const DIFFICULTY_LEVELS = ['Easy', 'Medium', 'Hard'];

const ManualAptitudeBuilder = ({
    questions = [],
    onChange,
    duration = 45,
    onDurationChange
}) => {
    // Current draft question state
    const [qType, setQType] = useState('mcq');
    const [questionText, setQuestionText] = useState('');
    const [options, setOptions] = useState(['', '', '', '']);
    const [correctAnswer, setCorrectAnswer] = useState(0); // number for MCQ, boolean for TF, string for short_answer
    const [marks, setMarks] = useState(1);
    const [difficulty, setDifficulty] = useState('Medium');
    const [explanation, setExplanation] = useState('');

    const [editingIndex, setEditingIndex] = useState(null);
    const [validationError, setValidationError] = useState('');

    // Summary calculations
    const totalQuestions = questions.length;
    const totalMarks = questions.reduce((sum, q) => sum + (parseInt(q.marks) || 1), 0);

    const resetForm = () => {
        setQuestionText('');
        setOptions(['', '', '', '']);
        setCorrectAnswer(qType === 'true_false' ? true : qType === 'short_answer' ? '' : 0);
        setMarks(1);
        setDifficulty('Medium');
        setExplanation('');
        setEditingIndex(null);
        setValidationError('');
    };

    const handleTypeChange = (newType) => {
        setQType(newType);
        if (newType === 'mcq') {
            setOptions(['', '', '', '']);
            setCorrectAnswer(0);
        } else if (newType === 'true_false') {
            setOptions(['True', 'False']);
            setCorrectAnswer(true);
        } else if (newType === 'short_answer') {
            setOptions([]);
            setCorrectAnswer('');
        }
        setValidationError('');
    };

    const handleOptionChange = (idx, value) => {
        const next = [...options];
        next[idx] = value;
        setOptions(next);
    };

    const addOption = () => {
        if (options.length < 6) {
            setOptions([...options, '']);
        }
    };

    const removeOption = (idx) => {
        if (options.length <= 2) {
            setValidationError('Multiple choice questions require at least 2 options.');
            return;
        }
        const next = options.filter((_, i) => i !== idx);
        setOptions(next);
        if (correctAnswer === idx) {
            setCorrectAnswer(0);
        } else if (correctAnswer > idx) {
            setCorrectAnswer(correctAnswer - 1);
        }
    };

    const handleSaveQuestion = () => {
        setValidationError('');

        if (!questionText.trim()) {
            setValidationError('Question statement cannot be empty.');
            return;
        }

        const parsedMarks = parseInt(marks);
        if (isNaN(parsedMarks) || parsedMarks <= 0) {
            setValidationError('Marks must be a positive number.');
            return;
        }

        let newQuestion = {
            id: editingIndex !== null ? questions[editingIndex].id : Date.now(),
            question: questionText.trim(),
            type: qType,
            marks: parsedMarks,
            difficulty,
            explanation: explanation.trim()
        };

        if (qType === 'mcq') {
            const cleanedOptions = options.map(o => o.trim());
            if (cleanedOptions.some(o => !o)) {
                setValidationError('All MCQ options must be filled out.');
                return;
            }
            if (correctAnswer < 0 || correctAnswer >= cleanedOptions.length) {
                setValidationError('Please select which option is the correct answer.');
                return;
            }
            newQuestion.options = cleanedOptions;
            newQuestion.correct_answer = correctAnswer;
            newQuestion.correct = correctAnswer;
        } else if (qType === 'true_false') {
            newQuestion.options = ['True', 'False'];
            newQuestion.correct_answer = Boolean(correctAnswer);
            newQuestion.correct = Boolean(correctAnswer);
        } else if (qType === 'short_answer') {
            if (typeof correctAnswer !== 'string' || !correctAnswer.trim()) {
                setValidationError('Please provide the correct answer string.');
                return;
            }
            newQuestion.options = null;
            newQuestion.correct_answer = correctAnswer.trim();
            newQuestion.correct = correctAnswer.trim();
        }

        if (editingIndex !== null) {
            const nextQuestions = [...questions];
            nextQuestions[editingIndex] = newQuestion;
            onChange(nextQuestions);
        } else {
            onChange([...questions, newQuestion]);
        }

        resetForm();
    };

    const handleEditQuestion = (index) => {
        const q = questions[index];
        setEditingIndex(index);
        setQType(q.type || 'mcq');
        setQuestionText(q.question);
        setMarks(q.marks || 1);
        setDifficulty(q.difficulty || 'Medium');
        setExplanation(q.explanation || '');

        if (q.type === 'true_false') {
            setOptions(['True', 'False']);
            setCorrectAnswer(Boolean(q.correct_answer ?? q.correct));
        } else if (q.type === 'short_answer') {
            setOptions([]);
            setCorrectAnswer(q.correct_answer || q.correct || '');
        } else {
            setOptions(q.options || ['', '', '', '']);
            setCorrectAnswer(typeof q.correct_answer === 'number' ? q.correct_answer : (q.correct || 0));
        }
        setValidationError('');
    };

    const handleDeleteQuestion = (index) => {
        const next = questions.filter((_, i) => i !== index);
        onChange(next);
        if (editingIndex === index) {
            resetForm();
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Metrics Card */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-6">
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 block">Total Questions</span>
                        <span className="text-2xl font-bold text-gray-900">{totalQuestions}</span>
                    </div>
                    <div className="h-8 w-px bg-blue-200" />
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 block">Total Marks</span>
                        <span className="text-2xl font-bold text-gray-900">{totalMarks}</span>
                    </div>
                </div>

                {onDurationChange && (
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-gray-700 whitespace-nowrap">Duration (mins):</label>
                        <input
                            type="number"
                            min="5"
                            max="180"
                            value={duration}
                            onChange={(e) => onDurationChange(parseInt(e.target.value) || 30)}
                            className="w-20 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-800 bg-white focus:ring-2 focus:ring-blue-400 outline-none"
                        />
                    </div>
                )}
            </div>

            {/* Question Authoring Form */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h4 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                        {editingIndex !== null ? (
                            <>
                                <Edit2 size={16} className="text-amber-500" />
                                Edit Question #{editingIndex + 1}
                            </>
                        ) : (
                            <>
                                <Plus size={16} className="text-blue-600" />
                                Add New Manual Question
                            </>
                        )}
                    </h4>

                    {editingIndex !== null && (
                        <button
                            type="button"
                            onClick={resetForm}
                            className="text-xs text-gray-500 hover:text-gray-700 underline font-medium"
                        >
                            Cancel Editing
                        </button>
                    )}
                </div>

                {/* Question Type Selection */}
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">Question Type</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {QUESTION_TYPES.map(t => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => handleTypeChange(t.id)}
                                className={`text-left p-3 rounded-lg border transition-all ${qType === t.id
                                    ? 'border-blue-500 bg-blue-50/60 shadow-sm ring-1 ring-blue-500/20'
                                    : 'border-gray-200 hover:border-gray-300 bg-white'
                                    }`}
                            >
                                <div className="text-sm font-bold text-gray-900 flex items-center justify-between">
                                    {t.label}
                                    {qType === t.id && <Check size={14} className="text-blue-600" />}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Question Statement */}
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                        Question Statement <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        rows={3}
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        placeholder="e.g. Which of the following data structures operates on a FIFO basis?"
                        className="w-full p-3 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none resize-y"
                    />
                </div>

                {/* Type-Specific Answer Config */}
                {qType === 'mcq' && (
                    <div className="space-y-2 bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <div className="flex items-center justify-between">
                            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                                Answer Options & Select Correct (Radio) <span className="text-red-500">*</span>
                            </label>
                            {options.length < 6 && (
                                <button
                                    type="button"
                                    onClick={addOption}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1"
                                >
                                    <Plus size={13} /> Add Option
                                </button>
                            )}
                        </div>

                        <div className="space-y-2">
                            {options.map((opt, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="correctMcqRadio"
                                        checked={correctAnswer === i}
                                        onChange={() => setCorrectAnswer(i)}
                                        title="Mark as correct answer"
                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={opt}
                                        onChange={(e) => handleOptionChange(i, e.target.value)}
                                        placeholder={`Option ${i + 1}`}
                                        className={`flex-1 px-3 py-2 text-sm border rounded-lg bg-white outline-none focus:ring-1 ${correctAnswer === i
                                            ? 'border-blue-400 ring-1 ring-blue-400/20'
                                            : 'border-gray-300'
                                            }`}
                                    />
                                    {options.length > 2 && (
                                        <button
                                            type="button"
                                            onClick={() => removeOption(i)}
                                            className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors"
                                            title="Delete option"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {qType === 'true_false' && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                            Select Correct Answer <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-4">
                            <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border cursor-pointer font-bold transition-all ${correctAnswer === true
                                ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500/20'
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                                }`}>
                                <input
                                    type="radio"
                                    name="tfCorrect"
                                    checked={correctAnswer === true}
                                    onChange={() => setCorrectAnswer(true)}
                                    className="hidden"
                                />
                                <CheckCircle2 size={16} className={correctAnswer === true ? 'text-green-600' : 'text-gray-400'} />
                                True
                            </label>

                            <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border cursor-pointer font-bold transition-all ${correctAnswer === false
                                ? 'bg-red-50 border-red-500 text-red-700 ring-1 ring-red-500/20'
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                                }`}>
                                <input
                                    type="radio"
                                    name="tfCorrect"
                                    checked={correctAnswer === false}
                                    onChange={() => setCorrectAnswer(false)}
                                    className="hidden"
                                />
                                <X size={16} className={correctAnswer === false ? 'text-red-600' : 'text-gray-400'} />
                                False
                            </label>
                        </div>
                    </div>
                )}

                {qType === 'short_answer' && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                            Expected Correct Answer <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={correctAnswer}
                            onChange={(e) => setCorrectAnswer(e.target.value)}
                            placeholder="e.g. O(log n)"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 font-mono"
                        />
                        <p className="text-[11px] text-gray-500 flex items-center gap-1">
                            <HelpCircle size={12} />
                            Candidate answers are evaluated case-insensitively with normalized spaces. Use | to allow alternatives (e.g. O(log n)|O(logn)).
                        </p>
                    </div>
                )}

                {/* Marks, Difficulty & Explanation */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                            Marks Weight <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="50"
                            value={marks}
                            onChange={(e) => setMarks(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none font-semibold"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                            Difficulty Level
                        </label>
                        <div className="flex gap-2">
                            {DIFFICULTY_LEVELS.map(level => (
                                <button
                                    key={level}
                                    type="button"
                                    onClick={() => setDifficulty(level)}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${difficulty === level
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    {level}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {validationError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700 font-medium">
                        <AlertCircle size={16} className="text-red-500 shrink-0" />
                        {validationError}
                    </div>
                )}

                <div className="pt-2 flex justify-end">
                    <button
                        type="button"
                        onClick={handleSaveQuestion}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2"
                    >
                        <Plus size={16} />
                        {editingIndex !== null ? 'Update Question' : 'Add Question to Assessment'}
                    </button>
                </div>
            </div>

            {/* Questions List */}
            <div className="space-y-3">
                <h4 className="font-bold text-gray-900 text-sm flex items-center justify-between">
                    <span>Configured Questions ({questions.length})</span>
                    {questions.length > 0 && (
                        <span className="text-xs text-gray-500 font-normal">
                            All answers will remain strictly server-side
                        </span>
                    )}
                </h4>

                {questions.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-gray-200 rounded-xl text-center bg-gray-50/50">
                        <Layers size={32} className="mx-auto text-gray-400 mb-2" />
                        <p className="text-sm font-semibold text-gray-700">No questions added yet</p>
                        <p className="text-xs text-gray-500 mt-1">Use the form above to author manual questions.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {questions.map((q, idx) => (
                            <div
                                key={q.id || idx}
                                className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative"
                            >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="bg-gray-100 text-gray-800 text-xs font-bold px-2 py-0.5 rounded">
                                            #{idx + 1}
                                        </span>
                                        <span className="bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold px-2 py-0.5 rounded uppercase">
                                            {q.type === 'mcq' ? 'MCQ' : q.type === 'true_false' ? 'True/False' : 'Short Answer'}
                                        </span>
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2 py-0.5 rounded">
                                            {q.marks || 1} {q.marks === 1 ? 'Mark' : 'Marks'}
                                        </span>
                                        <span className="bg-purple-50 text-purple-700 border border-purple-200 text-xs font-semibold px-2 py-0.5 rounded">
                                            {q.difficulty || 'Medium'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => handleEditQuestion(idx)}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                                            title="Edit question"
                                        >
                                            <Edit2 size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteQuestion(idx)}
                                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                                            title="Delete question"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>

                                <p className="text-sm font-medium text-gray-900 mb-2">{q.question}</p>

                                {/* Answer Details */}
                                {q.type === 'mcq' && q.options && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs text-gray-700 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                                        {q.options.map((opt, optI) => {
                                            const isCorrect = (q.correct_answer === optI || q.correct === optI);
                                            return (
                                                <div
                                                    key={optI}
                                                    className={`px-2 py-1 rounded flex items-center gap-1.5 ${isCorrect ? 'bg-green-100 text-green-900 font-bold' : ''
                                                        }`}
                                                >
                                                    <span className="w-4 font-mono text-gray-500">{String.fromCharCode(65 + optI)}.</span>
                                                    <span>{opt}</span>
                                                    {isCorrect && <Check size={12} className="text-green-700 ml-auto" />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {q.type === 'true_false' && (
                                    <div className="text-xs bg-gray-50 p-2 rounded-lg border border-gray-100 flex items-center gap-2">
                                        <span className="text-gray-500 font-semibold">Correct Answer:</span>
                                        <span className={`font-bold px-2 py-0.5 rounded ${q.correct_answer ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                            {q.correct_answer ? 'True' : 'False'}
                                        </span>
                                    </div>
                                )}

                                {q.type === 'short_answer' && (
                                    <div className="text-xs bg-gray-50 p-2 rounded-lg border border-gray-100 flex items-center gap-2 font-mono">
                                        <span className="text-gray-500 font-semibold font-sans">Expected Answer:</span>
                                        <span className="bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded">
                                            {q.correct_answer || q.correct}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ManualAptitudeBuilder;
