import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useProctoring from '../../hooks/useProctoring';
import useFaceProctoring from '../../hooks/useFaceProctoring';
import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';
import FullscreenGateModal from '../../components/FullscreenGateModal';
import ConfirmationModal from '../../components/ConfirmationModal';
import API_URL from '../../apiConfig';

const CandidateAptitudeAssessment = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [questions, setQuestions] = useState([]);
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [answers, setAnswers] = useState({});

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

    // Config Extraction (Fail-safe)
    const getDuration = () => {
        const assessmentData = localStorage.getItem('currentAssessment');
        if (!assessmentData) return 30 * 60;
        const info = JSON.parse(assessmentData);
        return (info.config?.duration || 30) * 60;
    };

    const [timeLeft, setTimeLeft] = useState(getDuration());
    const [submitted, setSubmitted] = useState(false);
    const [scoreResult, setScoreResult] = useState(null);

    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [warningKey, setWarningKey] = useState(0);
    const [violationCount, setViolationCount] = useState(0); // Unified display count
    const [showTerminalOverlay, setShowTerminalOverlay] = useState(false);
    const [terminalMessage, setTerminalMessage] = useState('');
    const [detectionStatus, setDetectionStatus] = useState('idle');
    const [boxes, setBoxes] = useState([]);
    const boxTimerRef = useRef(null);
    const warningTimerRef = useRef(null);
    const totalViolationsRef = useRef(0); // Unified ref — always current (no stale closure)
    const lastViolationTimeRef = useRef(0); // Cooldown to guarantee strikes increment 1-by-1
    const terminalFiredRef = useRef(false); // Prevent double-submit
    const handleSubmitRef = useRef(null);   // Always points to latest handleSubmit
    const MAX_VIOLATIONS = 3;

    // Camera-specific human-friendly messages
    const getCameraViolationMessage = (reason) => {
        if (reason.includes('Face not visible') || reason.includes('no_person')) {
            return '⚠️ Your face is not visible in the camera. Please ensure your face is clearly in frame.';
        }
        if (reason.includes('Multiple persons') || reason.includes('multiple_persons')) {
            return '🚨 Multiple people detected in your camera. Only you should be visible during the assessment.';
        }
        if (reason.includes('Mobile phone') || reason.includes('phone')) {
            return '📵 Mobile phone detected in your camera. Please remove all devices from view.';
        }
        if (reason.includes('Electronic device') || reason.includes('device')) {
            return '💻 Electronic device detected in your camera. Please remove it from view immediately.';
        }
        if (reason.includes('Reference material') || reason.includes('notes')) {
            return '📖 Reference material or notes detected in your camera. Please clear your workspace.';
        }
        if (reason.includes('Tab') || reason.includes('Focus') || reason.includes('Shortcut') || reason.includes('Copy')) {
            return `🖥️ Malpractice detected: ${reason}. Please stay on the assessment screen.`;
        }
        return `⚠️ Violation detected: ${reason}`;
    };


    // ── UNIFIED violation handler ──────────────────────────────────────────────
    // Called by BOTH useProctoring (tab switch) and useFaceProctoring (camera)
    const handleAnyViolation = useCallback((reason) => {
        if (terminalFiredRef.current) return; // Already submitted — ignore

        // Debounce violation strikes: minimum 3000ms cooldown between strikes
        const now = Date.now();
        if (now - lastViolationTimeRef.current < 3000) return;
        lastViolationTimeRef.current = now;

        totalViolationsRef.current += 1;
        const count = totalViolationsRef.current;
        setViolationCount(count);

        const msg = getCameraViolationMessage(reason);

        // Always show the warning banner (even on 3rd = final)
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        setWarningMessage(msg);
        setWarningKey(prev => prev + 1);
        setShowWarning(true);

        if (count < MAX_VIOLATIONS) {
            // Non-terminal: auto-hide banner after 6s
            warningTimerRef.current = setTimeout(() => setShowWarning(false), 6000);
        } else {
            // Terminal (3rd violation): fast auto-submit (500ms brief visual cue)
            terminalFiredRef.current = true;
            warningTimerRef.current = setTimeout(() => {
                setShowWarning(false);
                setTerminalMessage(`3 violations recorded (${reason}). Your assessment has been submitted automatically.`);
                setShowTerminalOverlay(true);
                // Use ref so we always call the LATEST handleSubmit (no stale closure)
                if (handleSubmitRef.current) handleSubmitRef.current(`Malpractice - ${reason}`);
            }, 500);
        }
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

    // Fullscreen enforcement
    const handleFullscreenTimeout = useCallback(() => {
        handleAnyViolation('Fullscreen exit exceeded 10-second recovery limit');
    }, [handleAnyViolation]);

    const {
        isFullscreen,
        isGateOpen,
        isRecoveryOpen,
        recoveryTimeLeft,
        error: fullscreenError,
        enterFullscreen,
        returnToFullscreen
    } = useAssessmentFullscreen({
        enabled: !loading && !submitted && securityConfig.fullscreenProctoring,
        isCompleted: submitted,
        onRecoveryTimeout: handleFullscreenTimeout
    });

    // Tab/keyboard proctoring — pass unified handler, disable internal terminal
    const { violations } = useProctoring({
        enabled: !loading && !submitted,
        maxViolations: 999, // We handle terminal ourselves
        onViolation: handleAnyViolation,
        onTerminalViolation: () => {} // Disabled — handled by handleAnyViolation
    });

    // Silent background face detection — shares unified violation handler
    const cameraVideoRef = useRef(null);
    const { cameraStream, suspectLabel } = useFaceProctoring({
        enabled: !loading && !submitted && securityConfig.faceProctoring,
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
        onViolation: handleAnyViolation  // Same unified handler
    });

    // Bind camera stream to preview video element
    useEffect(() => {
        if (cameraVideoRef.current && cameraStream) {
            cameraVideoRef.current.srcObject = cameraStream;
            cameraVideoRef.current.play().catch(() => {});
        }
    }, [cameraStream]);

    // Load Context + Guard: check backend status first to prevent re-entry after submission
    useEffect(() => {
        const init = async () => {
            const assessmentData = localStorage.getItem('currentAssessment');
            const assessment = assessmentData ? JSON.parse(assessmentData) : null;

            if (!assessment) {
                navigate('/portal/login');
                return;
            }

            // Check backend: is assessment already completed?
            const token = localStorage.getItem('candidateToken');
            if (token) {
                try {
                    const res = await fetch(`${API_URL}/api/assessments/my-status/`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.status === 'completed') {
                            // Assessment already done — clear and redirect
                            localStorage.removeItem('currentAssessment');
                            localStorage.removeItem('candidateToken');
                            navigate('/portal/login');
                            return;
                        }
                    }
                } catch (e) {
                    // Network error on check — proceed to show test (fail-open)
                    console.warn('[Assessment] Status check failed, proceeding:', e);
                }
            }

            const config = assessment.config || {};

            if (config.duration) {
                setTimeLeft(config.duration * 60);
            }

            const qList = (config.generated_questions && config.generated_questions.length > 0)
                ? config.generated_questions
                : (config.questions && config.questions.length > 0)
                    ? config.questions
                    : null;

            if (qList && qList.length > 0) {
                setQuestions(qList);
                setLoading(false);
                return;
            }

            console.warn("No questions found in config.");
            setLoading(false);
        };

        init();
    }, [navigate]);

    // Timer Logic
    useEffect(() => {
        // Only tick down if test is active and not blocked by entry gate or recovery modal
        if (!loading && !submitted && timeLeft > 0 && !isGateOpen && !isRecoveryOpen) {
            const timerId = setInterval(() => {
                setTimeLeft((prev) => prev - 1);
            }, 1000);
            return () => clearInterval(timerId);
        } else if (timeLeft === 0 && !submitted) {
            handleSubmit();
        }
    }, [loading, timeLeft, submitted, isGateOpen, isRecoveryOpen]);

    const handleSubmit = async (forcedStatus = null) => {
        // Prevent double submission
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
            const response = await fetch(`${API_URL}/api/assessments/submit/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ answers, status: forcedStatus })
            });

            if (response.ok) {
                const data = await response.json();
                setSubmitted(true);
                if (data.score !== undefined) {
                    setScoreResult(data.score * 10);
                } else if (data.status && data.status.startsWith('Submitted:')) {
                    const parts = data.status.split(': ')[1].split('/');
                    if (parts.length === 2) {
                        setScoreResult(Math.round((parseInt(parts[0]) / parseInt(parts[1])) * 100));
                    }
                }
            } else if (response.status === 401) {
                if (!forcedStatus) {
                    showAlert('Session Expired', 'Your session has expired. Please log in again to continue.', 'warning', () => navigate('/portal/login'));
                }
            } else if (response.status === 400) {
                // 400 = "Assessment already submitted" — treat as success
                console.warn('[Submit] Assessment was already submitted — ignoring duplicate.');
                setSubmitted(true);
            } else {
                if (forcedStatus) {
                    console.error('[Malpractice Submit] Backend returned:', response.status);
                } else {
                    showAlert('Submission Failed', 'Failed to submit assessment. Please try again.', 'danger');
                }
            }
        } catch (error) {
            console.error("Submission error:", error);
            if (!forcedStatus) {
                showAlert('Network Error', 'Network error. Please check connection.', 'danger');
            }
        }
    };

    // Keep handleSubmitRef always pointing to latest handleSubmit
    handleSubmitRef.current = handleSubmit;
    // ANTI-MALPRACTICE: Prevent Back Button / Refresh (Handled by useProctoring, keeping keepalive sync for hard exits)
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
                    body: JSON.stringify({ answers, status: 'Malpractice - Assessment Abandoned' }),
                    keepalive: true
                });
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, [answers, submitted]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const handleAnswer = (optionIdx) => {
        // CRITICAL FIX: Use question.id instead of array index to match backend answer_key
        const questionId = questions[currentQuestion]?.id;
        if (questionId !== undefined) {
            setAnswers(prev => ({ ...prev, [questionId]: optionIdx }));
        }
    };

    const handleNext = () => {
        if (currentQuestion < questions.length - 1) {
            setCurrentQuestion(prev => prev + 1);
        }
    };

    const handlePrev = () => {
        if (currentQuestion > 0) {
            setCurrentQuestion(prev => prev - 1);
        }
    };

    // ... (Anti-Cheat hooks remain same)

    if (submitted) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white rounded-2xl shadow-xl p-5 sm:p-8 max-w-lg w-full text-center"
                >
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="text-green-600" size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-green-600 mb-2">Assessment Completed</h2>

                    {/* Score Hidden for Candidate - Admin Only */}
                    <div className="p-6 rounded-xl mb-8">
                        <h3 className="text-lg font-semibold text-green-600 mb-2">Thank You!</h3>
                        <p className="text-gray-700">
                            Your assessment has been successfully submitted and recorded.
                        </p>
                    </div>

                    <p className="text-gray-600 mb-6">
                        Thank you for completing the aptitude assessment. Your responses have been recorded.
                    </p>
                    <div className="p-4 rounded-xl mb-6">
                        <h3 className="font-semibold text-green-600 mb-1">What's Next?</h3>
                        <p className="text-sm text-gray-700">
                            Our recruiting team will review your performance. You will be notified via email about the next steps.
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/portal/login')}
                        className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors"
                    >
                        Return to Portal
                    </button>
                </motion.div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <h2 className="mt-4 text-xl font-semibold text-gray-700">Generating AI Assessment...</h2>
                <p className="text-gray-500">Analyzing job context and creating unique questions.</p>
            </div>
        );
    }

    if (!questions || questions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 text-center">
                <AlertCircle className="text-red-500 mb-4" size={48} />
                <h2 className="text-2xl font-bold text-gray-800">No Questions Available</h2>
                <p className="text-gray-600 mt-2 mb-6">
                    We couldn't load the assessment questions. This might be a temporary connection issue.
                </p>
                <button
                    onClick={() => {
                        window.location.reload();
                    }}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
                >
                    Retry Loading
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Fullscreen Gate & Recovery Modal */}
            <FullscreenGateModal
                isOpen={!loading && !submitted && securityConfig.fullscreenProctoring && (isGateOpen || isRecoveryOpen)}
                mode={isRecoveryOpen ? 'recovery' : 'entry'}
                timeLeft={recoveryTimeLeft}
                error={fullscreenError}
                onAction={isRecoveryOpen ? returnToFullscreen : enterFullscreen}
            />

            {/* ── Camera Widget — top-right ── */}
            <div style={{ position: 'fixed', top: '68px', right: '14px', zIndex: 40 }}>

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
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(239,68,68,0.15)', pointerEvents: 'none' }} />
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
            <AnimatePresence mode="wait">
                {showWarning && (
                    <motion.div
                        key={warningKey}
                        initial={{ opacity: 0, y: -60, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -60, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="fixed top-0 left-0 right-0 z-50 shadow-2xl"
                        style={{
                            background: violationCount >= MAX_VIOLATIONS
                                ? 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)'
                                : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                            borderBottom: '3px solid #fca5a5'
                        }}
                    >
                        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-start gap-3 sm:gap-4">
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 animate-pulse mt-0.5">
                                <AlertCircle size={22} className="text-white" />
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-white text-base leading-snug">{warningMessage}</p>
                                <div className="flex items-center gap-3 mt-2">
                                    <span className="text-red-200 text-sm font-semibold">Warning {violationCount}/{MAX_VIOLATIONS}</span>
                                    {violationCount >= MAX_VIOLATIONS ? (
                                        <span className="text-yellow-200 text-xs font-bold animate-pulse">
                                            🚨 Submitting automatically in 4 seconds...
                                        </span>
                                    ) : (
                                        <span className="text-red-300 text-xs">• {MAX_VIOLATIONS - violationCount} more violation(s) will auto-submit your assessment</span>
                                    )}
                                </div>
                            </div>
                            {/* Only allow dismiss on non-terminal warnings */}
                            {violationCount < MAX_VIOLATIONS && (
                                <button
                                    onClick={() => setShowWarning(false)}
                                    className="text-white/60 hover:text-white text-xl ml-2 leading-none flex-shrink-0"
                                    style={{ marginTop: '2px' }}
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
                            className="bg-gray-900 border border-red-500/50 p-5 sm:p-8 rounded-2xl w-full max-w-md shadow-2xl"
                        >
                            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                                <AlertCircle size={40} className="text-red-500 animate-pulse" />
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

            {/* Top Bar */}
            <div className="bg-white shadow-sm border-b border-gray-200 px-4 sm:px-8 py-3 sm:py-4 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto flex justify-between items-center gap-2">
                    <div>
                        <h1 className="text-lg sm:text-xl font-bold text-gray-900">Aptitude Assessment</h1>
                        <p className="text-xs text-gray-500">Question {currentQuestion + 1} of {questions.length}</p>
                    </div>
                    <div className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-mono font-bold text-sm sm:text-base ${timeLeft < 300 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                        <Clock size={18} />
                        {formatTime(timeLeft)}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 max-w-5xl mx-auto w-full p-3 sm:p-6 md:p-8 flex flex-col">
                <motion.div
                    key={currentQuestion}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3 }}
                    className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6 md:p-8 flex-1 flex flex-col"
                >
                    <div className="mb-6 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold px-2 py-0.5 rounded uppercase">
                                {questions[currentQuestion]?.type === 'true_false' ? 'True / False' : questions[currentQuestion]?.type === 'short_answer' ? 'Short Answer' : 'Multiple Choice'}
                            </span>
                            {questions[currentQuestion]?.marks && (
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2 py-0.5 rounded">
                                    {questions[currentQuestion].marks} {questions[currentQuestion].marks === 1 ? 'Mark' : 'Marks'}
                                </span>
                            )}
                            {questions[currentQuestion]?.difficulty && (
                                <span className="bg-purple-50 text-purple-700 border border-purple-200 text-xs font-semibold px-2 py-0.5 rounded">
                                    {questions[currentQuestion].difficulty}
                                </span>
                            )}
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 leading-relaxed">
                            {questions[currentQuestion]?.question || "Question loading error..."}
                        </h3>
                    </div>

                    {/* Options / Input by Type */}
                    {questions[currentQuestion]?.type === 'short_answer' ? (
                        <div className="mb-8 space-y-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-gray-600">
                                Your Answer
                            </label>
                            <input
                                type="text"
                                value={answers[questions[currentQuestion]?.id] !== undefined ? answers[questions[currentQuestion]?.id] : ''}
                                onChange={(e) => handleAnswer(e.target.value)}
                                placeholder="Type your answer here..."
                                className="w-full p-4 border-2 border-gray-300 rounded-xl text-base text-gray-900 focus:border-blue-600 focus:bg-blue-50/20 outline-none transition-all font-mono"
                            />
                            <p className="text-xs text-gray-500">
                                Enter your answer. Evaluation is case-insensitive.
                            </p>
                        </div>
                    ) : questions[currentQuestion]?.type === 'true_false' ? (
                        <div className="space-y-3 mb-8">
                            {[
                                { label: 'True', val: true },
                                { label: 'False', val: false }
                            ].map(({ label, val }) => {
                                const questionId = questions[currentQuestion]?.id;
                                const isSelected = answers[questionId] === val;
                                return (
                                    <label
                                        key={label}
                                        className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${isSelected
                                            ? 'border-blue-600 bg-blue-50'
                                            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div className={`w-5 h-5 rounded-full border-2 mr-4 flex items-center justify-center ${isSelected ? 'border-blue-600' : 'border-gray-300'
                                            }`}>
                                            {isSelected && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                                        </div>
                                        <input
                                            type="radio"
                                            name={`question-${questionId}`}
                                            className="hidden"
                                            checked={isSelected}
                                            onChange={() => handleAnswer(val)}
                                        />
                                        <span className={`text-base font-medium ${isSelected ? 'text-blue-900 font-bold' : 'text-gray-700'}`}>
                                            {label}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-3 mb-8">
                            {(questions[currentQuestion]?.options || []).map((option, idx) => {
                                const questionId = questions[currentQuestion]?.id;
                                const isSelected = answers[questionId] === idx;

                                return (
                                    <label
                                        key={idx}
                                        className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${isSelected
                                            ? 'border-blue-600 bg-blue-50'
                                            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div className={`w-5 h-5 rounded-full border-2 mr-4 flex items-center justify-center ${isSelected ? 'border-blue-600' : 'border-gray-300'
                                            }`}>
                                            {isSelected && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                                        </div>
                                        <input
                                            type="radio"
                                            name={`question-${questionId}`}
                                            className="hidden"
                                            checked={isSelected}
                                            onChange={() => handleAnswer(idx)}
                                        />
                                        <span className={`text-base ${isSelected ? 'text-blue-900 font-medium' : 'text-gray-700'}`}>
                                            {option}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    )}

                    <div className="mt-auto pt-6 border-t border-gray-100 flex justify-between">
                        <button
                            onClick={handlePrev}
                            disabled={currentQuestion === 0}
                            className={`px-4 sm:px-6 py-2.5 rounded-lg font-medium transition-colors ${currentQuestion === 0
                                ? 'text-gray-300 cursor-not-allowed'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            Previous
                        </button>

                        {currentQuestion === questions.length - 1 ? (
                            <button
                                onClick={() => handleSubmit()}
                                className="px-5 sm:px-8 py-2.5 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 shadow-lg shadow-green-200 transition-all"
                            >
                                Submit Assessment
                            </button>
                        ) : (
                            <button
                                onClick={handleNext}
                                className="px-5 sm:px-8 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
                            >
                                Next Question
                            </button>
                        )}
                    </div>
                </motion.div>

                {/* Progress Bar */}
                <div className="mt-6 flex justify-between items-center text-xs text-gray-400">
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mr-4 overflow-hidden">
                        <div
                            className="bg-blue-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}
                        />
                    </div>
                    <span>{Math.round(((currentQuestion + 1) / questions.length) * 100)}%</span>
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

export default CandidateAptitudeAssessment;
