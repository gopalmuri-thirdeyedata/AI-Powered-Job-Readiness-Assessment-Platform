import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Award, CheckCircle2, Code2, Lock, MessageSquare, Sparkles, Loader2, Brain } from 'lucide-react';
import { TiltCard } from './primitives';

const ROUNDS = [
    { n: 1, label: 'Aptitude', sub: 'MCQs & Logic', Icon: Brain, tone: 'emerald' },
    { n: 2, label: 'Coding', sub: 'Sandbox IDE', Icon: Code2, tone: 'blue' },
    { n: 3, label: 'Interview', sub: 'AI Voice Eval', Icon: MessageSquare, tone: 'purple' },
];

const TONES = {
    emerald: { box: 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
    blue: { box: 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/60', text: 'text-blue-700 dark:text-blue-400', bar: 'bg-blue-500' },
    purple: { box: 'bg-purple-50/80 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/60', text: 'text-purple-700 dark:text-purple-400', bar: 'bg-purple-500' },
};

const CODE_LINES = [
    'def two_sum(nums, target):',
    '    seen = {}',
    '    for i, n in enumerate(nums):',
    '        if target - n in seen:',
    '            return [seen[target - n], i]',
    '        seen[n] = i',
];

const ScoreRing = ({ value }) => {
    const r = 26;
    const c = 2 * Math.PI * r;
    return (
        <svg viewBox="0 0 64 64" className="w-14 h-14 -rotate-90" aria-hidden="true">
            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-slate-200 dark:stroke-slate-700" />
            <motion.circle
                cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
                className="stroke-emerald-500"
                strokeDasharray={c}
                animate={{ strokeDashoffset: c * (1 - value / 100) }}
                transition={{ duration: 1, ease: 'easeOut' }}
            />
        </svg>
    );
};

const HeroPreview = () => {
    const reduce = useReducedMotion();
    const [phase, setPhase] = useState(reduce ? 3 : 0);
    const [lines, setLines] = useState(reduce ? CODE_LINES.length : 0);

    // Loop the demo: aptitude -> coding -> interview -> report -> restart
    useEffect(() => {
        if (reduce) return undefined;
        const id = setInterval(() => setPhase((p) => (p + 1) % 4), 3200);
        return () => clearInterval(id);
    }, [reduce]);

    // Type the code lines while the coding round is active
    useEffect(() => {
        if (reduce) return undefined;
        if (phase !== 1) { if (phase === 0) setLines(0); return undefined; }
        let i = 0;
        setLines(0);
        const id = setInterval(() => { i += 1; setLines(i); if (i >= CODE_LINES.length) clearInterval(id); }, 420);
        return () => clearInterval(id);
    }, [phase, reduce]);

    const score = phase === 3 ? 87 : phase === 2 ? 64 : phase === 1 ? 38 : 12;

    return (
        <TiltCard className="relative mx-auto max-w-lg lg:max-w-none">
            <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500/30 via-teal-400/20 to-blue-500/30 rounded-[2rem] blur-2xl opacity-80" aria-hidden="true" />

            {/* floating chips (hidden on small screens to avoid overflow) */}
            <motion.div
                aria-hidden="true"
                className="hidden sm:flex absolute -top-5 -right-3 z-20 items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-300 animate-pw-float"
            >
                <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-emerald-500 animate-pw-ping" /><span className="relative w-2 h-2 rounded-full bg-emerald-500" /></span>
                Proctoring Live
            </motion.div>
            <div
                aria-hidden="true"
                className="hidden sm:flex absolute -bottom-5 -left-4 z-20 items-center gap-2 px-3 py-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg text-[11px] font-semibold text-slate-700 dark:text-slate-200 animate-pw-float-slow"
            >
                <Lock className="w-3.5 h-3.5 text-emerald-600" /> Hidden tests · server-side
            </div>

            <div className="relative bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-7 backdrop-blur-xl space-y-5">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold shrink-0">JD</div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-none">Full-Stack Engineer</h4>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Target Role</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Resume + JD synthesized into personalized assessment</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 self-start sm:self-center bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full text-xs font-bold border border-emerald-200/70 dark:border-emerald-800/60">
                        <Sparkles className="w-3.5 h-3.5" /> <span>Role Tailored</span>
                    </div>
                </div>

                {/* Pipeline */}
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
                        <span>Sequential Assessment Pipeline</span>
                        <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><Lock className="w-3 h-3" /> Server-Side Gated</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {ROUNDS.map(({ n, label, sub, Icon, tone }, idx) => {
                            const t = TONES[tone];
                            const done = phase > idx;
                            const active = phase === idx;
                            const locked = phase < idx;
                            return (
                                <motion.div
                                    key={n}
                                    animate={{ scale: active ? 1.04 : 1, opacity: locked ? 0.55 : 1 }}
                                    transition={{ duration: 0.35 }}
                                    className={`relative overflow-hidden p-2.5 sm:p-3 rounded-2xl border text-left ${t.box} ${active ? 'shadow-md' : ''}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-[10px] uppercase font-bold ${t.text}`}>Round {n}</span>
                                        {done ? <CheckCircle2 className={`w-3.5 h-3.5 ${t.text}`} />
                                            : active ? <Loader2 className={`w-3.5 h-3.5 animate-spin ${t.text}`} />
                                            : locked ? <Lock className="w-3 h-3 text-slate-400" /> : <Icon className={`w-3.5 h-3.5 ${t.text}`} />}
                                    </div>
                                    <div className="text-xs font-bold text-slate-900 dark:text-white">{label}</div>
                                    <div className={`text-[11px] font-semibold mt-0.5 ${t.text}`}>{sub}</div>
                                    {active && (
                                        <motion.span
                                            key={`${phase}-bar`}
                                            className={`absolute left-0 bottom-0 h-0.5 ${t.bar}`}
                                            initial={{ width: '0%' }}
                                            animate={{ width: '100%' }}
                                            transition={{ duration: 3.1, ease: 'linear' }}
                                        />
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>

                {/* Live pane: code typing while coding is active */}
                <div className="rounded-2xl bg-slate-900 dark:bg-slate-950 border border-slate-800 p-3 font-mono text-[10.5px] sm:text-[11px] leading-relaxed min-h-[7.6rem] overflow-hidden" aria-hidden="true">
                    <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-2 h-2 rounded-full bg-red-400/80" /><span className="w-2 h-2 rounded-full bg-amber-400/80" /><span className="w-2 h-2 rounded-full bg-emerald-400/80" />
                        <span className="ml-2 text-[10px] text-slate-500">solution.py</span>
                    </div>
                    {CODE_LINES.slice(0, lines).map((l, i) => (
                        <div key={i} className="text-emerald-200/90 whitespace-pre">{l}</div>
                    ))}
                    {lines === 0 && <div className="text-slate-500">{phase === 0 ? '# Round 1 in progress… answers graded server-side' : '# waiting…'}</div>}
                    {phase === 2 && <div className="text-purple-300">🎙  “Walk me through your approach…”</div>}
                    {phase === 3 && <div className="text-emerald-300">✔ All hidden tests passed · report ready</div>}
                </div>

                {/* Dossier */}
                <div className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <div className="relative shrink-0">
                            <ScoreRing value={score} />
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-extrabold text-slate-900 dark:text-white">{score}</span>
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white">Job Readiness Score</div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">Scores, strengths, and targeted improvement areas.</p>
                        </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-bold transition-colors ${phase === 3 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}>
                        <Award className="w-4 h-4" /> {phase === 3 ? 'Verified' : 'Scoring…'}
                    </span>
                </div>

                <div className="pt-1 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span>Proctoring Active · Fullscreen Enforced</span></div>
                    <span className="font-mono text-[10px] hidden xs:inline sm:inline">Judge0 Sandbox</span>
                </div>
            </div>
        </TiltCard>
    );
};

export default HeroPreview;
