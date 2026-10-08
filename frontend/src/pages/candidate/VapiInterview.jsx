import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Vapi from '@vapi-ai/web';
import { Mic, MicOff, PhoneOff, Video, Shield, Clock, CheckCircle, ArrowRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useProctoring from '../../hooks/useProctoring';
import useFaceProctoring from '../../hooks/useFaceProctoring';
import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';
import FullscreenGateModal from '../../components/FullscreenGateModal';
import API_URL from '../../apiConfig';

// Vapi Keys — loaded from frontend/.env.local (VITE_VAPI_PUBLIC_KEY)
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY;

const VapiInterview = () => {
    const navigate = useNavigate();
    const [status, setStatus] = useState("idle");
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(0);
    const [cameraEnabled, setCameraEnabled] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [completedDuration, setCompletedDuration] = useState(0);
    const isSubmittingRef = useRef(false);

    // Auth check — redirect to login if no token
    useEffect(() => {
        const token = localStorage.getItem('candidateToken');
        if (!token) {
            navigate('/portal/login');
        }
    }, [navigate]);

    // Proctoring Integration
    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [warningKey, setWarningKey] = useState(0);
    const warningTimerRef = useRef(null);

    // Camera-specific human-friendly messages
    const getCameraViolationMessage = (reason) => {
        if (reason.includes('Face not visible') || reason.includes('no_person')) {
            return '⚠️ Your face is not visible in the camera. Please ensure your face is clearly in frame.';
        }
        if (reason.includes('Multiple persons') || reason.includes('multiple_persons')) {
            return '🚨 Multiple people detected in your camera. Only you should be visible during the interview.';
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
        if (reason.includes('tab') || reason.includes('window') || reason.includes('focus')) {
            return '🖥️ Interruption detected: You left the interview screen. Please stay on this page.';
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

    const [violationCount, setViolationCount] = useState(0);
    const terminalFiredRef = useRef(false);

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
            stopInterview();
            setTerminalMessage(`Maximum violations reached (${reason}). The interview session is being terminated.`);
            setShowTerminalOverlay(true);
        }
    }, []);

    const { violations: tabViolations } = useProctoring({
        enabled: status === 'active',
        maxViolations: 999, // Handled unified
        onViolation: (reason) => {
            handleAnyViolation(reason);
        },
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
        enabled: status !== 'ended' && !isSubmitted && securityConfig.fullscreenProctoring,
        isCompleted: status === 'ended' || isSubmitted,
        onRecoveryTimeout: handleFullscreenTimeout,
        onEnterSuccess: () => {
            if (status === 'idle' && !hasStartedRef.current) {
                handleBeginInterview();
            }
        }
    });

    const [boxes, setBoxes] = useState([]);
    const boxTimerRef = useRef(null);
    const [detectionStatus, setDetectionStatus] = useState('idle');

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (boxTimerRef.current) clearTimeout(boxTimerRef.current);
        };
    }, []);

    // Background face detection during active interview
    const { suspectLabel } = useFaceProctoring({
        enabled: status === 'active' && securityConfig.faceProctoring,
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
        onViolation: (reason) => {
            handleAnyViolation(reason);
        }
    });

    const [showTerminalOverlay, setShowTerminalOverlay] = useState(false);
    const [terminalMessage, setTerminalMessage] = useState('');
    const [transcript, setTranscript] = useState([]);
    const [currentSpeaker, setCurrentSpeaker] = useState(null);
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const [leftWidth, setLeftWidth] = useState(70); // Resizable panel width
    const [connectionError, setConnectionError] = useState(null);

    const vapiRef = useRef(null);
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const transcriptRef = useRef(null); // DOM element for auto-scroll
    const transcriptDataRef = useRef([]); // Data storage for transcript history
    const scrollTimeoutRef = useRef(null);
    const hasStartedRef = useRef(false);
    const connectionTimeoutRef = useRef(null);
    const startTimeRef = useRef(null);

    // Initialize Vapi
    useEffect(() => {
        try {
            const vapi = new Vapi(VAPI_PUBLIC_KEY);
            vapiRef.current = vapi;

            vapi.on('call-start', () => {
                setStatus("active");
                startTimeRef.current = Date.now();
                if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);

                const currentAssessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');
                let config = currentAssessment.config || {};

                // Handle stringified config
                if (typeof config === 'string') {
                    try { config = JSON.parse(config); } catch (e) { console.error("Config parse error", e); }
                }

                // Priority: config duration -> timeLimit -> default 30
                const duration = config.duration || config.timeLimit || 30;
                startTimer(duration);
            });

            vapi.on('call-end', async () => {
                setStatus("ended");
                stopTimer();
                setCurrentSpeaker(null);
                if (!isSubmittingRef.current) {
                    stopInterview();
                }
            });

            vapi.on('volume-level', (level) => setVolume(level));

            vapi.on('message', (message) => {
                if (message.type === 'transcript' && message.transcriptType === 'final') {
                    // Capture both AI and user transcripts
                    const speaker = (message.role === 'assistant' || message.role === 'ai') ? 'ai' : 'user';
                    const newEntry = {
                        speaker,
                        text: message.transcript,
                        timestamp: new Date().toLocaleTimeString()
                    };
                    setTranscript(prev => {
                        const updated = [...prev, newEntry];
                        transcriptDataRef.current = updated;
                        return updated;
                    });
                    setCurrentSpeaker(speaker);
                    setTimeout(() => setCurrentSpeaker(null), 2000);
                }
            });

            vapi.on('speech-start', () => setCurrentSpeaker('ai'));
            vapi.on('speech-end', () => setCurrentSpeaker(null));

            vapi.on('error', (e) => console.error("Vapi Error:", e));

            return () => {
                vapi.stop();
                stopCamera();
                stopTimer();
            };
        } catch (e) {
            console.error("Failed to init Vapi:", e);
        }
    }, []);

    // Cleanup on unmount only
    useEffect(() => {
        return () => {
            if (vapiRef.current) vapiRef.current.stop();
            stopCamera();
        };
    }, []);

    // Manual start — called when candidate clicks "Start Interview"
    const handleBeginInterview = async () => {
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;
        startCamera();

        // Fetch dynamic Assistant ID from backend, then start interview
        try {
            const token = localStorage.getItem('candidateToken');
            const response = await fetch(`${API_URL}/api/interview/init`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.assistantId) {
                    const currentAssessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');
                    currentAssessment.assistantId = data.assistantId;
                    localStorage.setItem('currentAssessment', JSON.stringify(currentAssessment));
                }
            }
        } catch (e) {
            console.error("Failed to fetch assistant ID from backend:", e);
        }

        // Start interview
        startInterview();
    };

    // Auto-scroll transcript
    useEffect(() => {
        if (!isUserScrolling && transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
    }, [transcript, isUserScrolling]);

    // Timer Logic
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

    // Camera Stream Attachment Effect
    // Ensures video element gets the stream when it mounts
    useEffect(() => {
        if (cameraEnabled && videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
        }
    }, [cameraEnabled]);

    // Camera Logic - Auto-enable
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            streamRef.current = stream;
            setCameraEnabled(true);
        } catch (err) {
            console.error("Camera access denied:", err);
            setCameraEnabled(false);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setCameraEnabled(false);
    };

    // Interview Start
    const startInterview = async () => {
        if (!vapiRef.current || status !== 'idle') return;
        setStatus("connecting");
        setConnectionError(null);

        // Set timeout for connection
        connectionTimeoutRef.current = setTimeout(() => {
            if (status === 'connecting') {
                setStatus("error");
                setConnectionError("Connection timed out. Please check your internet or VAPI configuration.");
            }
        }, 15000); // 15 seconds timeout

        try {
            // Try to get ID from multiple sources
            const candidateInfo = JSON.parse(localStorage.getItem('candidateInfo') || '{}');
            const currentAssessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');


            // Handle potential stringified config
            let config = currentAssessment.config || {};
            if (typeof config === 'string') {
                try { config = JSON.parse(config); } catch (e) { console.error("Config parse error", e); }
            }

            // Priority: config in assessment -> root in assessment -> candidateInfo -> dynamic
            let assistantIdFromStorage =
                config.assistantId ||
                currentAssessment.assistantId ||
                candidateInfo.assistantId;

            // Check if user manually overrode it in current session (via error input)
            const manualOverride = localStorage.getItem('vapi_manual_id');
            if (manualOverride) assistantIdFromStorage = manualOverride;


            if (!assistantIdFromStorage) {
                throw new Error("Interview session not initialized. Please refresh the page.");
            }

            // Start the VAPI call — do NOT call stop() here, it triggers call-end prematurely
            await vapiRef.current.start(assistantIdFromStorage);

            // Clear timeout on success
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            setStatus("active"); // Optimistic update, real update via event

        } catch (err) {
            console.error("Failed to start interview:", err);
            console.error("VAPI Error Details:", err.error || err);
            setStatus("error");
            setConnectionError(err.message || JSON.stringify(err));
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        }
    };

    const stopInterview = async () => {
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        setShowEndConfirm(false);

        if (vapiRef.current) {
            try {
                vapiRef.current.stop();
            } catch (e) {
                console.error("Error stopping Vapi:", e);
            }
        }

        const duration = startTimeRef.current 
            ? Math.floor((Date.now() - startTimeRef.current) / 1000) 
            : 0;

        // Try the detailed interview submit first
        await submitInterviewResults();
        
        // GUARANTEED FALLBACK: Always mark assessment as completed via the general endpoint
        // This ensures the assessment is closed even if VAPI never connected or interview was short
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
                        result: { passed: 0, total: 0 },
                        status: "Completed"
                    })
                });
            }
        } catch (e) {
            // Ignore — assessment may already be marked completed by the interview submit
        }
        
        stopCamera();
        stopTimer();
        setCompletedDuration(duration);
        setIsSubmitting(false);
        setIsSubmitted(true);
        setStatus("ended");
    };

    const toggleMute = () => {
        if (vapiRef.current) {
            try {
                const newMuted = !isMuted;
                vapiRef.current.setMuted(newMuted);
                setIsMuted(newMuted);
            } catch (e) {
                console.error("Error toggling mute:", e);
            }
        }
    };

    // Submit Results
    const submitInterviewResults = async () => {
        // Guard: only submit if the call actually started (startTimeRef is set by call-start event)
        if (!startTimeRef.current) {
            console.warn("submitInterviewResults called but call never started. Skipping submission.");
            return;
        }

        // Guard: if interview lasted < 10 seconds, it was likely a connection glitch — don't mark as submitted
        const interviewDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);
        if (interviewDuration < 10) {
            console.warn(`Interview ended after only ${interviewDuration}s — likely a connection error, not submitting.`);
            setStatus("error");
            setConnectionError(`VAPI connected but disconnected after ${interviewDuration}s. Please retry.`);
            startTimeRef.current = null; // Reset so retry works
            return;
        }

        try {
            const token = localStorage.getItem('candidateToken');

            const response = await fetch(`${API_URL}/api/interview/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    round_type: 'interview',
                    score: 0,
                    total_score: 100,
                    duration: interviewDuration,
                    transcript: transcriptDataRef.current || [] // Use data ref for latest data
                })
            });

            if (response.ok) {
                console.log("Interview results submitted successfully");
            }
        } catch (error) {
            console.error("Failed to submit interview results:", error);
        }
    };

    // Handle scroll detection
    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;

        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

        setIsUserScrolling(!isAtBottom);

        scrollTimeoutRef.current = setTimeout(() => {
            if (isAtBottom) setIsUserScrolling(false);
        }, 1000);
    };

    // Format time
    const formatTime = (seconds) => {
        if (seconds === null) return "--:--";
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Handle panel resize
    const handleMouseDown = (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = leftWidth;

        const handleMouseMove = (e) => {
            const deltaX = e.clientX - startX;
            const newWidth = startWidth + (deltaX / window.innerWidth) * 100;
            if (newWidth >= 50 && newWidth <= 85) {
                setLeftWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // Pre-interview ready screen — shown when status is idle and no interview has started
    if (status === 'idle' && !hasStartedRef.current) {
        return (
            <div className="h-screen bg-[#0a0a0a] flex items-center justify-center text-white relative">
                {/* Fullscreen Gate Modal */}
                <FullscreenGateModal
                    isOpen={securityConfig.fullscreenProctoring && (isGateOpen || isRecoveryOpen)}
                    mode={isRecoveryOpen ? 'recovery' : 'entry'}
                    timeLeft={recoveryTimeLeft}
                    error={fullscreenError}
                    onAction={isRecoveryOpen ? returnToFullscreen : enterFullscreen}
                />
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-center max-w-lg p-8"
                >
                    <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-purple-700 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                        <Video size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold mb-3">AI Video Interview</h1>
                    <p className="text-gray-400 mb-8 leading-relaxed">
                        Your interview will be conducted by an AI interviewer. Please ensure your camera and microphone are ready.
                    </p>

                    <div className="space-y-3 text-left bg-gray-900/50 rounded-xl p-5 mb-8 border border-gray-800">
                        <div className="flex items-center gap-3 text-sm text-gray-300">
                            <Video size={16} className="text-blue-400 flex-shrink-0" />
                            <span>Camera will be enabled for proctoring</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-300">
                            <Mic size={16} className="text-green-400 flex-shrink-0" />
                            <span>Microphone required for voice interview</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-300">
                            <Shield size={16} className="text-yellow-400 flex-shrink-0" />
                            <span>Fullscreen mode will be enforced</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-300">
                            <Clock size={16} className="text-purple-400 flex-shrink-0" />
                            <span>Timed session — do not leave the screen</span>
                        </div>
                    </div>

                    <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={securityConfig.fullscreenProctoring ? enterFullscreen : handleBeginInterview}
                        className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-bold text-lg transition-all shadow-lg shadow-blue-500/25"
                    >
                        Start Interview
                    </motion.button>
                </motion.div>
            </div>
        );
    }

    // Post-interview Completion Screen
    if (isSubmitted && !showTerminalOverlay) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 text-white relative overflow-hidden">
                {/* Background decorative ambient glows */}
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="bg-gray-900/90 border border-gray-800 rounded-3xl p-8 sm:p-10 max-w-lg w-full text-center shadow-2xl backdrop-blur-xl relative z-10"
                >
                    {/* Glowing emerald check icon */}
                    <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/10">
                        <CheckCircle className="text-emerald-400" size={42} />
                    </div>

                    <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-3">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        Interview Submitted Successfully
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 tracking-tight">
                        Interview Completed
                    </h2>

                    <p className="text-gray-400 text-sm leading-relaxed mb-6">
                        Thank you for completing your AI Video Interview session. Your responses and conversation transcript have been recorded.
                    </p>

                    {/* Session Summary Card */}
                    <div className="bg-gray-950/70 border border-gray-800/80 rounded-2xl p-5 mb-6 text-left space-y-3">
                        <div className="flex items-center justify-between text-xs sm:text-sm">
                            <span className="text-gray-400">Interview Status</span>
                            <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                Recorded & Finalized
                            </span>
                        </div>
                        {completedDuration > 0 && (
                            <div className="flex items-center justify-between text-xs sm:text-sm border-t border-gray-800/60 pt-2.5">
                                <span className="text-gray-400">Total Duration</span>
                                <span className="font-mono font-semibold text-white">
                                    {Math.floor(completedDuration / 60)}m {completedDuration % 60}s
                                </span>
                            </div>
                        )}
                        <div className="flex items-center justify-between text-xs sm:text-sm border-t border-gray-800/60 pt-2.5">
                            <span className="text-gray-400">Evaluation Round</span>
                            <span className="font-semibold text-gray-200">AI Technical Interview</span>
                        </div>
                    </div>

                    {/* Next Steps Card */}
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 mb-8 text-left">
                        <div className="flex items-start gap-3">
                            <Clock size={18} className="text-blue-400 shrink-0 mt-0.5" />
                            <div>
                                <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wider mb-1">What Happens Next?</h4>
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    Our recruiting team will review your interview transcript and technical evaluation. You will be contacted via email regarding your application status.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                localStorage.removeItem('currentAssessment');
                                localStorage.removeItem('candidateToken');
                                localStorage.removeItem('aptitudeQuestions');
                                navigate('/portal/login');
                            }}
                            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <span>Return to Portal</span>
                            <ArrowRight size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                localStorage.clear();
                                navigate('/portal/login');
                            }}
                            className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold text-sm transition-colors cursor-pointer"
                        >
                            Log Out
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-[#0a0a0a] flex flex-col text-white relative overflow-hidden">
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
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="fixed top-0 left-0 right-0 z-[100] shadow-2xl"
                        style={{
                            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                            borderBottom: '3px solid #fca5a5'
                        }}
                    >
                        <div className="max-w-5xl mx-auto px-6 py-4 flex items-start gap-4">
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 animate-pulse mt-0.5">
                                <PhoneOff size={20} className="text-white" />
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-white text-base leading-snug">{warningMessage}</p>
                                <div className="flex items-center gap-3 mt-2">
                                    <span className="text-red-200 text-sm">Violation {violationCount}/3 recorded</span>
                                    <span className="text-red-300 text-xs">• Further violations will terminate the interview</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowWarning(false)}
                                className="text-white/60 hover:text-white text-xl ml-2 leading-none flex-shrink-0"
                                style={{ marginTop: '2px' }}
                            >✕</button>
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
                                <PhoneOff size={40} className="text-red-500 animate-pulse" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">Interview Terminated</h2>
                            <p className="text-gray-400 mb-8">{terminalMessage}</p>
                            <button
                                onClick={() => window.location.href = '/portal/login'}
                                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors"
                            >
                                Return to Portal
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Top Bar */}
            <div className="bg-black/50 backdrop-blur-sm px-6 py-3 flex items-center justify-between border-b border-gray-800">
                <h1 className="text-sm font-medium text-gray-300">AI Video Interview</h1>
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-400">
                        Time: <span className="font-mono text-white text-lg font-bold">{formatTime(timeRemaining)}</span>
                    </div>
                    {currentSpeaker && (
                        <div className={`text-xs px-2 py-1 rounded ${currentSpeaker === 'ai' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                            }`}>
                            {currentSpeaker === 'ai' ? 'AI Speaking' : 'You Speaking'}
                        </div>
                    )}
                </div>
            </div>

            {/* Main 2-Panel Layout with Resizable Divider */}
            <div className="flex-1 flex min-h-0">
                {/* LEFT PANEL - AI Interviewer (Resizable) */}
                <div className="bg-[#1a1a1a] relative flex items-center justify-center" style={{ width: `${leftWidth}%` }}>
                    {/* AI Avatar */}
                    <div className="relative">
                        <motion.div
                            className={`w-64 h-64 rounded-full flex items-center justify-center ${currentSpeaker === 'ai' ? 'bg-gradient-to-br from-blue-600 to-purple-700' : 'bg-gradient-to-br from-gray-700 to-gray-800'
                                } shadow-2xl`}
                            animate={{
                                scale: currentSpeaker === 'ai' ? [1, 1.05, 1] : 1
                            }}
                            transition={{ duration: 1, repeat: Infinity }}
                        >
                            <div className="text-8xl">🤖</div>
                        </motion.div>

                        {currentSpeaker === 'ai' && (
                            <motion.div
                                className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-500 px-4 py-1 rounded-full text-xs"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                Speaking...
                            </motion.div>
                        )}
                    </div>

                    <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg">
                        <p className="text-sm font-medium">AI Interviewer</p>
                    </div>
                </div>

                {/* Resizable Divider */}
                <div
                    className="w-1 bg-gray-800 hover:bg-blue-500 cursor-col-resize transition-colors"
                    onMouseDown={handleMouseDown}
                />

                {/* RIGHT PANEL - Candidate + Transcript */}
                <div className="flex-1 bg-[#0f0f0f] flex flex-col border-l border-gray-800">
                    {/* Candidate Camera */}
                    <div className="relative bg-black aspect-video overflow-hidden">
                        {cameraEnabled ? (
                            <>
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover transform scale-x-[-1]"
                                />
                                
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
                                        zIndex: 10,
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

                                <div className="absolute top-3 left-3 bg-gray-900/80 px-2 py-1 rounded text-xs font-medium z-10">
                                    You
                                </div>
                                {currentSpeaker === 'user' && (
                                    <div className="absolute bottom-3 left-3 bg-green-500 px-3 py-1 rounded-full text-xs z-10">
                                        Speaking...
                                    </div>
                                )}
                                {currentSpeaker === 'ai' && (
                                    <div className="absolute bottom-3 left-3 bg-gray-700 px-3 py-1 rounded-full text-xs z-10">
                                        Listening...
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-900">
                                <div className="text-center">
                                    <div className="text-4xl mb-2">📷</div>
                                    <p className="text-xs text-gray-500">Camera unavailable</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Live Transcript */}
                    <div className="flex-1 flex flex-col bg-[#0f0f0f] min-h-0">
                        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                            <h3 className="text-xs font-semibold text-gray-400 uppercase">Live Transcript</h3>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                <span className="text-xs text-gray-500">Live</span>
                            </div>
                        </div>

                        <div
                            ref={transcriptRef}
                            onScroll={handleScroll}
                            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
                        >
                            {transcript.length === 0 ? (
                                <p className="text-xs text-gray-600 text-center mt-8">Transcript will appear here...</p>
                            ) : (
                                <AnimatePresence>
                                    {transcript.map((entry, idx) => (
                                        <motion.div
                                            key={idx}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div className={`max-w-[85%] ${entry.speaker === 'ai'
                                                ? 'bg-gray-800 text-left'
                                                : 'bg-purple-600 text-right'
                                                } rounded-lg px-3 py-2`}>
                                                <p className={`text-[10px] font-semibold mb-1 ${entry.speaker === 'ai' ? 'text-blue-400' : 'text-purple-200'}`}>
                                                    {entry.speaker === 'ai' ? 'AI Interviewer' : 'You'}
                                                </p>
                                                <p className="text-xs text-white leading-relaxed">{entry.text}</p>
                                                <p className="text-[9px] text-gray-500 mt-1">{entry.timestamp}</p>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            )}
                        </div>

                        {isUserScrolling && (
                            <button
                                onClick={() => {
                                    setIsUserScrolling(false);
                                    if (transcriptRef.current) {
                                        transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
                                    }
                                }}
                                className="mx-4 mb-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-full text-xs transition-colors"
                            >
                                ↓ Jump to latest
                            </button>
                        )}
                    </div>
                </div>
            </div >

            {/* Bottom Control Bar - Only show during active interview */}
            {
                status === 'active' && (
                    <div className="bg-black/50 backdrop-blur-sm border-t border-gray-800 py-4 flex items-center justify-center gap-4">
                        <button
                            onClick={toggleMute}
                            disabled={currentSpeaker === 'ai'}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentSpeaker === 'ai' ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                                isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                                }`}
                        >
                            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowEndConfirm(true)}
                            title="End Interview"
                            className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-red-600/30 hover:scale-105 active:scale-95"
                        >
                            <PhoneOff className="w-5 h-5" />
                        </button>
                    </div>
                )
            }

            {/* End Interview Confirmation Modal */}
            <AnimatePresence>
                {showEndConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 text-center"
                    >
                        <motion.div
                            initial={{ scale: 0.92, opacity: 0, y: 15 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.92, opacity: 0, y: 15 }}
                            className="bg-gray-900 border border-gray-800 p-7 rounded-2xl max-w-md w-full shadow-2xl text-left"
                        >
                            <div className="w-14 h-14 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mb-5">
                                <PhoneOff size={28} className="text-red-500" />
                            </div>

                            <h3 className="text-xl font-bold text-white mb-2">End Interview Session?</h3>
                            <p className="text-gray-400 text-sm leading-relaxed mb-6">
                                Are you sure you want to end your interview? Your responses and conversation transcript will be finalized and submitted for evaluation. You cannot resume after ending.
                            </p>

                            <div className="flex items-center gap-3 justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowEndConfirm(false)}
                                    disabled={isSubmitting}
                                    className="px-4 py-2.5 rounded-xl border border-gray-700 hover:bg-gray-800 text-gray-300 font-semibold text-sm transition-colors cursor-pointer"
                                >
                                    Continue Interview
                                </button>
                                <button
                                    type="button"
                                    onClick={stopInterview}
                                    disabled={isSubmitting}
                                    className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-all shadow-lg shadow-red-600/25 flex items-center gap-2 cursor-pointer"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>Submitting...</span>
                                        </>
                                    ) : (
                                        <span>Yes, End & Submit</span>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Submitting Overlay */}
            {isSubmitting && (
                <div className="fixed inset-0 z-[250] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-white mb-1">Finalizing Interview</h3>
                        <p className="text-sm text-gray-400">Submitting your responses and transcript...</p>
                    </div>
                </div>
            )}

            {/* Connecting Overlay */}
            {
                (status === 'connecting' || status === 'error') && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
                        <div className="text-center max-w-md p-6">
                            {status === 'connecting' ? (
                                <>
                                    <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                                    <p className="text-lg font-medium">Connecting to AI Interviewer...</p>
                                    <p className="text-sm text-gray-400 mt-2">Please wait...</p>
                                </>
                            ) : (
                                <>
                                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <PhoneOff className="w-8 h-8 text-red-500" />
                                    </div>
                                    <p className="text-lg font-medium text-red-400">Connection Failed</p>
                                    <p className="text-sm text-gray-400 mt-2 mb-4">{connectionError || "Could not connect to VAPI."}</p>
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-colors"
                                    >
                                        Retry Connection
                                    </button>

                                    <div className="mt-4 pt-4 border-t border-gray-700">
                                        <p className="text-xs text-gray-400 mb-2">Override Assistant ID (Optional):</p>
                                        <input
                                            type="text"
                                            placeholder="Paste VAPI Assistant ID here"
                                            className="w-full bg-gray-900 border border-gray-700 text-white text-xs p-2 rounded mb-2"
                                            onChange={(e) => {
                                                if (e.target.value.length > 5) {
                                                    localStorage.setItem('vapi_manual_id', e.target.value);
                                                }
                                            }}
                                        />
                                        <p className="text-[10px] text-gray-500">Updates will apply on Retry</p>
                                    </div>

                                    <p className="text-xs text-slate-500 mt-4 max-w-xs mx-auto break-words">
                                        Debug: {connectionError}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default VapiInterview;
