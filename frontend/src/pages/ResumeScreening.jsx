import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Upload, FileText, Brain, Loader2, CheckCircle, AlertCircle,
    Filter, ChevronRight, X, Sparkles, ChevronDown, ChevronUp,
    Search, Play, Minus, ArrowRight, FolderOpen, FilePlus, Cloud, HardDrive,
    Layers, Edit3, Bookmark, Check, Files, Target, Plus, Tag, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import API_URL from '../apiConfig';
import StructuredJobDescriptionEditor from '../components/StructuredJobDescriptionEditor';
import ConfirmationModal from '../components/ConfirmationModal';

// --- Processing Overlay Component with Multi-Resume Animation ---
const ProcessingStatus = ({ files = [], currentFileIndex = 0, currentFile, stage }) => {
    const stages = [
        { id: 'parsing', label: 'Parsing Resume Structure', icon: FileText },
        { id: 'extracting', label: 'Extracting Skills & Experience', icon: Brain },
        { id: 'matching', label: 'Matching with Job Description', icon: Search },
        { id: 'scoring', label: 'Calculating Match Score', icon: Sparkles },
    ];

    const currentIdx = stages.findIndex(s => s.id === stage) || 0;
    const isMultiFile = files && files.length > 1;
    const activeFileName = currentFile?.name || (files[currentFileIndex]?.name) || 'Resume';

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-green-100 rounded-2xl p-5 sm:p-6 shadow-xl mb-6 relative overflow-hidden"
        >
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gray-100">
                <motion.div
                    className="h-full bg-gradient-to-r from-green-500 to-[#5d8c2c]"
                    initial={{ width: "0%" }}
                    animate={{ width: `${((currentIdx + 1) / 4) * 100}%` }}
                    transition={{ duration: 0.5 }}
                />
            </div>

            {/* Header info */}
            <div className="flex items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 bg-green-50 border border-green-200 rounded-2xl flex items-center justify-center text-[#5d8c2c] shrink-0 shadow-xs">
                        <Loader2 className="animate-spin" size={24} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                                Analysing: <span className="text-[#5d8c2c]">{activeFileName}</span>
                            </h3>
                            {isMultiFile && (
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-[#5d8c2c] border border-green-200">
                                    {currentFileIndex + 1} of {files.length}
                                </span>
                            )}
                        </div>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5 truncate">
                            {isMultiFile 
                                ? `Processing resume ${currentFileIndex + 1} of ${files.length} sequentially • AI Intelligence Engine Active` 
                                : 'AI Intelligence Engine Active'}
                        </p>
                    </div>
                </div>
            </div>

            {/* 4 Pipeline Stages */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
                {stages.map((s, idx) => {
                    const isActive = idx === currentIdx;
                    const isDone = idx < currentIdx;
                    const Icon = s.icon;

                    return (
                        <div 
                            key={s.id} 
                            className={`flex flex-col items-center text-center gap-2 p-3 rounded-xl transition-all ${
                                isActive ? 'bg-emerald-50/80 border border-emerald-200/80 shadow-xs scale-[1.02]' : 'opacity-60 bg-gray-50/50'
                            }`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                                isActive 
                                    ? 'bg-[#5d8c2c] text-white shadow-md shadow-[#5d8c2c]/30 scale-110' 
                                    : isDone 
                                    ? 'bg-green-500 text-white' 
                                    : 'bg-gray-100 text-gray-400'
                            }`}>
                                {isDone ? <CheckCircle size={16} /> : <Icon size={16} />}
                            </div>
                            <span className={`text-xs font-semibold ${isActive ? 'text-[#5d8c2c] font-bold' : 'text-gray-500'}`}>
                                {s.label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
};

// --- Result Card Component ---
const CandidateResultCard = ({ candidate, rank }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Safety check for analysis data
    const analysis = candidate.analysis || {};
    const missingSkills = analysis.missing_skills || [];
    const matchedSkills = analysis.key_skills_match || [];

    const displayEmail = candidate.email || candidate.candidate?.email || candidate.candidate_info?.email;
    const isDummyEmail = Boolean(candidate.is_dummy_email ?? candidate.candidate?.is_dummy_email ?? candidate.candidate_info?.is_dummy_email);
    const originalDummyEmail = candidate.original_dummy_email || candidate.candidate?.original_dummy_email || candidate.candidate_info?.original_dummy_email;

    const getScoreColor = (score) => {
        if (score >= 80) return 'text-green-600 border-green-200 bg-white';
        if (score >= 60) return 'text-green-600 border-green-200 bg-white';
        return 'text-red-600 border-red-200 bg-white';
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white border border-gray-200 rounded-xl p-0 hover:shadow-md transition-shadow overflow-hidden"
        >
            <div className={`p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center gap-4 sm:gap-5 cursor-pointer ${isExpanded ? 'bg-gray-50/50' : ''}`} onClick={() => setIsExpanded(!isExpanded)}>
                {/* Rank Badge */}
                <div className="flex-shrink-0 flex flex-col items-center justify-center w-12 text-center">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rank</span>
                    <span className="text-2xl font-black text-gray-300">#{rank}</span>
                </div>

                {/* Candidate Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-base sm:text-lg font-bold text-slate-900 truncate">{candidate.name || candidate.candidate?.name || "Unknown"}</h3>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            candidate.status === 'Rejected'
                                ? 'bg-red-50 border border-red-300 text-red-700 font-extrabold'
                                : candidate.status === 'Failed' 
                                ? 'bg-white border border-red-200 text-red-600' 
                                : 'bg-white border border-green-200 text-[#5d8c2c]'
                        }`}>
                            {candidate.status === 'Rejected' ? 'Rejected: Invalid Email' : candidate.status}
                        </span>
                        {displayEmail && (
                            <span className="text-[11px] text-gray-600 bg-gray-100/90 border border-gray-200 px-2 py-0.5 rounded-md font-mono flex items-center gap-1">
                                {displayEmail}
                            </span>
                        )}
                        {isDummyEmail && (
                            <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md font-medium" title={originalDummyEmail ? `Resume contained placeholder: ${originalDummyEmail}` : "Placeholder email detected in resume"}>
                                ⚠️ Invalid / Placeholder Email
                            </span>
                        )}
                    </div>
                    {candidate.status === 'Rejected' ? (
                        <div className="mt-1.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 flex items-center gap-2 font-medium">
                            <AlertCircle size={14} className="text-red-600 flex-shrink-0" />
                            <span className="truncate">{candidate.rejection_reason || candidate.reasoning || "Rejected: Invalid or placeholder email address in resume."}</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4 text-xs sm:text-sm text-gray-500 font-medium">
                            <span className="flex items-center gap-1.5"><Brain size={14} className="text-green-600" /> {matchedSkills.length} Matching Skills</span>
                            <span className="flex items-center gap-1.5"><AlertCircle size={14} className="text-green-500" /> {missingSkills.length} Missing</span>
                        </div>
                    )}
                </div>

                {/* Score */}
                <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="flex flex-col items-end">
                        <span className="text-xs font-semibold text-gray-500 uppercase">Match Score</span>
                        <div className={`text-xl sm:text-2xl font-black ${candidate.status === 'Rejected' ? 'text-red-600' : getScoreColor(candidate.score).split(' ')[0]}`}>
                            {candidate.score || 0}%
                        </div>
                    </div>
                    <button className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                </div>
            </div>

            {/* Expanded AI Summary */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-gray-100 bg-white px-5 py-6 space-y-4"
                    >
                        <div className="flex items-start gap-3">
                            <Sparkles className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                            <div className="space-y-2">
                                <h4 className="text-sm font-bold text-gray-900">AI Screening Summary</h4>
                                <p className="text-sm text-gray-600 leading-relaxed">
                                    {candidate.reasoning}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
                            <div>
                                <h5 className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">Relevant Strengths</h5>
                                <div className="flex flex-wrap gap-2">
                                    {matchedSkills.slice(0, 5).map((s, i) => (
                                        <span key={i} className="px-2 py-1 bg-white text-green-700 rounded text-xs border border-green-100">{s}</span>
                                    ))}
                                    {matchedSkills.length > 5 && <span className="text-xs text-gray-400">+{matchedSkills.length - 5} more</span>}
                                </div>
                            </div>
                            <div>
                                <h5 className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">Potential Gaps</h5>
                                <div className="flex flex-wrap gap-2">
                                    {missingSkills.slice(0, 5).map((s, i) => (
                                        <span key={i} className="px-2 py-1 bg-white text-red-700 rounded text-xs border border-red-100">{s}</span>
                                    ))}
                                    {missingSkills.length === 0 && <span className="text-xs text-gray-400 italic">No major gaps identified.</span>}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// Common popular tech skill suggestions for quick selection
const PRESET_SKILLS = [
    'Python', 'Java', 'React', 'JavaScript', 'TypeScript',
    'Node.js', 'FastAPI', 'SQL', 'Docker', 'AWS',
    'Spring Boot', 'Git'
];

// --- Main Page Component ---
const ResumeScreening = () => {
    const [jobDescription, setJobDescription] = useState('');
    const [jobDescriptionId, setJobDescriptionId] = useState(null);
    const [structuredJdData, setStructuredJdData] = useState(null);
    const [showJdModal, setShowJdModal] = useState(false);
    const [files, setFiles] = useState([]);
    const folderInputRef = useRef(null);
    const multiFileInputRef = useRef(null);
    const jdFileInputRef = useRef(null);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [stagedFiles, setStagedFiles] = useState([]);
    const [oneDriveNotice, setOneDriveNotice] = useState(false);

    // Specific Targets & Skills State
    const [specificTargets, setSpecificTargets] = useState([]);
    const [newTargetInput, setNewTargetInput] = useState('');
    const [requiredSkills, setRequiredSkills] = useState([]);
    const [preferredSkills, setPreferredSkills] = useState([]);
    const [newRequiredSkillInput, setNewRequiredSkillInput] = useState('');
    const [showAddRequired, setShowAddRequired] = useState(false);
    const [newPreferredSkillInput, setNewPreferredSkillInput] = useState('');
    const [showAddPreferred, setShowAddPreferred] = useState(false);

    // AI Suggestions State
    const [aiSuggestions, setAiSuggestions] = useState([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [hasSuggested, setHasSuggested] = useState(false);
    const [suggestionError, setSuggestionError] = useState(null);

    // Confirmation Modal State
    const [confirmation, setConfirmation] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'info',
        confirmText: 'OK',
        cancelText: 'Cancel',
        isAlert: false,
        onConfirm: null
    });

    // Screening Settings
    const [shortlistCount, setShortlistCount] = useState(5);

    // Screening State
    const [isScreening, setIsScreening] = useState(false);
    const [currentFileIndex, setCurrentFileIndex] = useState(-1);
    const [processingStage, setProcessingStage] = useState('idle');

    const [processedCount, setProcessedCount] = useState(0);
    const [results, setResults] = useState([]);
    const [isPromoting, setIsPromoting] = useState(false);
    const [promoteSuccess, setPromoteSuccess] = useState(false);

    // Rehydrate from localStorage on initial mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('hiringai_active_screening_jd');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.jobDescription) setJobDescription(parsed.jobDescription);
                if (Array.isArray(parsed.specificTargets)) setSpecificTargets(parsed.specificTargets);
                if (Array.isArray(parsed.requiredSkills)) setRequiredSkills(parsed.requiredSkills);
                if (Array.isArray(parsed.preferredSkills)) setPreferredSkills(parsed.preferredSkills);
                if (parsed.jobDescriptionId) setJobDescriptionId(parsed.jobDescriptionId);
                if (parsed.structuredJdData) setStructuredJdData(parsed.structuredJdData);
            }
        } catch (e) {
            console.warn('[ResumeScreening] Could not restore JD state', e);
        }
    }, []);

    // Sync to localStorage whenever inputs change
    useEffect(() => {
        try {
            const stateToSave = {
                jobDescription,
                specificTargets,
                requiredSkills,
                preferredSkills,
                jobDescriptionId,
                structuredJdData
            };
            localStorage.setItem('hiringai_active_screening_jd', JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('[ResumeScreening] Could not persist JD state', e);
        }
    }, [jobDescription, specificTargets, requiredSkills, preferredSkills, jobDescriptionId, structuredJdData]);

    // Folder & Bulk File Handlers (Staged in Custom Modal)
    const handleFolderUpload = (e) => {
        const folderFiles = Array.from(e.target.files).filter(f =>
            f.name.endsWith('.pdf') || f.name.endsWith('.doc') || f.name.endsWith('.docx')
        );
        if (folderFiles.length > 0) {
            setStagedFiles(prev => {
                const existing = new Set(prev.map(f => f.name));
                return [...prev, ...folderFiles.filter(f => !existing.has(f.name))];
            });
            setShowFolderModal(true);
        }
        e.target.value = '';
    };

    const handleMultiFileUpload = (e) => {
        const selectedFiles = Array.from(e.target.files).filter(f =>
            f.name.endsWith('.pdf') || f.name.endsWith('.doc') || f.name.endsWith('.docx')
        );
        if (selectedFiles.length > 0) {
            setStagedFiles(prev => {
                const existing = new Set(prev.map(f => f.name));
                return [...prev, ...selectedFiles.filter(f => !existing.has(f.name))];
            });
            setShowFolderModal(true);
        }
        e.target.value = '';
    };

    const handleModalDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        let detectedFiles = [];
        if (e.dataTransfer.items) {
            const items = Array.from(e.dataTransfer.items);
            const readEntry = async (entry) => {
                if (entry.isFile) {
                    const file = await new Promise(res => entry.file(res));
                    if (file && (file.name.endsWith('.pdf') || file.name.endsWith('.doc') || file.name.endsWith('.docx'))) {
                        detectedFiles.push(file);
                    }
                } else if (entry.isDirectory) {
                    const reader = entry.createReader();
                    const entries = await new Promise(res => reader.readEntries(res));
                    for (const child of entries) {
                        await readEntry(child);
                    }
                }
            };
            for (const item of items) {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry) {
                    await readEntry(entry);
                } else if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file && (file.name.endsWith('.pdf') || file.name.endsWith('.doc') || file.name.endsWith('.docx'))) {
                        detectedFiles.push(file);
                    }
                }
            }
        } else if (e.dataTransfer.files) {
            detectedFiles = Array.from(e.dataTransfer.files).filter(f =>
                f.name.endsWith('.pdf') || f.name.endsWith('.doc') || f.name.endsWith('.docx')
            );
        }
        if (detectedFiles.length > 0) {
            setStagedFiles(prev => {
                const existing = new Set(prev.map(f => f.name));
                return [...prev, ...detectedFiles.filter(f => !existing.has(f.name))];
            });
        }
    };

    const handleJDFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.type === 'text/plain') {
            const reader = new FileReader();
            reader.onload = (ev) => setJobDescription(ev.target.result);
            reader.readAsText(file);
        } else {
            const formData = new FormData();
            formData.append('file', file);
            const token = localStorage.getItem('token');
            fetch(`${API_URL}/api/resume/extract-text/`, {
                method: 'POST',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: formData
            })
            .then(r => r.json())
            .then(d => { if (d.text) setJobDescription(d.text); })
            .catch(() => {
                setConfirmation({
                    isOpen: true,
                    title: 'Extraction Notice',
                    message: 'Could not extract text from file. Please paste the job description manually.',
                    type: 'warning',
                    confirmText: 'OK',
                    isAlert: true,
                    onConfirm: () => setConfirmation(c => ({ ...c, isOpen: false }))
                });
            });
        }
        e.target.value = '';
    };

    // Specific Targets Handlers
    const handleAddNewTarget = () => {
        const trimmed = newTargetInput.trim();
        if (!trimmed) return;
        if (!specificTargets.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
            setSpecificTargets(prev => [...prev, trimmed]);
        }
        setNewTargetInput('');
    };

    const handleRemoveTarget = (index) => {
        setSpecificTargets(prev => prev.filter((_, i) => i !== index));
    };

    // Skills Handlers (Case-insensitive duplicate prevention & toggle)
    const handleAddNewRequiredSkill = (skillToAdd) => {
        const raw = (skillToAdd || newRequiredSkillInput).trim();
        if (!raw) return;
        const clean = raw.replace(/^[,;.\s]+|[,;.\s]+$/g, '');
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (!requiredSkills.some(s => s.toLowerCase() === lower)) {
            setRequiredSkills(prev => [...prev, clean]);
        }
        setNewRequiredSkillInput('');
        setShowAddRequired(false);
    };

    const handleToggleRequiredSkill = (skillToToggle) => {
        const raw = (skillToToggle || '').trim();
        if (!raw) return;
        const clean = raw.replace(/^[,;.\s]+|[,;.\s]+$/g, '');
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (requiredSkills.some(s => s.toLowerCase() === lower)) {
            setRequiredSkills(prev => prev.filter(s => s.toLowerCase() !== lower));
        } else {
            setRequiredSkills(prev => [...prev, clean]);
        }
    };

    const handleRemoveRequiredSkill = (index) => {
        setRequiredSkills(prev => prev.filter((_, i) => i !== index));
    };

    const handleAddNewPreferredSkill = (skillToAdd) => {
        const raw = (skillToAdd || newPreferredSkillInput).trim();
        if (!raw) return;
        const clean = raw.replace(/^[,;.\s]+|[,;.\s]+$/g, '');
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (!preferredSkills.some(s => s.toLowerCase() === lower)) {
            setRequiredSkills(prev => prev.filter(s => s.toLowerCase() !== lower));
            setPreferredSkills(prev => [...prev, clean]);
        }
        setNewPreferredSkillInput('');
        setShowAddPreferred(false);
    };

    const handleRemovePreferredSkill = (index) => {
        setPreferredSkills(prev => prev.filter((_, i) => i !== index));
    };

    // AI Skill Suggestions Request
    const handleFetchAiSuggestions = async () => {
        if (!jobDescription.trim()) return;
        setIsSuggesting(true);
        setSuggestionError(null);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/resume/suggest-skills/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    role: structuredJdData?.role || structuredJdData?.title || 'Software Engineer',
                    title: structuredJdData?.title || 'Job Description',
                    description: jobDescription,
                    specific_targets: specificTargets.join('\n'),
                    required_skills: requiredSkills,
                    preferred_skills: preferredSkills
                })
            });
            if (res.ok) {
                const data = await res.json();
                setAiSuggestions(data.skills || []);
                setHasSuggested(true);
            } else {
                setSuggestionError('Failed to fetch AI skill suggestions.');
            }
        } catch (err) {
            console.error('AI suggestions error', err);
            setSuggestionError('Network error while requesting suggestions.');
        } finally {
            setIsSuggesting(false);
        }
    };

    const handleClearAll = () => {
        setJobDescription('');
        setJobDescriptionId(null);
        setStructuredJdData(null);
        setSpecificTargets([]);
        setRequiredSkills([]);
        setPreferredSkills([]);
        setAiSuggestions([]);
        setHasSuggested(false);
        setResults([]);
        setProcessedCount(0);
        setPromoteSuccess(false);
        try {
            localStorage.removeItem('hiringai_active_screening_jd');
        } catch (e) {}
    };

    const handlePromoteToNextStage = async () => {
        if (!results.length) return;
        setIsPromoting(true);
        try {
            const token = localStorage.getItem('token');
            const candidateIds = results
                .filter(r => r.status === 'Screened' && r.candidate?.id)
                .map(r => r.candidate.id);
            if (!candidateIds.length) { setIsPromoting(false); return; }
            const response = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ candidate_ids: candidateIds, stage: 'NEXT' })
            });
            if (response.ok) {
                setPromoteSuccess(true);
            }
        } catch (err) {
            console.error('Promote failed:', err);
        }
        setIsPromoting(false);
    };

    // Validation & State
    const isCountInvalid = files.length > 0 && shortlistCount > files.length;
    const isValidToStart = files.length > 0 && jobDescription.trim() && !isCountInvalid && shortlistCount > 0;
    const isScreened = results.length > 0 && !isScreening;

    // Drag & Drop
    const onDrop = useCallback((acceptedFiles) => {
        setFiles(prev => [...prev, ...acceptedFiles]);
        setResults([]);
        setProcessedCount(0);
        setPromoteSuccess(false);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }
    });

    const startScreening = async () => {
        if (!isValidToStart) return;

        setIsScreening(true);
        setResults([]);
        setProcessedCount(0);
        setCurrentFileIndex(0);
        setProcessingStage('parsing');
        
        const formData = new FormData();
        formData.append('job_description', jobDescription);
        if (jobDescriptionId) {
            formData.append('job_description_id', jobDescriptionId);
        }
        if (requiredSkills.length > 0) {
            formData.append('required_skills', JSON.stringify(requiredSkills));
        }
        if (preferredSkills.length > 0) {
            formData.append('preferred_skills', JSON.stringify(preferredSkills));
        }
        if (specificTargets.length > 0) {
            formData.append('specific_targets', specificTargets.join('\n'));
        }
        formData.append('top_n', shortlistCount);
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        const formatCandidateItem = (res, i) => {
            const isRejected = res.status === 'Rejected' || res.candidate?.status === 'Rejected';
            return {
                id: res.id || `res-${Date.now()}-${i}`,
                file: res.file,
                name: res.name || res.candidate?.name || res.file || `Candidate ${i + 1}`,
                email: res.email || res.candidate?.email,
                score: isRejected ? 0 : (res.score || 0),
                status: isRejected ? 'Rejected' : res.error ? 'Failed' : 'Screened',
                analysis: res.analysis || {},
                reasoning: res.reasoning || res.rejection_reason || "Analysis complete.",
                rejection_reason: res.rejection_reason || res.candidate?.rejection_reason,
                error: res.error,
                candidate: res.candidate,
                is_dummy_email: res.is_dummy_email || res.candidate?.is_dummy_email || false,
                original_dummy_email: res.original_dummy_email || res.candidate?.original_dummy_email
            };
        };

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/resume/screen-stream/`, {
                method: 'POST',
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: formData
            });

            if (response.ok && response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const evt = JSON.parse(line);
                            if (evt.event === 'start_file') {
                                if (typeof evt.index === 'number') setCurrentFileIndex(evt.index);
                                setProcessingStage(evt.stage || 'parsing');
                            } else if (evt.event === 'stage') {
                                if (typeof evt.index === 'number') setCurrentFileIndex(evt.index);
                                if (evt.stage) setProcessingStage(evt.stage);
                            } else if (evt.event === 'candidate_completed') {
                                if (evt.candidate) {
                                    const formatted = formatCandidateItem(evt.candidate, evt.index ?? 0);
                                    setResults(prev => {
                                        const filtered = prev.filter(c => 
                                            (formatted.file && c.file !== formatted.file) ||
                                            (!formatted.file && c.id !== formatted.id)
                                        );
                                        const updatedList = [...filtered, formatted];
                                        return updatedList.sort((a, b) => (b.score || 0) - (a.score || 0));
                                    });
                                    setProcessedCount(prev => prev + 1);
                                }
                            } else if (evt.event === 'done') {
                                if (evt.results && evt.results.length > 0) {
                                    const mapped = evt.results.map((r, i) => formatCandidateItem(r, i));
                                    mapped.sort((a, b) => (b.score || 0) - (a.score || 0));
                                    setResults(mapped);
                                }
                                setProcessedCount(files.length);
                            }
                        } catch (parseErr) {
                            console.warn("Could not parse stream event line:", line, parseErr);
                        }
                    }
                }

                if (buffer.trim()) {
                    try {
                        const evt = JSON.parse(buffer);
                        if (evt.event === 'candidate_completed' && evt.candidate) {
                            const formatted = formatCandidateItem(evt.candidate, evt.index ?? 0);
                            setResults(prev => {
                                const filtered = prev.filter(c => 
                                    (formatted.file && c.file !== formatted.file) ||
                                    (!formatted.file && c.id !== formatted.id)
                                );
                                return [...filtered, formatted].sort((a, b) => (b.score || 0) - (a.score || 0));
                            });
                        }
                    } catch (e) {}
                }
            } else {
                console.warn("Stream endpoint not ok, falling back to standard endpoint");
                const fallbackResponse = await fetch(`${API_URL}/api/resume/screen/`, {
                    method: 'POST',
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: formData
                });

                if (fallbackResponse.ok) {
                    setProcessingStage('scoring');
                    const data = await fallbackResponse.json();
                    if (data.results && data.results.length > 0) {
                        const mappedResults = data.results.map((res, i) => formatCandidateItem(res, i));
                        mappedResults.sort((a, b) => b.score - a.score);
                        setResults(mappedResults);
                        setPromoteSuccess(false);
                        setProcessedCount(files.length);
                    }
                }
            }
        } catch (err) {
            console.error("Network error during screening", err);
        } finally {
            setIsScreening(false);
            setProcessingStage('idle');
            setCurrentFileIndex(-1);
        }
    };

    return (
        <div className="max-w-7xl mx-auto pb-10 px-4 sm:px-6 lg:px-8">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-3xl font-semibold text-[#5d8c2c] tracking-tight">AI Resume Screening</h1>
                <p className="text-black mt-2 text-sm font-medium">
                    Upload resumes to parse, evaluate, and rank candidates against your specific job criteria in real-time.
                </p>
            </div>

            {/* Main Two-Column Layout on Desktop, Vertically Stacked on Mobile */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                {/* LEFT COLUMN: Job Requirements Configuration (Desktop: col-span-6) */}
                <div className="lg:col-span-6 space-y-5 flex flex-col min-w-0">

                    {/* Card 1: Job Description */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
                        {/* Title and Clear Action */}
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-[#5d8c2c] flex items-center gap-2 text-sm sm:text-base tracking-tight">
                                <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <FileText size={16} className="text-[#5d8c2c]" />
                                </div>
                                Job Description
                            </h3>
                            {(jobDescription || specificTargets.length > 0 || requiredSkills.length > 0) && (
                                <button 
                                    type="button"
                                    onClick={handleClearAll} 
                                    className="text-xs text-gray-400 hover:text-red-500 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* Action Toolbar for JD options */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 mb-3">
                            <button
                                type="button"
                                onClick={() => setShowJdModal(true)}
                                title="Open Structured JD Builder with AI Skill Suggestions"
                                className="flex-1 min-w-[170px] inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 via-[#5d8c2c] to-teal-600 rounded-xl shadow-sm hover:shadow-md hover:shadow-green-200/50 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
                            >
                                <Sparkles size={14} className="flex-shrink-0" />
                                <span>Structured JD & AI</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => jdFileInputRef.current?.click()}
                                title="Upload JD from file (PDF, DOC, TXT)"
                                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 hover:text-green-800 rounded-xl transition-all duration-200"
                            >
                                <FilePlus size={14} className="flex-shrink-0" />
                                <span>Upload File</span>
                            </button>
                            <input
                                ref={jdFileInputRef}
                                type="file"
                                accept=".pdf,.doc,.docx,.txt"
                                onChange={handleJDFileUpload}
                                className="hidden"
                            />
                        </div>

                        {/* Structured JD Linked Badge */}
                        {structuredJdData && (
                            <div className="mb-3 p-3 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl text-xs space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 font-bold text-green-900 truncate">
                                        <Check size={14} className="text-green-600 flex-shrink-0" />
                                        <span className="truncate">Active: {structuredJdData.role || structuredJdData.title}</span>
                                        {jobDescriptionId && <span className="text-[10px] text-gray-500 font-normal flex-shrink-0">#{jobDescriptionId}</span>}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setShowJdModal(true)}
                                            className="text-green-700 hover:text-green-900 underline font-semibold flex items-center gap-1 text-xs"
                                        >
                                            <Edit3 size={11} /> Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setJobDescriptionId(null);
                                                setStructuredJdData(null);
                                            }}
                                            className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                            title="Unlink structured JD (keeps raw text)"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <textarea
                            value={jobDescription}
                            onChange={(e) => setJobDescription(e.target.value)}
                            placeholder={`Paste or type job description here, or click "Structured JD & AI" above to generate with AI skill suggestions...`}
                            className="w-full h-28 sm:h-32 bg-gray-50/80 border border-gray-200 rounded-xl p-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 resize-y transition-all placeholder:text-gray-400"
                        />
                    </div>

                    {/* Card 2: Required Skills (Unified) */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
                        {/* Header with Title, Count & Suggest Skills Action */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Tag size={16} className="text-[#5d8c2c]" />
                                </div>
                                <h3 className="font-bold text-[#5d8c2c] text-sm sm:text-base tracking-tight flex items-center gap-2">
                                    Required Skills
                                    <span className="text-xs text-gray-500 font-medium">({requiredSkills.length} selected)</span>
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={handleFetchAiSuggestions}
                                disabled={isSuggesting || !jobDescription.trim()}
                                title={!jobDescription.trim() ? "Enter a Job Description first to get AI skill suggestions" : "Generate skill recommendations from your Job Description using AI"}
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 via-[#5d8c2c] to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
                            >
                                {isSuggesting ? (
                                    <><Loader2 size={13} className="animate-spin" /> Suggesting...</>
                                ) : (
                                    <><Sparkles size={13} /> Suggest Skills</>
                                )}
                            </button>
                        </div>

                        <p className="text-xs text-gray-500 mb-3">
                            Must-have skills candidate resumes must demonstrate. Select from suggestions below or type custom skills.
                        </p>

                        {/* Currently Selected Required Skills Chips */}
                        <div className="mb-3">
                            {requiredSkills.length > 0 ? (
                                <div className="flex flex-wrap gap-2 items-center p-2.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl">
                                    {requiredSkills.map((skill, idx) => (
                                        <span
                                            key={idx}
                                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-emerald-800 border border-emerald-300 rounded-full text-xs font-semibold shadow-2xs group hover:border-red-300 transition-colors"
                                        >
                                            <span>{skill}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveRequiredSkill(idx)}
                                                className="text-emerald-600 hover:text-red-500 transition-colors p-0.5"
                                                title={`Remove ${skill}`}
                                            >
                                                <X size={12} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-2.5 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-xs text-gray-400 italic">
                                    No skills selected yet. Click any suggestion below or type your own.
                                </div>
                            )}
                        </div>

                        {/* Input for HR to write custom skills */}
                        <div className="flex items-center gap-2 mb-4">
                            <input
                                type="text"
                                value={newRequiredSkillInput}
                                onChange={(e) => setNewRequiredSkillInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddNewRequiredSkill();
                                    }
                                }}
                                placeholder="Type a skill (e.g. Python, Docker, Spring Boot)..."
                                className="flex-1 bg-gray-50/80 border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 placeholder:text-gray-400"
                            />
                            <button
                                type="button"
                                onClick={() => handleAddNewRequiredSkill()}
                                disabled={!newRequiredSkillInput.trim()}
                                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-600 via-[#5d8c2c] to-[#4a7a1f] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
                            >
                                <Plus size={14} />
                                <span>Add Skill</span>
                            </button>
                        </div>

                        {/* Suggestions Section: AI Recommendations + Popular Presets */}
                        <div className="space-y-3 pt-2 border-t border-gray-100">
                            {/* AI Recommendations from JD */}
                            {aiSuggestions.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                                            <Sparkles size={12} className="text-[#5d8c2c]" /> AI Recommendations ({aiSuggestions.length})
                                        </span>
                                        <span className="text-[10px] text-gray-400">Click to select/unselect</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {aiSuggestions.map((skill, idx) => {
                                            const isSelected = requiredSkills.some(s => s.toLowerCase() === skill.toLowerCase());
                                            return (
                                                <button
                                                    key={`ai-${idx}`}
                                                    type="button"
                                                    onClick={() => handleToggleRequiredSkill(skill)}
                                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                                                        isSelected
                                                            ? 'bg-emerald-100 text-emerald-900 border-emerald-400 shadow-2xs font-bold'
                                                            : 'bg-emerald-50/50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300'
                                                    }`}
                                                >
                                                    <span>{isSelected ? '✓ ' : '+ '}{skill}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Popular Suggestions (Python, Java, etc.) */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                                        Popular Suggestions
                                    </span>
                                    <span className="text-[10px] text-gray-400">Click to select/unselect</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {PRESET_SKILLS.map((skill, idx) => {
                                        const isSelected = requiredSkills.some(s => s.toLowerCase() === skill.toLowerCase());
                                        return (
                                            <button
                                                key={`preset-${idx}`}
                                                type="button"
                                                onClick={() => handleToggleRequiredSkill(skill)}
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                                                    isSelected
                                                        ? 'bg-emerald-100 text-emerald-900 border-emerald-400 shadow-2xs font-bold'
                                                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-green-50 hover:text-green-800 hover:border-green-300'
                                                }`}
                                            >
                                                <span>{isSelected ? '✓ ' : '+ '}{skill}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {suggestionError && (
                                <p className="text-xs text-red-500">{suggestionError}</p>
                            )}

                            {!hasSuggested && !isSuggesting && (
                                <p className="text-[11px] text-gray-400 italic">
                                    Tip: Click &ldquo;Suggest Skills&rdquo; above to extract tailored technical skills from your JD.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Card 3: Specific Targets */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-[#5d8c2c] flex items-center gap-2 text-sm sm:text-base tracking-tight">
                                <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Target size={16} className="text-[#5d8c2c]" />
                                </div>
                                Specific Targets
                            </h3>
                            {specificTargets.length > 0 && (
                                <span className="text-xs text-gray-500 font-medium">{specificTargets.length} target{specificTargets.length === 1 ? '' : 's'}</span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                            What specific requirements should the candidate satisfy?
                        </p>

                        {/* List of Added Targets */}
                        {specificTargets.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {specificTargets.map((target, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between p-2.5 sm:p-3 bg-green-50/60 border border-green-200/80 rounded-xl text-xs sm:text-sm text-green-950 font-medium group transition-colors hover:bg-green-50"
                                    >
                                        <div className="flex items-center gap-2 min-w-0 pr-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                                            <span className="break-words">{target}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveTarget(idx)}
                                            className="text-gray-400 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                                            title="Remove Target"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add Target Input Form */}
                        <div className="space-y-2">
                            <div className="flex flex-col sm:flex-row gap-2">
                                <input
                                    type="text"
                                    value={newTargetInput}
                                    onChange={(e) => setNewTargetInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleAddNewTarget();
                                        }
                                    }}
                                    placeholder="e.g. 3+ years of Java experience, Built production REST APIs..."
                                    className="flex-1 bg-gray-50/80 border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 placeholder:text-gray-400"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddNewTarget}
                                    disabled={!newTargetInput.trim()}
                                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 via-[#5d8c2c] to-[#4a7a1f] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    <Plus size={14} />
                                    <span>Add Target</span>
                                </button>
                            </div>

                            {specificTargets.length === 0 && (
                                <div className="p-3 bg-gray-50/80 border border-dashed border-gray-200 rounded-xl text-xs text-gray-500 space-y-1">
                                    <span className="font-semibold text-gray-700 block">Example criteria:</span>
                                    <p className="text-[11px] text-gray-500 italic">• Experience working with payment systems</p>
                                    <p className="text-[11px] text-gray-500 italic">• Built REST APIs handling 10K+ requests/day</p>
                                    <p className="text-[11px] text-gray-500 italic">• Strong Java + Spring Boot experience</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Results & Upload (Desktop: col-span-6) */}
                <div className="lg:col-span-6 space-y-5 flex flex-col min-w-0">

                    {/* Card 1: Screening Results */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-5 shadow-sm transition-all duration-300 hover:shadow-md">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            {/* Title & Count */}
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Sparkles size={16} className="text-[#5d8c2c]" />
                                </div>
                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <h2 className="text-base sm:text-lg font-bold text-[#5d8c2c] tracking-tight">
                                        Screening Results
                                    </h2>
                                    {(processedCount > 0 || results.length > 0) && (
                                        <span className="text-xs font-semibold text-[#5d8c2c] px-2.5 py-0.5 bg-green-50 rounded-full border border-green-200 shrink-0">
                                            Top {results.filter(r => r.status === 'Screened').length} / {processedCount || results.length}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Actions Toolbar - Responsive Wrapping with No Overflow */}
                            <div className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
                                {/* 1. Shortlist Setting */}
                                <div className="h-9 flex items-center gap-1.5 bg-gray-50 px-2.5 rounded-xl border border-gray-200 shrink-0" title="Top candidates to return">
                                    <span className="text-xs font-bold text-gray-500 whitespace-nowrap">Top:</span>
                                    <input
                                        type="number"
                                        min="1"
                                        value={shortlistCount}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || 0;
                                            setShortlistCount(val);
                                            if (results.length > 0) {
                                                setResults([]);
                                                setProcessedCount(0);
                                                setPromoteSuccess(false);
                                            }
                                        }}
                                        className={`w-8 bg-transparent text-center text-xs font-bold focus:outline-none ${isCountInvalid ? 'text-red-600' : 'text-gray-900'}`}
                                    />
                                </div>

                                {/* 2. Start Screening Button */}
                                <button
                                    type="button"
                                    onClick={startScreening}
                                    disabled={!isValidToStart || isScreening}
                                    title={
                                        !isValidToStart
                                            ? "Upload resumes and provide a Job Description to start screening"
                                            : "Run AI resume screening"
                                    }
                                    className={`h-9 px-3 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-all shadow-sm whitespace-nowrap shrink-0 ${
                                        !isValidToStart || isScreening
                                            ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed shadow-none'
                                            : isScreened
                                            ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                                            : 'bg-gradient-to-r from-green-600 to-green-700 text-white hover:shadow-md hover:shadow-green-200 hover:-translate-y-0.5 active:translate-y-0'
                                    }`}
                                >
                                    {isScreening ? (
                                        <><Loader2 size={13} className="animate-spin" /> Screening...</>
                                    ) : isScreened ? (
                                        <><RefreshCw size={12} /> Re-Screen</>
                                    ) : (
                                        <>Start Screening <Play size={12} fill="currentColor" /></>
                                    )}
                                </button>

                                {/* 3. Process to Next Stage button */}
                                {isScreened && (
                                    <button
                                        type="button"
                                        onClick={handlePromoteToNextStage}
                                        disabled={isPromoting || promoteSuccess}
                                        title="Promote screened candidates to next recruitment round"
                                        className={`h-9 px-3.5 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-all shadow-sm whitespace-nowrap shrink-0 ${
                                            promoteSuccess
                                                ? 'bg-green-100 text-green-700 border border-green-300 cursor-default'
                                                : isPromoting
                                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                : 'bg-[#5d8c2c] hover:bg-[#4d7524] text-white hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'
                                        }`}
                                    >
                                        {promoteSuccess ? (
                                            <><CheckCircle size={13} /> Promoted</>
                                        ) : isPromoting ? (
                                            <><Loader2 size={13} className="animate-spin" /> Promoting...</>
                                        ) : (
                                            <><ArrowRight size={13} /> Process to Next Stage</>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Validation Error Banner (If Invalid) */}
                        {isCountInvalid && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                                className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-red-700"
                            >
                                <AlertCircle size={16} />
                                <strong>Action Required:</strong> Candidate count ({shortlistCount}) cannot exceed uploaded resumes ({files.length}).
                            </motion.div>
                        )}

                        {/* Active Processing Card */}
                        <AnimatePresence>
                            {isScreening && (
                                <ProcessingStatus
                                    files={files}
                                    currentFileIndex={currentFileIndex}
                                    currentFile={files[currentFileIndex]}
                                    stage={processingStage}
                                />
                            )}
                        </AnimatePresence>

                        {/* Results List */}
                        <div className="space-y-3">
                            {results.length === 0 && !isScreening && (
                                <div className="border-2 border-dashed border-gray-200 rounded-2xl min-h-[140px] p-6 flex flex-col items-center justify-center text-center bg-gray-50/50">
                                    <div className="w-12 h-12 bg-white border border-gray-100 rounded-2xl flex items-center justify-center shadow-xs mb-2">
                                        <Brain size={24} className="text-[#5d8c2c]" />
                                    </div>
                                    <h3 className="font-bold text-gray-800 text-sm mb-1">Ready to Analyze</h3>
                                    <p className="text-xs text-gray-500 max-w-sm">
                                        Configure your Job Requirements on the left and upload resumes below, then click &ldquo;Start Screening&rdquo;.
                                    </p>
                                </div>
                            )}

                            <AnimatePresence>
                                {results.map((candidate, idx) => (
                                    <CandidateResultCard key={candidate.id} candidate={candidate} rank={idx + 1} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Card 2: Upload Resumes (Moved to right column directly below Screening Results) */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-3 gap-2">
                            <h3 className="font-bold text-[#5d8c2c] flex items-center gap-2 text-sm sm:text-base tracking-tight">
                                <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Upload size={16} className="text-[#5d8c2c]" />
                                </div>
                                Upload Resumes
                            </h3>
                            {/* Folder / Batch Upload Modal Trigger */}
                            <button
                                type="button"
                                onClick={() => setShowFolderModal(true)}
                                title="Upload entire folder or batch of resumes"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] rounded-xl hover:shadow-md hover:shadow-green-200/50 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
                            >
                                <FolderOpen size={13} />
                                <span>Folder Upload</span>
                            </button>
                            {/* Hidden folder input */}
                            <input
                                ref={folderInputRef}
                                type="file"
                                webkitdirectory="true"
                                multiple
                                accept=".pdf,.doc,.docx"
                                onChange={handleFolderUpload}
                                className="hidden"
                            />
                            {/* Hidden multi-file input */}
                            <input
                                ref={multiFileInputRef}
                                type="file"
                                multiple
                                accept=".pdf,.doc,.docx"
                                onChange={handleMultiFileUpload}
                                className="hidden"
                            />
                        </div>

                        <div
                            {...getRootProps()}
                            className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 group ${
                                files.length > 0 ? 'p-4' : 'py-7 px-4'
                            } ${
                                isDragActive ? 'border-[#5d8c2c] bg-green-50/80 scale-[1.01]' : 'border-gray-300 hover:border-[#5d8c2c]/60 hover:bg-green-50/30'
                            }`}
                        >
                            <input {...getInputProps()} />
                            {files.length === 0 ? (
                                <>
                                    <div className="w-12 h-12 bg-gradient-to-br from-green-100 to-green-50 text-[#5d8c2c] rounded-xl flex items-center justify-center mb-2.5 group-hover:scale-110 group-hover:shadow-md group-hover:shadow-green-100 transition-all duration-300">
                                        <Upload size={22} />
                                    </div>
                                    <p className="text-xs sm:text-sm font-semibold text-gray-800">Drag & drop resumes here, or click to browse</p>
                                    <p className="text-[11px] text-gray-400 mt-1">Supports PDF, DOC, DOCX</p>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 text-xs text-gray-600 font-medium">
                                    <Upload size={14} className="text-[#5d8c2c]" />
                                    <span>Click or drag to add more resumes</span>
                                </div>
                            )}
                        </div>

                        {/* File Queue - Internal Scroll */}
                        {files.length > 0 && (
                            <div className="mt-3 flex flex-col">
                                <div className="flex justify-between items-center text-xs text-gray-500 font-medium mb-2">
                                    <span>{files.length} file{files.length === 1 ? '' : 's'} queued</span>
                                    <button 
                                        type="button" 
                                        onClick={() => {
                                            setConfirmation({
                                                isOpen: true,
                                                title: 'Clear Queue',
                                                message: `Are you sure you want to remove all ${files.length} queued resumes?`,
                                                type: 'warning',
                                                confirmText: 'Remove All',
                                                cancelText: 'Cancel',
                                                isAlert: false,
                                                onConfirm: () => {
                                                    setFiles([]);
                                                    setResults([]);
                                                    setProcessedCount(0);
                                                    setPromoteSuccess(false);
                                                    setConfirmation(c => ({ ...c, isOpen: false }));
                                                }
                                            });
                                        }} 
                                        className="text-red-500 hover:underline"
                                    >
                                        Remove All
                                    </button>
                                </div>
                                <div className="overflow-y-auto custom-scrollbar max-h-[180px] space-y-1.5 pr-1">
                                    {files.map((file, idx) => {
                                        const isCurrent = isScreening && idx === currentFileIndex;
                                        return (
                                            <div 
                                                key={idx} 
                                                className={`flex items-center justify-between p-2.5 rounded-xl text-xs border transition-all ${
                                                    isCurrent
                                                        ? 'bg-emerald-50/90 border-emerald-300 shadow-xs ring-1 ring-emerald-400/20'
                                                        : isScreening
                                                        ? 'bg-green-50/40 border-green-200/70'
                                                        : 'bg-gray-50 border-gray-100'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2 overflow-hidden min-w-0">
                                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                                        isScreening 
                                                            ? (isCurrent ? 'bg-green-500 animate-ping' : 'bg-emerald-500 animate-pulse') 
                                                            : (results.length > idx ? 'bg-green-500' : 'bg-gray-300')
                                                    }`} />
                                                    <span className={`truncate font-medium ${
                                                        isCurrent ? 'text-green-900 font-bold' : isScreening ? 'text-green-800' : 'text-gray-700'
                                                    }`}>
                                                        {file.name}
                                                    </span>
                                                </div>
                                                {isScreening && (
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span className={`text-[10px] font-medium ${isCurrent ? 'text-green-800 font-bold' : 'text-green-600'}`}>
                                                            {isCurrent ? 'Analyzing...' : 'In queue...'}
                                                        </span>
                                                        <Loader2 
                                                            size={13} 
                                                            className={`animate-spin flex-shrink-0 ${isCurrent ? 'text-green-700 font-bold' : 'text-green-500/70'}`} 
                                                        />
                                                    </div>
                                                )}
                                                {!isScreening && (
                                                    <button 
                                                        type="button" 
                                                        onClick={() => {
                                                            setFiles(files.filter(f => f !== file));
                                                            setResults([]);
                                                            setProcessedCount(0);
                                                            setPromoteSuccess(false);
                                                        }} 
                                                        className="text-gray-400 hover:text-red-500 p-1 flex-shrink-0 cursor-pointer transition-colors"
                                                        title="Remove resume"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Folder & Bulk Upload Modal */}
            <AnimatePresence>
                {showFolderModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) {
                                setShowFolderModal(false);
                                setStagedFiles([]);
                            }
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 overflow-hidden border border-gray-100"
                        >
                            {/* Modal Header with Branding */}
                            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-5">
                                <div className="flex items-center gap-3">
                                    <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-8 w-auto object-contain flex-shrink-0" />
                                    <div className="h-6 w-px bg-gray-200" />
                                    <div>
                                        <h3 className="font-bold text-gray-900 text-base sm:text-lg flex items-center gap-1.5">
                                            <span>Folder & Bulk Upload</span>
                                        </h3>
                                        <p className="text-xs text-gray-500">ThirdEye PrepWin Resume Importer</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowFolderModal(false);
                                        setStagedFiles([]);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* View 1: If Staged Files are selected, Show In-App Confirmation */}
                            {stagedFiles.length > 0 ? (
                                <div>
                                    <div className="text-center py-3">
                                        <div className="w-12 h-12 bg-green-50 text-[#5d8c2c] rounded-2xl mx-auto flex items-center justify-center mb-2.5 border border-green-100">
                                            <CheckCircle size={26} />
                                        </div>
                                        <h4 className="font-bold text-gray-900 text-base">
                                            Upload {stagedFiles.length} Resume{stagedFiles.length === 1 ? '' : 's'} to PrepWin?
                                        </h4>
                                        <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                                            The following resumes have been detected and are ready to be added to your screening queue.
                                        </p>
                                    </div>

                                    <div className="max-h-48 overflow-y-auto custom-scrollbar border border-gray-200 rounded-xl p-2 bg-gray-50/60 space-y-1.5 mb-5 my-3">
                                        {stagedFiles.map((file, idx) => (
                                            <div key={idx} className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-100 text-xs shadow-2xs">
                                                <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                                                    <FileText size={14} className="text-[#5d8c2c] flex-shrink-0" />
                                                    <span className="truncate font-medium text-gray-700">{file.name}</span>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <span className="text-[11px] text-gray-400 font-mono">
                                                        {(file.size / 1024).toFixed(0)} KB
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setStagedFiles(stagedFiles.filter((_, i) => i !== idx))}
                                                        className="text-gray-400 hover:text-red-500 p-0.5"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
                                        <button
                                            type="button"
                                            onClick={() => setStagedFiles([])}
                                            className="px-4 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFiles(prev => {
                                                    const existing = new Set(prev.map(f => f.name));
                                                    return [...prev, ...stagedFiles.filter(f => !existing.has(f.name))];
                                                });
                                                setStagedFiles([]);
                                                setShowFolderModal(false);
                                                setResults([]);
                                                setProcessedCount(0);
                                                setPromoteSuccess(false);
                                            }}
                                            className="px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] hover:shadow-md hover:shadow-green-200/50 rounded-xl transition-all flex items-center gap-2"
                                        >
                                            <Upload size={14} />
                                            <span>Upload {stagedFiles.length} Resume{stagedFiles.length === 1 ? '' : 's'}</span>
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* View 2: Options to select files or folder, or drop them directly into modal */
                                <div className="space-y-3.5">
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDrop={handleModalDrop}
                                        className="border-2 border-dashed border-[#5d8c2c]/40 hover:border-[#5d8c2c] bg-green-50/20 hover:bg-green-50/50 rounded-xl p-5 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center group"
                                        onClick={() => multiFileInputRef.current?.click()}
                                    >
                                        <div className="w-10 h-10 bg-green-100/70 text-[#5d8c2c] rounded-xl flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                                            <Upload size={18} />
                                        </div>
                                        <p className="text-xs font-semibold text-gray-800">
                                            Drag & drop whole folder or resumes here
                                        </p>
                                        <p className="text-[11px] text-gray-400 mt-0.5">
                                            Supports folders, PDF, DOC, DOCX files
                                        </p>
                                    </div>

                                    {/* Option 1: Select Multiple Resumes */}
                                    <button
                                        type="button"
                                        onClick={() => multiFileInputRef.current?.click()}
                                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-gray-200 hover:border-[#5d8c2c] hover:bg-green-50/30 transition-all text-left group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl bg-green-50 text-[#5d8c2c] flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                                                <Files size={18} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="font-semibold text-gray-800 text-xs sm:text-sm">Select Multiple Files</h4>
                                                    <span className="text-[9px] font-bold uppercase tracking-wider bg-green-100 text-[#5d8c2c] px-2 py-0.5 rounded-full">Recommended</span>
                                                </div>
                                                <p className="text-[11px] text-gray-400">Select all resumes in your folder (Ctrl+A) — Direct in-app</p>
                                            </div>
                                        </div>
                                        <ArrowRight size={15} className="text-gray-400 group-hover:text-[#5d8c2c] group-hover:translate-x-1 transition-all flex-shrink-0" />
                                    </button>

                                    {/* Option 2: Select Directory / Whole Folder */}
                                    <button
                                        type="button"
                                        onClick={() => folderInputRef.current?.click()}
                                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50/60 transition-all text-left group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                                                <FolderOpen size={18} />
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-gray-800 text-xs sm:text-sm">Upload Whole Folder</h4>
                                                <p className="text-[11px] text-gray-400">Select local directory from file explorer</p>
                                            </div>
                                        </div>
                                        <ArrowRight size={15} className="text-gray-400 group-hover:text-gray-600 group-hover:translate-x-1 transition-all flex-shrink-0" />
                                    </button>

                                    {/* Option 3: OneDrive Cloud */}
                                    <button
                                        type="button"
                                        onClick={() => setOneDriveNotice(v => !v)}
                                        className="w-full flex items-center justify-between p-3.5 rounded-xl border border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 transition-all text-left group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                                                <Cloud size={18} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="font-semibold text-gray-800 text-xs sm:text-sm">OneDrive / Cloud</h4>
                                                    <span className="text-[9px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Coming Soon</span>
                                                </div>
                                                <p className="text-[11px] text-gray-400">Import directly from Microsoft OneDrive</p>
                                            </div>
                                        </div>
                                    </button>

                                    {oneDriveNotice && (
                                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-center justify-between">
                                            <span>OneDrive integration is currently in development. Please select files or folder above.</span>
                                            <button type="button" onClick={() => setOneDriveNotice(false)} className="text-blue-600 hover:text-blue-900 ml-2 font-bold">✕</button>
                                        </div>
                                    )}

                                    <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                                        <button
                                            type="button"
                                            onClick={() => setShowFolderModal(false)}
                                            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal Dialog for Structured JD Editor */}
            <AnimatePresence>
                {showJdModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setShowJdModal(false);
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-y-auto p-4"
                        >
                            <button
                                onClick={() => setShowJdModal(false)}
                                className="absolute top-4 right-4 z-10 p-2 text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                                title="Close Modal"
                            >
                                <X size={18} />
                            </button>
                            <StructuredJobDescriptionEditor
                                initialData={structuredJdData}
                                onApply={(appliedData, formattedText) => {
                                    setJobDescription(formattedText || appliedData?.description || '');
                                    setJobDescriptionId(appliedData?.id || null);
                                    setStructuredJdData(appliedData);
                                    if (appliedData?.specific_targets) {
                                        const lines = typeof appliedData.specific_targets === 'string'
                                            ? appliedData.specific_targets.split('\n').map(l => l.replace(/^[-*•\s]+/, '').trim()).filter(Boolean)
                                            : Array.isArray(appliedData.specific_targets) ? appliedData.specific_targets : [];
                                        if (lines.length > 0) setSpecificTargets(lines);
                                    }
                                    if (Array.isArray(appliedData?.required_skills) && appliedData.required_skills.length > 0) {
                                        setRequiredSkills(appliedData.required_skills);
                                    }
                                    if (Array.isArray(appliedData?.preferred_skills) && appliedData.preferred_skills.length > 0) {
                                        setPreferredSkills(appliedData.preferred_skills);
                                    }
                                    setShowJdModal(false);
                                }}
                                onSaveSuccess={(savedJd) => {
                                    setJobDescriptionId(savedJd.id);
                                    setStructuredJdData(savedJd);
                                    if (savedJd?.specific_targets) {
                                        const lines = typeof savedJd.specific_targets === 'string'
                                            ? savedJd.specific_targets.split('\n').map(l => l.replace(/^[-*•\s]+/, '').trim()).filter(Boolean)
                                            : Array.isArray(savedJd.specific_targets) ? savedJd.specific_targets : [];
                                        if (lines.length > 0) setSpecificTargets(lines);
                                    }
                                    if (Array.isArray(savedJd?.required_skills) && savedJd.required_skills.length > 0) {
                                        setRequiredSkills(savedJd.required_skills);
                                    }
                                    if (Array.isArray(savedJd?.preferred_skills) && savedJd.preferred_skills.length > 0) {
                                        setPreferredSkills(savedJd.preferred_skills);
                                    }
                                }}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Custom Confirmation Modal */}
            <ConfirmationModal
                isOpen={confirmation.isOpen}
                onClose={() => setConfirmation(c => ({ ...c, isOpen: false }))}
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

export default ResumeScreening;
