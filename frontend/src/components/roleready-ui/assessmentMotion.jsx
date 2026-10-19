import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1];

/** Sliding highlight shared between stepper items (use inside a `relative` item). */
export const StepHighlight = () => (
    <motion.span
        layoutId="pw-step-highlight"
        className="absolute inset-0 rounded-lg bg-white border border-slate-200 shadow-xs -z-10"
        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
    />
);

/** Check icon wrapper that pops in once when it first mounts. */
export const PopIn = ({ children, className = '' }) => {
    const reduce = useReducedMotion();
    return (
        <motion.span
            className={`inline-flex ${className}`}
            initial={reduce ? false : { scale: 0, rotate: -40, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 18 }}
        >
            {children}
        </motion.span>
    );
};

/** Staggered entrance container + items. */
export const Stagger = ({ children, className = '', delay = 0, gap = 0.08, as = 'div' }) => {
    const Tag = motion[as] || motion.div;
    return (
        <Tag
            className={className}
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}
        >
            {children}
        </Tag>
    );
};

export const StaggerItem = ({ children, className = '', y = 16, hover = false, as = 'div' }) => {
    const Tag = motion[as] || motion.div;
    return (
        <Tag
            className={className}
            variants={{
                hidden: { opacity: 0, y },
                show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
            }}
            whileHover={hover ? { y: -4 } : undefined}
        >
            {children}
        </Tag>
    );
};

/** Direction-aware slide/fade swap keyed on an index. Short, calm transition. */
export const SlideSwap = ({ index, children, className = '' }) => {
    const prev = useRef(index);
    const dir = index >= prev.current ? 1 : -1;
    useEffect(() => { prev.current = index; }, [index]);
    return (
        <motion.div
            key={index}
            className={className}
            initial={{ opacity: 0, x: 18 * dir }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
        >
            {children}
        </motion.div>
    );
};

/** Animated progress bar (width driven by existing counts). */
export const ProgressBar = ({ value, total, className = '', barClassName = 'bg-emerald-500' }) => {
    const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
    return (
        <div className={`w-full bg-slate-100 rounded-full h-1.5 overflow-hidden ${className}`}>
            <motion.div
                className={`h-full rounded-full ${barClassName}`}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
            />
        </div>
    );
};

/** One-off entrance with its own delay (no parent variants needed). */
export const Enter = ({ children, className = '', delay = 0, y = 16, x = 0, hover = false, as = 'div', ...rest }) => {
    const Tag = motion[as] || motion.div;
    return (
        <Tag
            className={className}
            initial={{ opacity: 0, y, x }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            transition={{ duration: 0.5, delay, ease: EASE }}
            whileHover={hover ? { y: -4, transition: { duration: 0.2 } } : undefined}
            {...rest}
        >
            {children}
        </Tag>
    );
};
