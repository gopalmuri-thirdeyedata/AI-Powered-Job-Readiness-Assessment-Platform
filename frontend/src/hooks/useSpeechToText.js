import { useCallback, useEffect, useRef, useState } from 'react';
import { describeSpeechError } from '../utils/speechText';

const getRecognition = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

/**
 * Voice typing with the browser's SpeechRecognition (Chrome, Edge, Safari). Text that is finished being
 * recognised is handed to onFinalText(chunk); what is still being recognised is exposed as `interim`.
 *
 * Browsers stop listening after a pause, so it restarts itself until the user switches it off.
 * Speech recognition always uses the browser's default microphone.
 */
export default function useSpeechToText({ lang = 'en-IN', onFinalText } = {}) {
    const Recognition = getRecognition();
    const supported = Boolean(Recognition);
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [error, setError] = useState(null);

    const recognitionRef = useRef(null);
    const wantedRef = useRef(false); // true while the user wants dictation on
    const restartTimerRef = useRef(0);
    const onFinalRef = useRef(onFinalText);
    onFinalRef.current = onFinalText;

    const stop = useCallback(() => {
        wantedRef.current = false;
        clearTimeout(restartTimerRef.current);
        const rec = recognitionRef.current;
        recognitionRef.current = null;
        if (rec) {
            rec.onend = null;
            rec.onresult = null;
            rec.onerror = null;
            try { rec.stop(); } catch { /* not started */ }
        }
        setListening(false);
        setInterim('');
    }, []);

    const start = useCallback(() => {
        if (!Recognition || wantedRef.current) return;
        wantedRef.current = true;
        setError(null);

        const begin = () => {
            const rec = new Recognition();
            rec.lang = lang;
            rec.continuous = true;
            rec.interimResults = true;
            rec.maxAlternatives = 1;

            rec.onstart = () => setListening(true);
            rec.onresult = (event) => {
                let pending = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const result = event.results[i];
                    const text = result[0]?.transcript || '';
                    if (result.isFinal) {
                        if (text.trim() && onFinalRef.current) onFinalRef.current(text);
                    } else {
                        pending += text;
                    }
                }
                setInterim(pending);
            };
            rec.onerror = (event) => {
                if (event.error === 'no-speech' || event.error === 'aborted') return; // just silence; keep listening
                wantedRef.current = false;
                setError(describeSpeechError(event.error));
            };
            rec.onend = () => {
                setInterim('');
                if (wantedRef.current) {
                    restartTimerRef.current = setTimeout(() => { if (wantedRef.current) begin(); }, 250);
                } else {
                    setListening(false);
                }
            };

            recognitionRef.current = rec;
            try {
                rec.start();
            } catch {
                wantedRef.current = false;
                setListening(false);
                setError(describeSpeechError('unknown'));
            }
        };
        begin();
    }, [Recognition, lang]);

    const toggle = useCallback(() => {
        if (wantedRef.current) stop();
        else start();
    }, [start, stop]);

    // never leave the microphone running after leaving the page
    useEffect(() => stop, [stop]);

    return { supported, listening, interim, error, start, stop, toggle };
}
