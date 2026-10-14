import React, { useState, useEffect } from 'react';
import { 
    Upload, 
    FileText, 
    CheckCircle, 
    AlertTriangle, 
    HelpCircle, 
    Sparkles, 
    TrendingUp, 
    Layers, 
    Calendar,
    Target,
    Code,
    Cpu,
    BookOpen,
    Briefcase,
    Award,
    Binary,
    ShieldAlert,
    RefreshCw
} from 'lucide-react';
import studentApi from '../../services/studentApi';

const StudentResumeUpload = () => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

    const [currentAnalysis, setCurrentAnalysis] = useState(null);
    const [activeVersion, setActiveVersion] = useState(null);
    const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);

    // Load latest analysis on mount
    const fetchAnalysis = async (ver = null) => {
        setIsLoadingAnalysis(true);
        try {
            const data = await studentApi.getResume(ver);
            setCurrentAnalysis(data);
            setActiveVersion(data.version);
        } catch (err) {
            // If 404, student simply hasn't uploaded a resume yet
            if (err.response?.status !== 404) {
                console.error('Failed to load resume analysis:', err);
            }
            setCurrentAnalysis(null);
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

    const analysis = currentAnalysis?.analysis_json || {};

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                    AI Resume Screening & Analysis
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Upload your resume for comprehensive 9-dimension career evaluation, ATS compatibility scoring, and actionable feedback.
                </p>
            </div>

            {/* Upload Section */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Upload New Resume Version
                </h2>

                <form onSubmit={handleUpload} className="space-y-4">
                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 rounded-xl p-8 text-center transition-colors bg-slate-50 dark:bg-slate-900/40 cursor-pointer relative">
                        <input
                            type="file"
                            accept=".pdf,.docx,.doc"
                            onChange={handleFileChange}
                            disabled={isUploading}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="flex flex-col items-center justify-center gap-2 pointer-events-none">
                            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                <FileText className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {selectedFile ? selectedFile.name : 'Click to select or drag and drop your resume'}
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
                            className={`h-11 px-6 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${
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
            </div>

            {/* Analysis Results View */}
            {isLoadingAnalysis ? (
                <div className="text-center py-12">
                    <RefreshCw className="w-8 h-8 text-emerald-500 dark:text-emerald-400 animate-spin mx-auto mb-2" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Fetching resume analysis...</p>
                </div>
            ) : !currentAnalysis ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-12 text-center shadow-xs">
                    <FileText className="w-12 h-12 text-slate-400 dark:text-slate-500 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">No Resume Uploaded Yet</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                        Upload your PDF or DOCX resume using the uploader above to unlock AI-driven insights, ATS scores, and placement guidance.
                    </p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Version & Overview Header */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
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
                            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 text-center">
                                <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Overall Resume Score</span>
                                <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                                    {Math.round(currentAnalysis.overall_score || 0)}
                                    <span className="text-lg text-slate-400 dark:text-slate-500 font-normal"> / 100</span>
                                </span>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 text-center">
                                <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">ATS Compatibility</span>
                                <span className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
                                    {Math.round(analysis.ats_compatibility?.score || currentAnalysis.overall_score || 0)}
                                    <span className="text-lg text-slate-400 dark:text-slate-500 font-normal"> / 100</span>
                                </span>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 text-center">
                                <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Content & Structure Quality</span>
                                <span className="text-3xl font-extrabold text-purple-600 dark:text-purple-400">
                                    {Math.round(analysis.resume_quality?.score || currentAnalysis.overall_score || 0)}
                                    <span className="text-lg text-slate-400 dark:text-slate-500 font-normal"> / 100</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Strengths & Weaknesses */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
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
                        </div>

                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
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
                        </div>
                    </div>

                    {/* Missing Information (Never Hallucinate Policy Card) */}
                    <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-500/30 rounded-2xl p-6 shadow-xs">
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
                    </div>

                    {/* Actionable Recommendations */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
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
                    </div>

                    {/* 9 Structured Dimensions Accordions/Grids */}
                    <div className="space-y-4">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Layers className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            Detailed 9-Dimension Assessment Breakdown
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 1. Technical Skills */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs">
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
                            </div>

                            {/* 2. Soft Skills */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs">
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
                            </div>

                            {/* 3. DSA Indicators */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs">
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
                            </div>

                            {/* 4. Education */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs">
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
                            </div>

                            {/* 5. Projects */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs md:col-span-2">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                                    <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Projects
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {((analysis.projects?.items || analysis.projects) || []).length > 0 ? (
                                        ((analysis.projects?.items || analysis.projects)).map((proj, i) => (
                                            <div key={i} className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800 rounded-lg p-3 text-xs">
                                                <p className="font-semibold text-slate-900 dark:text-white">{proj.name || `Project ${i+1}`}</p>
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
                            </div>

                            {/* 6. Experience */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs">
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
                            </div>

                            {/* 7. Certifications */}
                            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-xs">
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
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentResumeUpload;
