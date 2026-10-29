import React, { useState } from 'react';
import { AlertTriangle, Briefcase, Building2, CheckCircle2, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import studentApi from '../../services/studentApi';
import { isStudentDemo } from '../../utils/studentDemo';
import { DEMO_SAMPLE_JOB_DESCRIPTION, DEMO_JD_ANALYSIS } from '../../services/studentDemoData';
import { Reveal } from '../home/primitives';
import ResumeSourcePicker from './ResumeSourcePicker';

const MIN_JD_CHARS = 50;

const VERDICT_STYLES = {
    Strong: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
    Good: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30',
    Partial: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
    Weak: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
};

const Chip = ({ children, tone }) => (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${tone === 'match'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
        : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30'}`}>
        {children}
    </span>
);

const BulletCard = ({ title, items, icon: Icon, accent }) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <Icon className={`w-4 h-4 ${accent}`} />
            {title}
        </h3>
        {items?.length ? (
            <ul className="space-y-2">
                {items.map((t, i) => (
                    <li key={i} className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed flex gap-2">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                        <span>{t}</span>
                    </li>
                ))}
            </ul>
        ) : (
            <p className="text-xs text-slate-400 italic">Nothing to show.</p>
        )}
    </div>
);

const ResumeJdAnalyzer = ({ savedResume }) => {
    const [source, setSource] = useState({ file: null, resumeId: null });
    // The demo opens with a sample job description and its result already filled in, so the whole page can be explored
    const [jd, setJd] = useState(() => (isStudentDemo() ? DEMO_SAMPLE_JOB_DESCRIPTION : ''));
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(() => (isStudentDemo() ? DEMO_JD_ANALYSIS : null));

    const jdLength = jd.trim().length;
    const hasSource = Boolean(source.file || source.resumeId);
    const canRun = hasSource && jdLength >= MIN_JD_CHARS && !isRunning;

    const run = async (e) => {
        e.preventDefault();
        if (!canRun) return;
        setIsRunning(true);
        setError(null);
        try {
            setResult(await studentApi.analyzeResumeWithJd({
                file: source.file,
                resumeId: source.resumeId,
                jobDescription: jd.trim(),
            }));
        } catch (err) {
            setResult(null);
            setError(err.response?.data?.detail || 'Could not analyze your resume. Please try again.');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Resume vs Job Description
                </h2>
                <form onSubmit={run} className="space-y-4">
                    <ResumeSourcePicker
                        idPrefix="jd-source"
                        savedResume={savedResume}
                        value={source}
                        onChange={setSource}
                        onError={setError}
                        disabled={isRunning}
                    />
                    <div>
                        <label htmlFor="jd-text" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Job description <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            id="jd-text"
                            value={jd}
                            onChange={(e) => setJd(e.target.value)}
                            disabled={isRunning}
                            rows={8}
                            placeholder="Paste the full job description here..."
                            className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 resize-y"
                        />
                        <p className={`mt-1 text-[11px] ${jdLength >= MIN_JD_CHARS ? 'text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {jdLength >= MIN_JD_CHARS ? `${jdLength} characters` : `At least ${MIN_JD_CHARS} characters needed (${jdLength} so far)`}
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            id="jd-analyze-btn"
                            disabled={!canRun}
                            className={`h-12 w-full sm:w-auto justify-center px-6 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-[0.98] ${canRun ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'}`}
                        >
                            {isRunning ? (<><RefreshCw className="w-4 h-4 animate-spin" /><span>Analyzing fit...</span></>) : (<><Sparkles className="w-4 h-4" /><span>Analyze Job Fit</span></>)}
                        </button>
                    </div>
                </form>
            </Reveal>

            {result && (
                <div id="jd-analysis-result" className="space-y-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                        {(result.job_title || result.company) && (
                            <div className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                {result.job_title && (
                                    <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                        <Briefcase className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                        {result.job_title}
                                    </span>
                                )}
                                {result.company && (
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        {result.company}
                                    </span>
                                )}
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            <div className="flex items-baseline gap-1">
                                <span className="text-5xl font-extrabold text-slate-900 dark:text-white tabular-nums">{Math.round(result.match_score)}</span>
                                <span className="text-sm text-slate-400">/ 100 match</span>
                            </div>
                            <span className={`self-start sm:self-auto px-3 py-1 rounded-full border text-xs font-bold ${VERDICT_STYLES[result.fit_verdict] || VERDICT_STYLES.Partial}`}>
                                {result.fit_verdict} fit
                            </span>
                        </div>
                        {result.summary && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{result.summary}</p>}
                        {(result.required_experience || result.resume_experience) && (
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {result.required_experience && (
                                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 px-3.5 py-2.5">
                                        <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Role asks for</p>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{result.required_experience}</p>
                                    </div>
                                )}
                                {result.resume_experience && (
                                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 px-3.5 py-2.5">
                                        <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Your resume shows</p>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{result.resume_experience}</p>
                                    </div>
                                )}
                            </div>
                        )}
                        {!result.ai_generated && (
                            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                AI analysis was unavailable, so this is a basic keyword comparison.
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Matching skills</h3>
                            <div className="flex flex-wrap gap-2">
                                {result.matched_skills?.length ? result.matched_skills.map((s) => <Chip key={s} tone="match">{s}</Chip>) : <p className="text-xs text-slate-400 italic">No matching skills found.</p>}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Missing skills</h3>
                            <div className="flex flex-wrap gap-2">
                                {result.missing_skills?.length ? result.missing_skills.map((s) => <Chip key={s} tone="missing">{s}</Chip>) : <p className="text-xs text-slate-400 italic">No missing skills detected.</p>}
                            </div>
                        </div>
                        <BulletCard title="Strengths for this job" items={result.strengths} icon={CheckCircle2} accent="text-emerald-600 dark:text-emerald-400" />
                        <BulletCard title="Weaknesses and gaps" items={result.weaknesses} icon={XCircle} accent="text-rose-600 dark:text-rose-400" />
                    </div>

                    {(result.experience_fit || result.qualification_fit) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {result.experience_fit && (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5">
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Experience fit</h3>
                                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{result.experience_fit}</p>
                                </div>
                            )}
                            {result.qualification_fit && (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5">
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Qualification fit</h3>
                                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{result.qualification_fit}</p>
                                </div>
                            )}
                        </div>
                    )}

                    <BulletCard title="Recommendations" items={result.recommendations} icon={Sparkles} accent="text-purple-600 dark:text-purple-400" />
                </div>
            )}
        </div>
    );
};

export default ResumeJdAnalyzer;
