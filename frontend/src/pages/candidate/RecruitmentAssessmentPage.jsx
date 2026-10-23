import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, ShieldAlert } from 'lucide-react';
import { AssessmentWorkspace } from '../roleready/RoleReadyAssessment';
import { candidateApi, errorMessage } from '../../services/recruitmentApi';
import { createRecruitmentAssessmentApi } from '../../services/assessmentApi';
import {
    clearAcknowledgement, clearLease, clearSession, getLease, hasAcknowledged, loadRegistration, loadSession,
} from '../../services/assessmentSession';

const HEARTBEAT_MS = 15000;
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
 * The sections themselves (aptitude, Monaco coding, Vapi voice interview, timers, drafts, proctoring) are the Student Platform's
 * shared AssessmentWorkspace. This page supplies only what is specific to accountless candidates:
 *   - the capability adapter (registration -> attempt -> session capability + in-memory lease),
 *   - the 15-second heartbeat that proves this tab is the live sitting (the no-resume rule is enforced by the SERVER),
 *   - the interrupted / closed / submitted screens.
 * Nothing here starts a timer: the explicit Start Assessment click inside the workspace does, on the server.
 */
const RecruitmentAssessmentPage = () => {
    const { shareToken } = useParams();
    const [phase, setPhase] = useState('loading');   // loading | ready | blocked | closed | redirect
    const [meta, setMeta] = useState(null);
    const [message, setMessage] = useState('');
    const [outcome, setOutcome] = useState(null);
    const [handle, setHandle] = useState(null);      // { uuid, token, lease } once the attempt exists
    const apiRef = useRef(null);

    const block = useCallback((msg) => { clearLease(); setMessage(msg); setPhase('blocked'); }, []);
    const close = useCallback((state) => {
        clearLease(); clearSession(); clearAcknowledgement(shareToken);
        setOutcome(state || null);
        setMessage(state?.message || '');
        setPhase('closed');
    }, [shareToken]);

    // ---- boot: a reload after the attempt began can never resume it; ask the server so it records and reports the truth
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
                        const state = await candidateApi.state({ uuid: stored.uuid, token: stored.token, lease: getLease() });
                        if (!alive) return;
                        if (state?.terminal) close(state);
                        else block('Your assessment sitting is not active in this window. An attempt cannot be resumed after a reload.');
                    } catch (err) {
                        if (alive) block(errorMessage(err, 'Your assessment sitting is not active in this window. An attempt cannot be resumed after a reload.'));
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
                block(status === 410 ? 'This assessment is closed and is no longer accepting candidates.'
                    : status === 404 ? 'This assessment link is not valid. Please check the link you were given.'
                        : errorMessage(err, 'Unable to load this assessment right now.'));
            });
        return () => { alive = false; };
    }, [shareToken, block, close]);

    // One adapter for the whole sitting (it owns the in-memory attempt handle); created once the link's public metadata is known.
    const api = useMemo(() => (meta ? createRecruitmentAssessmentApi({
        shareToken, meta, onSession: (s) => setHandle({ ...s }),
    }) : null), [meta, shareToken]);
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

    // ---- no-resume guard: warn before the tab is closed or reloaded (the server enforces the rule regardless)
    useEffect(() => {
        if (!handle || phase !== 'ready') return undefined;
        const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
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
        return (
            <Screen icon={done ? CheckCircle2 : Clock} title={done ? 'Assessment submitted' : 'Assessment closed'} tone={done ? 'ok' : 'muted'}>
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
            proctoringPolicy="flag"
            onFinished={onFinished}
        />
    );
};

export default RecruitmentAssessmentPage;
