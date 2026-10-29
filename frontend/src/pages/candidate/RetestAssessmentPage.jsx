import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, ListChecks, Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import CandidateShell from '../../components/candidate/CandidateShell';
import StudentAccessLogin from '../../components/candidate/StudentAccessLogin';
import { RetestSectionCard, RulesCard, SECTION_ICONS, cardCls, checkboxCls, primaryBtnCls, retestRules } from '../../components/candidate/AssessmentBrief';
import { AssessmentWorkspace } from '../roleready/RoleReadyAssessment';
import { retestApi, errorMessage } from '../../services/recruitmentApi';
import { createRetestAssessmentApi } from '../../services/assessmentApi';
import { clearLease } from '../../services/assessmentSession';
import { useAuth } from '../../auth/useAuth';

const HEARTBEAT_MS = 15000;
const card = cardCls;
const primary = primaryBtnCls;

// The Student Dashboard route (App.jsx). A retest that was already submitted (just now, or seen again after a refresh) offers a way back to it.
const DASHBOARD_PATH = '/student/dashboard';
const SUBMITTED_STATUSES = ['COMPLETED', 'SUBMITTED', 'EVALUATION_PENDING'];

const Notice = ({ icon: Icon = ShieldAlert, title, children, tone = 'muted', action = null }) => (
    <CandidateShell>
        <div className={`${card} p-8 text-center`}>
            <Icon className={`mx-auto mb-3 ${tone === 'ok' ? 'text-[#5d8c2c]' : 'text-slate-400'}`} size={38} />
            <h1 className="text-xl font-extrabold">{title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{children}</p>
            {action}
        </div>
    </CandidateShell>
);

/**
 * Section retest: /assessment/retest/:retestUuid[?token=...]
 *
 * An administrator assigned ONE section of an attempt that is already over. The candidate is identified by what they already have:
 *   - a signed-in student account (the same sign-in form as the assessment link; nothing about them is typed again), or
 *   - for an accountless registration, the single-use token carried by the administrator's link.
 * The sitting itself is the shared AssessmentWorkspace (same editor, voice interview, timers, drafts and proctoring) restricted to that
 * section; the server grades it and only then replaces that section's effective score. Like the original sitting it cannot be resumed.
 */
const RetestAssessmentPage = () => {
    const { retestUuid } = useParams();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || null;
    const { isLoaded, isSignedIn, user } = useAuth();
    const navigate = useNavigate();
    const isStudent = isSignedIn && user?.role === 'STUDENT';   // accountless candidates have no dashboard

    const [phase, setPhase] = useState('loading');   // loading | login | intro | ready | blocked | closed
    const [info, setInfo] = useState(null);
    const [message, setMessage] = useState('');
    const [accepted, setAccepted] = useState(false);
    const [outcome, setOutcome] = useState(null);
    const [handle, setHandle] = useState(null);
    const apiRef = useRef(null);

    const block = useCallback((msg) => { clearLease(); setMessage(msg); setPhase('blocked'); }, []);

    useEffect(() => {
        if (!isLoaded || handle) return undefined;
        let alive = true;
        setPhase((p) => (p === 'ready' ? p : 'loading'));
        retestApi.info(retestUuid, token)
            .then((data) => {
                if (!alive) return;
                setInfo(data);
                setPhase(data.can_start ? 'intro' : 'blocked');
                if (!data.can_start) setMessage(data.message || 'This retest is not available.');
            })
            .catch((err) => {
                if (!alive) return;
                const detail = err?.response?.data?.detail;
                if (err?.response?.status === 401 && detail?.code === 'SIGN_IN_REQUIRED') { setPhase('login'); return; }
                if (err?.response?.status === 404) { block('This retest link is not valid for you. Please check the link you were given or contact the hiring team.'); return; }
                block(errorMessage(err, 'Unable to open this retest right now.'));
            });
        return () => { alive = false; };
    }, [retestUuid, token, isLoaded, isSignedIn, handle, block]);

    const api = useMemo(() => (info && accepted ? createRetestAssessmentApi({
        retestUuid, retestToken: token, section: info.section, meta: info.assessment, acknowledged: accepted,
        onSession: (s) => setHandle({ ...s }),
    }) : null), [info, accepted, retestUuid, token]);
    apiRef.current = api;

    // Heartbeat: only the tab holding the in-memory lease can send it; the server decides interruption from it.
    useEffect(() => {
        if (!handle || phase !== 'ready') return undefined;
        const beat = () => {
            retestApi.heartbeat(handle)
                .then((s) => { if (s?.terminal) { clearLease(); setOutcome(s); setPhase('closed'); } })
                .catch((err) => {
                    if ([401, 403, 404, 409].includes(err?.response?.status)) block(errorMessage(err, 'Your retest was interrupted.'));
                });
        };
        const id = setInterval(beat, HEARTBEAT_MS);
        return () => clearInterval(id);
    }, [handle, phase, block]);

    useEffect(() => {
        if (!handle || phase !== 'ready') return undefined;
        const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [handle, phase]);

    const onFinished = useCallback(() => {
        clearLease();
        const last = apiRef.current?.getLastState?.();
        setOutcome(last || { state: 'SUBMITTED' });
        setPhase('closed');
    }, []);

    if (phase === 'loading' || !isLoaded) {
        return <CandidateShell><div className="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 className="animate-spin" size={18} /> Opening your retest...</div></CandidateShell>;
    }
    if (phase === 'login') {
        return (
            <CandidateShell>
                <div className={`${card} p-6 sm:p-8`}>
                    <h1 className="text-xl font-extrabold">Sign in to open your retest</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Use the same student account you used for the assessment. You do not need to register again.</p>
                </div>
                <StudentAccessLogin assessmentTitle="your retest" />
            </CandidateShell>
        );
    }
    const backToDashboard = (
        <div className="mt-5">
            <button type="button" className={primary} onClick={() => navigate(DASHBOARD_PATH)}>Back to Dashboard</button>
        </div>
    );
    // an already-submitted retest (e.g. after a refresh) cannot be started again; the student can still return to the dashboard
    if (phase === 'blocked') return <Notice title="Retest unavailable" action={isStudent && SUBMITTED_STATUSES.includes(info?.status) ? backToDashboard : null}>{message}</Notice>;
    if (phase === 'closed') {
        const pending = !!outcome?.evaluation_pending || outcome?.state === 'EVALUATION_PENDING';
        const ok = outcome?.state === 'COMPLETED' || pending || outcome?.state === 'SUBMITTED';
        return (
            <Notice icon={ok ? CheckCircle2 : Clock} title={ok ? 'Retest submitted' : 'Retest closed'} tone={ok ? 'ok' : 'muted'} action={ok && isStudent ? backToDashboard : null}>
                {ok
                    ? (pending ? 'Your responses were received. The evaluation is pending and the hiring team has been notified. You may close this window.'
                        : 'Thank you. Your responses were received and evaluated. The hiring team will review your updated result. You may close this window.')
                    : (outcome?.message || 'This retest has ended.')}
            </Notice>
        );
    }
    if (phase === 'intro' && info) {
        const Icon = SECTION_ICONS[info.section] || ListChecks;
        const validUntil = info.expires_at ? new Date(info.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
        return (
            <CandidateShell maxWidth="max-w-6xl" framed>
                <div className="space-y-4">
                    <header>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#5d8c2c]/15 text-[#4c7324] dark:text-[#9fd05a] border border-[#5d8c2c]/30">
                                <RotateCcw size={13} /> Retest assigned
                            </span>
                            {(info.assessment?.company_name || info.assessment?.organization_name) && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{info.assessment.company_name || info.assessment.organization_name}</span>}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{info.label} Retest</h1>
                        {info.assessment?.title && <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 mt-1">{info.assessment.title}</p>}
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-3xl">
                            You are retaking only the {info.label} section. Your other sections are unaffected.
                            You will check your camera and microphone next; the timer starts only when you click Start Assessment.
                        </p>
                        {user?.email && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Signed in as <b className="font-semibold [overflow-wrap:anywhere]">{user.email}</b></p>}
                    </header>

                    <div className="grid gap-5 lg:grid-cols-5 lg:items-start">
                        <RetestSectionCard className="lg:col-span-2" icon={Icon} label={info.label} minutes={info.minutes} format={info.format}
                            validUntil={validUntil} validNote={validUntil ? 'After this time the retest can no longer be started or submitted.' : null} />
                        <RulesCard className="lg:col-span-3" rules={retestRules({ minutes: info.minutes })} twoColumns={false} />
                    </div>

                    <div className="flex flex-col gap-4 border-t border-slate-200 dark:border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input type="checkbox" className={checkboxCls} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">I have read and accept the assessment rules.</span>
                        </label>
                        <button type="button" className={`${primaryBtnCls} w-full sm:w-auto sm:shrink-0 px-8`} disabled={!accepted} onClick={() => setPhase('ready')}>Continue to device check</button>
                    </div>
                </div>
            </CandidateShell>
        );
    }
    if (phase !== 'ready' || !api) return null;

    return (
        <AssessmentWorkspace
            sessionUuid="retest"
            api={api}
            mode="recruitment"
            skipInstructions
            proctoringPolicy="flag"
            retestSection={info.section}
            onFinished={onFinished}
            onBackToInstructions={handle ? null : () => setPhase('intro')}
        />
    );
};

export default RetestAssessmentPage;
