import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, ListChecks, Loader2, ShieldAlert } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import { RulesCard, SECTION_ICONS, SectionCard, cardCls, checkboxCls, fullAssessmentRules, primaryBtnCls } from '../../components/candidate/AssessmentBrief';
import { candidateApi, errorMessage } from '../../services/recruitmentApi';
import { loadRegistration, saveAcknowledgement } from '../../services/assessmentSession';

const DEFAULT_SECTIONS = [
    { key: 'aptitude', label: 'Aptitude', minutes: 20 },
    { key: 'coding', label: 'Coding', minutes: 20 },
    { key: 'interview', label: 'AI Technical Interview', minutes: 10 },
];

/**
 * Exam Instructions: /assessment/join/:shareToken/instructions
 * Shown right after a successful registration. Nothing on this page starts the attempt or any timer: it only reads public
 * metadata and remembers the acknowledgement. The attempt, the rules acknowledgement record and the server-authoritative
 * deadline are created solely by the explicit "Start Assessment" click on the device check page that follows
 * (/assessment/join/:shareToken/assessment), where the server refuses to start without the acknowledgement.
 *
 * Layout: one wide container; overview (three section cards + the overall limit), a compact Assessment Rules card (five one-sentence
 * rules, minutes read from the assessment's own configuration), and one action bar. The long rule texts the server still publishes
 * in its public metadata are deliberately not shown: students should be able to take the rules in within seconds.
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
                setLoadError(status === 410 ? (typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : 'This assessment is closed and is no longer accepting candidates.')
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
                <div className={`${cardCls} p-8 text-center`}>
                    <ShieldAlert className="mx-auto text-slate-400 mb-3" size={36} />
                    <h1 className="text-xl font-extrabold">Assessment unavailable</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{loadError}</p>
                </div>
            </CandidateShell>
        );
    }

    if (!meta) {
        return <CandidateShell maxWidth="max-w-6xl" framed><div className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading instructions...</div></CandidateShell>;
    }

    const sections = (meta.sections?.length === 3 ? meta.sections : DEFAULT_SECTIONS);
    const total = meta.total_duration_minutes || 60;

    return (
        <CandidateShell maxWidth="max-w-6xl" framed>
            <div className="space-y-4">
                <header>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#5d8c2c]/15 text-[#4c7324] dark:text-[#9fd05a] border border-[#5d8c2c]/30">
                            <CheckCircle2 size={13} /> Registration complete
                        </span>
                        {(meta.company_name || meta.organization_name) && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.company_name || meta.organization_name}</span>}
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Exam Instructions</h1>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 mt-1">{meta.title}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-3xl">Your timer has <b>not</b> started. After you confirm the rules you will check your camera and microphone; the timer starts only when you click Start Assessment.</p>
                </header>

                <section aria-label="Assessment overview" className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <h2 className="text-base font-bold">Assessment sections</h2>
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400"><Clock size={13} /> Maximum overall duration: {total} minutes</p>
                    </div>
                    <ol className="grid gap-3 sm:grid-cols-3" aria-label="Assessment sections in order">
                        {sections.map((s, idx) => (
                            <li key={s.key} className="min-w-0"><SectionCard caption={`Section ${idx + 1}`} label={s.label} minutes={s.minutes} icon={SECTION_ICONS[s.key] || ListChecks} /></li>
                        ))}
                    </ol>
                </section>

                <RulesCard rules={fullAssessmentRules({ sections, totalMinutes: total })} />

                <div className="flex flex-col gap-4 border-t border-slate-200 dark:border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                            type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}
                            className={checkboxCls} id="instructions-ack"
                        />
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">I have read and understood the assessment instructions and agree to follow the assessment rules.</span>
                    </label>
                    <button type="button" onClick={handleContinue} disabled={!acknowledged} className={`${primaryBtnCls} w-full sm:w-auto sm:shrink-0 px-8`}>
                        Continue to Device Check
                    </button>
                </div>
            </div>
        </CandidateShell>
    );
};

export default ExamInstructions;
