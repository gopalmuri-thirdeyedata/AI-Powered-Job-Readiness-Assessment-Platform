import React from 'react';
import { Ban, Clock, Code2, Brain, FileQuestion, Hourglass, Info, ListChecks, Lock, Monitor, Timer, CalendarClock } from 'lucide-react';

/**
 * Shared building blocks of the two pre-assessment screens (Exam Instructions for the full assessment, the section retest entry page),
 * so both use one surface / border / radius / icon / type system. Colours are the app's own: slate neutrals with their dark counterparts
 * and the PrepWin green as the one restrained accent. There is deliberately no warning colour: nothing on these screens is an error.
 *
 * Type scale: page title text-2xl/3xl extrabold, section headings text-base bold, labels text-sm semibold, descriptions 13px, captions 11-12px.
 * Radius: the outer frame is 16px (rounded-2xl), everything inside it 12px (rounded-xl). Borders are always 1px slate.
 *
 * The rules are short on purpose: a student should take them in within seconds. Everything they describe is enforced by the platform
 * itself (server clock, autosave, camera / fullscreen checks on the device-check page, final submissions).
 */
export const SECTION_ICONS = { aptitude: ListChecks, coding: Code2, interview: Brain };

export const cardCls = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs';
/** A tinted panel that sits INSIDE the white assessment frame (section cards, rules). */
export const panelCls = 'rounded-xl border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-950/40';
export const primaryBtnCls = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] active:brightness-95 text-white font-bold text-sm px-6 py-2.5 shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';
/** The confirmation checkbox: large enough to tap, themed in both modes. */
export const checkboxCls = 'mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-800 accent-[#5d8c2c] focus:ring-[#5d8c2c] focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60 cursor-pointer';
const chipGreen = 'bg-[#5d8c2c]/10 text-[#4c7324] ring-1 ring-inset ring-[#5d8c2c]/20 dark:bg-[#5d8c2c]/20 dark:text-[#9fd05a] dark:ring-[#5d8c2c]/30';

/** "20" when every section has the same limit, otherwise null (the sentence then does not claim a single number). */
const commonMinutes = (sections) => {
    const set = new Set((sections || []).map((s) => s.minutes).filter((m) => Number.isFinite(m)));
    return set.size === 1 ? [...set][0] : null;
};

/** The five rules of a full assessment. Minutes come from the assessment's own configuration (the public metadata). */
export const fullAssessmentRules = ({ sections, totalMinutes }) => {
    const each = commonMinutes(sections);
    return [
        { key: 'attempt', icon: Ban, title: 'One Attempt', text: 'You cannot restart after starting.' },
        { key: 'time', icon: Timer, title: 'Time Limit',
          text: `${each ? `Each section has ${each} minutes` : 'Each section is timed'}; the full assessment is limited to ${totalMinutes} minutes.` },
        { key: 'pause', icon: Hourglass, title: 'No Pausing', text: 'The timer continues running once started.' },
        { key: 'submit', icon: Lock, title: 'Final Submission', text: 'Submitted sections cannot be reopened.' },
        { key: 'screen', icon: Monitor, title: 'Stay on Screen', text: 'Avoid refreshing, closing the tab, or switching windows.' },
    ];
};

/** The rules of a one-section retest: only what applies to that section. */
export const retestRules = ({ minutes }) => [
    { key: 'attempt', icon: Ban, title: 'One Attempt', text: 'You cannot restart after starting.' },
    { key: 'time', icon: Timer, title: 'Submit on Time', text: `You have ${minutes} minutes. Submit before the timer ends.` },
    { key: 'screen', icon: Monitor, title: 'Stay on Screen', text: 'Avoid refreshing, closing the tab, or switching windows.' },
];

/** The duration shown as a pill (used on every section card and on the retest card). */
export const DurationBadge = ({ minutes, className = '' }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${chipGreen} ${className}`}><Clock size={12} /> {minutes} minutes</span>
);

/** One section of the full assessment: icon, caption, name, duration. Equal height in a row; titles wrap instead of clipping. */
export const SectionCard = ({ caption, label, minutes, icon: Icon, className = '' }) => (
    <div className={`${panelCls} p-4 flex items-start gap-3 h-full transition-colors hover:border-[#5d8c2c]/50 dark:hover:border-[#5d8c2c]/60 ${className}`}>
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${chipGreen}`}><Icon size={19} /></span>
        <div className="min-w-0 flex-1">
            {caption && <p className="text-[11px] font-bold uppercase tracking-wide text-[#4c7324] dark:text-[#9fd05a]">{caption}</p>}
            <p className="font-bold leading-snug text-slate-900 dark:text-slate-100 break-words">{label}</p>
            <DurationBadge minutes={minutes} className="mt-2" />
        </div>
    </div>
);

/** The ONE section a retest is about: title, duration badge, format and validity, in a single bordered card. */
export const RetestSectionCard = ({ label, minutes, format, validUntil, validNote, icon: Icon, className = '' }) => (
    <section aria-label="Retest details" className={`${panelCls} p-4 sm:p-5 ${className}`}>
        <div className="flex items-start gap-3">
            <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${chipGreen}`}><Icon size={21} /></span>
            <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#4c7324] dark:text-[#9fd05a]">Retest section</p>
                <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100 break-words">{label}</h2>
                <DurationBadge minutes={minutes} className="mt-2" />
            </div>
        </div>
        <dl className="mt-4 space-y-2.5 border-t border-slate-200 dark:border-slate-700/70 pt-4 text-sm">
            {format && (
                <div className="flex items-start gap-2.5"><dt className="sr-only">Format</dt><FileQuestion size={16} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><dd className="font-semibold text-slate-800 dark:text-slate-200">{format}</dd></div>
            )}
            {validUntil && (
                <div className="flex items-start gap-2.5"><dt className="sr-only">Valid until</dt><CalendarClock size={16} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><dd className="text-slate-600 dark:text-slate-400"><span className="font-semibold text-slate-800 dark:text-slate-200">Valid until {validUntil}</span>{validNote && <span className="block text-xs mt-0.5" data-testid="retest-valid-until">{validNote}</span>}</dd></div>
            )}
        </dl>
    </section>
);

/**
 * "Assessment Rules": a bordered, neutral panel. Each rule is a compact row (icon, bold label, one sentence) separated by light dividers;
 * from the sm breakpoint the rows run in two columns, and an odd last rule spans the full width. No row is its own card.
 */
export const RulesCard = ({ rules, className = '', twoColumns = true }) => (
    <section aria-label="Assessment Rules" className={`${panelCls} p-4 sm:p-5 ${className}`}>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100"><Info size={17} className="text-[#5d8c2c] dark:text-[#9fd05a]" /> Assessment Rules</h2>
        <ul className={`mt-2 grid ${twoColumns ? 'sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-full sm:[&>li:nth-child(2)]:border-t-0 sm:[&>li:nth-child(even)]:border-l sm:[&>li:nth-child(even)]:pl-6 sm:[&>li:nth-child(odd)]:pr-6' : ''}`} data-testid="essential-rules">
            {rules.map(({ key, icon: Icon, title, text }) => (
                <li key={key} className="flex items-start gap-3 border-t border-slate-200 dark:border-slate-700/70 py-2.5 first:border-t-0">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"><Icon size={16} /></span>
                    <div className="min-w-0">
                        <p className="text-sm font-bold leading-snug text-slate-900 dark:text-slate-100">{title}</p>
                        <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-400">{text}</p>
                    </div>
                </li>
            ))}
        </ul>
    </section>
);
