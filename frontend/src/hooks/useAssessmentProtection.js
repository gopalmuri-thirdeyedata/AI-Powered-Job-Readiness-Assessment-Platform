import { useEffect, useRef, useState } from 'react';

/**
 * Content protection for the proctored assessment (aptitude, coding, interview). What a web page CAN do, and does here:
 *   - hide the whole assessment (blur + message) whenever its window is not focused or visible. Alt-Tab, another tab, Win+Shift+S and most
 *     screenshot / recording tools take focus first, so what they capture is the blurred cover, not the questions;
 *   - catch the PrintScreen key (hide the page briefly and overwrite the clipboard), Print / Save and developer-tools shortcuts;
 *   - block copying the questions, pasting anything from outside (the code editor still allows copy and paste of the candidate's OWN text),
 *     the right-click menu, dragging text in, and printing;
 *   - report every attempt through `onEvent` (the page records it as an integrity event for the hiring team).
 * What no web page can do: stop a phone photo, an external capture card, or a screen recording done outside the browser. The watermark
 * (ProtectionLayer) makes those traceable to the session instead.
 *
 * TEST SWITCH: put `VITE_ASSESSMENT_PROTECTION=off` in frontend/.env.local (and restart `npm run dev`) to turn all of this off, so copy / paste
 * works while testing. It is a build-time setting, deliberately NOT something a candidate can flip in the browser. Never ship a build with it off.
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const PROTECTION_TEST_MODE = String(env.VITE_ASSESSMENT_PROTECTION || '').toLowerCase() === 'off';

const SCREENSHOT_COVER_MS = 3000;
const REPEAT_QUIET_MS = 1500;
const CLIPBOARD_NOTE = 'Screenshots and copying are not allowed during this assessment.';

/** Is this key press one we block? Returns the reason to record, or null. (Pure: unit tested.) */
export const classifyKey = (e) => {
    const key = String(e?.key || '');
    const lower = key.toLowerCase();
    const mod = !!(e?.ctrlKey || e?.metaKey);
    if (key === 'PrintScreen') return 'Screenshot key pressed';
    if (mod && (lower === 'p' || lower === 's')) return 'Print or Save attempted';
    if (key === 'F12' || (mod && e?.shiftKey && ['i', 'j', 'c'].includes(lower)) || (mod && lower === 'u')) return 'Developer tools shortcut blocked';
    return null;
};

/** Text fields and the code editor: the candidate's own text, where copy / cut / paste of their own words stays possible. */
export const isEditableTarget = (el) => {
    if (!el || typeof el.closest !== 'function') return false;
    return !!el.closest('input, textarea, [contenteditable="true"], .monaco-editor');
};

const selectedTextOf = (el) => {
    try {
        if (el && typeof el.selectionStart === 'number' && typeof el.value === 'string') return el.value.slice(el.selectionStart, el.selectionEnd);
        return String(window.getSelection?.()?.toString() || '');
    } catch { return ''; }
};

const STYLE_ID = 'pw-protection-style';
const CSS = `
body.pw-protect, body.pw-protect * { -webkit-user-select: none; user-select: none; }
body.pw-protect input, body.pw-protect textarea, body.pw-protect .monaco-editor, body.pw-protect .monaco-editor * { -webkit-user-select: text; user-select: text; }
@media print { body.pw-protect * { visibility: hidden !important; } }
`;

/**
 * @param {boolean} enabled  true during aptitude / coding / interview
 * @param {(reason: string) => void} onEvent  called (rate limited per reason) for every blocked attempt
 * @returns {{ obscured: boolean, protectionOn: boolean }}  `obscured` = cover the page now
 */
const useAssessmentProtection = ({ enabled, onEvent }) => {
    const active = !!enabled && !PROTECTION_TEST_MODE;
    const [focusLost, setFocusLost] = useState(false);
    const [flash, setFlash] = useState(false);
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    useEffect(() => {
        if (!active || typeof document === 'undefined') return undefined;

        const lastByReason = {};
        const report = (reason) => {
            const now = Date.now();
            if (now - (lastByReason[reason] || 0) < REPEAT_QUIET_MS) return;
            lastByReason[reason] = now;
            try { onEventRef.current?.(reason); } catch { /* recording must never break the page */ }
        };
        let flashTimer = null;
        const coverBriefly = () => {
            setFlash(true);
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => setFlash(false), SCREENSHOT_COVER_MS);
        };
        const overwriteClipboard = () => {
            try { navigator.clipboard?.writeText(CLIPBOARD_NOTE).catch(() => {}); } catch { /* best effort */ }
        };

        // 1. Hide everything while the window is not in front
        const syncFocus = () => setFocusLost(document.hidden || !document.hasFocus());
        syncFocus();

        // 2. Keys: PrintScreen (often only a keyup on Windows), print / save, developer tools
        const onKeyDown = (e) => {
            const reason = classifyKey(e);
            if (!reason) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'PrintScreen') { coverBriefly(); overwriteClipboard(); }
            report(reason);
        };
        const onKeyUp = (e) => {
            if (e.key !== 'PrintScreen') return;
            coverBriefly();
            overwriteClipboard();
            report('Screenshot key pressed');
        };

        // 3. Clipboard: the candidate may move their OWN text around, nothing may come in from outside, and the questions cannot go out
        let ownClip = '';
        const onCopyCut = (e) => {
            if (!isEditableTarget(e.target)) {
                e.preventDefault();
                report('Copying the questions was blocked');
                return;
            }
            // remember what the candidate copied inside their own text, so pasting it back is allowed
            setTimeout(() => {
                try { ownClip = e.clipboardData?.getData('text/plain') || selectedTextOf(e.target) || ownClip; } catch { ownClip = selectedTextOf(e.target) || ownClip; }
            }, 0);
        };
        const onCopyBubble = (e) => {
            try { const text = e.clipboardData?.getData('text/plain'); if (text) ownClip = text; } catch { /* keep the earlier value */ }
        };
        const onPaste = (e) => {
            let pasted = '';
            try { pasted = e.clipboardData?.getData('text/plain') || ''; } catch { pasted = ''; }
            if (isEditableTarget(e.target) && pasted && pasted === ownClip) return;       // their own text, pasted back
            e.preventDefault();
            e.stopImmediatePropagation();
            report('Pasting from outside was blocked');
        };

        // 4. No right-click menu, no dragging text in, no printing
        const block = (e) => e.preventDefault();
        const onBeforePrint = () => { coverBriefly(); report('Print attempted'); };

        document.addEventListener('visibilitychange', syncFocus);
        window.addEventListener('blur', syncFocus);
        window.addEventListener('focus', syncFocus);
        window.addEventListener('pageshow', syncFocus);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
        document.addEventListener('copy', onCopyCut, true);
        document.addEventListener('cut', onCopyCut, true);
        document.addEventListener('copy', onCopyBubble, false);
        document.addEventListener('cut', onCopyBubble, false);
        document.addEventListener('paste', onPaste, true);
        document.addEventListener('contextmenu', block, true);
        document.addEventListener('dragstart', block, true);
        document.addEventListener('drop', block, true);
        window.addEventListener('beforeprint', onBeforePrint);

        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        document.body.classList.add('pw-protect');

        return () => {
            clearTimeout(flashTimer);
            document.removeEventListener('visibilitychange', syncFocus);
            window.removeEventListener('blur', syncFocus);
            window.removeEventListener('focus', syncFocus);
            window.removeEventListener('pageshow', syncFocus);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
            document.removeEventListener('copy', onCopyCut, true);
            document.removeEventListener('cut', onCopyCut, true);
            document.removeEventListener('copy', onCopyBubble, false);
            document.removeEventListener('cut', onCopyBubble, false);
            document.removeEventListener('paste', onPaste, true);
            document.removeEventListener('contextmenu', block, true);
            document.removeEventListener('dragstart', block, true);
            document.removeEventListener('drop', block, true);
            window.removeEventListener('beforeprint', onBeforePrint);
            document.body.classList.remove('pw-protect');
            setFocusLost(false);
            setFlash(false);
        };
    }, [active]);

    return { obscured: active && (focusLost || flash), protectionOn: active };
};

export default useAssessmentProtection;
