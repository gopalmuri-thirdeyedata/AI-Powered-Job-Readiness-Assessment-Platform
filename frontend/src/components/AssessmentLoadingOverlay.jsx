import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, Check, Code2, FileSearch, Loader2, Mic, ScanText, ShieldCheck, Sparkles } from 'lucide-react';

const STAGES = [
    { icon: FileSearch, label: 'Reading your resume', needsResume: true },
    { icon: ScanText, label: 'Analysing the job description' },
    { icon: Brain, label: 'Writing aptitude questions' },
    { icon: Code2, label: 'Preparing coding challenges' },
    { icon: Mic, label: 'Setting up your AI interviewer' },
    { icon: ShieldCheck, label: 'Securing answer keys on the server' },
];

const TIPS = [
    'Each round unlocks only after you finish the one before it.',
    'Use a quiet place. Your webcam and microphone will be needed.',
    'Stay in fullscreen. You get a short recovery window if you leave it.',
    'Answer keys stay on the server, so your score is truly yours.',
];

/**
 * Full-screen, centred loader shown while the tailored assessment is generated.
 * Purely presentational: the real work happens in the parent's submit handler.
 */
const AssessmentLoadingOverlay = ({
    open,
    role,
    hasResume,
    title = 'Building your assessment',
    subtitle,
    stages: customStages,
    tips = TIPS,
    footnote = 'Please keep this page open. This usually takes a few seconds.',
}) => {
    const reduce = useReducedMotion();
    const stages = customStages || STAGES.filter((s) => !s.needsResume || hasResume);
    const [active, setActive] = useState(0);
    const [progress, setProgress] = useState(4);
    const [tip, setTip] = useState(0);

    useEffect(() => {
        if (!open) { setActive(0); setProgress(4); setTip(0); return undefined; }
        const stageTimer = setInterval(() => setActive((a) => Math.min(a + 1, stages.length - 1)), 2300);
        const progTimer = setInterval(() => setProgress((p) => p + (93 - p) * 0.05), 250);
        const tipTimer = setInterval(() => setTip((t) => (t + 1) % tips.length), 3600);
        return () => { clearInterval(stageTimer); clearInterval(progTimer); clearInterval(tipTimer); };
    }, [open, stages.length, tips.length]);

    // Lock page scroll while the overlay is up
    useEffect(() => {
        if (!open) return undefined;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    if (!open) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[110] overflow-y-auto bg-slate-950/90 backdrop-blur-md"
            role="alertdialog"
            aria-modal="true"
            aria-live="polite"
            aria-label={title}
        >
            {/* ambient glow */}
            <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[32rem] max-w-full h-[32rem] rounded-full bg-emerald-500/20 blur-3xl animate-pw-blob" />
                <div className="absolute right-0 bottom-0 w-72 h-72 rounded-full bg-blue-500/15 blur-3xl animate-pw-blob [animation-delay:-7s]" />
            </div>

            <div className="relative min-h-full flex items-center justify-center px-4 py-8">
                <motion.div
                    initial={reduce ? false : { opacity: 0, scale: 0.92, y: 24 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-md text-center"
                >
                    {/* Orbit animation */}
                    <div className="relative mx-auto w-40 h-40 sm:w-48 sm:h-48" aria-hidden="true">
                        <div className="absolute inset-0 rounded-full border border-emerald-400/20" />
                        <div className="absolute inset-4 rounded-full border border-dashed border-emerald-400/30" />
                        <span className="absolute inset-0 rounded-full animate-pw-ping bg-emerald-500/10" />

                        {/* orbiting round icons */}
                        <div className={`absolute inset-0 ${reduce ? '' : 'animate-spin [animation-duration:9s]'}`}>
                            {[Brain, Code2, Mic].map((Icon, i) => {
                                const angle = i * 120;
                                return (
                                    <div
                                        key={i}
                                        className="absolute left-1/2 top-1/2 -ml-5 -mt-5"
                                        style={{ transform: `rotate(${angle}deg) translateY(-4.8rem)` }}
                                    >
                                        <div style={{ transform: `rotate(${-angle}deg)` }}>
                                            <div className={`w-10 h-10 rounded-xl bg-slate-900 border border-emerald-400/40 shadow-lg shadow-emerald-500/20 flex items-center justify-center ${reduce ? '' : 'animate-spin [animation-duration:9s] [animation-direction:reverse]'}`}>
                                                <Icon className="w-5 h-5 text-emerald-300" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* core */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <motion.div
                                animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-2xl shadow-emerald-500/40 flex items-center justify-center"
                            >
                                <Sparkles className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                            </motion.div>
                        </div>
                    </div>

                    <h2 className="mt-6 text-xl sm:text-2xl font-extrabold text-white tracking-tight">{title}</h2>
                    {subtitle && <p className="mt-1.5 text-sm text-slate-300">{subtitle}</p>}
                    {role && !subtitle && (
                        <p className="mt-1.5 text-sm text-slate-300">
                            Tailored for <span className="font-bold text-emerald-300">{role}</span>
                        </p>
                    )}

                    {/* progress */}
                    <div className="mt-5 h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                        <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-[length:200%_auto] animate-pw-shimmer"
                            animate={{ width: `${progress}%` }}
                            transition={{ ease: 'easeOut', duration: 0.4 }}
                        />
                    </div>
                    <div className="mt-1.5 text-[11px] font-semibold text-slate-400 tabular-nums">{Math.round(progress)}%</div>

                    {/* stages */}
                    <ul className="mt-5 space-y-2 text-left bg-white/5 border border-white/10 rounded-2xl p-4">
                        {stages.map((s, i) => {
                            const done = i < active;
                            const current = i === active;
                            const Icon = s.icon;
                            return (
                                <motion.li
                                    key={s.label}
                                    initial={reduce ? false : { opacity: 0, x: -12 }}
                                    animate={{ opacity: i <= active ? 1 : 0.4, x: 0 }}
                                    transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.06 }}
                                    className="flex items-center gap-3 text-sm"
                                >
                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                        done ? 'bg-emerald-500 text-white' : current ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50' : 'bg-white/10 text-slate-500'
                                    }`}>
                                        {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                            : current ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : <Icon className="w-3.5 h-3.5" />}
                                    </span>
                                    <span className={done ? 'text-slate-300' : current ? 'text-white font-semibold' : 'text-slate-500'}>{s.label}</span>
                                </motion.li>
                            );
                        })}
                    </ul>

                    <motion.p
                        key={tip}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="mt-5 text-xs text-slate-400 leading-relaxed min-h-[2.5rem]"
                    >
                        💡 {tips[tip]}
                    </motion.p>
                    <p className="mt-1 text-[11px] text-slate-500">{footnote}</p>
                </motion.div>
            </div>
        </motion.div>
    );
};

export default AssessmentLoadingOverlay;
