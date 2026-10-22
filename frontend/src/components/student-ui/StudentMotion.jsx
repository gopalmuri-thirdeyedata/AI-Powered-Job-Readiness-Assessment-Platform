import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Counter, EASE, SpotlightCard } from '../home/primitives';

/**
 * Shared building blocks for the Student Hub redesign so every student page feels like one product.
 * All pieces are mobile-first and respect prefers-reduced-motion.
 */

const TONES = {
    emerald: { icon: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/60', bar: 'from-emerald-500 to-teal-400', text: 'text-emerald-700 dark:text-emerald-400' },
    blue: { icon: 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border-blue-200/80 dark:border-blue-800/60', bar: 'from-blue-500 to-sky-400', text: 'text-blue-700 dark:text-blue-400' },
    purple: { icon: 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border-purple-200/80 dark:border-purple-800/60', bar: 'from-purple-500 to-fuchsia-400', text: 'text-purple-700 dark:text-purple-400' },
    amber: { icon: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60', bar: 'from-amber-500 to-orange-400', text: 'text-amber-700 dark:text-amber-400' },
    rose: { icon: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/60', bar: 'from-rose-500 to-pink-400', text: 'text-rose-700 dark:text-rose-400' },
};
export const toneOf = (tone) => TONES[tone] || TONES.emerald;

/** Page-level hero card: eyebrow chip, title, subtitle, action buttons, soft animated glow. */
export const PageHero = ({ icon: Icon, eyebrow, title, subtitle, actions, children, className = '' }) => {
    const reduce = useReducedMotion();
    return (
        <motion.section
            initial={reduce ? false : { opacity: 0, y: 24, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: EASE }}
            className={`relative overflow-hidden rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-7 lg:p-8 shadow-xs ${className}`}
        >
            <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-10 w-64 h-64 rounded-full bg-emerald-300/25 dark:bg-emerald-500/10 blur-3xl animate-pw-blob motion-reduce:animate-none" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 left-1/4 w-56 h-56 rounded-full bg-blue-300/20 dark:bg-blue-500/10 blur-3xl animate-pw-blob [animation-delay:-8s] motion-reduce:animate-none" />
            <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                <div className="min-w-0 space-y-2">
                    {eyebrow && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-[11px] sm:text-xs font-semibold">
                            {Icon && <Icon className="w-3.5 h-3.5" />}
                            {eyebrow}
                        </span>
                    )}
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white break-words">{title}</h1>
                    {subtitle && <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">{subtitle}</p>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">{actions}</div>}
            </div>
            {children && <div className="relative mt-5">{children}</div>}
        </motion.section>
    );
};

/** KPI card with count-up value, icon, hint and a spotlight hover. `value` may be a number or a ready string. */
export const StatCard = ({ label, value, suffix = '', hint, icon: Icon, tone = 'emerald', delay = 0, footnote }) => {
    const reduce = useReducedMotion();
    const t = toneOf(tone);
    const numeric = typeof value === 'number' && Number.isFinite(value);
    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6, delay, ease: EASE }}
            className="h-full"
        >
            <SpotlightCard className="h-full rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
                    {Icon && (
                        <span className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${t.icon}`}>
                            <Icon className="w-5 h-5" />
                        </span>
                    )}
                </div>
                <div className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                    {numeric ? <Counter to={value} suffix={suffix} /> : <>{value}{suffix}</>}
                </div>
                {hint && <div className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">{hint}</div>}
                {footnote && <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-500">{footnote}</div>}
            </SpotlightCard>
        </motion.div>
    );
};

/** Stagger wrapper: children wrapped in <StaggerItem> enter one after another when scrolled into view. */
export const Stagger = ({ children, className = '', delay = 0, gap = 0.08 }) => {
    const reduce = useReducedMotion();
    // The enter animation plays once per mount. Items that appear later (a different role, a refreshed list)
    // would otherwise stay invisible, so the group re-mounts, and replays, whenever its set of items changes.
    const itemsKey = React.Children.toArray(children).map((c) => (c && c.key) ?? '').join('|');
    return (
        <motion.div
            key={itemsKey}
            className={className}
            initial={reduce ? false : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, margin: '-40px' }}
            variants={{ hidden: {}, visible: { transition: { staggerChildren: gap, delayChildren: delay } } }}
        >
            {children}
        </motion.div>
    );
};

export const StaggerItem = ({ children, className = '' }) => (
    <motion.div
        className={className}
        variants={{
            hidden: { opacity: 0, y: 22, filter: 'blur(4px)' },
            visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.55, ease: EASE } },
        }}
    >
        {children}
    </motion.div>
);

/** Horizontal progress bar that fills from 0 when it scrolls into view. value is 0-100. */
export const AnimatedBar = ({ value = 0, tone = 'emerald', height = 'h-2', className = '', label }) => {
    const reduce = useReducedMotion();
    const t = toneOf(tone);
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    return (
        <div
            className={`${height} rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden ${className}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(v)}
            aria-label={label}
        >
            <motion.div
                className={`h-full rounded-full bg-gradient-to-r ${t.bar}`}
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${v}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.1, ease: EASE }}
            />
        </div>
    );
};

/** Friendly empty state with a gently floating icon and an optional action. */
export const EmptyState = ({ icon: Icon, title, body, action, className = '' }) => (
    <div className={`rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 p-6 sm:p-10 text-center ${className}`}>
        {Icon && (
            <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center mb-4 animate-pw-float motion-reduce:animate-none">
                <Icon className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
        )}
        <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
        {body && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">{body}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
);
