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
    const isInfo = type === 'info' || type === 'blue';

    // Theme configurations
    const getTheme = () => {
        if (isDanger) {
            return {
                headerBg: 'bg-red-50/70',
                iconBg: 'bg-red-100 text-red-600',
                titleColor: 'text-red-900',
                btnGradient: 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 focus:ring-red-500',
                icon: <Trash2 size={24} className="stroke-[2.2]" />
            };
        }
        if (isWarning) {
            return {
                headerBg: 'bg-amber-50/70',
                iconBg: 'bg-amber-100 text-amber-600',
                titleColor: 'text-amber-900',
                btnGradient: 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 focus:ring-amber-500',
                icon: <AlertTriangle size={24} className="stroke-[2.2]" />
            };
        }
        if (isSuccess) {
            return {
                headerBg: 'bg-emerald-50/70',
                iconBg: 'bg-emerald-100 text-emerald-600',
                titleColor: 'text-emerald-900',
                btnGradient: 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 focus:ring-emerald-500',
                icon: <CheckCircle2 size={24} className="stroke-[2.2]" />
            };
        }
        // Default: info / blue / brand
        return {
            headerBg: 'bg-blue-50/70',
            iconBg: 'bg-blue-100 text-blue-600',
            titleColor: 'text-blue-900',
            btnGradient: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:ring-blue-500',
            icon: <Info size={24} className="stroke-[2.2]" />
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
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
                    />

                    {/* Centered Modal Card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.94, y: 8 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                        className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className={`p-6 ${theme.headerBg} border-b border-gray-100 flex items-start gap-4`}>
                            <div className={`p-3 rounded-2xl ${theme.iconBg} shadow-sm shrink-0`}>
                                {theme.icon}
                            </div>
                            <div className="flex-1 pr-2">
                                <h3 className={`text-lg font-bold ${theme.titleColor} tracking-tight leading-snug`}>
                                    {title}
                                </h3>
                                <div className="mt-2 text-sm text-gray-600 whitespace-pre-line leading-relaxed font-normal">
                                    {message}
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100/60"
                                aria-label="Close dialog"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="p-4 bg-gray-50/80 border-t border-gray-100 flex justify-end items-center gap-3">
                            {!isAlert && (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2.5 text-sm font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-200/80 rounded-xl transition-all"
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
                                className={`px-5 py-2.5 text-sm font-bold text-white rounded-xl shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-offset-2 ${theme.btnGradient}`}
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
