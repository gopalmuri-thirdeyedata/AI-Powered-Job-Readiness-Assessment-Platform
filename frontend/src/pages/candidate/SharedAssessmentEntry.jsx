import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Code2, Brain, ListChecks, Loader2, ShieldAlert } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import CandidateRegistrationModal from '../../components/candidate/CandidateRegistrationModal';
import { candidateApi, errorMessage } from '../../services/recruitmentApi';
import { loadRegistration, saveRegistration } from '../../services/assessmentSession';

const SECTION_ICONS = { aptitude: ListChecks, coding: Code2, interview: Brain };

/**
 * Public entry for the reusable shared link: /assessment/join/:shareToken
 *  1. fetch safe public metadata
 *  2. mandatory registration popup (Name, Phone, Email)  -> registration does NOT start the attempt or any timer
 *  3. successful registration -> the dedicated Exam Instructions page (ExamInstructions.jsx), which owns acknowledgement + start
 */
const SharedAssessmentEntry = () => {
    const { shareToken } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const instructionsPath = `/assessment/join/${shareToken}/instructions`;

    const [meta, setMeta] = useState(null);
    const [loadError, setLoadError] = useState(null); // { status, message }
    const [registering, setRegistering] = useState(false);
    const [registerError, setRegisterError] = useState('');
    const handedToken = searchParams.get('registration_token');
    const alreadyRegistered = !!loadRegistration(shareToken);

    // An Org Admin authorised a retake after a verified platform outage: the single-use token arrives as a query param.
    useEffect(() => {
        if (handedToken) {
            saveRegistration(shareToken, handedToken);
            navigate(instructionsPath, { replace: true });
        } else if (alreadyRegistered) {
            navigate(instructionsPath, { replace: true });
        }
    }, [handedToken, shareToken, navigate, instructionsPath, alreadyRegistered]);

    useEffect(() => {
        let active = true;
        candidateApi.getMeta(shareToken)
            .then((data) => { if (active) setMeta(data); })
            .catch((err) => {
                if (!active) return;
                const status = err?.response?.status;
                setLoadError({
                    status,
                    message: status === 410 ? (typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : 'This assessment is closed and is no longer accepting candidates.')
                        : status === 404 ? 'This assessment link is not valid. Please check the link you were given.'
                            : errorMessage(err, 'Unable to load this assessment right now.'),
                });
            });
        return () => { active = false; };
    }, [shareToken]);

    const handleRegister = async (payload) => {
        setRegistering(true);
        setRegisterError('');
        try {
            const res = await candidateApi.register(shareToken, payload);
            saveRegistration(shareToken, res.registration_token);
            navigate(instructionsPath, { replace: true }); // registration never starts the attempt: the instructions come first
        } catch (err) {
            setRegisterError(errorMessage(err, 'Registration failed. Please try again.'));
            setRegistering(false);
        }
    };

    if (loadError) {
        return (
            <CandidateShell>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
                    <ShieldAlert className="mx-auto text-slate-400 mb-3" size={36} />
                    <h1 className="text-xl font-extrabold">Assessment unavailable</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{loadError.message}</p>
                </div>
            </CandidateShell>
        );
    }

    if (!meta || alreadyRegistered || handedToken) {
        return <CandidateShell><div className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading assessment...</div></CandidateShell>;
    }

    return (
        <CandidateShell>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xs">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#5d8c2c]/15 text-[#5d8c2c] border border-[#5d8c2c]/30">
                        {meta.organization_name || 'Hiring Assessment'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400"><Clock size={13} /> {meta.total_duration_minutes} minutes total</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{meta.title}</h1>
                {meta.role && meta.role !== meta.title && <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 mt-1">{meta.role}</p>}
                {meta.description_snippet && <p className="text-sm text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">{meta.description_snippet}</p>}

                <div className="grid sm:grid-cols-3 gap-3 mt-6">
                    {meta.sections.map((s, i) => {
                        const Icon = SECTION_ICONS[s.key] || ListChecks;
                        return (
                            <div key={s.key} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                                <div className="flex items-center gap-2 text-[#5d8c2c] text-xs font-bold uppercase tracking-wide"><Icon size={14} /> Section {i + 1}</div>
                                <p className="font-bold mt-1">{s.label}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{s.minutes} minutes</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            <CandidateRegistrationModal assessmentTitle={meta.title} onSubmit={handleRegister} submitting={registering} serverError={registerError} />
        </CandidateShell>
    );
};

export default SharedAssessmentEntry;
