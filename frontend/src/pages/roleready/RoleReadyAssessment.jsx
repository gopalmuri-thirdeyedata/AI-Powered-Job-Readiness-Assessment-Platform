import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { VoiceInterviewSession } from '../../utils/voiceInterviewSession';
import { errorMessage } from '../../utils/codingPlatform';
import { VOICE_CONNECT_TIMEOUT_MS, classifyVoiceError, disposeVoice, interviewSubmitErrorMessage, isClosedAttemptStatus, toDisplayText } from '../../utils/voiceSession';
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
    AlertCircle,
    RotateCcw,
    Award,
    Shield,
    XCircle,
    CheckCircle,
    User,
    PhoneOff,
    Brain,
    BarChart3,
    Binary,
    FileText,
    Settings,
    Loader2,
} from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Counter } from '../../components/home/primitives';
import { StepHighlight, PopIn, Stagger, StaggerItem, SlideSwap, ProgressBar, Enter } from '../../components/roleready-ui/assessmentMotion';
import { Editor } from '@monaco-editor/react';
import AssessmentCodingWorkspace from '../../components/coding/AssessmentCodingWorkspace';
import CodingTopBar from '../../components/coding/CodingTopBar';
import { FOCUS_WARNING, MAX_INTEGRITY_EVENTS, decideRecruitmentAction, restoreFromResume } from '../../utils/integrityPolicy';
import ProtectionLayer from '../../components/ProtectionLayer';
import useAssessmentProtection, { PROTECTION_TEST_MODE } from '../../hooks/useAssessmentProtection';
import { useWorkspaceTheme } from '../../components/coding/workspaceParts';
import { DEFAULT_LANGUAGE, customInputFor, defaultLanguage, languageLabel, problemLanguages, starterFor } from '../../utils/codingLanguages';
import { AiLiveCaption, UserLiveCaption } from '../../components/interview/LiveCaptionBubbles';
import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';
import useFaceProctoring from '../../hooks/useFaceProctoring';
import useMicrophone from '../../hooks/useMicrophone';
import MicrophonePicker from '../../components/student-ui/MicrophonePicker';
import { shouldWarnSilence } from '../../utils/micLevel';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';
import FullscreenGateModal from '../../components/FullscreenGateModal';
import QuestionProvenance from '../../components/roleready-ui/QuestionProvenance';
import { createStudentAssessmentApi } from '../../services/assessmentApi';
import API_URL from '../../apiConfig';
import { markStudentTaskCompleted } from '../../hooks/useStudentTaskStatus';


// The "evaluating" animation stays up for at least this long, even when the server answers instantly, so
// finishing a round feels deliberate. The next round's clock only starts after it, never behind it.
const MIN_SUBMIT_ANIMATION_MS = 5000;
const holdAnimation = async (startedAt) => {
    const remaining = MIN_SUBMIT_ANIMATION_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};
const DONE_FLASH_MS = 450; // how long the full bar stays visible before the next screen

const APTITUDE_SUBMIT_STAGES = [
    { icon: ShieldCheck, label: 'Submitting your answers securely' },
    { icon: Brain, label: 'Checking against the answer key' },
    { icon: BarChart3, label: 'Scoring the aptitude round' },
    { icon: Code2, label: 'Unlocking the coding round' },
];
const CODING_SUBMIT_STAGES = [
    { icon: ShieldCheck, label: 'Submitting your solutions securely' },
    { icon: Code2, label: 'Running your code in the sandbox' },
    { icon: Binary, label: 'Comparing outputs with the hidden tests' },
    { icon: BarChart3, label: 'Scoring each problem' },
    { icon: Mic, label: 'Unlocking the interview round' },
];
const INTERVIEW_SUBMIT_STAGES = [
    { icon: Mic, label: 'Saving your interview transcript' },
    { icon: Brain, label: 'Analysing your answers' },
    { icon: BarChart3, label: 'Scoring communication and depth' },
    { icon: FileText, label: 'Preparing your readiness report' },
];
const SUBMIT_TIPS = [
    'Your answers are saved on the server, so nothing is lost if this takes a moment.',
    'Please keep this page open until the evaluation finishes.',
    'Each round unlocks only after the previous one is evaluated.',
    'Busy sandbox? Running every hidden test can take up to a minute.',
];

// Canonical limits (services/assessment_policy.py): 20 minutes for Aptitude and Coding, 10 for the Interview, 60 overall. These are only the display
// placeholder shown until the server answers; the countdown is always re-hydrated from the server's remaining_seconds.
const ROUND_DURATIONS = {
    aptitude: 20 * 60,
    coding: 20 * 60,
    interview: 10 * 60
};
const DRAFT_DEBOUNCE_MS = 4000;

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
    limit = MAX_MALPRACTICE_WARNINGS,
    className = "",
    showDiagnostics = true,
    compact = false,
    thumb = false          // small picture with the status as an overlay: the coding round's slim top bar
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
    if (showDiagnostics) {
        // Person boxes (drawn in the compact coding-round preview as well)
        (faceBoxes || []).forEach((fb, idx) => {
            renderedBoxes.push({
                key: `face-${idx}`,
                label: compact ? 'Person' : 'Candidate Verified',
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
                label: compact
                    ? (d.class === 'cell phone' ? '📱 Phone' : d.class)
                    : `${d.class === 'cell phone' ? '📱 Mobile Phone' : d.class} (${Math.round(d.confidence * 100)}%)`,
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
            <div className={`${thumb ? 'hidden' : 'flex'} items-center justify-between gap-1 text-[10px] font-semibold flex-wrap`}>
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
                        {limit ? 'Warnings' : 'Events'}: <strong className={violationCount > 0 ? "text-amber-600 font-bold" : "text-slate-800"}>{violationCount}{limit ? `/${limit}` : ''}</strong>
                    </span>
                </div>
            </div>

            {/* Video Viewport: Responsive aspect ratio with centered object-cover and mirror transform */}
            <div className="relative w-full aspect-video rounded-xl bg-slate-950 overflow-hidden border border-slate-200 dark:border-[#3a3a3a] shadow-inner flex items-center justify-center">
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
                                top: compact ? '0' : '-18px',
                                left: '0',
                                backgroundColor: box.color,
                                color: '#FFFFFF',
                                fontSize: compact ? '8px' : '9px',
                                fontWeight: 'bold',
                                padding: compact ? '0 3px' : '1px 4px',
                                borderRadius: compact ? '0 0 3px 0' : '3px',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
                            }}
                        >
                            {box.label}
                        </span>
                    </div>
                ))}

                {thumb && (
                    <div className="absolute bottom-0 inset-x-0 z-[6] flex items-center justify-between gap-1 px-1.5 py-0.5 bg-black/60 text-[9px] font-bold text-white"
                        title={`${isModelActive ? 'Proctoring active' : 'Proctoring connecting'} · ${personCount} person${personCount === 1 ? '' : 's'} · ${violationCount}${limit ? `/${limit}` : ''} warnings`}>
                        <span className="inline-flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${isModelActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                            <span className={personCount === 1 ? '' : 'text-amber-300'}>👤 {personCount}</span>
                        </span>
                        <span className={violationCount > 0 ? 'text-amber-300' : ''}>⚠ {violationCount}{limit ? `/${limit}` : ''}</span>
                    </div>
                )}

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

/**
 * The assessment workspace shared by the Student Platform and the Admin Recruitment shared-link workflow.
 * Aptitude, Monaco coding (Python only), the voice interview, timers, drafts and proctoring are this one
 * implementation; a workflow differs only through the `api` adapter (services/assessmentApi.js) it is given:
 *   mode               'student' | 'recruitment'
 *   skipInstructions   recruitment candidates already read and acknowledged the instructions: start at the device check
 *   proctoringPolicy   'terminate' (student: three strikes end the attempt) | 'flag' (recruitment: events are recorded
 *                      for the hiring team; a browser event alone never ends or invalidates an attempt)
 *   onFinished(outcome) called instead of routing to the student report
 *   onBackToInstructions  recruitment only: returns to the Exam Instructions page (the student-style rules card is never shown to candidates)
 *   resumeInfo         recruitment only: a reloaded sitting ({ state, draft, violations } from POST .../resume). The attempt already exists: the
 *                      candidate repeats the camera check, then lands in the CURRENT section with timers, saved work and events restored.
 */
export const AssessmentWorkspace = ({
    sessionUuid,
    api,
    mode = 'student',
    skipInstructions = false,
    proctoringPolicy = 'terminate',
    onFinished = null,
    onBackToInstructions = null,
    watermark = '',
    resumeInfo = null,
}) => {
    const navigate = useNavigate();
    const isRecruitment = mode === 'recruitment';
    const strikeLimit = proctoringPolicy === 'flag' ? null : MAX_MALPRACTICE_WARNINGS;

    const finishAssessment = useCallback((outcome = 'completed') => {
        if (onFinished) onFinished(outcome);
        else navigate(`/assessment/${sessionUuid}/report`);
    }, [onFinished, navigate, sessionUuid]);

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
    const [instructionsAccepted, setInstructionsAccepted] = useState(!!resumeInfo);   // a resumed candidate accepted them before the reload
    const resumeRestore = useMemo(() => (resumeInfo ? restoreFromResume(resumeInfo) : null), [resumeInfo]);
    const [isStartingAssessment, setIsStartingAssessment] = useState(false);

    // Stream Refs
    const streamRef = useRef(null);
    const modelCheckRef = useRef(0); // identifies the current model-status polling run
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
    const endAttemptRef = useRef(null);   // endRecruitmentAttempt of the latest render (the handler below is memoised)

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

        if (proctoringPolicy === 'flag') {
            // Recruitment policy: switching tabs more than once disqualifies, and more than MAX_INTEGRITY_EVENTS events of any kind end the
            // attempt (utils/integrityPolicy; the server re-checks both numbers). The reload marker of a resume is in the list but never counts.
            violationsRef.current = [...violationsRef.current, violationEntry];
            const decision = decideRecruitmentAction(violationsRef.current, reason);
            if (decision.action === 'terminate') {
                endAttemptRef.current?.(decision, violationsRef.current);
                return;
            }
            const focusWarning = decision.action === 'warn_focus';
            setWarningBanner({
                message: focusWarning
                    ? `Integrity event ${count}/${MAX_INTEGRITY_EVENTS}: ${reason}. ${FOCUS_WARNING}`
                    : `Integrity event ${count}/${MAX_INTEGRITY_EVENTS}: ${reason}. It has been recorded and will be shared with the hiring team. More than ${MAX_INTEGRITY_EVENTS} events end the assessment.`,
                level: focusWarning || count >= MAX_INTEGRITY_EVENTS - 1 ? 'critical' : 'warning'
            });
            warningBannerTimerRef.current = setTimeout(() => setWarningBanner(null), focusWarning ? 15000 : 8000);
            return;
        }

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
    }, [currentStage, proctoringPolicy]);

    // ── Content protection: cover the page when the window is not in front, block copying / pasting / printing / screenshot keys ──
    // Recruitment records every attempt as an integrity event. For students (three strikes end the attempt) an attempt only shows a notice,
    // so an accidental Ctrl+C can never cost anyone their assessment.
    const onProtectionEvent = useCallback((reason) => {
        if (proctoringPolicy === 'flag') {
            handleAnyViolation(reason);
            return;
        }
        if (warningBannerTimerRef.current) clearTimeout(warningBannerTimerRef.current);
        setWarningBanner({ message: `${reason}. This was noted.`, level: 'warning' });
        warningBannerTimerRef.current = setTimeout(() => setWarningBanner(null), 6000);
    }, [proctoringPolicy, handleAnyViolation]);
    const { obscured: pageObscured, protectionOn } = useAssessmentProtection({
        enabled: ['aptitude', 'coding', 'interview'].includes(currentStage) && !sessionData?.is_completed,
        onEvent: onProtectionEvent,
    });
    const watermarkText = watermark || (sessionUuid && sessionUuid !== 'recruitment' ? `Session ${String(sessionUuid).slice(0, 8)}` : '');

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
        getAuthHeaders: api.proctorHeaders || null,
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

        // Recruitment ignores a lost window focus completely (no event, no banner, no count): only a real tab switch above counts.
        // Students keep the old behaviour.
        const handleWindowBlur = () => {
            if (proctoringPolicy === 'flag') return;
            handleAnyViolation("Application lost focus (Window Blur / Switch)");
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("blur", handleWindowBlur);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("blur", handleWindowBlur);
        };
    }, [currentStage, sessionData?.is_completed, handleAnyViolation, proctoringPolicy]);

    // ── Round Timers ─────────────────────────────────────────────────
    const [timeLeft, setTimeLeft] = useState(ROUND_DURATIONS.aptitude);
    const [roundStartTime, setRoundStartTime] = useState(Date.now());
    const [overallLeft, setOverallLeft] = useState(null);
    const overallDeadlineRef = useRef(null);

    // The server is the only clock that counts: every response re-hydrates both countdowns (the on-screen ticks are display only).
    const syncTiming = useCallback((res) => {
        if (!res) return;
        if (typeof res.remaining_seconds === 'number') setTimeLeft(res.remaining_seconds);
        if (typeof res.overall_remaining_seconds === 'number') {
            overallDeadlineRef.current = Date.now() + res.overall_remaining_seconds * 1000;
            setOverallLeft(res.overall_remaining_seconds);
        }
    }, []);

    useEffect(() => {
        if (overallDeadlineRef.current === null && overallLeft === null) return undefined;
        const tick = setInterval(() => {
            if (overallDeadlineRef.current !== null) {
                setOverallLeft(Math.max(0, Math.round((overallDeadlineRef.current - Date.now()) / 1000)));
            }
        }, 1000);
        return () => clearInterval(tick);
    }, [overallLeft === null]);

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
    const [workspaceTheme, toggleWorkspaceTheme] = useWorkspaceTheme();   // dark like LeetCode, or light
    // Language per problem: a problem with typed params and several `starter_code` languages lets the candidate choose (shared-link and
    // student assessments alike); any other problem is Python only, as it always was.
    const [codeSolutions, setCodeSolutions] = useState({}); // { [probId]: { code: string, language: string } }: the CURRENT language and code; this is what is run, saved and submitted
    const codeBuffersRef = useRef({});                      // { [probId]: { [language]: code } }: the code left behind in the other languages, so switching never loses work
    const [customFields, setCustomFields] = useState({});   // { [probId]: string[] }: the candidate's own testcase, one JSON value per parameter
    const [codeOutput, setCodeOutput] = useState(null);
    const [isRunningCode, setIsRunningCode] = useState(false);
    const [isSubmittingCoding, setIsSubmittingCoding] = useState(false);
    const [codingSubmitError, setCodingSubmitError] = useState(null);
    const [submitDone, setSubmitDone] = useState(false); // the evaluation finished: the overlay shows 100% before closing
    const [codingSubmitResult, setCodingSubmitResult] = useState(null);

    // ── Round 3: Interview State ─────────────────────────────────────
    const [interviewQuestions, setInterviewQuestions] = useState([]);
    const [interviewResponses, setInterviewResponses] = useState({});
    const [currentInterviewIndex, setCurrentInterviewIndex] = useState(0);
    const [isRecordingVoice, setIsRecordingVoice] = useState(false);
    const [isSubmittingInterview, setIsSubmittingInterview] = useState(false);

    // ── Round 3: Voice-First State ──────────────────────────────
    const [voiceConfig, setVoiceConfig] = useState(null);
    const [voiceCallStatus, setVoiceCallStatus] = useState('idle'); // 'idle' | 'connecting' | 'active' | 'ended' | 'error'
    const [voiceSpeakingState, setVoiceSpeakingState] = useState('connecting'); // 'connecting' | 'ai_speaking' | 'listening' | 'processing' | 'completed'
    const [voiceVolume, setVoiceVolume] = useState(0);
    const [voiceUserLevel, setVoiceUserLevel] = useState(0);        // 0..1: how loud the candidate is while the mic is open for them
    const [voiceUserSpeaking, setVoiceUserSpeaking] = useState(false);
    const [voiceTranscript, setVoiceTranscript] = useState([]);
    const [liveCaption, setLiveCaption] = useState('');          // what the candidate is saying right now (replaced by the server's transcript)
    const [captionsUnavailable, setCaptionsUnavailable] = useState(false);
    const [aiCaption, setAiCaption] = useState(null);                 // the interviewer's words while they are being spoken
    const pendingAiRef = useRef([]);                                  // the interviewer's finished lines, added to the transcript once spoken
    const [voiceIsMuted, setVoiceIsMuted] = useState(false);
    const [currentSpeaker, setCurrentSpeaker] = useState(null); // 'ai' | 'user'
    const [voiceConnectionError, setVoiceConnectionErrorRaw] = useState(null);
    // Whatever the SDK or API hands over, only text is ever stored: an object rendered in JSX would white-screen the candidate.
    const setVoiceConnectionError = useCallback((value) => setVoiceConnectionErrorRaw(
        value == null ? null : toDisplayText(value, 'The voice connection failed. Choose Retry Connection.')), []);
    const [showEndInterviewModal, setShowEndInterviewModal] = useState(false);
    const [writtenFallback, setWrittenFallback] = useState(false);
    const voiceRef = useRef(null);
    const voiceConnectTimerRef = useRef(null);
    const interviewSubmitLockRef = useRef(false);     // synchronous guard: state updates are too late to stop a double submit
    const [interviewSubmitError, setInterviewSubmitError] = useState(null);
    const voiceTranscriptScrollRef = useRef(null);

    // ── Microphone: chosen device, live level, and "we can hear you" ──────
    const mic = useMicrophone({ enabled: currentStage === 'device_check' || currentStage === 'interview' });
    const [showMicPanel, setShowMicPanel] = useState(false);
    const [micSilent, setMicSilent] = useState(false);
    const listeningSinceRef = useRef(0); // when the interviewer last finished speaking
    const micDeviceRef = useRef('');
    micDeviceRef.current = mic.deviceId;

    // Route the live call to the microphone the candidate picked (the browser default is often the wrong one)
    const applyMicToCall = useCallback((id) => {
        const target = id || micDeviceRef.current;
        if (!target || !voiceRef.current) return;
        try {
            const result = voiceRef.current.setInputDevicesAsync({ audioDeviceId: target });
            if (result && typeof result.catch === 'function') result.catch((e) => console.warn('Could not switch the call microphone:', e));
        } catch (e) {
            console.warn('Could not switch the call microphone:', e);
        }
    }, []);

    // Warn when nothing has been heard for a while after the interviewer finished speaking
    useEffect(() => {
        if (voiceCallStatus !== 'active') { setMicSilent(false); return undefined; }
        const timer = setInterval(() => {
            setMicSilent(
                voiceSpeakingState === 'listening' && !voiceIsMuted
                && shouldWarnSilence({ now: Date.now(), lastSoundAt: mic.lastSoundAtRef.current, listeningSince: listeningSinceRef.current }),
            );
        }, 1000);
        return () => clearInterval(timer);
    }, [voiceCallStatus, voiceSpeakingState, voiceIsMuted, mic.lastSoundAtRef]);

    // ── Camera, Mic & AI Model Initializer ──────────────────────────
    const initHardware = useCallback(async () => {
        setCameraStatus('checking');
        setMicStatus('checking');
        setModelStatus('checking');

        // Check backend YOLO vision model status. The server loads the model in the background after it starts,
        // so "loading" is normal for the first minute: keep asking instead of calling it an error.
        const checkRun = ++modelCheckRef.current;
        const checkModel = async (attempt = 0) => {
            try {
                const res = await fetch(`${API_URL}/api/proctor/status`);
                const data = await res.json();
                if (checkRun !== modelCheckRef.current) return; // a newer check replaced this one
                if (data.status === 'ready') {
                    setModelStatus('ready');
                } else if (data.status === 'loading' && attempt < 45) {
                    setModelStatus('checking');
                    setTimeout(() => checkModel(attempt + 1), 2000);
                } else {
                    setModelStatus('error');
                }
            } catch {
                if (checkRun === modelCheckRef.current) setModelStatus('error');
            }
        };
        checkModel();

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
            const data = await api.getSession();
            setSessionData(data);
            syncTiming(data);

            if (data.is_completed) {
                finishAssessment('closed');
                return;
            }

            // Restore correct round state
            if (resumeInfo && resumeRestore) {
                // A reloaded sitting: the events already recorded come back (the Events counter and the limits continue, a reload never resets
                // them; the reload marker stays in the list that goes back to the server but is not counted), then the camera is checked again.
                violationsRef.current = resumeRestore.violations;
                setViolations(resumeRestore.violations);
                totalViolationsRef.current = resumeRestore.counted;
                setViolationCount(resumeRestore.counted);
                setCurrentStage('device_check');
                initHardware();
            } else if (data.current_state === 'NOT_STARTED') {
                if (skipInstructions) {
                    // Recruitment: the instructions were read and acknowledged on the previous page; go straight to the device check.
                    setCurrentStage('device_check');
                    initHardware();
                } else {
                    setCurrentStage('instructions');
                }
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
            setError(errorMessage(err, "Could not load assessment session."));
        } finally {
            setIsLoading(false);
        }
    }, [api, finishAssessment, initHardware, skipInstructions, syncTiming, resumeInfo, resumeRestore]);

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // ── Round 1: Aptitude Operations ─────────────────────────────────
    const loadAptitude = async (preloaded = null) => {
        try {
            const res = preloaded || await api.startAptitude();
            setAptitudeQuestions(res.questions || []);
            setRoundStartTime(Date.now());
            syncTiming(res);
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

        const submitStartedAt = Date.now();

        try {
            await api.submitAptitude(aptitudeAnswers, timeSpent, violations);
            await holdAnimation(submitStartedAt);
            setSubmitDone(true);
            await new Promise((resolve) => setTimeout(resolve, DONE_FLASH_MS));

            // Unlock and navigate to Coding. The session refresh and the coding problems are
            // independent, so fetch them together instead of one after another.
            setCurrentStage('coding');
            setTimeLeft(ROUND_DURATIONS.coding);
            const [updated] = await Promise.all([
                api.getSession(),
                loadCoding()
            ]);
            setSessionData(updated);
            if (updated.is_completed) finishAssessment('closed');   // the overall deadline ended the attempt meanwhile
        } catch (err) {
            console.error("Aptitude submission error:", err);
            alert(errorMessage(err, "Aptitude submission failed. Please retry."));
        } finally {
            setIsSubmittingApt(false);
            setSubmitDone(false);
        }
    };

    // ── Round 2: Coding Operations ───────────────────────────────────
    const loadCoding = async (preloaded = null) => {
        try {
            const res = preloaded || await api.startCoding();
            const probs = res.problems || [];
            setCodingProblems(probs);
            setRoundStartTime(Date.now());
            syncTiming(res);

            const initialSols = {};
            probs.forEach(p => {
                const language = defaultLanguage(p);
                initialSols[String(p.id)] = { code: starterFor(p, language), language };
            });
            setCodeSolutions(prev => ({ ...initialSols, ...prev }));
        } catch (err) {
            console.error("Failed to load coding problems:", err);
        }
    };

    const handleCodeChange = (probId, newCode) => {
        setCodeSolutions(prev => {
            const key = String(probId);
            return { ...prev, [key]: { code: newCode, language: prev[key]?.language || DEFAULT_LANGUAGE } };
        });
    };

    // Switching language parks the current code in its buffer and brings back that language's own buffer (or its starter the first time).
    const handleLanguageChange = (probId, language) => {
        const key = String(probId);
        const problem = codingProblems.find((p) => String(p.id) === key);
        if (!problem || !problemLanguages(problem).includes(language) || isRunningCode) return;
        setCodeSolutions(prev => {
            const current = prev[key];
            if (current?.language === language) return prev;
            const buffers = codeBuffersRef.current[key] || (codeBuffersRef.current[key] = {});
            if (current) buffers[current.language] = current.code;
            return { ...prev, [key]: { code: buffers[language] ?? starterFor(problem, language), language } };
        });
        setCodeOutput(null);
    };

    // Reset restores the starter of the CURRENT language only; the other languages' code is left alone.
    const handleResetCode = () => {
        if (!codingProblems[currentProblemIndex]) return;
        const activeProb = codingProblems[currentProblemIndex];
        const probId = String(activeProb.id);
        const language = codeSolutions[probId]?.language || defaultLanguage(activeProb);
        const starter = starterFor(activeProb, language);

        if (codeBuffersRef.current[probId]) delete codeBuffersRef.current[probId][language];
        setCodeSolutions(prev => ({ ...prev, [probId]: { code: starter, language } }));
        setCodeOutput(null);
    };

    const runCodeRef = useRef(() => {});
    const runningRef = useRef(false);   // a synchronous guard: Ctrl + ' and the Run button can fire in the same tick, before isRunningCode re-renders
    const handleRunCode = async () => {
        if (!codingProblems[currentProblemIndex] || runningRef.current) return;
        const activeProb = codingProblems[currentProblemIndex];
        const probId = String(activeProb.id);
        const sol = codeSolutions[probId] || { code: "", language: defaultLanguage(activeProb) };

        runningRef.current = true;
        setIsRunningCode(true);
        setCodeOutput(null);

        try {
            const res = await api.runCode(probId, sol.code, sol.language || DEFAULT_LANGUAGE, customInputFor(activeProb, customFields[probId]));
            setCodeOutput(res);
        } catch (err) {
            console.error("Run code error:", err);
            setCodeOutput({
                all_passed: false,
                test_results: [],
                error: errorMessage(err, "Execution failed in sandboxed container.")
            });
        } finally {
            runningRef.current = false;
            setIsRunningCode(false);
        }
    };

    runCodeRef.current = handleRunCode;

    const handleSubmitCoding = async () => {
        if (isSubmittingCoding || codingSubmitResult) return;
        setIsSubmittingCoding(true);
        setCodingSubmitError(null);
        const timeSpent = Math.max(1, Math.round((Date.now() - roundStartTime) / 1000));

        const submitStartedAt = Date.now();

        try {
            const res = await api.submitCoding(codeSolutions, timeSpent, violations);
            await holdAnimation(submitStartedAt);
            setSubmitDone(true);
            await new Promise((resolve) => setTimeout(resolve, DONE_FLASH_MS));
            // Show a clear "submitted" confirmation with the per-problem results; the student then
            // continues to the interview (which is provisioned only when they do).
            setCodingSubmitResult(res || { results: [] });
            try {
                const updated = await api.getSession();
                setSessionData(updated);
                if (updated?.is_completed) {
                    finishAssessment('closed');
                    return;
                }
            } catch (e) { /* status refresh is best effort */ }
        } catch (err) {
            console.error("Coding submission error:", err);
            const status = err.response?.status;
            const detail = err.response?.data?.detail;
            setCodingSubmitError(
                status === 503
                    ? "The code-running service is busy right now, so your tests could not be evaluated. Your code is saved. Please try again in a moment."
                    : !err.response
                        ? "Could not reach the server. Check your connection, then try again. Your code is saved."
                        : (typeof detail === 'string' ? detail : "Coding evaluation failed. Your code is saved. Please try again.")
            );
        } finally {
            setIsSubmittingCoding(false);
            setSubmitDone(false);
        }
    };

    const continueToInterview = () => {
        setCurrentStage('interview');
        setTimeLeft(ROUND_DURATIONS.interview);
        loadInterview();
    };

    // ── Auto-scroll Voice transcript ──────────────────────────────────
    useEffect(() => {
        if (voiceTranscriptScrollRef.current) {
            voiceTranscriptScrollRef.current.scrollTop = voiceTranscriptScrollRef.current.scrollHeight;
        }
    }, [voiceTranscript, liveCaption, aiCaption]);

    // ── Voice Lifecycle Cleanup ───────────────────────────────────────
    useEffect(() => {
        return () => {
            clearTimeout(voiceConnectTimerRef.current);
            disposeVoice(voiceRef.current);
            voiceRef.current = null;
        };
    }, []);

    const startVoiceCall = useCallback((voiceConfig) => {
        try {
            clearTimeout(voiceConnectTimerRef.current);
            disposeVoice(voiceRef.current);          // stop the previous call AND detach its listeners (no stale call-end later)

            const voice = new VoiceInterviewSession({
                turn: (args) => api.voiceTurn(args),
                turnStream: api.voiceTurnStream ? (args, options) => api.voiceTurnStream(args, options) : undefined,
                captionSession: api.voiceCaptionSession ? () => api.voiceCaptionSession() : undefined,
                audioDeviceId: micDeviceRef.current || undefined,
            });
            voiceRef.current = voice;
            const current = () => voiceRef.current === voice;      // events from a replaced instance are ignored
            setVoiceCallStatus('connecting');
            setVoiceSpeakingState('connecting');
            setVoiceConnectionError(null);

            // A connection that never completes must not leave the candidate on a spinner with no way out.
            voiceConnectTimerRef.current = setTimeout(() => {
                if (!current()) return;
                disposeVoice(voice);
                voiceRef.current = null;
                setVoiceCallStatus('error');
                setVoiceConnectionError('The voice connection timed out. Choose Retry Connection.');
            }, VOICE_CONNECT_TIMEOUT_MS);

            voice.on('call-start', () => {
                if (!current()) return;
                clearTimeout(voiceConnectTimerRef.current);
                setVoiceCallStatus('active');
                setVoiceSpeakingState('ai_speaking');
                setCurrentSpeaker('ai');
            });

            voice.on('processing', () => {
                if (!current()) return;
                setVoiceUserSpeaking(false);
                setVoiceUserLevel(0);
                setVoiceSpeakingState('processing');
            });

            voice.on('listening', () => {
                if (!current()) return;
                setVoiceUserSpeaking(false);
                setVoiceSpeakingState('listening');
            });

            voice.on('mic-level', (level) => {
                if (!current()) return;
                setVoiceUserLevel((prev) => (Math.abs(prev - level) < 0.04 ? prev : level));     // no re-render for tiny changes
            });

            voice.on('user-speech', (speaking) => {
                if (!current()) return;
                setVoiceUserSpeaking(!!speaking);
                if (speaking) setVoiceSpeakingState('listening');
            });

            voice.on('caption', (caption) => {
                if (!current()) return;
                if (caption?.role === 'assistant') setAiCaption({ ...caption, startedAt: Date.now() });
                else setLiveCaption(caption?.text || '');
            });

            voice.on('caption-status', (status) => {
                if (!current()) return;
                setCaptionsUnavailable(status?.available === false);
            });

            voice.on('speech-start', () => {
                if (!current()) return;
                listeningSinceRef.current = 0;
                setVoiceSpeakingState('ai_speaking');
                setCurrentSpeaker('ai');
            });

            const addEntry = (role, text, q) => {
                const newEntry = {
                    id: Date.now() + Math.random(),
                    role,
                    text,
                    ...(Number.isInteger(q) ? { q } : {}),         // which prepared question this line asked (hidden tag from the server)
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                };
                setVoiceTranscript(prev => [...prev, newEntry]);
                setCurrentSpeaker(role);
                setTimeout(() => setCurrentSpeaker(null), 2500);
            };
            const flushInterviewerLines = () => {
                setAiCaption(null);
                pendingAiRef.current.splice(0).forEach((line) => addEntry('ai', line.text, line.q));
            };

            voice.on('speech-end', () => {
                if (!current()) return;
                flushInterviewerLines();
                listeningSinceRef.current = Date.now();
                setVoiceSpeakingState('listening');
                setCurrentSpeaker(null);
            });

            voice.on('volume-level', (vol) => {
                if (!current()) return;
                setVoiceVolume(vol || 0);
            });

            voice.on('message', (msg) => {
                if (!current()) return;
                if (msg.type === 'transcript' && msg.transcriptType === 'final') {
                    const role = (msg.role === 'assistant' || msg.role === 'ai') ? 'ai' : 'user';
                    if (role === 'user') {
                        setLiveCaption('');                  // the real transcript replaces the live one
                        addEntry('user', msg.transcript);
                    } else {
                        pendingAiRef.current.push({ text: msg.transcript, q: msg.questionNo });       // shown word by word while spoken, then added to the transcript
                    }

                    // Automatically detect progression across questions
                    if (role === 'ai') {
                        setInterviewQuestions(qs => {
                            const lower = (msg.transcript || "").toLowerCase();
                            if (Number.isInteger(msg.questionNo) && msg.questionNo >= 1 && msg.questionNo <= qs.length) setCurrentInterviewIndex(msg.questionNo - 1);
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

            voice.on('call-end', () => {
                if (!current()) return;
                clearTimeout(voiceConnectTimerRef.current);
                flushInterviewerLines();
                setVoiceCallStatus('ended');
                setVoiceSpeakingState('completed');
                setLiveCaption('');
                setCurrentSpeaker(null);
            });

            const failCall = (err) => {
                if (!current()) return;
                clearTimeout(voiceConnectTimerRef.current);
                console.error("[RoleReady Voice Error]:", err);
                setVoiceCallStatus('error');
                setVoiceConnectionError(classifyVoiceError(err).message);      // e.g. an explicit microphone-permission message
                flushInterviewerLines();
                setLiveCaption('');
                setCurrentSpeaker(null);
            };
            voice.on('error', failCall);

            voice.start(voiceConfig);
        } catch (err) {
            console.error("[RoleReady Voice Init Error]:", err);
            clearTimeout(voiceConnectTimerRef.current);
            setVoiceCallStatus('error');
            setVoiceConnectionError(classifyVoiceError(err).message);
            setCurrentSpeaker(null);
        }
    }, [api]);

    const toggleVoiceMute = () => {
        if (!voiceRef.current) return;
        const nextState = !voiceIsMuted;
        try {
            voiceRef.current.setMuted(nextState);
            setVoiceIsMuted(nextState);
        } catch (e) {
            console.warn("Failed to toggle Voice mute:", e);
        }
    };

    // ── Round 3: Interview Operations ────────────────────────────────
    const loadInterview = async () => {
        setVoiceCallStatus('connecting');
        setVoiceConnectionError(null);
        try {
            const res = await api.initVoice();
            setVoiceConfig(res.voiceConfig || null);
            setInterviewQuestions(res.questions || []);
            setRoundStartTime(Date.now());
            syncTiming(res);

            if (res.voiceConfig) {
                startVoiceCall(res.voiceConfig);
            } else {
                setVoiceCallStatus('error');
                setVoiceConnectionError("The voice interview could not be set up. Choose Retry Connection.");
            }
        } catch (err) {
            console.error("Failed to load the voice interview session:", err);
            setVoiceCallStatus('error');
            setVoiceConnectionError(errorMessage(err, "Could not set up the voice interview. Choose Retry Connection."));
            try {
                const fallback = await api.startInterview();
                setInterviewQuestions(fallback.questions || []);
                setRoundStartTime(Date.now());
                syncTiming(fallback);
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

        // -1 = the conversation before the first prepared question (introduction, getting to know the candidate): it belongs to no question.
        // The server tags the reply that starts a prepared question (item.q), so the split no longer depends on the interviewer saying "Question N".
        let currentQIdx = -1;
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
                if (Number.isInteger(item.q) && item.q >= 1) {
                    detectedIdx = item.q - 1;
                } else if (qNumMatch && qNumMatch[1]) {
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
                } else if (currentQIdx >= 0) {
                    buckets[currentQIdx].dialogue.push(`Interviewer: ${text}`);
                    if (text.includes('?') || lower.includes('could you') || lower.includes('can you') || lower.includes('tell me more') || lower.includes('elaborate')) {
                        buckets[currentQIdx].active_follow_up_prompt = text;
                    }
                }
            } else if (item.role === 'user' && currentQIdx >= 0) {
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
        if (interviewSubmitLockRef.current) return;       // double click / timer + button race: exactly one submission in flight
        interviewSubmitLockRef.current = true;
        setIsSubmittingInterview(true);
        setInterviewSubmitError(null);
        const timeSpent = Math.max(1, Math.round((Date.now() - roundStartTime) / 1000));
        const submitStartedAt = Date.now();

        clearTimeout(voiceConnectTimerRef.current);
        disposeVoice(voiceRef.current);                     // the call ends here: stop it and detach its listeners
        voiceRef.current = null;

        try {
            const formattedAnswers = segmentInterviewTranscript(
                interviewQuestions,
                voiceTranscript,
                interviewResponses
            );

            await api.submitInterview(formattedAnswers, timeSpent, violations, voiceTranscript);
            await holdAnimation(submitStartedAt);
            setSubmitDone(true);
            await new Promise((resolve) => setTimeout(resolve, DONE_FLASH_MS));
            if (!isRecruitment) markStudentTaskCompleted();
            finishAssessment('completed');                // the server accepted the submission (the lock stays set: it is final)
            setIsSubmittingInterview(false);
            setSubmitDone(false);
            setShowEndInterviewModal(false);
        } catch (err) {
            console.error("Interview submission error:", err);
            if (isClosedAttemptStatus(err?.response?.status)) {
                // The server already closed the attempt (deadline / closed / already submitted): leave the interview.
                if (!isRecruitment) markStudentTaskCompleted();
                finishAssessment('closed');
                setIsSubmittingInterview(false);
                setShowEndInterviewModal(false);
                return;
            }
            // Not recorded (network, 5xx, 401/403): never present this as a completed assessment. Keep the screen and allow a retry.
            interviewSubmitLockRef.current = false;
            setIsSubmittingInterview(false);
            setInterviewSubmitError(interviewSubmitErrorMessage(err));
            setShowEndInterviewModal(true);
        }
    };

    // ── Auto-submit handlers ─────────────────────────────────────────
    const handleTimeExpired = () => {
        if (currentStage === 'aptitude') handleSubmitAptitude();
        else if (currentStage === 'coding') handleSubmitCoding();
        else if (currentStage === 'interview') handleSubmitInterview();
    };

    const handleAutoSubmitDueToMalpractice = async (reason, allViolations = violations) => {
        // Instantly shut off media tracks and Voice call
        clearTimeout(voiceConnectTimerRef.current);
        disposeVoice(voiceRef.current);
        voiceRef.current = null;
        if (cameraStream) {
            try { cameraStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        }

        try {
            // Never let a slow network keep the candidate on the modal: cap the wait at 4s.
            await Promise.race([
                api.terminate(reason, allViolations, currentStage),
                new Promise(resolve => setTimeout(resolve, 4000))
            ]);
        } catch (err) {
            console.error("Fast malpractice termination error:", err);
        } finally {
            markStudentTaskCompleted();
            finishAssessment('terminated');
        }
    };

    // ── Resume: continue the SAME attempt in the section that is running (nothing is started, no deadline is created) ──
    const enterResumedSection = async () => {
        const section = await api.resumeSection();                       // straight from the server state, server-clock timers
        const updated = await api.getSession();
        setSessionData(updated);
        syncTiming(section);
        const key = section.key;
        const r = resumeRestore;
        if (key === 'aptitude') {
            setCurrentStage('aptitude');
            setTimeLeft(typeof section.remaining_seconds === 'number' ? section.remaining_seconds : ROUND_DURATIONS.aptitude);
            setAptitudeAnswers(r.aptitudeAnswers);
            setAptitudeQuestions(section.questions || []);
            setRoundStartTime(Date.now());
        } else if (key === 'coding') {
            setCurrentStage('coding');
            setTimeLeft(typeof section.remaining_seconds === 'number' ? section.remaining_seconds : ROUND_DURATIONS.coding);
            for (const [pid, buf] of Object.entries(r.buffers)) codeBuffersRef.current[pid] = { ...buf };
            await loadCoding(section);
            setCodeSolutions((prev) => ({ ...prev, ...r.solutions }));      // the candidate's own code and language win over the starters
        } else {
            setCurrentStage('interview');
            setTimeLeft(typeof section.remaining_seconds === 'number' ? section.remaining_seconds : ROUND_DURATIONS.interview);
            if (r.transcript.length) setVoiceTranscript(r.transcript); else setInterviewResponses(r.interviewResponses);
            loadInterview();                                                 // the conversation starts again; the saved answers stay
        }
    };

    // ── Recruitment: end the attempt (disqualified for switching tabs twice, or more than MAX_INTEGRITY_EVENTS events) ──
    // The work so far is flushed first (the server scores the active section from the saved draft), then the server is asked to end the attempt
    // and re-checks the numbers; its message is what the candidate reads on the closed screen.
    const endRecruitmentAttempt = async (decision, list) => {
        if (terminalFiredRef.current) return;
        terminalFiredRef.current = true;
        clearTimeout(voiceConnectTimerRef.current);
        disposeVoice(voiceRef.current);
        voiceRef.current = null;
        setWarningBanner({
            message: decision.disqualified
                ? 'You switched tabs more than once. Your assessment is being ended.'
                : `More than ${MAX_INTEGRITY_EVENTS} integrity events were recorded. Your assessment is being ended.`,
            level: 'terminal'
        });
        try {
            await Promise.race([Promise.resolve(api.saveDraft(currentStage, buildDraftPayload(), list)), new Promise((resolve) => setTimeout(resolve, 4000))]);
        } catch { /* the draft is best effort; the server still scores what it has */ }
        try {
            await api.terminateAttempt(list, decision.reason);
            if (cameraStream) { try { cameraStream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ } }
            finishAssessment('terminated');
        } catch (err) {
            terminalFiredRef.current = false;                           // not ended (network, or the server disagreed): the next event asks again
            setWarningBanner({ message: errorMessage(err, 'The assessment could not be ended right now.'), level: 'critical' });
        }
    };
    endAttemptRef.current = endRecruitmentAttempt;

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

            if (resumeInfo && resumeRestore) {
                await enterResumedSection();
                return;
            }

            // Step 3: Initialize Aptitude round on server
            // (Recruitment: this is the explicit start. The attempt, its rules acknowledgement and the 60-minute deadline are created
            // by the server only now.)
            const started = await api.startAptitude();          // ONE start request: its response already carries the questions
            const updated = await api.getSession();
            setSessionData(updated);
            syncTiming(updated);

            // Step 4: Advance to Aptitude round workspace
            setCurrentStage('aptitude');
            setTimeLeft(ROUND_DURATIONS.aptitude);
            setAptitudeQuestions(started.questions || []);
            setRoundStartTime(Date.now());
            syncTiming(started);
        } catch (err) {
            console.error("Failed to start assessment:", err);
            const detail = err.response?.data?.detail;   // a string, or { code, message } (e.g. ASSESSMENT_ACCESS_LOCKED)
            setLaunchError((typeof detail === 'string' ? detail : detail?.message) || err.message || "Could not launch assessment session. Please retry.");
        } finally {
            setIsStartingAssessment(false);
        }
    };

    // ── Draft autosave: partial work is scored by the server if the section or the whole assessment ends before submission ──
    const submittingAny = isSubmittingApt || isSubmittingCoding || isSubmittingInterview;
    // What the server keeps for the active section: scored if the section ends first, and handed back by a resume after a reload.
    const buildDraftPayload = () => {
        if (currentStage === 'aptitude') return { answers: aptitudeAnswers };
        if (currentStage === 'coding') return { solutions: codeSolutions };
        return {
            answers: segmentInterviewTranscript(interviewQuestions, voiceTranscript, interviewResponses),
            transcript: voiceTranscript.map(({ role, text }) => ({ role, text })),
        };
    };
    useEffect(() => {
        if (!['aptitude', 'coding', 'interview'].includes(currentStage) || submittingAny || sessionData?.is_completed) return undefined;
        const timer = setTimeout(() => {
            const payload = buildDraftPayload();
            Promise.resolve(api.saveDraft(currentStage, payload, violations)).catch(() => {});   // best effort; never blocks the candidate
        }, DRAFT_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [api, currentStage, aptitudeAnswers, codeSolutions, interviewResponses, voiceTranscript, violations, submittingAny, sessionData?.is_completed]);

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
                {!isRecruitment && (
                    <button
                        onClick={() => navigate('/assessment/setup')}
                        className="mt-6 px-6 py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-all cursor-pointer"
                    >
                        Return to Assessment Setup
                    </button>
                )}
            </div>
        );
    }

    // The coding workspace fills the window like LeetCode: no global header, no page padding, panels flush to the edges with a small gutter.
    const codingWorkspaceActive = currentStage === 'coding' && !codingSubmitResult && !!sessionData?.coding_unlocked;
    const codingDark = codingWorkspaceActive && workspaceTheme === 'dark';

    return (
        <MotionConfig reducedMotion="user">
        <div className={`min-h-screen ${codingDark ? 'bg-[#0f0f0f]' : 'bg-[#F8FAFC]'} ${codingWorkspaceActive ? 'lg:h-[100dvh] lg:overflow-hidden' : ''} text-slate-900 flex flex-col font-sans selection:bg-emerald-100 selection:text-emerald-900 select-none`}>
            <ProtectionLayer obscured={pageObscured} watermark={watermarkText} protectionOn={protectionOn} testMode={PROTECTION_TEST_MODE} />
            <AssessmentLoadingOverlay
                open={isSubmittingApt}
                title="Evaluating your aptitude round"
                subtitle="We are scoring your answers and unlocking the coding round."
                stages={APTITUDE_SUBMIT_STAGES}
                tips={SUBMIT_TIPS}
                expectedMs={MIN_SUBMIT_ANIMATION_MS}
                done={submitDone}
                footnote="Please keep this page open. This usually takes a few seconds."
            />
            <AssessmentLoadingOverlay
                open={isSubmittingCoding}
                title="Evaluating your code"
                subtitle="Your solutions are running against the hidden tests."
                stages={CODING_SUBMIT_STAGES}
                tips={SUBMIT_TIPS}
                expectedMs={15000}
                done={submitDone}
                footnote="Please keep this page open. This takes about 15 seconds."
            />
            <AssessmentLoadingOverlay
                open={isSubmittingInterview}
                title="Analysing your interview"
                subtitle="We are scoring your answers and preparing your report."
                stages={INTERVIEW_SUBMIT_STAGES}
                tips={SUBMIT_TIPS}
                expectedMs={8000}
                done={submitDone}
                footnote="Please keep this page open. This usually takes a few seconds."
            />
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
            {!codingWorkspaceActive && (
            <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3 flex-shrink-0 z-30 shadow-xs">
                <div className="w-full max-w-[1700px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
                    {/* Left: PrepWin Brand & Target Position */}
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-lg font-extrabold text-slate-900 tracking-tight">PrepWin</span>
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold uppercase tracking-wider flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-600" /> Proctored
                            </span>
                        </div>
                        <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />
                        <p className="text-xs text-slate-600 truncate min-w-0 max-w-xs sm:max-w-md">
                            Role: <strong className="text-slate-900">{sessionData?.target_role}</strong> {sessionData?.target_company && `• ${sessionData.target_company}`}
                        </p>
                    </div>

                    {/* Center: Sequential Round Stepper */}
                    <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl border border-slate-200 overflow-x-auto max-w-full [&>*]:shrink-0 [&>*]:whitespace-nowrap [scrollbar-width:none]">
                        {/* Step 1: Instructions */}
                        <div className={`relative isolate flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-bold transition-colors ${
                            currentStage === 'instructions'
                                ? 'text-slate-900'
                                : 'text-slate-600'
                        }`}>
                            {currentStage === 'instructions' && <StepHighlight />}
                            <Award className="w-3.5 h-3.5 text-emerald-600" />
                            <span>1. Instructions</span>
                            {currentStage !== 'instructions' && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 2: Device Check */}
                        <div className={`relative isolate flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-bold transition-colors ${
                            currentStage === 'device_check'
                                ? 'text-slate-900'
                                : currentStage === 'instructions'
                                    ? 'text-slate-400'
                                    : 'text-slate-600'
                        }`}>
                            {currentStage === 'device_check' && <StepHighlight />}
                            <Video className="w-3.5 h-3.5 text-emerald-600" />
                            <span>2. Device Check</span>
                            {currentStage !== 'instructions' && currentStage !== 'device_check' && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 3: Aptitude */}
                        <div className={`relative isolate flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-bold transition-colors ${
                            currentStage === 'aptitude'
                                ? 'text-emerald-700'
                                : sessionData?.coding_unlocked
                                    ? 'text-slate-700'
                                    : 'text-slate-400'
                        }`}>
                            {currentStage === 'aptitude' && <StepHighlight />}
                            <BrainCircuit className={`w-3.5 h-3.5 ${currentStage === 'aptitude' ? 'text-emerald-600' : ''}`} />
                            <span>3. Aptitude</span>
                            {sessionData?.coding_unlocked && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 4: Coding */}
                        <div className={`relative isolate flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-bold transition-colors ${
                            currentStage === 'coding'
                                ? 'text-cyan-700'
                                : sessionData?.coding_unlocked
                                    ? 'text-slate-700'
                                    : 'text-slate-400'
                        }`}>
                            {currentStage === 'coding' && <StepHighlight />}
                            <Code2 className={`w-3.5 h-3.5 ${currentStage === 'coding' ? 'text-cyan-600' : ''}`} />
                            <span>4. Coding</span>
                            {!sessionData?.coding_unlocked && <Lock className="w-3 h-3 text-slate-400" />}
                            {sessionData?.interview_unlocked && <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>

                        {/* Step 5: Interview */}
                        <div className={`relative isolate flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-bold transition-colors ${
                            currentStage === 'interview'
                                ? 'text-amber-700'
                                : sessionData?.interview_unlocked
                                    ? 'text-slate-700'
                                    : 'text-slate-400'
                        }`}>
                            {currentStage === 'interview' && <StepHighlight />}
                            <MessageSquare className={`w-3.5 h-3.5 ${currentStage === 'interview' ? 'text-amber-600' : ''}`} />
                            <span>5. Interview</span>
                            {!sessionData?.interview_unlocked && <Lock className="w-3 h-3 text-slate-400" />}
                        </div>
                    </div>

                    {/* Right: Round Countdown Timer & Warnings Pill */}
                    <div className="flex items-center gap-3">
                        {currentStage !== 'instructions' && currentStage !== 'device_check' && (
                            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold border transition-colors duration-500 ${
                                timeLeft <= 120
                                    ? `bg-red-50 text-red-700 border-red-300 ${timeLeft <= 60 ? 'animate-pulse motion-reduce:animate-none' : ''}`
                                    : timeLeft <= 300
                                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                                        : 'bg-slate-50 text-slate-800 border-slate-200'
                            }`}>
                                <Clock className={`w-3.5 h-3.5 ${timeLeft <= 120 ? 'text-red-600' : timeLeft <= 300 ? 'text-amber-600' : 'text-emerald-600'}`} />
                                <span aria-label="Section time remaining">{formatTimer(timeLeft)}</span>
                            </div>
                        )}
                        {currentStage !== 'instructions' && currentStage !== 'device_check' && overallLeft !== null && (
                            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-bold border bg-slate-50 text-slate-600 border-slate-200" title="Time left for the whole assessment (60 minutes)">
                                <span className="text-[10px] uppercase tracking-wider text-slate-400">Total</span>
                                <span aria-label="Overall time remaining">{formatTimer(overallLeft)}</span>
                            </div>
                        )}

                        {/* Malpractice Strike Pill */}
                        {currentStage !== 'instructions' && currentStage !== 'device_check' && (
                            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold border ${
                                violationCount === 0 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : violationCount === 1 
                                        ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse motion-reduce:animate-none'  
                                        : 'bg-red-50 text-red-700 border-red-300 animate-pulse motion-reduce:animate-none'
                            }`}>
                                <Shield className="w-3.5 h-3.5" />
                                <span>{strikeLimit ? `Warnings: ${violationCount}/${strikeLimit}` : `Events ${violationCount}/${MAX_INTEGRITY_EVENTS}`}</span>
                            </div>
                        )}
                    </div>
                </div>
            </header>
            )}

            {/* Malpractice Warning Banner (Non-Blocking Alert) */}
            {warningBanner && currentStage !== 'instructions' && currentStage !== 'device_check' && (
                <div className={`w-full px-4 sm:px-8 py-2.5 border-b text-xs font-semibold flex items-center justify-between transition-all ${
                    warningBanner.level === 'terminal' 
                        ? 'bg-red-600 text-white border-red-700' 
                        : warningBanner.level === 'critical' 
                            ? 'bg-orange-500 text-white border-orange-600 shadow-md' 
                            : 'bg-amber-50 text-amber-900 border-amber-300'
                }`}>
                    <div className="w-full max-w-[1700px] mx-auto flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{warningBanner.message}</span>
                    </div>
                </div>
            )}

            {/* =========================================================== */}
            {/* MAIN WORKSPACE: FULL VIEWPORT (~85-95% WIDTH) */}
            {/* =========================================================== */}
            <main className={codingWorkspaceActive
                ? 'flex-1 min-h-0 w-full flex flex-col p-2 overflow-y-auto'
                : 'flex-1 w-full max-w-[1700px] mx-auto p-4 sm:p-6 lg:p-8 overflow-y-auto'}>
                {/* --------------------------------------------------------- */}
                {/* STAGE 1: ASSESSMENT INSTRUCTIONS */}
                {/* --------------------------------------------------------- */}
                {currentStage === 'instructions' && (
                    <div className="max-w-5xl mx-auto space-y-6">
                        {/* Header Banner Card */}
                        <Enter className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-4 sm:p-8 shadow-sm space-y-6">
                            <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full bg-emerald-200/30 blur-3xl" />
                            <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-slate-100">
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
                                    <p className="text-sm text-emerald-800 font-medium mt-2">
                                        You've prepared for this. Here's exactly what to expect, so there are no surprises.
                                    </p>
                                </div>
                                <div className="flex items-stretch gap-3 w-full sm:w-auto">
                                    <div className="flex-1 sm:flex-none bg-slate-50 border border-slate-200 px-5 py-2.5 rounded-xl text-center">
                                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Evaluation Flow</span>
                                        <p className="text-sm font-extrabold text-emerald-700 mt-0.5">3 Sequential Rounds</p>
                                    </div>
                                    <div className="flex-1 sm:flex-none bg-emerald-50 border border-emerald-200 px-5 py-2.5 rounded-xl text-center">
                                        <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700">Total Time</span>
                                        <p className="text-sm font-extrabold text-emerald-800 mt-0.5 flex items-center justify-center gap-1">
                                            <Clock className="w-3.5 h-3.5" /> ~<Counter to={60} /> mins
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Time split bar */}
                            <div className="relative" aria-hidden="true">
                                <div className="flex h-2 rounded-full overflow-hidden gap-0.5 bg-slate-100">
                                    {[
                                        { w: '33.3%', c: 'bg-emerald-500' },
                                        { w: '33.3%', c: 'bg-cyan-500' },
                                        { w: '33.3%', c: 'bg-amber-500' },
                                    ].map((seg, i) => (
                                        <motion.div
                                            key={i}
                                            className={`h-full ${seg.c}`}
                                            style={{ width: seg.w, originX: 0 }}
                                            initial={{ scaleX: 0 }}
                                            animate={{ scaleX: 1 }}
                                            transition={{ duration: 0.7, delay: 0.3 + i * 0.2, ease: [0.16, 1, 0.3, 1] }}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* 3-Round Timeline Cards */}
                            <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4">
                                {[
                                    { label: 'Round 1', mins: '20 Mins', title: 'Aptitude & Reasoning', Icon: BrainCircuit, desc: 'Role-tailored domain logic, psychometrics, and quantitative problem solving questions. Counts for one third of your overall score.', hover: 'hover:border-emerald-300 hover:shadow-emerald-100', lab: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-800', ic: 'text-emerald-600' },
                                    { label: 'Round 2', mins: '20 Mins', title: 'Sandboxed Coding', Icon: Code2, desc: 'Real coding problems executed in an isolated runtime container against public and hidden test cases.', hover: 'hover:border-cyan-300 hover:shadow-cyan-100', lab: 'text-cyan-700', pill: 'bg-cyan-100 text-cyan-800', ic: 'text-cyan-600' },
                                    { label: 'Round 3', mins: '10 Mins', title: 'Technical Interview', Icon: MessageSquare, desc: 'Conversational voice / defense questions synthesized directly from your JD and resume background.', hover: 'hover:border-amber-300 hover:shadow-amber-100', lab: 'text-amber-700', pill: 'bg-amber-100 text-amber-800', ic: 'text-amber-600' },
                                ].map((r, i) => (
                                    <Enter
                                        key={r.label}
                                        delay={0.15 + i * 0.12}
                                        hover
                                        className={`p-5 rounded-xl bg-slate-50 border border-slate-200 ${r.hover} hover:shadow-lg transition-[border-color,box-shadow] space-y-2`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className={`text-xs font-bold ${r.lab} uppercase tracking-wider`}>{r.label}</span>
                                            <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${r.pill} font-mono font-bold`}>{r.mins}</span>
                                        </div>
                                        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                            <r.Icon className={`w-4 h-4 ${r.ic}`} /> {r.title}
                                        </h3>
                                        <p className="text-xs text-slate-600 leading-relaxed">{r.desc}</p>
                                    </Enter>
                                ))}
                            </div>
                        </Enter>

                        {/* Assessment Rules & Guidelines Card */}
                        <Enter delay={0.3} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-8 shadow-sm space-y-6">
                            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-amber-600" />
                                Rules & 3-Warning Integrity Policy
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                                {[
                                    { n: 1, badge: 'bg-emerald-100 text-emerald-800', title: 'Strict Fullscreen Enforcement', text: 'The assessment must be taken in uninterrupted fullscreen mode. Exiting fullscreen triggers a 10-second recovery gate before logging a malpractice violation.' },
                                    { n: 2, badge: 'bg-amber-100 text-amber-800', title: '3-Warning Malpractice Policy', text: 'Tab switches, window defocus, loss of candidate presence, or external devices are recorded as strikes. On the 3rd strike, your assessment is immediately terminated and auto-submitted.' },
                                    { n: 3, badge: 'bg-cyan-100 text-cyan-800', title: 'Sequential Round Unlocking', text: 'You must complete and submit each round in sequence (Aptitude → Coding → Interview). Completed rounds are permanently sealed on the server and cannot be retaken.' },
                                    { n: 4, badge: 'bg-indigo-100 text-indigo-800', title: 'Device & Hardware Readiness', text: 'A functional webcam and microphone are required for AI vision proctoring and technical defense. You will verify your devices on the next step.' },
                                ].map((rule, i) => (
                                    <Enter
                                        key={rule.n}
                                        delay={0.4 + i * 0.09}
                                        y={12}
                                        hover
                                        className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 hover:shadow-md transition-[border-color,box-shadow] space-y-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className={`w-6 h-6 rounded-full ${rule.badge} font-bold flex items-center justify-center shrink-0 text-xs`}>{rule.n}</div>
                                            <h4 className="text-xs font-bold text-slate-900">{rule.title}</h4>
                                        </div>
                                        <p className="text-xs text-slate-600 leading-relaxed pl-8">{rule.text}</p>
                                    </Enter>
                                ))}
                            </div>

                            {/* Bottom CTA to Step 2 */}
                            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="text-xs text-slate-500 text-center sm:text-left">
                                    Step 1 of 2 Before Launch • No questions or camera feeds active on this page.
                                </div>
                                <motion.button
                                    type="button"
                                    onClick={() => {
                                        setCurrentStage('device_check');
                                        initHardware();
                                    }}
                                    whileHover={{ scale: 1.03 }}
                                    whileTap={{ scale: 0.97 }}
                                    className="group w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-700/20 hover:shadow-lg hover:shadow-emerald-700/30 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>Continue to Device Check</span>
                                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                                </motion.button>
                            </div>
                        </Enter>
                    </div>
                )}

                {/* --------------------------------------------------------- */}
                {/* STAGE 2: HARDWARE & PROCTORING DEVICE CHECK */}
                {/* --------------------------------------------------------- */}
                {currentStage === 'device_check' && (
                    <div className="max-w-6xl mx-auto space-y-6">
                        {/* Header Banner */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
                                className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Re-test Devices
                            </button>
                        </div>

                        {/* 2-Column Responsive Layout: Left Hardware Live Stream + Right Launch Gate */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            {/* Left: Hardware Verification & Live Video Preview (6 Cols) */}
                            <Enter delay={0.1} className="min-w-0 lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
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
                                            <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-pw-ping motion-reduce:animate-none" /><span className="relative w-2 h-2 rounded-full bg-emerald-400" /></span>
                                            <span>Live Camera Feed Verified</span>
                                        </div>
                                    )}

                                    {cameraStatus === 'allowed' && (
                                        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                                            {[
                                                'top-2 left-2 border-t-2 border-l-2 rounded-tl-lg',
                                                'top-2 right-2 border-t-2 border-r-2 rounded-tr-lg',
                                                'bottom-2 left-2 border-b-2 border-l-2 rounded-bl-lg',
                                                'bottom-2 right-2 border-b-2 border-r-2 rounded-br-lg',
                                            ].map((c, i) => (
                                                <motion.span
                                                    key={i}
                                                    className={`absolute w-6 h-6 border-emerald-400/90 ${c}`}
                                                    initial={{ opacity: 0, scale: 1.6 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    transition={{ duration: 0.45, delay: 0.1 + i * 0.08, ease: 'easeOut' }}
                                                />
                                            ))}
                                            <motion.div
                                                className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/80 to-transparent"
                                                initial={{ top: '0%', opacity: 0.9 }}
                                                animate={{ top: '100%', opacity: 0 }}
                                                transition={{ duration: 1.4, delay: 0.3, ease: 'easeInOut' }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Status indicators */}
                                <Stagger className="space-y-2.5 text-xs" delay={0.25} gap={0.14}>
                                    <StaggerItem y={10} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Camera className="w-4 h-4 text-slate-500" /> Web Camera Feed
                                        </span>
                                        <motion.span key={cameraStatus} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className={`font-bold ${cameraStatus === 'allowed' ? 'text-emerald-700' : cameraStatus === 'denied' ? 'text-red-700' : 'text-amber-700'}`}>
                                            {cameraStatus === 'allowed' ? 'Connected & Verified ✅' : cameraStatus === 'denied' ? 'Permission Denied ❌' : 'Checking...'}
                                        </motion.span>
                                    </StaggerItem>

                                    <StaggerItem y={10} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Mic className="w-4 h-4 text-slate-500" /> Microphone
                                        </span>
                                        <motion.span key={micStatus} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className={`font-bold ${micStatus === 'allowed' ? 'text-emerald-700' : micStatus === 'denied' ? 'text-red-700' : 'text-slate-500'}`}>
                                            {micStatus === 'allowed'
                                                ? (mic.heardSound ? 'Voice detected ✅' : 'Allowed. Say something to test')
                                                : micStatus === 'denied' ? 'Permission Denied' : 'Optional / Text Fallback'}
                                        </motion.span>
                                    </StaggerItem>

                                    <StaggerItem y={10}>
                                        <MicrophonePicker mic={mic} idPrefix="devicecheck-mic" />
                                    </StaggerItem>

                                    <StaggerItem y={10} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-slate-500" /> AI Vision Engine (YOLOv8n)
                                        </span>
                                        <motion.span key={modelStatus} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className={`font-bold ${modelStatus === 'ready' ? 'text-emerald-700' : modelStatus === 'error' ? 'text-amber-700' : 'text-slate-500'}`}>
                                            {modelStatus === 'ready' ? 'Online & Validated (CPU) 🛡️' : modelStatus === 'error' ? 'Offline (Fallback Mode)' : 'Checking Model...'}
                                        </motion.span>
                                    </StaggerItem>

                                    <StaggerItem y={10} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                        <span className="text-slate-700 font-medium flex items-center gap-2">
                                            <Maximize className="w-4 h-4 text-slate-500" /> Fullscreen Mode
                                        </span>
                                        <motion.span key={'fs'} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className="font-bold text-emerald-700">Enforced on Launch 🛡️</motion.span>
                                    </StaggerItem>
                                </Stagger>
                            </Enter>

                            {/* Right: Fullscreen Confirmation & Launch Gate (6 Cols) */}
                            <Enter delay={0.2} className="min-w-0 lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6 flex flex-col justify-between">
                                <div className="space-y-4">
                                    <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100 flex items-center gap-2">
                                        <Maximize className="w-5 h-5 text-emerald-600" />
                                        Fullscreen Confirmation & Launch
                                    </h3>

                                    {resumeInfo && (
                                        <div id="resume-notice" className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 leading-relaxed space-y-1.5">
                                            <strong className="block font-bold">Your assessment is still running</strong>
                                            <p>
                                                The page was reloaded and the reload has been recorded. The timer did not stop: continue from the {resumeRestore?.sectionKey || 'current'} section.
                                                Your saved answers and your recorded integrity events ({resumeRestore?.counted ?? 0}/{MAX_INTEGRITY_EVENTS}) are restored. Check your camera, then choose Resume.
                                            </p>
                                            {resumeRestore?.sectionKey === 'interview' && (
                                                <p className="font-semibold">The interview conversation starts again from the beginning; the answers already saved are kept.</p>
                                            )}
                                        </div>
                                    )}
                                    <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-slate-700 leading-relaxed space-y-2">
                                        <strong className="text-emerald-900 block font-bold">Fullscreen Proctoring Environment:</strong>
                                        <p>
                                            When you click <strong>{resumeInfo ? 'Resume Assessment & Enter Fullscreen' : 'Start Assessment & Enter Fullscreen'}</strong>, your browser will switch to locked fullscreen mode.
                                        </p>
                                        <p>
                                            {isRecruitment
                                                ? `Leaving fullscreen, switching tabs, or other people or devices appearing in your camera view are recorded as integrity events for the hiring team. Switching to another tab more than once disqualifies you, and more than ${MAX_INTEGRITY_EVENTS} integrity events end your assessment. A 10-second countdown recovery window is provided for accidental fullscreen exits.`
                                                : 'Any attempt to exit fullscreen, switch tabs, or use external monitors will trigger an integrity warning. A 10-second countdown recovery window is provided for accidental exits.'}
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
                                    {!resumeInfo && <label className={`flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl border transition-all duration-300 ${instructionsAccepted ? 'bg-emerald-50 border-emerald-300 shadow-sm' : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'}`}>
                                        <input
                                            type="checkbox"
                                            checked={instructionsAccepted}
                                            onChange={(e) => setInstructionsAccepted(e.target.checked)}
                                            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer transition-transform active:scale-90"
                                        />
                                        <span className="text-xs text-slate-800 font-semibold leading-relaxed">
                                            I have read, understood, and accept the assessment instructions, hardware requirements, and proctoring integrity policy.
                                        </span>
                                        {instructionsAccepted && (
                                            <PopIn className="ml-auto shrink-0"><CheckCircle className="w-5 h-5 text-emerald-600" /></PopIn>
                                        )}
                                    </label>}

                                    <div className="flex flex-col sm:flex-row items-center gap-3">
                                        {(!isRecruitment || onBackToInstructions) && (
                                        <button
                                            type="button"
                                            onClick={() => (isRecruitment ? onBackToInstructions() : setCurrentStage('instructions'))}
                                            className="w-full sm:w-auto min-h-[48px] px-4 py-3.5 rounded-xl font-bold text-xs border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer active:scale-[0.98]"
                                        >
                                            Back to Instructions
                                        </button>
                                        )}

                                        <button
                                            type="button"
                                            disabled={!instructionsAccepted || isStartingAssessment || cameraStatus !== 'allowed'}
                                            onClick={handleStartAssessment}
                                            className={`relative overflow-hidden flex-1 w-full min-h-[48px] py-3.5 px-6 rounded-xl font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer ${
                                                instructionsAccepted && cameraStatus === 'allowed'
                                                    ? 'bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 bg-[length:200%_100%] animate-pw-shimmer motion-reduce:animate-none text-white shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300/60 hover:shadow-emerald-500/60 active:scale-[0.985]'
                                                    : 'bg-slate-200 text-slate-400 border border-slate-200 cursor-not-allowed'
                                            }`}
                                        >
                                            {instructionsAccepted && cameraStatus === 'allowed' && !isStartingAssessment && (
                                                <motion.span
                                                    aria-hidden="true"
                                                    className="pointer-events-none absolute inset-y-0 left-0 w-1/4 -skew-x-12 bg-white/30"
                                                    initial={{ x: '-150%' }}
                                                    animate={{ x: '500%' }}
                                                    transition={{ duration: 0.9, ease: 'easeInOut', delay: 0.15 }}
                                                />
                                            )}
                                            {isStartingAssessment ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    <span>Entering Fullscreen Assessment...</span>
                                                </>
                                            ) : (
                                                <>
                                                    {resumeInfo ? <span>Resume Assessment & Enter Fullscreen</span> : <span>Start Assessment & Enter Fullscreen</span>}
                                                    <ArrowRight className="w-4 h-4" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </Enter>
                        </div>
                    </div>
                )}

                {/* --------------------------------------------------------- */}
                {/* STAGE 3: ROUND 1 — APTITUDE & REASONING (2-COL WORKSPACE) */}
                {/* --------------------------------------------------------- */}
                {currentStage === 'aptitude' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* ── Main Area (~75% / 9 Cols): Question, Options, Controls ── */}
                        <div className="min-w-0 lg:col-span-9 bg-white border border-slate-200 rounded-2xl p-4 sm:p-8 shadow-sm space-y-6">
                            {/* Question Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <BrainCircuit className="w-5 h-5 text-emerald-600" />
                                        Round 1: Role-Specific Aptitude & Reasoning
                                    </h2>
                                    <p className="text-xs text-slate-500">{isRecruitment
                                        ? 'Unanswered questions score zero. Submitting is final and starts the Coding section immediately.'
                                        : 'Answer all questions to unlock the Sandboxed Coding Round.'}</p>
                                </div>
                                <div className="text-xs font-mono font-bold px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 self-start sm:self-auto">
                                    Question {currentAptIndex + 1} of {aptitudeQuestions.length}
                                </div>
                            </div>

                            <div className="flex items-center gap-3 -mt-2">
                                <ProgressBar value={Object.keys(aptitudeAnswers).length} total={aptitudeQuestions.length} className="flex-1" />
                                <span className="text-[11px] font-mono font-bold text-slate-500 shrink-0">
                                    {Object.keys(aptitudeAnswers).length}/{aptitudeQuestions.length} answered
                                </span>
                            </div>

                            {/* Question Body */}
                            {aptitudeQuestions.length > 0 ? (
                                (() => {
                                    const activeQ = aptitudeQuestions[currentAptIndex];
                                    const selected = aptitudeAnswers[String(activeQ.id)];
                                    return (
                                        <SlideSwap index={currentAptIndex} className="space-y-6">
                                            <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-800 font-bold">
                                                <span>Category:</span>
                                                <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 font-mono">
                                                    {activeQ.topic || "Domain Logic"}
                                                </span>
                                                <QuestionProvenance provenance={activeQ.provenance} styleCompany={activeQ.style_company} />
                                            </div>

                                            <h3 className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed">
                                                {activeQ.question}
                                            </h3>

                                            {/* Answer Choices (A, B, C, D) */}
                                            <div className="space-y-3 pt-2">
                                                {(activeQ.options || []).map((opt) => {
                                                    const isSelected = selected === opt.key;
                                                    return (
                                                        <motion.button
                                                            key={opt.key}
                                                            type="button"
                                                            onClick={() => handleSelectOption(activeQ.id, opt.key)}
                                                            whileTap={{ scale: 0.985 }}
                                                            animate={{ scale: isSelected ? 1.006 : 1 }}
                                                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                                            className={`w-full min-h-[56px] text-left p-4 rounded-xl border-2 transition-colors duration-200 flex items-center gap-4 cursor-pointer ${
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
                                                            {isSelected && (
                                                                <PopIn className="ml-auto shrink-0"><CheckCircle className="w-5 h-5 text-emerald-600" /></PopIn>
                                                            )}
                                                        </motion.button>
                                                    );
                                                })}
                                            </div>

                                            {/* Bottom Navigation & Submit Actions */}
                                            <div className="flex flex-wrap items-center justify-between gap-3 pt-6 border-t border-slate-100 mt-6">
                                                <button
                                                    type="button"
                                                    disabled={currentAptIndex === 0}
                                                    onClick={() => setCurrentAptIndex(prev => prev - 1)}
                                                    className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all active:scale-95"
                                                >
                                                    Previous Question
                                                </button>

                                                <div className="flex items-center gap-3">
                                                    {currentAptIndex < aptitudeQuestions.length - 1 ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentAptIndex(prev => prev + 1)}
                                                            className="min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                                        >
                                                            <span>Next Question</span>
                                                            <ChevronRight className="w-3.5 h-3.5" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={isSubmittingApt}
                                                            onClick={handleSubmitAptitude}
                                                            className="min-h-[44px] px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md cursor-pointer transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                                                        >
                                                            {isSubmittingApt ? "Evaluating Responses..." : "Submit Aptitude & Unlock Coding Round"}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </SlideSwap>
                                    );
                                })()
                            ) : (
                                <div className="p-6 sm:p-12 text-center text-slate-500">
                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                                    <p>Loading aptitude questions...</p>
                                </div>
                            )}
                        </div>

                        {/* ── Side Panel (~25% / 3 Cols): Proctoring, Warnings & Navigator ── */}
                        <div className="min-w-0 lg:col-span-3 space-y-4">
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
                                    violationCount={violationCount} limit={strikeLimit}
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
                                        {strikeLimit ? `${violationCount}/${strikeLimit} Strikes` : `${violationCount}/${MAX_INTEGRITY_EVENTS} events`}
                                    </span>
                                </div>
                                {strikeLimit && <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
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
                                </div>}
                                {/* Recruitment ('flag' policy): events are shared with the hiring team; switching tabs twice, or more than MAX_INTEGRITY_EVENTS events, ends the attempt. */}
                                {!strikeLimit && (
                                    <p className="text-[11px] text-slate-500 leading-tight">
                                        {violationCount === 0
                                            ? "No integrity events detected."
                                            : `Integrity events are recorded for the hiring team. Switching tabs twice, or more than ${MAX_INTEGRITY_EVENTS} events, ends your assessment.`}
                                    </p>
                                )}
                                {strikeLimit && (
                                    <p className="text-[11px] text-slate-500 leading-tight">
                                        {violationCount === 0 && "No violations detected. Session running in good standing."}
                                        {violationCount === 1 && "Warning 1 recorded. Please do not switch tabs or minimize window."}
                                        {violationCount === 2 && "Final warning! 1 more strike will automatically submit your test."}
                                        {violationCount >= 3 && "Maximum strikes exceeded. Assessment terminated."}
                                    </p>
                                )}
                            </div>

                            {/* Question Palette Widget */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                    <span className="text-xs font-bold text-slate-900">Question Palette</span>
                                    <span className="text-[11px] text-slate-500 font-mono">
                                        {Object.keys(aptitudeAnswers).length} / {aptitudeQuestions.length} Answered
                                    </span>
                                </div>

                                <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-5 gap-2">
                                    {aptitudeQuestions.map((q, idx) => {
                                        const isAnswered = !!aptitudeAnswers[String(q.id)];
                                        const isCurrent = currentAptIndex === idx;
                                        return (
                                            <motion.button
                                                key={q.id}
                                                type="button"
                                                onClick={() => setCurrentAptIndex(idx)}
                                                whileTap={{ scale: 0.92 }}
                                                animate={{ scale: isCurrent ? 1.08 : 1 }}
                                                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                                                className={`h-10 rounded-lg text-xs font-bold transition-colors duration-200 cursor-pointer ${
                                                    isCurrent
                                                        ? 'bg-white border-2 border-blue-600 text-blue-700 shadow-sm'
                                                        : isAnswered
                                                            ? 'bg-emerald-600 text-white font-bold'
                                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                {idx + 1}
                                            </motion.button>
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
                    <div className={`flex flex-col min-h-0 ${codingWorkspaceActive ? 'lg:flex-1' : 'space-y-4'}`}>
                        {codingSubmitResult ? (
                            <div id="coding-submitted-card" className="bg-white rounded-2xl border border-emerald-200 shadow-sm max-w-2xl w-full mx-auto my-4 p-6 sm:p-8 space-y-5">
                                <div className="flex items-start gap-3">
                                    <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                                        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-lg font-bold text-slate-900">Coding round submitted</h3>
                                        <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                                            {codingSubmitResult.evaluation_pending
                                                ? (isRecruitment
                                                    ? 'Your solutions are saved and will be evaluated separately. The interview timer has already started.'
                                                    : 'Your solutions are saved and are being evaluated in the background. The interview round is now unlocked.')
                                                : (isRecruitment
                                                    ? 'Your solutions were checked against the hidden tests and saved. The interview timer has already started, so continue now.'
                                                    : 'Your solutions were evaluated against the hidden tests and saved. The interview round is now unlocked.')}
                                        </p>
                                    </div>
                                </div>

                                {codingSubmitResult.evaluation_pending && (
                                    <div id="coding-eval-pending" role="status" className="flex items-start gap-2.5 rounded-xl bg-cyan-50 border border-cyan-200 px-3.5 py-3 text-xs sm:text-sm text-cyan-900">
                                        <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 animate-spin motion-reduce:animate-none" />
                                        <span>{isRecruitment
                                            ? 'Your code is kept and will be checked later. You do not need to wait: continue to the interview.'
                                            : 'Your coding result is on its way. You do not need to wait: continue to the interview and the result will be in your final report.'}</span>
                                    </div>
                                )}

                                {typeof codingSubmitResult.score === 'number' && (
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-4xl font-extrabold text-slate-900 tabular-nums">{Math.round(codingSubmitResult.score)}</span>
                                        <span className="text-sm text-slate-500">/ 100 coding score</span>
                                    </div>
                                )}

                                {(codingSubmitResult.results || []).length > 0 && (
                                    <ul className="space-y-2">
                                        {codingSubmitResult.results.map((r, i) => {
                                            const title = codingProblems.find((p) => String(p.id) === String(r.problem_id))?.title || `Problem ${i + 1}`;
                                            const allPassed = r.total_tests > 0 && r.passed_tests === r.total_tests;
                                            return (
                                                <li key={r.problem_id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5">
                                                    <span className="text-xs sm:text-sm font-semibold text-slate-800 truncate">{title}</span>
                                                    <span className={`text-xs font-bold shrink-0 ${allPassed ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                        {r.passed_tests} / {r.total_tests} tests passed
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}

                                <button
                                    type="button"
                                    id="continue-to-interview-btn"
                                    onClick={continueToInterview}
                                    className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-[0.97]"
                                >
                                    <span>Continue to Interview</span>
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        ) : !sessionData?.coding_unlocked ? (
                            <div className="p-6 sm:p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm max-w-xl mx-auto my-auto space-y-3">
                                <Lock className="w-12 h-12 text-slate-400 mx-auto" />
                                <h3 className="text-lg font-bold text-slate-900">Coding Round is Locked</h3>
                                <p className="text-xs text-slate-600">Complete and submit the Aptitude Round to unlock this challenge.</p>
                            </div>
                        ) : (
                            <div className={`flex flex-col gap-2 lg:flex-1 lg:min-h-[520px] ${workspaceTheme === 'dark' ? 'dark' : ''}`} data-workspace-theme={workspaceTheme}>
                                {/* ONE compact bar: problems | Run + Submit | timers + camera (the page's global header is hidden while this workspace is open) */}
                                <CodingTopBar
                                    problems={codingProblems}
                                    index={currentProblemIndex}
                                    onSelect={(idx) => { setCurrentProblemIndex(idx); setCodeOutput(null); }}
                                    onRun={handleRunCode}
                                    running={isRunningCode}
                                    onSubmit={handleSubmitCoding}
                                    submitting={isSubmittingCoding}
                                    submitLabel={isSubmittingCoding ? "Evaluating Tests..." : (codingSubmitError ? "Retry Submission" : "Submit All & Unlock Interview")}
                                    submitShortLabel={isSubmittingCoding ? 'Evaluating…' : (codingSubmitError ? 'Retry' : 'Submit')}
                                    status={(
                                        <>
                                            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-xs font-bold border transition-colors duration-500 ${
                                                timeLeft <= 120
                                                    ? `bg-red-50 text-red-700 border-red-300 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/40 ${timeLeft <= 60 ? 'animate-pulse motion-reduce:animate-none' : ''}`
                                                    : timeLeft <= 300
                                                        ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40'
                                                        : 'bg-slate-50 text-slate-800 border-slate-200 dark:bg-[#282828] dark:text-slate-100 dark:border-[#3a3a3a]'
                                            }`}>
                                                <Clock className={`w-3.5 h-3.5 ${timeLeft <= 120 ? 'text-red-500' : timeLeft <= 300 ? 'text-amber-500' : 'text-emerald-500'}`} />
                                                <span aria-label="Section time remaining">{formatTimer(timeLeft)}</span>
                                            </div>
                                            {overallLeft !== null && (
                                                <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-xs font-bold border bg-slate-50 text-slate-600 border-slate-200 dark:bg-[#282828] dark:text-slate-300 dark:border-[#3a3a3a]" title="Time left for the whole assessment (60 minutes)">
                                                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Total</span>
                                                    <span aria-label="Overall time remaining">{formatTimer(overallLeft)}</span>
                                                </div>
                                            )}
                                            <div className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap ${
                                                violationCount === 0
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
                                                    : violationCount === 1
                                                        ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/40 animate-pulse motion-reduce:animate-none'
                                                        : 'bg-red-50 text-red-700 border-red-300 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/40 animate-pulse motion-reduce:animate-none'
                                            }`}>
                                                <Shield className="w-3.5 h-3.5" />
                                                <span>{strikeLimit ? `Warnings ${violationCount}/${strikeLimit}` : `Events ${violationCount}/${MAX_INTEGRITY_EVENTS}`}</span>
                                            </div>
                                        </>
                                    )}
                                    camera={(
                                        <ProctorCameraFeed
                                            stream={cameraStream || proctorStream}
                                            detections={detections}
                                            faceBoxes={faceBoxes}
                                            personCount={personCount}
                                            suspectLabel={suspectLabel}
                                            isModelActive={isModelActive}
                                            detectionStatus={detectionStatus}
                                            violationCount={violationCount} limit={strikeLimit}
                                            compact={true}
                                            thumb={true}
                                        />
                                    )}
                                />

                                {codingSubmitError && !isSubmittingCoding && (
                                    <div role="alert" className="shrink-0 flex items-start gap-2.5 rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2 text-xs text-rose-800">
                                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{codingSubmitError}</span>
                                    </div>
                                )}

                                {codingProblems.length > 0 && (() => {
                                    const activeProblem = codingProblems[currentProblemIndex] || codingProblems[0];
                                    const probId = String(activeProblem.id);
                                    const activeLanguage = defaultLanguage(activeProblem);
                                    const curSol = codeSolutions[probId] || { code: starterFor(activeProblem, activeLanguage), language: activeLanguage };

                                        const ranWithResults = codeOutput && (codeOutput.test_results || []).length > 0;
                                        return (
                                            <AssessmentCodingWorkspace
                                                themeIsDark={workspaceTheme === 'dark'}
                                                onToggleTheme={toggleWorkspaceTheme}
                                                key={probId}
                                                problem={activeProblem}
                                                code={curSol.code}
                                                language={curSol.language}
                                                onLanguageChange={(lang) => handleLanguageChange(probId, lang)}
                                                customFields={customFields[probId]}
                                                onCustomFieldsChange={(fields) => setCustomFields((prev) => {
                                                    const next = { ...prev };
                                                    if (fields === undefined) delete next[probId]; else next[probId] = fields;
                                                    return next;
                                                })}
                                                onCodeChange={(val) => handleCodeChange(probId, val)}
                                                onReset={() => { if (window.confirm(`Reset to the starter code? Your current ${languageLabel(curSol.language)} code will be replaced.`)) handleResetCode(); }}
                                                onRun={handleRunCode}
                                                running={isRunningCode}
                                                result={ranWithResults ? codeOutput : null}
                                                error={codeOutput && !ranWithResults ? toDisplayText(codeOutput.error, '') : ''}
                                                badge={<QuestionProvenance provenance={activeProblem.provenance} styleCompany={activeProblem.style_company} />}
                                            />
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
                            <div className="p-6 sm:p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm max-w-xl mx-auto my-auto space-y-3">
                                <Lock className="w-12 h-12 text-slate-400 mx-auto" />
                                <h3 className="text-lg font-bold text-slate-900">Technical Interview is Locked</h3>
                                <p className="text-xs text-slate-600">Complete and submit the Coding Round to unlock the final interview stage.</p>
                            </div>
                        ) : (
                            /* EXACT VOICE ASSISTANT VIDEO INTERVIEW INTERFACE (IMAGE 2) */
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
                                        {voiceCallStatus === 'active' && (
                                            <div data-testid="voice-state" className={`text-xs px-2.5 py-1 rounded font-semibold flex items-center gap-1.5 ${
                                                voiceSpeakingState === 'ai_speaking' ? 'bg-blue-500/20 text-blue-400'
                                                    : voiceSpeakingState === 'processing' ? 'bg-indigo-500/20 text-indigo-300'
                                                        : voiceIsMuted ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                            }`}>
                                                {voiceSpeakingState === 'processing' && <Loader2 className="w-3 h-3 animate-spin" />}
                                                {voiceSpeakingState === 'ai_speaking' ? 'AI Speaking'
                                                    : voiceSpeakingState === 'processing' ? 'Thinking...'
                                                        : voiceIsMuted ? 'Muted'
                                                            : voiceUserSpeaking ? 'Hearing You' : 'Your Turn - Listening'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Main 2-Panel Layout with AI Avatar & Live Transcript */}
                                <div className="flex-1 flex flex-col md:flex-row min-h-[480px]">
                                    {/* LEFT PANEL - AI Interviewer (Image 2) */}
                                    <div className="bg-[#1a1a1a] relative flex-1 flex items-center justify-center p-4 sm:p-8 min-h-[300px] sm:min-h-[380px]">
                                        {/* AI Avatar */}
                                        <div className="relative">
                                            <motion.div
                                                className={`w-44 h-44 sm:w-64 sm:h-64 rounded-full flex items-center justify-center ${
                                                    currentSpeaker === 'ai'
                                                        ? 'bg-gradient-to-br from-blue-600 to-purple-700 shadow-2xl shadow-blue-500/30 ring-8 ring-blue-500/20'
                                                        : 'bg-gradient-to-br from-gray-700 to-gray-800 shadow-2xl'
                                                }`}
                                                animate={{
                                                    scale: currentSpeaker === 'ai' ? [1, 1.05 + Math.min(0.2, voiceVolume * 0.3), 1] : 1
                                                }}
                                                transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                                            >
                                                <div className="text-6xl sm:text-8xl select-none">🤖</div>
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
                                        <div
                                            data-testid="candidate-tile"
                                            className={`relative bg-black aspect-video overflow-hidden transition-all duration-200 ${
                                                voiceCallStatus === 'active' && voiceSpeakingState === 'listening' && !voiceIsMuted
                                                    ? (voiceUserSpeaking ? 'ring-4 ring-inset ring-emerald-400/70' : 'ring-2 ring-inset ring-indigo-400/60 animate-pulse')
                                                    : ''
                                            }`}
                                            style={voiceCallStatus === 'active' && voiceSpeakingState === 'listening' && !voiceIsMuted && voiceUserSpeaking
                                                ? { boxShadow: `inset 0 0 ${16 + voiceUserLevel * 48}px rgba(52, 211, 153, ${0.2 + voiceUserLevel * 0.5})` } : undefined}
                                        >
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
                                                        violationCount={violationCount} limit={strikeLimit}
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute top-3 left-3 bg-gray-900/80 backdrop-blur-sm px-2.5 py-1 rounded text-xs font-medium z-10 text-white border border-white/10 flex items-center gap-1.5">
                                                        <User className="w-3.5 h-3.5 text-emerald-400" />
                                                        <span>You</span>
                                                    </div>
                                                    {voiceCallStatus === 'active' && (
                                                        <div data-testid="mic-badge" className={`absolute bottom-3 left-3 px-3 py-1 rounded-full text-xs font-semibold z-10 shadow-md flex items-center gap-2 border border-white/10 ${
                                                            voiceIsMuted ? 'bg-red-500/90 text-white'
                                                                : voiceSpeakingState === 'listening' ? (voiceUserSpeaking ? 'bg-green-500 text-white' : 'bg-indigo-500/90 text-white')
                                                                    : voiceSpeakingState === 'processing' ? 'bg-indigo-900/90 text-indigo-200'
                                                                        : 'bg-gray-700/90 backdrop-blur-sm text-slate-300 font-medium'
                                                        }`}>
                                                            {voiceIsMuted ? <MicOff className="w-3.5 h-3.5" />
                                                                : voiceSpeakingState === 'processing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                    : <Mic className="w-3.5 h-3.5" />}
                                                            <span>
                                                                {voiceIsMuted ? 'Muted'
                                                                    : voiceSpeakingState === 'listening' ? (voiceUserSpeaking ? 'Hearing you...' : 'Listening...')
                                                                        : voiceSpeakingState === 'processing' ? 'Thinking...'
                                                                            : 'Mic paused'}
                                                            </span>
                                                            {voiceSpeakingState === 'listening' && !voiceIsMuted && (
                                                                <span className="flex items-end gap-0.5 h-3">
                                                                    {[0.08, 0.2, 0.35, 0.5, 0.7].map((step) => (
                                                                        <span key={step} className={`w-0.5 rounded-full transition-all ${voiceUserLevel > step ? 'bg-white h-3' : 'bg-white/30 h-1'}`} />
                                                                    ))}
                                                                </span>
                                                            )}
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

                                            <p className="px-4 pt-2 text-[10px] leading-relaxed text-gray-500">
                                                {captionsUnavailable
                                                    ? 'Live captions are not available in this browser. Your answer is still recorded and transcribed when you finish.'
                                                    : 'Captions appear as you speak and may be corrected once you finish your answer.'}
                                            </p>

                                            <div
                                                ref={voiceTranscriptScrollRef}
                                                className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-[320px] scrollbar-thin scrollbar-thumb-gray-700"
                                            >
                                                {voiceTranscript.length === 0 && !liveCaption && !aiCaption && voiceSpeakingState !== 'processing' ? (
                                                    <p className="text-xs text-gray-600 text-center mt-8">Transcript will appear here...</p>
                                                ) : (
                                                    <AnimatePresence>
                                                        {voiceTranscript.map((entry, idx) => (
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

                                                {/* The interviewer's words as they are spoken, then what the candidate says as they say it (replaced by the final transcript) */}
                                                {aiCaption && <AiLiveCaption caption={aiCaption} />}
                                                {(liveCaption || voiceSpeakingState === 'processing') && (
                                                    <UserLiveCaption text={liveCaption} processing={voiceSpeakingState === 'processing'} />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {(micSilent || showMicPanel) && (
                                    <div className="bg-black/70 border-t border-gray-800 px-4 py-3 shrink-0 space-y-3">
                                        {micSilent && (
                                            <div id="interview-mic-silent" role="alert" className="flex items-start gap-2 text-xs text-amber-300">
                                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                                <span>We cannot hear you. Check that the right microphone is selected, and that it is not muted or covered.</span>
                                                {!showMicPanel && (
                                                    <button type="button" onClick={() => setShowMicPanel(true)} className="ml-auto font-semibold underline shrink-0 cursor-pointer">Choose microphone</button>
                                                )}
                                            </div>
                                        )}
                                        {showMicPanel && (
                                            <div className="max-w-md mx-auto w-full">
                                                <MicrophonePicker mic={mic} dark compact idPrefix="interview-mic" onDeviceChange={applyMicToCall} />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Bottom Control Bar (Image 2) */}
                                <div className="bg-black/50 backdrop-blur-sm border-t border-gray-800 py-4 flex items-center justify-center gap-4 shrink-0">
                                    <button
                                        type="button"
                                        onClick={toggleVoiceMute}
                                        disabled={currentSpeaker === 'ai'}
                                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                                            currentSpeaker === 'ai'
                                                ? 'bg-gray-700 opacity-50 cursor-not-allowed'
                                                : voiceIsMuted
                                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                                        }`}
                                        title={voiceIsMuted ? "Unmute Mic" : "Mute Mic"}
                                    >
                                        {voiceIsMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                    </button>
                                    <button
                                        type="button"
                                        id="interview-mic-settings-btn"
                                        onClick={() => setShowMicPanel((v) => !v)}
                                        aria-pressed={showMicPanel}
                                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer text-white ${showMicPanel ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-700 hover:bg-gray-600'}`}
                                        title="Microphone settings"
                                    >
                                        <Settings className="w-5 h-5" />
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
                                {voiceCallStatus === 'connecting' && (
                                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-40">
                                        <div className="text-center max-w-md p-6">
                                            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                                            <p className="text-lg font-medium text-white">Connecting to AI Interviewer...</p>
                                            <p className="text-sm text-gray-400 mt-2">Please wait while voice connection is initialized...</p>
                                        </div>
                                    </div>
                                )}

                                {/* Error / Assistant ID Override Overlay */}
                                {voiceCallStatus === 'error' && (
                                    <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-40 p-4">
                                        <div className="text-center max-w-md bg-slate-900 border border-red-500/30 p-6 rounded-2xl shadow-2xl">
                                            <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                                <PhoneOff className="w-7 h-7 text-red-500" />
                                            </div>
                                            <p className="text-base font-bold text-red-400">Connection Failed</p>
                                            <p className="text-xs text-gray-400 mt-1 mb-4">{voiceConnectionError || "Could not connect to the AI interviewer."}</p>
                                            
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (voiceConfig) startVoiceCall(voiceConfig);
                                                    else loadInterview();
                                                }}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                            >
                                                Retry Connection
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setWrittenFallback(true)}
                                                className="ml-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                            >
                                                Answer in writing instead
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Written fallback: only reachable after the voice connection failed; voice stays the default */}
                                {writtenFallback && voiceCallStatus === 'error' && (
                                    <div className="absolute inset-0 bg-[#0a0a0a] z-50 overflow-y-auto p-4 sm:p-8">
                                        <div className="max-w-3xl mx-auto space-y-4">
                                            <h3 className="text-base font-bold text-white">Written interview answers</h3>
                                            <p className="text-xs text-gray-400">The voice connection could not be established. Answer each question in writing, then choose Finish interview. Be specific: explain your reasoning, trade-offs and edge cases.</p>
                                            {interviewQuestions.map((q, i) => (
                                                <div key={q.id || i} className="bg-[#161616] border border-gray-800 rounded-xl p-4 space-y-2">
                                                    <p className="text-xs font-bold text-blue-400">Question {i + 1}{q.category ? ` · ${q.category}` : ''}</p>
                                                    <p className="text-sm text-white leading-relaxed">{q.question}</p>
                                                    <textarea
                                                        rows={5}
                                                        maxLength={8000}
                                                        value={interviewResponses[String(q.id)] || ''}
                                                        onChange={(e) => handleInterviewResponseChange(q.id, e.target.value)}
                                                        aria-label={`Written answer to question ${i + 1}`}
                                                        className="w-full bg-gray-950 border border-gray-800 text-white text-xs p-3 rounded-lg focus:border-blue-500 outline-none"
                                                        placeholder="Type your answer here..."
                                                    />
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => setShowEndInterviewModal(true)}
                                                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                                            >
                                                Finish interview
                                            </button>
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
                    <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl border border-slate-100 space-y-5 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mx-auto">
                            <CheckCircle2 className="w-8 h-8" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Finish AI Technical Interview?</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                {isRecruitment
                                    ? 'Your responses and the conversation transcript will be submitted. This is final and cannot be reopened.'
                                    : 'Your spoken responses and full conversation transcript will be submitted for multi-dimensional AI scoring.'}
                            </p>
                        </div>

                        {isSubmittingInterview ? (
                            <div className="py-4 space-y-3">
                                <div className="w-10 h-10 rounded-full border-3 border-emerald-600 border-t-transparent animate-spin mx-auto" />
                                <p className="text-sm font-bold text-slate-800">{isRecruitment ? 'Submitting your interview...' : 'Evaluating Voice Interview with AI...'}</p>
                                <p className="text-xs text-slate-500">{isRecruitment
                                    ? 'Please keep this window open until the confirmation appears.'
                                    : 'Synthesizing speech analysis, communication score, and your final 17-point job readiness dossier.'}</p>
                            </div>
                        ) : (
                            <>
                                {interviewSubmitError && (
                                    <div role="alert" className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-xs text-left">
                                        {interviewSubmitError}
                                    </div>
                                )}
                                <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 space-y-1.5 text-left border border-slate-100">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Live Transcript Items:</span>
                                        <span className="font-semibold text-slate-900">{voiceTranscript.length} messages</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Integrity Violations:</span>
                                        <span className="font-semibold text-emerald-700">{strikeLimit ? `${violationCount} recorded` : `${violationCount}/${MAX_INTEGRITY_EVENTS} events`}</span>
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
        </MotionConfig>
    );
};

/** Student Platform entry: the shared workspace on the authenticated student API (route /assessment/:sessionUuid). */
const RoleReadyAssessment = () => {
    const { sessionUuid } = useParams();
    const api = useMemo(() => createStudentAssessmentApi(sessionUuid), [sessionUuid]);
    return <AssessmentWorkspace sessionUuid={sessionUuid} api={api} />;
};

export default RoleReadyAssessment;
