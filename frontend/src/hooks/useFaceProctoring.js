import { useEffect, useRef, useCallback, useState } from 'react';
import API_URL from '../apiConfig';

/**
 * useFaceProctoring
 * Real-time background proctoring: YOLOv8n objects + a face detector (via FastAPI backend, ONNX Runtime).
 *
 * Checks camera frame every 2000ms:
 * - No face and no person in frame (after 3 consecutive checks = 9s) → triggers violation
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
 * @param {Function} [options.getAuthHeaders] - Returns the credential headers for /api/proctor/analyze-frame. The endpoint is
 *        authenticated: students / the candidate portal use the stored account token (default), shared-link recruitment
 *        candidates pass their session capability (X-Session-Id + X-Session-Token) through their API adapter.
 */

const storedAuthHeaders = () => {
    const headers = {};
    try {
        const token = localStorage.getItem('studentToken') || localStorage.getItem('candidateToken') || localStorage.getItem('token');
        const invitation = localStorage.getItem('invitationToken');
        if (token) headers.Authorization = `Bearer ${token}`;
        if (invitation) headers['X-Invitation-Token'] = invitation;
    } catch { /* storage unavailable: the request goes out unauthenticated and the server refuses it */ }
    return headers;
};

const useFaceProctoring = ({
    onViolation,
    onDetection,
    onDetections,
    enabled = true,
    externalStream = null,
    getAuthHeaders = null
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
    const getAuthHeadersRef = useRef(getAuthHeaders);

    // Keep callback refs fresh
    useEffect(() => { getAuthHeadersRef.current = getAuthHeaders; }, [getAuthHeaders]);
    useEffect(() => { onDetectionsRef.current = onDetections; }, [onDetections]);
    useEffect(() => { onDetectionRef.current = onDetection; }, [onDetection]);
    useEffect(() => { onViolationRef.current = onViolation; }, [onViolation]);

    // 640x480: phones and faces are small, and 320x240 left too little to find them (the server analyses frames up to 640 wide as sent)
    const FRAME_WIDTH = 640;
    const FRAME_HEIGHT = 480;
    const CHECK_INTERVAL_MS = 2000;
    const FRAME_TIMEOUT_MS = 30000; // gives up on a stuck request so detection can carry on
    const NO_PERSON_THRESHOLD = 3; // 3 net missed checks (~6s)
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
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
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
            video.width = FRAME_WIDTH;
            video.height = FRAME_HEIGHT;
            // The capture element must really be rendered: a 1px, fully transparent, far off-screen video is not decoded by Chrome / Edge, and every
            // frame drawn from it is BLACK (the server then sees nobody and "Face not visible" fires constantly). So it is full size and in the page,
            // just behind everything, invisible to the eye and ignored by the mouse.
            video.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px;opacity:0.01;pointer-events:none;z-index:-1;';
            document.body.appendChild(video);
            videoRef.current = video;
            try { await video.play(); } catch (e) { /* autoplay is allowed for a muted stream; analysis waits for readyState anyway */ }

            // Hidden canvas for JPEG export
            const canvas = document.createElement('canvas');
            canvas.width = FRAME_WIDTH;
            canvas.height = FRAME_HEIGHT;
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
                headers: { 'Content-Type': 'application/json', ...(getAuthHeadersRef.current ? getAuthHeadersRef.current() : storedAuthHeaders()) },
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

            // ── Temporal No-Person Check (3 net missed frames = ~6s) ──
            if (violations.includes('no_person')) {
                noPersonCountRef.current += 1;
                setDetectionStatus('not_detected');
                if (onDetectionRef.current) onDetectionRef.current('not_detected');

                if (noPersonCountRef.current >= NO_PERSON_THRESHOLD) {
                    noPersonCountRef.current = 0;
                    triggerViolation('Face not visible in camera');
                }
            } else if (count >= 2) {
                noPersonCountRef.current = Math.max(0, noPersonCountRef.current - 1);      // one lucky frame must not erase a real absence
                setDetectionStatus('multiple');
                if (onDetectionRef.current) onDetectionRef.current('multiple');
            } else {
                noPersonCountRef.current = Math.max(0, noPersonCountRef.current - 1);
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
