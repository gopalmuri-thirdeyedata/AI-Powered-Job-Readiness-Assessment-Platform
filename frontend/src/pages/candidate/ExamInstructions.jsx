import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Code2, Brain, ListChecks, Loader2, ShieldAlert } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import { candidateApi, errorMessage } from '../../services/recruitmentApi';
import { loadRegistration, saveAcknowledgement } from '../../services/assessmentSession';

const SECTION_ICONS = { aptitude: ListChecks, coding: Code2, interview: Brain };
const DEFAULT_SECTIONS = [
    { key: 'aptitude', label: 'Aptitude', minutes: 20 },
    { key: 'coding', label: 'Coding', minutes: 20 },
    { key: 'interview', label: 'AI Technical Interview', minutes: 20 },
];

export const instructionsFor = (sections, total) => {
    const [a, c, i] = sections;
    return [
        `The assessment has three sequential sections: ${a.label} (${a.minutes} minutes), ${c.label} (${c.minutes} minutes) and the voice-based ${i.label} (${i.minutes} minutes).`,
        `The whole assessment lasts at most ${total} minutes from the moment you click Start Assessment. The server clock is the only clock that counts; the timers on screen are for display.`,
        'Sections must be completed in this order. You cannot skip a section, and once you submit a section you cannot go back or reopen it.',
        'You need a working camera and microphone and must stay in fullscreen. Leaving fullscreen, switching tabs or windows, or other people or devices in view are recorded as integrity events and shared with the hiring team.',
        'Do not refresh, close, duplicate or leave the assessment tab after you start. The assessment cannot be paused or resumed: an interruption ends your attempt permanently, and you have only one attempt.',
        'Use a stable internet connection and keep this window open for the full sitting.',
        'Answer each section within its time limit and submit it with the Submit button. When a section timer reaches zero, the answers you have entered are submitted automatically, and submitted answers cannot be changed.',
        'Read these instructions carefully before you begin. Nothing is timed until you click Start Assessment on the device check page that follows.',
    ];
};

/**
 * Exam Instructions: /assessment/join/:shareToken/instructions
 * Shown right after a successful registration. Nothing on this page starts the attempt or any timer: it only reads public
 * metadata and remembers the acknowledgement. The attempt, the rules acknowledgement record and the server-authoritative
 * deadline are created solely by the explicit "Start Assessment" click on the device check page that follows
 * (/assessment/join/:shareToken/assessment), where the server refuses to start without the acknowledgement.
 */
const ExamInstructions = () => {
    const { shareToken } = useParams();
    const navigate = useNavigate();

    const [registrationToken] = useState(() => loadRegistration(shareToken));
    const [meta, setMeta] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);

    useEffect(() => {
        if (!registrationToken) return undefined;
        let active = true;
        candidateApi.getMeta(shareToken)
            .then((data) => { if (active) setMeta(data); })
            .catch((err) => {
                if (!active) return;
                const status = err?.response?.status;
                setLoadError(status === 410 ? 'This assessment is closed and is no longer accepting candidates.'
                    : status === 404 ? 'This assessment link is not valid. Please check the link you were given.'
                        : errorMessage(err, 'Unable to load the instructions right now.'));
            });
        return () => { active = false; };
    }, [shareToken, registrationToken]);

    // Nobody reaches the instructions without registering first.
    if (!registrationToken) return <Navigate to={`/assessment/join/${shareToken}`} replace />;

    const handleContinue = () => {
        if (!acknowledged) return;
        saveAcknowledgement(shareToken);
        navigate(`/assessment/join/${shareToken}/assessment`);   // device check; still nothing is timed
    };

    if (loadError) {
        return (
            <CandidateShell>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
                    <ShieldAlert className="mx-auto text-slate-400 mb-3" size={36} />
                    <h1 className="text-xl font-extrabold">Assessment unavailable</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{loadError}</p>
                </div>
            </CandidateShell>
        );
    }

    if (!meta) {
        return <CandidateShell><div className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading instructions...</div></CandidateShell>;
    }

    const sections = (meta.sections?.length === 3 ? meta.sections : DEFAULT_SECTIONS);
    const total = meta.total_duration_minutes || 60;

    return (
        <CandidateShell>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xs space-y-6">
                <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#5d8c2c]/15 text-[#4c7324] dark:text-[#9fd05a] border border-[#5d8c2c]/30">
                            <CheckCircle2 size={13} /> Registration complete
                        </span>
                        {meta.organization_name && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.organization_name}</span>}
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Exam Instructions</h1>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 mt-1">{meta.title}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-3">Your timer has <b>not</b> started. Read the instructions below and confirm them. You will then check your camera and microphone, and the timer starts only when you click Start Assessment.</p>
                </div>

                <ol className="grid sm:grid-cols-3 gap-3" aria-label="Assessment sections in order">
                    {sections.map((s, idx) => {
                        const Icon = SECTION_ICONS[s.key] || ListChecks;
                        return (
                            <li key={s.key} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                                <div className="flex items-center gap-2 text-[#5d8c2c] text-xs font-bold uppercase tracking-wide"><Icon size={14} /> Section {idx + 1}</div>
                                <p className="font-bold mt-1">{s.label}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{s.minutes} minutes</p>
                            </li>
                        );
                    })}
                </ol>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 -mt-3"><Clock size={13} /> Maximum overall duration: {total} minutes</p>

                <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4">
                    <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300 text-sm mb-2"><AlertTriangle size={16} /> Please read carefully</div>
                    <ul className="list-disc pl-5 space-y-1.5 text-sm text-amber-900 dark:text-amber-200">
                        {instructionsFor(sections, total).map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </div>

                <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                        type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#5d8c2c] focus:ring-[#5d8c2c]" id="instructions-ack"
                    />
                    <span className="text-sm font-semibold">I have read and understood the assessment instructions and agree to follow the assessment rules.</span>
                </label>

                <button
                    type="button" onClick={handleContinue} disabled={!acknowledged}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-8 py-3 transition-colors"
                >
                    Continue to Device Check
                </button>
            </div>
        </CandidateShell>
    );
};

export default ExamInstructions;
