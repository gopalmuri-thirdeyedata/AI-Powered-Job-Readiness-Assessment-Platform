import React from 'react';

/** Shared page frame for the four recruitment workflow views: same width, spacing and header treatment. */
const WorkspacePage = ({ title, description, children }) => (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 pb-16 space-y-6">
        <header className="pt-2">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#5d8c2c]/15 text-[#5d8c2c] border border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
                    PrepWin Admin Workspace
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Standardized Candidate Pipeline</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{title}</h1>
            {description && <p className="text-slate-600 dark:text-slate-400 mt-1.5 text-sm font-normal">{description}</p>}
        </header>
        {children}
    </div>
);

export default WorkspacePage;
