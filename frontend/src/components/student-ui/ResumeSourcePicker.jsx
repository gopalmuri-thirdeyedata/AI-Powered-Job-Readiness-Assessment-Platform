import React, { useState } from 'react';
import { FileText, Upload, History } from 'lucide-react';

export const RESUME_ACCEPT = '.pdf,.docx,.doc,.txt';
const MAX_BYTES = 10 * 1024 * 1024;

/** Returns an error message for an unsuitable resume file, or null when it is fine. */
export const validateResumeFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!RESUME_ACCEPT.split(',').includes(ext)) return 'Please select a PDF, Word (.docx, .doc) or text resume.';
    if (file.size > MAX_BYTES) return 'File size must be under 10MB.';
    if (file.size === 0) return 'That file is empty.';
    return null;
};

/**
 * Lets the student either upload a resume or reuse their latest saved version.
 * Reports the choice through onChange({ file, resumeId }); exactly one of them is set.
 */
const ResumeSourcePicker = ({ savedResume, value, onChange, onError, disabled = false, idPrefix = 'resume-source' }) => {
    const hasSaved = Boolean(savedResume?.id);
    const [source, setSource] = useState(hasSaved ? 'saved' : 'upload');
    const [isDragging, setIsDragging] = useState(false);
    const effectiveSource = hasSaved ? source : 'upload';

    const chooseSource = (next) => {
        setSource(next);
        onError?.(null);
        onChange(next === 'saved' ? { file: null, resumeId: savedResume.id } : { file: null, resumeId: null });
    };

    // Report the saved resume as the initial selection once it is known
    React.useEffect(() => {
        if (hasSaved && !value.file && !value.resumeId && effectiveSource === 'saved') {
            onChange({ file: null, resumeId: savedResume.id });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasSaved, savedResume?.id]);

    const handleFile = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const problem = validateResumeFile(file);
        if (problem) {
            onError?.(problem);
            onChange({ file: null, resumeId: null });
            return;
        }
        onError?.(null);
        onChange({ file, resumeId: null });
    };

    return (
        <div className="space-y-3">
            {hasSaved && (
                <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-full sm:w-auto">
                    {[
                        { id: 'saved', icon: History, label: `Saved resume (V${savedResume.version})` },
                        { id: 'upload', icon: Upload, label: 'Upload new' },
                    ].map((o) => (
                        <button
                            key={o.id}
                            type="button"
                            id={`${idPrefix}-${o.id}`}
                            disabled={disabled}
                            onClick={() => chooseSource(o.id)}
                            className={`flex-1 sm:flex-none h-10 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer ${effectiveSource === o.id ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs' : 'text-slate-500 dark:text-slate-400'}`}
                        >
                            <o.icon className="w-3.5 h-3.5" />
                            <span className="truncate">{o.label}</span>
                        </button>
                    ))}
                </div>
            )}

            {effectiveSource === 'saved' ? (
                <div className="flex items-center gap-3 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/20">
                    <FileText className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{savedResume.file_name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Your latest saved resume (version V{savedResume.version})</p>
                    </div>
                </div>
            ) : (
                <div className={`border-2 border-dashed rounded-2xl p-6 text-center relative overflow-hidden transition-all ${isDragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700 hover:border-emerald-500/60 bg-slate-50 dark:bg-slate-900/40'}`}>
                    <input
                        id={`${idPrefix}-file`}
                        type="file"
                        accept={RESUME_ACCEPT}
                        onChange={handleFile}
                        onDragEnter={() => setIsDragging(true)}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={() => setIsDragging(false)}
                        disabled={disabled}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="flex flex-col items-center gap-1.5 pointer-events-none">
                        <FileText className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 break-all">
                            {value.file ? value.file.name : 'Click to select or drag and drop your resume'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">PDF, DOCX, DOC or TXT up to 10MB. Not saved to your account.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResumeSourcePicker;
