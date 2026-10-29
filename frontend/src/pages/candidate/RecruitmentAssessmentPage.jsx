import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, ShieldAlert } from 'lucide-react';
import { AssessmentWorkspace } from '../roleready/RoleReadyAssessment';
import { candidateApi, errorMessage } from '../../services/recruitmentApi';
import { createRecruitmentAssessmentApi } from '../../services/assessmentApi';
import {
    clearAcknowledgement, clearLease, clearSession, hasAcknowledged, hasStudentAccess, loadRegistration, loadSession, setLease,
} from '../../services/assessmentSession';

const HEARTBEAT_MS = 15000;
const RELOAD_WARNING = 'Reloading is allowed, but the timer keeps running and the reload is recorded.';

// One resume request per reload: React StrictMode runs effects twice in development, and every resume issues a new lease and is recorded.
let resumeInFlight = null;
const resumeOnce = (stored) => {
    if (!resumeInFlight || resumeInFlight.uuid !== stored.uuid) {
        const promise = candidateApi.resume({ uuid: stored.uuid, token: stored.token });
        resumeInFlight = { uuid: stored.uuid, promise };
        promise.finally(() => setTimeout(() => { if (resumeInFlight?.promise === promise) resumeInFlight = null; }, 3000)).catch(() => {});
    }
    return resumeInFlight.promise;
};
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs';

const Screen = ({ icon: Icon, title, children, tone = 'muted' }) => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
        <div className={`${card} max-w-lg w-full p-8 text-center`}>
            <Icon className={`mx-auto mb-3 ${tone === 'ok' ? 'text-[#5d8c2c]' : 'text-slate-400'}`} size={42} />
            <h1 className="text-xl font-extrabold">{title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">{children}</p>
        </div>
    </div>
);

/**
 * Recruitment assessment: /assessment/join/:shareToken/assessment
 *
 * The sections themselves (aptitude, Monaco coding, voice interview, timers, drafts, proctoring) are the Student Platform's
 * shared AssessmentWorkspace. This page supplies only what is specific to accountless candidates:
 *   - the capability adapter (registration -> attempt -> session capability + in-memory lease),
 *   - the resume after a reload: the session identity in sessionStorage buys a new lease and the saved work back (POST .../resume),
 *   - the 15-second heartbeat that proves this tab is the live sitting (an older tab loses its lease: one window per attempt),
 *   - the interrupted / closed / submitted screens.
 * Nothing here starts a timer: the explicit Start Assessment click inside the workspace does, on the server.
 */
const RecruitmentAssessmentPage = () => {
    const { shareToken } = useParams();
    const navigate = useNavigate();
    const [phase, setPhase] = useState('loading');   // loading | ready | blocked | closed | redirect
    const [meta, setMeta] = useState(null);
    const [message, setMessage] = useState('');
    const [outcome, setOutcome] = useState(null);
    const [handle, setHandle] = useState(null);      // { uuid, token, lease } once the attempt exists
    const [resume, setResume] = useState(null);      // the server's /resume answer when this page load continues an attempt
    const apiRef = useRef(null);

    const block = useCallback((msg) => { clearLease(); setMessage(msg); setPhase('blocked'); }, []);
    const close = useCallback((state) => {
        clearLease(); clearSession(); clearAcknowledgement(shareToken);
        setOutcome(state || null);
        setMessage(state?.message || '');
        setPhase('closed');
    }, [shareToken]);

    // ---- boot: a reload does NOT end the sitting. The identity in sessionStorage asks the server to resume it (new lease, saved work,
    //      recorded events); the candidate then repeats the camera check and continues in the current section.
    useEffect(() => {
        let alive = true;
        const stored = loadSession();
        const hasRegistration = !!loadRegistration(shareToken);
        candidateApi.getMeta(shareToken)
            .then(async (data) => {
                if (!alive) return;
                setMeta(data);
                if (!hasRegistration && stored && (!stored.shareToken || stored.shareToken === shareToken)) {
                    try {
                        const res = await resumeOnce(stored);
                        if (!alive) return;
                        if (!res?.resumed) { close(res?.state); return; }          // already over: the server's message explains
                        setLease(res.session_lease);                                // the new lease lives in memory only
                        setHandle({ uuid: stored.uuid, token: stored.token, lease: res.session_lease });
                        setResume(res);
                        setPhase('ready');
                    } catch (err) {
                        if (alive) block(errorMessage(err, 'Your assessment could not be resumed in this window. Please contact the hiring team.'));
                    }
                    return;
                }
                if (!hasRegistration) { setPhase('redirect'); return; }
                if (!hasAcknowledged(shareToken)) { setPhase('redirect'); return; }
                setPhase('ready');
            })
            .catch((err) => {
                if (!alive) return;
                const status = err?.response?.status;
                block(status === 410 ? (typeof err?.response?.data?.detail === 'string' ? err.response.data.detail : 'This assessment is closed and is no longer accepting candidates.')
                    : status === 404 ? 'This assessment link is not valid. Please check the link you were given.'
                        : errorMessage(err, 'Unable to load this assessment right now.'));
            });
        return () => { alive = false; };
    }, [shareToken, block, close]);

    // One adapter for the whole sitting (it owns the in-memory attempt handle); created once the link's public metadata is known.
    const api = useMemo(() => (meta ? createRecruitmentAssessmentApi({
        shareToken, meta, onSession: (s) => setHandle({ ...s }),
        resume: resume && handle ? { handle: { uuid: handle.uuid, token: handle.token, lease: handle.lease }, state: resume.state } : null,
    }) : null), [meta, shareToken, resume]);   // eslint-disable-line react-hooks/exhaustive-deps
    apiRef.current = api;

    // ---- heartbeat: only the tab that holds the in-memory lease can send it; the server decides interruption from it
    useEffect(() => {
        if (!handle || phase !== 'ready') return undefined;
        const beat = () => {
            candidateApi.heartbeat(handle)
                .then((s) => { if (s?.terminal) close(s); })
                .catch((err) => {
                    const status = err?.response?.status;
                    if ([401, 403, 404, 409].includes(status)) block(errorMessage(err, 'Your sitting was interrupted.'));
                });   // a network blip is tolerated: the server's own heartbeat clock decides
        };
        const id = setInterval(beat, HEARTBEAT_MS);
        return () => clearInterval(id);
    }, [handle, phase, block, close]);

    // ---- unload guard: a reload is allowed (it resumes), but it is recorded and the timer keeps running
    useEffect(() => {
        if (!handle || phase !== 'ready') return undefined;
        const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = RELOAD_WARNING; return RELOAD_WARNING; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [handle, phase]);

    const onFinished = useCallback(() => {
        const last = apiRef.current?.getLastState?.();
        close(last && last.terminal ? last : { state: 'COMPLETED' });
    }, [close]);

    if (phase === 'redirect') {
        return <Navigate to={loadRegistration(shareToken) ? `/assessment/join/${shareToken}/instructions` : `/assessment/join/${shareToken}`} replace />;
    }
    if (phase === 'loading' || !api) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="animate-spin" size={18} /> Connecting to your assessment...
            </div>
        );
    }
    if (phase === 'blocked') {
        return <Screen icon={ShieldAlert} title="Assessment interrupted">{message}</Screen>;
    }
    if (phase === 'closed') {
        const done = ['COMPLETED', 'EVALUATION_PENDING'].includes(outcome?.state);
        const ended = outcome?.disqualified ? 'You have been disqualified' : outcome?.terminated ? 'Assessment ended' : 'Assessment closed';
        // A signed-in student continues to their own completion page; other candidates keep this screen.
        if (done && hasStudentAccess(shareToken)) return <Navigate to={`/assessment/join/${shareToken}/complete`} replace />;
        return (
            <Screen icon={done ? CheckCircle2 : Clock} title={done ? 'Assessment submitted' : ended} tone={done ? 'ok' : 'muted'}>
                {done
                    ? 'Thank you. Your responses have been received and will be reviewed by the hiring team. You may close this window.'
                    : (message || 'The assessment time limit has ended. Your saved work has been submitted for review.')}
            </Screen>
        );
    }

    return (
        <AssessmentWorkspace
            sessionUuid="recruitment"
            api={api}
            mode="recruitment"
            skipInstructions
            watermark={handle?.uuid ? `Session ${String(handle.uuid).slice(0, 8)}` : ''}
            proctoringPolicy="flag"
            onFinished={onFinished}
            onBackToInstructions={handle ? null : () => navigate(`/assessment/join/${shareToken}/instructions`)}
            resumeInfo={resume}
        />
    );
};

export default RecruitmentAssessmentPage;
