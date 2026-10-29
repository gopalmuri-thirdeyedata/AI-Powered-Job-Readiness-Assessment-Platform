import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, RotateCcw, Search, RefreshCw, Users } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import CandidateReportModal from './CandidateReportModal';
import RetestModal from './RetestModal';
import { EmptyState, ErrorBanner, LoadingRow, PanelIntro, StatusBadge, STATUS_META, cardCls, formatDate, formatScore, ghostBtn, ghostBtnSm, iconBtn, inputCls, primaryBtn, tableWrapCls, tbodyCls, tdCls, theadCls, thCls, trCls } from './adminUi';

const STATUS_OPTIONS = ['COMPLETED', 'INCOMPLETE', 'IN_PROGRESS', 'REGISTERED', 'TIMED_OUT', 'ABANDONED', 'EVALUATION_PENDING', 'INFRASTRUCTURE_FAILURE', 'MANUAL_REVIEW_REQUIRED'];
const PAGE_SIZE = 15;

/** Live, server-side searched / filtered / sorted / paginated roster of every registered candidate. */
const CandidateResultsTable = ({ refreshKey = 0, onChanged, onNavigate }) => {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [roleId, setRoleId] = useState('');
    const [status, setStatus] = useState('');
    const [sort, setSort] = useState('date');
    const [order, setOrder] = useState('desc');
    const [roles, setRoles] = useState([]);
    const [rolesLoaded, setRolesLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [openId, setOpenId] = useState(null);
    const [retestId, setRetestId] = useState(null);
    const reqRef = useRef(0);

    useEffect(() => {
        const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => { adminApi.listRoles().then((r) => { setRoles(r); setRolesLoaded(true); }).catch(() => {}); }, [refreshKey]);

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError('');
        try {
            const params = { page, page_size: PAGE_SIZE, sort, order };
            if (debounced) params.search = debounced;
            if (roleId) params.job_role_id = roleId;
            if (status) params.status = status;
            const res = await adminApi.listCandidates(params);
            if (id !== reqRef.current) return; // a newer request superseded this one
            setRows(res.items);
            setTotal(res.total);
            setPages(res.pages);
        } catch (err) {
            if (id === reqRef.current) setError(errorMessage(err, 'Unable to load candidates.'));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [page, debounced, roleId, status, sort, order]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const filtered = !!(debounced || roleId || status);
    const clearFilters = () => { setSearch(''); setDebounced(''); setRoleId(''); setStatus(''); setPage(1); };
    const hasLink = roles.some((r) => r.status === 'PUBLISHED' || r.status === 'CLOSED');
    const go = (tab, label) => onNavigate && <button type="button" className={primaryBtn} onClick={() => onNavigate(tab)}>{label}</button>;
    // Empty state mirrors the real backend state: no filters match / no jobs / no published link / waiting for registrations
    const empty = (() => {
        if (filtered) return { title: 'No candidates match these filters.', body: 'Adjust the search or filters to see more candidates.', action: <button type="button" className={ghostBtn} onClick={clearFilters}>Clear filters</button> };
        if (!rolesLoaded) return { title: 'No candidates have registered yet.', body: 'Candidates appear here as soon as they register through a shared assessment link.' };
        if (roles.length === 0) return { title: 'No job roles yet', body: 'Create a job role and publish its assessment to start receiving candidates.', action: go('roles', 'Create a job role') };
        if (!hasLink) return { title: 'No published assessment yet', body: 'Publish a job role that has a valid blueprint to get a shared link for candidates.', action: go('roles', 'Go to Job Roles & Blueprints') };
        return { title: 'No candidates have registered yet.', body: 'Share the published assessment link with candidates. They appear here as soon as they register.', action: go('links', 'Open Shared Links') };
    })();

    // Incomplete assessments never get a number: INCOMPLETE for the terminal-but-unfinished states, an em dash otherwise.
    const overall = (r) => (r.overall_score === null
        ? <span className="text-xs font-semibold text-slate-400 dark:text-slate-500" title="Incomplete assessments never receive a fabricated overall score">{['TIMED_OUT', 'ABANDONED', 'INFRASTRUCTURE_FAILURE', 'MANUAL_REVIEW_REQUIRED', 'EVALUATION_PENDING'].includes(r.status) ? 'INCOMPLETE' : '—'}</span>
        : <span className="inline-flex min-w-[3.5rem] justify-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[13px] text-slate-900 dark:text-white">{formatScore(r.overall_score)}</span>);
    const reviewTag = (r) => r.needs_review && <span className="text-[10px] font-semibold tracking-wide text-orange-600 dark:text-orange-400">REVIEW</span>;
    const dossierBtn = (r) => <button type="button" className={ghostBtnSm} onClick={() => setOpenId(r.id)} aria-label={`Open dossier for ${r.name}`}><Eye size={14} /> Dossier</button>;
    const retestBtn = (r) => <button type="button" className={ghostBtnSm} onClick={() => setRetestId(r.id)} aria-label={`Assign retest for ${r.name}`}><RotateCcw size={14} /> Retest</button>;
    const actions = (r) => <div className="inline-flex items-center justify-end gap-2">{dossierBtn(r)}{retestBtn(r)}</div>;
    const scoreCls = 'tabular-nums text-slate-600 dark:text-slate-300';
    const selectCls = `${inputCls} w-full lg:!w-auto lg:max-w-[14rem]`;

    return (
        <section aria-label="Candidate results" className="space-y-5">
            <PanelIntro>Search, filter and review every candidate who registered through a shared link: status, section scores, dossiers and reports.</PanelIntro>
            <div className={`${cardCls} p-3 sm:p-4`}>
                <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
                    <div className="relative sm:col-span-2 lg:col-span-1 lg:flex-1 lg:min-w-[16rem]">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" aria-hidden="true" />
                        <input className={`${inputCls} pl-9`} placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" />
                    </div>
                    <select className={selectCls} value={roleId} onChange={(e) => { setRoleId(e.target.value); setPage(1); }} aria-label="Filter by job role">
                        <option value="">All job roles</option>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                    </select>
                    <select className={selectCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
                        <option value="">All statuses</option>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'INCOMPLETE' ? 'Incomplete (any)' : STATUS_META[s]?.label || s}</option>)}
                    </select>
                    <select className={selectCls} value={`${sort}:${order}`} onChange={(e) => { const [so, o] = e.target.value.split(':'); setSort(so); setOrder(o); setPage(1); }} aria-label="Sort candidates">
                        <option value="date:desc">Newest first</option>
                        <option value="date:asc">Oldest first</option>
                        <option value="score:desc">Highest score</option>
                        <option value="score:asc">Lowest score</option>
                        <option value="name:asc">Name A–Z</option>
                    </select>
                    <button type="button" className={`${ghostBtn} w-full sm:w-auto`} onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
                </div>
            </div>

            {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
            {loading && rows.length === 0 && !error && <div className={cardCls}><LoadingRow>Loading candidates...</LoadingRow></div>}
            {!loading && !error && rows.length === 0 && <EmptyState icon={Users} title={empty.title} action={empty.action}>{empty.body}</EmptyState>}

            {rows.length > 0 && (
            <>
            {/* Wide screens: structured table. Narrower screens: one card per candidate (no sideways scrolling). */}
            <div className={`${tableWrapCls} hidden xl:block ${loading ? 'opacity-70' : ''} transition-opacity`} aria-busy={loading}>
                <div className="pw-scroll-x">
                    <table className="w-full text-sm min-w-[56rem]">
                        <caption className="sr-only">Registered candidates</caption>
                        <thead className={theadCls}>
                            <tr>
                                <th scope="col" className={`${thCls} !px-3`}>Candidate</th><th scope="col" className={`${thCls} !px-3`}>Role</th><th scope="col" className={`${thCls} !px-3`}>Status</th>
                                <th scope="col" className={`${thCls} !px-3 text-right`}>Aptitude</th><th scope="col" className={`${thCls} !px-3 text-right`}>Coding</th><th scope="col" className={`${thCls} !px-3 text-right`}>Interview</th>
                                <th scope="col" className={`${thCls} !px-3 text-right`}>Overall</th><th scope="col" className={`${thCls} !px-3`}>Registered</th><th scope="col" className={`${thCls} !px-3 sticky right-0 z-[1] bg-slate-50 dark:bg-slate-950`}><span className="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody className={tbodyCls}>
                            {rows.map((r) => (
                                <tr key={r.id} className={`group ${trCls}`}>
                                    <td className={`${tdCls} !px-3 max-w-[14rem]`}><p className="font-semibold tracking-tight text-slate-900 dark:text-white truncate" title={r.name}>{r.name}</p><p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400 truncate" title={r.email}>{r.email}</p><p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400">{r.phone}</p></td>
                                    <td className={`${tdCls} !px-3 text-slate-700 dark:text-slate-300 max-w-[10rem]`}><span className="line-clamp-2" title={r.job_role_title}>{r.job_role_title}</span></td>
                                    <td className={`${tdCls} !px-3`}><div className="flex flex-col items-start gap-1"><StatusBadge status={r.status} />{reviewTag(r)}</div></td>
                                    <td className={`${tdCls} !px-3 text-right ${scoreCls}`}>{formatScore(r.aptitude_score)}</td>
                                    <td className={`${tdCls} !px-3 text-right ${scoreCls}`}>{formatScore(r.coding_score)}</td>
                                    <td className={`${tdCls} !px-3 text-right ${scoreCls}`}>{formatScore(r.interview_score)}</td>
                                    <td className={`${tdCls} !px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white`}>{overall(r)}</td>
                                    <td className={`${tdCls} !px-3 text-[13px] leading-5 text-slate-500 dark:text-slate-400 max-w-[7rem]`}>{formatDate(r.registered_at)}</td>
                                    <td className={`${tdCls} !px-3 text-right sticky right-0 z-[1] bg-white dark:bg-[var(--pw-surface)] group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors`}>{actions(r)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <ul className={`xl:hidden grid gap-3 grid-cols-[minmax(0,1fr)] min-[1000px]:grid-cols-[repeat(2,minmax(0,1fr))] ${loading ? 'opacity-70' : ''} transition-opacity`} aria-label="Registered candidates" aria-busy={loading}>
                {rows.map((r) => (
                    <li key={r.id} className={`${cardCls} p-4 space-y-3`}>
                        <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white break-words">{r.name}</p>
                            <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400 break-all">{r.email}</p>
                            <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400">{r.phone}</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                            <p className="text-[13px] text-slate-600 dark:text-slate-300 break-words min-w-0">{r.job_role_title}</p>
                            <div className="flex items-center gap-2">{reviewTag(r)}<StatusBadge status={r.status} /></div>
                        </div>
                        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800 p-3 text-center">
                            {[['Aptitude', formatScore(r.aptitude_score)], ['Coding', formatScore(r.coding_score)], ['Interview', formatScore(r.interview_score)]].map(([label, value]) => (
                                <div key={label}><dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</dt><dd className={`text-[13px] font-medium mt-0.5 ${scoreCls}`}>{value}</dd></div>
                            ))}
                            <div><dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Overall</dt><dd className="text-[13px] font-semibold mt-0.5 tabular-nums text-slate-900 dark:text-white">{overall(r)}</dd></div>
                        </dl>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(r.registered_at)}</span>
                            {actions(r)}
                        </div>
                    </li>
                ))}
            </ul>
            </>
            )}

            {total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
                <span>{total} candidate{total === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                    <button type="button" className={iconBtn} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
                    <span className="font-medium tabular-nums px-1">Page {page} of {pages}</span>
                    <button type="button" className={iconBtn} disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
                </div>
            </div>}

            {retestId !== null && (
                <RetestModal candidateId={retestId} onClose={() => setRetestId(null)} onAssigned={() => { load(); if (onChanged) onChanged(); }} />
            )}

            {openId !== null && (
                <CandidateReportModal candidateId={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); if (onChanged) onChanged(); }} />
            )}
        </section>
    );
};

export default CandidateResultsTable;
