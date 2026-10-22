import React from 'react';
import { AlertTriangle, Mic, MicOff } from 'lucide-react';

/**
 * Microphone toggle for voice typing. `dictation` is what useSpeechToText() returns.
 * Hidden entirely when the browser has no speech recognition, so nobody sees a button that cannot work.
 */
export const VoiceInputButton = ({ dictation, label = 'Voice typing', className = '' }) => {
    if (!dictation?.supported) return null;
    const { listening, toggle } = dictation;
    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={listening}
            title={listening ? 'Stop voice typing' : 'Speak your answer instead of typing'}
            className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border text-xs font-semibold transition-all active:scale-[0.97] cursor-pointer ${
                listening
                    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300'
                    : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
            } ${className}`}
        >
            {listening ? (
                <>
                    <span className="relative flex w-2.5 h-2.5">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-rose-500 opacity-60 animate-ping motion-reduce:animate-none" />
                        <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-rose-500" />
                    </span>
                    <MicOff className="w-3.5 h-3.5" />
                    <span>Stop</span>
                </>
            ) : (
                <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>{label}</span>
                </>
            )}
        </button>
    );
};

/** What the microphone is hearing right now, or why it stopped. Render it under the answer box. */
export const VoiceStatus = ({ dictation }) => {
    if (!dictation?.supported) return null;
    const { listening, interim, error } = dictation;
    if (error) {
        return (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
            </p>
        );
    }
    if (!listening) return null;
    return (
        <p role="status" aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Listening… </span>
            {interim ? <em className="not-italic text-slate-700 dark:text-slate-200">{interim}</em> : 'speak now. Say "full stop", "comma" or "new line" to add punctuation.'}
        </p>
    );
};
