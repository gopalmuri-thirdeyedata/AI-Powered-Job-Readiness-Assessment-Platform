import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Award, TrendingUp, Target } from 'lucide-react';
import { Counter, EASE, TiltCard } from './primitives';

const SKILLS = [
    { name: 'Data Structures & Algorithms', score: 82, tone: 'bg-emerald-500' },
    { name: 'System Design Basics', score: 64, tone: 'bg-blue-500' },
    { name: 'SQL & Databases', score: 71, tone: 'bg-teal-500' },
    { name: 'Communication (STAR)', score: 58, tone: 'bg-purple-500' },
];

const ROUND_SCORES = [
    { label: 'Aptitude', value: 78 },
    { label: 'Coding', value: 85 },
    { label: 'Interview', value: 69 },
];

/** Illustrative sample of the Job Readiness Report a student receives. Values are demo data. */
const ReportPreview = () => {
    const reduce = useReducedMotion();
    return (
        <TiltCard max={4}>
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-7 space-y-6">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Job Readiness Report · Sample</div>
                        <h4 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">Full-Stack Engineer</h4>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
                        <Award className="w-3.5 h-3.5" /> Job Ready
                    </span>
                </div>

                <div className="flex items-center gap-5">
                    <div className="relative shrink-0 w-24 h-24 sm:w-28 sm:h-28">
                        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
                            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="stroke-slate-200 dark:stroke-slate-700" />
                            <motion.circle
                                cx="50" cy="50" r="42" fill="none" strokeWidth="9" strokeLinecap="round"
                                className="stroke-emerald-500"
                                strokeDasharray={2 * Math.PI * 42}
                                initial={reduce ? false : { strokeDashoffset: 2 * Math.PI * 42 }}
                                whileInView={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - 0.77) }}
                                viewport={{ once: true }}
                                transition={{ duration: 1.4, ease: EASE }}
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums"><Counter to={77} /></span>
                            <span className="text-[10px] font-semibold text-slate-500">Overall</span>
                        </div>
                    </div>
                    <div className="flex-1 grid grid-cols-3 gap-2 min-w-0">
                        {ROUND_SCORES.map((r) => (
                            <div key={r.label} className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700 py-2 text-center">
                                <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums"><Counter to={r.value} /></div>
                                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{r.label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-300">Skill Match Matrix</div>
                    {SKILLS.map((s, i) => (
                        <div key={s.name}>
                            <div className="flex items-center justify-between text-[11px] sm:text-xs mb-1">
                                <span className="font-medium text-slate-700 dark:text-slate-300 truncate pr-2">{s.name}</span>
                                <span className="font-bold text-slate-900 dark:text-white tabular-nums">{s.score}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <motion.div
                                    className={`h-full rounded-full ${s.tone}`}
                                    initial={reduce ? false : { width: 0 }}
                                    whileInView={{ width: `${s.score}%` }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 1.1, delay: 0.15 * i, ease: EASE }}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 p-3.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-1"><TrendingUp className="w-3.5 h-3.5" /> Strengths</div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">Clean problem decomposition, strong array and hash-map solutions, confident debugging.</p>
                    </div>
                    <div className="rounded-2xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/40 p-3.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300 mb-1"><Target className="w-3.5 h-3.5" /> Improve next</div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">Structure answers with STAR, practise system-design trade-offs. Roadmap generated.</p>
                    </div>
                </div>
            </div>
        </TiltCard>
    );
};

export default ReportPreview;
