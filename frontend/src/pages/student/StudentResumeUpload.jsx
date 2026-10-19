import React, { useState, useEffect } from 'react';
import {
    Upload,
    FileText,
    CheckCircle,
    AlertTriangle,
    HelpCircle,
    Sparkles,
    Layers,
    Calendar,
    Code,
    Cpu,
    BookOpen,
    Briefcase,
    Award,
    Binary,
    RefreshCw,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero, Stagger, StaggerItem, EmptyState } from '../../components/student-ui/StudentMotion';
import { Reveal, Counter, EASE } from '../../components/home/primitives';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';

const ANALYSIS_STAGES = [
    { icon: FileText, label: 'Reading your resume' },
    { icon: Binary, label: 'Checking ATS keywords' },
    { icon: Layers, label: 'Scoring 9 dimensions' },
    { icon: Sparkles, label: 'Writing recommendations' },
];
const ANALYSIS_TIPS = [
    'Use standard section headings so ATS parsers can read your resume.',
    'Quantify impact: numbers make achievements believable.',
    'Keep it to one page if you are early in your career.',
];

/** Animated radial score ring with count-up value (display only). */
const ScoreRing = ({ value = 0, label, color = '#10b981', delay = 0 }) => {
    const reduce = useReducedMotion();
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    const R = 46;
    const C = 2 * Math.PI * R;
    return (
        <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 flex flex-col items-center text-center">
            <div className="relative w-28 h-28 sm:w-32 sm:h-32">
                <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
                    <circle cx="55" cy="55" r={R} fill="none" strokeWidth="9" className="stroke-slate-200 dark:stroke-slate-800" />
                    <motion.circle
                        cx="55" cy="55" r={R} fill="none" strokeWidth="9" strokeLinecap="round"
                        stroke={color}
                        strokeDasharray={C}
                        initial={reduce ? false : { strokeDashoffset: C }}
                        whileInView={{ strokeDashoffset: C * (1 - v / 100) }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.3, delay, ease: EASE }}
                        style={reduce ? { strokeDashoffset: C * (1 - v / 100) } : undefined}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums"><Counter to={Math.round(v)} /></span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">/ 100</span>
                </div>
            </div>
            <span className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
        </div>
    );
};

const StudentResumeUpload = () => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

    const [currentAnalysis, setCurrentAnalysis] = useState(null);
    const [activeVersion, setActiveVersion] = useState(null);
    const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);
    const [isDragging, setIsDragging] = useState(false);

    // Load latest analysis on mount
    const fetchAnalysis = async (ver = null) => {
        setIsLoadingAnalysis(true);
        try {
            const data = await studentApi.getResume(ver);
            if (data && data.version) {
                setCurrentAnalysis(data);
                setActiveVersion(data.version);
            } else {
                setCurrentAnalysis(null);
                setActiveVersion(null);
            }
        } catch (err) {
            // If 404, student simply hasn't uploaded a resume yet
            if (err.response?.status !== 404) {
                console.error('Failed to load resume analysis:', err);
            }
            setCurrentAnalysis(null);
            setActiveVersion(null);
        } finally {
            setIsLoadingAnalysis(false);
        }
    };

    useEffect(() => {
        fetchAnalysis();
    }, []);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Check file type
            const allowed = ['.pdf', '.docx', '.doc'];
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!allowed.includes(ext)) {
                setUploadError('Please select a valid PDF or Word document (.pdf, .docx, .doc).');
                setSelectedFile(null);
                return;
            }
            // Check file size (15MB max)
            if (file.size > 15 * 1024 * 1024) {
                setUploadError('File size must be under 15MB.');
                setSelectedFile(null);
                return;
            }
            setSelectedFile(file);
            setUploadError(null);
        }
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!selectedFile) return;

        setIsUploading(true);
        setUploadError(null);
        setSuccessMsg(null);

        try {
            const res = await studentApi.uploadResume(selectedFile);
            setSuccessMsg(`Resume successfully uploaded and analyzed as Version V${res.version}!`);
            setSelectedFile(null);
            // Refresh analysis view
            await fetchAnalysis(res.version);
        } catch (err) {
            console.error('Resume upload failed:', err);
            setUploadError(err.response?.data?.detail || 'Failed to analyze resume. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const analysis = currentAnalysis?.analysis_json || currentAnalysis || {};

    return (
        <div className="space-y-6 sm:space-y-8">
            <AssessmentLoadingOverlay
                open={isUploading}
                title="Analysing your resume"
                subtitle="Our AI is scoring your resume across 9 dimensions."
                stages={ANALYSIS_STAGES}
                tips={ANALYSIS_TIPS}
                footnote="Please keep this page open. This usually takes a few seconds."
            />
            {/* Header */}
            <PageHero
                icon={FileText}
                eyebrow="Resume Lab"
                title="AI Resume Screening & Analysis"
                subtitle="Upload your resume for comprehensive 9-dimension career evaluation, ATS compatibility scoring, and actionable feedback."
            />

            {/* Upload Section */}
            <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Upload New Resume Version
                </h2>

                <form onSubmit={handleUpload} className="space-y-4">
                    <div className={`border-2 border-dashed rounded-2xl p-6 sm:p-10 text-center transition-all duration-300 cursor-pointer relative overflow-hidden min-h-[160px] ${isDragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 scale-[1.01]' : 'border-slate-200 dark:border-slate-700 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 bg-slate-50 dark:bg-slate-900/40'}`}>
                        <input
                            type="file"
                            accept=".pdf,.docx,.doc"
                            onChange={handleFileChange}
                            onDragEnter={() => setIsDragging(true)}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={() => setIsDragging(false)}
                            disabled={isUploading}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="flex flex-col items-center justify-center gap-2 pointer-events-none">
                            <div className={`w-14 h-14 rounded-2xl bg-white dark:bg-slate-800 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center ${isDragging ? 'animate-bounce' : 'animate-pw-float'} motion-reduce:animate-none`}>
                                <FileText className="w-7 h-7" />
                            </div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {selectedFile ? selectedFile.name : (isDragging ? 'Drop it here' : 'Click to select or drag and drop your resume')}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Supports PDF, DOCX, DOC up to 15MB
                            </p>
                            {selectedFile && (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB ready for upload
                                </span>
                            )}
                        </div>
                    </div>

                    {uploadError && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>{uploadError}</span>
                        </div>
                    )}

                    {successMsg && (
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 shrink-0" />
                            <span>{successMsg}</span>
                        </div>
                    )}

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={!selectedFile || isUploading}
                            className={`h-12 w-full sm:w-auto justify-center px-6 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all active:scale-[0.98] ${
                                !selectedFile || isUploading
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                    : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-xs cursor-pointer'
                            }`}
                        >
                            {isUploading ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Extracting & Analyzing with AI...</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4" />
                                    <span>Analyze Resume</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </Reveal>

            {/* Analysis Results View */}
            {isLoadingAnalysis ? (
                <div className="text-center py-12">
                    <RefreshCw className="w-8 h-8 text-emerald-500 dark:text-emerald-400 animate-spin mx-auto mb-2" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Fetching resume analysis...</p>
                </div>
            ) : !currentAnalysis ? (
                <EmptyState
                    icon={FileText}
                    title="No Resume Uploaded Yet"
                    body="Upload your PDF or DOCX resume using the uploader above to unlock AI-driven insights, ATS scores, and placement guidance."
                />
            ) : (
                <div className="space-y-6">
                    {/* Version & Overview Header */}
                    <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-3">
                                <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 rounded-full font-bold text-xs">
                                    Version V{currentAnalysis.version}
                                </span>
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate max-w-xs">
                                    {currentAnalysis.file_name}
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                                <span className="flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                    {currentAnalysis.created_at ? new Date(currentAnalysis.created_at).toLocaleDateString() : 'Recent'}
                                </span>
                            </div>
                        </div>

                        {/* Top Score Summary */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                            <ScoreRing label="Overall Resume Score" color="#10b981" value={Math.round(currentAnalysis.overall_score || 0)} />
                            <ScoreRing label="ATS Compatibility" color="#3b82f6" delay={0.15} value={Math.round(analysis.ats_compatibility?.score || currentAnalysis.overall_score || 0)} />
                            <ScoreRing label="Content & Structure Quality" color="#a855f7" delay={0.3} value={Math.round(analysis.resume_quality?.score || currentAnalysis.overall_score || 0)} />
                        </div>
                    </Reveal>

                    {/* Strengths & Weaknesses */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2 mb-4">
                                <CheckCircle className="w-4 h-4" /> Strengths
                            </h3>
                            <ul className="space-y-2.5">
                                {(currentAnalysis.strengths || []).map((s, i) => (
                                    <li key={i} className="text-sm text-slate-700 dark:text-slate-200 flex items-start gap-2">
                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                                        <span>{s}</span>
                                    </li>
                                ))}
                            </ul>
                        </Reveal>

                        <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-2 mb-4">
                                <AlertTriangle className="w-4 h-4" /> Weaknesses
                            </h3>
                            <ul className="space-y-2.5">
                                {(currentAnalysis.weaknesses || []).map((w, i) => (
                                    <li key={i} className="text-sm text-slate-700 dark:text-slate-200 flex items-start gap-2">
                                        <span className="text-amber-600 dark:text-amber-400 font-bold">⚠</span>
                                        <span>{w}</span>
                                    </li>
                                ))}
                            </ul>
                        </Reveal>
                    </div>

                    {/* Missing Information (Never Hallucinate Policy Card) */}
                    <Reveal className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 rounded-3xl p-5 sm:p-6 shadow-xs">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-2 mb-3">
                            <HelpCircle className="w-4 h-4" /> Missing Information In Resume
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                            Our AI strictly extracts verifiable details and never invents experience or achievements. The following elements were absent or incomplete in your uploaded document:
                        </p>
                        {(!currentAnalysis.missing_information || currentAnalysis.missing_information.length === 0) ? (
                            <p className="text-sm text-slate-600 dark:text-slate-300 italic">No missing required sections identified.</p>
                        ) : (
                            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {currentAnalysis.missing_information.map((item, i) => (
                                    <li key={i} className="text-sm text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex items-start gap-2">
                                        <span className="text-rose-500 font-bold shrink-0">•</span>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Reveal>

                    {/* Actionable Recommendations */}
                    <Reveal className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-2 mb-4">
                            <Sparkles className="w-4 h-4" /> Improvement Recommendations
                        </h3>
                        <ol className="space-y-3">
                            {(currentAnalysis.recommendations || []).map((rec, i) => (
                                <li key={i} className="text-sm text-slate-700 dark:text-slate-200 flex items-start gap-3">
                                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                                        {i + 1}
                                    </span>
                                    <span>{rec}</span>
                                </li>
                            ))}
                        </ol>
                    </Reveal>

                    {/* 9 Structured Dimensions Accordions/Grids */}
                    <div className="space-y-4">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Layers className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            Detailed 9-Dimension Assessment Breakdown
                        </h3>

                        <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 1. Technical Skills */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Code className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Technical Skills
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {((analysis.technical_skills?.skills || analysis.technical_skills) || []).length > 0 ? (
                                        ((analysis.technical_skills?.skills || analysis.technical_skills)).map((s, i) => (
                                            <span key={i} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium">
                                                {s}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">None detected</span>
                                    )}
                                </div>
                            </StaggerItem>

                            {/* 2. Soft Skills */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Award className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Soft Skills
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {((analysis.soft_skills?.skills || analysis.soft_skills) || []).length > 0 ? (
                                        ((analysis.soft_skills?.skills || analysis.soft_skills)).map((s, i) => (
                                            <span key={i} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium">
                                                {s}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">None explicitly identified</span>
                                    )}
                                </div>
                            </StaggerItem>

                            {/* 3. DSA Indicators */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Binary className="w-4 h-4 text-amber-500" /> DSA & Problem Solving Indicators
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {((analysis.dsa_indicators?.indicators || analysis.dsa_indicators) || []).length > 0 ? (
                                        ((analysis.dsa_indicators?.indicators || analysis.dsa_indicators)).map((s, i) => (
                                            <span key={i} className="px-2.5 py-1 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 rounded-lg text-xs font-medium">
                                                {s}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">No DSA keywords or competitive programming references detected</span>
                                    )}
                                </div>
                            </StaggerItem>

                            {/* 4. Education */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <BookOpen className="w-4 h-4 text-indigo-500" /> Education
                                </h4>
                                <div className="space-y-2">
                                    {((analysis.education?.records || analysis.education) || []).length > 0 ? (
                                        ((analysis.education?.records || analysis.education)).map((edu, i) => (
                                            <div key={i} className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                                                <p className="font-semibold text-slate-900 dark:text-white">{edu.degree || edu.institution || JSON.stringify(edu)}</p>
                                                {edu.institution && edu.degree && <p className="text-slate-500 dark:text-slate-400">{edu.institution}</p>}
                                                {edu.year && <p className="text-slate-400 dark:text-slate-500 text-[11px]">Year: {edu.year}</p>}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">No education details parsed</span>
                                    )}
                                </div>
                            </StaggerItem>

                            {/* 5. Projects */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full md:col-span-2">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Projects
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {((analysis.projects?.items || analysis.projects) || []).length > 0 ? (
                                        ((analysis.projects?.items || analysis.projects)).map((proj, i) => (
                                            <div key={i} className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800 rounded-lg p-3 text-xs">
                                                <p className="font-semibold text-slate-900 dark:text-white">{proj.name || `Project ${i + 1}`}</p>
                                                {proj.description && <p className="text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">{proj.description}</p>}
                                                {proj.technologies && Array.isArray(proj.technologies) && (
                                                    <div className="flex flex-wrap gap-1 mt-2">
                                                        {proj.technologies.map((t, ti) => (
                                                            <span key={ti} className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded">
                                                                {t}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">No projects found</span>
                                    )}
                                </div>
                            </StaggerItem>

                            {/* 6. Experience */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Briefcase className="w-4 h-4 text-blue-500" /> Experience & Internships
                                </h4>
                                <div className="space-y-2">
                                    {((analysis.experience?.items || analysis.experience) || []).length > 0 ? (
                                        ((analysis.experience?.items || analysis.experience)).map((exp, i) => (
                                            <div key={i} className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                                                <p className="font-semibold text-slate-900 dark:text-white">{exp.role || exp.company || 'Experience'}</p>
                                                {exp.company && <p className="text-slate-500 dark:text-slate-400">{exp.company}</p>}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">No prior experience listed (common for entry-level candidates)</span>
                                    )}
                                </div>
                            </StaggerItem>

                            {/* 7. Certifications */}
                            <StaggerItem className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs h-full">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Award className="w-4 h-4 text-purple-500" /> Certifications
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {((analysis.certifications?.items || analysis.certifications) || []).length > 0 ? (
                                        ((analysis.certifications?.items || analysis.certifications)).map((c, i) => (
                                            <span key={i} className="px-2.5 py-1 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/20 rounded-lg text-xs font-medium">
                                                {typeof c === 'string' ? c : c.name || JSON.stringify(c)}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400 italic">No certifications listed</span>
                                    )}
                                </div>
                            </StaggerItem>
                        </Stagger>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentResumeUpload;
