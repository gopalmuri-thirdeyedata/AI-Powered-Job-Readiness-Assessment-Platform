import React from 'react';

/** Shared page frame for the four recruitment workflow views: same width, spacing and header treatment. */
const WorkspacePage = ({ title, description, children }) => (
    <div className="w-full max-w-[1280px] mx-auto pb-12 space-y-5">
        <header className="space-y-2.5 pb-4 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide bg-[#5d8c2c]/10 text-[#4c7324] ring-1 ring-inset ring-[#5d8c2c]/25 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#5d8c2c] dark:bg-emerald-400" aria-hidden="true" />
                    PrepWin Admin Workspace
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Standardized Candidate Pipeline</span>
            </div>
            <h1 className="pw-page-title">{title}</h1>
            {description && <p className="text-[15px] leading-6 text-slate-500 dark:text-slate-400 max-w-3xl">{description}</p>}
        </header>
        {children}
    </div>
);

export default WorkspacePage;
