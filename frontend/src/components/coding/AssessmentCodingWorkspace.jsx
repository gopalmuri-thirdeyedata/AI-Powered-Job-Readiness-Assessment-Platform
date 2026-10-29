import React, { useEffect, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { RefreshCw, RotateCcw, Terminal } from 'lucide-react';
import RichText from './RichText';
import { CaseViewer, Block, EDITOR_OPTIONS, Pane, Splitter, TabButton, useIsDark } from './workspaceParts';
import { DIFFICULTY_CLASSES, isRunShortcut } from '../../utils/codingPlatform';

/**
 * Turns the assessment's run response into the cases the shared viewer shows. A sample test passes or fails; the student's own
 * testcase has nothing to compare against, so it only shows what the code printed.
 */
export const casesFromRun = (result) => (result?.test_results || []).map((t) => ({
    status: t.custom ? (t.error ? 'error' : 'ran') : t.passed ? 'passed' : (t.error_type ? 'error' : 'failed'),
    custom: !!t.custom,
    input: t.input,
    expected: t.expected_output,
    actual: t.actual_output || (t.error ? '' : '(no output)'),
    error: t.error || null,
}));

export const runSummary = (result) => {
    if (!result) return null;
    if (result.error_type) return { label: result.error_type, tone: 'text-amber-600 dark:text-amber-400' };
    if (result.all_passed) return { label: 'Sample tests passed', tone: 'text-emerald-600 dark:text-emerald-400' };
    if ((result.test_results || []).some((t) => !t.custom && !t.passed)) return { label: 'Wrong Answer', tone: 'text-rose-600 dark:text-rose-400' };
    return { label: 'Finished', tone: 'text-slate-700 dark:text-slate-200' };
};

/**
 * The LeetCode-style workspace for one assessment coding problem: description and examples on the left, the editor above a
 * Testcase / Result console on the right (draggable on a desktop, Problem / Code / Console tabs on a phone). Submitting the whole
 * section stays with the assessment page; this only edits, runs and shows output.
 */
const AssessmentCodingWorkspace = ({
    problem, code, onCodeChange, onReset, onRun, running, result, error, badge,
}) => {
    const dark = useIsDark();
    const [mobileTab, setMobileTab] = useState('problem');
    const [consoleTab, setConsoleTab] = useState('testcase');
    const [caseIndex, setCaseIndex] = useState(0);
    const [caseView, setCaseView] = useState(0);
    const [leftPct, setLeftPct] = useState(42);
    const [editorPct, setEditorPct] = useState(60);
    const splitRef = useRef(null);
    const rightRef = useRef(null);
    const runRef = useRef(onRun);
    runRef.current = onRun;

    const cases = casesFromRun(result);
    const summary = runSummary(result);
    const examples = problem.public_test_cases || [];

    // A new problem starts on its description with a clean console
    useEffect(() => { setMobileTab('problem'); setConsoleTab('testcase'); setCaseIndex(0); setCaseView(0); }, [problem.id]);

    // A new result opens the Result tab on the first case that needs attention
    useEffect(() => {
        if (!result) return;
        setConsoleTab('result');
        setCaseIndex(Math.max(0, cases.findIndex((c) => c.status === 'failed' || c.status === 'error')));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result]);

    useEffect(() => {
        const onKey = (e) => { if (isRunShortcut(e)) { e.preventDefault(); runRef.current(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Run lives in the page's top bar: when it starts, show the console
    useEffect(() => { if (running) { setMobileTab('console'); setConsoleTab('result'); } }, [running]);

    return (
        <div className="flex flex-col gap-2 min-w-0 lg:h-[calc(100vh-11.5rem)] lg:min-h-[480px]" data-testid="leetcode-workspace">
            <div role="tablist" aria-label="Workspace section" className="lg:hidden flex border-b border-slate-200 dark:border-slate-800">
                {[['problem', 'Problem'], ['code', 'Code'], ['console', 'Console']].map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={mobileTab === key} onClick={() => setMobileTab(key)}
                        className={`flex-1 min-h-[44px] text-sm font-semibold border-b-2 ${mobileTab === key ? 'border-cyan-500 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>{label}</button>
                ))}
            </div>

            <div ref={splitRef} className="flex-1 min-h-0 flex flex-col lg:flex-row" style={{ '--left': `${leftPct}%` }}>
                {/* Left: the problem */}
                <Pane className={`${mobileTab === 'problem' ? 'flex' : 'hidden'} lg:flex flex-col lg:w-[var(--left)] lg:shrink-0 min-h-[60vh] lg:min-h-0`}>
                    <div role="tablist" className="flex border-b border-slate-200 dark:border-slate-800 shrink-0">
                        <TabButton active onClick={() => {}}>Description</TabButton>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
                        <p className="md:hidden text-[11px] leading-snug text-slate-500 dark:text-slate-400 -mt-1">Write only the function: input and output are handled for you, so just <code className="font-semibold">return</code> the result.</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white min-w-0 break-words mr-auto">{problem.title}</h3>
                            {badge}
                            <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${DIFFICULTY_CLASSES[problem.difficulty] || ''}`}>{problem.difficulty}</span>
                        </div>
                        <RichText text={problem.description || ''} className="whitespace-pre-line" />
                        {String(problem.input_format || '').trim() && <Block label="Input">{problem.input_format}</Block>}
                        {String(problem.output_format || '').trim() && <Block label="Output">{problem.output_format}</Block>}
                        {examples.map((t, i) => (
                            <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-sm">
                                <p className="font-semibold text-slate-900 dark:text-white">Example {i + 1}</p>
                                <p className="font-mono text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap"><span className="text-slate-500 dark:text-slate-400">Input: </span>{t.input}</p>
                                <p className="font-mono text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap"><span className="text-slate-500 dark:text-slate-400">Output: </span>{t.expected_output}</p>
                                {t.explanation && <p className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300"><span className="text-slate-500 dark:text-slate-400">Explanation: </span>{t.explanation}</p>}
                            </div>
                        ))}
                        {String(problem.constraints || '').trim() && (
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1.5">Constraints</p>
                                <code className="block text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-1.5 whitespace-pre-wrap break-words">{problem.constraints}</code>
                            </div>
                        )}
                    </div>
                </Pane>

                <Splitter axis="x" containerRef={splitRef} value={leftPct} onChange={setLeftPct} min={28} max={65} label="Resize problem panel" />

                {/* Right: editor above the console */}
                <div ref={rightRef} className={`${mobileTab === 'problem' ? 'hidden' : 'flex'} lg:flex flex-col flex-1 min-w-0 min-h-0 gap-2 lg:gap-0`} style={{ '--editor': `${editorPct}%` }}>
                    <Pane className={`${mobileTab === 'console' ? 'hidden' : 'flex'} lg:flex flex-col h-[62vh] min-h-[340px] lg:h-auto lg:min-h-0 lg:basis-[var(--editor)] lg:shrink-0`}>
                        <div className="flex items-center gap-2 px-3 min-h-[44px] lg:min-h-[40px] border-b border-slate-200 dark:border-slate-800 shrink-0">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Python 3</span>
                            <span className="hidden md:inline text-[11px] text-slate-400 truncate">Write only the function: input and output are handled for you. Run: Ctrl + '</span>
                            <span className="ml-auto text-[11px] text-slate-400 hidden sm:inline">Autosaved</span>
                            <button type="button" onClick={onReset} className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white" aria-label="Reset to starter code" title="Reset code"><RotateCcw className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 min-h-0">
                            <Editor
                                height="100%"
                                language="python"
                                theme={dark ? 'vs-dark' : 'light'}
                                value={code}
                                onChange={(v) => onCodeChange(v ?? '')}
                                onMount={(editor, monaco) => editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote, () => runRef.current())}
                                options={EDITOR_OPTIONS}
                            />
                        </div>
                    </Pane>

                    <Splitter axis="y" containerRef={rightRef} value={editorPct} onChange={setEditorPct} min={25} max={80} label="Resize editor and console" />

                    <Pane className={`${mobileTab === 'code' ? 'hidden' : 'flex'} lg:flex flex-col min-h-[300px] lg:min-h-0 lg:flex-1`}>
                        <div role="tablist" className="flex border-b border-slate-200 dark:border-slate-800 shrink-0">
                            <TabButton active={consoleTab === 'testcase'} onClick={() => setConsoleTab('testcase')} icon={Terminal}>Testcase</TabButton>
                            <TabButton active={consoleTab === 'result'} onClick={() => setConsoleTab('result')}>Result</TabButton>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 text-sm" aria-live="polite">
                            {consoleTab === 'testcase' && (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {examples.map((_, i) => (
                                            <button key={i} type="button" onClick={() => setCaseView(i)}
                                                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold border cursor-pointer ${caseView === i ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                Case {i + 1}
                                            </button>
                                        ))}
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Input</p>
                                        <pre className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 font-mono text-xs sm:text-[13px] text-slate-900 dark:text-white whitespace-pre-wrap break-words">{examples[caseView]?.input ?? examples[0]?.input ?? ''}</pre>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Run checks these {examples.length || 'sample'} example{examples.length === 1 ? '' : 's'} against your code.</p>
                                </div>
                            )}
                            {consoleTab === 'result' && (
                                <div className="space-y-3">
                                    {running && <p className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><RefreshCw className="w-4 h-4 animate-spin" /> Running…</p>}
                                    {error && !running && <p role="alert" className="text-rose-600 dark:text-rose-400">{error}</p>}
                                    {!running && !error && !result && <p className="text-slate-500 dark:text-slate-400">Run your code to see the output. Submitting the whole section is done from the button above.</p>}
                                    {!running && result && (
                                        <div className="space-y-3">
                                            <p className={`text-base font-bold ${summary.tone}`}>
                                                {summary.label}
                                                {result.error_type ? null : <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">{cases.filter((c) => c.status === 'passed').length}/{cases.filter((c) => !c.custom).length} examples</span>}
                                            </p>
                                            {result.error && !cases.length && <Block label="Details">{result.error}</Block>}
                                            {!!cases.length && <CaseViewer cases={cases} index={caseIndex} onIndex={setCaseIndex} />}
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

export default AssessmentCodingWorkspace;
