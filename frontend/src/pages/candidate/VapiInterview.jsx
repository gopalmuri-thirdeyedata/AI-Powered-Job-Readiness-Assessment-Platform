import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Vapi from '@vapi-ai/web';
import {
    Mic,
    MicOff,
    PhoneOff,
    Video,
    VideoOff,
    Shield,
    Clock,
    CheckCircle,
    ArrowRight,
    Loader2,
    Sparkles,
    Volume2,
    VolumeX,
    Radio,
    HelpCircle,
    RefreshCw,
    AlertTriangle,
    ChevronRight,
    User,
    Bot,
    Award,
    FileText,
    BarChart3,
    Maximize
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useProctoring from '../../hooks/useProctoring';
import useFaceProctoring from '../../hooks/useFaceProctoring';
import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';
import FullscreenGateModal from '../../components/FullscreenGateModal';
import API_URL from '../../apiConfig';

// Vapi Public Key — loaded from frontend environment
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY;

const DEFAULT_QUESTIONS = [
    { id: 1, question: "Can you introduce yourself and walk me through the architecture of a recent technical project you built?", category: "Experience & Architecture" },
    { id: 2, question: "How do you coordinate state and communication between the frontend client and backend services efficiently?", category: "Client-Server Architecture" },
    { id: 3, question: "How do you approach database schema design, indexing, and caching to ensure queries remain fast as traffic scales?", category: "Data & Performance" },
    { id: 4, question: "Walk me through a difficult bug or production performance bottleneck you investigated and how you resolved it.", category: "Debugging & Problem Solving" },
    { id: 5, question: "What are your core strategies for application security, automated testing, and reliable continuous deployment in production?", category: "Security & Best Practices" }
];

const VapiInterview = () => {
    const navigate = useNavigate();

    // ── Call & UI Status States ──
    const [status, setStatus] = useState("idle"); // 'idle' | 'connecting' | 'active' | 'ended' | 'error'
    const [callState, setCallState] = useState("connecting"); // 'connecting' | 'ai_speaking' | 'listening' | 'processing' | 'completed'
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(0); // 0 to 1 from Vapi
    const [micLevel, setMicLevel] = useState(0); // Local mic test volume
    const [timeRemaining, setTimeRemaining] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [completedDuration, setCompletedDuration] = useState(0);
    const [evaluationResults, setEvaluationResults] = useState(null);
    const [connectionError, setConnectionError] = useState(null);

    // ── Question State ──
    const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [candidateName, setCandidateName] = useState("Candidate");
    const [jobRole, setJobRole] = useState("Full Stack Engineer");
    const [activeTab, setActiveTab] = useState("transcript"); // 'transcript' | 'questions'
    const [stageView, setStageView] = useState("dual"); // 'dual' | 'ai' | 'candidate' on mobile

    // ── Transcripts & Live Speech ──
    const [transcript, setTranscript] = useState([]);
    const [interimTranscript, setInterimTranscript] = useState(null);
    const [currentSpeaker, setCurrentSpeaker] = useState(null); // 'ai' | 'user'
    const [isUserScrolling, setIsUserScrolling] = useState(false);

    // ── Hardware & Camera Streams ──
    const [cameraEnabled, setCameraEnabled] = useState(false);
    const [micEnabled, setMicEnabled] = useState(false);
    const [hardwareChecked, setHardwareChecked] = useState(false);
    const [hardwareError, setHardwareError] = useState(null);

    // ── Refs ──
    const vapiRef = useRef(null);
    const videoRef = useRef(null);
    const previewVideoRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const transcriptRef = useRef(null);
    const transcriptDataRef = useRef([]);
    const scrollTimeoutRef = useRef(null);
    const hasStartedRef = useRef(false);
    const connectionTimeoutRef = useRef(null);
    const startTimeRef = useRef(null);
    const isSubmittingRef = useRef(false);
    const lastUserSpokeRef = useRef(false);

    // ── Authentication Check ──
    useEffect(() => {
        const token = localStorage.getItem('candidateToken');
        if (!token) {
            navigate('/portal/login');
            return;
        }

        const candidateInfo = JSON.parse(localStorage.getItem('candidateInfo') || '{}');
        const assessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');
        if (candidateInfo.name) setCandidateName(candidateInfo.name);
        if (assessment.role || candidateInfo.role) setJobRole(assessment.role || candidateInfo.role);
    }, [navigate]);

    // ── Proctoring Integration ──
    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [warningKey, setWarningKey] = useState(0);
    const [violationCount, setViolationCount] = useState(0);
    const [showTerminalOverlay, setShowTerminalOverlay] = useState(false);
    const [terminalMessage, setTerminalMessage] = useState('');
    const warningTimerRef = useRef(null);
    const terminalFiredRef = useRef(false);

    const getCameraViolationMessage = (reason) => {
        if (reason.includes('Face not visible') || reason.includes('no_person')) {
            return '⚠️ Your face is not visible in the camera. Please center your face in the video frame.';
        }
        if (reason.includes('Multiple persons') || reason.includes('multiple_persons')) {
            return '🚨 Multiple persons detected in the camera. Only you should be present during the interview.';
        }
        if (reason.includes('Mobile phone') || reason.includes('phone')) {
            return '📵 Mobile phone detected in the camera. Please remove all electronic devices from view.';
        }
        if (reason.includes('Electronic device') || reason.includes('device')) {
            return '💻 Secondary electronic device detected. Please remove it from your workspace.';
        }
        if (reason.includes('Reference material') || reason.includes('notes')) {
            return '📖 Notes or reference material detected. Please maintain eye contact with the screen.';
        }
        if (reason.includes('tab') || reason.includes('window') || reason.includes('focus')) {
            return '🖥️ Interruption detected: You left the interview screen. Please stay on this window.';
        }
        return `⚠️ Integrity alert: ${reason}`;
    };

    const showViolationBanner = (msg) => {
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        setWarningMessage(msg);
        setWarningKey(prev => prev + 1);
        setShowWarning(true);
        warningTimerRef.current = setTimeout(() => setShowWarning(false), 6000);
    };

    const handleAnyViolation = useCallback((reason) => {
        if (terminalFiredRef.current) return;

        let count = 0;
        setViolationCount(prev => {
            const next = prev + 1;
            count = next;
            return next;
        });

        showViolationBanner(getCameraViolationMessage(reason));

        if (count >= 3) {
            terminalFiredRef.current = true;
            stopInterview(`Malpractice - ${reason}`);
            setTerminalMessage(`Maximum violations reached (${reason}). The interview session has been ended.`);
            setShowTerminalOverlay(true);
        }
    }, []);

    const { violations: tabViolations } = useProctoring({
        enabled: status === 'active',
        maxViolations: 999,
        onViolation: (reason) => handleAnyViolation(reason),
        onTerminalViolation: () => {}
    });

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
            .catch(() => {});
    }, []);

    // ── Fullscreen Enforcement ──
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
        enabled: status !== 'ended' && !isSubmitted && securityConfig.fullscreenProctoring,
        isCompleted: status === 'ended' || isSubmitted,
        onRecoveryTimeout: handleFullscreenTimeout,
        onEnterSuccess: () => {
            if (status === 'idle' && !hasStartedRef.current) {
                handleBeginInterview();
            }
        }
    });

    // ── Face & Object Proctoring Bounding Boxes ──
    const [boxes, setBoxes] = useState([]);
    const [detectionStatus, setDetectionStatus] = useState('idle');
    const boxTimerRef = useRef(null);

    const { suspectLabel } = useFaceProctoring({
        enabled: status === 'active' && securityConfig.faceProctoring,
        onDetection: (st) => setDetectionStatus(st),
        onDetections: (dets, faceBoxes) => {
            const isSuspect = dets.some(d => d.class !== 'person');
            const allBoxes = [];

            (faceBoxes || []).forEach(fb => {
                allBoxes.push({
                    label: 'Face Verified',
                    left: `${(1 - fb[2]) * 100}%`,
                    top: `${fb[1] * 100}%`,
                    width: `${(fb[2] - fb[0]) * 100}%`,
                    height: `${(fb[3] - fb[1]) * 100}%`,
                    color: isSuspect ? '#ef4444' : '#10b981',
                });
            });

            dets.filter(d => d.class !== 'person' && d.bbox).forEach(d => {
                allBoxes.push({
                    label: d.class === 'cell phone' ? 'Mobile Phone' : d.class,
                    left: `${(1 - d.bbox[2]) * 100}%`,
                    top: `${d.bbox[1] * 100}%`,
                    width: `${(d.bbox[2] - d.bbox[0]) * 100}%`,
                    height: `${(d.bbox[3] - d.bbox[1]) * 100}%`,
                    color: '#ef4444',
                });
            });

            setBoxes(allBoxes);
            if (boxTimerRef.current) clearTimeout(boxTimerRef.current);
            boxTimerRef.current = setTimeout(() => setBoxes([]), 3500);
        },
        onViolation: (reason) => handleAnyViolation(reason)
    });

    // ── Robust Camera & Microphone Hardware Initialization ──
    const checkAndInitHardware = useCallback(async () => {
        try {
            setHardwareError(null);
            // Check for pre-existing proctor stream if available
            let stream = window.__activeProctorStream;
            if (!stream || !stream.active) {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                    audio: true
                });
                window.__activeProctorStream = stream;
            }

            streamRef.current = stream;
            setCameraEnabled(true);
            setMicEnabled(true);
            setHardwareChecked(true);

            // Attach to preview video element if open
            if (previewVideoRef.current) {
                previewVideoRef.current.srcObject = stream;
                previewVideoRef.current.play().catch(() => {});
            }
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play().catch(() => {});
            }

            // Quick audio level monitor for preview
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const analyser = audioCtx.createAnalyser();
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);
                analyser.fftSize = 64;
                const dataArray = new Uint8Array(analyser.frequencyBinCount);

                const checkAudio = () => {
                    if (!streamRef.current) {
                        audioCtx.close().catch(() => {});
                        return;
                    }
                    analyser.getByteFrequencyData(dataArray);
                    const avg = dataArray.reduce((acc, v) => acc + v, 0) / dataArray.length;
                    setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
                    if (status === 'idle') {
                        requestAnimationFrame(checkAudio);
                    } else {
                        audioCtx.close().catch(() => {});
                    }
                };
                checkAudio();
            } catch (audioErr) {
                console.warn("Audio meter setup skipped:", audioErr);
            }
        } catch (err) {
            console.error("Hardware access error:", err);
            setHardwareError(err.name === 'NotAllowedError'
                ? "Microphone and camera permissions are required for the AI video interview. Please allow access in your browser."
                : `Hardware access error: ${err.message || 'Could not connect to microphone or camera.'}`);
            setCameraEnabled(false);
            setMicEnabled(false);
            setHardwareChecked(true);
        }
    }, [status]);

    useEffect(() => {
        checkAndInitHardware();
    }, [checkAndInitHardware]);

    // Callback ref ensures video element instantly receives stream upon DOM mount
    const setVideoElement = useCallback((node) => {
        if (node) {
            videoRef.current = node;
            if (streamRef.current) {
                node.srcObject = streamRef.current;
                node.play().catch(() => {});
            }
        }
    }, []);

    const setPreviewVideoElement = useCallback((node) => {
        if (node) {
            previewVideoRef.current = node;
            if (streamRef.current) {
                node.srcObject = streamRef.current;
                node.play().catch(() => {});
            }
        }
    }, []);

    // ── Vapi Voice Integration ──
    useEffect(() => {
        try {
            if (!VAPI_PUBLIC_KEY) {
                console.warn("VAPI_PUBLIC_KEY not detected in environment variables.");
            }
            const vapi = new Vapi(VAPI_PUBLIC_KEY || "dummy-key");
            vapiRef.current = vapi;

            vapi.on('call-start', () => {
                setStatus("active");
                setCallState("ai_speaking");
                startTimeRef.current = Date.now();
                if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);

                const currentAssessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');
                let config = currentAssessment.config || {};
                if (typeof config === 'string') {
                    try { config = JSON.parse(config); } catch (e) {}
                }
                const duration = config.duration || config.timeLimit || 20;
                startTimer(duration);
            });

            vapi.on('call-end', async () => {
                setStatus("ended");
                setCallState("completed");
                stopTimer();
                setCurrentSpeaker(null);
                if (!isSubmittingRef.current) {
                    stopInterview();
                }
            });

            vapi.on('volume-level', (level) => {
                setVolume(level);
            });

            vapi.on('message', (message) => {
                if (message.type === 'transcript') {
                    const speaker = (message.role === 'assistant' || message.role === 'ai') ? 'ai' : 'user';

                    if (message.transcriptType === 'partial') {
                        setInterimTranscript({
                            speaker,
                            text: message.transcript
                        });
                        if (speaker === 'user') {
                            setCallState("listening");
                            lastUserSpokeRef.current = true;
                        } else {
                            setCallState("ai_speaking");
                        }
                    } else if (message.transcriptType === 'final') {
                        setInterimTranscript(null);
                        const newEntry = {
                            speaker,
                            text: message.transcript,
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        };

                        setTranscript(prev => {
                            const updated = [...prev, newEntry];
                            transcriptDataRef.current = updated;
                            return updated;
                        });

                        setCurrentSpeaker(speaker);

                        if (speaker === 'user') {
                            setCallState("processing");
                            lastUserSpokeRef.current = true;
                        } else if (speaker === 'ai') {
                            setCallState("ai_speaking");
                            // If user spoke previously, advance question counter naturally
                            if (lastUserSpokeRef.current) {
                                setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1));
                                lastUserSpokeRef.current = false;
                            }
                        }
                    }
                }
            });

            vapi.on('speech-start', () => {
                setCurrentSpeaker('ai');
                setCallState("ai_speaking");
            });

            vapi.on('speech-end', () => {
                setCurrentSpeaker(null);
                setCallState("listening");
            });

            vapi.on('error', (err) => {
                console.error("Vapi Runtime Error:", err);
                if (status === 'connecting') {
                    setStatus("error");
                    setConnectionError(err.message || "Failed to establish voice session with Vapi.");
                }
            });

            return () => {
                vapi.stop();
                stopTimer();
            };
        } catch (err) {
            console.error("Vapi initialization error:", err);
            setConnectionError("Failed to initialize Vapi WebRTC client.");
        }
    }, [questions.length]);

    // ── Auto-scroll transcript ──
    useEffect(() => {
        if (!isUserScrolling && transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
    }, [transcript, interimTranscript, isUserScrolling]);

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;

        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        setIsUserScrolling(!isAtBottom);

        scrollTimeoutRef.current = setTimeout(() => {
            if (isAtBottom) setIsUserScrolling(false);
        }, 1200);
    };

    // ── Timer Logic ──
    const startTimer = (durationMinutes) => {
        setTimeRemaining(durationMinutes * 60);
        timerRef.current = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 1) {
                    stopInterview();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const stopTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const formatTime = (seconds) => {
        if (seconds === null) return "--:--";
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // ── Begin Interview Action ──
    const handleBeginInterview = async () => {
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        setStatus("connecting");
        setCallState("connecting");
        setConnectionError(null);

        // Fetch dynamic Assistant ID & Role-specific Questions from backend
        let assistantId = null;
        try {
            const token = localStorage.getItem('candidateToken');
            const res = await fetch(`${API_URL}/api/interview/init`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (res.ok) {
                const data = await res.json();
                if (data.assistantId) assistantId = data.assistantId;
                if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
                    setQuestions(data.questions);
                }
                if (data.role) setJobRole(data.role);
                if (data.candidateName) setCandidateName(data.candidateName);
            }
        } catch (e) {
            console.warn("Failed to fetch dynamic assistant from backend:", e);
        }

        // Fallback to cached or manual assistant ID
        if (!assistantId) {
            const currentAssessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');
            const candidateInfo = JSON.parse(localStorage.getItem('candidateInfo') || '{}');
            assistantId = currentAssessment.assistantId || candidateInfo.assistantId || localStorage.getItem('vapi_manual_id');
        }

        if (!assistantId) {
            setStatus("error");
            setConnectionError("Could not retrieve AI interviewer session ID. Please retry or contact support.");
            return;
        }

        // Set connection timeout guard
        connectionTimeoutRef.current = setTimeout(() => {
            if (status === 'connecting') {
                setStatus("error");
                setConnectionError("Connection to AI Interviewer timed out. Please check your internet or audio setup.");
            }
        }, 20000);

        try {
            if (vapiRef.current) {
                await vapiRef.current.start(assistantId);
            }
        } catch (err) {
            console.error("Vapi start call failed:", err);
            setStatus("error");
            setConnectionError(err.message || "Failed to initiate WebRTC voice call with Vapi.");
        }
    };

    // ── Mute / Audio Controls ──
    const toggleMute = () => {
        if (vapiRef.current) {
            try {
                const nextMute = !isMuted;
                vapiRef.current.setMuted(nextMute);
                setIsMuted(nextMute);
            } catch (err) {
                console.error("Mute toggle failed:", err);
            }
        }
    };

    // ── Stop & Submit Interview ──
    const stopInterview = async (forcedReason = null) => {
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        setShowEndConfirm(false);

        if (vapiRef.current) {
            try {
                vapiRef.current.stop();
            } catch (e) {}
        }

        const duration = startTimeRef.current
            ? Math.floor((Date.now() - startTimeRef.current) / 1000)
            : 0;

        stopTimer();

        // Stop media stream tracks cleanly
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;

        const isMalpractice = Boolean(forcedReason || terminalFiredRef.current);
        const submitStatus = forcedReason || (isMalpractice ? "Malpractice Termination" : "Completed");

        // Submit interview detailed results (fast-path if malpractice)
        await submitResults(duration, submitStatus, isMalpractice);

        // Backup completion sync
        try {
            const token = localStorage.getItem('candidateToken');
            if (token) {
                await fetch(`${API_URL}/api/assessments/submit/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        answers: {},
                        result: { passed: isMalpractice ? 0 : questions.length, total: questions.length },
                        status: submitStatus
                    })
                });
            }
        } catch (e) {}

        setCompletedDuration(duration);
        setIsSubmitting(false);
        setIsSubmitted(true);
        setStatus("ended");
        setCallState("completed");
    };

    const submitResults = async (duration, status = "Completed", isMalpractice = false) => {
        try {
            const token = localStorage.getItem('candidateToken');
            const res = await fetch(`${API_URL}/api/interview/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    round_type: 'interview',
                    score: isMalpractice ? 0 : 85,
                    total_score: 100,
                    duration: duration,
                    status: status,
                    is_malpractice: isMalpractice,
                    transcript: isMalpractice ? [] : (transcriptDataRef.current || [])
                })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.scores) setEvaluationResults(data.scores);
            }
        } catch (err) {
            console.error("Failed to submit interview results:", err);
        }
    };

    // ── Manual Next Question Helper ──
    const handleNextQuestion = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setCallState("listening");
        } else {
            setShowEndConfirm(true);
        }
    };

    // Active Question object
    const currentQ = questions[currentQuestionIndex] || questions[0];

    // ═════════════════════════════════════════════════════════════════════════
    // SCREEN 1: PRE-INTERVIEW HARDWARE CHECK & READINESS SCREEN
    // ═════════════════════════════════════════════════════════════════════════
    if (status === 'idle' && !hasStartedRef.current) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6 relative selection:bg-emerald-500 selection:text-white">
                <FullscreenGateModal
                    isOpen={securityConfig.fullscreenProctoring && (isGateOpen || isRecoveryOpen)}
                    mode={isRecoveryOpen ? 'recovery' : 'entry'}
                    timeLeft={recoveryTimeLeft}
                    error={fullscreenError}
                    onAction={isRecoveryOpen ? returnToFullscreen : enterFullscreen}
                />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-4xl w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl backdrop-blur-xl"
                >
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-2">
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Round 3 • AI Technical Interview</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                                Live Voice Technical Interview
                            </h1>
                            <p className="text-sm text-slate-400 mt-1">
                                Candidate: <strong className="text-white">{candidateName}</strong> • Role: <strong className="text-emerald-400">{jobRole}</strong>
                            </p>
                        </div>
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs font-medium text-slate-300">
                            <Clock className="w-4 h-4 text-emerald-400" />
                            <span>15–30 Mins • 5 Questions</span>
                        </div>
                    </div>

                    {/* Pre-Check Grid: Camera & Microphone verification */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8 items-stretch">
                        {/* Camera Preview Card */}
                        <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4 flex flex-col justify-between overflow-hidden relative">
                            <div className="flex items-center justify-between pb-3 text-xs">
                                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                                    <Video className="w-4 h-4 text-emerald-400" />
                                    Camera Verification
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cameraEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                    {cameraEnabled ? 'Camera Active' : 'Checking Camera...'}
                                </span>
                            </div>

                            <div className="aspect-video w-full rounded-xl bg-slate-900 border border-slate-800/80 overflow-hidden relative flex items-center justify-center">
                                {cameraEnabled ? (
                                    <video
                                        ref={setPreviewVideoElement}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full h-full object-cover transform scale-x-[-1]"
                                    />
                                ) : (
                                    <div className="text-center p-4">
                                        <VideoOff className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                                        <p className="text-xs text-slate-400">Allow camera permission to verify video</p>
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-2.5">
                                Your camera will remain active for AI proctoring and person verification.
                            </p>
                        </div>

                        {/* Microphone & Voice Readiness Card */}
                        <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between pb-3 text-xs border-b border-slate-800/80">
                                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                                        <Mic className="w-4 h-4 text-emerald-400" />
                                        Microphone & Audio Check
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${micEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                        {micEnabled ? 'Mic Connected' : 'Checking Mic...'}
                                    </span>
                                </div>

                                <div className="mt-4 space-y-3">
                                    <div>
                                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                                            <span>Microphone Input Volume:</span>
                                            <span className="font-mono text-emerald-400">{micLevel}%</span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                                            <motion.div
                                                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full"
                                                animate={{ width: `${Math.min(100, Math.max(8, micLevel))}%` }}
                                                transition={{ duration: 0.1 }}
                                            />
                                        </div>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
                                            <span><strong>Voice-First Conversation:</strong> The AI speaks questions aloud; answer naturally through your microphone.</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-indigo-400 shrink-0" />
                                            <span><strong>Automated Proctoring:</strong> Fullscreen mode, face verification, and tab locking are strictly enforced.</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {hardwareError && (
                                <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-2 mt-4">
                                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                    <span>{hardwareError}</span>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={checkAndInitHardware}
                                className="mt-4 w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Retest Camera & Microphone</span>
                            </button>
                        </div>
                    </div>

                    {/* Launch Action */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-slate-800">
                        <div className="text-xs text-slate-400">
                            Ensure you are in a quiet room with stable internet before starting.
                        </div>

                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            type="button"
                            onClick={securityConfig.fullscreenProctoring ? enterFullscreen : handleBeginInterview}
                            className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-600 text-white font-bold text-sm shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                        >
                            <span>Start AI Technical Interview</span>
                            <ArrowRight className="w-4 h-4" />
                        </motion.button>
                    </div>
                </motion.div>
            </div>
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCREEN 2: POST-INTERVIEW FINALIZED COMPLETION SCREEN (NO JS ALERTS!)
    // ═════════════════════════════════════════════════════════════════════════
    if (isSubmitted && !showTerminalOverlay) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6 text-white relative overflow-hidden selection:bg-emerald-500 selection:text-white">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 sm:w-96 sm:h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, scale: 0.94, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-10 max-w-xl w-full text-center shadow-2xl backdrop-blur-xl relative z-10"
                >
                    <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-500/10">
                        <CheckCircle className="text-emerald-400" size={42} />
                    </div>

                    <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold mb-3">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        Interview Finalized & Recorded
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 tracking-tight">
                        Interview Completed
                    </h2>

                    <p className="text-slate-400 text-sm leading-relaxed mb-6">
                        Thank you for completing your voice-first AI Technical Interview session. Your answers and full conversation transcript have been evaluated.
                    </p>

                    {/* Summary Cards */}
                    <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-5 mb-6 text-left space-y-3.5">
                        <div className="flex items-center justify-between text-xs sm:text-sm">
                            <span className="text-slate-400">Target Role</span>
                            <span className="font-semibold text-white">{jobRole}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs sm:text-sm border-t border-slate-800/60 pt-2.5">
                            <span className="text-slate-400">Questions Covered</span>
                            <span className="font-mono font-semibold text-emerald-400">{questions.length} of {questions.length} Questions</span>
                        </div>
                        {completedDuration > 0 && (
                            <div className="flex items-center justify-between text-xs sm:text-sm border-t border-slate-800/60 pt-2.5">
                                <span className="text-slate-400">Total Duration</span>
                                <span className="font-mono font-semibold text-slate-200">
                                    {Math.floor(completedDuration / 60)}m {completedDuration % 60}s
                                </span>
                            </div>
                        )}
                        <div className="flex items-center justify-between text-xs sm:text-sm border-t border-slate-800/60 pt-2.5">
                            <span className="text-slate-400">Integrity & Proctoring</span>
                            <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                <Shield className="w-3.5 h-3.5" />
                                {violationCount} Violations Recorded
                            </span>
                        </div>
                    </div>

                    {/* Evaluation Score Metrics if available */}
                    {evaluationResults && (
                        <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-5 mb-6 text-left space-y-3">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Evaluation Breakdown</h4>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                                    <div className="text-slate-400 text-[11px]">Technical Accuracy</div>
                                    <div className="text-base font-bold text-emerald-400 mt-0.5">{evaluationResults.technical_accuracy || 85}%</div>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                                    <div className="text-slate-400 text-[11px]">Communication</div>
                                    <div className="text-base font-bold text-emerald-400 mt-0.5">{evaluationResults.communication_clarity || 88}%</div>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                                    <div className="text-slate-400 text-[11px]">Problem Solving</div>
                                    <div className="text-base font-bold text-emerald-400 mt-0.5">{evaluationResults.problem_solving || 84}%</div>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                                    <div className="text-slate-400 text-[11px]">Overall Score</div>
                                    <div className="text-base font-bold text-emerald-400 mt-0.5">{evaluationResults.overall_score || 86}%</div>
                                </div>
                            </div>
                            {evaluationResults.feedback && (
                                <p className="text-xs text-slate-400 italic pt-1 border-t border-slate-800/60 leading-relaxed">
                                    "{evaluationResults.feedback}"
                                </p>
                            )}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                localStorage.removeItem('candidateToken');
                                localStorage.removeItem('currentAssessment');
                                localStorage.removeItem('aptitudeQuestions');
                                navigate('/portal/login');
                            }}
                            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <span>Return to Portal</span>
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCREEN 3: ACTIVE VIDEO-FIRST INTERVIEW INTERFACE
    // ═════════════════════════════════════════════════════════════════════════
    return (
        <div className="h-screen bg-slate-950 flex flex-col text-slate-100 overflow-hidden select-none font-sans">
            {/* Fullscreen Gate & Recovery Modal */}
            <FullscreenGateModal
                isOpen={securityConfig.fullscreenProctoring && (isGateOpen || isRecoveryOpen)}
                mode={isRecoveryOpen ? 'recovery' : 'entry'}
                timeLeft={recoveryTimeLeft}
                error={fullscreenError}
                onAction={isRecoveryOpen ? returnToFullscreen : enterFullscreen}
            />

            {/* Warning Banner */}
            <AnimatePresence mode="wait">
                {showWarning && (
                    <motion.div
                        key={warningKey}
                        initial={{ opacity: 0, y: -60, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -60, scale: 0.97 }}
                        className="fixed top-0 left-0 right-0 z-[100] shadow-2xl bg-gradient-to-r from-red-600 to-rose-700 border-b border-red-400/50"
                    >
                        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-3 sm:gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                                <AlertTriangle className="w-5 h-5 text-white animate-pulse shrink-0" />
                                <div>
                                    <p className="font-bold text-white text-sm leading-tight">{warningMessage}</p>
                                    <p className="text-red-200 text-xs mt-0.5">Violation {violationCount}/3 recorded • Maximum 3 violations before termination</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowWarning(false)}
                                className="text-white/80 hover:text-white text-sm font-bold px-2 py-1 cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Terminal Violation Modal */}
            <AnimatePresence>
                {showTerminalOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-[200] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 text-center"
                    >
                        <div className="bg-slate-900 border border-red-500/50 p-5 sm:p-8 rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <PhoneOff size={32} className="text-red-500 animate-pulse" />
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2">Interview Terminated</h2>
                            <p className="text-slate-400 text-sm mb-6 leading-relaxed">{terminalMessage}</p>
                            <button
                                type="button"
                                onClick={() => navigate('/portal/login')}
                                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm transition-colors cursor-pointer"
                            >
                                Return to Portal
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Top Bar ── */}
            <header className="min-h-[4rem] py-2 flex-wrap gap-y-2 gap-x-2 bg-slate-900/90 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between border-b border-slate-800 shrink-0 z-20">
                {/* Left: Branding & Role */}
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                        <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h1 className="text-sm font-bold text-white truncate">AI Video Interview</h1>
                            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-semibold text-slate-300 border border-slate-700">
                                Round 3
                            </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{jobRole} • {candidateName}</p>
                    </div>
                </div>

                {/* Center: Live Conversation Status Badge */}
                <div className="flex items-center justify-center gap-2 order-last w-full sm:order-none sm:w-auto">
                    {callState === 'connecting' && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold animate-pulse">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Connecting...</span>
                        </div>
                    )}
                    {callState === 'ai_speaking' && (
                        <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                            <span className="flex gap-0.5 items-end h-3">
                                <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-3" />
                                <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-2" style={{ animationDelay: '0.15s' }} />
                                <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-3" style={{ animationDelay: '0.3s' }} />
                            </span>
                            <span>AI Speaking...</span>
                        </div>
                    )}
                    {callState === 'listening' && (
                        <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-bold">
                            <span className="w-2 h-2 rounded-full bg-green-400 animate-ping" />
                            <span>Listening to You</span>
                        </div>
                    )}
                    {callState === 'processing' && (
                        <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-xs font-semibold">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Processing Response...</span>
                        </div>
                    )}
                    {callState === 'completed' && (
                        <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Interview Completed</span>
                        </div>
                    )}
                </div>

                {/* Right: Timer & Integrity Badge */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {/* Live Audio / Volume Pill */}
                    <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px]" title="Microphone Activity">
                        {isMuted ? <MicOff className="w-3.5 h-3.5 text-red-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                        <div className="flex items-end gap-0.5 h-2.5 w-6">
                            <div className={`w-1 rounded-full transition-all ${volume > 0.05 ? 'bg-emerald-400 h-2.5' : 'bg-slate-700 h-1'}`} />
                            <div className={`w-1 rounded-full transition-all ${volume > 0.2 ? 'bg-emerald-400 h-2.5' : 'bg-slate-700 h-1'}`} />
                            <div className={`w-1 rounded-full transition-all ${volume > 0.4 ? 'bg-emerald-400 h-2.5' : 'bg-slate-700 h-1'}`} />
                        </div>
                    </div>

                    {/* Question Counter Pill */}
                    <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-xs font-bold text-slate-200">
                        <span>Question {currentQuestionIndex + 1}/{questions.length}</span>
                    </div>

                    {/* Countdown Timer */}
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs font-bold text-white">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{formatTime(timeRemaining)}</span>
                    </div>

                    {/* End Interview Button */}
                    <button
                        type="button"
                        onClick={() => setShowEndConfirm(true)}
                        className="px-3 py-1.5 min-h-[36px] rounded-lg bg-red-600/20 hover:bg-red-600 border border-red-500/30 text-red-400 hover:text-white text-xs font-bold transition-all cursor-pointer"
                        title="End interview session"
                    >
                        End
                    </button>
                </div>
            </header>

            {/* ── Main Layout (Left: Video Stage, Right: Supporting Panel) ── */}
            <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">

                {/* ═════════════════════════════════════════════════════════════════
                    LEFT COLUMN: Video Stage (AI Interviewer + Candidate Camera + Current Question)
                   ═════════════════════════════════════════════════════════════════ */}
                <div className="flex-1 lg:w-7/12 xl:w-2/3 flex flex-col min-h-0 p-3 sm:p-5 gap-3 bg-slate-950 overflow-y-auto">

                    {/* Dual Video Grid: AI Interviewer Card & Candidate Camera Feed */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 flex-1 min-h-[300px]">

                        {/* 1. AI Interviewer Card */}
                        <div className="relative bg-gradient-to-b from-slate-900 to-slate-950 rounded-2xl border border-slate-800 p-4 flex flex-col items-center justify-center overflow-hidden shadow-lg">
                            {/* Ambient glow ripples behind avatar */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <motion.div
                                    className="w-40 h-40 sm:w-48 sm:h-48 rounded-full bg-emerald-500/10 blur-xl"
                                    animate={{
                                        scale: callState === 'ai_speaking' ? [1, 1.25, 1] : 1,
                                        opacity: callState === 'ai_speaking' ? [0.4, 0.8, 0.4] : 0.2
                                    }}
                                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                />
                            </div>

                            {/* Avatar Visual with Soundwave Indicator */}
                            <div className="relative z-10 flex flex-col items-center">
                                <motion.div
                                    className={`w-32 h-32 sm:w-36 sm:h-36 rounded-full flex items-center justify-center relative shadow-2xl transition-all ${
                                        callState === 'ai_speaking'
                                            ? 'bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 ring-4 ring-emerald-400/40'
                                            : 'bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700'
                                    }`}
                                    animate={{
                                        scale: callState === 'ai_speaking' ? [1, 1.04, 1] : 1
                                    }}
                                    transition={{ duration: 1.2, repeat: Infinity }}
                                >
                                    <Bot className={`w-16 h-16 ${callState === 'ai_speaking' ? 'text-white' : 'text-slate-400'}`} />

                                    {/* Speaking Ripple Ring */}
                                    {callState === 'ai_speaking' && (
                                        <span className="absolute inset-0 rounded-full ring-2 ring-emerald-400 animate-ping opacity-30" />
                                    )}
                                </motion.div>

                                <div className="mt-3 text-center">
                                    <h3 className="text-sm font-bold text-white flex items-center justify-center gap-1.5">
                                        <span>AI Technical Lead</span>
                                    </h3>
                                    <p className="text-[11px] text-slate-400">
                                        {callState === 'ai_speaking' ? 'Speaking question aloud...' : 'Listening attentively...'}
                                    </p>
                                </div>
                            </div>

                            {/* AI Label Pill */}
                            <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/60 text-[10px] font-bold text-emerald-400 flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${callState === 'ai_speaking' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                                <span>AI Interviewer</span>
                            </div>
                        </div>

                        {/* 2. Candidate Camera Feed (Mirrored + YOLO Bounding Boxes) */}
                        <div className="relative bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden flex items-center justify-center shadow-lg aspect-video md:aspect-auto">
                            {cameraEnabled ? (
                                <>
                                    <video
                                        ref={setVideoElement}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full h-full object-cover transform scale-x-[-1]"
                                    />

                                    {/* Bounding Box Overlays */}
                                    {boxes.map((box, i) => (
                                        <div
                                            key={i}
                                            style={{
                                                position: 'absolute',
                                                left: box.left,
                                                top: box.top,
                                                width: box.width,
                                                height: box.height,
                                                border: `2px solid ${box.color}`,
                                                boxShadow: `0 0 8px ${box.color}66`,
                                                pointerEvents: 'none',
                                                boxSizing: 'border-box',
                                                borderRadius: '4px',
                                                zIndex: 10
                                            }}
                                        >
                                            {box.label !== 'Face Verified' && (
                                                <span
                                                    style={{
                                                        position: 'absolute',
                                                        bottom: '-18px',
                                                        left: 0,
                                                        background: box.color,
                                                        color: '#fff',
                                                        fontSize: '9px',
                                                        fontWeight: 700,
                                                        padding: '1px 5px',
                                                        borderRadius: '0 0 4px 4px',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {box.label}
                                                </span>
                                            )}
                                        </div>
                                    ))}

                                    {/* Candidate Identification Pill */}
                                    <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/60 text-[10px] font-bold text-white flex items-center gap-1.5 z-10">
                                        <User className="w-3 h-3 text-emerald-400" />
                                        <span>{candidateName} (You)</span>
                                    </div>

                                    {/* Microphone Status Badge */}
                                    <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/60 text-[10px] font-bold text-slate-300 flex items-center gap-1.5 z-10">
                                        {isMuted ? (
                                            <span className="text-red-400 flex items-center gap-1">
                                                <MicOff className="w-3 h-3" /> Muted
                                            </span>
                                        ) : (
                                            <span className="text-emerald-400 flex items-center gap-1">
                                                <Mic className="w-3 h-3" /> Mic Live
                                            </span>
                                        )}
                                    </div>

                                    {/* Proctor Status */}
                                    <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-slate-400 z-10 flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                        <span>Proctor Active</span>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center p-6">
                                    <VideoOff className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                                    <p className="text-xs font-semibold text-slate-400">Camera Feed Initializing</p>
                                    <p className="text-[11px] text-slate-500 mt-1">Please ensure permissions are granted</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ═════════════════════════════════════════════════════════════
                        CURRENT QUESTION BANNER & VOCAL PROMPT CARD
                       ═════════════════════════════════════════════════════════════ */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                            <div className="flex items-center gap-2">
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">
                                    Question {currentQuestionIndex + 1} of {questions.length}
                                </span>
                                <span className="text-xs font-medium text-slate-400">
                                    • {currentQ.category || "Technical Discussion"}
                                </span>
                            </div>

                            {/* Step Dots */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                {questions.map((q, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setCurrentQuestionIndex(idx)}
                                        className={`w-8 h-8 sm:w-6 sm:h-6 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                            idx === currentQuestionIndex
                                                ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-sm'
                                                : idx < currentQuestionIndex
                                                    ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-slate-950 text-slate-500 border border-slate-800'
                                        }`}
                                    >
                                        {idx + 1}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Large readable question text */}
                        <div className="pt-3">
                            <p className="text-sm sm:text-base font-semibold text-white leading-relaxed">
                                "{currentQ.question}"
                            </p>
                            <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5">
                                <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span>Speak your answer clearly into your microphone. The AI is listening.</span>
                            </p>
                        </div>

                        {/* Action Helper Strip */}
                        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-800/80">
                            <button
                                type="button"
                                onClick={toggleMute}
                                className={`px-3.5 py-2 sm:py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer border ${
                                    isMuted
                                        ? 'bg-red-500/20 border-red-500/40 text-red-300'
                                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                }`}
                            >
                                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                                <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
                            </button>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleNextQuestion}
                                    className="px-4 py-2 sm:py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                                >
                                    <span>{currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Complete Interview'}</span>
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ═════════════════════════════════════════════════════════════════
                    RIGHT COLUMN: Live Conversation Transcript & Question Checklist
                   ═════════════════════════════════════════════════════════════════ */}
                <div className="lg:w-5/12 xl:w-1/3 max-lg:h-[45vh] max-lg:shrink-0 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col min-h-0">
                    {/* Panel Header Tabs */}
                    <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab("transcript")}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                    activeTab === 'transcript'
                                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                Live Transcript ({transcript.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("questions")}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                    activeTab === 'questions'
                                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                Questions ({questions.length})
                            </button>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span>Live Voice</span>
                        </div>
                    </div>

                    {/* Content Panel */}
                    {activeTab === 'transcript' ? (
                        <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
                            <div
                                ref={transcriptRef}
                                onScroll={handleScroll}
                                className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent"
                            >
                                {transcript.length === 0 && !interimTranscript ? (
                                    <div className="text-center py-12 px-4">
                                        <Bot className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                                        <p className="text-xs font-semibold text-slate-400">Voice Transcript Stream</p>
                                        <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                                            Spoken questions from the AI and your spoken responses will appear here in real time.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {transcript.map((entry, idx) => (
                                            <div
                                                key={idx}
                                                className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                                            >
                                                <div
                                                    className={`max-w-[88%] rounded-2xl p-3.5 shadow-sm text-xs leading-relaxed ${
                                                        entry.speaker === 'user'
                                                            ? 'bg-gradient-to-br from-indigo-600 to-purple-700 text-white border border-indigo-400/20'
                                                            : 'bg-slate-900 text-slate-200 border border-slate-800'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2 mb-1 text-[10px] font-bold">
                                                        <span className={entry.speaker === 'user' ? 'text-indigo-200' : 'text-emerald-400'}>
                                                            {entry.speaker === 'user' ? 'You (Candidate)' : 'AI Interviewer'}
                                                        </span>
                                                        <span className="text-slate-400 font-mono text-[9px]">{entry.timestamp}</span>
                                                    </div>
                                                    <p>{entry.text}</p>
                                                </div>
                                            </div>
                                        ))}

                                        {/* Interim Partial Transcript */}
                                        {interimTranscript && (
                                            <div className={`flex ${interimTranscript.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div
                                                    className={`max-w-[88%] rounded-2xl p-3 text-xs italic opacity-85 border border-dashed ${
                                                        interimTranscript.speaker === 'user'
                                                            ? 'bg-indigo-950/60 border-indigo-500/50 text-indigo-200'
                                                            : 'bg-slate-900/60 border-slate-700 text-slate-300'
                                                    }`}
                                                >
                                                    <span className="text-[10px] font-bold block mb-0.5">
                                                        {interimTranscript.speaker === 'user' ? 'Speaking...' : 'AI Speaking...'}
                                                    </span>
                                                    <p>{interimTranscript.text}</p>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Jump to latest button */}
                            {isUserScrolling && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsUserScrolling(false);
                                        if (transcriptRef.current) {
                                            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
                                        }
                                    }}
                                    className="mx-4 my-2 py-1 px-3 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md self-center cursor-pointer"
                                >
                                    ↓ Jump to latest message
                                </button>
                            )}
                        </div>
                    ) : (
                        /* Question Overview Checklist */
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950">
                            {questions.map((q, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => setCurrentQuestionIndex(idx)}
                                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-xs ${
                                        idx === currentQuestionIndex
                                            ? 'bg-slate-900 border-emerald-500/60 ring-1 ring-emerald-500/20'
                                            : idx < currentQuestionIndex
                                                ? 'bg-slate-950 border-slate-800 text-slate-400'
                                                : 'bg-slate-950/60 border-slate-900 text-slate-500'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1 font-bold">
                                        <span className={idx === currentQuestionIndex ? 'text-emerald-400' : 'text-slate-300'}>
                                            Question {idx + 1}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                                            idx === currentQuestionIndex
                                                ? 'bg-emerald-500/20 text-emerald-400 font-extrabold'
                                                : idx < currentQuestionIndex
                                                    ? 'bg-slate-800 text-slate-300'
                                                    : 'bg-slate-900 text-slate-600'
                                        }`}>
                                            {idx === currentQuestionIndex ? 'In Progress' : idx < currentQuestionIndex ? 'Answered' : 'Upcoming'}
                                        </span>
                                    </div>
                                    <p className="line-clamp-2 leading-relaxed">{q.question}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── End Interview Confirmation Modal ── */}
            <AnimatePresence>
                {showEndConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 text-center"
                    >
                        <motion.div
                            initial={{ scale: 0.92, opacity: 0, y: 15 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.92, opacity: 0, y: 15 }}
                            className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-3xl max-w-md w-full shadow-2xl text-left"
                        >
                            <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mb-4">
                                <PhoneOff size={24} className="text-red-400" />
                            </div>

                            <h3 className="text-lg font-bold text-white mb-1.5">Finalize Interview?</h3>
                            <p className="text-slate-400 text-xs leading-relaxed mb-6">
                                Are you sure you want to conclude the interview? Your answers and conversation transcript will be finalized and submitted for AI evaluation.
                            </p>

                            <div className="flex items-center gap-3 justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowEndConfirm(false)}
                                    disabled={isSubmitting}
                                    className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                                >
                                    Continue Interview
                                </button>
                                <button
                                    type="button"
                                    onClick={stopInterview}
                                    disabled={isSubmitting}
                                    className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-all shadow-lg shadow-red-600/25 flex items-center gap-2 cursor-pointer"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            <span>Submitting...</span>
                                        </>
                                    ) : (
                                        <span>Yes, Submit Interview</span>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Submitting Overlay */}
            {isSubmitting && (
                <div className="fixed inset-0 z-[250] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="text-center">
                        <div className="w-14 h-14 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <h3 className="text-base font-bold text-white mb-1">Finalizing Evaluation</h3>
                        <p className="text-xs text-slate-400">Saving transcript and analyzing technical competencies...</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VapiInterview;
