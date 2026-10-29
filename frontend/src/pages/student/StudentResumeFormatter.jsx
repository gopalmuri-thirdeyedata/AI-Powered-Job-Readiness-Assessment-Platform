import React, { useEffect, useState } from 'react';
import { useUser } from '../../auth/useAuth';
import { AlertTriangle, CheckCircle2, Download, FileText, History, LayoutTemplate, RefreshCw, Sparkles, X } from 'lucide-react';
import studentApi from '../../services/studentApi';
import { PageHero, Stagger, StaggerItem } from '../../components/student-ui/StudentMotion';
import { Reveal } from '../../components/home/primitives';
import ResumeSourcePicker from '../../components/student-ui/ResumeSourcePicker';
import ResumePreview from '../../components/student-ui/ResumePreview';
import { TEMPLATES } from '../../utils/resumeTemplates';
import { downloadResumeDocx, downloadResumePdf } from '../../utils/resumeExport';
import { isStudentDemo } from '../../utils/studentDemo';
import { DEMO_FORMATTED_RESUME } from '../../services/studentDemoData';

const STORAGE_PREFIX = 'prepwin_resume_formatter';

// The last generated resume is kept in this browser, per student, so leaving the page and coming back
// (or reloading) shows it again instead of an empty page. Every storage call is guarded: it can be blocked.
const readSaved = (key) => {
    try {
        const raw = localStorage.getItem(key);
        const saved = raw ? JSON.parse(raw) : null;
        return saved && saved.data && typeof saved.data === 'object' ? saved : null;
    } catch {
        return null;
    }
};
const writeSaved = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or unavailable */ }
};
const removeSaved = (key) => {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
};

const StudentResumeFormatter = () => {
    const { user, isLoaded: isUserLoaded } = useUser();
    // The demo opens with a sample resume already formatted, and never reads or writes the browser's saved resume
    const demo = isStudentDemo();
    const storageKey = !demo && isUserLoaded && user?.id ? `${STORAGE_PREFIX}:${user.id}` : null;
    const [savedResume, setSavedResume] = useState(null);
    const [isLoadingSaved, setIsLoadingSaved] = useState(true);
    const [source, setSource] = useState({ file: null, resumeId: null });
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState(null);
    const [resumeData, setResumeData] = useState(() => (isStudentDemo() ? DEMO_FORMATTED_RESUME : null));
    const [selected, setSelected] = useState('classic');
    const [downloading, setDownloading] = useState(null);
    const [restoredMeta, setRestoredMeta] = useState(null); // {savedAt, sourceLabel} when showing an earlier result

    useEffect(() => {
        let cancelled = false;
        studentApi.getResume()
            .then((data) => { if (!cancelled && data?.id) setSavedResume(data); })
            .catch(() => { /* 404: the student has no saved resume yet */ })
            .finally(() => { if (!cancelled) setIsLoadingSaved(false); });
        return () => { cancelled = true; };
    }, []);

    // Bring back the previous result when the student returns to this page
    useEffect(() => {
        if (!storageKey) return;
        const saved = readSaved(storageKey);
        if (!saved) return;
        setResumeData(saved.data);
        if (TEMPLATES.some((t) => t.id === saved.selected)) setSelected(saved.selected);
        setRestoredMeta({ savedAt: saved.savedAt, sourceLabel: saved.sourceLabel });
    }, [storageKey]);

    // Remember which template the student picked
    useEffect(() => {
        if (!storageKey || !resumeData) return;
        const saved = readSaved(storageKey);
        if (saved && saved.selected !== selected) writeSaved(storageKey, { ...saved, selected });
    }, [selected, storageKey, resumeData]);

    const hasSource = Boolean(source.file || source.resumeId);

    const generate = async (e) => {
        e.preventDefault();
        if (!hasSource || isGenerating) return;
        setIsGenerating(true);
        setError(null);
        try {
            const data = await studentApi.formatResume({ file: source.file, resumeId: source.resumeId });
            setResumeData(data);
            const sourceLabel = source.file?.name || savedResume?.file_name || 'your saved resume';
            const savedAt = new Date().toISOString();
            setRestoredMeta(null);
            if (storageKey) writeSaved(storageKey, { data, selected, savedAt, sourceLabel });
        } catch (err) {
            // keep any earlier result on screen: a failed attempt must not erase it
            setError(err.response?.data?.detail || 'Could not read your resume. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const download = async (kind) => {
        setDownloading(kind);
        setError(null);
        try {
            if (kind === 'pdf') await downloadResumePdf(resumeData, selected);
            else await downloadResumeDocx(resumeData, selected);
        } catch (err) {
            console.error('Resume download failed:', err);
            setError('Could not create the download. Please try again.');
        } finally {
            setDownloading(null);
        }
    };

    const clearSaved = () => {
        if (storageKey) removeSaved(storageKey);
        setResumeData(null);
        setRestoredMeta(null);
    };

    const selectedTemplate = TEMPLATES.find((t) => t.id === selected);
    const isEmpty = resumeData && !resumeData.name && !resumeData.skills?.length && !resumeData.experience?.length
        && !resumeData.projects?.length && !resumeData.education?.length;

    return (
        <div className="space-y-6 sm:space-y-8">
            <PageHero
                icon={LayoutTemplate}
                eyebrow="Resume Lab"
                title="Resume Formatter"
                subtitle="Turn your existing resume into a clean, ATS-friendly layout. Pick one of three templates, preview it, and download it as PDF or Word."
            />

            <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Choose your resume
                </h2>
                {isLoadingSaved ? (
                    <div className="py-6 text-center"><RefreshCw className="w-5 h-5 text-emerald-500 animate-spin mx-auto" /></div>
                ) : (
                    <form onSubmit={generate} className="space-y-4">
                        <ResumeSourcePicker
                            idPrefix="fmt-source"
                            savedResume={savedResume}
                            value={source}
                            onChange={setSource}
                            onError={setError}
                            disabled={isGenerating}
                        />
                        {error && (
                            <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                        <div className="flex justify-end">
                            <button
                                type="submit"
                                id="fmt-generate-btn"
                                disabled={!hasSource || isGenerating}
                                className={`h-12 w-full sm:w-auto justify-center px-6 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-[0.98] ${hasSource && !isGenerating ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'}`}
                            >
                                {isGenerating ? (<><RefreshCw className="w-4 h-4 animate-spin" /><span>Reading your resume...</span></>) : (<><Sparkles className="w-4 h-4" /><span>Generate 3 Templates</span></>)}
                            </button>
                        </div>
                    </form>
                )}
            </Reveal>

            {restoredMeta && resumeData && (
                <div id="fmt-restored-banner" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-100 text-xs sm:text-sm">
                    <span className="flex items-start gap-2">
                        <History className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                            Showing your last generated resume
                            {restoredMeta.sourceLabel ? ` (from ${restoredMeta.sourceLabel})` : ''}
                            {restoredMeta.savedAt ? `, created ${new Date(restoredMeta.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.
                            Choose a resume above and generate again to replace it.
                        </span>
                    </span>
                    <button
                        type="button"
                        id="fmt-clear-saved"
                        onClick={clearSaved}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 cursor-pointer shrink-0"
                    >
                        <X className="w-3.5 h-3.5" /> Clear
                    </button>
                </div>
            )}

            {resumeData && isEmpty && (
                <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm">
                    We could not find resume sections in this file. Try a text-based PDF or DOCX.
                </div>
            )}

            {resumeData && !isEmpty && (
                <div id="fmt-templates" className="space-y-6">
                    {!resumeData.ai_generated && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            AI was unavailable, so sections were detected from your resume's headings. Check the preview before downloading.
                        </p>
                    )}

                    <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {TEMPLATES.map((t) => {
                            const active = selected === t.id;
                            return (
                                <StaggerItem key={t.id}>
                                    <button
                                        type="button"
                                        id={`fmt-template-${t.id}`}
                                        onClick={() => setSelected(t.id)}
                                        aria-pressed={active}
                                        className={`w-full text-left rounded-2xl border p-3 transition-all cursor-pointer ${active ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-300 dark:hover:border-emerald-500/40'}`}
                                    >
                                        <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 max-h-72 sm:max-h-80 pointer-events-none select-none">
                                            <ResumePreview data={resumeData} templateId={t.id} maxPages={1} />
                                        </div>
                                        <div className="mt-3 flex items-center justify-between gap-2">
                                            <span className="text-sm font-bold text-slate-900 dark:text-white">{t.name}</span>
                                            {active && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" />Selected</span>}
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{t.description}</p>
                                    </button>
                                </StaggerItem>
                            );
                        })}
                    </Stagger>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                                {selectedTemplate?.name} template preview
                            </h3>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <button
                                    type="button"
                                    id="fmt-download-pdf"
                                    onClick={() => download('pdf')}
                                    disabled={Boolean(downloading)}
                                    className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                                >
                                    {downloading === 'pdf' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    <span>Download PDF</span>
                                </button>
                                <button
                                    type="button"
                                    id="fmt-download-docx"
                                    onClick={() => download('docx')}
                                    disabled={Boolean(downloading)}
                                    className="h-11 px-5 rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-60 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                                >
                                    {downloading === 'docx' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    <span>Download Word (DOCX)</span>
                                </button>
                            </div>
                        </div>
                        <div className="mx-auto max-w-[720px]">
                            <ResumePreview data={resumeData} templateId={selected} framed />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentResumeFormatter;
