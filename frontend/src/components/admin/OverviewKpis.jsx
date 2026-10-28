import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, Users, PlayCircle, CheckCircle2, AlertTriangle, BarChart3, ShieldAlert, ArrowRight, ChevronRight } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { ErrorBanner, PanelIntro, StatusBadge, cardCls, iconBtn, primaryBtn } from './adminUi';
import SharedLinkField from './SharedLinkField';
import { isLinkExpired, isLinkLive } from './shareLinks';

/**
 * The one recommended next step, derived only from real backend state (job roles + overview stats):
 *  no jobs -> no blueprint -> unpublished blueprint -> published (share the link) -> registrations (review results).
 */
export const nextAction = (roles, stats) => {
    const published = roles.filter(isLinkLive);
    if ((stats?.total_registrations || 0) > 0) {
        return { key: 'review', title: 'Review candidate results', body: `${stats.total_registrations} candidate${stats.total_registrations === 1 ? ' has' : 's have'} registered. Open their scores, dossiers and reports.`, cta: { label: 'Open Candidate Results', tab: 'results' } };
    }
    if (published.length > 0) {
        return { key: 'share', title: 'Share your assessment link', body: 'Your job is published. Copy the link below and send it to candidates. No candidate has registered yet.', cta: { label: 'Manage shared links', tab: 'links' }, published };
    }
    const expired = roles.find(isLinkExpired);
    if (expired) {
        return { key: 'renew', title: `The link for “${expired.title}” has expired`, body: 'Shared links are valid for 24 hours. Create a new link to keep accepting candidates; existing candidates and results are kept.', cta: { label: 'Create a new link', tab: 'roles' } };
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

// Icon-chip colours per tile: brand = healthy / done, info = in flight, warning / orange = needs attention, violet = score.
const TILE_TONE = {
    brand: 'bg-[#5d8c2c]/10 text-[#4c7324] border-[#5d8c2c]/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50',
    info: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60',
    warning: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60',
    orange: 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/60',
    violet: 'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/60',
};

// The seven tiles share one surface (hairlines between them, no per-tile shadows). Spans keep every row full at each width:
// 2 columns on phones (the last tile spans both), 4 + 3 filling the width up to 2xl, then a single row of seven.
const tileSpan = (i) => (i < 4 ? 'lg:col-span-3 2xl:col-span-1' : i === 6 ? 'col-span-2 lg:col-span-4 2xl:col-span-1' : 'lg:col-span-4 2xl:col-span-1');
const tileCell = 'bg-white dark:bg-[var(--pw-surface)] p-4 min-h-[104px] flex flex-col justify-between gap-4';

// Pipeline bars: each status is compared with total registrations on its own track (counts come from independent status
// definitions on the server, so the bars are deliberately not stacked or chained into a funnel).
const PIPELINE_BAR = {
    slate: 'bg-slate-400 dark:bg-slate-500',
    info: 'bg-blue-500 dark:bg-blue-400',
    brand: 'bg-[#5d8c2c] dark:bg-emerald-500',
    orange: 'bg-orange-500 dark:bg-orange-400',
};

const share = (count, total) => (total > 0 ? Math.max(0, Math.min(100, (count / total) * 100)) : 0);

const PipelineStage = ({ label, count, total, bar, showTotal = true }) => (
    <div>
        <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">{label}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {count}{showTotal && total > 0 && <span className="font-normal text-slate-400 dark:text-slate-500"> / {total}</span>}
            </p>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(count, total)}>
            <div className={`h-full rounded-full ${PIPELINE_BAR[bar]} transition-[width] duration-500`} style={{ width: `${share(count, total)}%` }} />
        </div>
    </div>
);

const Panel = ({ title, meta, onOpen, openLabel, children }) => (
    <section className={`${cardCls} overflow-hidden`} aria-label={title}>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="pw-card-title truncate">{title}</h3>
                {meta && <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{meta}</span>}
            </div>
            {onOpen && <button type="button" onClick={onOpen} aria-label={openLabel} className={`${iconBtn} shrink-0`}><ChevronRight size={15} aria-hidden="true" /></button>}
        </div>
        {children}
    </section>
);

const ROLE_ROWS = 4;
const shortDate = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'; };

const OverviewKpis = ({ refreshKey = 0, onNavigate }) => {
    const [stats, setStats] = useState(null);
    const [roles, setRoles] = useState(null);
    const [recent, setRecent] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [s, r] = await Promise.all([adminApi.overview(), adminApi.listRoles()]);
            setStats(s);
            setRoles(Array.isArray(r) ? r : []);
            // The five newest registrations (same endpoint and sort as Candidate Results); an optional extra, never an error.
            if ((s?.total_registrations || 0) > 0) {
                try { setRecent((await adminApi.listCandidates({ page: 1, page_size: 5, sort: 'date', order: 'desc' }))?.items || []); } catch { setRecent([]); }
            } else {
                setRecent([]);
            }
        } catch (err) {
            setError(errorMessage(err, 'Unable to load the overview.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);

    const tiles = stats ? [
        { label: 'Active Jobs', value: stats.active_jobs, icon: Briefcase, tone: 'brand' },
        { label: 'Registrations', value: stats.total_registrations, icon: Users, tone: 'info' },
        { label: 'In Progress', value: stats.in_progress, icon: PlayCircle, tone: 'info' },
        { label: 'Completed', value: stats.completed, icon: CheckCircle2, tone: 'brand' },
        { label: 'Incomplete', value: stats.incomplete, icon: AlertTriangle, tone: 'warning' },
        { label: 'Needs Review', value: stats.pending_review, icon: ShieldAlert, tone: 'orange', alert: stats.pending_review > 0 },
        // Server average of the overall % over COMPLETED assessments only (incomplete ones never enter it)
        { label: 'Average Score', value: stats.average_score === null ? '—' : `${stats.average_score}%`, icon: BarChart3, tone: 'violet', hint: 'completed only', title: 'Average overall score of completed assessments. Incomplete assessments are not included.' },
    ] : [];

    const action = stats && roles ? nextAction(roles, stats) : null;
    const total = stats?.total_registrations || 0;
    // What is happening right now, for the recommended-action panel (the same counts as the tiles)
    const note = action?.key === 'review'
        ? (stats.pending_review > 0
            ? { text: `${stats.pending_review} need${stats.pending_review === 1 ? 's' : ''} review`, cls: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900' }
            : stats.in_progress > 0 ? { text: `${stats.in_progress} in progress`, cls: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900' } : null)
        : null;

    const sortedRoles = roles ? [...roles].sort((a, b) => Number(isLinkLive(b)) - Number(isLinkLive(a))) : [];
    const shownRoles = sortedRoles.slice(0, ROLE_ROWS);
    // Live / closed links are managed in Shared Links; everything else (draft, expired) in Job Roles & Blueprints
    const roleTarget = (role) => ((role.status === 'PUBLISHED' || role.status === 'CLOSED') && !isLinkExpired(role) ? 'links' : 'roles');

    return (
        <section aria-label="Recruitment overview" className="space-y-5">
            <PanelIntro onRefresh={load} loading={loading}>Recruitment Overview — live totals for your organization&apos;s shared-link assessments.</PanelIntro>
            {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}

            {action && (
                <div className={`${cardCls} p-5 border-l-4 border-l-[#5d8c2c] dark:border-l-emerald-500 bg-gradient-to-br from-[#5d8c2c]/[0.05] via-transparent to-transparent dark:from-emerald-500/[0.06]`} aria-label="Next step">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#4c7324] dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-[#5d8c2c] dark:bg-emerald-400" aria-hidden="true" />Next step</p>
                            <h3 className="mt-1.5 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-slate-900 dark:text-white">{action.title}</h3>
                            <p className="text-sm leading-6 text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">{action.body}</p>
                            {note && <span className={`mt-2.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${note.cls}`}>{note.text}</span>}
                        </div>
                        {onNavigate && (
                            <button type="button" className={`${primaryBtn} shrink-0 self-start lg:self-center`} onClick={() => onNavigate(action.cta.tab)}>{action.cta.label} <ArrowRight size={14} aria-hidden="true" /></button>
                        )}
                    </div>
                    {action.published && (
                        <div className="mt-4 pt-4 border-t border-slate-200/70 dark:border-slate-800 space-y-3">
                            {action.published.slice(0, 3).map((role) => (
                                <div key={role.id}>
                                    <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{role.title}</p>
                                    <SharedLinkField role={role} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Metrics + pipeline: one surface, so the numbers read as a single summary rather than seven separate cards */}
            <div className={`${cardCls} overflow-hidden`}>
                <div className="grid grid-cols-2 lg:grid-cols-12 2xl:grid-cols-7 gap-px bg-slate-200/70 dark:bg-slate-800">
                    {tiles.map(({ label, value, icon: Icon, tone, alert, hint, title }, i) => (
                        <div key={label} className={`${tileCell} ${tileSpan(i)}`} title={title}>
                            <div className="flex items-start justify-between gap-2">
                                <p className="text-[13px] font-medium leading-[18px] text-slate-500 dark:text-slate-400 pt-1">{label}</p>
                                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${TILE_TONE[tone]}`}><Icon size={16} aria-hidden="true" /></span>
                            </div>
                            <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
                                <p className={`text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${alert ? 'text-orange-600 dark:text-orange-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
                                {hint && <span className="pb-0.5 text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
                            </div>
                        </div>
                    ))}
                    {!stats && !error && Array.from({ length: 7 }).map((_, i) => <div key={i} className={`${tileCell} ${tileSpan(i)} animate-pulse`} aria-hidden="true"><div className="h-4 w-20 rounded bg-slate-100 dark:bg-slate-800" /><div className="h-7 w-12 rounded bg-slate-100 dark:bg-slate-800" /></div>)}
                </div>
                {stats && (
                    <div className="px-5 py-4 border-t border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30" aria-label="Recruitment pipeline">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Recruitment Pipeline</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">Each bar compares one status with total registrations.</p>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                            <PipelineStage label="Registered" count={total} total={total} bar="slate" showTotal={false} />
                            <PipelineStage label="In Progress" count={stats.in_progress} total={total} bar="info" />
                            <PipelineStage label="Completed" count={stats.completed} total={total} bar="brand" />
                            <PipelineStage label="Needs Review" count={stats.pending_review} total={total} bar="orange" />
                        </div>
                    </div>
                )}
            </div>

            {roles && (shownRoles.length > 0 || recent.length > 0) && (
                <div className={`grid gap-5 ${recent.length > 0 && shownRoles.length > 0 ? 'xl:grid-cols-5' : ''}`}>
                    {shownRoles.length > 0 && (
                        <div className={recent.length > 0 ? 'xl:col-span-3' : ''}>
                            <Panel title="Job Roles & Blueprints" meta={roles.length > ROLE_ROWS ? `${ROLE_ROWS} of ${roles.length}` : `${roles.length}`}
                                onOpen={onNavigate && (() => onNavigate('roles'))} openLabel="Open Job Roles & Blueprints">
                                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {shownRoles.map((role) => {
                                        const body = (
                                            <>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{role.title}</span>
                                                    <span className="block text-[13px] leading-5 text-slate-500 dark:text-slate-400 truncate">
                                                        {typeof role.registration_count === 'number' ? `${role.registration_count} registered · ` : ''}{role.blueprint?.valid ? `Blueprint v${role.blueprint.version}` : 'No valid blueprint yet'}
                                                    </span>
                                                </span>
                                                <StatusBadge status={isLinkExpired(role) ? 'EXPIRED' : role.status} />
                                                {onNavigate && <ChevronRight size={15} className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 transition-colors" aria-hidden="true" />}
                                            </>
                                        );
                                        return (
                                            <li key={role.id}>
                                                {onNavigate
                                                    ? <button type="button" onClick={() => onNavigate(roleTarget(role))} className="group w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer">{body}</button>
                                                    : <div className="flex items-center gap-3 px-5 py-3">{body}</div>}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </Panel>
                        </div>
                    )}
                    {recent.length > 0 && (
                        <div className={shownRoles.length > 0 ? 'xl:col-span-2' : ''}>
                            <Panel title="Candidate Results" meta="latest" onOpen={onNavigate && (() => onNavigate('results'))} openLabel="Open Candidate Results">
                                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {recent.slice(0, ROLE_ROWS).map((c) => (
                                        <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{c.name}</span>
                                                <span className="block text-[13px] leading-5 text-slate-500 dark:text-slate-400 truncate">{c.job_role_title} · {shortDate(c.registered_at)}</span>
                                            </span>
                                            <StatusBadge status={c.status} />
                                        </li>
                                    ))}
                                </ul>
                            </Panel>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};

export default OverviewKpis;
