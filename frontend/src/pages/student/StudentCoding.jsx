import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, CircleDashed, Circle, Code2, Flame, Search, Shuffle, RefreshCw, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import codingApi from '../../services/codingApi';
import ActivityHeatmap from '../../components/coding/ActivityHeatmap';
import { PageHero, EmptyState, AnimatedBar } from '../../components/student-ui/StudentMotion';
import { DIFFICULTY_CLASSES, errorMessage, statusLabel } from '../../utils/codingPlatform';

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const STATUSES = [
    { key: '', label: 'All' },
    { key: 'todo', label: 'Todo' },
    { key: 'attempted', label: 'Attempted' },
    { key: 'solved', label: 'Solved' },
];
const BAR_TONE = { Easy: 'emerald', Medium: 'amber', Hard: 'rose' };

const StatusIcon = ({ status }) => {
    if (status === 'solved') return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" aria-label={statusLabel.solved} />;
    if (status === 'attempted') return <CircleDashed className="w-5 h-5 text-amber-500 shrink-0" aria-label={statusLabel.attempted} />;
    return <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" aria-label={statusLabel.todo} />;
};

const Chip = ({ active, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
            active
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
        }`}
    >
        {children}
    </button>
);

const StudentCoding = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [status, setStatus] = useState('');
    const [tag, setTag] = useState('');
    const [bookmarkedOnly, setBookmarkedOnly] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(query.trim()), 250);
        return () => clearTimeout(t);
    }, [query]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        codingApi.getProblems({ difficulty, tag, status, q: debounced, bookmarked: bookmarkedOnly })
            .then((res) => { if (!cancelled) { setData(res); setError(''); } })
            .catch((err) => { if (!cancelled) setError(errorMessage(err, 'Could not load the problems.')); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [difficulty, tag, status, debounced, bookmarkedOnly]);

    const problems = data?.problems || [];
    const stats = data?.stats;
    const pickForMe = useMemo(() => {
        const open = problems.filter((p) => p.status !== 'solved');
        const pool = open.length ? open : problems;
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }, [problems]);
    const nextUp = problems.find((p) => p.status !== 'solved');

    // Optimistic: flip the star at once, undo it if the server refuses
    const toggleBookmark = async (slug) => {
        const flip = (on) => setData((d) => d && ({
            ...d,
            bookmarks: Math.max(0, (d.bookmarks || 0) + (on ? 1 : -1)),
            problems: d.problems.map((p) => (p.slug === slug ? { ...p, bookmarked: on } : p)).filter((p) => !bookmarkedOnly || p.bookmarked),
        }));
        const current = problems.find((p) => p.slug === slug)?.bookmarked;
        flip(!current);
        try { await codingApi.bookmark(slug); } catch { flip(!!current); setError('Could not update the bookmark. Please try again.'); }
    };

    return (
        <div className="space-y-5 sm:space-y-6 max-w-7xl mx-auto min-w-0">
            <PageHero
                icon={Code2}
                eyebrow="Coding"
                title="Python Problem Set"
                subtitle="Solve problems in a real editor, run your own test cases, and submit against hidden tests. Python only."
                actions={nextUp ? (
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                        <Link to={`/student/coding/${nextUp.slug}`} className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">
                            {stats?.solved ? 'Continue' : 'Start solving'}
                        </Link>
                        {pickForMe && (
                            <Link to={`/student/coding/${pickForMe.slug}`} className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                <Shuffle className="w-4 h-4" /> Pick one for me
                            </Link>
                        )}
                    </div>
                ) : null}
            />

            {data?.daily && (
                <Link to={`/student/coding/${data.daily.slug}`} className="flex items-center gap-3 sm:gap-4 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 p-4 min-h-[64px] hover:bg-emerald-50 dark:hover:bg-emerald-500/15 transition-colors">
                    <span className="w-10 h-10 shrink-0 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400"><CalendarDays className="w-5 h-5" /></span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Problem of the day</p>
                        <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">{data.daily.title}</p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${DIFFICULTY_CLASSES[data.daily.difficulty] || ''}`}>{data.daily.difficulty}</span>
                    {data.daily.status === 'solved' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" aria-label="Solved" />}
                </Link>
            )}

            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 [&>*]:min-w-0">
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 flex items-center gap-4">
                        <div className="relative w-20 h-20 shrink-0">
                            <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90" aria-hidden="true">
                                <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-slate-100 dark:stroke-slate-800" />
                                <motion.circle
                                    cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-emerald-500"
                                    strokeDasharray="97.4"
                                    initial={{ strokeDashoffset: 97.4 }}
                                    animate={{ strokeDashoffset: 97.4 * (1 - (stats.total ? stats.solved / stats.total : 0)) }}
                                    transition={{ duration: 0.9, ease: 'easeOut' }}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-900 dark:text-white">{stats.solved}/{stats.total}</div>
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Solved</p>
                            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                                <Flame className={`w-4 h-4 ${stats.streak_days ? 'text-orange-500' : 'text-slate-300 dark:text-slate-600'}`} />
                                {stats.streak_days ? `${stats.streak_days}-day streak` : 'Start a streak today'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{stats.submissions} submission{stats.submissions === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                    <div className="md:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
                        {DIFFICULTIES.map((d) => {
                            const s = stats.by_difficulty?.[d] || { solved: 0, total: 0 };
                            return (
                                <div key={d} className="flex items-center gap-3">
                                    <span className="w-16 text-xs font-semibold text-slate-600 dark:text-slate-300">{d}</span>
                                    <div className="flex-1 min-w-0">
                                        <AnimatedBar value={s.total ? (s.solved / s.total) * 100 : 0} tone={BAR_TONE[d]} />
                                    </div>
                                    <span className="w-12 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{s.solved}/{s.total}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="md:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
                        <ActivityHeatmap activity={stats.activity} days={stats.activity_days || 84} />
                    </div>
                </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4 space-y-3">
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search problems"
                        aria-label="Search problems"
                        className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 w-0 min-w-full">
                    <Chip active={!difficulty} onClick={() => setDifficulty('')}>All levels</Chip>
                    {DIFFICULTIES.map((d) => <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(difficulty === d ? '' : d)}>{d}</Chip>)}
                    <span className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0" aria-hidden="true" />
                    {STATUSES.map((s) => <Chip key={s.key || 'all'} active={status === s.key} onClick={() => setStatus(s.key)}>{s.label}</Chip>)}
                    <span className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0" aria-hidden="true" />
                    <Chip active={bookmarkedOnly} onClick={() => setBookmarkedOnly((v) => !v)}>
                        <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5" /> Bookmarked{data?.bookmarks ? ` (${data.bookmarks})` : ''}</span>
                    </Chip>
                </div>
                {!!data?.tags?.length && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 w-0 min-w-full">
                        <Chip active={!tag} onClick={() => setTag('')}>All topics</Chip>
                        {data.tags.map((t) => <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? '' : t)}>{t}</Chip>)}
                    </div>
                )}
            </div>

            {error ? (
                <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>
            ) : loading && !data ? (
                <div className="flex items-center justify-center py-20 text-slate-500 dark:text-slate-400 gap-3"><RefreshCw className="w-5 h-5 animate-spin" /> Loading problems…</div>
            ) : problems.length === 0 ? (
                <EmptyState icon={Search} title="No problems match" body="Try a different search or clear a filter." />
            ) : (
                <ul className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                    {problems.map((p) => (
                        <li key={p.slug} className="flex items-center hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                            <Link to={`/student/coding/${p.slug}`} className="flex flex-1 min-w-0 items-center gap-3 pl-3 sm:pl-4 min-h-[56px] py-3">
                                <StatusIcon status={p.status} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{p.order}. {p.title}</p>
                                    <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 truncate">{p.tags.join(' · ')}</p>
                                </div>
                                <span className="hidden sm:block w-20 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                    {p.acceptance_rate === null ? '–' : `${p.acceptance_rate}%`}
                                </span>
                                <span className={`w-16 text-center text-[11px] font-semibold px-2 py-1 rounded-full border ${DIFFICULTY_CLASSES[p.difficulty] || ''}`}>{p.difficulty}</span>
                            </Link>
                            <button type="button" onClick={() => toggleBookmark(p.slug)} aria-pressed={p.bookmarked}
                                aria-label={p.bookmarked ? `Remove ${p.title} from bookmarks` : `Bookmark ${p.title}`}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 hover:text-amber-500">
                                <Star className={`w-4 h-4 ${p.bookmarked ? 'fill-amber-400 text-amber-500' : ''}`} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default StudentCoding;
