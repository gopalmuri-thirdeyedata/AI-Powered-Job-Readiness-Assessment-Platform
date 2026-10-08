import React, { useState } from 'react';
import {
    Plus, Trash2, Edit2, CheckCircle2, AlertCircle,
    Award, BarChart2, Layers, Check, X, Code2, Eye, EyeOff,
    Terminal, FileText, ChevronRight, HelpCircle, Lock, Unlock, Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DIFFICULTY_LEVELS = ['Easy', 'Medium', 'Hard'];

const DEFAULT_STARTER_CODE = {
    python: `def solve(input_data):\n    # Write your solution here\n    # Return the expected result\n    pass`,
    java: `class Solution {\n    public Object solve(Object input) {\n        // Write your solution here\n        return null;\n    }\n}`
};

const ManualCodingBuilder = ({
    questions = [],
    onChange,
    timeLimit = 60,
    onTimeLimitChange
}) => {
    // Current draft question state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [inputFormat, setInputFormat] = useState('');
    const [outputFormat, setOutputFormat] = useState('');
    const [difficulty, setDifficulty] = useState('Medium');
    const [marks, setMarks] = useState(10);
    const [constraints, setConstraints] = useState(['']);
    const [examples, setExamples] = useState([
        { input: '', output: '', explanation: '' }
    ]);
    const [starterCode, setStarterCode] = useState(DEFAULT_STARTER_CODE);
    const [activeStarterLang, setActiveStarterLang] = useState('python');

    // Test cases state: each item { id, input, expected, is_hidden, explanation }
    const [testCases, setTestCases] = useState([
        { id: 1, input: '', expected: '', is_hidden: false, explanation: 'Sample public test case' },
        { id: 2, input: '', expected: '', is_hidden: true, explanation: 'Hidden boundary test case' }
    ]);

    const [editingIndex, setEditingIndex] = useState(null);
    const [validationError, setValidationError] = useState('');
    const [previewQuestion, setPreviewQuestion] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Summary calculations
    const totalProblems = questions.length;
    const totalMarks = questions.reduce((sum, q) => sum + (parseInt(q.marks) || 10), 0);
    const totalPublicTests = questions.reduce(
        (sum, q) => sum + (q.testCases ? q.testCases.filter(t => !t.is_hidden).length : 0), 0
    );
    const totalHiddenTests = questions.reduce(
        (sum, q) => sum + (q.testCases ? q.testCases.filter(t => t.is_hidden).length : 0), 0
    );

    const resetForm = () => {
        setTitle('');
        setDescription('');
        setInputFormat('');
        setOutputFormat('');
        setDifficulty('Medium');
        setMarks(10);
        setConstraints(['']);
        setExamples([{ input: '', output: '', explanation: '' }]);
        setStarterCode(DEFAULT_STARTER_CODE);
        setActiveStarterLang('python');
        setTestCases([
            { id: 1, input: '', expected: '', is_hidden: false, explanation: 'Sample public test case' },
            { id: 2, input: '', expected: '', is_hidden: true, explanation: 'Hidden boundary test case' }
        ]);
        setEditingIndex(null);
        setValidationError('');
    };

    // Constraint helpers
    const handleConstraintChange = (idx, val) => {
        const next = [...constraints];
        next[idx] = val;
        setConstraints(next);
    };
    const addConstraint = () => setConstraints([...constraints, '']);
    const removeConstraint = (idx) => {
        if (constraints.length <= 1) {
            setConstraints(['']);
            return;
        }
        setConstraints(constraints.filter((_, i) => i !== idx));
    };

    // Example helpers
    const handleExampleChange = (idx, field, val) => {
        const next = [...examples];
        next[idx] = { ...next[idx], [field]: val };
        setExamples(next);
    };
    const addExample = () => {
        setExamples([...examples, { input: '', output: '', explanation: '' }]);
    };
    const removeExample = (idx) => {
        if (examples.length <= 1) {
            setExamples([{ input: '', output: '', explanation: '' }]);
            return;
        }
        setExamples(examples.filter((_, i) => i !== idx));
    };

    // Test case helpers
    const handleTestCaseChange = (idx, field, val) => {
        const next = [...testCases];
        next[idx] = { ...next[idx], [field]: val };
        setTestCases(next);
    };
    const toggleTestCaseHidden = (idx) => {
        const next = [...testCases];
        next[idx].is_hidden = !next[idx].is_hidden;
        setTestCases(next);
    };
    const addTestCase = (isHidden = false) => {
        const newId = (testCases.length > 0 ? Math.max(...testCases.map(t => Number(t.id) || 0)) : 0) + 1;
        setTestCases([...testCases, {
            id: newId,
            input: '',
            expected: '',
            is_hidden: isHidden,
            explanation: ''
        }]);
    };
    const removeTestCase = (idx) => {
        if (testCases.length <= 1) {
            setValidationError('Problem must have at least one test case.');
            return;
        }
        setTestCases(testCases.filter((_, i) => i !== idx));
    };

    // Save/Add Problem
    const handleSaveQuestion = () => {
        setValidationError('');

        if (!title.trim()) {
            setValidationError('Problem title cannot be empty.');
            return;
        }

        if (!description.trim()) {
            setValidationError('Problem statement cannot be empty.');
            return;
        }

        const parsedMarks = parseInt(marks);
        if (isNaN(parsedMarks) || parsedMarks <= 0) {
            setValidationError('Marks must be a positive integer.');
            return;
        }

        // Validate test cases
        if (!testCases || testCases.length === 0) {
            setValidationError('Please add at least one test case.');
            return;
        }

        const hasPublic = testCases.some(t => !t.is_hidden);
        if (!hasPublic) {
            setValidationError('You must configure at least one visible/public test case for candidate preview.');
            return;
        }

        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            if (tc.expected === undefined || tc.expected === null || String(tc.expected).trim() === '') {
                setValidationError(`Test case #${i + 1} has an empty Expected Output.`);
                return;
            }
        }

        // Clean and prepare question object
        const cleanedConstraints = constraints.map(c => c.trim()).filter(Boolean);
        const cleanedExamples = examples
            .filter(ex => ex.input.trim() || ex.output.trim())
            .map(ex => ({
                input: ex.input.trim(),
                output: ex.output.trim(),
                explanation: ex.explanation.trim()
            }));

        const cleanTestCases = testCases.map((tc, idx) => {
            let parsedInput = tc.input;
            try {
                if (typeof tc.input === 'string' && (tc.input.trim().startsWith('{') || tc.input.trim().startsWith('['))) {
                    parsedInput = JSON.parse(tc.input);
                }
            } catch (e) {
                parsedInput = tc.input;
            }

            let parsedExpected = tc.expected;
            try {
                if (typeof tc.expected === 'string' && (tc.expected.trim().startsWith('{') || tc.expected.trim().startsWith('['))) {
                    parsedExpected = JSON.parse(tc.expected);
                }
            } catch (e) {
                parsedExpected = tc.expected;
            }

            return {
                id: tc.id || idx + 1,
                input: parsedInput,
                expected: parsedExpected,
                is_hidden: Boolean(tc.is_hidden),
                explanation: tc.explanation ? tc.explanation.trim() : ''
            };
        });

        const newQuestion = {
            id: editingIndex !== null ? questions[editingIndex].id : Date.now(),
            title: title.trim(),
            description: description.trim(),
            input_format: inputFormat.trim(),
            output_format: outputFormat.trim(),
            difficulty,
            marks: parsedMarks,
            constraints: cleanedConstraints,
            examples: cleanedExamples.length > 0 ? cleanedExamples : [{ input: 'Example Input', output: 'Example Output', explanation: '' }],
            starterCode: {
                python: starterCode.python || DEFAULT_STARTER_CODE.python,
                java: starterCode.java || DEFAULT_STARTER_CODE.java
            },
            testCases: cleanTestCases
        };

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
        setTitle(q.title || '');
        setDescription(q.description || '');
        setInputFormat(q.input_format || '');
        setOutputFormat(q.output_format || '');
        setDifficulty(q.difficulty || 'Medium');
        setMarks(q.marks || 10);
        setConstraints(q.constraints && q.constraints.length > 0 ? q.constraints : ['']);
        setExamples(q.examples && q.examples.length > 0 ? q.examples : [{ input: '', output: '', explanation: '' }]);
        setStarterCode({
            python: q.starterCode?.python || DEFAULT_STARTER_CODE.python,
            java: q.starterCode?.java || DEFAULT_STARTER_CODE.java
        });
        setTestCases(
            q.testCases && q.testCases.length > 0
                ? q.testCases.map((tc, idx) => ({
                    id: tc.id || idx + 1,
                    input: typeof tc.input === 'object' ? JSON.stringify(tc.input) : String(tc.input || ''),
                    expected: typeof tc.expected === 'object' ? JSON.stringify(tc.expected) : String(tc.expected || ''),
                    is_hidden: Boolean(tc.is_hidden),
                    explanation: tc.explanation || ''
                }))
                : [
                    { id: 1, input: '', expected: '', is_hidden: false, explanation: 'Sample public test case' },
                    { id: 2, input: '', expected: '', is_hidden: true, explanation: 'Hidden test case' }
                ]
        );
        setEditingIndex(index);
        setValidationError('');
    };

    const handleDeleteQuestion = (index) => {
        const nextQuestions = questions.filter((_, i) => i !== index);
        onChange(nextQuestions);
        if (editingIndex === index) {
            resetForm();
        } else if (editingIndex !== null && editingIndex > index) {
            setEditingIndex(editingIndex - 1);
        }
    };

    const filteredQuestions = questions.filter(q =>
        (q.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (q.difficulty || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-6">
            {/* Top Summary Banner */}
            <div className="bg-gradient-to-r from-green-50/80 via-white to-emerald-50/50 border border-green-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-100 text-[#5d8c2c] flex items-center justify-center flex-shrink-0">
                            <Code2 size={22} />
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                                <span>Manual Problem Authoring</span>
                                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-[#5d8c2c] font-bold border border-green-200">
                                    Judge0 Integrated
                                </span>
                            </h4>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Author algorithmic challenges with public candidate test cases and secure hidden grading tests.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-2xs">
                            <span className="text-xs font-semibold text-gray-500">Time Limit:</span>
                            <input
                                type="number"
                                min="5"
                                max="180"
                                value={timeLimit}
                                onChange={(e) => onTimeLimitChange && onTimeLimitChange(parseInt(e.target.value) || 60)}
                                className="w-12 text-sm font-bold text-[#5d8c2c] bg-transparent border-b border-green-400 focus:outline-none text-center"
                            />
                            <span className="text-xs text-gray-400">min</span>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                            <div className="text-center px-2.5 py-1 bg-white rounded-lg border border-gray-200 shadow-2xs">
                                <div className="font-bold text-gray-900 text-xs sm:text-sm">{totalProblems}</div>
                                <div className="text-[10px] text-gray-500">Problems</div>
                            </div>
                            <div className="text-center px-2.5 py-1 bg-white rounded-lg border border-gray-200 shadow-2xs">
                                <div className="font-bold text-[#5d8c2c] text-xs sm:text-sm">{totalMarks}</div>
                                <div className="text-[10px] text-gray-500">Marks</div>
                            </div>
                            <div className="text-center px-2.5 py-1 bg-white rounded-lg border border-gray-200 shadow-2xs">
                                <div className="font-bold text-blue-600 text-xs sm:text-sm">{totalPublicTests}</div>
                                <div className="text-[10px] text-gray-500">Public</div>
                            </div>
                            <div className="text-center px-2.5 py-1 bg-white rounded-lg border border-gray-200 shadow-2xs">
                                <div className="font-bold text-amber-600 text-xs sm:text-sm">{totalHiddenTests}</div>
                                <div className="text-[10px] text-gray-500">Hidden 🔒</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Validation Banner */}
            <AnimatePresence>
                {validationError && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2.5 text-xs sm:text-sm"
                    >
                        <AlertCircle size={18} className="shrink-0 text-red-500" />
                        <span>{validationError}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Responsive Grid: Authoring Form (70-75%) | Problem Bank (25-30%) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* LEFT AUTHORING FORM COLUMN */}
                <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-9 bg-white border border-gray-200/90 rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
                    
                    {/* Form Header */}
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
                        <div className="flex items-center gap-2.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                            <h3 className="font-bold text-gray-900 text-sm sm:text-base">
                                {editingIndex !== null ? `Edit Problem #${editingIndex + 1}` : 'Create Coding Problem'}
                            </h3>
                        </div>
                        {editingIndex !== null && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                <X size={14} /> Cancel Editing
                            </button>
                        )}
                    </div>

                    {/* Section 1: Problem Title, Difficulty, Marks (Single Row on Desktop) */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                        <div className="sm:col-span-6 lg:col-span-7">
                            <label className="block text-xs font-bold text-gray-700 mb-1.5">
                                Problem Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Invert Binary Tree, Two Sum, Merge Intervals"
                                className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 transition-all font-medium"
                            />
                        </div>

                        <div className="sm:col-span-3 lg:col-span-3">
                            <label className="block text-xs font-bold text-gray-700 mb-1.5">
                                Difficulty Level
                            </label>
                            <select
                                value={difficulty}
                                onChange={(e) => setDifficulty(e.target.value)}
                                className="w-full px-3 py-2.5 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 transition-all font-medium cursor-pointer"
                            >
                                {DIFFICULTY_LEVELS.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>

                        <div className="sm:col-span-3 lg:col-span-2">
                            <label className="block text-xs font-bold text-gray-700 mb-1.5">
                                Marks <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={marks}
                                onChange={(e) => setMarks(e.target.value)}
                                className="w-full px-3 py-2.5 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 transition-all font-bold text-center"
                            />
                        </div>
                    </div>

                    {/* Section 2: Problem Statement (Full Width) */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-bold text-gray-700 flex items-center gap-1">
                                Problem Statement <span className="text-red-500">*</span>
                            </label>
                            <span className="text-[11px] text-gray-400 font-medium">Markdown supported</span>
                        </div>
                        <textarea
                            rows={4}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe the problem clearly. Specify inputs, expected outputs, requirements, and edge cases..."
                            className="w-full p-3.5 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 leading-relaxed font-sans transition-all"
                        />
                    </div>

                    {/* Section 3: Input & Output Format (Side-by-Side on Desktop) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1.5">
                                Input Format <span className="text-gray-400 font-normal">(Optional)</span>
                            </label>
                            <textarea
                                rows={2}
                                value={inputFormat}
                                onChange={(e) => setInputFormat(e.target.value)}
                                placeholder="e.g. First line contains integer N, followed by N space-separated integers."
                                className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1.5">
                                Output Format <span className="text-gray-400 font-normal">(Optional)</span>
                            </label>
                            <textarea
                                rows={2}
                                value={outputFormat}
                                onChange={(e) => setOutputFormat(e.target.value)}
                                placeholder="e.g. Return the maximum subarray sum as a single integer."
                                className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 transition-all"
                            />
                        </div>
                    </div>

                    {/* Section 4: Constraints (Full Width) */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-gray-700">
                                Constraints
                            </label>
                            <button
                                type="button"
                                onClick={addConstraint}
                                className="text-xs text-[#5d8c2c] hover:underline flex items-center gap-1 font-semibold"
                            >
                                <Plus size={13} /> Add Constraint
                            </button>
                        </div>
                        <div className="space-y-2">
                            {constraints.map((c, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400 font-mono pl-1">•</span>
                                    <input
                                        type="text"
                                        value={c}
                                        onChange={(e) => handleConstraintChange(idx, e.target.value)}
                                        placeholder="e.g. 1 <= nums.length <= 10^5, -10^4 <= nums[i] <= 10^4"
                                        className="flex-1 px-3 py-2 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/20 focus:border-[#5d8c2c] outline-none text-gray-900 transition-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeConstraint(idx)}
                                        className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                                        title="Remove constraint"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Section 5: Problem Examples Visible to Candidate */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-gray-700">
                                Problem Examples <span className="text-gray-400 font-normal">(Visible to Candidate)</span>
                            </label>
                            <button
                                type="button"
                                onClick={addExample}
                                className="text-xs text-[#5d8c2c] hover:underline flex items-center gap-1 font-semibold"
                            >
                                <Plus size={13} /> Add Example
                            </button>
                        </div>
                        <div className="space-y-3">
                            {examples.map((ex, idx) => (
                                <div key={idx} className="p-3.5 bg-gray-50/70 border border-gray-200 rounded-xl space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-gray-700">
                                            Example #{idx + 1}
                                        </span>
                                        {examples.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeExample(idx)}
                                                className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors"
                                                title="Delete Example"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Input</label>
                                            <input
                                                type="text"
                                                value={ex.input}
                                                onChange={(e) => handleExampleChange(idx, 'input', e.target.value)}
                                                placeholder='nums = [2,7,11,15], target = 9'
                                                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5d8c2c] focus:ring-1 focus:ring-[#5d8c2c] text-gray-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Output</label>
                                            <input
                                                type="text"
                                                value={ex.output}
                                                onChange={(e) => handleExampleChange(idx, 'output', e.target.value)}
                                                placeholder='[0,1]'
                                                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5d8c2c] focus:ring-1 focus:ring-[#5d8c2c] text-gray-900"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Explanation (Optional)</label>
                                        <input
                                            type="text"
                                            value={ex.explanation}
                                            onChange={(e) => handleExampleChange(idx, 'explanation', e.target.value)}
                                            placeholder="Because nums[0] + nums[1] == 9, we return [0, 1]."
                                            className="w-full px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5d8c2c] focus:ring-1 focus:ring-[#5d8c2c] text-gray-700"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Section 6: Starter Code (Full Width Editor) */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                                <Terminal size={14} className="text-[#5d8c2c]" /> Starter Code Templates
                            </label>
                            <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setActiveStarterLang('python')}
                                    className={`px-3 py-1 rounded-md font-bold transition-all ${
                                        activeStarterLang === 'python'
                                            ? 'bg-white text-[#5d8c2c] shadow-xs'
                                            : 'text-gray-500 hover:text-gray-900'
                                    }`}
                                >
                                    Python 3
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveStarterLang('java')}
                                    className={`px-3 py-1 rounded-md font-bold transition-all ${
                                        activeStarterLang === 'java'
                                            ? 'bg-white text-[#5d8c2c] shadow-xs'
                                            : 'text-gray-500 hover:text-gray-900'
                                    }`}
                                >
                                    Java 17
                                </button>
                            </div>
                        </div>
                        <textarea
                            rows={5}
                            value={starterCode[activeStarterLang]}
                            onChange={(e) => setStarterCode({ ...starterCode, [activeStarterLang]: e.target.value })}
                            className="w-full p-3.5 font-mono text-xs bg-gray-900 text-emerald-400 border border-gray-800 rounded-xl focus:ring-2 focus:ring-[#5d8c2c]/30 outline-none leading-relaxed"
                        />
                    </div>

                    {/* Section 7: Test Cases Pipeline */}
                    <div className="border-t border-gray-200 pt-5 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                                    <Award size={15} className="text-[#5d8c2c]" />
                                    Test Cases Pipeline
                                </label>
                                <p className="text-[11px] text-gray-500 mt-0.5">
                                    Configure public test cases for candidate testing and hidden test cases for secure grading.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => addTestCase(false)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all flex items-center gap-1 shadow-2xs"
                                >
                                    <Plus size={13} /> Add Public Test
                                </button>
                                <button
                                    type="button"
                                    onClick={() => addTestCase(true)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all flex items-center gap-1 shadow-2xs"
                                >
                                    <Lock size={12} /> Add Hidden Test 🔒
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {testCases.map((tc, idx) => (
                                <div
                                    key={idx}
                                    className={`p-3.5 rounded-xl border transition-all ${
                                        tc.is_hidden
                                            ? 'bg-amber-50/40 border-amber-200/80'
                                            : 'bg-emerald-50/30 border-emerald-200/80'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-gray-800">
                                                Test #{idx + 1}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => toggleTestCaseHidden(idx)}
                                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 transition-all ${
                                                    tc.is_hidden
                                                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                                                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                                }`}
                                            >
                                                {tc.is_hidden ? (
                                                    <>
                                                        <Lock size={10} /> Hidden (Server Only)
                                                    </>
                                                ) : (
                                                    <>
                                                        <Unlock size={10} /> Public (Visible to Candidate)
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeTestCase(idx)}
                                            className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors"
                                            title="Delete test case"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                                Input (JSON or value)
                                            </label>
                                            <textarea
                                                rows={2}
                                                value={tc.input}
                                                onChange={(e) => handleTestCaseChange(idx, 'input', e.target.value)}
                                                placeholder='{"nums": [2, 7, 11, 15], "target": 9}'
                                                className="w-full p-2 font-mono text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5d8c2c] focus:ring-1 focus:ring-[#5d8c2c] text-gray-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                                Expected Output <span className="text-red-500">*</span>
                                            </label>
                                            <textarea
                                                rows={2}
                                                value={tc.expected}
                                                onChange={(e) => handleTestCaseChange(idx, 'expected', e.target.value)}
                                                placeholder='[0, 1] or "true" or 42'
                                                className="w-full p-2 font-mono text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5d8c2c] focus:ring-1 focus:ring-[#5d8c2c] text-emerald-700 font-bold"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <input
                                            type="text"
                                            value={tc.explanation || ''}
                                            onChange={(e) => handleTestCaseChange(idx, 'explanation', e.target.value)}
                                            placeholder="Optional test description (e.g. Boundary condition, empty array, negative numbers)..."
                                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-[#5d8c2c] placeholder:text-gray-400 text-gray-700"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Section 8: Prominent Save Problem Button */}
                    <div className="pt-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-end gap-3">
                        {editingIndex !== null && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleSaveQuestion}
                            className="w-full sm:w-auto px-6 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] text-white hover:shadow-md hover:shadow-green-200/50 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
                        >
                            <Check size={16} />
                            <span>{editingIndex !== null ? 'Update Problem' : 'Save Problem to Round'}</span>
                        </button>
                    </div>
                </div>

                {/* RIGHT COLUMN: Problem Bank Sidebar (25-30% Width on Desktop) */}
                <div className="lg:col-span-4 xl:col-span-4 2xl:col-span-3 space-y-4 lg:sticky lg:top-4">
                    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
                            <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                                <Layers size={16} className="text-[#5d8c2c]" />
                                Problem Bank
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-[#5d8c2c] font-semibold border border-green-200">
                                    {questions.length}
                                </span>
                            </h4>
                            <span className="text-xs font-bold text-gray-600">
                                {totalMarks} marks total
                            </span>
                        </div>

                        {/* Search problems */}
                        <div className="relative mb-3">
                            <Search className="absolute left-3 top-2.5 text-gray-400" size={14} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search problems..."
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-1 focus:ring-[#5d8c2c] focus:border-[#5d8c2c] outline-none text-gray-700"
                            />
                        </div>

                        {questions.length === 0 ? (
                            <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center space-y-2 bg-gray-50/50">
                                <Code2 size={24} className="mx-auto text-gray-400" />
                                <p className="text-xs font-bold text-gray-700">No coding problems authored yet</p>
                                <p className="text-[11px] text-gray-400">
                                    Fill out the form on the left and click &ldquo;Save Problem to Round&rdquo; to add your first challenge.
                                </p>
                            </div>
                        ) : filteredQuestions.length === 0 ? (
                            <div className="border border-gray-200 rounded-xl p-4 text-center text-xs text-gray-500">
                                No problems found matching &ldquo;{searchQuery}&rdquo;
                            </div>
                        ) : (
                            <div className="space-y-2.5 max-h-[600px] overflow-y-auto custom-scrollbar pr-0.5">
                                {filteredQuestions.map((q, idx) => {
                                    const actualIndex = questions.indexOf(q);
                                    const publicCount = (q.testCases || []).filter(t => !t.is_hidden).length;
                                    const hiddenCount = (q.testCases || []).filter(t => t.is_hidden).length;

                                    return (
                                        <div
                                            key={q.id || idx}
                                            className={`bg-white border rounded-xl p-3.5 shadow-2xs transition-all ${
                                                editingIndex === actualIndex
                                                    ? 'border-[#5d8c2c] ring-2 ring-[#5d8c2c]/20 bg-green-50/20'
                                                    : 'border-gray-200 hover:border-gray-300 hover:shadow-xs'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-bold text-[#5d8c2c]">
                                                            #{actualIndex + 1}
                                                        </span>
                                                        <h5 className="font-bold text-gray-900 text-xs sm:text-sm truncate">
                                                            {q.title}
                                                        </h5>
                                                    </div>
                                                    <p className="text-[11px] text-gray-500 line-clamp-2 mt-1">
                                                        {q.description}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewQuestion(q)}
                                                        className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-blue-50 transition-colors"
                                                        title="Preview Problem"
                                                    >
                                                        <Eye size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditQuestion(actualIndex)}
                                                        className="p-1 text-gray-400 hover:text-[#5d8c2c] rounded hover:bg-green-50 transition-colors"
                                                        title="Edit Problem"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteQuestion(actualIndex)}
                                                        className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
                                                        title="Delete Problem"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100 text-[11px]">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`px-2 py-0.5 rounded-full font-bold ${
                                                        q.difficulty === 'Easy'
                                                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                            : q.difficulty === 'Hard'
                                                            ? 'bg-red-50 text-red-700 border border-red-200'
                                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                                    }`}>
                                                        {q.difficulty}
                                                    </span>
                                                    <span className="font-bold text-gray-700">
                                                        {q.marks || 10}m
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-1.5 text-gray-500">
                                                    <span title="Public Test Cases" className="text-emerald-700 font-semibold">
                                                        {publicCount} pub
                                                    </span>
                                                    <span>/</span>
                                                    <span title="Hidden Test Cases" className="text-amber-700 font-semibold">
                                                        {hiddenCount} hid 🔒
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal: Preview Problem */}
            <AnimatePresence>
                {previewQuestion && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white border border-gray-200 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
                        >
                            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                                <div className="flex items-center gap-2">
                                    <Code2 size={18} className="text-[#5d8c2c]" />
                                    <h3 className="font-bold text-gray-900 text-base">
                                        Problem Preview: {previewQuestion.title}
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPreviewQuestion(null)}
                                    className="p-1 text-gray-400 hover:text-gray-600 rounded"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-6 overflow-y-auto space-y-4 text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full bg-green-50 text-[#5d8c2c] border border-green-200 text-xs font-bold">
                                        {previewQuestion.difficulty}
                                    </span>
                                    <span className="text-xs font-bold text-gray-500">
                                        {previewQuestion.marks} Marks
                                    </span>
                                </div>

                                <div>
                                    <h5 className="font-bold text-gray-900 mb-1">Description:</h5>
                                    <p className="whitespace-pre-wrap text-xs leading-relaxed font-sans">
                                        {previewQuestion.description}
                                    </p>
                                </div>

                                {previewQuestion.input_format && (
                                    <div>
                                        <h5 className="font-bold text-gray-900 mb-1">Input Format:</h5>
                                        <p className="text-xs text-gray-600">{previewQuestion.input_format}</p>
                                    </div>
                                )}

                                {previewQuestion.output_format && (
                                    <div>
                                        <h5 className="font-bold text-gray-900 mb-1">Output Format:</h5>
                                        <p className="text-xs text-gray-600">{previewQuestion.output_format}</p>
                                    </div>
                                )}

                                {previewQuestion.constraints && previewQuestion.constraints.length > 0 && (
                                    <div>
                                        <h5 className="font-bold text-gray-900 mb-1">Constraints:</h5>
                                        <ul className="list-disc pl-5 space-y-1 text-xs font-mono text-gray-600">
                                            {previewQuestion.constraints.map((c, i) => (
                                                <li key={i}>{c}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div>
                                    <h5 className="font-bold text-gray-900 mb-1">
                                        Test Cases ({previewQuestion.testCases?.length || 0}):
                                    </h5>
                                    <div className="space-y-2">
                                        {(previewQuestion.testCases || []).map((tc, i) => (
                                            <div
                                                key={i}
                                                className={`p-2.5 rounded-lg border text-xs font-mono ${
                                                    tc.is_hidden
                                                        ? 'bg-amber-50/50 border-amber-200 text-amber-900'
                                                        : 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-bold">Test #{i + 1}</span>
                                                    <span className="text-[10px] uppercase font-bold">
                                                        {tc.is_hidden ? '🔒 Hidden (Server Only)' : 'Public (Candidate Safe)'}
                                                    </span>
                                                </div>
                                                <div className="text-gray-600">
                                                    Input: {typeof tc.input === 'object' ? JSON.stringify(tc.input) : String(tc.input)}
                                                </div>
                                                <div className="text-emerald-700 font-semibold">
                                                    Expected: {typeof tc.expected === 'object' ? JSON.stringify(tc.expected) : String(tc.expected)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 border-t border-gray-200 flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setPreviewQuestion(null)}
                                    className="px-4 py-2 text-xs font-bold rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200"
                                >
                                    Close Preview
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ManualCodingBuilder;
