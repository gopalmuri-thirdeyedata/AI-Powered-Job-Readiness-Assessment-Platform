import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import {
    Play,
    CheckCircle,
    Clock,
    Terminal,
    ChevronRight,
    ChevronLeft,
    Code,
    Check,
    AlertTriangle,
    Plus,
    X,
    MonitorPlay,
    ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useProctoring from '../../hooks/useProctoring';
import useFaceProctoring from '../../hooks/useFaceProctoring';
import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';
import FullscreenGateModal from '../../components/FullscreenGateModal';
import ConfirmationModal from '../../components/ConfirmationModal';
import API_URL from '../../apiConfig';

// Language Configuration (Restricted to Python and Java)
const LANGUAGES = {
    python: { name: 'Python', monaco: 'python', icon: '🐍' },
    java: { name: 'Java', monaco: 'java', icon: '☕' }
};

// MULTIPLE CODING QUESTIONS with multi-language templates
const CODING_QUESTIONS = [
    {
        id: 1,
        title: "Loading Assessment...",
        description: "Please wait while we generate your customized assessment...",
        examples: [],
        constraints: [],
        starterCode: {
            python: `def solve(input_data):\n    # input_data is a dictionary\n    # return the result\n    pass`,
            java: `class Solution {\n    public int solve(int[] nums) {\n        // return the result\n        return 0;\n    }\n}`
        },
        defaultTestCases: []
    }
];

const CandidateCodingAssessment = () => {
    const navigate = useNavigate();

    // --- STATE MANAGEMENT ---

    // Navigation & Timer
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [questions, setQuestions] = useState(CODING_QUESTIONS); // Default to all, but will slice
    const [timeLeft, setTimeLeft] = useState(60 * 60); // Default 60m
    const [configuredTestCount, setConfiguredTestCount] = useState(5); // Default intensity
    const [submitted, setSubmitted] = useState(false);

    // Centered Alert Modal State
    const [alertModal, setAlertModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning',
        onConfirm: null
    });
    const showAlert = (title, message, type = 'warning', onConfirm = null) => {
        setAlertModal({ isOpen: true, title, message, type, onConfirm });
    };

    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [showTerminalOverlay, setShowTerminalOverlay] = useState(false);
    const [terminalMessage, setTerminalMessage] = useState('');
    const totalViolationsRef = useRef(0);
    const [violationCount, setViolationCount] = useState(0);
    const lastViolationTimeRef = useRef(0);

    const [boxes, setBoxes] = useState([]);
    const boxTimerRef = useRef(null);
    const [detectionStatus, setDetectionStatus] = useState('idle');

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (boxTimerRef.current) clearTimeout(boxTimerRef.current);
        };
    }, []);

    const [securityConfig, setSecurityConfig] = useState({
        faceProctoring: true,
        fullscreenProctoring: true
    });

    useEffect(() => {
        const token = localStorage.getItem('candidateToken') || localStorage.getItem('token');
        fetch(`${API_URL}/api/settings/`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.security) {
                    setSecurityConfig(data.security);
                }
            })
            .catch(err => console.error("Failed to load security settings", err));
    }, []);

    const handleTerminalViolation = (reason) => {
        handleSubmit(`Malpractice - ${reason}`);
        setTerminalMessage(`Maximum violations reached (${reason}). Your assessment has been submitted automatically.`);
        setShowTerminalOverlay(true);
    };

    // Unified violation handler with 3000ms debounce cooldown
    const handleViolation = (reason) => {
        if (submitted) return;

        const now = Date.now();
        if (now - lastViolationTimeRef.current < 3000) return;
        lastViolationTimeRef.current = now;

        totalViolationsRef.current += 1;
        const count = totalViolationsRef.current;
        setViolationCount(count);

        setWarningMessage(`Malpractice Detected: ${reason}. This attempt has been logged.`);
        setShowWarning(true);
        setTimeout(() => setShowWarning(false), 5000);

        if (count >= 3) {
            handleTerminalViolation(reason);
        }
    };
    const handleAnyViolation = handleViolation;

    const { violations } = useProctoring({
        enabled: !submitted,
        maxViolations: 999,
        onViolation: handleViolation,
        onTerminalViolation: () => {}
    });

    // Fullscreen enforcement
    const handleFullscreenTimeout = () => {
        handleViolation('Fullscreen exit exceeded 10-second recovery limit');
        if (totalViolationsRef.current >= 3) {
            handleTerminalViolation('Fullscreen exit exceeded 10-second recovery limit');
        }
    };

    const {
        isFullscreen,
        isGateOpen,
        isRecoveryOpen,
        recoveryTimeLeft,
        error: fullscreenError,
        enterFullscreen,
        returnToFullscreen
    } = useAssessmentFullscreen({
        enabled: !submitted && securityConfig.fullscreenProctoring,
        isCompleted: submitted,
        onRecoveryTimeout: handleFullscreenTimeout
    });

    // Silent background face detection
    const cameraVideoRef = useRef(null);
    const { cameraStream, streamRef, suspectLabel } = useFaceProctoring({
        enabled: !submitted && securityConfig.faceProctoring,
        onDetection: (status) => setDetectionStatus(status),
        onDetections: (dets, faceBoxes) => {
            const isSuspect = dets.some(d => d.class !== 'person');
            const allBoxes = [];

            // Face boxes — green normally, red when suspect also detected
            (faceBoxes || []).forEach(fb => {
                allBoxes.push({
                    label: 'face',
                    left:   `${(1 - fb[2]) * 100}%`,
                    top:    `${fb[1] * 100}%`,
                    width:  `${(fb[2] - fb[0]) * 100}%`,
                    height: `${(fb[3] - fb[1]) * 100}%`,
                    color:  isSuspect ? '#ef4444' : '#22c55e',
                });
            });

            // Suspicious object boxes — always red
            dets.filter(d => d.class !== 'person' && d.bbox).forEach(d => {
                allBoxes.push({
                    label: d.class,
                    left:   `${(1 - d.bbox[2]) * 100}%`,
                    top:    `${d.bbox[1] * 100}%`,
                    width:  `${(d.bbox[2] - d.bbox[0]) * 100}%`,
                    height: `${(d.bbox[3] - d.bbox[1]) * 100}%`,
                    color:  '#ef4444',
                });
            });

            setBoxes(allBoxes);
            if (boxTimerRef.current) clearTimeout(boxTimerRef.current);
            boxTimerRef.current = setTimeout(() => setBoxes([]), 4000);
        },
        onViolation: handleAnyViolation
    });

    // Bind camera stream and keep playing through fullscreen transitions
    useEffect(() => {
        const bindAndPlay = () => {
            const el = cameraVideoRef.current;
            const stream = streamRef.current;
            if (!el || !stream) return;
            if (el.srcObject !== stream) {
                el.srcObject = stream;
            }
            // Always try to play — fullscreen transition pauses the video
            if (el.paused) {
                el.play().catch(() => {});
            }
        };

        // Poll every 500ms to recover from fullscreen-caused pauses
        const bindInterval = setInterval(bindAndPlay, 500);

        // Also immediately rebind when fullscreen changes
        document.addEventListener('fullscreenchange', bindAndPlay);

        return () => {
            clearInterval(bindInterval);
            document.removeEventListener('fullscreenchange', bindAndPlay);
        };
    }, []);

    const [scoreResult, setScoreResult] = useState(null);

    // Load Config from LocalStorage + Guard against re-entry
    useEffect(() => {
        const init = async () => {
            // Guard: Check backend status first to prevent re-entry after submission
            const token = localStorage.getItem('candidateToken');
            if (token) {
                try {
                    const res = await fetch(`${API_URL}/api/assessments/my-status/`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.status === 'completed') {
                            localStorage.removeItem('currentAssessment');
                            localStorage.removeItem('candidateToken');
                            navigate('/portal/login');
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('[Assessment] Status check failed, proceeding:', e);
                }
            }

            try {
                const stored = localStorage.getItem('currentAssessment');
                if (stored) {
                    const data = JSON.parse(stored);
                    if (data.config) {
                        // CRITICAL: Load AI-Generated Questions (Dynamic)
                        if (data.config.generated_questions && data.config.generated_questions.length > 0) {
                            const dynamicQuestions = data.config.generated_questions.map(q => {
                                const STRICT_TEMPLATES = {
                                    python: `def solve(input_data):\n    # return the result\n    pass`,
                                    java: `class Solution {\n    public Object solve(Object input) {\n        // return the result\n        return null;\n    }\n}`
                                };

                                // Use ALL generated test cases - count is set by admin's testIntensity
                                const tcList = (q.testCases && q.testCases.length > 0)
                                    ? q.testCases
                                    : [{ id: 1, input: {}, expected: '' }];

                                return {
                                    id: q.id,
                                    title: q.title || 'Coding Challenge',
                                    description: q.description || 'Solve this problem.',
                                    input_format: q.input_format || '',
                                    output_format: q.output_format || '',
                                    difficulty: q.difficulty || 'Medium',
                                    marks: q.marks || 10,
                                    examples: (q.examples && q.examples.length > 0) ? q.examples : [{ input: 'Example input', output: 'Example output', explanation: 'No examples provided' }],
                                    testCases: tcList,
                                    defaultTestCases: tcList,
                                    constraints: q.constraints || [],
                                    starterCode: {
                                        python: q.starterCode?.python || STRICT_TEMPLATES.python,
                                        java: q.starterCode?.java || STRICT_TEMPLATES.java
                                    }
                                };
                            });
                            setQuestions(dynamicQuestions);
                        } else if (data.config.questionCount) {
                            setQuestions(CODING_QUESTIONS.slice(0, data.config.questionCount));
                        }

                        // Sync Time Limit
                        if (data.config.timeLimit) {
                            setTimeLeft(data.config.timeLimit * 60);
                        }
                        // Sync Test Intensity
                        if (data.config.testIntensity) {
                            setConfiguredTestCount(data.config.testIntensity);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load assessment config", e);
            }
        };

        init();
    }, []);


    // Language State
    const [selectedLanguage, setSelectedLanguage] = useState('python');

    // Code State - initialized with all language templates
    const [codeByQuestion, setCodeByQuestion] = useState({});

    // FORCE SYNC: When questions load (from local storage or default), reset code state to Strict Templates
    // Added dependency on assessment.id to force reset if a different assessment is loaded on the same machine
    useEffect(() => {
        const assessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');
        const assessmentId = assessment.id || 'default';

        const newCodeState = {};
        questions.forEach((q, idx) => {
            newCodeState[idx] = { ...q.starterCode };
        });
        setCodeByQuestion(newCodeState);
        setAttemptedQuestions(new Set());
    }, [questions]);
    const [attemptedQuestions, setAttemptedQuestions] = useState(new Set());

    // UI State
    const [activeLeftTab, setActiveLeftTab] = useState('description'); // description, examples, constraints
    const [activeRightTab, setActiveRightTab] = useState('testcases'); // testcases, results
    const [isRunning, setIsRunning] = useState(false);

    // Test Case State
    const [activeTestCaseId, setActiveTestCaseId] = useState(1);
    const [customTestCases, setCustomTestCases] = useState(CODING_QUESTIONS[0].defaultTestCases);
    const [executionResults, setExecutionResults] = useState(null);
    const [testResultsByQuestion, setTestResultsByQuestion] = useState({
        0: { passed: 0, total: 5 },
        1: { passed: 0, total: 5 }
    }); // Note: Total will be updated on run

    // Layout State (Resizable)
    const [leftPanelWidth, setLeftPanelWidth] = useState(30); // Default 30% (Editor gets 70%)
    const [consoleHeight, setConsoleHeight] = useState(30);   // Default 30% percentage
    const [isDragging, setIsDragging] = useState(null);       // 'horizontal' | 'vertical' | null
    const [isCollaspedLeft, setIsCollapsedLeft] = useState(false);

    // Derived
    const currentQuestion = questions[currentQuestionIndex] || questions[0];
    const currentCode = codeByQuestion[currentQuestionIndex]?.[selectedLanguage] || '';

    // --- EFFECTS ---

    // Timer Logic
    useEffect(() => {
        // Only tick down if test is active and not blocked by entry gate or recovery modal
        if (!submitted && timeLeft > 0 && !isGateOpen && !isRecoveryOpen) {
            const timer = setInterval(() => {
                setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
            }, 1000);
            return () => clearInterval(timer);
        } else if (timeLeft === 0 && !submitted) {
            handleSubmit();
        }
    }, [timeLeft, submitted, isGateOpen, isRecoveryOpen]);

    // Update test cases when question changes
    useEffect(() => {
        setCustomTestCases(currentQuestion.defaultTestCases);
        setActiveTestCaseId(1);
        setExecutionResults(null);
        setActiveRightTab('testcases');
    }, [currentQuestion, currentQuestionIndex]);

    // ANTI-MALPRACTICE: Prevent Back Button / Refresh (Handled by useProctoring)
    useEffect(() => {
        const handleUnload = (e) => {
            if (!submitted) {
                const token = localStorage.getItem('candidateToken');
                fetch(`${API_URL}/api/assessments/submit/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ result: { passed: 0, total: 10 }, status: 'Malpractice - Assessment Abandoned' }),
                    keepalive: true
                });
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, [submitted]);

    // --- RESIZE HANDLERS ---

    // Attach to window/document to handle fast drags
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            if (isDragging === 'horizontal') {
                const newWidth = (e.clientX / window.innerWidth) * 100;
                // Clamp between 15% and 50%
                if (newWidth > 15 && newWidth < 50) setLeftPanelWidth(newWidth);
            } else if (isDragging === 'vertical') {
                // Get the right panel element to calculate relative to it
                const rightPanel = document.querySelector('[data-right-panel]');
                if (!rightPanel) return;

                const rect = rightPanel.getBoundingClientRect();
                const relativeY = e.clientY - rect.top;
                const panelHeight = rect.height;

                // Calculate console height as percentage from bottom
                const newHeight = ((panelHeight - relativeY) / panelHeight) * 100;

                if (newHeight > 5 && newHeight < 60) setConsoleHeight(newHeight);
            }
        };

        const handleMouseUp = () => {
            setIsDragging(null);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    // --- HANDLERS ---

    const handleCodeChange = (value) => {
        setCodeByQuestion(prev => ({
            ...prev,
            [currentQuestionIndex]: {
                ...prev[currentQuestionIndex],
                [selectedLanguage]: value
            }
        }));
        if (value !== currentQuestion.starterCode[selectedLanguage]) {
            setAttemptedQuestions(prev => new Set([...prev, currentQuestionIndex]));
        }
    };

    const handleLanguageChange = (lang) => {
        setSelectedLanguage(lang);
    };

    const handleAddTestCase = () => {
        const newId = Math.max(...customTestCases.map(tc => tc.id), 0) + 1;
        setCustomTestCases([...customTestCases, { id: newId, input: "", expected: "" }]);
        setActiveTestCaseId(newId);
    };

    const handleRemoveTestCase = (id, e) => {
        e.stopPropagation();
        if (customTestCases.length <= 1) return;
        setCustomTestCases(customTestCases.filter(tc => tc.id !== id));
        if (activeTestCaseId === id) {
            setActiveTestCaseId(customTestCases[0].id);
        }
    };

    const handleTestCaseChange = (id, field, value) => {
        setCustomTestCases(customTestCases.map(tc =>
            tc.id === id ? { ...tc, [field]: value } : tc
        ));
    };

    const handleRunCode = async () => {
        setIsRunning(true);
        setActiveRightTab('results');

        setExecutionResults(null); // Clear previous

        try {
            const token = localStorage.getItem('candidateToken');
            const res = await fetch(`${API_URL}/api/assessments/execute/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    code: currentCode,
                    language: selectedLanguage,
                    question: currentQuestion,
                    testCases: customTestCases,
                    questionId: currentQuestion.id
                })
            });

            if (res.ok) {
                const data = await res.json();

                // If AI execution returns results, use them.
                if (!data.syntax_valid) {
                    // Show Syntax Error
                    setExecutionResults([{
                        id: 0,
                        status: 'error',
                        output: data.error_message || "Syntax Error",
                        expected: "-",
                        input: "Compilation"
                    }]);
                } else if (data.results && data.results.length > 0) {
                    // Use real results
                    setExecutionResults(data.results);
                } else {
                    // Fallback
                    setExecutionResults([{ status: 'failed', output: "No results returned from execution engine", expected: "-", input: "-" }]);
                }

                // Update Test Results Stats
                const visibleResults = data.results || [];
                const visiblePassed = visibleResults.filter(r => r.status === 'passed').length;
                const visibleTotal = visibleResults.length;

                // Use actually generated test cases for the total
                const actualTotal = currentQuestion.testCases?.length || visibleTotal;

                setTestResultsByQuestion(prev => ({
                    ...prev,
                    [currentQuestionIndex]: {
                        passed: visiblePassed,
                        total: actualTotal
                    }
                }));

            } else {
                setExecutionResults([{ status: 'error', output: "Execution Server Error", expected: "-", input: "System" }]);
            }
        } catch (error) {
            console.error(error);
            setExecutionResults([{ status: 'error', output: "Network Error", expected: "-", input: "System" }]);
        } finally {
            setIsRunning(false);
        }
    };

    const handleSubmit = async (forcedStatus = null) => {
        if (submitted) return;

        const token = localStorage.getItem('candidateToken');
        if (!token) {
            if (!forcedStatus) {
                showAlert('Session Expired', 'Session expired. Please login again.', 'warning', () => navigate('/portal/login'));
            } else {
                navigate('/portal/login');
            }
            return;
        }

        // If proctoring auto-submit, clear everything and submit
        if (forcedStatus) setSubmitted(true);

        // Clear local storage IMMEDIATELY to prevent auto-resume/reload race conditions
        localStorage.removeItem('currentAssessment');
        localStorage.removeItem('candidateToken');
        localStorage.removeItem('aptitudeQuestions');

        try {
            // Aggregate all code results
            const finalResults = {
                passed: 0,
                total: 0
            };

            Object.values(testResultsByQuestion).forEach(res => {
                finalResults.passed += (res.passed || 0);
                finalResults.total += (res.total || 0);
            });

            const response = await fetch(`${API_URL}/api/assessments/submit/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    result: finalResults,
                    status: forcedStatus,
                    code: codeByQuestion,
                    language: selectedLanguage,
                    answers: {
                        codeByQuestion,
                        selectedLanguage
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                setSubmitted(true);
                if (data.score !== undefined) {
                    setScoreResult(data.score * 10);
                }
            } else if (response.status === 401) {
                if (!forcedStatus) {
                    showAlert('Session Expired', 'Your session has expired. Please log in again to continue.', 'warning', () => navigate('/portal/login'));
                }
            } else if (response.status === 400) {
                console.warn('[Submit] Assessment was already submitted — ignoring duplicate.');
                setSubmitted(true);
            } else {
                if (!forcedStatus) {
                    showAlert('Submission Failed', 'Failed to submit assessment. Please try again.', 'danger');
                }
            }
        } catch (e) {
            console.error("Submission failed:", e);
            if (!forcedStatus) {
                showAlert('Network Error', 'Network error. Please check connection.', 'danger');
            }
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    if (submitted) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900 p-4">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-gray-800 border border-gray-700 rounded-2xl shadow-xl p-8 max-w-lg w-full text-center">
                    <div className="w-20 h-20 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="text-green-500" size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Assessment Completed</h2>
                    <p className="text-gray-400 mb-6">Thank you for completing the assessment. Our recruitment team will review your performance.</p>
                    <div className="flex flex-col gap-3">
                        <button onClick={() => navigate('/portal/login')} className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors">Return to Portal</button>
                        <button
                            onClick={() => {
                                localStorage.clear();
                                navigate('/portal/login');
                            }}
                            className="w-full py-3 bg-gray-700 text-gray-300 rounded-xl font-semibold hover:bg-gray-600 transition-colors"
                        >
                            Log Out
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-gray-950 text-gray-300 overflow-hidden font-sans selection:bg-blue-500/30">
            {/* Fullscreen Gate & Recovery Modal */}
            <FullscreenGateModal
                isOpen={!submitted && securityConfig.fullscreenProctoring && (isGateOpen || isRecoveryOpen)}
                mode={isRecoveryOpen ? 'recovery' : 'entry'}
                timeLeft={recoveryTimeLeft}
                error={fullscreenError}
                onAction={isRecoveryOpen ? returnToFullscreen : enterFullscreen}
            />

            {/* ── Corner Camera Preview Widget (bottom-right, above console) ── */}
            <div className="fixed bottom-6 right-4 z-40 group">
                {/* Bounding box — solid colored border */}
                <div style={{
                    position: 'relative',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    width: '220px',
                    height: '165px',
                    background: '#111',
                    border: suspectLabel ? '3px solid #ef4444' : '3px solid #22c55e',
                    boxShadow: suspectLabel
                        ? '0 0 0 1px #ef4444, 0 0 20px rgba(239,68,68,0.6)'
                        : '0 0 0 1px #16a34a, 0 4px 20px rgba(0,0,0,0.25)',
                    animation: suspectLabel ? 'suspectBlink 0.7s ease-in-out infinite alternate' : 'none',
                    transition: 'border-color 0.3s ease, box-shadow 0.3s ease'
                }}>
                    <video ref={cameraVideoRef} autoPlay playsInline muted
                        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', transform: 'scaleX(-1)' }} />

                    {/* Bounding box divs — positioned over video */}
                    {boxes.map((box, i) => (
                        <div key={i} style={{
                            position: 'absolute',
                            left: box.left,
                            top: box.top,
                            width: box.width,
                            height: box.height,
                            border: `2.5px solid ${box.color}`,
                            boxShadow: `0 0 8px ${box.color}88`,
                            pointerEvents: 'none',
                            boxSizing: 'border-box',
                            borderRadius: '2px',
                        }}>
                            {/* Small label only for suspicious items (not face) */}
                            {box.label !== 'face' && (
                                <span style={{
                                    position: 'absolute', bottom: '-18px', left: '-1px',
                                    background: box.color, color: '#fff',
                                    fontSize: '8px', fontWeight: 700,
                                    padding: '1px 4px', borderRadius: '0 0 3px 3px',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {box.label}
                                </span>
                            )}
                        </div>
                    ))}

                    {/* LIVE / ALERT badge */}
                    <div style={{ position: 'absolute', top: '7px', left: '7px', display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: '20px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: suspectLabel ? '#ef4444' : '#4ade80', animation: 'livePulse 1.2s ease-in-out infinite' }} />
                        <span style={{ color: '#fff', fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em' }}>{suspectLabel ? 'ALERT' : 'LIVE'}</span>
                    </div>

                    {/* Red tint overlay when suspect */}
                    {suspectLabel && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            background: 'rgba(239,68,68,0.15)',
                            pointerEvents: 'none'
                        }} />
                    )}
                </div>

                {/* Status label — only show when suspect detected */}
                {suspectLabel && (
                    <div style={{
                        marginTop: '5px', textAlign: 'center', padding: '4px 8px', borderRadius: '8px',
                        background: '#fef2f2', border: '2px solid #fca5a5', transition: 'all 0.3s ease'
                    }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: '#dc2626' }}>
                            {suspectLabel}
                        </span>
                    </div>
                )}

                <style>{`
                    @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.3} }
                    @keyframes suspectBlink { from{border-color:#ef4444;box-shadow:0 0 0 1px #ef4444,0 0 20px rgba(239,68,68,0.5)} to{border-color:#dc2626;box-shadow:0 0 0 1px #dc2626,0 0 28px rgba(239,68,68,0.9)} }
                `}</style>
            </div>

            {/* Warning Banner */}
            <AnimatePresence>
                {showWarning && (
                    <motion.div
                        initial={{ opacity: 0, y: -50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -50 }}
                        className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white px-6 py-4 shadow-2xl"
                    >
                        <div className="max-w-5xl mx-auto flex items-center gap-4">
                            <AlertTriangle size={28} className="flex-shrink-0 animate-pulse" />
                            <div className="flex-1">
                                <p className="font-bold text-lg">{warningMessage}</p>
                                <p className="text-sm text-red-100 mt-1">Warning: {violationCount}/3 - Further violations will result in automatic submission.</p>
                            </div>
                            {violationCount < 3 && (
                                <button
                                    onClick={() => setShowWarning(false)}
                                    className="text-white/60 hover:text-white text-xl ml-2 leading-none flex-shrink-0"
                                >✕</button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Terminal Violation Overlay */}
            <AnimatePresence>
                {showTerminalOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-[200] bg-gray-950/90 backdrop-blur-md flex items-center justify-center p-4 text-center"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-gray-900 border border-red-500/50 p-8 rounded-2xl max-w-md shadow-2xl"
                        >
                            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                <AlertTriangle size={40} className="text-red-500 animate-pulse" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">Assessment Terminated</h2>
                            <p className="text-gray-400 mb-8">{terminalMessage}</p>
                            <button
                                onClick={() => navigate('/portal/login')}
                                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors"
                            >
                                Return to Portal
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* --- HEADER --- */}
            <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="bg-blue-600/20 p-1.5 rounded-lg">
                            <Code size={18} className="text-blue-500" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-gray-100">Coding Assessment</h2>
                            <span className="text-xs text-gray-500">Question {currentQuestionIndex + 1}/{questions.length}</span>
                        </div>
                    </div>
                    <div className="h-6 w-px bg-gray-800 mx-2" />
                    <div className="flex flex-1 overflow-x-auto gap-1">
                        {questions.map((q, idx) => (
                            <button
                                key={q.id}
                                onClick={() => setCurrentQuestionIndex(idx)}
                                className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-2 whitespace-nowrap ${currentQuestionIndex === idx
                                    ? 'bg-gray-800 text-white shadow-sm ring-1 ring-gray-700 font-semibold'
                                    : 'text-gray-300 hover:text-white hover:bg-gray-800/50'
                                    }`}
                            >
                                {attemptedQuestions.has(idx) && <Check size={12} className="text-green-500" />}
                                {idx + 1}. {q.title}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded bg-gray-800 border border-gray-700`}>
                        <Clock size={14} className={timeLeft < 300 ? 'text-red-500' : 'text-gray-400'} />
                        <span className={`text-sm font-mono font-bold ${timeLeft < 300 ? 'text-red-400' : 'text-gray-200'}`}>{formatTime(timeLeft)}</span>
                    </div>
                    <button
                        onClick={() => handleSubmit()}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded text-sm font-semibold transition-colors shadow-lg shadow-green-900/20"
                    >
                        Submit
                    </button>
                </div>
            </header>

            {/* --- MAIN CONTENT (SPLIT LAYOUT) --- */}
            <div
                className="flex-1 flex overflow-hidden select-none bg-gray-900"
                onMouseMove={(e) => {
                    // Fallback move handler needed here if mouse leaves iframe/document
                    // Although main logic is in useEffect, having it here helps propagation
                }}
            >

                {/* LEFT PANEL (Resizable) */}
                <div
                    className={`flex flex-col border-r border-gray-800 bg-gray-900 transition-none ${isCollaspedLeft ? 'hidden' : 'flex'}`}
                    style={{ width: `${leftPanelWidth}%`, minWidth: '15%', maxWidth: '50%' }}
                >
                    {/* Tabs */}
                    <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-2 mt-2">
                        <div className="flex">
                            {['Description', 'Examples', 'Constraints'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveLeftTab(tab.toLowerCase())}
                                    className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeLeftTab === tab.toLowerCase()
                                        ? 'border-blue-500 text-blue-400 font-semibold'
                                        : 'border-transparent text-gray-300 hover:text-white'
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setIsCollapsedLeft(true)}
                            className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                            title="Collapse Problem View"
                        >
                            <ChevronLeft size={16} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeLeftTab}
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                                transition={{ duration: 0.15 }}
                            >
                                <h3 className="text-xl font-bold text-white mb-4">{currentQuestion.title}</h3>

                                {activeLeftTab === 'description' && (
                                    <div className="space-y-4">
                                        <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                                            {currentQuestion.description}
                                        </p>

                                        {currentQuestion.input_format && (
                                            <div className="pt-2 border-t border-gray-800">
                                                <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-1">Input Format</h4>
                                                <p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{currentQuestion.input_format}</p>
                                            </div>
                                        )}

                                        {currentQuestion.output_format && (
                                            <div className="pt-2 border-t border-gray-800">
                                                <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-1">Output Format</h4>
                                                <p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{currentQuestion.output_format}</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeLeftTab === 'examples' && (
                                    <div className="space-y-5">
                                        {currentQuestion.examples.map((ex, idx) => (
                                            <div key={idx} className="rounded-lg border border-gray-700/60 overflow-hidden">
                                                <div className="bg-gray-800/60 px-4 py-2 border-b border-gray-700/40">
                                                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Example {idx + 1}</span>
                                                </div>
                                                <div className="p-4 space-y-3 bg-gray-900/40">
                                                    {/* Input */}
                                                    <div>
                                                        <p className="text-xs font-bold text-gray-200 mb-1">Input</p>
                                                        <pre className="text-xs font-mono text-gray-100 bg-gray-800/70 border border-gray-700/40 rounded px-3 py-2 whitespace-pre-wrap leading-relaxed">
                                                            {typeof ex.input === 'object' ? JSON.stringify(ex.input) : String(ex.input)}
                                                        </pre>
                                                    </div>
                                                    {/* Output */}
                                                    <div>
                                                        <p className="text-xs font-bold text-gray-200 mb-1">Output</p>
                                                        <pre className="text-xs font-mono text-green-300 bg-green-900/20 border border-green-800/30 rounded px-3 py-2 whitespace-pre-wrap">
                                                            {typeof ex.output === 'object' ? JSON.stringify(ex.output) : String(ex.output)}
                                                        </pre>
                                                    </div>
                                                    {/* Explanation */}
                                                    {ex.explanation && ex.explanation.trim() && (
                                                        <div>
                                                            <p className="text-xs font-bold text-gray-200 mb-1">Explanation</p>
                                                            <p className="text-xs text-gray-300 leading-relaxed">{ex.explanation.trim()}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeLeftTab === 'constraints' && (
                                    <div className="animate-in fade-in slide-in-from-left-2 duration-300">
                                        {currentQuestion.constraints && currentQuestion.constraints.filter(c => c && c.trim()).length > 0 ? (
                                            <ul className="space-y-2">
                                                {currentQuestion.constraints.filter(c => c && c.trim()).map((c, i) => (
                                                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                                                        <span className="text-blue-500 mt-0.5 shrink-0">•</span>
                                                        <code className="font-mono text-xs text-gray-200 bg-gray-800/60 rounded px-2 py-1 leading-relaxed">{c}</code>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-10 text-gray-600 opacity-50">
                                                <AlertTriangle size={32} className="mb-2" />
                                                <p className="text-xs italic">Review problem description for constraints.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>

                {/* LEFT COLLAPSED STRIP */}
                {isCollaspedLeft && (
                    <div className="w-10 border-r border-gray-800 bg-gray-900 flex flex-col items-center py-2 z-20 shrink-0">
                        <button onClick={() => setIsCollapsedLeft(false)} className="p-1.5 hover:bg-gray-800 rounded mb-4 text-blue-500 hover:text-blue-400">
                            <ChevronRight size={20} />
                        </button>
                        <div className="writing-vertical-lr text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2 rotate-180" style={{ writingMode: 'vertical-rl' }}>
                            <span className="mb-2">Problem Description</span>
                        </div>
                    </div>
                )}


                {/* HORIZONTAL RESIZER */}
                {!isCollaspedLeft && (
                    <div
                        className="w-1 cursor-col-resize hover:bg-blue-600 active:bg-blue-600 bg-gray-900 transition-colors z-20 flex items-center justify-center group shrink-0"
                        onMouseDown={(e) => { e.preventDefault(); setIsDragging('horizontal'); }}
                    >
                        <div className="h-8 w-0.5 bg-gray-800 group-hover:bg-blue-300 rounded-full transition-colors" />
                    </div>
                )}


                {/* RIGHT PANEL: EDITOR & CONSOLE */}
                <div className="flex-1 flex flex-col bg-gray-900 overflow-hidden relative min-w-0" data-right-panel style={{ isolation: 'isolate' }}>

                    {/* EDITOR CONTAINER (FLEX-1: Takes remaining space) */}
                    <div className="flex-1 relative flex flex-col min-h-0 bg-gray-900" style={{ contain: 'layout paint', willChange: 'auto' }}>
                        {/* Language Selector Header */}
                        <div className="flex items-center justify-between bg-gray-900 border-b border-gray-800 px-4 py-2 shrink-0">
                            <div className="flex items-center gap-2">
                                <Code size={14} className="text-gray-500" />
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Code Editor</span>
                            </div>

                            {/* Language Dropdown */}
                            <div className="relative group">
                                <button className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm font-medium text-gray-200 transition-colors cursor-pointer">
                                    <span className="text-base">{LANGUAGES[selectedLanguage].icon}</span>
                                    <span>{LANGUAGES[selectedLanguage].name}</span>
                                    <ChevronDown size={14} className="text-gray-500" />
                                </button>

                                {/* Dropdown Menu */}
                                <div className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 min-w-[160px] max-h-[280px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                                    {Object.entries(LANGUAGES).map(([lang, config]) => (
                                        <button
                                            key={lang}
                                            onClick={() => handleLanguageChange(lang)}
                                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-700 transition-colors ${selectedLanguage === lang ? 'bg-gray-700 text-white' : 'text-gray-300'
                                                } first:rounded-t-md last:rounded-b-md`}
                                        >
                                            <span className="text-base">{config.icon}</span>
                                            <span>{config.name}</span>
                                            {selectedLanguage === lang && <Check size={14} className="ml-auto text-green-500" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Monaco Editor */}
                        <div className="flex-1 border-b border-gray-800 bg-[#1e1e1e]">
                            <Editor
                                key={selectedLanguage} // FORCE REMOUNT on language change to prevent state mixup
                                height="100%"
                                language={LANGUAGES[selectedLanguage].monaco}
                                theme="vs-dark"
                                value={currentCode}
                                onChange={handleCodeChange}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    fontFamily: "'JetBrains Mono', monospace",
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    padding: { top: 20, bottom: 20 },
                                    codeLens: false,
                                    lineHeight: 22,
                                    letterSpacing: 0.5
                                }}
                            />
                        </div>
                    </div>

                    {/* VERTICAL RESIZER */}
                    <div
                        className="h-1 cursor-row-resize hover:bg-blue-600 active:bg-blue-600 bg-gray-900 transition-colors z-30 w-full flex justify-center items-center group shrink-0"
                        onMouseDown={(e) => { e.preventDefault(); setIsDragging('vertical'); }}
                    >
                        <div className="w-12 h-0.5 bg-gray-700 group-hover:bg-blue-300 rounded-full transition-colors" />
                    </div>

                    {/* CONSOLE (Optimized for gap-free resize) */}
                    <div className="flex flex-col bg-gray-900" style={{
                        flexBasis: `${consoleHeight}%`,
                        flexGrow: 0,
                        flexShrink: 0,
                        minHeight: '5%',
                        maxHeight: '60%',
                        contain: 'layout paint',
                        willChange: isDragging === 'vertical' ? 'flex-basis' : 'auto'
                    }}>
                        {/* Console Tabs */}
                        <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-2 min-h-[40px] shrink-0">
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setActiveRightTab('testcases')}
                                    className={`px-3 py-2 text-xs font-medium border-t-2 items-center flex gap-2 ${activeRightTab === 'testcases' ? 'border-blue-500 text-white bg-gray-800 font-semibold' : 'border-transparent text-gray-300 hover:text-white'
                                        }`}
                                >
                                    <CheckCircle size={14} /> Test Cases
                                </button>
                                <button
                                    onClick={() => setActiveRightTab('results')}
                                    className={`px-3 py-2 text-xs font-medium border-t-2 items-center flex gap-2 ${activeRightTab === 'results' ? 'border-green-500 text-white bg-gray-800 font-semibold' : 'border-transparent text-gray-300 hover:text-white'
                                        }`}
                                >
                                    <Terminal size={14} /> Test Results
                                </button>
                            </div>
                            <div className="flex items-center gap-2 pr-2">
                                <button
                                    onClick={() => setConsoleHeight(consoleHeight < 10 ? 30 : 5)}
                                    className="p-1.5 text-gray-500 hover:bg-gray-800 rounded"
                                    title={consoleHeight < 10 ? "Maximize Console" : "Minimize Console"}
                                >
                                    {consoleHeight < 10 ? <ChevronLeft size={14} className="rotate-90" /> : <ChevronLeft size={14} className="-rotate-90" />}
                                </button>
                                <button
                                    onClick={handleRunCode}
                                    disabled={isRunning}
                                    className="px-4 py-1.5 rounded-md bg-transparent border border-gray-700 text-gray-300 text-xs font-bold hover:bg-gray-800 transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isRunning ? <span className="animate-spin">⟳</span> : <Play size={12} />} Run Code
                                </button>
                            </div>
                        </div>

                        {/* Console Content */}
                        <div className="flex-1 overflow-hidden flex bg-gray-900">
                            {/* TEST CASES TAB */}
                            {activeRightTab === 'testcases' && (
                                <div className="flex-1 flex flex-col p-4 overflow-y-auto custom-scrollbar bg-gray-900">
                                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                                        {customTestCases.map((tc, idx) => (
                                            <div key={tc.id} className="relative group">
                                                <button
                                                    onClick={() => setActiveTestCaseId(tc.id)}
                                                    className={`px-3 py-1.5 rounded text-xs font-medium border ${activeTestCaseId === tc.id ? 'bg-gray-800 border-gray-600 text-white font-semibold' : 'bg-transparent border-gray-800 text-gray-300 hover:text-white hover:border-gray-700'
                                                        }`}
                                                >
                                                    Case {idx + 1}
                                                </button>
                                                <button
                                                    onClick={(e) => handleRemoveTestCase(tc.id, e)}
                                                    className="absolute -top-1.5 -right-1.5 bg-gray-700 text-gray-400 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ))}
                                        <button onClick={handleAddTestCase} className="px-2 py-1.5 rounded text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                                            <Plus size={14} />
                                        </button>
                                    </div>

                                    {customTestCases.find(tc => tc.id === activeTestCaseId) && (() => {
                                        const activeTC = customTestCases.find(tc => tc.id === activeTestCaseId);
                                        const inp = activeTC?.input;
                                        // Format as LeetCode-style: param = value (one per line)
                                        let displayValue = '';
                                        if (inp && typeof inp === 'object' && !Array.isArray(inp)) {
                                            displayValue = Object.entries(inp)
                                                .map(([k, v]) => {
                                                    const val = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
                                                    return `${k} = ${val}`;
                                                })
                                                .join('\n');
                                        } else {
                                            displayValue = typeof inp === 'object' ? JSON.stringify(inp, null, 2) : String(inp ?? '');
                                        }
                                        return (
                                            <div className="space-y-3 animate-in fade-in duration-200">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-300 uppercase block mb-1">Input</label>
                                                    <pre className="w-full bg-gray-800/60 border border-gray-700/50 rounded p-3 text-sm font-mono text-gray-200 leading-relaxed whitespace-pre-wrap">{displayValue}</pre>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* RESULTS TAB */}
                            {activeRightTab === 'results' && (
                                <div className="flex-1 flex flex-col p-4 overflow-y-auto custom-scrollbar bg-gray-900">
                                    {!executionResults ? (
                                        <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
                                            <MonitorPlay size={32} className="mb-2 opacity-50" />
                                            <p className="text-sm">Run code to see results</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            {/* Summary */}
                                            <div className={`p-3 rounded-lg border ${executionResults.every(r => r.status === 'passed') ? 'bg-green-900/20 border-green-800' : (executionResults.some(r => r.status === 'error') ? 'bg-green-100/80 border-green-400' : 'bg-red-900/20 border-red-800')}`}>
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h3 className={`text-sm font-bold ${executionResults.every(r => r.status === 'passed') ? 'text-green-400' : (executionResults.some(r => r.status === 'error') ? 'text-green-600' : 'text-red-400')}`}>
                                                            {executionResults.every(r => r.status === 'passed') ? 'Accepted' : (executionResults.some(r => r.status === 'error') ? 'Compilation Error' : 'Wrong Answer')}
                                                        </h3>
                                                        <p className="text-xs text-gray-400 mt-1">
                                                            {testResultsByQuestion[currentQuestionIndex]?.passed || 0} / {testResultsByQuestion[currentQuestionIndex]?.total || currentQuestion.testCases?.length || 0} total cases passed
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Details */}
                                            <div className="space-y-4">
                                                {executionResults.map((res, idx) => (
                                                    <div key={idx} className="group">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className={`text-xs font-bold uppercase flex items-center gap-2 ${res.status === 'passed' ? 'text-green-500' : 'text-red-500'}`}>
                                                                {res.status === 'passed' ? <Check size={14} /> : <X size={14} />} Case {idx + 1}
                                                            </span>
                                                            <span className="text-[10px] text-gray-600 font-mono">{res.runtime}</span>
                                                        </div>
                                                        <div className="bg-gray-800/50 rounded-lg p-3 space-y-2 border border-gray-800 group-hover:border-gray-700 transition-colors">
                                                            <div className="grid grid-cols-[60px_1fr] gap-2">
                                                                <span className="text-xs text-gray-300">Input:</span>
                                                                <code className="text-xs font-mono text-gray-300 bg-gray-900 px-1.5 py-0.5 rounded w-fit">
                                                                    {typeof res.input === 'object' ? JSON.stringify(res.input) : String(res.input)}
                                                                </code>
                                                            </div>
                                                            <div className="grid grid-cols-[60px_1fr] gap-2">
                                                                <span className="text-xs text-gray-300">Output:</span>
                                                                <code className={`text-xs font-mono px-1.5 py-0.5 rounded w-fit ${res.status === 'passed' ? 'text-green-300 bg-green-900/20' : 'text-red-300 bg-red-900/20'}`}>
                                                                    {typeof res.output === 'object' ? JSON.stringify(res.output) : String(res.output)}
                                                                </code>
                                                            </div>
                                                            {res.status !== 'passed' && (
                                                                <div className="grid grid-cols-[60px_1fr] gap-2">
                                                                    <span className="text-xs text-gray-300">Expected:</span>
                                                                    <code className="text-xs font-mono text-gray-300 bg-gray-900 px-1.5 py-0.5 rounded w-fit">
                                                                        {typeof res.expected === 'object' ? JSON.stringify(res.expected) : String(res.expected)}
                                                                    </code>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Centered In-App Alert Modal */}
            <ConfirmationModal
                isOpen={alertModal.isOpen}
                onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={alertModal.onConfirm}
                title={alertModal.title}
                message={alertModal.message}
                type={alertModal.type}
                confirmText="OK"
                isAlert={true}
            />
        </div>
    );
};

export default CandidateCodingAssessment;
