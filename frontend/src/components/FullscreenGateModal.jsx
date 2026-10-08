import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, AlertTriangle, ShieldAlert, ArrowRight, RefreshCw, Lock } from 'lucide-react';

/**
 * FullscreenGateModal
 *
 * Fullscreen entry gate and exit recovery modal for Aptitude, Coding, and Technical Interview rounds.
 *
 * Props:
 * - isOpen: boolean
 * - mode: 'entry' | 'recovery'
 * - onAction: Function (invoked on button click, e.g. enterFullscreen / returnToFullscreen)
 * - timeLeft: number (seconds remaining in recovery countdown, default 10)
 * - error: string | null (error message if browser denies fullscreen request)
 * - title: string (optional override)
 * - description: string (optional override)
 */
const FullscreenGateModal = ({
    isOpen = false,
    mode = 'entry',
    onAction,
    timeLeft = 10,
    error = null,
    title,
    description
}) => {
    if (!isOpen) return null;

    const isRecovery = mode === 'recovery';

    const defaultTitle = 'Fullscreen Required';
    const displayTitle = title || defaultTitle;

    const defaultEntryDescription =
        'This assessment must be taken in fullscreen mode to ensure proctoring integrity and prevent distractions. Please enter fullscreen to begin.';

    const defaultRecoveryDescription =
        'You exited fullscreen. Return to fullscreen within 10 seconds to continue.';

    const displayDescription = description || (isRecovery ? defaultRecoveryDescription : defaultEntryDescription);

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 select-none">
                <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: 16 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-750 bg-slate-900/95 p-8 text-white shadow-2xl shadow-black/60"
                    style={{ border: isRecovery ? '1px solid #ef4444' : '1px solid #3b82f6' }}
                >
                    {/* Glowing Accent Top Bar */}
                    <div
                        className={`absolute top-0 left-0 right-0 h-1.5 ${
                            isRecovery
                                ? 'bg-gradient-to-r from-red-500 via-orange-500 to-red-500 animate-pulse'
                                : 'bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400'
                        }`}
                    />

                    {/* Icon Badge */}
                    <div className="flex justify-center mb-6">
                        <div
                            className={`flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg ${
                                isRecovery
                                    ? 'bg-red-500/15 text-red-400 ring-2 ring-red-500/30'
                                    : 'bg-blue-500/15 text-blue-400 ring-2 ring-blue-500/30'
                            }`}
                        >
                            {isRecovery ? (
                                <AlertTriangle className="h-10 w-10 animate-bounce" />
                            ) : (
                                <Maximize2 className="h-10 w-10" />
                            )}
                        </div>
                    </div>

                    {/* Title */}
                    <h2 className="text-center text-2xl font-bold tracking-tight text-white mb-2">
                        {displayTitle}
                    </h2>

                    {/* Description */}
                    <p className="text-center text-slate-300 text-sm leading-relaxed mb-6">
                        {displayDescription}
                    </p>

                    {/* Recovery Mode: Countdown Indicator */}
                    {isRecovery && (
                        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-center">
                            <div className="flex items-center justify-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">
                                <ClockIcon className="h-4 w-4" />
                                <span>Recovery Window</span>
                            </div>
                            <div className="flex items-baseline justify-center gap-2">
                                <span className="text-4xl font-black text-red-400 tabular-nums">
                                    {Math.max(0, timeLeft)}
                                </span>
                                <span className="text-sm font-medium text-red-300">
                                    seconds remaining
                                </span>
                            </div>
                            <p className="text-xs text-red-300/80 mt-2">
                                Assessment will register a malpractice violation if fullscreen is not restored before timeout.
                            </p>
                        </div>
                    )}

                    {/* Entry Mode Security Callout */}
                    {!isRecovery && (
                        <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-950/30 p-4 space-y-2 text-xs text-slate-300">
                            <div className="flex items-center gap-2 text-blue-400 font-semibold">
                                <Lock className="h-4 w-4" />
                                <span>Security Rules in Fullscreen:</span>
                            </div>
                            <ul className="list-disc list-inside space-y-1 text-slate-400">
                                <li>Exiting fullscreen or switching applications is flagged</li>
                                <li>Pressing ESC triggers a 10-second recovery timeout</li>
                                <li>Assessment UI is locked while outside fullscreen mode</li>
                            </ul>
                        </div>
                    )}

                    {/* Error Display */}
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6 rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 text-xs text-amber-200 flex items-start gap-3"
                        >
                            <ShieldAlert className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-semibold text-amber-300 mb-0.5">Fullscreen Permission Needed</p>
                                <p>{error}</p>
                            </div>
                        </motion.div>
                    )}

                    {/* Primary Action Button */}
                    <div className="space-y-3">
                        <button
                            type="button"
                            onClick={onAction}
                            className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 px-6 font-semibold text-white shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                                isRecovery
                                    ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 focus:ring-red-500 shadow-red-900/30'
                                    : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:via-indigo-500 hover:to-blue-600 focus:ring-blue-500 shadow-blue-900/40'
                            }`}
                        >
                            {isRecovery ? (
                                <>
                                    <RefreshCw className="h-5 w-5" />
                                    <span>Return to Fullscreen</span>
                                </>
                            ) : (
                                <>
                                    <span>Enter Fullscreen & Start</span>
                                    <ArrowRight className="h-5 w-5" />
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

const ClockIcon = ({ className = 'h-4 w-4' }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

export default FullscreenGateModal;
