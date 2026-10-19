import React, { useEffect, useRef, useState } from 'react';
import {
    motion,
    useInView,
    useMotionValue,
    useReducedMotion,
    useSpring,
    useTransform,
} from 'framer-motion';

export const EASE = [0.16, 1, 0.3, 1];

/** Fades + lifts its children into view the first time they scroll on screen. */
const REVEAL_FROM = {
    up: (y) => ({ opacity: 0, y }),
    scale: () => ({ opacity: 0, scale: 0.88, y: 20 }),
    left: () => ({ opacity: 0, x: -50 }),
    right: () => ({ opacity: 0, x: 50 }),
    blur: (y) => ({ opacity: 0, y, filter: 'blur(12px)' }),
};

export const Reveal = ({ children, delay = 0, y = 28, className = '', as = 'div', variant = 'up' }) => {
    const reduce = useReducedMotion();
    const Tag = motion[as] || motion.div;
    return (
        <Tag
            className={className}
            initial={reduce ? false : (REVEAL_FROM[variant] || REVEAL_FROM.up)(y)}
            whileInView={{ opacity: 1, y: 0, x: 0, scale: 1, filter: 'blur(0px)' }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, delay, ease: EASE }}
        >
            {children}
        </Tag>
    );
};

/** Counts up to `to` once visible. Falls back to the final value for reduced motion. */
export const Counter = ({ to, suffix = '', duration = 1.6 }) => {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-40px' });
    const reduce = useReducedMotion();
    const [value, setValue] = useState(reduce ? to : 0);

    useEffect(() => {
        if (!inView || reduce) return undefined;
        let raf;
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min((now - start) / (duration * 1000), 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(Math.round(eased * to));
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [inView, reduce, to, duration]);

    return <span ref={ref}>{value}{suffix}</span>;
};

/** Card with a soft emerald spotlight that follows the cursor. Touch devices simply get a normal card. */
export const SpotlightCard = ({ children, className = '' }) => {
    const ref = useRef(null);
    const [pos, setPos] = useState({ x: 0, y: 0, on: false });

    const onMove = (e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top, on: true });
    };

    return (
        <div
            ref={ref}
            onMouseMove={onMove}
            onMouseLeave={() => setPos((p) => ({ ...p, on: false }))}
            className={`relative overflow-hidden ${className}`}
        >
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 transition-opacity duration-300"
                style={{
                    opacity: pos.on ? 1 : 0,
                    background: `radial-gradient(320px circle at ${pos.x}px ${pos.y}px, rgba(16,185,129,0.14), transparent 70%)`,
                }}
            />
            <div className="relative">{children}</div>
        </div>
    );
};

/** 3D tilt that follows the pointer (desktop only; disabled for reduced motion). */
export const TiltCard = ({ children, className = '', max = 7 }) => {
    const reduce = useReducedMotion();
    const mx = useMotionValue(0);
    const my = useMotionValue(0);
    const rx = useSpring(useTransform(my, [-0.5, 0.5], [max, -max]), { stiffness: 140, damping: 18 });
    const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-max, max]), { stiffness: 140, damping: 18 });

    const onMove = (e) => {
        if (reduce || e.pointerType === 'touch') return;
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
    };
    const reset = () => { mx.set(0); my.set(0); };

    return (
        <div style={{ perspective: 1200 }} onPointerMove={onMove} onPointerLeave={reset} className={className}>
            <motion.div style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}>
                {children}
            </motion.div>
        </div>
    );
};

/** Pure-CSS infinite marquee. Items are rendered twice for a seamless loop. */
export const Marquee = ({ items, reverse = false }) => (
    <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className={`flex w-max animate-pw-marquee hover:[animation-play-state:paused] gap-3 py-1 ${reverse ? '[animation-direction:reverse]' : ''}`}>
            {[...items, ...items].map((label, i) => (
                <span
                    key={`${label}-${i}`}
                    aria-hidden={i >= items.length}
                    className="px-4 py-2 rounded-full border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap shadow-xs"
                >
                    {label}
                </span>
            ))}
        </div>
    </div>
);
