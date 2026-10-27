import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, X } from 'lucide-react';
import { MIN_FEEDBACK_WORDS, countWords } from '../../utils/feedbackWords';

/**
 * Shown before the student can download the report or open the dashboard: a short written feedback of at least 20 words.
 * `onSubmit(text)` saves it (and throws if the server refuses); the caller continues with the action the student asked for.
 */
const FeedbackGateModal = ({ open, onClose, onSubmit, actionLabel = 'continue' }) => {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const areaRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        setError('');
        areaRef.current?.focus();
        const onKeyDown = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, busy, onClose]);

    if (!open) return null;

    const words = countWords(text);
    const ready = words >= MIN_FEEDBACK_WORDS;

    const submit = async (e) => {
        e.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        setError('');
        try {
            await onSubmit(text.trim());
        } catch (err) {
            const detail = err?.response?.data?.detail;
            setError(typeof detail === 'string' ? detail : 'Your feedback could not be saved. Please try again.');
            setBusy(false);
            return;
        }
        setBusy(false);
        setText('');
    };

    return (
        <div
            id="feedback-gate-modal"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
            <form
                onSubmit={submit}
                role="dialog"
                aria-modal="true"
                aria-labelledby="feedback-gate-title"
                className="relative w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6"
            >
                <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    aria-label="Close"
                    className="absolute top-3 right-3 w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                    <X className="w-4 h-4" />
                </button>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mb-3">
                    <MessageSquare className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 id="feedback-gate-title" className="text-lg font-bold text-slate-900 dark:text-white pr-8">Share your feedback first</h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed mt-1 mb-4">
                    Tell us how the assessment went (questions, difficulty, anything that was unclear). Write at least {MIN_FEEDBACK_WORDS} words to {actionLabel}.
                </p>
                <label htmlFor="feedback-gate-text" className="sr-only">Your feedback</label>
                <textarea
                    id="feedback-gate-text"
                    ref={areaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                    maxLength={3000}
                    placeholder="Write your feedback here..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 p-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 resize-y"
                />
                <div className="flex items-center justify-between mt-2 text-xs">
                    <span id="feedback-word-count" className={ready ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                        {words} / {MIN_FEEDBACK_WORDS} words
                    </span>
                    {!ready && <span className="text-slate-400">{MIN_FEEDBACK_WORDS - words} more needed</span>}
                </div>
                {error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
                <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="min-h-[44px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        id="feedback-gate-submit"
                        type="submit"
                        disabled={!ready || busy}
                        className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        Submit feedback
                    </button>
                </div>
            </form>
        </div>
    );
};

export default FeedbackGateModal;
