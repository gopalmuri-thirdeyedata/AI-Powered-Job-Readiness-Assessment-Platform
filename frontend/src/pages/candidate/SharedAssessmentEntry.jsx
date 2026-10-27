import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Code2, Brain, ListChecks, Loader2, ShieldAlert } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import StudentAccessLogin from '../../components/candidate/StudentAccessLogin';
import { candidateApi, errorMessage, studentAssessmentApi } from '../../services/recruitmentApi';
import { hasStudentAccess, loadRegistration, saveRegistration, saveStudentAccess } from '../../services/assessmentSession';
import { logout } from '../../auth/authSession';
import { useAuth } from '../../auth/useAuth';

const SECTION_ICONS = { aptitude: ListChecks, coding: Code2, interview: Brain };

/**
 * Entry for the reusable shared link: /assessment/join/:shareToken
 *  1. fetch safe public metadata (this also tells the student whether the link is still valid)
 *  2. the student signs in with the email and password an administrator gave them (the old name / phone / email form is gone)
 *  3. the server checks the account and prepares the student's access: this does NOT start the attempt or any timer
 *  4. -> the Exam Instructions page (ExamInstructions.jsx), which owns acknowledgement + the explicit Start Assessment
 * A student who already finished (or is past) the attempt is sent on to their completion page instead; nothing here ever
 * hands out a second attempt.
 */
const SharedAssessmentEntry = () => {
    const { shareToken } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const instructionsPath = `/assessment/join/${shareToken}/instructions`;
    const completePath = `/assessment/join/${shareToken}/complete`;
    const { user, isLoaded, isSignedIn } = useAuth();
    const isStudent = isSignedIn && user?.role === 'STUDENT';

    const [meta, setMeta] = useState(null);
    const [loadError, setLoadError] = useState(null); // { status, message }
    const [access, setAccess] = useState({ phase: 'idle', message: '' }); // idle | checking | blocked
    const handedToken = searchParams.get('registration_token');
    // A token left over from a signed-in student sitting is never trusted blindly: access is re-checked (and re-issued) below.
    const alreadyRegistered = !!loadRegistration(shareToken) && !hasStudentAccess(shareToken);
    const mounted = useRef(true);
    const accessFor = useRef(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const [retake, setRetake] = useState({ phase: 'idle', message: '' }); // idle | checking | login | invalid
    useEffect(() => {
        if (!handedToken && alreadyRegistered) navigate(instructionsPath, { replace: true });
    }, [handedToken, navigate, instructionsPath, alreadyRegistered]);

    // An Org Admin authorised a retake after a verified platform outage: the single-use token arrives as a query param.
    // The server says whether the holder must sign in as a student first (a retake of a student's registration always does); only
    // then is the token used, and only together with the signed-in account (see the access effect below). The page address never
    // changes while signing in, so the student comes straight back to this retake. Where the student lands next is computed from the
    // share token alone: no redirect target is ever read from the URL.
    useEffect(() => {
        if (!handedToken || !meta) return undefined;
        let active = true;
        setRetake({ phase: 'checking', message: '' });
        candidateApi.registrationInfo(shareToken, handedToken)
            .then((info) => {
                if (!active) return;
                if (info.student_login_required) {
                    setRetake({ phase: 'login', message: '' });
                } else {                                   // accountless candidate: the unchanged hand-over
                    saveRegistration(shareToken, handedToken);
                    navigate(instructionsPath, { replace: true });
                }
            })
            .catch((err) => { if (active) setRetake({ phase: 'invalid', message: errorMessage(err, 'This link is not valid.') }); });
        return () => { active = false; };
    }, [handedToken, meta, shareToken, navigate, instructionsPath]);

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

    // Signed-in student on a valid link: ask the server for this student's access (once per account and link).
    useEffect(() => {
        if (!meta || !isStudent) return;
        if (handedToken && retake.phase !== 'login') return;   // a retake token is first checked by the server (effect above)
        const key = `${user.id}:${shareToken}`;
        if (accessFor.current === key) return;
        accessFor.current = key;
        setAccess({ phase: 'checking', message: '' });
        studentAssessmentApi.access(shareToken, handedToken || undefined)
            .then((res) => {
                if (!mounted.current) return;
                saveStudentAccess(shareToken);
                if (res.status === 'READY') {
                    saveRegistration(shareToken, res.registration_token);
                    navigate(instructionsPath, { replace: true }); // access never starts the attempt: the instructions come first
                } else if (res.attempt?.submitted) {
                    navigate(completePath, { replace: true });
                } else {
                    setAccess({ phase: 'blocked', message: 'You have already started this assessment, so it cannot be opened again or resumed. If you think this is a mistake, please contact the hiring team.' });
                }
            })
            .catch((err) => {
                if (!mounted.current) return;
                accessFor.current = null;
                setAccess({ phase: 'blocked', message: errorMessage(err, 'Unable to open this assessment right now. Please try again.') });
            });
    }, [meta, isStudent, handedToken, retake.phase, user?.id, shareToken, navigate, instructionsPath, completePath]);

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

    if (handedToken && retake.phase === 'invalid') {
        return (
            <CandidateShell>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
                    <ShieldAlert className="mx-auto text-slate-400 mb-3" size={36} />
                    <h1 className="text-xl font-extrabold">This link cannot be used</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{retake.message} Please contact the hiring team for a new link.</p>
                </div>
            </CandidateShell>
        );
    }

    if (!meta || !isLoaded || alreadyRegistered || (handedToken && retake.phase !== 'login') || access.phase === 'checking') {
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

            {isSignedIn && !isStudent && (
                <div role="alert" className="mt-6 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-6 text-sm text-amber-900 dark:text-amber-200">
                    <p className="font-bold">You are signed in with an administrator account.</p>
                    <p className="mt-1">This assessment is for student accounts. Sign out and sign in with the student email and password you were given.</p>
                    <button type="button" onClick={() => logout()} className="mt-3 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] text-white font-bold px-5 py-2">Sign out</button>
                </div>
            )}
            {/* Stays mounted through a refused administrator sign-in (sign-in, then sign-out) so its message is not lost */}
            {!isStudent && handedToken && (
                <p className="mt-6 text-sm rounded-xl border border-[#5d8c2c]/30 bg-[#5d8c2c]/10 px-4 py-3" role="status">
                    Your hiring team has authorised a new attempt for you. Sign in with your student account to continue.
                </p>
            )}
            {!isStudent && <StudentAccessLogin assessmentTitle={meta.title} />}
            {access.phase === 'blocked' && (
                <div role="alert" className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm">
                    <p>{access.message}</p>
                    <button type="button" onClick={() => navigate('/student/dashboard')} className="mt-3 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] text-white font-bold px-5 py-2">Go to my dashboard</button>
                </div>
            )}
        </CandidateShell>
    );
};

export default SharedAssessmentEntry;
