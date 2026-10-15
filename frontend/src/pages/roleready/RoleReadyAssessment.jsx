import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Vapi from '@vapi-ai/web';
import { 
    Clock, 
    CheckCircle2, 
    Lock, 
    Play, 
    Code2, 
    MessageSquare, 
    BrainCircuit, 
    AlertTriangle, 
    Terminal, 
    ArrowRight,
    Sparkles,
    ShieldAlert,
    Maximize,
    ChevronRight,
    RefreshCw,
    Camera,
    CameraOff,
    Mic,
    MicOff,
    Video,
    ShieldCheck,
    Check,
    AlertCircle,
    RotateCcw,
    Award,
    Volume2,
    Eye,
    Shield,
    XCircle,
    CheckCircle,
    Bot,
    User,
    Radio,
    Loader2,
    PhoneOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Editor } from '@monaco-editor/react';
import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';
import useFaceProctoring from '../../hooks/useFaceProctoring';
import FullscreenGateModal from '../../components/FullscreenGateModal';
import rolereadyApi from '../../services/rolereadyApi';
import API_URL from '../../apiConfig';
import { markStudentTaskCompleted } from '../../hooks/useStudentTaskStatus';

const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY;

const ROUND_DURATIONS = {
    aptitude: 15 * 60, // 15 mins
    coding: 30 * 60,   // 30 mins
    interview: 15 * 60 // 15 mins
};

const MAX_MALPRACTICE_WARNINGS = 3;

/**
 * ProctorCameraFeed
 * Real-time proctor video stream with diagnostic YOLOv8n bounding boxes and suspect alert overlays.
 */
const ProctorCameraFeed = ({
    stream,
    detections = [],
    faceBoxes = [],
    personCount = 1,
    suspectLabel = null,
    isModelActive = false,
    detectionStatus = 'detected',
    violationCount = 0,
    className = "",
    showDiagnostics = true,
    compact = false
}) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            if (videoRef.current.srcObject !== stream) {
                videoRef.current.srcObject = stream;
            }
            videoRef.current.play().catch(() => {});
        }
    }, [stream]);

    // Format bounding boxes for mirrored display
    const renderedBoxes = [];
    if (showDiagnostics && !compact) {
        // Face boxes
        (faceBoxes || []).forEach((fb, idx) => {
            renderedBoxes.push({
                key: `face-${idx}`,
                label: 'Candidate Verified',
                left: `${(1 - fb[2]) * 100}%`,
                top: `${fb[1] * 100}%`,
                width: `${(fb[2] - fb[0]) * 100}%`,
                height: `${(fb[3] - fb[1]) * 100}%`,
                isAlert: !!suspectLabel || detectionStatus === 'multiple',
                color: (suspectLabel || detectionStatus === 'multiple') ? '#EF4444' : '#16A34A'
            });
        });

        // Suspicious items (cell phone, laptop, book)
        (detections || []).filter(d => d.class !== 'person' && d.bbox).forEach((d, idx) => {
            renderedBoxes.push({
                key: `det-${idx}`,
                label: `${d.class === 'cell phone' ? '📱 Mobile Phone' : d.class} (${Math.round(d.confidence * 100)}%)`,
                left: `${(1 - d.bbox[2]) * 100}%`,
                top: `${d.bbox[1] * 100}%`,
                width: `${(d.bbox[2] - d.bbox[0]) * 100}%`,
                height: `${(d.bbox[3] - d.bbox[1]) * 100}%`,
                isAlert: true,
                color: '#DC2626'
            });
        });
    }

    return (
        <div className={`flex flex-col gap-1.5 w-full ${className}`}>
            {/* Status & Warning Bar: Placed cleanly outside camera viewport so face is completely unblocked */}
            <div className="flex items-center justify-between gap-1 text-[10px] font-semibold flex-wrap">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md ${
                    isModelActive
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isModelActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                    <span className="truncate">{isModelActive ? 'YOLOv8n Active' : 'Connecting...'}</span>
                </span>

                <div className="flex items-center gap-1">
                    <span className={`px-1.5 py-0.5 rounded-md font-bold whitespace-nowrap ${
                        personCount === 1
                            ? 'bg-slate-100 text-slate-700 border border-slate-200'
                            : personCount === 0
                                ? 'bg-red-50 text-red-700 border border-red-300 animate-pulse'
                                : 'bg-amber-50 text-amber-800 border border-amber-300'
                    }`}>
                        👤 {personCount === 0 ? 'No Person' : `${personCount} Person${personCount > 1 ? 's' : ''}`}
                    </span>

                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono whitespace-nowrap">
                        Warnings: <strong className={violationCount > 0 ? "text-amber-600 font-bold" : "text-slate-800"}>{violationCount}/3</strong>
                    </span>
                </div>
            </div>

            {/* Video Viewport: Responsive aspect ratio with centered object-cover and mirror transform */}
            <div className="relative w-full aspect-video rounded-xl bg-slate-950 overflow-hidden border border-slate-200 shadow-inner flex items-center justify-center">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover object-center transform -scale-x-100"
                />

                {/* Bounding Box Visualizer Layer (when enabled and not in ultra-compact view) */}
                {renderedBoxes.map((box) => (
                    <div
                        key={box.key}
                        style={{
                            position: 'absolute',
                            left: box.left,
                            top: box.top,
                            width: box.width,
                            height: box.height,
                            border: `2px solid ${box.color}`,
                            borderRadius: '6px',
                            pointerEvents: 'none',
                            boxShadow: box.isAlert ? '0 0 8px rgba(220, 38, 38, 0.6)' : '0 0 6px rgba(22, 163, 74, 0.4)',
                            transition: 'all 0.15s ease-out',
                            zIndex: 5
                        }}
                    >
                        <span
                            style={{
                                position: 'absolute',
                                top: '-18px',
                                left: '0',
                                backgroundColor: box.color,
                                color: '#FFFFFF',
                                fontSize: '9px',
                                fontWeight: 'bold',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
                            }}
                        >
                            {box.label}
                        </span>
                    </div>
                ))}

                {!stream && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 text-slate-400 text-xs p-3 text-center z-10">
                        <CameraOff className="w-5 h-5 mb-1 text-slate-500" />
                        <span>Camera Standby</span>
                    </div>
                )}
            </div>

            {/* Suspect Alert Banner - Positioned BELOW the video feed, never blocking face */}
            {suspectLabel && (
                <div className="w-full bg-red-50 text-red-800 border border-red-300 text-[10px] font-bold py-1 px-2 rounded-lg text-center animate-pulse flex items-center justify-center gap-1 shadow-xs">
                    <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
                    <span className="truncate">{suspectLabel}</span>
                </div>
            )}
        </div>
    );
};

const RoleReadyAssessment = () => {
    const { sessionUuid } = useParams();
    const navigate = useNavigate();

    // ── Session & Overall Workflow State ─────────────────────────────
    const [sessionData, setSessionData] = useState(null);
    const [currentStage, setCurrentStage] = useState('instructions'); // 'instructions' | 'device_check' | 'aptitude' | 'coding' | 'interview'
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [launchError, setLaunchError] = useState(null);

    // ── Hardware & Readiness State (Step 2) ──────────────────────────
    const [cameraStatus, setCameraStatus] = useState('checking'); // 'checking' | 'allowed' | 'denied' | 'unavailable'
    const [micStatus, setMicStatus] = useState('checking');       // 'checking' | 'allowed' | 'denied' | 'unavailable'
    const [modelStatus, setModelStatus] = useState('checking');   // 'checking' | 'ready' | 'error'
    const [cameraStream, setCameraStream] = useState(null);
    const [instructionsAccepted, setInstructionsAccepted] = useState(false);
    const [isStartingAssessment, setIsStartingAssessment] = useState(false);

    // Stream Refs
    const streamRef = useRef(null);
    const previewVideoRef = useRef(null);

    // ── 3-Warning Malpractice Policy & Proctoring ────────────────────
    const [violationCount, setViolationCount] = useState(0);
    const [violations, setViolations] = useState([]);
    const [warningBanner, setWarningBanner] = useState(null); // { message, level, timestamp }
    const [showTerminalModal, setShowTerminalModal] = useState(false);
    const [terminalReason, setTerminalReason] = useState('');

    const violationsRef = useRef([]);
    const totalViolationsRef = useRef(0);
    const lastViolationTimeRef = useRef(0);
    const terminalFiredRef = useRef(false);
    const warningBannerTimerRef = useRef(null);

    // ── Universal Violation Handler (3-Warning Escalation) ────────────
    const handleAnyViolation = useCallback((reason) => {
        if (terminalFiredRef.current || currentStage === 'instructions' || currentStage === 'device_check') return;

        // Minimum 3000ms cooldown to debounce duplicate events
        const now = Date.now();
        if (now - lastViolationTimeRef.current < 3000) return;
        lastViolationTimeRef.current = now;

        totalViolationsRef.current += 1;
        const count = totalViolationsRef.current;
        setViolationCount(count);

        const violationEntry = {
            type: reason,
            strike: count,
            timestamp: new Date().toISOString()
        };
        setViolations(prev => [...prev, violationEntry]);

        if (warningBannerTimerRef.current) clearTimeout(warningBannerTimerRef.current);

        if (count === 1) {
            setWarningBanner({
                message: `Warning 1/${MAX_MALPRACTICE_WARNINGS}: ${reason}. Please remain in fullscreen on this assessment tab.`,
                level: 'warning'
            });
            warningBannerTimerRef.current = setTimeout(() => setWarningBanner(null), 8000);
        } else if (count === 2) {
            setWarningBanner({
                message: `Final Warning 2/${MAX_MALPRACTICE_WARNINGS}: ${reason}. One more violation will immediately submit and terminate your assessment.`,
                level: 'critical'
            });
            warningBannerTimerRef.current = setTimeout(() => setWarningBanner(null), 10000);
        } else if (count >= MAX_MALPRACTICE_WARNINGS) {
            terminalFiredRef.current = true;
            setTerminalReason(reason);
            setShowTerminalModal(true);
            setWarningBanner({
                message: `Assessment Terminated: ${MAX_MALPRACTICE_WARNINGS}/${MAX_MALPRACTICE_WARNINGS} Malpractice Violations Recorded (${reason}).`,
                level: 'terminal'
            });

            // Fast-path: terminate immediately (no evaluation, no delay). Pass the full list
            // explicitly because this callback's closure holds a stale `violations` state.
            violationsRef.current = [...violationsRef.current, violationEntry];
            handleAutoSubmitDueToMalpractice(reason, violationsRef.current);
            return;
        }
        violationsRef.current = [...violationsRef.current, violationEntry];
    }, [currentStage]);

    // ── Silent Real-Time YOLOv8n Vision Proctoring ────────────────────
    const {
        cameraStream: proctorStream,
        detectionStatus,
        suspectLabel,
        personCount,
        detections,
        faceBoxes,
        isModelActive,
        modelError
    } = useFaceProctoring({
        enabled: currentStage !== 'instructions' && currentStage !== 'device_check' && !sessionData?.is_completed,
        externalStream: cameraStream,
        onViolation: (reason) => {
            handleAnyViolation(reason);
        }
    });

    // ── Fullscreen Proctoring Enforcement ────────────────────────────
    const {
        isFullscreen,
        isGateOpen,
        isRecoveryOpen,
        recoveryTimeLeft,
        error: fullscreenError,
        enterFullscreen,
        returnToFullscreen
    } = useAssessmentFullscreen({
        enabled: currentStage !== 'instructions' && currentStage !== 'device_check' && !sessionData?.is_completed,
        isCompleted: sessionData?.is_completed,
        onExit: () => {
            // Fullscreen lost
        },
        onRecoveryTimeout: () => {
            handleAnyViolation("Fullscreen exit exceeded 10-second recovery limit");
        }
    });

    // ── Tab-Switch and Window Blur Telemetry ──────────────────────────
    useEffect(() => {
        if (currentStage === 'instructions' || currentStage === 'device_check' || sessionData?.is_completed) return;

        const handleVisibilityChange = () => {
            if (document.hidden) {
                handleAnyViolation("Navigated away from assessment window (Tab Switch)");
            }
        };

        const handleWindowBlur = () => {
            handleAnyViolation("Application lost focus (Window Blur / Switch)");
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("blur", handleWindowBlur);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("blur", handleWindowBlur);
        };
    }, [currentStage, sessionData?.is_completed, handleAnyViolation]);

    // ── Round Timers ─────────────────────────────────────────────────
    const [timeLeft, setTimeLeft] = useState(ROUND_DURATIONS.aptitude);
    const [roundStartTime, setRoundStartTime] = useState(Date.now());

    useEffect(() => {
        if (currentStage === 'instructions' || currentStage === 'device_check' || sessionData?.is_completed) return;

        const timer = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    handleTimeExpired();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [currentStage, sessionData?.is_completed]);

    const formatTimer = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    // ── Round 1: Aptitude State ──────────────────────────────────────
    const [aptitudeQuestions, setAptitudeQuestions] = useState([]);
    const [aptitudeAnswers, setAptitudeAnswers] = useState({});
    const [currentAptIndex, setCurrentAptIndex] = useState(0);
    const [isSubmittingApt, setIsSubmittingApt] = useState(false);

    // ── Round 2: Coding State ────────────────────────────────────────
    const [codingProblems, setCodingProblems] = useState([]);
    const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
    const [selectedLanguage, setSelectedLanguage] = useState('python'); // 'python' | 'java'
    const [codeSolutions, setCodeSolutions] = useState({}); // { [probId]: { code: string, language: string } }
    const [codeOutput, setCodeOutput] = useState(null);
    const [isRunningCode, setIsRunningCode] = useState(false);
    const [isSubmittingCoding, setIsSubmittingCoding] = useState(false);

    // ── Round 3: Interview State ─────────────────────────────────────
    const [interviewQuestions, setInterviewQuestions] = useState([]);
    const [interviewResponses, setInterviewResponses] = useState({});
    const [currentInterviewIndex, setCurrentInterviewIndex] = useState(0);
    const [isRecordingVoice, setIsRecordingVoice] = useState(false);
    const [isSubmittingInterview, setIsSubmittingInterview] = useState(false);

    // ── Round 3: Voice-First Vapi State ──────────────────────────────
    const [vapiAssistantId, setVapiAssistantId] = useState(null);
    const [vapiAssistantConfig, setVapiAssistantConfig] = useState(null);
    const [vapiCallStatus, setVapiCallStatus] = useState('idle'); // 'idle' | 'connecting' | 'active' | 'ended' | 'error'
    const [vapiSpeakingState, setVapiSpeakingState] = useState('connecting'); // 'connecting' | 'ai_speaking' | 'listening' | 'processing' | 'completed'
    const [vapiVolume, setVapiVolume] = useState(0);
    const [vapiTranscript, setVapiTranscript] = useState([]);
    const [vapiIsMuted, setVapiIsMuted] = useState(false);
    const [currentSpeaker, setCurrentSpeaker] = useState(null); // 'ai' | 'user'
    const [vapiConnectionError, setVapiConnectionError] = useState(null);
    const [showEndInterviewModal, setShowEndInterviewModal] = useState(false);
    const vapiRef = useRef(null);
    const vapiTranscriptScrollRef = useRef(null);

    // ── Camera, Mic & AI Model Initializer ──────────────────────────
    const initHardware = useCallback(async () => {
        setCameraStatus('checking');
        setMicStatus('checking');
        setModelStatus('checking');

        // Check backend YOLO vision model status
        fetch(`${API_URL}/api/proctor/status`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'ready') {
                    setModelStatus('ready');
                } else {
                    setModelStatus('error');
                }
            })
            .catch(() => setModelStatus('error'));

        try {
            // Clean up any stale streams before requesting a fresh device lock
            if (streamRef.current) {
                try {
                    streamRef.current.getTracks().forEach(t => t.stop());
                } catch (e) {}
                streamRef.current = null;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 } },
                audio: true
            });

            streamRef.current = stream;
            window.__activeProctorStream = stream;
            setCameraStream(stream);
            setCameraStatus('allowed');
            setMicStatus('allowed');

            if (previewVideoRef.current) {
                previewVideoRef.current.muted = true;
                previewVideoRef.current.defaultMuted = true;
                previewVideoRef.current.srcObject = stream;
                previewVideoRef.current.play().catch((err) => console.warn("Preview play error:", err));
            }
        } catch (err) {
            console.warn("[RoleReady] Hardware check error with audio:", err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setCameraStatus('denied');
                setMicStatus('denied');
            } else {
                try {
                    const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
                        video: { width: { ideal: 640 }, height: { ideal: 480 } }
                    });
                    streamRef.current = videoOnlyStream;
                    window.__activeProctorStream = videoOnlyStream;
                    setCameraStream(videoOnlyStream);
                    setCameraStatus('allowed');
                    setMicStatus('unavailable');
                    if (previewVideoRef.current) {
                        previewVideoRef.current.muted = true;
                        previewVideoRef.current.defaultMuted = true;
                        previewVideoRef.current.srcObject = videoOnlyStream;
                        previewVideoRef.current.play().catch((err) => console.warn("Fallback preview play error:", err));
                    }
                } catch (videoErr) {
                    console.error("[RoleReady] Video-only fallback error:", videoErr);
                    setCameraStatus('unavailable');
                    setMicStatus('unavailable');
                }
            }
        }
    }, []);

    // Callback ref guarantees stream is assigned immediately when the <video> DOM node mounts
    const setPreviewVideoElement = useCallback((node) => {
        if (node) {
            previewVideoRef.current = node;
            node.muted = true;
            node.defaultMuted = true;
            const activeStream = streamRef.current || cameraStream || window.__activeProctorStream;
            if (activeStream) {
                if (node.srcObject !== activeStream) {
                    node.srcObject = activeStream;
                }
                node.play().catch((err) => console.warn("Video play on attach error:", err));
            }
        }
    }, [cameraStream]);

    // Connect stream to preview element whenever cameraStream or stage updates
    useEffect(() => {
        const activeStream = streamRef.current || cameraStream || window.__activeProctorStream;
        if (previewVideoRef.current && activeStream) {
            previewVideoRef.current.muted = true;
            previewVideoRef.current.defaultMuted = true;
            if (previewVideoRef.current.srcObject !== activeStream) {
                previewVideoRef.current.srcObject = activeStream;
            }
            previewVideoRef.current.play().catch((err) => console.warn("Video play on stage change error:", err));
        }
    }, [cameraStream, currentStage]);

    // Hardware stream cleanup ONLY on component unmount
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                try {
                    streamRef.current.getTracks().forEach(track => track.stop());
                } catch (e) {}
                streamRef.current = null;
            }
            window.__activeProctorStream = null;
        };
    }, []);

    // ── Session Loader & State Restoration ───────────────────────────
    const fetchSession = useCallback(async () => {
        try {
            const data = await rolereadyApi.getSessionStatus(sessionUuid);
            setSessionData(data);

            if (data.is_completed) {
                navigate(`/assessment/${sessionUuid}/report`);
                return;
            }

            // Restore correct round state
            if (data.current_state === 'NOT_STARTED') {
                setCurrentStage('instructions');
            } else if (data.interview_unlocked) {
                setCurrentStage('interview');
                setTimeLeft(ROUND_DURATIONS.interview);
                loadInterview();
                initHardware();
            } else if (data.coding_unlocked) {
                setCurrentStage('coding');
                setTimeLeft(ROUND_DURATIONS.coding);
                loadCoding();
                initHardware();
            } else {
                setCurrentStage('aptitude');
                setTimeLeft(ROUND_DURATIONS.aptitude);
                loadAptitude();
                initHardware();
            }
        } catch (err) {
            console.error("Failed to fetch session:", err);
            setError(err.response?.data?.detail || "Could not load assessment session.");
        } finally {
            setIsLoading(false);
        }
    }, [sessionUuid, navigate, initHardware]);

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // ── Round 1: Aptitude Operations ─────────────────────────────────
    const loadAptitude = async () => {
        try {
            const res = await rolereadyApi.startAptitude(sessionUuid);
            setAptitudeQuestions(res.questions || []);
            setRoundStartTime(Date.now());
            if (typeof res.remaining_seconds === 'number') setTimeLeft(res.remaining_seconds);
        } catch (err) {
            console.error("Failed to load aptitude questions:", err);
        }
    };

    const handleSelectOption = (questionId, optionKey) => {
        setAptitudeAnswers(prev => ({
            ...prev,
            [String(questionId)]: optionKey
        }));
    };

    const handleSubmitAptitude = async () => {
        if (isSubmittingApt) return;
        setIsSubmittingApt(true);
        const timeSpent = Math.max(1, Math.round((Date.now() - roundStartTime) / 1000));

        try {
            await rolereadyApi.submitAptitude(sessionUuid, aptitudeAnswers, timeSpent, violations);

            // Unlock and navigate to Coding. The session refresh and the coding problems are
            // independent, so fetch them together instead of one after another.
            setCurrentStage('coding');
            setTimeLeft(ROUND_DURATIONS.coding);
            const [updated] = await Promise.all([
                rolereadyApi.getSessionStatus(sessionUuid),
                loadCoding()
            ]);
            setSessionData(updated);
        } catch (err) {
            console.error("Aptitude submission error:", err);
            alert(err.response?.data?.detail || "Aptitude submission failed. Please retry.");
        } finally {
            setIsSubmittingApt(false);
        }
    };

    // ── Round 2: Coding Operations ───────────────────────────────────
    const loadCoding = async () => {
        try {
            const res = await rolereadyApi.startCoding(sessionUuid);
            const probs = res.problems || [];
            setCodingProblems(probs);
            setRoundStartTime(Date.now());
            if (typeof res.remaining_seconds === 'number') setTimeLeft(res.remaining_seconds);

            const initialSols = {};
            probs.forEach(p => {
                initialSols[String(p.id)] = {
                    code: p.starter_code?.python || `# Write your Python solution for ${p.title}\ndef solve():\n    pass\n`,
                    language: 'python'
                };
            });
            setCodeSolutions(prev => ({ ...initialSols, ...prev }));
        } catch (err) {
            console.error("Failed to load coding problems:", err);
        }
    };

    const handleCodeChange = (probId, newCode) => {
        setCodeSolutions(prev => ({
            ...prev,
            [String(probId)]: {
                code: newCode,
                language: selectedLanguage
            }
        }));
    };

    const handleLanguageChange = (newLang) => {
        setSelectedLanguage(newLang);
        if (!codingProblems[currentProblemIndex]) return;
        const activeProb = codingProblems[currentProblemIndex];
        const probId = String(activeProb.id);
        const existingSol = codeSolutions[probId];

        const defaultPython = activeProb.starter_code?.python || `# Write your Python solution for ${activeProb.title}\ndef solve():\n    pass\n`;
        const defaultJava = activeProb.starter_code?.java || `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Write solution for ${activeProb.title}\n        \n    }\n}\n`;

        // If switching language and existing solution has different language, load template for new language
        if (!existingSol || existingSol.language !== newLang) {
            setCodeSolutions(prev => ({
                ...prev,
                [probId]: {
                    code: newLang === 'java' ? defaultJava : defaultPython,
                    language: newLang
                }
            }));
        }
        setCodeOutput(null);
    };

    const handleResetCode = () => {
        if (!codingProblems[currentProblemIndex]) return;
        const activeProb = codingProblems[currentProblemIndex];
        const probId = String(activeProb.id);
        const starter = (selectedLanguage === 'java')
            ? (activeProb.starter_code?.java || `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Write solution for ${activeProb.title}\n        \n    }\n}\n`)
            : (activeProb.starter_code?.python || `# Write your Python solution for ${activeProb.title}\ndef solve():\n    pass\n`);
        
        setCodeSolutions(prev => ({
            ...prev,
            [probId]: {
                code: starter,
                language: selectedLanguage
            }
        }));
        setCodeOutput(null);
    };

    const handleRunCode = async () => {
        if (!codingProblems[currentProblemIndex]) return;
        const activeProb = codingProblems[currentProblemIndex];
        const probId = String(activeProb.id);
        const sol = codeSolutions[probId] || { code: "", language: selectedLanguage };

        setIsRunningCode(true);
        setCodeOutput(null);

        try {
            const res = await rolereadyApi.runCodeTest(sessionUuid, probId, sol.code, sol.language || selectedLanguage);
            setCodeOutput(res);
        } catch (err) {
            console.error("Run code error:", err);
            setCodeOutput({
                all_passed: false,
                test_results: [],
                error: err.response?.data?.detail || "Execution failed in sandboxed container."
            });
        } finally {
            setIsRunningCode(false);
        }
    };

    const handleSubmitCoding = async () => {
        if (isSubmittingCoding) return;
        setIsSubmittingCoding(true);
        const timeSpent = Math.max(1, Math.round((Date.now() - roundStartTime) / 1000));

        try {
            await rolereadyApi.submitCoding(sessionUuid, codeSolutions, timeSpent, violations);

            // Move to the Interview round straight away. Provisioning it (question generation and the
            // voice assistant) can take several seconds, and the interview screen already shows a
            // "connecting" state, so it must not keep the student waiting on the coding submit button.
            setCurrentStage('interview');
            setTimeLeft(ROUND_DURATIONS.interview);
            loadInterview();
            setSessionData(await rolereadyApi.getSessionStatus(sessionUuid));
        } catch (err) {
            console.error("Coding submission error:", err);
            alert(err.response?.data?.detail || "Coding evaluation failed. Please retry.");
        } finally {
            setIsSubmittingCoding(false);
        }
    };

    // ── Auto-scroll Vapi transcript ──────────────────────────────────
    useEffect(() => {
        if (vapiTranscriptScrollRef.current) {
            vapiTranscriptScrollRef.current.scrollTop = vapiTranscriptScrollRef.current.scrollHeight;
        }
    }, [vapiTranscript]);

    // ── Vapi Lifecycle Cleanup ───────────────────────────────────────
    useEffect(() => {
        return () => {
            if (vapiRef.current) {
                try { vapiRef.current.stop(); } catch (e) {}
            }
        };
    }, []);

    const startVapiCall = useCallback((assistantTarget) => {
        if (!VAPI_PUBLIC_KEY) {
            console.warn("[RoleReady Vapi] Missing VAPI_PUBLIC_KEY in environment.");
            setVapiCallStatus('error');
            setVapiConnectionError("VAPI_PUBLIC_KEY is missing in environment variables.");
            return;
        }

        try {
            if (vapiRef.current) {
                try { vapiRef.current.stop(); } catch (e) {}
            }

            const vapi = new Vapi(VAPI_PUBLIC_KEY);
            vapiRef.current = vapi;
            setVapiCallStatus('connecting');
            setVapiSpeakingState('connecting');
            setVapiConnectionError(null);

            vapi.on('call-start', () => {
                setVapiCallStatus('active');
                setVapiSpeakingState('ai_speaking');
                setCurrentSpeaker('ai');
            });

            vapi.on('speech-start', () => {
                setVapiSpeakingState('ai_speaking');
                setCurrentSpeaker('ai');
            });

            vapi.on('speech-end', () => {
                setVapiSpeakingState('listening');
                setCurrentSpeaker(null);
            });

            vapi.on('volume-level', (vol) => {
                setVapiVolume(vol || 0);
            });

            vapi.on('message', (msg) => {
                if (msg.type === 'transcript' && msg.transcriptType === 'final') {
                    const role = (msg.role === 'assistant' || msg.role === 'ai') ? 'ai' : 'user';
                    const newEntry = {
                        id: Date.now() + Math.random(),
                        role,
                        text: msg.transcript,
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    };
                    setVapiTranscript(prev => [...prev, newEntry]);
                    setCurrentSpeaker(role);
                    setTimeout(() => setCurrentSpeaker(null), 2500);

                    // Automatically detect progression across questions
                    if (role === 'ai') {
                        setInterviewQuestions(qs => {
                            const lower = (msg.transcript || "").toLowerCase();
                            qs.forEach((q, idx) => {
                                if (
                                    lower.includes(`question ${idx + 1}`) || 
                                    lower.includes(`question number ${idx + 1}`)
                                ) {
                                    setCurrentInterviewIndex(idx);
                                }
                            });
                            return qs;
                        });
                    }
                }
            });

            vapi.on('call-end', () => {
                setVapiCallStatus('ended');
                setVapiSpeakingState('completed');
                setCurrentSpeaker(null);
            });

            vapi.on('error', (err) => {
                console.error("[RoleReady Vapi Error]:", err);
                setVapiCallStatus('error');
                const errMsg = err?.message || err?.error?.message || (typeof err === 'string' ? err : null);
                setVapiConnectionError(errMsg || "Failed to establish voice session with Vapi.");
                setCurrentSpeaker(null);
            });

            vapi.start(assistantTarget);
        } catch (err) {
            console.error("[RoleReady Vapi Init Error]:", err);
            setVapiCallStatus('error');
            setVapiConnectionError(err.message || "Failed to initialize WebRTC voice call.");
            setCurrentSpeaker(null);
        }
    }, []);

    const toggleVapiMute = () => {
        if (!vapiRef.current) return;
        const nextState = !vapiIsMuted;
        try {
            vapiRef.current.setMuted(nextState);
            setVapiIsMuted(nextState);
        } catch (e) {
            console.warn("Failed to toggle Vapi mute:", e);
        }
    };

    // ── Round 3: Interview Operations ────────────────────────────────
    const loadInterview = async () => {
        setVapiCallStatus('connecting');
        setVapiConnectionError(null);
        try {
            const res = await rolereadyApi.initVapiSession(sessionUuid);
            const manualId = localStorage.getItem('vapi_manual_id');
            const targetId = manualId || res.assistantId || import.meta.env.VITE_VAPI_ASSISTANT_ID;
            const targetConfig = manualId ? null : (res.assistantConfig || null);
            setVapiAssistantId(targetId);
            setVapiAssistantConfig(targetConfig);
            setInterviewQuestions(res.questions || []);
            setRoundStartTime(Date.now());
            if (typeof res.remaining_seconds === 'number') setTimeLeft(res.remaining_seconds);

            // Prefer dynamic assistantConfig object if available so WebRTC call connects directly
            // even across different Vapi org keys without "assistantId does not exist" errors
            const target = targetConfig || targetId;
            if (target && VAPI_PUBLIC_KEY) {
                startVapiCall(target);
            } else if (!target) {
                setVapiCallStatus('error');
                setVapiConnectionError("No dynamic or configured Vapi Assistant ID found. Please paste an assistant ID below or retry.");
            }
        } catch (err) {
            console.error("Failed to load Vapi interview session:", err);
            const targetId = localStorage.getItem('vapi_manual_id') || import.meta.env.VITE_VAPI_ASSISTANT_ID;
            if (targetId) {
                setVapiAssistantId(targetId);
                startVapiCall(targetId);
            } else {
                setVapiCallStatus('error');
                setVapiConnectionError(err.response?.data?.detail || "Could not provision Vapi session from backend.");
            }
            try {
                const fallback = await rolereadyApi.startInterview(sessionUuid);
                setInterviewQuestions(fallback.questions || []);
                setRoundStartTime(Date.now());
                if (typeof fallback.remaining_seconds === 'number') setTimeLeft(fallback.remaining_seconds);
            } catch (fbErr) {
                console.error("Interview fallback error:", fbErr);
            }
        }
    };

    const handleInterviewResponseChange = (qid, text) => {
        setInterviewResponses(prev => ({
            ...prev,
            [String(qid)]: text
        }));
    };

    const segmentInterviewTranscript = (questions = [], transcript = [], typedResponses = {}) => {
        if (!questions || questions.length === 0) return [];

        const buckets = questions.map((q, idx) => ({
            question_id: q.id || idx + 1,
            question_text: q.question,
            category: q.category || "Technical Defense",
            evaluation_criteria: q.evaluation_criteria || "Technical depth, correctness, trade-offs, and practical execution.",
            responses: [],
            follow_ups: [],
            dialogue: [],
            active_follow_up_prompt: null
        }));

        let currentQIdx = 0;
        const numberWordMap = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

        for (const item of (transcript || [])) {
            if (!item || !item.text) continue;
            const text = item.text.trim();
            if (!text) continue;

            if (item.role === 'ai') {
                const lower = text.toLowerCase();
                const qNumMatch = lower.match(/\b(?:question|question\s*number)\s*([1-5])\b/i);
                const ordMatch = lower.match(/\b(first|second|third|fourth|fifth)\s+question\b/i);

                let detectedIdx = null;
                if (qNumMatch && qNumMatch[1]) {
                    detectedIdx = parseInt(qNumMatch[1], 10) - 1;
                } else if (ordMatch && ordMatch[1]) {
                    detectedIdx = (numberWordMap[ordMatch[1].toLowerCase()] || 1) - 1;
                } else if (lower.includes('next question') || lower.includes('moving on to our next') || lower.includes('moving forward to question')) {
                    if (currentQIdx + 1 < buckets.length) {
                        detectedIdx = currentQIdx + 1;
                    }
                }

                if (detectedIdx !== null && detectedIdx >= 0 && detectedIdx < buckets.length) {
                    currentQIdx = detectedIdx;
                    buckets[currentQIdx].dialogue.push(`Interviewer: ${text}`);
                    buckets[currentQIdx].active_follow_up_prompt = null;
                } else {
                    buckets[currentQIdx].dialogue.push(`Interviewer: ${text}`);
                    if (text.includes('?') || lower.includes('could you') || lower.includes('can you') || lower.includes('tell me more') || lower.includes('elaborate')) {
                        buckets[currentQIdx].active_follow_up_prompt = text;
                    }
                }
            } else if (item.role === 'user') {
                buckets[currentQIdx].dialogue.push(`Candidate: ${text}`);
                if (buckets[currentQIdx].active_follow_up_prompt) {
                    buckets[currentQIdx].follow_ups.push({
                        follow_up_question: buckets[currentQIdx].active_follow_up_prompt,
                        response: text
                    });
                    buckets[currentQIdx].active_follow_up_prompt = null;
                } else {
                    buckets[currentQIdx].responses.push(text);
                }
            }
        }

        return buckets.map((b, idx) => {
            const qid = String(b.question_id || idx + 1);
            const typed = (typedResponses[qid] || "").trim();
            const spoken = b.responses.join(' ').trim();
            let primaryResponse = typed || spoken;
            if (!primaryResponse && b.follow_ups.length > 0) {
                primaryResponse = b.follow_ups.map(f => f.response).join(' ');
            }

            return {
                question_id: b.question_id,
                question_text: b.question_text,
                category: b.category,
                evaluation_criteria: b.evaluation_criteria,
                response: primaryResponse,
                follow_ups: b.follow_ups,
                full_dialogue: b.dialogue.join('\n')
            };
        });
    };

    const handleSubmitInterview = async () => {
        if (isSubmittingInterview) return;
        setIsSubmittingInterview(true);
        const timeSpent = Math.max(1, Math.round((Date.now() - roundStartTime) / 1000));

        if (vapiRef.current) {
            try { vapiRef.current.stop(); } catch (e) {}
        }

        try {
            const formattedAnswers = segmentInterviewTranscript(
                interviewQuestions,
                vapiTranscript,
                interviewResponses
            );

            await rolereadyApi.submitInterview(sessionUuid, formattedAnswers, timeSpent, violations, vapiTranscript);
            markStudentTaskCompleted();
            navigate(`/assessment/${sessionUuid}/report`);
        } catch (err) {
            console.error("Interview submission error:", err);
            markStudentTaskCompleted();
            navigate(`/assessment/${sessionUuid}/report`);
        } finally {
            setIsSubmittingInterview(false);
            setShowEndInterviewModal(false);
        }
    };

    // ── Auto-submit handlers ─────────────────────────────────────────
    const handleTimeExpired = () => {
        if (currentStage === 'aptitude') handleSubmitAptitude();
        else if (currentStage === 'coding') handleSubmitCoding();
        else if (currentStage === 'interview') handleSubmitInterview();
    };

    const handleAutoSubmitDueToMalpractice = async (reason, allViolations = violations) => {
        // Instantly shut off media tracks and Vapi call
        if (vapiRef.current) {
            try { vapiRef.current.stop(); } catch (e) {}
        }
        if (cameraStream) {
            try { cameraStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        }

        try {
            // Never let a slow network keep the candidate on the modal: cap the wait at 4s.
            await Promise.race([
                rolereadyApi.terminateSession(sessionUuid, reason, allViolations, currentStage),
                new Promise(resolve => setTimeout(resolve, 4000))
            ]);
        } catch (err) {
            console.error("Fast malpractice termination error:", err);
        } finally {
            markStudentTaskCompleted();
            navigate(`/assessment/${sessionUuid}/report`);
        }
    };

    // ── Handle Start Assessment Action ───────────────────────────────
    const handleStartAssessment = async () => {
        if (!instructionsAccepted || cameraStatus !== 'allowed') return;
        setIsStartingAssessment(true);
        setLaunchError(null);

        try {
            // Step 1: Request and await browser fullscreen entry
            const entered = await enterFullscreen();

            // Step 2: Explicitly verify document.fullscreenElement
            const isFsVerified = (typeof document !== 'undefined' && !!document.fullscreenElement) || entered;
            if (!isFsVerified) {
                setLaunchError("Fullscreen mode could not be verified by your browser. Please ensure fullscreen permissions are allowed and click Retry.");
                setIsStartingAssessment(false);
                return;
            }

            // Step 3: Initialize Aptitude round on server
            await rolereadyApi.startAptitude(sessionUuid);
            const updated = await rolereadyApi.getSessionStatus(sessionUuid);
            setSessionData(updated);

            // Step 4: Advance to Aptitude round workspace
            setCurrentStage('aptitude');
            setTimeLeft(ROUND_DURATIONS.aptitude);
            await loadAptitude();
        } catch (err) {
            console.error("Failed to start assessment:", err);
            setLaunchError(err.response?.data?.detail || err.message || "Could not launch assessment session. Please retry.");
        } finally {
            setIsStartingAssessment(false);
        }
    };

    // ── Loading & Error Displays ─────────────────────────────────────
    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6 gap-3">
                <RefreshCw className="w-9 h-9 text-emerald-600 animate-spin" />
                <p className="text-slate-600 text-sm font-semibold tracking-tight">Initializing PrepWin Proctored Assessment...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Unable to Access Assessment</h2>
                <p className="text-sm mt-1.5 max-w-md text-slate-600 leading-relaxed">{error}</p>
                <button
                    onClick={() => navigate('/assessment/setup')}
                    className="mt-6 px-6 py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all cursor-pointer"
                >
                    Return to Assessment Setup
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans selection:bg-emerald-100 selection:text-emerald-900 select-none">
            {/* Fullscreen Gate & Exit Recovery Modal */}
            <FullscreenGateModal
                isOpen={isRecoveryOpen || (isGateOpen && currentStage !== 'instructions' && currentStage !== 'device_check')}
                mode={isRecoveryOpen ? 'recovery' : 'entry'}
                onAction={isRecoveryOpen ? returnToFullscreen : enterFullscreen}
                timeLeft={recoveryTimeLeft}
                error={fullscreenError}
                title={isRecoveryOpen ? "Fullscreen Required — Integrity Alert" : "PrepWin Secure Assessment Gate"}
                description={
                    isRecoveryOpen
                        ? "You have exited fullscreen mode. Please return within the countdown window to avoid a malpractice violation."
                        : "This assessment must be taken in fullscreen mode with background proctoring active."
                }
            />

            {/* Terminal Malpractice Modal (3rd Strike Consequence) */}
            {showTerminalModal && (
                <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
                    <div className="max-w-md w-full bg-white rounded-2xl border-2 border-red-500 shadow-2xl p-6 sm:p-8 text-center space-y-4 animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto ring-8 ring-red-50">
                            <XCircle className="w-10 h-10" />
                        </div>
                        <h2 className="text-xl font-extrabold text-slate-900">Assessment Terminated</h2>
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium leading-relaxed">
                            Maximum violations reached: <strong>3/3 Strikes</strong> ({terminalReason}).
                            Your assessment has been terminated and your scores forfeited. No evaluation will be run.
                        </div>
                        <div className="flex items-center justify-center gap-2 text-xs font-mono text-slate-500">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Redirecting...
                        </div>
                    </div>
                </div>
            )}
            {/* =========================================================== */}
            {/* COMPACT TOP BAR: BRAND, STEPPER, TIMER & PROCTOR STATUS */}
            {/* =========================================================== */}
            <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3 flex-shrink-0 z-30 shadow-xs">
                <div className="w-full max-w-[1700px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
                    {/* Left: PrepWin Brand & Target Position */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-extrabold text-slate-900 tracking-tight">PrepWin</span>
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold uppercase tracking-wider flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-600" /> Proctored
                            </span>
                        </div>
                        <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />
                        <p className="text-xs text-slate-600 truncate max-w-xs sm:max-w-md">
                            Role: <strong className="text-slate-900">{sessionData?.target_role}</strong> {sessionData?.target_company && `• ${sessionData.target_company}`}
                        </p>
                    </div>

                    {/* Center: Sequential Round Stepper */}
                    <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl border border-slate-200 overflow-x-auto">
                        {/* Step 1: Instructions */}
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            currentStage === 'instructions'
                                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                                : 'text-slate-600'
                        }`}>
                            <Award className="w-3.5 h-3.5 text-emerald-600" />
                            <span>1. Instructions</span>
                            {currentStage !== 'instructions' && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 2: Device Check */}
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            currentStage === 'device_check'
                                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                                : currentStage === 'instructions'
                                    ? 'text-slate-400'
                                    : 'text-slate-600'
                        }`}>
                            <Video className="w-3.5 h-3.5 text-emerald-600" />
                            <span>2. Device Check</span>
                            {currentStage !== 'instructions' && currentStage !== 'device_check' && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 3: Aptitude */}
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            currentStage === 'aptitude'
                                ? 'bg-white text-emerald-700 shadow-xs border border-slate-200'
                                : sessionData?.coding_unlocked
                                    ? 'text-slate-700'
                                    : 'text-slate-400'
                        }`}>
                            <BrainCircuit className={`w-3.5 h-3.5 ${currentStage === 'aptitude' ? 'text-emerald-600' : ''}`} />
                            <span>3. Aptitude</span>
                            {sessionData?.coding_unlocked && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 4: Coding */}
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            currentStage === 'coding'
                                ? 'bg-white text-cyan-700 shadow-xs border border-slate-200'
                                : sessionData?.coding_unlocked
                                    ? 'text-slate-700'
                                    : 'text-slate-400'
                        }`}>
                            <Code2 className={`w-3.5 h-3.5 ${currentStage === 'coding' ? 'text-cyan-600' : ''}`} />
                            <span>4. Coding</span>
                            {!sessionData?.coding_unlocked && <Lock className="w-3 h-3 text-slate-400" />}
                            {sessionData?.interview_unlocked && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 5: Interview */}
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            currentStage === 'interview'
                                ? 'bg-white text-amber-700 shadow-xs border border-slate-200'
                                : sessionData?.interview_unlocked
                                    ? 'text-slate-700'
                                    : 'text-slate-400'
                        }`}>
                            <MessageSquare className={`w-3.5 h-3.5 ${currentStage === 'interview' ? 'text-amber-600' : ''}`} />
                            <span>5. Interview</span>
                            {!sessionData?.interview_unlocked && <Lock className="w-3 h-3 text-slate-400" />}
                        </div>
                    </div>

                    {/* Right: Round Countdown Timer & Warnings Pill */}
                    <div className="flex items-center gap-3">
                        {currentStage !== 'instructions' && currentStage !== 'device_check' && (
                            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold border transition-all ${
                                timeLeft <= 120 
                                    ? 'bg-red-50 text-red-700 border-red-300 animate-pulse' 
                                    : 'bg-slate-50 text-slate-800 border-slate-200'
                            }`}>
                                <Clock className={`w-3.5 h-3.5 ${timeLeft <= 120 ? 'text-red-600' : 'text-emerald-600'}`} />
                                <span>{formatTimer(timeLeft)}</span>
                            </div>
                        )}

                        {/* Malpractice Strike Pill */}
                        {currentStage !== 'instructions' && currentStage !== 'device_check' && (
                            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold border ${
                                violationCount === 0 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : violationCount === 1 
                                        ? 'bg-amber-50 text-amber-800 border-amber-300 animate-bounce' 
                                        : 'bg-red-50 text-red-700 border-red-300 animate-pulse'
                            }`}>
                                <Shield className="w-3.5 h-3.5" />
                                <span>Warnings: {violationCount}/{MAX_MALPRACTICE_WARNINGS}</span>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Malpractice Warning Banner (Non-Blocking Alert) */}
            {warningBanner && currentStage !== 'instructions' && currentStage !== 'device_check' && (
                <div className={`w-full px-4 sm:px-8 py-2.5 border-b text-xs font-semibold flex items-center justify-between transition-all ${
                    warningBanner.level === 'terminal' 
                        ? 'bg-red-600 text-white border-red-700' 
                        : warningBanner.level === 'critical' 
                            ? 'bg-orange-500 text-white border-orange-600 shadow-md' 
                            : 'bg-amber-50 text-amber-900 border-amber-300'
                }`}>
                    <div className="w-full max-w-[1700px] mx-auto flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{warningBanner.message}</span>
                    </div>
                </div>
            )}

            {/* =========================================================== */}
            {/* MAIN WORKSPACE: FULL VIEWPORT (~85-95% WIDTH) */}
            {/* =========================================================== */}
            <main className="flex-1 w-full max-w-[1700px] mx-auto p-4 sm:p-6 lg:p-8 overflow-y-auto">
                {/* --------------------------------------------------------- */}
                {/* STAGE 1: ASSESSMENT INSTRUCTIONS */}
                {/* --------------------------------------------------------- */}
                {currentStage === 'instructions' && (
                    <div className="max-w-5xl mx-auto space-y-6">
                        {/* Header Banner Card */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-slate-100">
                                <div>
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold mb-2">
                                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Assessment Overview & Rules
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                        PrepWin Assessment Instructions
                                    </h1>
                                    <p className="text-sm text-slate-600 mt-1">
                                        Target Position: <strong className="text-slate-900">{sessionData?.target_role}</strong> {sessionData?.target_company && `at ${sessionData.target_company}`}
                                    </p>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 px-5 py-2.5 rounded-xl text-center">
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Evaluation Flow</span>
                                    <p className="text-sm font-extrabold text-emerald-700 mt-0.5">3 Sequential Rounds</p>
                                </div>
                            </div>

                            {/* 3-Round Timeline Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 hover:border-emerald-300 transition-all space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Round 1</span>
                                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold">15 Mins</span>
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                        <BrainCircuit className="w-4 h-4 text-emerald-600" /> Aptitude & Reasoning
                                    </h3>
                                    <p className="text-xs text-slate-600 leading-relaxed">
                                        Role-tailored domain logic, psychometrics, and quantitative problem solving questions.
                                    </p>
                                </div>

                                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 hover:border-cyan-300 transition-all space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-cyan-700 uppercase tracking-wider">Round 2</span>
                                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-800 font-mono font-bold">30 Mins</span>
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                        <Code2 className="w-4 h-4 text-cyan-600" /> Sandboxed Coding
                                    </h3>
                                    <p className="text-xs text-slate-600 leading-relaxed">
                                        Real coding problems executed in an isolated runtime container against public and hidden test cases.
                                    </p>
                                </div>

                                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 hover:border-amber-300 transition-all space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Round 3</span>
                                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono font-bold">15 Mins</span>
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4 text-amber-600" /> Technical Interview
                                    </h3>
                                    <p className="text-xs text-slate-600 leading-relaxed">
                                        Conversational voice / defense questions synthesized directly from your JD and resume background.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Assessment Rules & Guidelines Card */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-amber-600" />
                                Rules & 3-Warning Integrity Policy
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0 text-xs">1</div>
                                        <h4 className="text-xs font-bold text-slate-900">Strict Fullscreen Enforcement</h4>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed pl-8">
                                        The assessment must be taken in uninterrupted fullscreen mode. Exiting fullscreen triggers a 10-second recovery gate before logging a malpractice violation.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">2</div>
                                        <h4 className="text-xs font-bold text-slate-900">3-Warning Malpractice Policy</h4>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed pl-8">
                                        Tab switches, window defocus, loss of candidate presence, or external devices are recorded as strikes. On the 3rd strike, your assessment is immediately terminated and auto-submitted.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-cyan-100 text-cyan-800 font-bold flex items-center justify-center shrink-0 text-xs">3</div>
                                        <h4 className="text-xs font-bold text-slate-900">Sequential Round Unlocking</h4>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed pl-8">
                                        You must complete and submit each round in sequence (Aptitude → Coding → Interview). Completed rounds are permanently sealed on the server and cannot be retaken.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-800 font-bold flex items-center justify-center shrink-0 text-xs">4</div>
                                        <h4 className="text-xs font-bold text-slate-900">Device & Hardware Readiness</h4>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed pl-8">
                                        A functional webcam and microphone are required for AI vision proctoring and technical defense. You will verify your devices on the next step.
                                    </p>
                                </div>
                            </div>

                            {/* Bottom CTA to Step 2 */}
                            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="text-xs text-slate-500 text-center sm:text-left">
                                    Step 1 of 2 Before Launch • No questions or camera feeds active on this page.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCurrentStage('device_check');
                                        initHardware();
                                    }}
                                    className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-700/20 hover:scale-[1.01] transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>Continue to Device Check</span>
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* --------------------------------------------------------- */}
                {/* STAGE 2: HARDWARE & PROCTORING DEVICE CHECK */}
                {/* --------------------------------------------------------- */}
                {currentStage === 'device_check' && (
                    <div className="max-w-6xl mx-auto space-y-6">
                        {/* Header Banner */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold mb-1.5">
                                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Device & Model Pre-Flight Check
                                </div>
                                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                                    Hardware & Proctoring Verification
                                </h1>
                                <p className="text-xs text-slate-600 mt-1">
                                    Target Position: <strong className="text-slate-900">{sessionData?.target_role}</strong> • Please verify your webcam, microphone, and AI model status.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={initHardware}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Re-test Devices
                            </button>
                        </div>

                        {/* 2-Column Responsive Layout: Left Hardware Live Stream + Right Launch Gate */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            {/* Left: Hardware Verification & Live Video Preview (6 Cols) */}
                            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
                                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                        <Video className="w-5 h-5 text-emerald-600" />
                                        Webcam & Microphone Verification
                                    </h3>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                        cameraStatus === 'allowed' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                                    }`}>
                                        {cameraStatus === 'allowed' ? 'Feed Operational' : 'Action Required'}
                                    </span>
                                </div>

                                {/* Live Video Preview Window */}
                                <div className="relative aspect-video rounded-xl bg-slate-950 overflow-hidden border border-slate-200 flex items-center justify-center shadow-inner">
                                    <video
                                        ref={setPreviewVideoElement}
                                        autoPlay
                                        playsInline
                                        muted
                                        onLoadedMetadata={(e) => {
                                            e.target.play().catch((err) => console.warn("Video play error on loadedmetadata:", err));
                                        }}
                                        className={`w-full h-full object-cover transform -scale-x-100 ${cameraStatus === 'allowed' ? 'block' : 'hidden'}`}
                                    />

                                    {cameraStatus === 'checking' && (
                                        <div className="text-center p-6 space-y-2 text-slate-300">
                                            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
                                            <p className="text-xs font-medium">Requesting camera & microphone access...</p>
                                        </div>
                                    )}

                                    {cameraStatus === 'denied' && (
                                        <div className="text-center p-6 space-y-2.5 text-red-400">
                                            <CameraOff className="w-10 h-10 mx-auto text-red-400 animate-bounce" />
                                            <p className="text-sm font-bold text-white">Camera Permission Blocked</p>
                                            <p className="text-xs text-slate-300 max-w-sm">
                                                Please click the lock icon in your browser address bar and set Camera to <strong>Allow</strong>, then click Re-test Devices.
                                            </p>
                                        </div>
                                    )}

                                    {cameraStatus === 'unavailable' && (
                                        <div className="text-center p-6 space-y-2.5 text-amber-400">
                                            <CameraOff className="w-10 h-10 mx-auto text-amber-400" />
                                            <p className="text-sm font-bold text-white">No Camera Device Detected</p>
                                            <p className="text-xs text-slate-300 max-w-sm">
                                                Please connect a functional webcam to proceed with proctoring requirements.
                                            </p>
                                        </div>
                                    )}

                                    {cameraStatus === 'allowed' && (
                                        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-slate-950/70 backdrop-blur-md px-3 py-1 rounded-lg text-xs text-emerald-400 font-bold">
                                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                            <span>Live Camera Feed Verified</span>
                                        </div>
                                    )}
                                </div>

                                {/* Status indicators */}
                                <div className="space-y-2.5 text-xs">
                                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Camera className="w-4 h-4 text-slate-500" /> Web Camera Feed
                                        </span>
                                        <span className={`font-bold ${cameraStatus === 'allowed' ? 'text-emerald-700' : cameraStatus === 'denied' ? 'text-red-700' : 'text-amber-700'}`}>
                                            {cameraStatus === 'allowed' ? 'Connected & Verified ✅' : cameraStatus === 'denied' ? 'Permission Denied ❌' : 'Checking...'}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Mic className="w-4 h-4 text-slate-500" /> Microphone
                                        </span>
                                        <span className={`font-bold ${micStatus === 'allowed' ? 'text-emerald-700' : micStatus === 'denied' ? 'text-red-700' : 'text-slate-500'}`}>
                                            {micStatus === 'allowed' ? 'Ready for Interview ✅' : micStatus === 'denied' ? 'Permission Denied' : 'Optional / Text Fallback'}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-slate-500" /> AI Vision Engine (YOLOv8n)
                                        </span>
                                        <span className={`font-bold ${modelStatus === 'ready' ? 'text-emerald-700' : modelStatus === 'error' ? 'text-amber-700' : 'text-slate-500'}`}>
                                            {modelStatus === 'ready' ? 'Online & Validated (CPU) 🛡️' : modelStatus === 'error' ? 'Offline (Fallback Mode)' : 'Checking Model...'}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Maximize className="w-4 h-4 text-slate-500" /> Fullscreen Mode
                                        </span>
                                        <span className="font-bold text-emerald-700">Enforced on Launch 🛡️</span>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Fullscreen Confirmation & Launch Gate (6 Cols) */}
                            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6 flex flex-col justify-between">
                                <div className="space-y-4">
                                    <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
                                        <Maximize className="w-5 h-5 text-emerald-600" />
                                        Fullscreen Confirmation & Launch
                                    </h3>

                                    <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-slate-700 leading-relaxed space-y-2">
                                        <strong className="text-emerald-900 block font-bold">Fullscreen Proctoring Environment:</strong>
                                        <p>
                                            When you click <strong>Start Assessment & Enter Fullscreen</strong>, your browser will switch to locked fullscreen mode.
                                        </p>
                                        <p>
                                            Any attempt to exit fullscreen, switch tabs, or use external monitors will trigger an integrity warning. A 10-second countdown recovery window is provided for accidental exits.
                                        </p>
                                    </div>

                                    {/* Actionable Error Alert if Fullscreen Entry or Session Launch Fails */}
                                    {launchError && (
                                        <div className="p-4 rounded-xl bg-red-50 border-2 border-red-300 text-xs text-red-800 space-y-2 animate-in fade-in duration-200">
                                            <div className="flex items-center gap-2 font-bold text-red-900">
                                                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                                                <span>Launch Authorization Failed</span>
                                            </div>
                                            <p className="leading-relaxed">{launchError}</p>
                                            <button
                                                type="button"
                                                onClick={handleStartAssessment}
                                                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer mt-1"
                                            >
                                                <RotateCcw className="w-3.5 h-3.5" /> Retry Fullscreen & Launch
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Acceptance Checkbox & Launch Actions */}
                                <div className="space-y-4 pt-4 border-t border-slate-100">
                                    <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100/70 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={instructionsAccepted}
                                            onChange={(e) => setInstructionsAccepted(e.target.checked)}
                                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                        />
                                        <span className="text-xs text-slate-800 font-semibold leading-relaxed">
                                            I have read, understood, and accept the assessment instructions, hardware requirements, and proctoring integrity policy.
                                        </span>
                                    </label>

                                    <div className="flex flex-col sm:flex-row items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentStage('instructions')}
                                            className="w-full sm:w-auto px-4 py-3.5 rounded-xl font-bold text-xs border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
                                        >
                                            Back to Instructions
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!instructionsAccepted || isStartingAssessment || cameraStatus !== 'allowed'}
                                            onClick={handleStartAssessment}
                                            className={`flex-1 w-full py-3.5 px-6 rounded-xl font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                                instructionsAccepted && cameraStatus === 'allowed'
                                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-700/20 hover:scale-[1.005]'
                                                    : 'bg-slate-200 text-slate-400 border border-slate-200 cursor-not-allowed'
                                            }`}
                                        >
                                            {isStartingAssessment ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    <span>Entering Fullscreen Assessment...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span>Start Assessment & Enter Fullscreen</span>
                                                    <ArrowRight className="w-4 h-4" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* --------------------------------------------------------- */}
                {/* STAGE 3: ROUND 1 — APTITUDE & REASONING (2-COL WORKSPACE) */}
                {/* --------------------------------------------------------- */}
                {currentStage === 'aptitude' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* ── Main Area (~75% / 9 Cols): Question, Options, Controls ── */}
                        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                            {/* Question Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <BrainCircuit className="w-5 h-5 text-emerald-600" />
                                        Round 1: Role-Specific Aptitude & Reasoning
                                    </h2>
                                    <p className="text-xs text-slate-500">Answer all questions to unlock the Sandboxed Coding Round.</p>
                                </div>
                                <div className="text-xs font-mono font-bold px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 self-start sm:self-auto">
                                    Question {currentAptIndex + 1} of {aptitudeQuestions.length}
                                </div>
                            </div>

                            {/* Question Body */}
                            {aptitudeQuestions.length > 0 ? (
                                (() => {
                                    const activeQ = aptitudeQuestions[currentAptIndex];
                                    const selected = aptitudeAnswers[String(activeQ.id)];
                                    return (
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 text-xs text-emerald-800 font-bold">
                                                <span>Category:</span>
                                                <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 font-mono">
                                                    {activeQ.topic || "Domain Logic"}
                                                </span>
                                            </div>

                                            <h3 className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed">
                                                {activeQ.question}
                                            </h3>

                                            {/* Answer Choices (A, B, C, D) */}
                                            <div className="space-y-3 pt-2">
                                                {(activeQ.options || []).map((opt) => {
                                                    const isSelected = selected === opt.key;
                                                    return (
                                                        <button
                                                            key={opt.key}
                                                            type="button"
                                                            onClick={() => handleSelectOption(activeQ.id, opt.key)}
                                                            className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-4 cursor-pointer ${
                                                                isSelected
                                                                    ? 'bg-emerald-50/70 border-emerald-600 text-slate-900 shadow-sm font-semibold'
                                                                    : 'bg-slate-50/60 border-slate-200 hover:border-emerald-300 hover:bg-slate-50 text-slate-700'
                                                            }`}
                                                        >
                                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                                                                isSelected 
                                                                    ? 'bg-emerald-600 text-white shadow-xs' 
                                                                    : 'bg-white text-slate-600 border border-slate-200'
                                                            }`}>
                                                                {opt.key}
                                                            </div>
                                                            <span className="text-sm leading-relaxed">{opt.text}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Bottom Navigation & Submit Actions */}
                                            <div className="flex items-center justify-between pt-6 border-t border-slate-100 mt-6">
                                                <button
                                                    type="button"
                                                    disabled={currentAptIndex === 0}
                                                    onClick={() => setCurrentAptIndex(prev => prev - 1)}
                                                    className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                                >
                                                    Previous Question
                                                </button>

                                                <div className="flex items-center gap-3">
                                                    {currentAptIndex < aptitudeQuestions.length - 1 ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentAptIndex(prev => prev + 1)}
                                                            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1.5 cursor-pointer"
                                                        >
                                                            <span>Next Question</span>
                                                            <ChevronRight className="w-3.5 h-3.5" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={isSubmittingApt}
                                                            onClick={handleSubmitAptitude}
                                                            className="px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md cursor-pointer"
                                                        >
                                                            {isSubmittingApt ? "Evaluating Responses..." : "Submit Aptitude & Unlock Coding Round"}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()
                            ) : (
                                <div className="p-12 text-center text-slate-500">
                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                                    <p>Loading aptitude questions...</p>
                                </div>
                            )}
                        </div>

                        {/* ── Side Panel (~25% / 3 Cols): Proctoring, Warnings & Navigator ── */}
                        <div className="lg:col-span-3 space-y-4">
                            {/* Live Proctoring Webcam Feed */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        <Camera className="w-3.5 h-3.5 text-emerald-600" /> AI Proctor Feed
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE
                                    </span>
                                </div>

                                <ProctorCameraFeed
                                    stream={cameraStream || proctorStream}
                                    detections={detections}
                                    faceBoxes={faceBoxes}
                                    personCount={personCount}
                                    suspectLabel={suspectLabel}
                                    isModelActive={isModelActive}
                                    detectionStatus={detectionStatus}
                                    violationCount={violationCount}
                                    className="w-full"
                                />

                                <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium pt-1">
                                    <span>Stream Status</span>
                                    <span className="text-emerald-700 font-bold">Verified Active</span>
                                </div>
                            </div>

                            {/* Malpractice Integrity Monitor */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600" /> Integrity Monitor
                                    </span>
                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                                        violationCount === 0 
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                            : violationCount === 1 
                                                ? 'bg-amber-50 text-amber-800 border-amber-300' 
                                                : 'bg-red-50 text-red-800 border-red-300'
                                    }`}>
                                        {violationCount}/3 Strikes
                                    </span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div 
                                        className={`h-full transition-all duration-300 ${
                                            violationCount === 0 
                                                ? 'w-0' 
                                                : violationCount === 1 
                                                    ? 'w-1/3 bg-amber-500' 
                                                    : violationCount === 2 
                                                        ? 'w-2/3 bg-orange-500' 
                                                        : 'w-full bg-red-600'
                                        }`} 
                                    />
                                </div>
                                <p className="text-[11px] text-slate-500 leading-tight">
                                    {violationCount === 0 && "No violations detected. Session running in good standing."}
                                    {violationCount === 1 && "Warning 1 recorded. Please do not switch tabs or minimize window."}
                                    {violationCount === 2 && "Final warning! 1 more strike will automatically submit your test."}
                                    {violationCount >= 3 && "Maximum strikes exceeded. Assessment terminated."}
                                </p>
                            </div>

                            {/* Question Palette Widget */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                    <span className="text-xs font-bold text-slate-900">Question Palette</span>
                                    <span className="text-[11px] text-slate-500 font-mono">
                                        {Object.keys(aptitudeAnswers).length} / {aptitudeQuestions.length} Answered
                                    </span>
                                </div>

                                <div className="grid grid-cols-5 gap-2">
                                    {aptitudeQuestions.map((q, idx) => {
                                        const isAnswered = !!aptitudeAnswers[String(q.id)];
                                        const isCurrent = currentAptIndex === idx;
                                        return (
                                            <button
                                                key={q.id}
                                                type="button"
                                                onClick={() => setCurrentAptIndex(idx)}
                                                className={`h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                    isCurrent
                                                        ? 'bg-white border-2 border-blue-600 text-blue-700 shadow-sm'
                                                        : isAnswered
                                                            ? 'bg-emerald-600 text-white font-bold'
                                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                {idx + 1}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] text-slate-500 font-medium">
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded bg-emerald-600" /> Answered
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded border border-blue-600 bg-white" /> Current
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded bg-slate-200" /> Pending
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ───────────────────────────────────────────────────────── */}
                {/* STAGE 3: ROUND 2 — SANDBOXED CODING (SPLIT WORKSPACE) */}
                {/* ───────────────────────────────────────────────────────── */}
                {currentStage === 'coding' && (
                    <div className="space-y-4 flex flex-col min-h-0">
                        {!sessionData?.coding_unlocked ? (
                            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm max-w-xl mx-auto my-auto space-y-3">
                                <Lock className="w-12 h-12 text-slate-400 mx-auto" />
                                <h3 className="text-lg font-bold text-slate-900">Coding Round is Locked</h3>
                                <p className="text-xs text-slate-600">Complete and submit the Aptitude Round to unlock this challenge.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Coding Sub-Header Bar: Problem Selector, Lang Dropdown, Compact Proctor Stream & Submit */}
                                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                            <Code2 className="w-5 h-5 text-cyan-600" />
                                            Round 2: Practical Coding
                                        </h2>

                                        {/* Problem Switcher Tabs */}
                                        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                                            {codingProblems.map((prob, idx) => (
                                                <button
                                                    key={prob.id}
                                                    type="button"
                                                    onClick={() => { setCurrentProblemIndex(idx); setCodeOutput(null); }}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                        currentProblemIndex === idx
                                                            ? 'bg-white text-cyan-700 shadow-xs border border-slate-200'
                                                            : 'text-slate-600 hover:text-slate-900'
                                                    }`}
                                                >
                                                    Problem {idx + 1}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Language Selector (Python and Java) */}
                                        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                                            <button
                                                type="button"
                                                onClick={() => handleLanguageChange('python')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                                    selectedLanguage === 'python'
                                                        ? 'bg-white text-cyan-800 shadow-xs border border-slate-200'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                <span>🐍</span>
                                                <span>Python 3.11</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleLanguageChange('java')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                                    selectedLanguage === 'java'
                                                        ? 'bg-white text-cyan-800 shadow-xs border border-slate-200'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                <span>☕</span>
                                                <span>Java 17 (OpenJDK)</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Right: Responsive Proctor Stream + Submit Coding (Visible on mobile & desktop) */}
                                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                                        <div className="w-40 sm:w-48 shrink-0">
                                            <ProctorCameraFeed
                                                stream={cameraStream || proctorStream}
                                                detections={detections}
                                                faceBoxes={faceBoxes}
                                                personCount={personCount}
                                                suspectLabel={suspectLabel}
                                                isModelActive={isModelActive}
                                                detectionStatus={detectionStatus}
                                                violationCount={violationCount}
                                                compact={true}
                                            />
                                        </div>

                                        <button
                                            type="button"
                                            disabled={isSubmittingCoding}
                                            onClick={handleSubmitCoding}
                                            className="px-5 py-2.5 rounded-xl font-bold text-xs bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm transition-all cursor-pointer shrink-0"
                                        >
                                            {isSubmittingCoding ? "Evaluating Tests..." : "Submit All & Unlock Interview"}
                                        </button>
                                    </div>
                                </div>

                                {codingProblems.length > 0 && (() => {
                                    const activeProblem = codingProblems[currentProblemIndex] || codingProblems[0];
                                    const probId = String(activeProblem.id);
                                    const curSol = codeSolutions[probId] || { 
                                        code: (selectedLanguage === 'java' ? activeProblem.starter_code?.java : activeProblem.starter_code?.python) || "", 
                                        language: selectedLanguage 
                                    };

                                    return (
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                            {/* Left Pane (~45% / 5 Cols): Problem Statement, Constraints, Public Tests */}
                                            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 max-h-[700px] overflow-y-auto">
                                                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                                    <h3 className="text-base font-bold text-slate-900">{activeProblem.title}</h3>
                                                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-md border ${
                                                        activeProblem.difficulty === 'Easy' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                                        activeProblem.difficulty === 'Medium' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                                        'bg-red-50 text-red-800 border-red-200'
                                                    }`}>
                                                        {activeProblem.difficulty}
                                                    </span>
                                                </div>

                                                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                                                    {activeProblem.description}
                                                </p>

                                                <div className="space-y-2.5 text-xs pt-1">
                                                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                                                        <span className="font-bold text-slate-800 block mb-1">Constraints:</span>
                                                        <span className="font-mono text-slate-700">{activeProblem.constraints}</span>
                                                    </div>

                                                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                                                        <span className="font-bold text-slate-800 block mb-1">Input Format:</span>
                                                        <span className="text-slate-700">{activeProblem.input_format}</span>
                                                    </div>

                                                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                                                        <span className="font-bold text-slate-800 block mb-1">Output Format:</span>
                                                        <span className="text-slate-700">{activeProblem.output_format}</span>
                                                    </div>
                                                </div>

                                                {/* Public Test Cases */}
                                                <div className="pt-2">
                                                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Public Test Cases:</h4>
                                                    {(activeProblem.public_test_cases || []).map((t, idx) => (
                                                        <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs font-mono space-y-1 mb-2">
                                                            <div><span className="text-slate-500">Input:</span> <span className="text-slate-900">{t.input}</span></div>
                                                            <div><span className="text-emerald-700 font-bold">Expected:</span> <span className="text-slate-900">{t.expected_output}</span></div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Right Pane (~55% / 7 Cols): Monaco Editor & Output Terminal */}
                                            <div className="lg:col-span-7 space-y-4">
                                                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col">
                                                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                                                {selectedLanguage === 'java' ? 'Main.java' : 'solution.py'}
                                                            </span>
                                                            <span className="text-[11px] text-slate-400 font-medium">
                                                                {selectedLanguage === 'java' ? 'Java OpenJDK 17' : 'Python 3.11'}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={handleResetCode}
                                                            className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                                                        >
                                                            <RotateCcw className="w-3.5 h-3.5" /> Reset Template
                                                        </button>
                                                    </div>

                                                    {/* Monaco Editor Component */}
                                                    <div className="w-full h-[380px] rounded-xl overflow-hidden border border-slate-200">
                                                        <Editor
                                                            height="100%"
                                                            language={selectedLanguage === 'java' ? 'java' : 'python'}
                                                            theme="vs-dark"
                                                            value={curSol.code}
                                                            onChange={(val) => handleCodeChange(probId, val || "")}
                                                            options={{
                                                                minimap: { enabled: false },
                                                                fontSize: 13,
                                                                lineNumbers: 'on',
                                                                scrollBeyondLastLine: false,
                                                                automaticLayout: true,
                                                                tabSize: 4
                                                            }}
                                                        />
                                                    </div>

                                                    {/* Run Tests Action */}
                                                    <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                                                        <span className="text-xs text-slate-500 font-medium">
                                                            Isolated Sandboxed Runtime ({selectedLanguage === 'java' ? 'Judge0 Java' : 'Judge0 Python'})
                                                        </span>
                                                        <button
                                                            type="button"
                                                            disabled={isRunningCode}
                                                            onClick={handleRunCode}
                                                            className="px-5 py-2.5 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 text-xs font-bold flex items-center gap-2 border border-cyan-200 cursor-pointer disabled:opacity-50 transition-all shadow-xs"
                                                        >
                                                            <Play className="w-3.5 h-3.5 text-cyan-600" />
                                                            <span>{isRunningCode ? "Executing Sandbox..." : "Run Public Tests"}</span>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Output Terminal */}
                                                {codeOutput && (
                                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 font-mono text-xs text-slate-200 space-y-2.5 shadow-sm max-h-56 overflow-y-auto">
                                                        <div className="flex items-center gap-2 text-slate-400 pb-2 border-b border-slate-800">
                                                            <Terminal className="w-4 h-4 text-cyan-400" />
                                                            <span className="text-slate-300 font-bold">Execution Output</span>
                                                            <span className={`ml-auto font-bold px-2 py-0.5 rounded text-[11px] ${
                                                                codeOutput.all_passed 
                                                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                                                                    : (codeOutput.error_type === 'Compilation Error'
                                                                        ? 'bg-amber-950 text-amber-300 border border-amber-700'
                                                                        : 'bg-red-950 text-red-400 border border-red-800')
                                                            }`}>
                                                                {codeOutput.error_type 
                                                                    ? codeOutput.error_type.toUpperCase() 
                                                                    : (codeOutput.all_passed ? "PASS (All Public Cases)" : "FAIL / OUTPUT MISMATCH")}
                                                            </span>
                                                        </div>

                                                        {/* Prominent Compilation / Runtime Error Banner */}
                                                        {codeOutput.error_type && (
                                                            <div className={`p-2.5 rounded-xl border text-xs font-sans ${
                                                                codeOutput.error_type === 'Compilation Error'
                                                                    ? 'bg-amber-950/60 border-amber-700/60 text-amber-200'
                                                                    : 'bg-red-950/60 border-red-700/60 text-red-200'
                                                            }`}>
                                                                <strong className="block mb-1">{codeOutput.error_type}:</strong>
                                                                <pre className="font-mono text-[11px] whitespace-pre-wrap">{codeOutput.stderr || codeOutput.error || "Execution terminated with errors."}</pre>
                                                            </div>
                                                        )}

                                                        {(codeOutput.test_results || []).map((tr, idx) => (
                                                            <div key={idx} className="space-y-1 pt-1 text-xs">
                                                                <div className="text-slate-400">Input: {tr.input}</div>
                                                                <div className="text-slate-300">Expected: {tr.expected_output}</div>
                                                                <div className={tr.passed ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                                                                    Actual: {tr.actual_output || "<no output>"}
                                                                </div>
                                                                {tr.error && !codeOutput.error_type && <div className="text-red-400 font-medium">{tr.error}</div>}
                                                            </div>
                                                        ))}
                                                        {codeOutput.error && !codeOutput.error_type && (
                                                            <div className="text-red-400 pt-1 font-medium">{codeOutput.error}</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )}

                {/* ───────────────────────────────────────────────────────── */}
                {/* STAGE 4: ROUND 3 — CONVERSATIONAL TECHNICAL INTERVIEW */}
                {/* ───────────────────────────────────────────────────────── */}
                {currentStage === 'interview' && (
                    <div className="w-full">
                        {!sessionData?.interview_unlocked ? (
                            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm max-w-xl mx-auto my-auto space-y-3">
                                <Lock className="w-12 h-12 text-slate-400 mx-auto" />
                                <h3 className="text-lg font-bold text-slate-900">Technical Interview is Locked</h3>
                                <p className="text-xs text-slate-600">Complete and submit the Coding Round to unlock the final interview stage.</p>
                            </div>
                        ) : (
                            /* EXACT VAPI ASSISTANT VIDEO INTERVIEW INTERFACE (IMAGE 2) */
                            <div className="bg-[#0a0a0a] text-white rounded-2xl overflow-hidden border border-gray-800 shadow-2xl flex flex-col relative min-h-[640px]">
                                {/* Top Bar */}
                                <div className="bg-black/50 backdrop-blur-sm px-6 py-3.5 flex items-center justify-between border-b border-gray-800 shrink-0">
                                    <div className="flex items-center gap-3">
                                        <h1 className="text-sm font-medium text-gray-300">AI Video Interview</h1>
                                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                                            Round 3
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-sm text-gray-400">
                                            Time: <span className="font-mono text-white text-lg font-bold">{formatTimer(timeLeft)}</span>
                                        </div>
                                        {currentSpeaker && (
                                            <div className={`text-xs px-2.5 py-1 rounded font-semibold ${
                                                currentSpeaker === 'ai' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                                            }`}>
                                                {currentSpeaker === 'ai' ? 'AI Speaking' : 'You Speaking'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Main 2-Panel Layout with AI Avatar & Live Transcript */}
                                <div className="flex-1 flex flex-col md:flex-row min-h-[480px]">
                                    {/* LEFT PANEL - AI Interviewer (Image 2) */}
                                    <div className="bg-[#1a1a1a] relative flex-1 flex items-center justify-center p-8 min-h-[380px]">
                                        {/* AI Avatar */}
                                        <div className="relative">
                                            <motion.div
                                                className={`w-64 h-64 rounded-full flex items-center justify-center ${
                                                    currentSpeaker === 'ai'
                                                        ? 'bg-gradient-to-br from-blue-600 to-purple-700 shadow-2xl shadow-blue-500/30 ring-8 ring-blue-500/20'
                                                        : 'bg-gradient-to-br from-gray-700 to-gray-800 shadow-2xl'
                                                }`}
                                                animate={{
                                                    scale: currentSpeaker === 'ai' ? [1, 1.05 + Math.min(0.2, vapiVolume * 0.3), 1] : 1
                                                }}
                                                transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                                            >
                                                <div className="text-8xl select-none">🤖</div>
                                            </motion.div>

                                            {currentSpeaker === 'ai' && (
                                                <motion.div
                                                    className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-1 rounded-full text-xs font-semibold shadow-md whitespace-nowrap"
                                                    initial={{ opacity: 0, y: -8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                >
                                                    Speaking...
                                                </motion.div>
                                            )}
                                        </div>

                                        <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
                                            <p className="text-sm font-medium text-white flex items-center gap-2">
                                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                                AI Interviewer
                                            </p>
                                        </div>
                                    </div>

                                    {/* RIGHT PANEL - Candidate Camera + Live Transcript (Image 2) */}
                                    <div className="w-full md:w-[380px] lg:w-[420px] bg-[#0f0f0f] flex flex-col border-t md:border-t-0 md:border-l border-gray-800 shrink-0">
                                        {/* Candidate Camera (Aspect Video) */}
                                        <div className="relative bg-black aspect-video overflow-hidden">
                                            {cameraStream || proctorStream ? (
                                                <>
                                                    <ProctorCameraFeed
                                                        stream={cameraStream || proctorStream}
                                                        detections={detections}
                                                        faceBoxes={faceBoxes}
                                                        personCount={personCount}
                                                        suspectLabel={suspectLabel}
                                                        isModelActive={isModelActive}
                                                        detectionStatus={detectionStatus}
                                                        violationCount={violationCount}
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute top-3 left-3 bg-gray-900/80 backdrop-blur-sm px-2.5 py-1 rounded text-xs font-medium z-10 text-white border border-white/10 flex items-center gap-1.5">
                                                        <User className="w-3.5 h-3.5 text-emerald-400" />
                                                        <span>You</span>
                                                    </div>
                                                    {currentSpeaker === 'user' && (
                                                        <div className="absolute bottom-3 left-3 bg-green-500 px-3 py-1 rounded-full text-xs font-semibold z-10 text-white shadow-md">
                                                            Speaking...
                                                        </div>
                                                    )}
                                                    {currentSpeaker === 'ai' && (
                                                        <div className="absolute bottom-3 left-3 bg-gray-700/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-medium z-10 text-slate-300 border border-white/10">
                                                            Listening...
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-gray-900">
                                                    <div className="text-center">
                                                        <div className="text-4xl mb-2 select-none">📷</div>
                                                        <p className="text-xs text-gray-500">Camera unavailable</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Live Transcript (Image 2) */}
                                        <div className="flex-1 flex flex-col bg-[#0f0f0f] min-h-[280px] border-t border-gray-800">
                                            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Transcript</h3>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                                    <span className="text-xs text-gray-400 font-medium">Live</span>
                                                </div>
                                            </div>

                                            <div
                                                ref={vapiTranscriptScrollRef}
                                                className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-[320px] scrollbar-thin scrollbar-thumb-gray-700"
                                            >
                                                {vapiTranscript.length === 0 ? (
                                                    <p className="text-xs text-gray-600 text-center mt-8">Transcript will appear here...</p>
                                                ) : (
                                                    <AnimatePresence>
                                                        {vapiTranscript.map((entry, idx) => (
                                                            <motion.div
                                                                key={entry.id || idx}
                                                                initial={{ opacity: 0, y: 10 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                                            >
                                                                <div className={`max-w-[85%] ${
                                                                    entry.role === 'ai'
                                                                        ? 'bg-gray-800 text-left'
                                                                        : 'bg-purple-600 text-right'
                                                                } rounded-lg px-3 py-2 shadow-md`}>
                                                                    <p className={`text-[10px] font-semibold mb-1 ${
                                                                        entry.role === 'ai' ? 'text-blue-400' : 'text-purple-200'
                                                                    }`}>
                                                                        {entry.role === 'ai' ? 'AI Interviewer' : 'You'}
                                                                    </p>
                                                                    <p className="text-xs text-white leading-relaxed">{entry.text}</p>
                                                                    <p className="text-[9px] text-gray-400 mt-1">{entry.time}</p>
                                                                </div>
                                                            </motion.div>
                                                        ))}
                                                    </AnimatePresence>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Bottom Control Bar (Image 2) */}
                                <div className="bg-black/50 backdrop-blur-sm border-t border-gray-800 py-4 flex items-center justify-center gap-4 shrink-0">
                                    <button
                                        type="button"
                                        onClick={toggleVapiMute}
                                        disabled={currentSpeaker === 'ai'}
                                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                                            currentSpeaker === 'ai'
                                                ? 'bg-gray-700 opacity-50 cursor-not-allowed'
                                                : vapiIsMuted
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                                        }`}
                                        title={vapiIsMuted ? "Unmute Mic" : "Mute Mic"}
                                    >
                                        {vapiIsMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowEndInterviewModal(true)}
                                        className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors cursor-pointer shadow-lg shadow-red-600/30"
                                        title="End Interview"
                                    >
                                        <PhoneOff className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Connecting Overlay */}
                                {vapiCallStatus === 'connecting' && (
                                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-40">
                                        <div className="text-center max-w-md p-6">
                                            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                                            <p className="text-lg font-medium text-white">Connecting to AI Interviewer...</p>
                                            <p className="text-sm text-gray-400 mt-2">Please wait while voice connection is initialized...</p>
                                        </div>
                                    </div>
                                )}

                                {/* Error / Assistant ID Override Overlay */}
                                {vapiCallStatus === 'error' && (
                                    <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-40 p-4">
                                        <div className="text-center max-w-md bg-slate-900 border border-red-500/30 p-6 rounded-2xl shadow-2xl">
                                            <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                                <PhoneOff className="w-7 h-7 text-red-500" />
                                            </div>
                                            <p className="text-base font-bold text-red-400">Connection Failed</p>
                                            <p className="text-xs text-gray-400 mt-1 mb-4">{vapiConnectionError || "Could not connect to Vapi Assistant."}</p>
                                            
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const manualId = localStorage.getItem('vapi_manual_id');
                                                    const target = manualId || vapiAssistantConfig || vapiAssistantId;
                                                    if (target) startVapiCall(target);
                                                    else loadInterview();
                                                }}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                            >
                                                Retry Connection
                                            </button>

                                            <div className="mt-4 pt-4 border-t border-gray-800 text-left">
                                                <p className="text-xs text-gray-400 mb-1.5 font-medium">Assistant ID Override (Optional):</p>
                                                <input
                                                    type="text"
                                                    placeholder="Paste VAPI Assistant ID"
                                                    className="w-full bg-gray-950 border border-gray-800 text-white text-xs p-2.5 rounded-lg mb-1.5 focus:border-blue-500 outline-none"
                                                    onChange={(e) => {
                                                        const val = e.target.value.trim();
                                                        if (val.length > 5) {
                                                            localStorage.setItem('vapi_manual_id', val);
                                                        } else {
                                                            localStorage.removeItem('vapi_manual_id');
                                                        }
                                                    }}
                                                />
                                                <p className="text-[10px] text-gray-500">Saved ID will be used on Retry</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* End Interview Confirmation Modal */}
            {showEndInterviewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mx-auto">
                            <CheckCircle2 className="w-8 h-8" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Finish AI Technical Interview?</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Your spoken responses and full conversation transcript will be submitted for multi-dimensional AI scoring.
                            </p>
                        </div>

                        {isSubmittingInterview ? (
                            <div className="py-4 space-y-3">
                                <div className="w-10 h-10 rounded-full border-3 border-emerald-600 border-t-transparent animate-spin mx-auto" />
                                <p className="text-sm font-bold text-slate-800">Evaluating Voice Interview with AI...</p>
                                <p className="text-xs text-slate-500">Synthesizing speech analysis, communication score, and your final 17-point job readiness dossier.</p>
                            </div>
                        ) : (
                            <>
                                <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 space-y-1.5 text-left border border-slate-100">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Live Transcript Items:</span>
                                        <span className="font-semibold text-slate-900">{vapiTranscript.length} messages</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Integrity Violations:</span>
                                        <span className="font-semibold text-emerald-700">{violationCount} recorded</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowEndInterviewModal(false)}
                                        className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                    >
                                        Continue Interview
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSubmitInterview}
                                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer flex items-center justify-center gap-2"
                                    >
                                        <span>Submit & Complete</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoleReadyAssessment;
