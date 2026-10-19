import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

const PAD = 8;
const TIP_W = 340;
const TIP_H = 230;

/**
 * Lightweight guided tour. Each step spotlights the element matching `target` (a CSS selector)
 * and shows a tooltip; a step without a target is shown as a centered welcome card.
 * On phones the tooltip becomes a bottom sheet so it never covers the highlighted element badly.
 */
const WalkthroughTour = ({ steps, open, onClose }) => {
    const [idx, setIdx] = useState(0);
    const [rect, setRect] = useState(null);
    const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
    const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 768));
    const nextRef = useRef(null);
    const step = steps[idx];
    const isLast = idx === steps.length - 1;
    const isMobile = vw < 640;

    const measure = useCallback(() => {
        setVw(window.innerWidth);
        setVh(window.innerHeight);
        if (!step?.target) { setRect(null); return; }
        const el = document.querySelector(step.target);
        if (!el) { setRect(null); return; }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }, [step]);

    // Reset when (re)opened
    useEffect(() => { if (open) setIdx(0); }, [open]);

    // Scroll the target into view, then measure (and keep measuring while scrolling/resizing)
    useLayoutEffect(() => {
        if (!open) return undefined;
        const el = step?.target ? document.querySelector(step.target) : null;
        if (el) el.scrollIntoView({ block: isMobile ? 'start' : 'center', behavior: 'smooth' });
        measure();
        const t1 = setTimeout(measure, 250);
        const t2 = setTimeout(measure, 650);
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            clearTimeout(t1); clearTimeout(t2);
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [open, idx, step, measure, isMobile]);

    const next = useCallback(() => (isLast ? onClose(true) : setIdx((i) => i + 1)), [isLast, onClose]);
    const back = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose(false);
            if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
            if (e.key === 'ArrowLeft') back();
        };
        window.addEventListener('keydown', onKey);
        nextRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [open, next, back, onClose, idx]);

    if (!open || !step) return null;

    // Tooltip placement (desktop). Falls back to a bottom-centered card when there is no room.
    let tipStyle;
    if (!isMobile) {
        if (!rect) {
            tipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
        } else {
            const below = vh - (rect.top + rect.height + PAD);
            const above = rect.top - PAD;
            const left = Math.min(Math.max(16, rect.left + rect.width / 2 - TIP_W / 2), vw - TIP_W - 16);
            if (below >= TIP_H + 16) tipStyle = { top: rect.top + rect.height + PAD + 14, left };
            else if (above >= TIP_H + 16) tipStyle = { top: rect.top - PAD - 14 - TIP_H, left };
            else tipStyle = { bottom: 24, left: Math.max(16, vw / 2 - TIP_W / 2) };
        }
    }

    return (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Guided tour">
            {/* click blocker */}
            <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

            {/* spotlight */}
            {rect ? (
                <div
                    aria-hidden="true"
                    className="fixed rounded-2xl pointer-events-none transition-all duration-500 ease-out ring-2 ring-emerald-400"
                    style={{
                        top: rect.top - PAD,
                        left: rect.left - PAD,
                        width: rect.width + PAD * 2,
                        height: rect.height + PAD * 2,
                        boxShadow: '0 0 0 9999px rgba(2,6,23,0.72), 0 0 32px 4px rgba(16,185,129,0.45)',
                    }}
                />
            ) : (
                <div aria-hidden="true" className="absolute inset-0 bg-slate-950/75 backdrop-blur-[2px]" />
            )}

            {/* tooltip */}
                <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: isMobile ? 40 : 12, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className={
                        isMobile
                            ? 'fixed inset-x-3 bottom-3 pb-[max(0px,env(safe-area-inset-bottom))]'
                            : 'fixed'
                    }
                    style={isMobile ? undefined : { ...tipStyle, width: TIP_W }}
                >
                    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-lg shrink-0" aria-hidden="true">
                                    {step.emoji || '✨'}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                        {steps.length > 1 ? `Step ${idx + 1} of ${steps.length}` : 'Tip'}
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">{step.title}</h3>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onClose(false)}
                                aria-label="Skip tour"
                                className="p-1.5 -m-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{step.body}</p>
                        {step.tip && (
                            <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 rounded-lg px-2.5 py-1.5">
                                💡 {step.tip}
                            </p>
                        )}

                        <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-1.5" aria-hidden="true">
                                {steps.map((_, i) => (
                                    <span
                                        key={i}
                                        className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? 'w-5 bg-emerald-500' : i < idx ? 'w-1.5 bg-emerald-300' : 'w-1.5 bg-slate-200 dark:bg-slate-700'}`}
                                    />
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                                {idx === 0 ? (
                                    <button type="button" onClick={() => onClose(false)} className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">
                                        Skip
                                    </button>
                                ) : (
                                    <button type="button" onClick={back} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer">
                                        <ArrowLeft className="w-3.5 h-3.5" /> Back
                                    </button>
                                )}
                                <button
                                    ref={nextRef}
                                    type="button"
                                    onClick={next}
                                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/25 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
                                >
                                    {isLast ? <>Got it <Check className="w-3.5 h-3.5" /></> : <>{idx === 0 ? "Let's go" : 'Next'} <ArrowRight className="w-3.5 h-3.5" /></>}
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
        </div>
    );
};

export default WalkthroughTour;
