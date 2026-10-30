import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ArrowLeft, CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, Clock, FileText, Lightbulb, Lock, Play, RefreshCw, Send, Star, Terminal, XCircle,
} from 'lucide-react';
import codingApi from '../../services/codingApi';
import RichText from '../../components/coding/RichText';
import CodeEditorPanel from '../../components/coding/CodeEditorPanel';
import { Block, CaseViewer, Pane, SLIM_LABEL, Splitter, TAB_BAR, TabButton } from '../../components/coding/workspaceParts';
import {
    DIFFICULTY_CLASSES, TONE_CLASSES, clearDraft, errorMessage, formatMemory, formatRuntime, isRunShortcut, isSubmitShortcut,
    loadDraft, pickInitialCode, saveDraft, statusLabel, verdictInfo,
} from '../../utils/codingPlatform';
import { STUDENT_DEMO_BASE, isStudentDemo } from '../../utils/studentDemo';
import { defaultLanguage, languageOptionsFor, starterFor } from '../../utils/codingLanguages';

// In the Student Dashboard Demo the page lives under the demo routes, and its drafts must not mix with a real student's drafts in this browser
const problemPath = (slug) => `${isStudentDemo() ? STUDENT_DEMO_BASE : '/student'}/coding/${slug}`;
// Python keeps the original draft key, so drafts written before the other languages existed are still found
const draftId = (slug, language = 'python') => `${isStudentDemo() ? `demo:${slug}` : slug}${language === 'python' ? '' : `:${language}`}`;

const StudentCodingProblem = () => {
    const { slug } = useParams();
    const navigate = useNavigate();
    const [expanded, setExpanded] = useState(false);
    const [problem, setProblem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [code, setCode] = useState('');
    const [language, setLanguage] = useState('python');
    const [leftTab, setLeftTab] = useState('description');
    const [mobileTab, setMobileTab] = useState('problem');
    const [consoleTab, setConsoleTab] = useState('testcase');
    const [caseView, setCaseView] = useState(0);
    const [running, setRunning] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [runResult, setRunResult] = useState(null);
    const [submitResult, setSubmitResult] = useState(null);
    const [actionError, setActionError] = useState('');
    const [caseIndex, setCaseIndex] = useState(0);
    const [submissions, setSubmissions] = useState([]);
    const [openedSubmission, setOpenedSubmission] = useState(null);
    const [leftPct, setLeftPct] = useState(44);
    const [editorPct, setEditorPct] = useState(62);
    const splitRef = useRef(null);
    const rightRef = useRef(null);
    const runRef = useRef(() => {});
    const submitRef = useRef(() => {});
    const buffersRef = useRef({});                 // { [language]: code }: what was left in the other languages, so switching never loses work

    // The problem as the Assessment's language helpers read it: its languages and one starter per language
    const languageView = useMemo(() => (problem ? { languages: problem.languages, starter_code: problem.starters || { python: problem.starter_code } } : null), [problem]);

    const loadProblem = useCallback(async () => {
        const res = await codingApi.getProblem(slug);
        setProblem(res);
        return res;
    }, [slug]);

    const loadSubmissions = useCallback(async () => {
        try { setSubmissions(await codingApi.getSubmissions(slug)); } catch { /* the history tab simply stays empty */ }
    }, [slug]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError('');
        setRunResult(null);
        setSubmitResult(null);
        setActionError('');
        setOpenedSubmission(null);
        setLeftTab('description');
        setConsoleTab('testcase');
        setMobileTab('problem');
        setCaseView(0);
        setCaseIndex(0);
        loadProblem()
            .then((res) => {
                if (cancelled) return;
                const view = { languages: res.languages, starter_code: res.starters || { python: res.starter_code } };
                const first = defaultLanguage(view);
                buffersRef.current = {};
                setLanguage(first);
                setCode(pickInitialCode({ draft: loadDraft(draftId(slug, first)), lastCode: (res.last_language || 'python') === first ? res.last_code : null, starter: starterFor(view, first) }));
                loadSubmissions();
            })
            .catch((err) => { if (!cancelled) setLoadError(errorMessage(err, 'Could not load this problem.')); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [slug, loadProblem, loadSubmissions]);

    useEffect(() => {
        if (!problem) return undefined;
        const t = setTimeout(() => saveDraft(draftId(slug, language), code), 400);
        return () => clearTimeout(t);
    }, [code, slug, language, problem]);

    const handleRun = async () => {
        if (running || submitting) return;
        setRunning(true);
        setActionError('');
        setSubmitResult(null);
        setConsoleTab('result');
        setMobileTab('console');
        try {
            const res = await codingApi.run(slug, code, null, language);
            setRunResult(res);
            setCaseIndex(Math.max(0, (res.cases || []).findIndex((c) => c.status === 'failed' || c.status === 'error' || c.status === 'tle')));
        } catch (err) {
            setRunResult(null);
            setActionError(errorMessage(err));
        } finally {
            setRunning(false);
        }
    };

    const handleBookmark = async () => {
        const was = !!problem.bookmarked;
        setProblem((p) => ({ ...p, bookmarked: !was }));
        try { await codingApi.bookmark(slug); } catch (err) { setProblem((p) => ({ ...p, bookmarked: was })); setActionError(errorMessage(err)); }
    };

    const handleSubmit = async () => {
        if (running || submitting) return;
        setSubmitting(true);
        setActionError('');
        setRunResult(null);
        setConsoleTab('result');
        setMobileTab('console');
        try {
            const res = await codingApi.submit(slug, code, language);
            setSubmitResult(res);
            loadSubmissions();
            if (res.verdict === 'ACCEPTED') loadProblem().catch(() => {});      // unlocks the Solution tab and updates the status
        } catch (err) {
            setSubmitResult(null);
            setActionError(errorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    runRef.current = handleRun;
    submitRef.current = handleSubmit;

    useEffect(() => {
        const onKey = (e) => {
            if (isRunShortcut(e)) { e.preventDefault(); runRef.current(); }
            else if (isSubmitShortcut(e)) { e.preventDefault(); submitRef.current(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const resetCode = () => {
        if (!problem) return;
        if (window.confirm('Reset to the starter code? Your current code will be replaced.')) {
            clearDraft(draftId(slug, language));
            delete buffersRef.current[language];
            setCode(starterFor(languageView, language));
        }
    };

    // Switching language parks the current code and brings back that language's own code (its draft, its last submission, or its starter).
    const handleLanguageChange = (next) => {
        if (!languageView || next === language || running || submitting) return;
        buffersRef.current[language] = code;
        const restored = buffersRef.current[next]
            ?? pickInitialCode({ draft: loadDraft(draftId(slug, next)), lastCode: (problem.last_language || 'python') === next ? problem.last_code : null, starter: starterFor(languageView, next) });
        setLanguage(next);
        setCode(restored);
    };

    const openSubmission = async (id) => {
        try { setOpenedSubmission(await codingApi.getSubmission(id)); } catch (err) { setActionError(errorMessage(err)); }
    };

    if (loading && !problem) {
        return <div className="flex items-center justify-center min-h-[420px] gap-3 text-slate-500 dark:text-slate-400"><RefreshCw className="w-5 h-5 animate-spin" /> Loading problem…</div>;
    }
    if (loadError || !problem) {
        return (
            <div className="max-w-xl mx-auto text-center py-16 space-y-4">
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{loadError || 'Problem not found.'}</p>
                <Link to="/student/coding" className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200"><ArrowLeft className="w-4 h-4" /> Back to problems</Link>
            </div>
        );
    }

    const busy = running || submitting;
    const solved = problem.status === 'solved';
    const cases = runResult?.cases || [];

    return (
        <div className="flex flex-col gap-3 min-w-0 lg:h-[calc(100vh-8.5rem)]">
            {/* Top bar */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <Link to="/student/coding" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" aria-label="Back to problems">
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <div className="min-w-0 flex-1 basis-40">
                    <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">{problem.title}</h1>
                </div>
                {/* On a phone the actions take their own full-width row under the title; Run and Submit share it equally */}
                <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
                <div className="hidden sm:flex items-center gap-1">
                    <button type="button" disabled={!problem.prev_slug} onClick={() => navigate(problemPath(problem.prev_slug))} className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40" aria-label="Previous problem"><ChevronLeft className="w-4 h-4" /></button>
                    <button type="button" disabled={!problem.next_slug} onClick={() => navigate(problemPath(problem.next_slug))} className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40" aria-label="Next problem"><ChevronRight className="w-4 h-4" /></button>
                </div>
                <button type="button" onClick={handleBookmark} aria-pressed={!!problem.bookmarked} aria-label={problem.bookmarked ? 'Remove bookmark' : 'Bookmark this problem'} title="Bookmark"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-amber-500">
                    <Star className={`w-4 h-4 ${problem.bookmarked ? 'fill-amber-400 text-amber-500' : ''}`} />
                </button>
                <button type="button" onClick={handleRun} disabled={busy} title="Run (Ctrl + ')" className="min-h-[44px] flex-1 justify-center sm:flex-none px-3 sm:px-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
                    {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run
                </button>
                <button type="button" onClick={handleSubmit} disabled={busy} title="Submit (Ctrl + Enter)" className="min-h-[44px] flex-1 justify-center sm:flex-none px-3 sm:px-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-60">
                    {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit
                </button>
                </div>
            </div>

            {/* Mobile section switcher */}
            <div role="tablist" aria-label="Workspace section" className="lg:hidden flex border-b border-slate-200 dark:border-slate-800">
                {[['problem', 'Problem'], ['code', 'Code'], ['console', 'Console']].map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={mobileTab === key} onClick={() => setMobileTab(key)}
                        className={`flex-1 min-h-[44px] text-sm font-semibold border-b-2 ${mobileTab === key ? 'border-emerald-500 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>{label}</button>
                ))}
            </div>

            <div ref={splitRef} className="flex-1 min-h-0 flex flex-col lg:flex-row" style={{ '--left': `${leftPct}%`, '--editor': `${editorPct}%` }}>
                {/* Left: description / submissions / solution */}
                <Pane className={`${mobileTab === 'problem' ? 'flex' : 'hidden'} ${expanded ? 'lg:!hidden' : 'lg:flex'} flex-col lg:w-[var(--left)] lg:shrink-0 min-h-[60vh] lg:min-h-0`}>
                    <div role="tablist" className={TAB_BAR}>
                        <TabButton active={leftTab === 'description'} onClick={() => setLeftTab('description')} icon={FileText}>Description</TabButton>
                        <TabButton active={leftTab === 'solution'} onClick={() => setLeftTab('solution')} icon={solved ? Lightbulb : Lock}>Solution</TabButton>
                        <TabButton active={leftTab === 'submissions'} onClick={() => { setLeftTab('submissions'); setOpenedSubmission(null); }} icon={Clock}>Submissions</TabButton>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
                        {leftTab === 'description' && (
                            <div className="space-y-5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${DIFFICULTY_CLASSES[problem.difficulty] || ''}`}>{problem.difficulty}</span>
                                    <span className="text-[11px] font-semibold px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">{statusLabel[problem.status]}</span>
                                    {problem.is_daily && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">Problem of the day</span>}
                                    {problem.tags.map((t) => <span key={t} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{t}</span>)}
                                </div>
                                <RichText text={problem.description} />
                                {problem.examples.map((ex, i) => (
                                    <div key={i} className="border-l-2 border-slate-300 dark:border-[#444] pl-3 py-0.5 space-y-1.5 text-sm">
                                        <p className="font-semibold text-slate-900 dark:text-white">Example {i + 1}</p>
                                        <p className="font-mono text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 break-words"><span className="text-slate-500 dark:text-slate-400">Input: </span>{ex.input}</p>
                                        <p className="font-mono text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 break-words"><span className="text-slate-500 dark:text-slate-400">Output: </span>{ex.output}</p>
                                        {ex.explanation && <p className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300"><span className="text-slate-500 dark:text-slate-400">Explanation: </span>{ex.explanation}</p>}
                                    </div>
                                ))}
                                {!!problem.constraints.length && (
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1.5">Constraints</p>
                                        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                                            {problem.constraints.map((c, i) => <li key={i}><code className="text-xs bg-slate-100 dark:bg-[#2b2b2b] text-slate-800 dark:text-slate-200 rounded px-1 py-0.5">{c}</code></li>)}
                                        </ul>
                                    </div>
                                )}
                                {!!problem.hints.length && (
                                    <div className="space-y-2">
                                        {problem.hints.map((h, i) => (
                                            <details key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 group">
                                                <summary className="cursor-pointer min-h-[32px] flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><Lightbulb className="w-4 h-4 text-amber-500" /> Hint {i + 1}</summary>
                                                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{h}</p>
                                            </details>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {leftTab === 'solution' && (
                            solved && problem.solution ? (
                                <div className="space-y-4">
                                    <p className="text-sm text-slate-700 dark:text-slate-300">{problem.solution.explanation}</p>
                                    <pre className="rounded-xl bg-slate-950 text-slate-100 text-xs sm:text-[13px] p-4 overflow-x-auto font-mono">{problem.solution.code}</pre>
                                </div>
                            ) : (
                                <div className="text-center py-10 space-y-2">
                                    <Lock className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Solve this problem to unlock the reference solution</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Use the hints in the Description tab if you are stuck.</p>
                                </div>
                            )
                        )}
                        {leftTab === 'submissions' && (
                            openedSubmission ? (
                                <div className="space-y-3">
                                    <button type="button" onClick={() => setOpenedSubmission(null)} className="min-h-[40px] inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400"><ArrowLeft className="w-4 h-4" /> All submissions</button>
                                    <p className={`text-base font-bold ${TONE_CLASSES[verdictInfo(openedSubmission.verdict).tone]}`}>{verdictInfo(openedSubmission.verdict).label}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{openedSubmission.passed}/{openedSubmission.total} testcases · {formatRuntime(openedSubmission.runtime_ms)} · {formatMemory(openedSubmission.memory_kb)}</p>
                                    <pre className="rounded-xl bg-slate-950 text-slate-100 text-xs sm:text-[13px] p-4 overflow-x-auto font-mono">{openedSubmission.code}</pre>
                                    <button type="button" onClick={() => { const lang = languageOptionsFor(languageView).some((o) => o.value === openedSubmission.language) ? openedSubmission.language : language; if (lang !== language) { buffersRef.current[language] = code; setLanguage(lang); } setCode(openedSubmission.code); setMobileTab('code'); }} className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200">Load into editor</button>
                                </div>
                            ) : submissions.length === 0 ? (
                                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">No submissions yet. Write your solution and press Submit.</p>
                            ) : (
                                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {submissions.map((s) => (
                                        <li key={s.id}>
                                            <button type="button" onClick={() => openSubmission(s.id)} className="w-full min-h-[52px] py-2 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg px-2">
                                                <span className={`text-sm font-semibold ${TONE_CLASSES[verdictInfo(s.verdict).tone]}`}>{verdictInfo(s.verdict).label}</span>
                                                <span className="ml-auto text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatRuntime(s.runtime_ms)}</span>
                                                <span className="hidden sm:inline text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatMemory(s.memory_kb)}</span>
                                                <span className="text-[11px] text-slate-400">{s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        )}
                    </div>
                </Pane>

                {!expanded && <Splitter axis="x" containerRef={splitRef} value={leftPct} onChange={setLeftPct} min={28} max={65} label="Resize problem panel" />}

                {/* Right: editor above console */}
                <div ref={rightRef} className={`${mobileTab === 'problem' ? 'hidden' : 'flex'} lg:flex flex-col flex-1 min-w-0 min-h-0 gap-2 lg:gap-0`} style={{ '--editor': `${editorPct}%` }}>
                    {/* The shared student code editor: the same component the assessment coding round renders */}
                    <CodeEditorPanel
                        className={`${mobileTab === 'console' ? 'hidden' : 'flex'} lg:flex flex-col h-[62vh] min-h-[340px] lg:h-auto lg:min-h-0 lg:basis-[var(--editor)] lg:shrink-0`}
                        code={code} onCodeChange={setCode} language={language} path={`coding-${slug}.${language}`}
                        languageOptions={languageOptionsFor(languageView)} onLanguageChange={handleLanguageChange} languageDisabled={running || submitting}
                        onRun={() => runRef.current()} onSubmit={() => submitRef.current()} onReset={resetCode}
                        expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} saved="Autosaved"
                    />

                    <Splitter axis="y" containerRef={rightRef} value={editorPct} onChange={setEditorPct} min={25} max={80} label="Resize editor and console" />

                    <Pane className={`${mobileTab === 'code' ? 'hidden' : 'flex'} lg:flex flex-col min-h-[300px] lg:min-h-0 lg:flex-1`}>
                        <div role="tablist" className={TAB_BAR}>
                            <TabButton active={consoleTab === 'testcase'} onClick={() => setConsoleTab('testcase')} icon={CheckSquare}>Testcase</TabButton>
                            <TabButton active={consoleTab === 'result'} onClick={() => setConsoleTab('result')} icon={Terminal}>Test Result</TabButton>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 text-sm" aria-live="polite">
                            {consoleTab === 'testcase' && (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {problem.examples.map((_, i) => (
                                            <button key={i} type="button" onClick={() => setCaseView(i)}
                                                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold border cursor-pointer ${caseView === i ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                Case {i + 1}
                                            </button>
                                        ))}
                                    </div>
                                    <div>
                                        <p className={`${SLIM_LABEL} mb-1`}>Input</p>
                                        <pre className="rounded-lg bg-slate-100 dark:bg-[#2b2b2b] p-3 font-mono text-xs sm:text-[13px] text-slate-900 dark:text-white whitespace-pre-wrap break-words">{problem.examples[caseView]?.input ?? problem.examples[0]?.input}</pre>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Run checks these {problem.examples.length} example{problem.examples.length === 1 ? '' : 's'} against your code.</p>
                                </div>
                            )}
                            {consoleTab === 'result' && (
                                <div className="space-y-3">
                                    {(running || submitting) && <p className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><RefreshCw className="w-4 h-4 animate-spin" /> {submitting ? 'Judging against all test cases…' : 'Running…'}</p>}
                                    {actionError && !busy && <p role="alert" className="text-rose-600 dark:text-rose-400">{actionError}</p>}
                                    {!busy && !actionError && !runResult && !submitResult && <p className="text-slate-500 dark:text-slate-400">Run your code to see the output, or Submit to judge it.</p>}

                                    {!busy && submitResult && (
                                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                                <p className={`text-lg font-bold flex items-center gap-2 ${TONE_CLASSES[verdictInfo(submitResult.verdict).tone]}`}>
                                                    {submitResult.verdict === 'ACCEPTED' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                                                    {verdictInfo(submitResult.verdict).label}
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">{submitResult.passed}/{submitResult.total} testcases passed</p>
                                            </div>
                                            {submitResult.verdict === 'ACCEPTED' ? (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                                        <p className="text-[11px] uppercase font-semibold text-slate-500 dark:text-slate-400">Runtime</p>
                                                        <p className="text-base font-bold text-slate-900 dark:text-white">{formatRuntime(submitResult.runtime_ms)}</p>
                                                        {submitResult.beats_runtime_pct !== null && submitResult.beats_runtime_pct !== undefined && <p className="text-xs text-emerald-600 dark:text-emerald-400">Beats {submitResult.beats_runtime_pct}%</p>}
                                                    </div>
                                                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                                        <p className="text-[11px] uppercase font-semibold text-slate-500 dark:text-slate-400">Memory</p>
                                                        <p className="text-base font-bold text-slate-900 dark:text-white">{formatMemory(submitResult.memory_kb)}</p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {submitResult.message && <Block label="Error">{submitResult.message}</Block>}
                                                    {submitResult.failed_case && (
                                                        <>
                                                            <Block label="Input">{submitResult.failed_case.input}</Block>
                                                            {submitResult.failed_case.actual !== null && submitResult.failed_case.actual !== undefined && <Block label="Your output">{submitResult.failed_case.actual}</Block>}
                                                            <Block label="Expected">{submitResult.failed_case.expected}</Block>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </motion.div>
                                    )}

                                    {!busy && runResult && (
                                        <div className="space-y-3">
                                            <p className={`text-base font-bold ${TONE_CLASSES[verdictInfo(runResult.verdict).tone]}`}>
                                                {runResult.verdict === 'ACCEPTED' ? 'Examples passed' : verdictInfo(runResult.verdict).label}
                                                {runResult.verdict === 'ACCEPTED' || runResult.verdict === 'WRONG_ANSWER' ? <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">{runResult.passed}/{runResult.total} examples</span> : null}
                                            </p>
                                            {runResult.message && <Block label="Details">{runResult.message}</Block>}
                                            {!!cases.length && (
                                                <CaseViewer cases={cases} index={caseIndex} onIndex={setCaseIndex} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </Pane>
                </div>
            </div>
        </div>
    );
};

export default StudentCodingProblem;
