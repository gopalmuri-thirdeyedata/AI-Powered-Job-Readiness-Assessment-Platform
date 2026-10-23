import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Search, RefreshCw, Users } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import CandidateReportModal from './CandidateReportModal';
import { EmptyState, ErrorBanner, LoadingRow, PanelIntro, StatusBadge, STATUS_META, cardCls, formatDate, formatScore, ghostBtn, inputCls, primaryBtn } from './adminUi';

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

    return (
        <section aria-label="Candidate results" className="space-y-4">
            <PanelIntro>Search, filter and review every candidate who registered through a shared link: status, section scores, dossiers and reports.</PanelIntro>
            <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[14rem]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input className={`${inputCls} pl-9`} placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" />
                </div>
                <select className={`${inputCls} !w-auto max-w-[14rem]`} value={roleId} onChange={(e) => { setRoleId(e.target.value); setPage(1); }} aria-label="Filter by job role">
                    <option value="">All job roles</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
                <select className={`${inputCls} !w-auto`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'INCOMPLETE' ? 'Incomplete (any)' : STATUS_META[s]?.label || s}</option>)}
                </select>
                <select className={`${inputCls} !w-auto`} value={`${sort}:${order}`} onChange={(e) => { const [so, o] = e.target.value.split(':'); setSort(so); setOrder(o); setPage(1); }} aria-label="Sort candidates">
                    <option value="date:desc">Newest first</option>
                    <option value="date:asc">Oldest first</option>
                    <option value="score:desc">Highest score</option>
                    <option value="score:asc">Lowest score</option>
                    <option value="name:asc">Name A–Z</option>
                </select>
                <button type="button" className={ghostBtn} onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
            </div>

            {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
            {loading && rows.length === 0 && !error && <LoadingRow>Loading candidates...</LoadingRow>}
            {!loading && !error && rows.length === 0 && <EmptyState icon={Users} title={empty.title} action={empty.action}>{empty.body}</EmptyState>}

            {rows.length > 0 && (
            <div className={`${cardCls} overflow-x-auto`}>
                <table className="w-full text-sm min-w-[56rem]">
                    <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
                            <th className="px-4 py-3">Candidate</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Status</th>
                            <th className="px-3 py-3 text-right">Aptitude</th><th className="px-3 py-3 text-right">Coding</th><th className="px-3 py-3 text-right">Interview</th>
                            <th className="px-3 py-3 text-right">Overall</th><th className="px-3 py-3">Registered</th><th className="px-3 py-3" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rows.map((r) => (
                            <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                <td className="px-4 py-3"><p className="font-bold text-slate-900 dark:text-white">{r.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{r.email}</p><p className="text-xs text-slate-500 dark:text-slate-400">{r.phone}</p></td>
                                <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{r.job_role_title}</td>
                                <td className="px-3 py-3"><StatusBadge status={r.status} />{r.needs_review && <span className="ml-1 text-[10px] font-bold text-orange-600 dark:text-orange-400">REVIEW</span>}</td>
                                <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">{formatScore(r.aptitude_score)}</td>
                                <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">{formatScore(r.coding_score)}</td>
                                <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">{formatScore(r.interview_score)}</td>
                                <td className="px-3 py-3 text-right tabular-nums font-extrabold text-slate-900 dark:text-white">{r.overall_score === null ? <span className="text-xs font-bold text-slate-400 dark:text-slate-500" title="Incomplete assessments never receive a fabricated overall score">{['TIMED_OUT', 'ABANDONED', 'INFRASTRUCTURE_FAILURE', 'MANUAL_REVIEW_REQUIRED', 'EVALUATION_PENDING'].includes(r.status) ? 'INCOMPLETE' : '—'}</span> : formatScore(r.overall_score)}</td>
                                <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(r.registered_at)}</td>
                                <td className="px-3 py-3 text-right"><button type="button" className={ghostBtn} onClick={() => setOpenId(r.id)}><Eye size={14} /> Dossier</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            )}

            {total > 0 && <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                <span>{total} candidate{total === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                    <button type="button" className={ghostBtn} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
                    <span className="font-semibold">Page {page} of {pages}</span>
                    <button type="button" className={ghostBtn} disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
                </div>
            </div>}

            {openId !== null && (
                <CandidateReportModal candidateId={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); if (onChanged) onChanged(); }} />
            )}
        </section>
    );
};

export default CandidateResultsTable;
