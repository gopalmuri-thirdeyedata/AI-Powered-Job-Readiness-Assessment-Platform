import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    type = 'info',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isAlert = false
}) => {
    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const isDanger = type === 'danger';
    const isWarning = type === 'warning';
    const isSuccess = type === 'success';

    // One layout, a tone per type: the icon chip and the confirm button carry the meaning, the surface stays neutral.
    const getTheme = () => {
        if (isDanger) {
            return {
                iconBg: 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400',
                btn: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500/60',
                icon: <Trash2 size={20} />
            };
        }
        if (isWarning) {
            return {
                iconBg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
                btn: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500/60',
                icon: <AlertTriangle size={20} />
            };
        }
        if (isSuccess) {
            return {
                iconBg: 'bg-[#5d8c2c]/15 dark:bg-emerald-950/60 text-[#4c7324] dark:text-emerald-400',
                btn: 'bg-[#5d8c2c] hover:bg-[#4c7324] dark:bg-emerald-600 dark:hover:bg-emerald-500 focus-visible:ring-[#5d8c2c]/60',
                icon: <CheckCircle2 size={20} />
            };
        }
        // Default: info / blue
        return {
            iconBg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
            btn: 'bg-[#5d8c2c] hover:bg-[#4c7324] dark:bg-emerald-600 dark:hover:bg-emerald-500 focus-visible:ring-[#5d8c2c]/60',
            icon: <Info size={20} />
        };
    };

    const theme = getTheme();

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
                    />

                    {/* Centered Modal Card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 4 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        role="dialog"
                        aria-modal="true"
                        aria-label={title}
                        className="relative z-10 bg-white dark:bg-[var(--pw-surface)] rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.06),0_24px_48px_-12px_rgba(15,23,42,0.40)] max-w-md w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-800"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Body */}
                        <div className="p-5 sm:p-6 flex items-start gap-4">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${theme.iconBg}`}>
                                {theme.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-[17px] font-semibold text-slate-900 dark:text-white tracking-[-0.015em] leading-6">
                                    {title}
                                </h3>
                                <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-6 break-words">
                                    {message}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="-mr-2 -mt-1 text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                                aria-label="Close dialog"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="px-5 sm:px-6 py-4 bg-slate-50/80 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 rounded-b-xl flex flex-col-reverse sm:flex-row sm:justify-end sm:items-center gap-2 sm:gap-3">
                            {!isAlert && (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="min-h-[40px] px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                                >
                                    {cancelText}
                                </button>
                            )}
                            <button
                                type="button"
                                autoFocus
                                onClick={() => {
                                    if (onConfirm) onConfirm();
                                    onClose();
                                }}
                                className={`min-h-[40px] px-5 py-2 text-sm font-semibold text-white rounded-lg shadow-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ${theme.btn}`}
                            >
                                {confirmText}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default ConfirmationModal;
