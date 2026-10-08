import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useProctoring Hook
 * @param {Object} options 
 * @param {Function} options.onViolation - Callback when a violation occurs
 * @param {Function} options.onTerminalViolation - Callback when max violations reached
 * @param {number} options.maxViolations - Max allowed violations (default 3)
 * @param {boolean} options.enabled - Whether proctoring is active
 */
const useProctoring = ({ onViolation, onTerminalViolation, maxViolations = 3, enabled = true }) => {
    const [violations, setViolations] = useState(0);
    const terminalLockedRef = useRef(false);
    const lastEventTimeRef = useRef(0);

    const triggerViolation = useCallback((reason) => {
        if (!enabled || terminalLockedRef.current) return;
        
        // Debounce rapid fire events (e.g. blur followed by visibilitychange on tab switch)
        const now = Date.now();
        if (now - lastEventTimeRef.current < 3000) return;
        lastEventTimeRef.current = now;

        setViolations(prev => {
            const next = prev + 1;
            console.warn(`[Proctoring] Violation Detected: ${reason} (${next}/${maxViolations})`);
            
            if (onViolation) onViolation(reason, next);
            
            if (next === maxViolations) {
                terminalLockedRef.current = true; // Lock immediately
                if (onTerminalViolation) onTerminalViolation(reason);
            }
            return next;
        });
    }, [enabled, maxViolations, onViolation, onTerminalViolation]);

    useEffect(() => {
        if (!enabled || terminalLockedRef.current) return;

        // 1. Tab Switching / Window Focus Loss
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                triggerViolation('Tab Switch');
            }
        };

        const handleBlur = () => {
            // Only fire focus loss if tab isn't already hidden (avoids dual strike with visibilitychange)
            if (document.visibilityState !== 'hidden') {
                triggerViolation('Lost Window Focus');
            }
        };

        // 2. Disable Context Menu (Right Click)
        const handleContextMenu = (e) => {
            e.preventDefault();
            triggerViolation('Right Click Attempted');
            return false;
        };

        // 3. Disable Shortcuts (Copy, Paste, DevTools)
        const handleKeyDown = (e) => {
            // Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+U (View Source), F12 (DevTools)
            const isCopyPaste = (e.ctrlKey || e.metaKey) && ['c', 'v', 'x'].includes(e.key.toLowerCase());
            const isDevTools = e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i');
            const isPrintScreen = e.key === 'PrintScreen';
            
            if (isCopyPaste || isDevTools || isPrintScreen) {
                e.preventDefault();
                triggerViolation(`Shortcut Blocked: ${e.key}`);
            }
        };

        // 4. Copy/Paste Events directly
        const handleCopyPaste = (e) => {
            e.preventDefault();
            triggerViolation('Copy/Paste Blocked');
            return false;
        };

        // 5. Back Button Prevention
        const preventBack = () => {
            window.history.pushState(null, document.title, window.location.href);
        };

        window.history.pushState(null, document.title, window.location.href);
        window.addEventListener('popstate', preventBack);

        // Attach listeners
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('copy', handleCopyPaste);
        document.addEventListener('paste', handleCopyPaste);
        document.addEventListener('cut', handleCopyPaste);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('copy', handleCopyPaste);
            document.removeEventListener('paste', handleCopyPaste);
            document.removeEventListener('cut', handleCopyPaste);
            window.removeEventListener('popstate', preventBack);
        };
    }, [enabled, triggerViolation]);

    return { violations, resetViolations: () => setViolations(0) };
};

export default useProctoring;
