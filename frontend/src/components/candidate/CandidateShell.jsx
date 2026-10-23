import React from 'react';

/** Page chrome shared by the public candidate pages (entry and exam instructions). */
const CandidateShell = ({ children, maxWidth = 'max-w-3xl' }) => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center px-4 sm:px-8">
            <span className="text-lg font-extrabold text-[#5d8c2c] tracking-tight">PrepWin</span>
            <span className="ml-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Candidate Assessment</span>
        </header>
        <main className={`${maxWidth} mx-auto px-4 py-8 sm:py-12`}>{children}</main>
    </div>
);

export default CandidateShell;
