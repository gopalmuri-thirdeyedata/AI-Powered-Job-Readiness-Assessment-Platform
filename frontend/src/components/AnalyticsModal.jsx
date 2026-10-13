import React from 'react';
import { motion } from 'framer-motion';
import { X, Brain, AlertCircle, CheckCircle, Sparkles, TrendingUp, FileText } from 'lucide-react';
import API_URL from '../apiConfig';

const hasResumeFile = (resumeFile) => {
    if (!resumeFile) return false;
    const fileStr = String(resumeFile).trim().toLowerCase();
    return fileStr !== "" && fileStr !== "null" && fileStr !== "undefined" && fileStr !== "n/a" && fileStr !== "none";
};

const AnalyticsModal = ({ candidate, onClose, onViewResume }) => {
    const [weights, setWeights] = React.useState({
        skills: 40,
        experience: 25,
        projects: 20,
        education: 10,
        bonus: 5
    });

    React.useEffect(() => {
        fetch(`${API_URL}/api/settings/`)
            .then(res => res.json())
            .then(data => {
                if (data && data.scoring) {
                    setWeights(data.scoring);
                }
            })
            .catch(err => console.error("Failed to load settings in modal", err));
    }, []);

    if (!candidate) return null;

    const analysis = candidate.analysis_data || candidate.analysis || {};
    const scores = analysis.component_scores || {};
    const matchedSkills = analysis.key_skills_match || [];
    const missingSkills = analysis.missing_skills || [];
    const strengths = analysis.strengths || [];
    const gaps = analysis.gaps || [];

    // Helper for score bar
    const ScoreBar = ({ label, value, max, textColor, bgColor }) => (
        <div className="mb-3">
            <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-gray-600">{label}</span>
                <span className={`font-black ${textColor}`}>{value}/{max}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(value / max) * 100}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={`h-full rounded-full ${bgColor}`}
                />
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col relative z-50"
            >
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h2 className="text-2xl font-bold text-gray-900">{candidate.name}</h2>
                            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide">
                                {analysis.extracted_role || candidate.role}
                            </span>
                            {hasResumeFile(candidate.resume_file) && (
                                <button
                                    onClick={() => {
                                        let resumeUrl = candidate.resume_file;
                                        if (!resumeUrl.startsWith('http')) {
                                            resumeUrl = `${API_URL}/media/resumes/${resumeUrl}`;
                                        }
                                        if (onViewResume) {
                                            onViewResume(resumeUrl);
                                        } else {
                                            const token = localStorage.getItem('token');
                                            fetch(`${API_URL}/api/resume/preview-token?file_path=${encodeURIComponent(candidate.resume_file)}`, {
                                                headers: { 'Authorization': `Bearer ${token}` }
                                            })
                                            .then(r => r.ok ? r.json() : Promise.reject())
                                            .then(d => window.open(`${resumeUrl}?token=${encodeURIComponent(d.preview_token)}`, '_blank'))
                                            .catch(() => {
                                                fetch(resumeUrl, { headers: { 'Authorization': `Bearer ${token}` } })
                                                    .then(r => r.blob())
                                                    .then(blob => window.open(URL.createObjectURL(blob), '_blank'))
                                                    .catch(() => alert("Failed to load candidate resume."));
                                            });
                                        }
                                    }}
                                    className="ml-3 px-3 py-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 hover:text-gray-900 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm"
                                >
                                    <FileText size={14} className="text-gray-500" />
                                    <span>View Resume</span>
                                </button>
                            )}
                        </div>
                        <p className="text-sm text-gray-500 flex items-center gap-2">
                            <Brain size={14} className="text-purple-500" /> AI Analysis Report
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                        <X size={20} />
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                        {/* LEFT: Scores */}
                        <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 h-fit">
                            <div className="text-center mb-6">
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Match</div>
                                <div className={`text-6xl font-black ${candidate.score >= 80 ? 'text-green-600' : candidate.score >= 60 ? 'text-green-600' : 'text-red-500'}`}>
                                    {candidate.score}%
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2 mb-3">Scoring Breakdown</h4>
                                <ScoreBar label="Skills Match" value={scores.skills || 0} max={weights.skills} textColor="text-blue-600" bgColor="bg-blue-600" />
                                <ScoreBar label="Experience" value={scores.experience || 0} max={weights.experience} textColor="text-indigo-600" bgColor="bg-indigo-600" />
                                <ScoreBar label="Project Alignment" value={scores.projects || 0} max={weights.projects} textColor="text-purple-600" bgColor="bg-purple-600" />
                                <ScoreBar label="Education" value={scores.education || 0} max={weights.education} textColor="text-teal-600" bgColor="bg-teal-600" />
                                <ScoreBar label="Bonus" value={scores.bonus || 0} max={weights.bonus} textColor="text-green-500" bgColor="bg-green-500" />
                            </div>
                        </div>

                        {/* RIGHT: Details */}
                        <div className="lg:col-span-2 space-y-6">

                            {/* Reasoning */}
                            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-blue-800 flex items-center gap-2 mb-2">
                                    <Sparkles size={16} /> AI Executive Summary
                                </h3>
                                <p className="text-sm text-gray-700 leading-relaxed">
                                    {analysis.reasoning || candidate.reasoning || "No detailed reasoning provided."}
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Strengths */}
                                <div>
                                    <h4 className="text-sm font-bold text-green-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                                        <TrendingUp size={16} /> Strengths
                                    </h4>
                                    <ul className="space-y-2">
                                        {strengths.length > 0 ? strengths.map((s, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-green-50 p-2 rounded">
                                                <CheckCircle size={14} className="text-green-600 mt-0.5 flex-shrink-0" />
                                                <span>{s}</span>
                                            </li>
                                        )) : (
                                            <li className="text-gray-400 text-sm italic">No specific strengths listed.</li>
                                        )}
                                    </ul>
                                </div>

                                {/* Gaps */}
                                <div>
                                    <h4 className="text-sm font-bold text-red-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                                        <AlertCircle size={16} /> Areas of Concern
                                    </h4>
                                    <ul className="space-y-2">
                                        {gaps.length > 0 ? gaps.map((s, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-red-50 p-2 rounded">
                                                <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                                                <span>{s}</span>
                                            </li>
                                        )) : (
                                            <li className="text-gray-400 text-sm italic">No major concerns found.</li>
                                        )}
                                    </ul>
                                </div>
                            </div>

                            {/* Skills Tag Cloud */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-900 border-b border-gray-100 pb-2 mb-3">Skill Matching Analysis</h4>
                                <div className="space-y-3">
                                    <div>
                                        <div className="text-xs text-green-600 font-bold mb-1.5">Matched Skills</div>
                                        <div className="flex flex-wrap gap-2">
                                            {matchedSkills.map((s, i) => (
                                                <span key={i} className="px-2.5 py-1 bg-green-100 text-green-700 rounded-md text-xs font-semibold border border-green-200">
                                                    {s}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {missingSkills.length > 0 && (
                                        <div>
                                            <div className="text-xs text-red-600 font-bold mb-1.5">Missing Requirements</div>
                                            <div className="flex flex-wrap gap-2">
                                                {missingSkills.map((s, i) => (
                                                    <span key={i} className="px-2.5 py-1 bg-red-50 text-red-700 rounded-md text-xs font-semibold border border-red-200 line-through decoration-red-300">
                                                        {s}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default AnalyticsModal;
