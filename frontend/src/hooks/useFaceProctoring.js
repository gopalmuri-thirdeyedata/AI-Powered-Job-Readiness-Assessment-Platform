import { useEffect, useRef, useCallback, useState } from 'react';
import API_URL from '../apiConfig';

/**
 * useFaceProctoring
 * Real-time background proctoring using YOLOv8n (via FastAPI backend).
 *
 * Checks camera frame every 3000ms:
 * - No person in frame (after 3 consecutive checks = 9s) → triggers violation
 * - Multiple persons in frame (>= 2)                      → immediate violation
 * - Mobile phone detected (class 'cell phone', conf >= 0.45) → immediate violation
 * - Secondary electronic device (laptop/screen)           → immediate violation
 * - Book / reference notes detected                       → immediate violation
 *
 * @param {Object} options
 * @param {Function} [options.onViolation]   - Callback (reason: string) on confirmed violation
 * @param {Function} [options.onDetection]   - Callback (status: 'detected'|'not_detected'|'multiple')
 * @param {Function} [options.onDetections]  - Callback (detections: Array, faceBoxes: Array)
 * @param {boolean}  [options.enabled=true]  - Toggle background detection on/off
 * @param {MediaStream} [options.externalStream] - Optional existing MediaStream to reuse
 */
const useFaceProctoring = ({
    onViolation,
    onDetection,
    onDetections,
    enabled = true,
    externalStream = null
} = {}) => {
    const streamRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const intervalRef = useRef(null);
    const noPersonCountRef = useRef(0);
    const isRunningRef = useRef(false);
    const frameInFlightRef = useRef(false); // a frame is being analysed: do not send another on top of it
    const lastViolationTimeRef = useRef({});
    const [cameraStream, setCameraStream] = useState(null);

    const [detectionStatus, setDetectionStatus] = useState('idle'); // 'idle' | 'detected' | 'not_detected' | 'multiple'
    const [suspectLabel, setSuspectLabel] = useState(null);
    const [personCount, setPersonCount] = useState(1);
    const [detections, setDetections] = useState([]);
    const [faceBoxes, setFaceBoxes] = useState([]);
    const [isModelActive, setIsModelActive] = useState(false);
    const [modelError, setModelError] = useState(null);

    const suspectTimerRef = useRef(null);
    const onDetectionsRef = useRef(onDetections);
    const onDetectionRef = useRef(onDetection);
    const onViolationRef = useRef(onViolation);

    // Keep callback refs fresh
    useEffect(() => { onDetectionsRef.current = onDetections; }, [onDetections]);
    useEffect(() => { onDetectionRef.current = onDetection; }, [onDetection]);
    useEffect(() => { onViolationRef.current = onViolation; }, [onViolation]);

    const CHECK_INTERVAL_MS = 3000;
    const FRAME_TIMEOUT_MS = 30000; // gives up on a stuck request so detection can carry on
    const NO_PERSON_THRESHOLD = 3; // 3 consecutive checks (~9s)
    const VIOLATION_COOLDOWN_MS = 8000; // 8s cooldown per specific violation reason

    // ── Debounced violation trigger with cooldown ─────────────────────────────
    const triggerViolation = useCallback((reason) => {
        const cb = onViolationRef.current;
        if (!cb) return;
        const now = Date.now();
        const last = lastViolationTimeRef.current[reason] || 0;
        if (now - last < VIOLATION_COOLDOWN_MS) return;
        lastViolationTimeRef.current[reason] = now;
        cb(reason);
    }, []);

    // ── Camera acquisition ────────────────────────────────────────────────────
    const startCamera = async () => {
        // Stop old stream if existing
        if (streamRef.current && streamRef.current !== externalStream) {
            try {
                streamRef.current.getTracks().forEach(t => t.stop());
            } catch (e) {}
            streamRef.current = null;
        }

        // Clean up previous video/canvas
        if (videoRef.current) {
            try {
                videoRef.current.srcObject = null;
                if (videoRef.current.parentNode) videoRef.current.remove();
            } catch (e) {}
            videoRef.current = null;
        }
        if (canvasRef.current) {
            try {
                if (canvasRef.current.parentNode) canvasRef.current.remove();
            } catch (e) {}
            canvasRef.current = null;
        }

        try {
            let stream = externalStream;
            if (!stream || !stream.getVideoTracks().some(t => t.readyState === 'live')) {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 320, height: 240, facingMode: 'user' },
                    audio: false
                });
            }

            streamRef.current = stream;
            setCameraStream(stream);

            // Hidden video element for canvas frame capture
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.width = 320;
            video.height = 240;
            video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
            document.body.appendChild(video);
            videoRef.current = video;

            // Hidden canvas for JPEG export
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
            document.body.appendChild(canvas);
            canvasRef.current = canvas;

            // Wait for video frame readiness
            await new Promise((resolve) => {
                video.onloadedmetadata = resolve;
                setTimeout(resolve, 1500);
            });

            return stream;
        } catch (err) {
            console.warn('[FaceProctoring] Camera initialization failed:', err);
            setModelError(err.message || 'Camera permission denied or device unavailable');
            return null;
        }
    };

    const stopCamera = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (streamRef.current && streamRef.current !== externalStream) {
            try {
                streamRef.current.getTracks().forEach(t => t.stop());
            } catch (e) {}
            streamRef.current = null;
        }
        setCameraStream(null);

        try {
            if (videoRef.current) {
                videoRef.current.srcObject = null;
                if (videoRef.current.parentNode) videoRef.current.remove();
                videoRef.current = null;
            }
        } catch (e) {}

        try {
            if (canvasRef.current) {
                if (canvasRef.current.parentNode) canvasRef.current.remove();
                canvasRef.current = null;
            }
        } catch (e) {}

        isRunningRef.current = false;
        setIsModelActive(false);
    };

    // ── Frame capture + YOLO analysis ─────────────────────────────────────────
    const analyzeFrame = async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) return;
        // Analysis can be slow (the first frame after a server start loads the model). Sending a new frame
        // every 3 seconds regardless would stack requests up and make everything else wait behind them.
        if (frameInFlightRef.current) return;
        frameInFlightRef.current = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FRAME_TIMEOUT_MS);

        try {
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Export compressed JPEG base64
            const base64Image = canvas.toDataURL('image/jpeg', 0.6);

            const response = await fetch(`${API_URL}/api/proctor/analyze-frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image }),
                signal: controller.signal
            });

            if (!response.ok) {
                setIsModelActive(false);
                return;
            }

            const data = await response.json();
            if (data.status === 'error') {
                setModelError(data.error);
                setIsModelActive(false);
                return;
            }

            setIsModelActive(true);
            setModelError(null);

            const violations = data.violations || [];
            const count = data.person_count ?? 1;
            const suspect = data.suspect_label || null;
            const currentDetections = data.detections || [];
            const currentFaceBoxes = data.face_boxes || [];

            setPersonCount(count);
            setDetections(currentDetections);
            setFaceBoxes(currentFaceBoxes);

            if (onDetectionsRef.current) {
                onDetectionsRef.current(currentDetections, currentFaceBoxes);
            }

            // Update suspect label banner
            if (suspect) {
                setSuspectLabel(suspect);
                if (suspectTimerRef.current) clearTimeout(suspectTimerRef.current);
                suspectTimerRef.current = setTimeout(() => setSuspectLabel(null), 6000);
            } else if (!violations.includes('no_person')) {
                setSuspectLabel(null);
            }

            // ── Temporal No-Person Check (3 consecutive frames = ~9s) ──
            if (violations.includes('no_person')) {
                noPersonCountRef.current += 1;
                setDetectionStatus('not_detected');
                if (onDetectionRef.current) onDetectionRef.current('not_detected');

                if (noPersonCountRef.current >= NO_PERSON_THRESHOLD) {
                    noPersonCountRef.current = 0;
                    triggerViolation('Face not visible in camera');
                }
            } else if (count >= 2) {
                noPersonCountRef.current = 0;
                setDetectionStatus('multiple');
                if (onDetectionRef.current) onDetectionRef.current('multiple');
            } else {
                noPersonCountRef.current = 0;
                setDetectionStatus('detected');
                if (onDetectionRef.current) onDetectionRef.current('detected');
            }

            // ── Immediate Violations ──────────────────────────
            if (violations.includes('multiple_persons')) {
                triggerViolation('Multiple persons detected in camera view');
            }
            if (violations.includes('phone_detected')) {
                triggerViolation('Mobile phone detected in camera view');
            }
            if (violations.includes('device_detected')) {
                triggerViolation('Secondary electronic device detected in camera view');
            }
            if (violations.includes('notes_detected')) {
                triggerViolation('Reference material or notes detected in camera view');
            }
        } catch (err) {
            // Suppress network jitter errors from interrupting test
            setIsModelActive(false);
        } finally {
            clearTimeout(timeout);
            frameInFlightRef.current = false;
        }
    };

    // ── Hook Lifecycle ────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const init = async () => {
            if (!enabled) {
                stopCamera();
                return;
            }
            if (isRunningRef.current) return;

            const stream = await startCamera();
            if (!stream || cancelled) {
                if (cancelled) stopCamera();
                return;
            }

            isRunningRef.current = true;

            // Trigger initial analysis frame immediately
            setTimeout(() => {
                if (!cancelled) analyzeFrame();
            }, 500);

            // Start periodic detection loop
            intervalRef.current = setInterval(() => {
                if (!cancelled) analyzeFrame();
            }, CHECK_INTERVAL_MS);
        };

        init();

        return () => {
            cancelled = true;
            stopCamera();
        };
    }, [enabled, externalStream]);

    return {
        cameraStream,
        streamRef,
        detectionStatus,
        suspectLabel,
        personCount,
        detections,
        faceBoxes,
        isModelActive,
        modelError
    };
};

export default useFaceProctoring;
