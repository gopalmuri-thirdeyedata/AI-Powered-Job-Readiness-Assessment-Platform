import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, Users, PlayCircle, CheckCircle2, AlertTriangle, BarChart3, ShieldAlert, ArrowRight } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { ErrorBanner, PanelIntro, cardCls, primaryBtn } from './adminUi';
import SharedLinkField from './SharedLinkField';

/**
 * The one recommended next step, derived only from real backend state (job roles + overview stats):
 *  no jobs -> no blueprint -> unpublished blueprint -> published (share the link) -> registrations (review results).
 */
export const nextAction = (roles, stats) => {
    const published = roles.filter((r) => r.status === 'PUBLISHED');
    if ((stats?.total_registrations || 0) > 0) {
        return { key: 'review', title: 'Review candidate results', body: `${stats.total_registrations} candidate${stats.total_registrations === 1 ? ' has' : 's have'} registered. Open their scores, dossiers and reports.`, cta: { label: 'Open Candidate Results', tab: 'results' } };
    }
    if (published.length > 0) {
        return { key: 'share', title: 'Share your assessment link', body: 'Your job is published. Copy the link below and send it to candidates. No candidate has registered yet.', cta: { label: 'Manage shared links', tab: 'links' }, published };
    }
    if (roles.length === 0) {
        return { key: 'create', title: 'Create your first job role', body: 'Add a job title and description. PrepWin generates the aptitude, coding and interview assessment from it.', cta: { label: 'Create a job role', tab: 'roles' } };
    }
    const ready = roles.find((r) => r.status !== 'PUBLISHED' && r.blueprint?.valid);
    if (ready) {
        return { key: 'publish', title: `Publish “${ready.title}”`, body: 'Its assessment blueprint is ready. Review it, then publish to get the shared link.', cta: { label: 'Review and publish', tab: 'roles' } };
    }
    const pending = roles[0];
    return { key: 'blueprint', title: `Generate the blueprint for “${pending.title}”`, body: 'This job role has no valid assessment blueprint yet. Generate it from the job description.', cta: { label: 'Generate blueprint', tab: 'roles' } };
};

const OverviewKpis = ({ refreshKey = 0, onNavigate }) => {
    const [stats, setStats] = useState(null);
    const [roles, setRoles] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [s, r] = await Promise.all([adminApi.overview(), adminApi.listRoles()]);
            setStats(s);
            setRoles(Array.isArray(r) ? r : []);
        } catch (err) {
            setError(errorMessage(err, 'Unable to load the overview.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);

    const tiles = stats ? [
        { label: 'Active Jobs', value: stats.active_jobs, icon: Briefcase },
        { label: 'Registrations', value: stats.total_registrations, icon: Users },
        { label: 'In Progress', value: stats.in_progress, icon: PlayCircle },
        { label: 'Completed', value: stats.completed, icon: CheckCircle2 },
        { label: 'Incomplete', value: stats.incomplete, icon: AlertTriangle },
        { label: 'Needs Review', value: stats.pending_review, icon: ShieldAlert },
        { label: 'Average Score', value: stats.average_score === null ? '—' : `${stats.average_score}%`, icon: BarChart3 },
    ] : [];

    const action = stats && roles ? nextAction(roles, stats) : null;

    return (
        <section aria-label="Recruitment overview" className="space-y-5">
            <PanelIntro onRefresh={load} loading={loading}>Recruitment Overview — live totals for your organization&apos;s shared-link assessments.</PanelIntro>
            {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}

            {action && (
                <div className={`${cardCls} p-5 border-l-4 border-l-[#5d8c2c] dark:border-l-emerald-500`} aria-label="Next step">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#5d8c2c] dark:text-emerald-400">Next step</p>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1">
                        <div className="min-w-0">
                            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{action.title}</h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{action.body}</p>
                        </div>
                        {onNavigate && (
                            <button type="button" className={`${primaryBtn} shrink-0`} onClick={() => onNavigate(action.cta.tab)}>{action.cta.label} <ArrowRight size={14} /></button>
                        )}
                    </div>
                    {action.published && (
                        <div className="mt-4 space-y-3">
                            {action.published.slice(0, 3).map((role) => (
                                <div key={role.id}>
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">{role.title}</p>
                                    <SharedLinkField role={role} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                {tiles.map(({ label, value, icon: Icon }) => (
                    <div key={label} className={`${cardCls} p-4`}>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                        <div className="flex items-end justify-between gap-2 mt-1.5">
                            <p className="text-2xl font-extrabold text-slate-900 dark:text-white leading-none">{value}</p>
                            <Icon size={16} className="text-[#5d8c2c] dark:text-emerald-400 shrink-0" aria-hidden="true" />
                        </div>
                    </div>
                ))}
                {!stats && !error && Array.from({ length: 7 }).map((_, i) => <div key={i} className={`${cardCls} p-4 h-[84px] animate-pulse bg-slate-100/60 dark:bg-slate-800/40`} />)}
            </div>
        </section>
    );
};

export default OverviewKpis;
