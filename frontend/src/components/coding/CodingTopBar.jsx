import React from 'react';
import { motion } from 'framer-motion';
import { Code2, Play } from 'lucide-react';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70';

/**
 * ONE compact bar for the coding round, LeetCode style: the problem switcher on the left, Run and Submit side by side as a pill group in
 * the middle, the timers and the proctor camera on the right (it wraps on a phone). The page owns every behaviour; this only arranges it.
 * `status` and `camera` are slots (the page's own timer pills and camera feed), `submitLabel` is the full text and `submitShortLabel` the
 * one used where the bar is tight.
 */
const CodingTopBar = ({
    title = 'Round 2: Practical Coding', problems = [], index = 0, onSelect, onRun, running = false, onSubmit, submitting = false,
    submitLabel = 'Submit', submitShortLabel = 'Submit', status = null, camera = null,
}) => (
    <div data-testid="coding-top-bar" className="shrink-0 rounded-lg border border-slate-200 dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* Left: round title (muted) and the problem switcher */}
        <div className="order-1 flex items-center gap-3 min-w-0">
            <span className="hidden xl:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <Code2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />{title}
            </span>
            <div role="tablist" aria-label="Problems" className="flex items-center gap-0.5 bg-slate-100 dark:bg-[#282828] p-0.5 rounded-lg max-w-full overflow-x-auto [&>*]:shrink-0">
                {problems.map((prob, idx) => (
                    <button
                        key={prob.id} type="button" role="tab" aria-selected={index === idx} onClick={() => onSelect?.(idx)}
                        className={`relative isolate min-h-[34px] px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${FOCUS} ${
                            index === idx ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {index === idx && (
                            <motion.span
                                layoutId="pw-problem-tab"
                                className="absolute inset-0 -z-10 rounded-md bg-white dark:bg-[#3a3a3a] border border-slate-200 dark:border-transparent"
                                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                            />
                        )}
                        Problem {idx + 1}
                    </button>
                ))}
            </div>
        </div>

        {/* Centre: Run (secondary) and Submit (primary) as one pill group */}
        <div className="order-3 w-full lg:w-auto lg:order-2 flex justify-center">
            <div role="group" aria-label="Run and submit" className="inline-flex items-stretch gap-0.5 rounded-full border border-slate-200 dark:border-[#3a3a3a] bg-slate-100 dark:bg-[#282828] p-0.5">
                <button
                    type="button" disabled={running} onClick={onRun} title="Run (Ctrl + ')"
                    className={`min-h-[34px] pl-3.5 pr-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-[#3a3a3a] disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${FOCUS}`}
                >
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{running ? 'Running…' : 'Run'}</span>
                </button>
                <button
                    type="button" disabled={submitting} onClick={onSubmit} title={submitLabel}
                    className={`min-h-[34px] px-4 rounded-full text-xs font-bold inline-flex items-center justify-center cursor-pointer bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${FOCUS}`}
                >
                    <span className="hidden 2xl:inline">{submitLabel}</span>
                    <span className="2xl:hidden">{submitShortLabel}</span>
                </button>
            </div>
        </div>

        {/* Right: timers and the proctor camera */}
        <div className="order-2 lg:order-3 ml-auto flex items-center justify-end gap-2 min-w-0">
            {status}
            {camera && <div className="w-[88px] shrink-0">{camera}</div>}
        </div>
    </div>
);

export default CodingTopBar;
