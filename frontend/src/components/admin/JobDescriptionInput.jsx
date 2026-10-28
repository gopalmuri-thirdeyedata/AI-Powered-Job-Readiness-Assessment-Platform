import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileText, Loader2, PenLine, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { JD_EXTENSIONS, JD_MAX_BYTES, formatBytes, validateJdFile } from '../../utils/jdUpload';
import { ghostBtn, inputCls, primaryBtn } from './adminUi';

const MODES = [
    { id: 'manual', label: 'Write Manually', icon: PenLine },
    { id: 'upload', label: 'Upload File', icon: UploadCloud },
];

/**
 * Job description input with two ways in: type / paste it, or upload a .pdf / .docx / .txt that is converted to text.
 * Both ways feed ONE controlled value (the text area), so switching modes never loses text and the submitted description is
 * always whatever the admin sees and has reviewed. Nothing is created, generated or published by choosing a file.
 */
const JobDescriptionInput = ({ value, onChange, minChars, initialMode = 'manual' }) => {
    const [mode, setMode] = useState(initialMode);
    const [file, setFile] = useState(null);                 // { name, size }
    const [phase, setPhase] = useState('idle');             // idle | uploading | extracting | done | error
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(null);           // extracted text waiting for "replace what I typed?" confirmation
    const reqRef = useRef(0);
    const abortRef = useRef(null);
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

    const cancelInFlight = () => {
        reqRef.current += 1;
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = null;
    };

    const accept = useCallback(async (picked) => {
        const problem = validateJdFile(picked);
        cancelInFlight();
        setPending(null);
        if (problem) {
            setFile(null);
            setPhase('error');
            setError(problem);
            return;
        }
        const id = reqRef.current;
        const controller = new AbortController();
        abortRef.current = controller;
        setFile({ name: picked.name, size: picked.size });
        setError('');
        setProgress(0);
        setPhase('uploading');
        try {
            const res = await adminApi.extractDescription(picked, {
                signal: controller.signal,
                onUploadProgress: (e) => {
                    if (id !== reqRef.current) return;
                    const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
                    setProgress(pct);
                    if (pct >= 100) setPhase('extracting');
                },
            });
            if (id !== reqRef.current) return;               // removed / replaced meanwhile
            const current = (valueRef.current || '').trim();
            if (current && current !== res.text.trim()) {
                setPending(res.text);                         // never overwrite typed text silently
                setPhase('done');
            } else {
                onChange(res.text);
                setPhase('done');
            }
        } catch (err) {
            if (id !== reqRef.current) return;
            const status = err?.response?.status;
            setPhase('error');
            setError(status === 413 ? 'The file is larger than the 10 MB limit.' : errorMessage(err, 'This document could not be read. Paste the description manually instead.'));
        }
    }, [onChange]);

    const onDrop = useCallback((files) => { if (files && files[0]) accept(files[0]); }, [accept]);
    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop, multiple: false, noClick: true, noKeyboard: true });

    const removeFile = () => {
        cancelInFlight();
        setFile(null);
        setPending(null);
        setError('');
        setPhase('idle');
        setProgress(0);
    };

    const count = (value || '').trim().length;
    const busy = phase === 'uploading' || phase === 'extracting';
    const showText = mode === 'manual' || (value || '').length > 0 || phase === 'done';

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span id="jd-input-label" className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Job description</span>
                <div role="radiogroup" aria-label="Job description input method" className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-950">
                    {MODES.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${mode === id ? 'bg-[#5d8c2c] dark:bg-emerald-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            <Icon size={13} /> {label}
                        </button>
                    ))}
                </div>
            </div>

            {mode === 'upload' && (
                <div className="space-y-2">
                    {!file && (
                        <div
                            {...getRootProps()}
                            className={`rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${isDragActive ? 'border-[#5d8c2c] bg-[#5d8c2c]/5' : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40'}`}
                        >
                            <input {...getInputProps({ 'aria-label': 'Upload job description file', accept: JD_EXTENSIONS.join(',') })} />
                            <UploadCloud size={26} className="mx-auto text-[#5d8c2c]" />
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mt-1.5">Drag and drop a job description here</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">PDF, DOCX or TXT, up to {JD_MAX_BYTES / (1024 * 1024)} MB</p>
                            <button type="button" className={`${primaryBtn} mt-3`} onClick={open}><UploadCloud size={14} /> Choose file</button>
                        </div>
                    )}

                    {file && (
                        <div {...getRootProps()} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-3">
                            <input {...getInputProps({ 'aria-label': 'Replace job description file', accept: JD_EXTENSIONS.join(',') })} />
                            <div className="flex items-center gap-2.5 min-w-0">
                                <FileText size={18} className="text-[#5d8c2c] shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate" title={file.name}>{file.name}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                                        {formatBytes(file.size)}
                                        {phase === 'uploading' && ` · Uploading ${progress}%`}
                                        {phase === 'extracting' && ' · Extracting text…'}
                                        {phase === 'done' && !pending && ' · Text extracted — review it below'}
                                        {phase === 'error' && ' · Could not be read'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {busy && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Loader2 size={14} className="animate-spin" /> Working…</span>}
                                <button type="button" className={ghostBtn} onClick={open}><RefreshCw size={14} /> Replace</button>
                                <button type="button" className={ghostBtn} onClick={removeFile}><Trash2 size={14} /> Remove</button>
                            </div>
                        </div>
                    )}

                    {phase === 'error' && error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
                    {!file && phase !== 'error' && (value || '').length === 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">The text is extracted into an editable box so you can review it before creating the job role.</p>
                    )}

                    {pending !== null && (
                        <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200" role="alert">
                            <p className="font-semibold">Replace the description you already entered ({count.toLocaleString()} characters) with the text from this file ({pending.trim().length.toLocaleString()} characters)?</p>
                            <div className="flex gap-2 mt-2.5">
                                <button type="button" className={primaryBtn} onClick={() => { onChange(pending); setPending(null); }}>Replace with file text</button>
                                <button type="button" className={ghostBtn} onClick={removeFile}>Keep my text</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {showText && (
                <label className="block">
                    <span className="sr-only">Job description text</span>
                    <textarea
                        className={`${inputCls} leading-6 resize-y`} rows={mode === 'upload' ? 10 : 6} value={value} aria-labelledby="jd-input-label"
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Paste the full job description: responsibilities, required technologies, seniority..."
                    />
                </label>
            )}
            <span className={`block text-xs ${count < minChars ? 'text-slate-500 dark:text-slate-400' : 'text-[#4c7324] dark:text-[#9fd05a]'}`}>{count} characters (minimum {minChars})</span>
        </div>
    );
};

export default JobDescriptionInput;
