import { useState, useEffect, useRef, useCallback } from 'react';
import { exitFullscreenSafely } from '../utils/exitFullscreen';

/**
 * useAssessmentFullscreen
 *
 * Resilient, centralized fullscreen enforcement hook for all candidate assessment rounds
 * (Aptitude, Coding, and Technical Interview).
 *
 * Features:
 * - Explicit entry gate requiring a direct user gesture to trigger document.documentElement.requestFullscreen()
 * - Immediate post-request verification using document.fullscreenElement
 * - fullscreenchange listener for detecting ESC, browser exits, and external drops
 * - 10-second recovery modal countdown upon exit
 * - Debouncing / deduplication of multiple rapid fullscreenchange events
 * - Automatic timer and event listener cleanup on unmount or assessment completion
 * - Prevents stale React closures via stable callback refs
 *
 * @param {object} options
 * @param {boolean}  [options.enabled=true]           - Whether fullscreen proctoring is enabled
 * @param {boolean}  [options.isCompleted=false]       - Disable enforcement once test is submitted/ended
 * @param {number}   [options.recoveryDuration=10]     - Recovery window in seconds (default: 10)
 * @param {Function} [options.onEnterSuccess]         - Fired when fullscreen is successfully established on entry
 * @param {Function} [options.onExit]                 - Fired immediately when fullscreen is lost
 * @param {Function} [options.onRecoverySuccess]      - Fired when candidate re-enters fullscreen within recovery duration
 * @param {Function} [options.onRecoveryTimeout]      - Fired when candidate fails to return within recovery duration
 */
const useAssessmentFullscreen = ({
    enabled = true,
    isCompleted = false,
    recoveryDuration = 10,
    onEnterSuccess,
    onExit,
    onRecoverySuccess,
    onRecoveryTimeout
} = {}) => {
    // Current fullscreen element state
    const [isFullscreen, setIsFullscreen] = useState(() => {
        return typeof document !== 'undefined' ? !!document.fullscreenElement : false;
    });

    // Gate & Recovery states
    const [isGateOpen, setIsGateOpen] = useState(enabled && !isCompleted);
    const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
    const [recoveryTimeLeft, setRecoveryTimeLeft] = useState(recoveryDuration);
    const [error, setError] = useState(null);

    // Refs to eliminate stale closures in async/event listener callbacks
    const enabledRef = useRef(enabled);
    const isCompletedRef = useRef(isCompleted);
    const hasEnteredRef = useRef(false);
    const isRecoveryOpenRef = useRef(false);
    const recoveryTimerRef = useRef(null);

    const onEnterSuccessRef = useRef(onEnterSuccess);
    const onExitRef = useRef(onExit);
    const onRecoverySuccessRef = useRef(onRecoverySuccess);
    const onRecoveryTimeoutRef = useRef(onRecoveryTimeout);

    useEffect(() => { enabledRef.current = enabled; }, [enabled]);
    useEffect(() => { isCompletedRef.current = isCompleted; }, [isCompleted]);
    useEffect(() => { onEnterSuccessRef.current = onEnterSuccess; }, [onEnterSuccess]);
    useEffect(() => { onExitRef.current = onExit; }, [onExit]);
    useEffect(() => { onRecoverySuccessRef.current = onRecoverySuccess; }, [onRecoverySuccess]);
    useEffect(() => { onRecoveryTimeoutRef.current = onRecoveryTimeout; }, [onRecoveryTimeout]);

    // Clear recovery interval helper
    const clearRecoveryTimer = useCallback(() => {
        if (recoveryTimerRef.current) {
            clearInterval(recoveryTimerRef.current);
            recoveryTimerRef.current = null;
        }
    }, []);

    // Handle completion or disabling: close all gates and stop recovery
    useEffect(() => {
        if (!enabled || isCompleted) {
            clearRecoveryTimer();
            setIsRecoveryOpen(false);
            isRecoveryOpenRef.current = false;
            setIsGateOpen(false);
            setError(null);
        }
    }, [enabled, isCompleted, clearRecoveryTimer]);

    // Cleanup timer on component unmount
    useEffect(() => {
        return () => {
            clearRecoveryTimer();
        };
    }, [clearRecoveryTimer]);

    /**
     * enterFullscreen
     * Must be invoked from a user click event (user gesture requirement).
     * Requests browser fullscreen, verifies document.fullscreenElement,
     * and unlocks the entry gate or recovers from exit.
     */
    const enterFullscreen = useCallback(async () => {
        setError(null);

        if (typeof document === 'undefined') return false;

        const docEl = document.documentElement;
        const requestMethod = docEl.requestFullscreen ||
                              docEl.webkitRequestFullscreen ||
                              docEl.mozRequestFullScreen ||
                              docEl.msRequestFullscreen;

        if (!requestMethod) {
            const errText = 'Fullscreen mode is not supported by your browser or is disabled.';
            setError(errText);
            return false;
        }

        try {
            if (!document.fullscreenElement) {
                await requestMethod.call(docEl);
            }

            // Explicit verification of document.fullscreenElement
            if (document.fullscreenElement) {
                setIsFullscreen(true);
                hasEnteredRef.current = true;
                setIsGateOpen(false);

                // If in recovery, resolve recovery successfully
                if (isRecoveryOpenRef.current) {
                    clearRecoveryTimer();
                    setIsRecoveryOpen(false);
                    isRecoveryOpenRef.current = false;
                    setRecoveryTimeLeft(recoveryDuration);
                    if (onRecoverySuccessRef.current) {
                        onRecoverySuccessRef.current();
                    }
                }

                if (onEnterSuccessRef.current) {
                    onEnterSuccessRef.current();
                }
                return true;
            } else {
                setError('Fullscreen could not be verified. Please try again.');
                return false;
            }
        } catch (err) {
            console.warn('[useAssessmentFullscreen] Fullscreen request rejected:', err);
            const msg = err?.message || 'Fullscreen request was denied. Please allow fullscreen in your browser settings and retry.';
            setError(msg);
            return false;
        }
    }, [recoveryDuration, clearRecoveryTimer]);

    /**
     * releaseFullscreen
     * Called ONCE the assessment is over (final submission accepted, or the server closed the attempt). Enforcement is switched off first
     * so the exit that follows is never mistaken for the candidate leaving (no recovery countdown, no violation), then the browser is
     * asked to leave fullscreen. Fire and forget: it never rejects, and the caller does not wait for it.
     */
    const releaseFullscreen = useCallback(() => {
        enabledRef.current = false;
        isCompletedRef.current = true;
        clearRecoveryTimer();
        isRecoveryOpenRef.current = false;
        setIsRecoveryOpen(false);
        setIsGateOpen(false);
        return exitFullscreenSafely();
    }, [clearRecoveryTimer]);

    /**
     * fullscreenchange event listener
     * Handles ESC key, browser button exits, or unexpected fullscreen drops
     */
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const handleFullscreenChange = () => {
            const activeFs = !!document.fullscreenElement;
            setIsFullscreen(activeFs);

            if (activeFs) {
                // Restored or entered fullscreen
                setError(null);
                if (isRecoveryOpenRef.current) {
                    clearRecoveryTimer();
                    setIsRecoveryOpen(false);
                    isRecoveryOpenRef.current = false;
                    setRecoveryTimeLeft(recoveryDuration);
                    if (onRecoverySuccessRef.current) {
                        onRecoverySuccessRef.current();
                    }
                }
            } else {
                // Exited fullscreen
                if (!enabledRef.current || isCompletedRef.current) return;
                // Only trigger recovery if candidate had already entered the assessment
                if (!hasEnteredRef.current) return;

                // Notify caller immediately
                if (onExitRef.current) {
                    onExitRef.current();
                }

                // Prevent creating duplicate concurrent recovery intervals
                if (isRecoveryOpenRef.current && recoveryTimerRef.current) {
                    return;
                }

                setIsRecoveryOpen(true);
                isRecoveryOpenRef.current = true;
                setRecoveryTimeLeft(recoveryDuration);

                clearRecoveryTimer();

                recoveryTimerRef.current = setInterval(() => {
                    setRecoveryTimeLeft((prev) => {
                        if (prev <= 1) {
                            clearRecoveryTimer();
                            if (onRecoveryTimeoutRef.current) {
                                onRecoveryTimeoutRef.current();
                            }
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
            clearRecoveryTimer();
        };
    }, [recoveryDuration, clearRecoveryTimer]);

    return {
        isFullscreen,
        isGateOpen,
        isRecoveryOpen,
        recoveryTimeLeft,
        error,
        enterFullscreen,
        releaseFullscreen,
        returnToFullscreen: enterFullscreen,
        retryFullscreen: enterFullscreen
    };
};

export default useAssessmentFullscreen;
