import React from 'react';

/**
 * Page chrome shared by the public candidate pages (entry, exam instructions, retest, completion).
 * The header carries the ThirdEye Data logo (/logo_main.png, the one logo asset the whole app uses) next to the PrepWin wordmark, so
 * every candidate screen is branded the same way without growing the 56px header.
 * The header has its OWN fixed container (the site width, max-w-6xl, with the responsive side padding) and left-aligns the brand in it, so the
 * brand starts at the same place on every candidate page. It must not follow `maxWidth`: that is only the cap of the page's CONTENT (narrow by
 * default for short forms and notices, wider for the instructions / retest screens), and a narrow cap would pull the brand toward the middle.
 * The widest framed pages use the same width, so there the brand and the frame share one left edge.
 * `framed` puts the content in ONE bordered, softly shadowed assessment container on a slightly darker page background, so the screen reads
 * as a deliberate component with a clear hierarchy (used by the instructions and retest screens).
 */
const CandidateShell = ({ children, maxWidth = 'max-w-3xl', framed = false }) => (
    <div className={`min-h-screen ${framed ? 'bg-slate-100 dark:bg-slate-950' : 'bg-slate-50 dark:bg-slate-950'} text-slate-900 dark:text-slate-100`}>
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="max-w-6xl mx-auto h-14 flex items-center justify-start px-4 sm:px-6 lg:px-8">
                {/* The logo is dark green on transparent: on the dark theme it sits on a light chip so its wordmark stays legible */}
                <span className="inline-flex shrink-0 items-center rounded-md dark:bg-slate-100 dark:px-1 dark:py-0.5">
                    <img src="/logo_main.png" alt="ThirdEye Data" width="115" height="28" className="h-7 w-auto shrink-0 object-contain" />
                </span>
                <span aria-hidden="true" className="mx-2 sm:mx-3 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
                <span className="text-lg font-extrabold text-[#5d8c2c] tracking-tight">PrepWin</span>
                <span className="ml-2 sm:ml-3 min-w-0 truncate whitespace-nowrap text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400">Candidate Assessment</span>
            </div>
        </header>
        <main className={`${maxWidth} mx-auto w-full px-4 sm:px-6 lg:px-8 ${framed ? 'py-5 sm:py-6' : 'py-6 sm:py-8'}`}>
            {framed
                ? <div data-testid="assessment-frame" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-5 lg:p-6">{children}</div>
                : children}
        </main>
    </div>
);

export default CandidateShell;
