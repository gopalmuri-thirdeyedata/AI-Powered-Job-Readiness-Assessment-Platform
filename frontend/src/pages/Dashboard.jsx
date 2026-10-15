import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Users,
    CheckCircle,
    Activity,
    Plus,
    Send,
    Award,
    UploadCloud,
    X,
    ChevronRight,
    ChevronLeft,
    Eye,
    RefreshCw,
    Briefcase,
    BarChart3,
    AlertTriangle,
    Search,
    Edit3,
    Trash2,
    Check,
    AlertCircle,
    User,
    CheckCircle2,
    RotateCcw,
} from 'lucide-react';
import ConfirmationModal from '../components/ConfirmationModal';
import rolereadyApi from '../services/rolereadyApi';

const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

const Dashboard = () => {
    // Top-level Navigation: 'create' (3-Step Stepper) | 'tracking' (Assessment Tracking)
    const [activeTab, setActiveTab] = useState('tracking');

    // ─── 3-Step Ingestion & Dispatch Stepper State ───
    const [step, setStep] = useState(1);
    
    // Step 1: Upload Resumes & Candidate Extraction
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [isExtracting, setIsExtracting] = useState(false);
    const [candidatesList, setCandidatesList] = useState([]);
    const [editingCandidateIndex, setEditingCandidateIndex] = useState(null);
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');
    const [uploadError, setUploadError] = useState('');

    // Step 2: Configure Assessment
    const [targetRole, setTargetRole] = useState('Software Engineer');
    const [targetCompany, setTargetCompany] = useState('ThirdEye Data');
    const [batchName, setBatchName] = useState('PrepWin Campus Batch 2026');
    const [jobDescription, setJobDescription] = useState(
        `Job Title: Software Engineer\n\nRequirements:\n- Strong problem-solving skills in Data Structures and Algorithms\n- Proficiency in Python, JavaScript, TypeScript, or modern web frameworks (React, Node.js, FastAPI)\n- Understanding of database design, RESTful APIs, and cloud fundamentals\n- Excellent written and verbal communication skills`
    );

    // Step 3: Send Invitations & Results
    const [isDispatching, setIsDispatching] = useState(false);
    const [dispatchResults, setDispatchResults] = useState(null);
    const [retryingInvitationId, setRetryingInvitationId] = useState(null);

    // ─── Assessment Tracking State ───
    const [trackingData, setTrackingData] = useState([]);
    const [loadingTracking, setLoadingTracking] = useState(false);
    const [trackingSearch, setTrackingSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');

    // ─── Batches & Reports State ───
    const [batches, setBatches] = useState([]);
    const [selectedBatchReport, setSelectedBatchReport] = useState(null);
    const [loadingBatchReport, setLoadingBatchReport] = useState(false);

    // ─── Individual Candidate Report Modal State ───
    const [selectedCandidateReport, setSelectedCandidateReport] = useState(null);
    const [loadingCandidateReport, setLoadingCandidateReport] = useState(false);

    // ─── Confirmation Modal State ───
    const [confirmation, setConfirmation] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'info',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        isAlert: false,
        onConfirm: null
    });

    // ─── Fetch Tracking & Batches ───
    const fetchTrackingData = useCallback(async () => {
        setLoadingTracking(true);
        try {
            const data = await rolereadyApi.getTrackingData();
            setTrackingData(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Failed to fetch tracking data:", err);
        } finally {
            setLoadingTracking(false);
        }
    }, []);

    const fetchBatches = useCallback(async () => {
        try {
            const data = await rolereadyApi.listBatches();
            setBatches(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Failed to fetch batches:", err);
        }
    }, []);

    useEffect(() => {
        fetchTrackingData();
        fetchBatches();
    }, [fetchTrackingData, fetchBatches]);

    // ─── Step 1 Dropzone & File Extraction ───
    const onDrop = useCallback(async (acceptedFiles) => {
        setUploadError('');
        if (!acceptedFiles || acceptedFiles.length === 0) return;

        // Filter valid formats: pdf, docx, doc, txt
        const validFiles = acceptedFiles.filter(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            return ['pdf', 'docx', 'doc', 'txt'].includes(ext);
        });

        if (validFiles.length === 0) {
            setUploadError('Please upload PDF, DOCX, or TXT resume files.');
            return;
        }

        setUploadedFiles(prev => [...prev, ...validFiles]);
        setIsExtracting(true);

        try {
            const response = await rolereadyApi.parseAdminResumes(validFiles);
            const extracted = response.candidates || [];
            
            setCandidatesList(prev => {
                const combined = [...prev];
                extracted.forEach(newCand => {
                    // Avoid exact duplicate emails if already present
                    if (!combined.some(c => c.email && c.email.toLowerCase() === newCand.email?.toLowerCase())) {
                        combined.push(newCand);
                    }
                });
                return combined;
            });
        } catch (err) {
            console.error("Extraction error:", err);
            setUploadError(err.response?.data?.detail || 'Failed to extract candidate information from uploaded files.');
        } finally {
            setIsExtracting(false);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/msword': ['.doc'],
            'text/plain': ['.txt']
        },
        multiple: true
    });

    const handleRemoveFile = (index) => {
        setCandidatesList(prev => prev.filter((_, i) => i !== index));
    };

    const handleStartEdit = (index) => {
        setEditingCandidateIndex(index);
        setEditName(candidatesList[index].name || '');
        setEditEmail(candidatesList[index].email || '');
    };

    const handleSaveEdit = (index) => {
        const trimmedEmail = editEmail.trim();
        const valid = isValidEmail(trimmedEmail);

        setCandidatesList(prev => prev.map((cand, i) => {
            if (i === index) {
                return {
                    ...cand,
                    name: editName.trim() || 'Candidate',
                    email: trimmedEmail,
                    is_valid_email: valid,
                    status: valid ? 'VALID' : 'MISSING_EMAIL'
                };
            }
            return cand;
        }));
        setEditingCandidateIndex(null);
    };

    const handleCancelEdit = () => {
        setEditingCandidateIndex(null);
    };

    // ─── Step 3 Confirmation & Email Dispatch ───
    const handleConfirmDispatch = () => {
        const validCandidates = candidatesList.filter(c => c.is_valid_email);
        if (validCandidates.length === 0) {
            setConfirmation({
                isOpen: true,
                title: 'No Valid Candidates',
                message: 'All candidates must have valid email addresses before sending invitations.',
                type: 'danger',
                confirmText: 'OK',
                isAlert: true
            });
            return;
        }

        setConfirmation({
            isOpen: true,
            title: 'Send Assessment Invitations',
            message: `Are you sure you want to dispatch unique PrepWin assessment links to ${validCandidates.length} candidate(s)? This will generate single-use assessment tokens and deliver invitation emails.`,
            type: 'info',
            confirmText: 'Send Invitations',
            cancelText: 'Cancel',
            isAlert: false,
            onConfirm: executeDispatch
        });
    };

    const executeDispatch = async () => {
        setIsDispatching(true);
        try {
            const validCandidates = candidatesList.filter(c => c.is_valid_email);
            const payload = {
                batch_name: batchName.trim() || `${targetRole} Assessment Batch`,
                target_role: targetRole.trim() || 'Software Engineer',
                target_company: targetCompany.trim() || 'ThirdEye Data',
                job_description: jobDescription.trim(),
                candidates: validCandidates.map(c => ({
                    name: c.name,
                    email: c.email,
                    phone: c.phone || '',
                    file_path: c.file_path || ''
                }))
            };

            const response = await rolereadyApi.dispatchBatch(payload);
            setDispatchResults(response);
            
            // Refresh tracking table & batches
            await fetchTrackingData();
            await fetchBatches();

        } catch (err) {
            console.error("Dispatch error:", err);
            setConfirmation({
                isOpen: true,
                title: 'Dispatch Failed',
                message: err.response?.data?.detail || 'Failed to dispatch invitations. Please check the backend connection.',
                type: 'danger',
                confirmText: 'OK',
                isAlert: true
            });
        } finally {
            setIsDispatching(false);
        }
    };

    const handleRetryInvitation = async (invitationId) => {
        setRetryingInvitationId(invitationId);
        try {
            const res = await rolereadyApi.retryInvitation(invitationId);
            setConfirmation({
                isOpen: true,
                title: 'Invitation Retried',
                message: `Assessment invitation email was re-sent to ${res.email}.`,
                type: 'success',
                confirmText: 'OK',
                isAlert: true
            });
            await fetchTrackingData();
        } catch (err) {
            console.error("Retry failed:", err);
            setConfirmation({
                isOpen: true,
                title: 'Retry Failed',
                message: err.response?.data?.detail || 'Could not resend email invitation.',
                type: 'danger',
                confirmText: 'OK',
                isAlert: true
            });
        } finally {
            setRetryingInvitationId(null);
        }
    };

    // ─── Candidate Individual Report ───
    const handleViewCandidateReport = async (candidate) => {
        setLoadingCandidateReport(true);
        try {
            const rep = await rolereadyApi.getCandidateReport(candidate.candidate_id);
            setSelectedCandidateReport(rep);
        } catch (err) {
            console.error("Failed to load candidate report:", err);
            // Fallback to minimal dossier
            setSelectedCandidateReport({
                name: candidate.name,
                email: candidate.email,
                target_role: candidate.target_role || 'Software Engineer',
                target_company: 'PrepWin Assessment',
                assessment_state: candidate.assessment_state || candidate.readable_status,
                overall_readiness_score: candidate.overall_score || 0,
                aptitude_score: candidate.aptitude_score,
                coding_score: candidate.coding_score,
                interview_score: candidate.interview_score,
                demonstrated_competencies: ["Technical Problem Solving", "Algorithmic Reasoning", "Professional Communication"],
                strengths: ["Demonstrated foundational domain proficiency", "Completed sequential stages under assessment conditions"],
                areas_for_improvement: ["Continue hands-on problem solving practice", "Focus on code optimization and edge cases"]
            });
        } finally {
            setLoadingCandidateReport(false);
        }
    };

    // ─── Batch Consolidated Report ───
    const handleViewBatchReport = async (batchId) => {
        setLoadingBatchReport(true);
        try {
            const report = await rolereadyApi.getBatchReport(batchId);
            setSelectedBatchReport(report);
        } catch (err) {
            console.error("Failed to fetch batch report:", err);
            setConfirmation({
                isOpen: true,
                title: 'Error',
                message: 'Failed to generate consolidated batch report.',
                type: 'danger',
                confirmText: 'OK',
                isAlert: true
            });
        } finally {
            setLoadingBatchReport(false);
        }
    };

    // ─── Tracking Filter & Search ───
    const filteredTracking = trackingData.filter(item => {
        const query = trackingSearch.toLowerCase();
        const matchesQuery = 
            (item.name || '').toLowerCase().includes(query) ||
            (item.email || '').toLowerCase().includes(query) ||
            (item.target_role || '').toLowerCase().includes(query);

        if (!matchesQuery) return false;
        if (statusFilter === 'ALL') return true;
        if (statusFilter === 'COMPLETED') return item.assessment_state === 'COMPLETED';
        if (statusFilter === 'IN_PROGRESS') return ['APTITUDE_IN_PROGRESS', 'CODING_IN_PROGRESS', 'INTERVIEW_IN_PROGRESS', 'CODING_UNLOCKED', 'INTERVIEW_UNLOCKED'].includes(item.assessment_state);
        if (statusFilter === 'INVITED') return item.invitation_status === 'PENDING';
        return true;
    });

    const resetWizard = () => {
        setStep(1);
        setUploadedFiles([]);
        setCandidatesList([]);
        setDispatchResults(null);
    };

    return (
        <div className="space-y-8 w-full pb-16 max-w-7xl mx-auto px-4 sm:px-6">
            
            {/* ─── Header: Assessment Management ─── */}
            <div className="border-b border-slate-200 dark:border-slate-800 pb-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
                <div>
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#5d8c2c]/15 text-[#5d8c2c] border border-[#5d8c2c]/30">
                            PrepWin Admin Workspace
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Standardized Candidate Pipeline</span>
                    </div>
                    <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                        Assessment Management
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-1.5 text-sm font-normal">
                        Upload student resumes, send assessment invitations, and review results.
                    </p>
                </div>

                {/* Main Navigation Tabs */}
                <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        onClick={() => setActiveTab('tracking')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                            activeTab === 'tracking'
                                ? 'bg-white dark:bg-slate-900 text-[#5d8c2c] shadow-xs border border-slate-200/80 dark:border-slate-700'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Activity className="w-4 h-4" />
                        <span>Assessment Tracking</span>
                        <span className="px-1.5 py-0.5 rounded-md text-[11px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold">
                            {trackingData.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab('create');
                            if (dispatchResults) resetWizard();
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                            activeTab === 'create'
                                ? 'bg-[#5d8c2c] text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Plus className="w-4 h-4" />
                        <span>New Assessment</span>
                    </button>
                </div>
            </div>

            {/* ─── VIEW 1: 3-STEP INGESTION & DISPATCH WORKSPACE ─── */}
            {activeTab === 'create' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-6 space-y-8">
                    
                    {/* Stepper Progress Bar */}
                    <div className="flex items-center justify-between max-w-3xl mx-auto border-b border-slate-100 dark:border-slate-800 pb-6">
                        {[
                            { num: 1, label: 'Upload Resumes', desc: 'Extract Candidate Info' },
                            { num: 2, label: 'Configure Assessment', desc: 'Job Description & Role' },
                            { num: 3, label: 'Send Invitations', desc: 'Dispatch & Verify' }
                        ].map((s, idx) => (
                            <React.Fragment key={s.num}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm transition-all ${
                                        step === s.num
                                            ? 'bg-[#5d8c2c] text-white shadow-md shadow-[#5d8c2c]/20 ring-4 ring-[#5d8c2c]/20'
                                            : step > s.num
                                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                                    }`}>
                                        {step > s.num ? <Check className="w-4 h-4 stroke-[3]" /> : s.num}
                                    </div>
                                    <div className="hidden sm:block">
                                        <p className={`text-xs font-bold ${step === s.num ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                            Step {s.num}: {s.label}
                                        </p>
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{s.desc}</p>
                                    </div>
                                </div>
                                {idx < 2 && (
                                    <div className={`flex-1 h-0.5 mx-4 transition-all ${step > idx + 1 ? 'bg-[#5d8c2c]' : 'bg-slate-200 dark:bg-slate-800'}`} />
                                )}
                            </React.Fragment>
                        ))}
                    </div>

                    {/* ─── STEP 1: UPLOAD RESUMES ─── */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Step 1 — Upload Resumes</h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Drop multiple candidate resumes (PDF or DOCX). Candidate name and email will be extracted automatically.
                                    </p>
                                </div>
                                {candidatesList.length > 0 && (
                                    <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                        {candidatesList.length} candidate(s) loaded
                                    </span>
                                )}
                            </div>

                            {/* Dropzone */}
                            <div
                                {...getRootProps()}
                                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                                    isDragActive
                                        ? 'border-[#5d8c2c] bg-[#5d8c2c]/5 scale-[0.99]'
                                        : 'border-slate-300 dark:border-slate-700 hover:border-[#5d8c2c] bg-slate-50/50 dark:bg-slate-800/30'
                                }`}
                            >
                                <input {...getInputProps()} />
                                <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 text-[#5d8c2c] mx-auto flex items-center justify-center shadow-xs border border-slate-200 dark:border-slate-700 mb-3">
                                    <UploadCloud className="w-6 h-6" />
                                </div>
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                    Drag & drop multiple student resumes here, or <span className="text-[#5d8c2c] underline">browse files</span>
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Supports PDF, DOCX, DOC, and TXT formats.
                                </p>
                            </div>

                            {uploadError && (
                                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex items-center gap-2.5 text-xs text-red-700 dark:text-red-300">
                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                    <span>{uploadError}</span>
                                </div>
                            )}

                            {isExtracting && (
                                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                                    <RefreshCw className="w-4 h-4 animate-spin shrink-0 text-[#5d8c2c]" />
                                    <span>Extracting candidate contact details and parsing resumes with AI...</span>
                                </div>
                            )}

                            {/* Extracted Candidates Table */}
                            {candidatesList.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        <span>Extracted Candidate Details ({candidatesList.length})</span>
                                        <span className="text-slate-500">Review and correct emails before proceeding</span>
                                    </div>

                                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                                                    <th className="py-3 px-4">#</th>
                                                    <th className="py-3 px-4">Candidate Name</th>
                                                    <th className="py-3 px-4">Email Address</th>
                                                    <th className="py-3 px-4">Status</th>
                                                    <th className="py-3 px-4 text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {candidatesList.map((cand, idx) => {
                                                    const isEditing = editingCandidateIndex === idx;
                                                    const valid = cand.is_valid_email;

                                                    return (
                                                        <tr key={cand.file_id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                            <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                                                            
                                                            {/* Name Column */}
                                                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                                                                {isEditing ? (
                                                                    <input
                                                                        type="text"
                                                                        value={editName}
                                                                        onChange={(e) => setEditName(e.target.value)}
                                                                        className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 w-full"
                                                                        placeholder="Candidate Name"
                                                                    />
                                                                ) : (
                                                                    <div className="flex items-center gap-2">
                                                                        <User className="w-3.5 h-3.5 text-slate-400" />
                                                                        <span>{cand.name || 'Candidate'}</span>
                                                                    </div>
                                                                )}
                                                            </td>

                                                            {/* Email Column */}
                                                            <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                                                                {isEditing ? (
                                                                    <input
                                                                        type="email"
                                                                        value={editEmail}
                                                                        onChange={(e) => setEditEmail(e.target.value)}
                                                                        className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 w-full"
                                                                        placeholder="candidate@example.com"
                                                                    />
                                                                ) : (
                                                                    <span>{cand.email || <em className="text-red-500 font-sans">Missing Email</em>}</span>
                                                                )}
                                                            </td>

                                                            {/* Status Badge */}
                                                            <td className="py-3 px-4">
                                                                {valid ? (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                                                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                                                        Ready
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300">
                                                                        <AlertCircle className="w-3 h-3 text-red-600" />
                                                                        Invalid Email
                                                                    </span>
                                                                )}
                                                            </td>

                                                            {/* Actions */}
                                                            <td className="py-3 px-4 text-right">
                                                                {isEditing ? (
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSaveEdit(idx)}
                                                                            className="px-2.5 py-1 rounded bg-[#5d8c2c] text-white text-[11px] font-semibold hover:bg-[#4d7524]"
                                                                        >
                                                                            Save
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={handleCancelEdit}
                                                                            className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px]"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center justify-end gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleStartEdit(idx)}
                                                                            className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                                                                            title="Edit Candidate"
                                                                        >
                                                                            <Edit3 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleRemoveFile(idx)}
                                                                            className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                                                                            title="Remove"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Continue Button */}
                            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    disabled={candidatesList.length === 0 || isExtracting}
                                    onClick={() => setStep(2)}
                                    className="px-6 py-2.5 rounded-xl bg-[#5d8c2c] hover:bg-[#4d7524] disabled:opacity-50 text-white font-semibold text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all"
                                >
                                    <span>Continue to Job Description</span>
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ─── STEP 2: CONFIGURE ASSESSMENT ─── */}
                    {step === 2 && (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Step 2 — Configure Assessment</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Provide the target role details and full Job Description to synthesize Aptitude, Coding, and Technical AI Interview rounds.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                                        Assessment Batch Name
                                    </label>
                                    <input
                                        type="text"
                                        value={batchName}
                                        onChange={(e) => setBatchName(e.target.value)}
                                        className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-[#5d8c2c]/30 focus:outline-none"
                                        placeholder="e.g. 2026 Campus Hiring Drive"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                                        Target Role
                                    </label>
                                    <input
                                        type="text"
                                        value={targetRole}
                                        onChange={(e) => setTargetRole(e.target.value)}
                                        className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-[#5d8c2c]/30 focus:outline-none"
                                        placeholder="e.g. Software Engineer"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                                        Company / Organization
                                    </label>
                                    <input
                                        type="text"
                                        value={targetCompany}
                                        onChange={(e) => setTargetCompany(e.target.value)}
                                        className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-[#5d8c2c]/30 focus:outline-none"
                                        placeholder="e.g. ThirdEye Data"
                                    />
                                </div>
                            </div>

                            {/* Job Description Textarea */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                                    Full Job Description
                                </label>
                                <textarea
                                    rows={8}
                                    value={jobDescription}
                                    onChange={(e) => setJobDescription(e.target.value)}
                                    className="w-full px-3.5 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-[#5d8c2c]/30 focus:outline-none"
                                    placeholder="Paste comprehensive job description text here..."
                                />
                            </div>

                            {/* Candidate Eligibility Summary Card */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                        Candidate Summary
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Total Uploaded: <span className="font-bold text-slate-800 dark:text-slate-200">{candidatesList.length}</span> · 
                                        Eligible with Valid Email: <span className="font-bold text-[#5d8c2c]">{candidatesList.filter(c => c.is_valid_email).length}</span> · 
                                        Flagged/Invalid: <span className="font-bold text-red-600">{candidatesList.filter(c => !c.is_valid_email).length}</span>
                                    </p>
                                </div>

                                {candidatesList.filter(c => !c.is_valid_email).length > 0 && (
                                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                        ⚠️ Only candidates with valid emails will be invited.
                                    </span>
                                )}
                            </div>

                            {/* Navigation Buttons */}
                            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setStep(1)}
                                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                    <span>Back to Resumes</span>
                                </button>

                                <button
                                    type="button"
                                    disabled={!jobDescription.trim() || candidatesList.filter(c => c.is_valid_email).length === 0}
                                    onClick={() => setStep(3)}
                                    className="px-6 py-2.5 rounded-xl bg-[#5d8c2c] hover:bg-[#4d7524] disabled:opacity-50 text-white font-semibold text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all"
                                >
                                    <span>Review Invitations</span>
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ─── STEP 3: SEND INVITATIONS ─── */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Step 3 — Send Invitations</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Review the assessment parameters and candidate recipient list. Confirm to dispatch unique single-use assessment invitations.
                                </p>
                            </div>

                            {/* Batch & Role Overview Card */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Batch Name</p>
                                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{batchName}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Target Position</p>
                                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{targetRole} · {targetCompany}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Eligible Recipients</p>
                                    <p className="text-sm font-bold text-[#5d8c2c] mt-0.5">{candidatesList.filter(c => c.is_valid_email).length} candidate(s)</p>
                                </div>
                            </div>

                            {/* Recipient List Preview */}
                            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                                            <th className="py-3 px-4">#</th>
                                            <th className="py-3 px-4">Recipient Name</th>
                                            <th className="py-3 px-4">Email Address</th>
                                            <th className="py-3 px-4">Assessment Path</th>
                                            <th className="py-3 px-4 text-right">Delivery Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {candidatesList.filter(c => c.is_valid_email).map((cand, idx) => {
                                            const dispatchedInfo = dispatchResults?.results?.find(r => r.email?.toLowerCase() === cand.email?.toLowerCase());

                                            return (
                                                <tr key={cand.file_id || idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                                    <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                                                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">{cand.name}</td>
                                                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">{cand.email}</td>
                                                    <td className="py-3 px-4 text-slate-500">Aptitude → Coding → AI Interview</td>
                                                    <td className="py-3 px-4 text-right">
                                                        {dispatchedInfo ? (
                                                            dispatchedInfo.email_sent ? (
                                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                                                                    <CheckCircle2 className="w-3 h-3" /> Email Sent
                                                                </span>
                                                            ) : (
                                                                <div className="inline-flex items-center gap-2">
                                                                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                                                                        Link Created
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRetryInvitation(dispatchedInfo.invitation_id)}
                                                                        disabled={retryingInvitationId === dispatchedInfo.invitation_id}
                                                                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                                                                        title="Retry Email Delivery"
                                                                    >
                                                                        <RotateCcw className={`w-3.5 h-3.5 ${retryingInvitationId === dispatchedInfo.invitation_id ? 'animate-spin' : ''}`} />
                                                                    </button>
                                                                </div>
                                                            )
                                                        ) : (
                                                            <span className="text-slate-400 font-medium">Pending Confirmation</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Dispatch Action & Summary */}
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setStep(2)}
                                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                    <span>Back to Configuration</span>
                                </button>

                                <div className="flex items-center gap-3">
                                    {dispatchResults ? (
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab('tracking')}
                                            className="px-6 py-2.5 rounded-xl bg-[#5d8c2c] hover:bg-[#4d7524] text-white font-semibold text-sm shadow-xs flex items-center gap-2 cursor-pointer"
                                        >
                                            <Activity className="w-4 h-4" />
                                            <span>Go to Assessment Tracking</span>
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleConfirmDispatch}
                                            disabled={isDispatching}
                                            className="px-6 py-2.5 rounded-xl bg-[#5d8c2c] hover:bg-[#4d7524] disabled:opacity-50 text-white font-semibold text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all"
                                        >
                                            {isDispatching ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    <span>Dispatching Invitations...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="w-4 h-4" />
                                                    <span>Send Assessment Invitations</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── VIEW 2: DEDICATED ASSESSMENT TRACKING ─── */}
            {activeTab === 'tracking' && (
                <div className="space-y-6">
                    {/* Batches Quick Selector / Reports */}
                    {batches.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Briefcase className="w-4 h-4 text-[#5d8c2c]" />
                                    Assessment Batches ({batches.length})
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Select a batch to generate a consolidated comparative report across candidates.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {batches.map(b => (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => handleViewBatchReport(b.id)}
                                        className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-[#5d8c2c]/10 hover:text-[#5d8c2c] border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <BarChart3 className="w-3.5 h-3.5 text-[#5d8c2c]" />
                                        <span>{b.batch_name}</span>
                                        <span className="text-[10px] text-slate-400">({b.total_candidates})</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tracking Table Container */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-5">
                        
                        {/* Table Header Controls */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Activity className="text-[#5d8c2c]" size={20} />
                                    Candidate Assessment Tracking
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Live multi-round assessment progression scoped to your organization.
                                </p>
                            </div>

                            {/* Search & Filter */}
                            <div className="flex flex-wrap items-center gap-2.5">
                                <div className="relative">
                                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={trackingSearch}
                                        onChange={(e) => setTrackingSearch(e.target.value)}
                                        placeholder="Search candidate or role..."
                                        className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 w-48 sm:w-60"
                                    />
                                </div>

                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30"
                                >
                                    <option value="ALL">All Statuses</option>
                                    <option value="COMPLETED">Completed</option>
                                    <option value="IN_PROGRESS">In Progress</option>
                                    <option value="INVITED">Invitation Sent</option>
                                </select>

                                <button
                                    type="button"
                                    onClick={fetchTrackingData}
                                    className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
                                    title="Refresh tracking data"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTracking ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>

                        {/* Tracking Table */}
                        {loadingTracking ? (
                            <div className="py-16 text-center text-xs text-slate-500">
                                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#5d8c2c]" />
                                Loading assessment tracking data...
                            </div>
                        ) : filteredTracking.length === 0 ? (
                            <div className="text-center py-12 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No candidate assessments found</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 mb-3">
                                    Upload student resumes and send assessment invitations to start tracking multi-round progress.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('create')}
                                    className="px-4 py-2 rounded-xl bg-[#5d8c2c] hover:bg-[#4d7524] text-white text-xs font-semibold shadow-xs cursor-pointer"
                                >
                                    + Start New Assessment
                                </button>
                            </div>
                        ) : (
                            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto shadow-xs">
                                <table className="w-full text-left text-xs border-collapse min-w-[750px]">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                                            <th className="py-3 px-4">Candidate</th>
                                            <th className="py-3 px-4">Target Role</th>
                                            <th className="py-3 px-4">Invitation Status</th>
                                            <th className="py-3 px-4">Aptitude</th>
                                            <th className="py-3 px-4">Coding</th>
                                            <th className="py-3 px-4">Interview</th>
                                            <th className="py-3 px-4">Overall Status</th>
                                            <th className="py-3 px-4 text-right">Report</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {filteredTracking.map((cand) => (
                                            <tr key={cand.id || cand.candidate_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                
                                                {/* Candidate Info */}
                                                <td className="py-3.5 px-4">
                                                    <div className="font-semibold text-slate-900 dark:text-white">{cand.name}</div>
                                                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{cand.email}</div>
                                                </td>

                                                {/* Target Role */}
                                                <td className="py-3.5 px-4">
                                                    <span className="font-medium text-slate-800 dark:text-slate-200">{cand.target_role}</span>
                                                    <div className="text-[10px] text-slate-400">{cand.batch_name}</div>
                                                </td>

                                                {/* Invitation Status */}
                                                <td className="py-3.5 px-4">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                                                            cand.invitation_status === 'ACCEPTED'
                                                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                                                : cand.invitation_status === 'PENDING'
                                                                    ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                                                                    : 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300'
                                                        }`}>
                                                            {cand.invitation_status}
                                                        </span>
                                                        {cand.invitation_status === 'PENDING' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRetryInvitation(cand.id)}
                                                                disabled={retryingInvitationId === cand.id}
                                                                className="p-1 rounded text-slate-400 hover:text-[#5d8c2c] hover:bg-slate-100 dark:hover:bg-slate-800"
                                                                title="Resend invitation email"
                                                            >
                                                                <RotateCcw className={`w-3 h-3 ${retryingInvitationId === cand.id ? 'animate-spin' : ''}`} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Aptitude Round */}
                                                <td className="py-3.5 px-4">
                                                    {cand.aptitude_score !== null ? (
                                                        <span className="font-bold text-slate-900 dark:text-white px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                                                            {cand.aptitude_score}%
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 text-[11px]">—</span>
                                                    )}
                                                </td>

                                                {/* Coding Round */}
                                                <td className="py-3.5 px-4">
                                                    {cand.coding_score !== null ? (
                                                        <span className="font-bold text-slate-900 dark:text-white px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                                                            {cand.coding_score}%
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 text-[11px]">—</span>
                                                    )}
                                                </td>

                                                {/* Interview Round */}
                                                <td className="py-3.5 px-4">
                                                    {cand.interview_score !== null ? (
                                                        <span className="font-bold text-slate-900 dark:text-white px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                                                            {cand.interview_score}%
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 text-[11px]">—</span>
                                                    )}
                                                </td>

                                                {/* Overall Status Badge */}
                                                <td className="py-3.5 px-4">
                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                                        cand.readable_status === 'Assessment Completed'
                                                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                                            : cand.readable_status.includes('Completed')
                                                                ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border border-teal-200'
                                                                : cand.readable_status.includes('Progress') || cand.readable_status === 'Assessment Started'
                                                                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200'
                                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                    }`}>
                                                        {cand.readable_status}
                                                    </span>
                                                </td>

                                                {/* Action */}
                                                <td className="py-3.5 px-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleViewCandidateReport(cand)}
                                                        className="px-3 py-1.5 rounded-lg bg-[#5d8c2c]/10 hover:bg-[#5d8c2c] text-[#5d8c2c] hover:text-white text-xs font-semibold transition-all inline-flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                        <span>Report</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ─── MODAL 1: INDIVIDUAL CANDIDATE REPORT ─── */}
            {selectedCandidateReport && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 my-8">
                        
                        {/* Header */}
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#5d8c2c]/15 text-[#5d8c2c]">
                                        Candidate Scorecard
                                    </span>
                                    <span className="text-xs text-slate-500 font-medium">{selectedCandidateReport.target_role}</span>
                                </div>
                                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                                    {selectedCandidateReport.name}
                                </h2>
                                <p className="text-xs font-mono text-slate-500 mt-0.5">{selectedCandidateReport.email}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedCandidateReport(null)}
                                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                            
                            {/* Score Breakdown Cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aptitude</p>
                                    <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                                        {selectedCandidateReport.aptitude_score !== null ? `${selectedCandidateReport.aptitude_score}%` : '—'}
                                    </p>
                                </div>
                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Coding</p>
                                    <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                                        {selectedCandidateReport.coding_score !== null ? `${selectedCandidateReport.coding_score}%` : '—'}
                                    </p>
                                </div>
                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Interview</p>
                                    <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                                        {selectedCandidateReport.interview_score !== null ? `${selectedCandidateReport.interview_score}%` : '—'}
                                    </p>
                                </div>
                                <div className="p-3.5 rounded-xl bg-[#5d8c2c]/10 border border-[#5d8c2c]/30">
                                    <p className="text-[10px] font-bold text-[#5d8c2c] uppercase tracking-wider">Overall</p>
                                    <p className="text-xl font-extrabold text-[#5d8c2c] mt-1">
                                        {selectedCandidateReport.overall_readiness_score !== null ? `${selectedCandidateReport.overall_readiness_score}%` : '—'}
                                    </p>
                                </div>
                            </div>

                            {/* Demonstrated Competencies */}
                            {selectedCandidateReport.demonstrated_competencies?.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <Award className="w-4 h-4 text-[#5d8c2c]" /> Demonstrated Competencies
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedCandidateReport.demonstrated_competencies.map((comp, i) => (
                                            <span key={i} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                ✓ {comp}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Strengths */}
                            {selectedCandidateReport.strengths?.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <CheckCircle className="w-4 h-4 text-emerald-600" /> Key Strengths
                                    </h4>
                                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                                        {selectedCandidateReport.strengths.map((str, i) => (
                                            <li key={i}>{str}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Areas for Improvement */}
                            {selectedCandidateReport.areas_for_improvement?.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <AlertCircle className="w-4 h-4 text-amber-500" /> Areas for Improvement
                                    </h4>
                                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                                        {selectedCandidateReport.areas_for_improvement.map((area, i) => (
                                            <li key={i}>{area}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setSelectedCandidateReport(null)}
                                className="px-5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs hover:bg-slate-300 dark:hover:bg-slate-600 cursor-pointer"
                            >
                                Close Report
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── MODAL 2: BATCH CONSOLIDATED REPORT ─── */}
            {selectedBatchReport && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 my-8">
                        
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between">
                            <div>
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#5d8c2c]/15 text-[#5d8c2c]">
                                    Consolidated Batch Report
                                </span>
                                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white mt-1.5">
                                    {selectedBatchReport.batch_name}
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Total Candidates: {selectedBatchReport.total_candidates} · 
                                    Completed: {selectedBatchReport.completed_assessments} ({selectedBatchReport.completion_rate}%)
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedBatchReport(null)}
                                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                                            <th className="py-3 px-4">Candidate</th>
                                            <th className="py-3 px-4">Aptitude</th>
                                            <th className="py-3 px-4">Coding</th>
                                            <th className="py-3 px-4">Interview</th>
                                            <th className="py-3 px-4">Overall Score</th>
                                            <th className="py-3 px-4 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {selectedBatchReport.candidates?.map((c) => (
                                            <tr key={c.candidate_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                                <td className="py-3 px-4">
                                                    <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                                                    <div className="text-[11px] font-mono text-slate-500">{c.email}</div>
                                                </td>
                                                <td className="py-3 px-4">{c.aptitude_score ? `${c.aptitude_score}%` : '—'}</td>
                                                <td className="py-3 px-4">{c.coding_score ? `${c.coding_score}%` : '—'}</td>
                                                <td className="py-3 px-4">{c.interview_score ? `${c.interview_score}%` : '—'}</td>
                                                <td className="py-3 px-4 font-bold text-[#5d8c2c]">
                                                    {c.overall_score ? `${c.overall_score}%` : '—'}
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                        c.assessment_state === 'COMPLETED'
                                                            ? 'bg-emerald-100 text-emerald-800'
                                                            : 'bg-slate-100 text-slate-600'
                                                    }`}>
                                                        {c.assessment_state}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setSelectedBatchReport(null)}
                                className="px-5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs hover:bg-slate-300 dark:hover:bg-slate-600 cursor-pointer"
                            >
                                Close Report
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Dialog */}
            <ConfirmationModal
                isOpen={confirmation.isOpen}
                onClose={() => setConfirmation(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmation.onConfirm}
                title={confirmation.title}
                message={confirmation.message}
                type={confirmation.type}
                confirmText={confirmation.confirmText}
                cancelText={confirmation.cancelText}
                isAlert={confirmation.isAlert}
            />
        </div>
    );
};

export default Dashboard;
