import React, { useEffect, useMemo, useState } from 'react';
import { aiRevealedText, revealStep } from '../../utils/liveCaptions';

const TICK_MS = 55;

/** The words of `text` one after another (several at a time only when far behind), so a caption flows instead of jumping. */
export const useWordReveal = (text) => {
    const words = useMemo(() => String(text || '').split(/\s+/).filter(Boolean), [text]);
    const [shown, setShown] = useState(0);
    useEffect(() => {
        if (!words.length) { setShown(0); return undefined; }
        const id = setInterval(() => setShown((previous) => revealStep(previous, words.length)), TICK_MS);
        return () => clearInterval(id);
    }, [words.length]);
    return words.slice(0, Math.min(shown, words.length)).join(' ');
};

/** What the candidate is saying right now. It stays while the answer is processed and is then replaced by the final transcript. */
export const UserLiveCaption = ({ text, processing }) => {
    const shown = useWordReveal(text);
    return (
        <div className="flex justify-end" aria-live="polite" data-testid="live-caption">
            <div className="max-w-[85%] text-right rounded-lg px-3 py-2 border border-dashed border-purple-400/60 bg-purple-600/20">
                <p className="text-[10px] font-semibold mb-1 text-purple-200 flex items-center justify-end gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse" />
                    {processing ? 'You · processing your answer…' : 'You · speaking'}
                </p>
                <p className="text-xs text-white/90 leading-relaxed">{shown || '…'}</p>
            </div>
        </div>
    );
};

/** The interviewer's words as they are spoken: earlier chunks in full, the current one spread over its audio. */
export const AiLiveCaption = ({ caption }) => {
    const [text, setText] = useState('');
    useEffect(() => {
        if (!caption?.text) { setText(caption?.prefix || ''); return undefined; }
        const update = () => setText(aiRevealedText(caption.prefix, caption.text, Date.now() - caption.startedAt, caption.durationMs));
        update();
        const id = setInterval(update, TICK_MS);
        return () => clearInterval(id);
    }, [caption]);
    if (!caption) return null;
    return (
        <div className="flex justify-start" aria-live="polite" data-testid="ai-live-caption">
            <div className="max-w-[85%] text-left rounded-lg px-3 py-2 bg-gray-800 border border-dashed border-blue-400/50">
                <p className="text-[10px] font-semibold mb-1 text-blue-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    AI Interviewer · speaking
                </p>
                <p className="text-xs text-white leading-relaxed">{text || '…'}</p>
            </div>
        </div>
    );
};
