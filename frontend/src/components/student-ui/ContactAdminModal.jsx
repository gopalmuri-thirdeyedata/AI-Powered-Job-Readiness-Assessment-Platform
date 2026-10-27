import React, { useEffect, useRef } from 'react';
import { Lock, X } from 'lucide-react';

/**
 * Shown when a student presses a locked "start assessment" button. Assessments are assigned by the admin, so the only
 * action here is to read the message and close it.
 */
const ContactAdminModal = ({ open, onClose }) => {
    const cancelRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        cancelRef.current?.focus();
        const onKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            id="contact-admin-modal"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="contact-admin-title"
                aria-describedby="contact-admin-body"
                className="relative w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 text-center"
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute top-3 right-3 w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                    <X className="w-4 h-4" />
                </button>
                <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-center mx-auto mb-4">
                    <Lock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 id="contact-admin-title" className="text-lg font-bold text-slate-900 dark:text-white mb-2">Assessment Locked</h2>
                <p id="contact-admin-body" className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                    Assessments are assigned by your admin. Please contact your admin to start an assessment.
                </p>
                <button
                    ref={cancelRef}
                    type="button"
                    onClick={onClose}
                    className="w-full min-h-[44px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

export default ContactAdminModal;
