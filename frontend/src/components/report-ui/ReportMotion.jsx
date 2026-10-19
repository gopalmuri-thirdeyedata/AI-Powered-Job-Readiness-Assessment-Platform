import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { Counter, EASE } from '../home/primitives';

/* Print/PDF safety: force every animated wrapper visible when printing. */
export const PrintStyles = () => (
    <style>{`@media print{.pw-anim,.pw-anim *{opacity:1 !important;transform:none !important;filter:none !important}.pw-noprint{display:none !important}}`}</style>
);

export const Rv = ({ children, className = '', delay = 0, y = 24, id }) => {
    const reduce = useReducedMotion();
    return (
        <motion.div
            id={id}
            className={`pw-anim ${className}`}
            initial={reduce ? false : { opacity: 0, y }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6, delay, ease: EASE }}
        >
            {children}
        </motion.div>
    );
};

export const AnimBar = ({ pct, className = 'bg-[var(--brand)]', delay = 0 }) => {
    const reduce = useReducedMotion();
    return (
        <motion.div
            className={`pw-anim h-full rounded-full ${className}`}
            initial={reduce ? false : { width: '0%' }}
            whileInView={{ width: `${pct}%` }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, delay, ease: EASE }}
            style={reduce ? { width: `${pct}%` } : undefined}
        />
    );
};

const CONFETTI_COLORS = ['#10B981', '#34D399', '#F59E0B', '#3B82F6', '#A78BFA', '#F43F5E'];
export const ConfettiBurst = () => {
    const reduce = useReducedMotion();
    if (reduce) return null;
    return (
        <div aria-hidden="true" className="pw-noprint pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            {Array.from({ length: 22 }).map((_, i) => {
                const ang = (i / 22) * Math.PI * 2;
                const dist = 80 + (i % 5) * 26;
                return (
                    <motion.span
                        key={i}
                        className="absolute right-[18%] top-1/2 block w-2 h-2 rounded-sm"
                        style={{ background: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }}
                        initial={{ opacity: 0, x: 0, y: 0, scale: 0.4, rotate: 0 }}
                        animate={{ opacity: [0, 1, 1, 0], x: Math.cos(ang) * dist, y: Math.sin(ang) * dist + 30, scale: 1, rotate: 240 }}
                        transition={{ duration: 1.8, delay: 0.9 + (i % 4) * 0.05, ease: 'easeOut' }}
                    />
                );
            })}
        </div>
    );
};

export const AnimatedGauge = ({ score = 0, size = 130, strokeWidth = 10 }) => {
    const reduce = useReducedMotion();
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const validScore = Math.min(100, Math.max(0, Math.round(score)));
    const strokeDashoffset = circumference - (validScore / 100) * circumference;

    let strokeColor = '#10B981';
    if (validScore < 50) strokeColor = '#F43F5E';
    else if (validScore < 75) strokeColor = '#F59E0B';

    return (
        <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                />
                <motion.circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    initial={reduce ? false : { strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset }}
                    transition={{ duration: 1.6, delay: 0.2, ease: EASE }}
                    strokeLinecap="round"
                    fill="transparent"
                />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-none">
                    <Counter to={validScore} suffix="%" />
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400 mt-1">
                    Job Fit
                </span>
            </div>
        </div>
    );
};

export const NAV_ITEMS = [
    { id: 'sec-overview', label: 'Overview' },
    { id: 'sec-rounds', label: 'Rounds' },
    { id: 'sec-skills', label: 'Skills' },
    { id: 'sec-plan', label: 'Plan' },
];

export const SectionNav = () => {
    const reduce = useReducedMotion();
    const [active, setActive] = useState('sec-overview');
    useEffect(() => {
        const onScroll = () => {
            let cur = NAV_ITEMS[0].id;
            NAV_ITEMS.forEach(({ id }) => {
                const el = document.getElementById(id);
                if (el && el.getBoundingClientRect().top <= 140) cur = id;
            });
            setActive(cur);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    const go = (id) => {
        document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    };
    return (
        <nav aria-label="Report sections" className="pw-noprint sticky top-2 z-20 mx-auto w-full max-w-md sm:max-w-lg">
            <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl border border-[var(--rr-border)] bg-[var(--rr-card)]/90 backdrop-blur shadow-sm">
                {NAV_ITEMS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => go(id)}
                        className={`min-h-[40px] rounded-xl text-xs font-bold transition-colors ${active === id ? 'bg-[var(--brand)] text-white' : 'text-[var(--rr-text-2)] hover:bg-[var(--rr-bg)]'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </nav>
    );
};

export const SummaryStrip = ({ strengths, gaps, next }) => {
    const items = [
        { label: 'Strengths', n: strengths, cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
        { label: 'Gaps', n: gaps, cls: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle },
        { label: 'Next steps', n: next, cls: 'text-blue-600 dark:text-blue-400', Icon: ArrowRight },
    ];
    return (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {items.map(({ label, n, cls, Icon }, i) => (
                <Rv key={label} delay={i * 0.08} y={14}>
                    <div className="rr-card px-2 sm:px-4 py-3 text-center sm:text-left sm:flex sm:items-center sm:gap-3 hover:-translate-y-0.5 transition-transform">
                        <Icon className={`w-5 h-5 mx-auto sm:mx-0 shrink-0 ${cls}`} />
                        <div>
                            <div className={`text-xl font-extrabold leading-none mt-1 sm:mt-0 ${cls}`}><Counter to={n} duration={1.1} /></div>
                            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[var(--rr-muted)] mt-1">{label}</div>
                        </div>
                    </div>
                </Rv>
            ))}
        </div>
    );
};

export const PlanTimeline = ({ entries }) => {
    const reduce = useReducedMotion();
    return (
        <div className="relative pl-7">
            <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-[var(--rr-border)]" />
            <motion.div
                className="pw-anim absolute left-[9px] top-2 bottom-2 w-0.5 bg-emerald-500 origin-top"
                initial={reduce ? false : { scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 1.4, ease: EASE }}
            />
            <div className="space-y-4">
                {entries.map(([wk, task], i) => (
                    <motion.div
                        key={wk}
                        className="pw-anim relative flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 text-sm"
                        initial={reduce ? false : { opacity: 0, x: 16 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: '-30px' }}
                        transition={{ duration: 0.5, delay: i * 0.12, ease: EASE }}
                    >
                        <span className="absolute -left-7 top-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center ring-4 ring-[var(--rr-card)]">{i + 1}</span>
                        <span className="shrink-0 self-start px-2 py-0.5 rounded bg-[var(--rr-bg)] border border-[var(--rr-border)] text-[10px] font-bold uppercase text-[var(--rr-muted)]">{wk.replace("_", " ")}</span>
                        <span className="text-[var(--rr-text-2)] min-w-0 break-words">{task}</span>
                    </motion.div>
                ))}
            </div>
        </div>
    );
};
