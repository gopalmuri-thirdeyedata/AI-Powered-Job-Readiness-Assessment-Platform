import React, { useEffect, useRef, useState } from 'react';
import {
    motion,
    useMotionValue,
    useReducedMotion,
    useScroll,
    useSpring,
    useTransform,
} from 'framer-motion';
import { EASE } from './primitives';

/** Headline that reveals word by word (blur + rise). Plain text for reduced motion. */
export const SplitReveal = ({ text, className = '', delay = 0, stagger = 0.06, as = 'span', once = true }) => {
    const reduce = useReducedMotion();
    const Tag = motion[as] || motion.span;
    if (reduce) return <span className={className}>{text}</span>;
    const words = text.split(' ');
    return (
        <Tag
            className={className}
            initial="hidden"
            whileInView="visible"
            viewport={{ once, margin: '-60px' }}
            transition={{ staggerChildren: stagger, delayChildren: delay }}
            aria-label={text}
        >
            {words.map((w, i) => (
                <motion.span
                    key={`${w}-${i}`}
                    aria-hidden="true"
                    className="inline-block"
                    variants={{
                        hidden: { opacity: 0, y: '0.55em', filter: 'blur(10px)' },
                        visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE } },
                    }}
                >
                    {w}{i < words.length - 1 ? ' ' : ''}
                </motion.span>
            ))}
        </Tag>
    );
};

/** Cycles through words with a slide. All words share one grid cell so the width stays that of the longest. */
export const RotatingWords = ({ words, interval = 2200, className = '' }) => {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);
    useEffect(() => {
        if (reduce) return undefined;
        const id = setInterval(() => setI((p) => (p + 1) % words.length), interval);
        return () => clearInterval(id);
    }, [reduce, words.length, interval]);
    return (
        <span className={`inline-grid overflow-hidden align-bottom ${className}`} aria-live="off">
            {words.map((w, idx) => {
                const active = idx === i;
                const past = idx === (i - 1 + words.length) % words.length;
                return (
                    <span
                        key={w}
                        aria-hidden={!active}
                        className={`col-start-1 row-start-1 whitespace-nowrap transition-all duration-500 ease-out ${
                            active ? 'translate-y-0 opacity-100' : past ? '-translate-y-full opacity-0' : 'translate-y-full opacity-0'
                        }`}
                    >
                        {w}
                    </span>
                );
            })}
        </span>
    );
};

/** Button wrapper that is gently pulled toward the cursor (fine pointers only). */
export const Magnetic = ({ children, strength = 0.25, className = '' }) => {
    const reduce = useReducedMotion();
    const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 16 });
    const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 16 });
    const onMove = (e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const reset = () => { x.set(0); y.set(0); };
    return (
        <motion.div style={{ x, y }} onPointerMove={onMove} onPointerLeave={reset} className={className}>
            {children}
        </motion.div>
    );
};

/** Decorative code symbols drifting in the background. */
const SYMBOLS = [
    { s: '</>', x: '6%', y: '18%', d: 7 }, { s: '{ }', x: '88%', y: '14%', d: 9 },
    { s: '=>', x: '14%', y: '74%', d: 8 }, { s: '[ ]', x: '92%', y: '62%', d: 10 },
    { s: '&&', x: '48%', y: '8%', d: 11 }, { s: '01', x: '70%', y: '86%', d: 6 },
    { s: '#', x: '30%', y: '90%', d: 9 }, { s: '( )', x: '58%', y: '40%', d: 12 },
];
export const FloatingSymbols = () => {
    const reduce = useReducedMotion();
    if (reduce) return null;
    return (
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none hidden sm:block">
            {SYMBOLS.map((sym, i) => (
                <motion.span
                    key={sym.s}
                    className="absolute font-mono font-bold text-emerald-500/25 dark:text-emerald-400/20 text-xl lg:text-2xl select-none"
                    style={{ left: sym.x, top: sym.y }}
                    animate={{ y: [0, -22, 0], rotate: [0, i % 2 ? 8 : -8, 0] }}
                    transition={{ duration: sym.d, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
                >
                    {sym.s}
                </motion.span>
            ))}
        </div>
    );
};

/** Moves its children vertically at a different speed than the scroll. */
export const Parallax = ({ children, from = -60, to = 60, className = '' }) => {
    const reduce = useReducedMotion();
    const ref = useRef(null);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
    const y = useTransform(scrollYProgress, [0, 1], [from, to]);
    return (
        <motion.div ref={ref} style={reduce ? undefined : { y }} className={className}>
            {children}
        </motion.div>
    );
};

/** Radial glow in the hero that follows the pointer. */
export const CursorGlow = ({ targetRef }) => {
    const reduce = useReducedMotion();
    const x = useSpring(useMotionValue(-400), { stiffness: 80, damping: 20 });
    const y = useSpring(useMotionValue(-400), { stiffness: 80, damping: 20 });
    useEffect(() => {
        const el = targetRef.current;
        if (!el || reduce) return undefined;
        const move = (e) => {
            if (e.pointerType !== 'mouse') return;
            const r = el.getBoundingClientRect();
            x.set(e.clientX - r.left - 250);
            y.set(e.clientY - r.top - 250);
        };
        el.addEventListener('pointermove', move);
        return () => el.removeEventListener('pointermove', move);
    }, [targetRef, reduce, x, y]);
    if (reduce) return null;
    return (
        <motion.div
            aria-hidden="true"
            style={{ x, y }}
            className="hidden md:block absolute top-0 left-0 w-[500px] h-[500px] rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(16,185,129,0.22),transparent_65%)] dark:bg-[radial-gradient(circle,rgba(16,185,129,0.18),transparent_65%)]"
        />
    );
};

/** Vertical timeline whose spine draws itself with scroll and whose steps pop in alternately. */
export const ScrollTimeline = ({ items }) => {
    const reduce = useReducedMotion();
    const ref = useRef(null);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 55%'] });
    const scaleY = useSpring(scrollYProgress, { stiffness: 90, damping: 22, restDelta: 0.001 });

    return (
        <div ref={ref} className="relative max-w-4xl mx-auto">
            {/* spine */}
            <div aria-hidden="true" className="absolute left-5 md:left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-slate-200 dark:bg-slate-800 rounded-full" />
            <motion.div
                aria-hidden="true"
                style={{ scaleY: reduce ? 1 : scaleY }}
                className="absolute left-5 md:left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 origin-top rounded-full bg-gradient-to-b from-emerald-500 via-teal-400 to-blue-500"
            />
            <div className="space-y-8 md:space-y-12">
                {items.map((it, i) => {
                    const Icon = it.icon;
                    const left = i % 2 === 0;
                    return (
                        <div key={it.title} className="relative md:grid md:grid-cols-2 md:gap-14 items-center pl-14 md:pl-0">
                            {/* node */}
                            <motion.div
                                initial={reduce ? false : { scale: 0, rotate: -90 }}
                                whileInView={{ scale: 1, rotate: 0 }}
                                viewport={{ once: true, margin: '-30% 0px -30% 0px' }}
                                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                                className="absolute left-5 md:left-1/2 top-5 md:top-1/2 -translate-x-1/2 md:-translate-y-1/2 z-10 w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 ring-4 ring-white dark:ring-slate-950"
                            >
                                <Icon className="w-4 h-4" />
                            </motion.div>

                            <motion.div
                                initial={reduce ? false : { opacity: 0, x: left ? -60 : 60, scale: 0.94 }}
                                whileInView={{ opacity: 1, x: 0, scale: 1 }}
                                viewport={{ once: true, margin: '-12% 0px' }}
                                transition={{ duration: 0.75, ease: EASE }}
                                className={`${left ? 'md:col-start-1 md:text-right' : 'md:col-start-2'} rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm hover:shadow-xl hover:border-emerald-300 dark:hover:border-emerald-700 transition-all duration-300`}
                            >
                                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">Step {i + 1}</div>
                                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-1.5">{it.title}</h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{it.body}</p>
                            </motion.div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
