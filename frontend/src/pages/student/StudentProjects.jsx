import React, { useState, useEffect } from 'react';
import { 
    FolderGit2, 
    Plus, 
    ExternalLink, 
    Github, 
    Sparkles, 
    CheckCircle2, 
    AlertCircle, 
    Edit2, 
    Trash2, 
    Copy, 
    Check, 
    Code, 
    Layers, 
    ShieldCheck, 
    Lightbulb, 
    HelpCircle, 
    TrendingUp,
    X,
    FileText
} from 'lucide-react';
import studentApi from '../../services/studentApi';

const StudentProjects = () => {
    const [projects, setProjects] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);

    // Modal state for Create / Edit
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingProjectId, setEditingProjectId] = useState(null);
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        tech_stack_input: '',
        github_url: '',
        live_url: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Detailed Review View state
    const [activeDetailProject, setActiveDetailProject] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [copiedBulletIdx, setCopiedBulletIdx] = useState(null);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await studentApi.getProjects();
            setProjects(data || []);
            if (data && data.length > 0 && !activeDetailProject) {
                setActiveDetailProject(data[0]);
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to load projects.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setEditingProjectId(null);
        setFormData({
            title: '',
            description: '',
            tech_stack_input: '',
            github_url: '',
            live_url: ''
        });
        setIsFormOpen(true);
    };

    const handleOpenEdit = (proj) => {
        setEditingProjectId(proj.id);
        setFormData({
            title: proj.title,
            description: proj.description,
            tech_stack_input: (proj.tech_stack || []).join(', '),
            github_url: proj.github_url || '',
            live_url: proj.live_url || ''
        });
        setIsFormOpen(true);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        const techArray = formData.tech_stack_input
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const payload = {
            title: formData.title.trim(),
            description: formData.description.trim(),
            tech_stack: techArray,
            github_url: formData.github_url.trim() || null,
            live_url: formData.live_url.trim() || null
        };

        try {
            if (editingProjectId) {
                const updated = await studentApi.updateProject(editingProjectId, payload);
                setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                if (activeDetailProject?.id === updated.id) {
                    setActiveDetailProject(updated);
                }
                setSuccessMessage('Project updated and re-analyzed successfully.');
            } else {
                const created = await studentApi.createProject(payload);
                setProjects(prev => [created, ...prev]);
                setActiveDetailProject(created);
                setSuccessMessage('Project added and analyzed with AI review!');
            }
            setIsFormOpen(false);
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to save project.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (projectId) => {
        if (!window.confirm('Are you sure you want to delete this project?')) return;
        try {
            await studentApi.deleteProject(projectId);
            setProjects(prev => prev.filter(p => p.id !== projectId));
            if (activeDetailProject?.id === projectId) {
                const remaining = projects.filter(p => p.id !== projectId);
                setActiveDetailProject(remaining[0] || null);
            }
            setSuccessMessage('Project removed.');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError('Failed to delete project.');
        }
    };

    const handleTriggerAnalyze = async (projectId) => {
        setIsAnalyzing(true);
        setError(null);
        try {
            const analysis = await studentApi.analyzeProject(projectId);
            setProjects(prev => prev.map(p => {
                if (p.id === projectId) {
                    return {
                        ...p,
                        ...analysis
                    };
                }
                return p;
            }));
            if (activeDetailProject?.id === projectId) {
                setActiveDetailProject(prev => ({
                    ...prev,
                    ...analysis
                }));
            }
            setSuccessMessage('AI Architecture Review refreshed!');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError('Failed to refresh project analysis.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleCopyBullet = (text, idx) => {
        navigator.clipboard.writeText(text);
        setCopiedBulletIdx(idx);
        setTimeout(() => setCopiedBulletIdx(null), 2000);
    };

    return (
        <div className="space-y-6">
            {/* Header banner */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                        <FolderGit2 className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            Technical Projects & Architecture Review
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
                                Portfolio Intelligence
                            </span>
                        </h1>
                        <p className="text-slate-400 text-sm mt-0.5">
                            Showcase your engineering work, get deep architectural critiques, and prep for technical interview questions.
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleOpenCreate}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-emerald-900/30 flex items-center gap-2 self-start md:self-auto"
                >
                    <Plus className="w-4 h-4" />
                    Add Project
                </button>
            </div>

            {/* Notifications */}
            {successMessage && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    <span>{successMessage}</span>
                </div>
            )}
            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-center gap-3 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Main Content: Split layout with Projects list & Active Deep Dive */}
            {isLoading ? (
                <div className="py-16 text-center text-slate-400">Loading projects...</div>
            ) : projects.length === 0 ? (
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-12 text-center space-y-4">
                    <FolderGit2 className="w-12 h-12 mx-auto text-slate-500" />
                    <h3 className="text-lg font-bold text-slate-200">No Portfolio Projects Added Yet</h3>
                    <p className="text-sm text-slate-400 max-w-md mx-auto">
                        Adding full-stack, distributed, or algorithmic projects demonstrates real-world software engineering depth to recruiters.
                    </p>
                    <button
                        onClick={handleOpenCreate}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-sm transition-all shadow-md shadow-emerald-900/30 inline-flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Add Your First Project
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Column: Project Cards List (5 cols) */}
                    <div className="lg:col-span-5 space-y-4">
                        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">
                            <span>Your Projects ({projects.length})</span>
                            <span>Click card to inspect</span>
                        </div>

                        {projects.map((proj) => {
                            const isSelected = activeDetailProject?.id === proj.id;
                            return (
                                <div
                                    key={proj.id}
                                    onClick={() => setActiveDetailProject(proj)}
                                    className={`p-5 rounded-2xl border transition-all cursor-pointer relative ${
                                        isSelected
                                            ? 'bg-slate-800/90 border-emerald-500/50 ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-950/20'
                                            : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/70 hover:border-slate-600'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="font-bold text-base text-slate-100 group-hover:text-emerald-300">
                                                {proj.title}
                                            </h3>
                                            <p className="text-xs text-slate-400 line-clamp-2 mt-1">
                                                {proj.description}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end flex-shrink-0">
                                            <span className="text-xs font-extrabold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                                                {proj.completeness_score}%
                                            </span>
                                            <span className="text-[10px] text-slate-500 mt-0.5">Completeness</span>
                                        </div>
                                    </div>

                                    {/* Tech stack badges */}
                                    {proj.tech_stack && proj.tech_stack.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-3">
                                            {proj.tech_stack.slice(0, 4).map((tech, idx) => (
                                                <span 
                                                    key={idx}
                                                    className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-900/60 text-slate-300 border border-slate-700/60"
                                                >
                                                    {tech}
                                                </span>
                                            ))}
                                            {proj.tech_stack.length > 4 && (
                                                <span className="text-[11px] text-slate-500 px-1 py-0.5">
                                                    +{proj.tech_stack.length - 4} more
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Footer actions */}
                                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-700/50 text-xs">
                                        <div className="flex items-center gap-3">
                                            {proj.github_url && (
                                                <a
                                                    href={proj.github_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-slate-400 hover:text-slate-200 flex items-center gap-1"
                                                >
                                                    <Github className="w-3.5 h-3.5" />
                                                    Repo
                                                </a>
                                            )}
                                            {proj.live_url && (
                                                <a
                                                    href={proj.live_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                                                >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    Live
                                                </a>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenEdit(proj);
                                                }}
                                                className="p-1 text-slate-400 hover:text-slate-200 rounded"
                                                title="Edit Project"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(proj.id);
                                                }}
                                                className="p-1 text-slate-400 hover:text-red-400 rounded"
                                                title="Delete Project"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Right Column: Deep Architectural Critique & Interview Drilldown (7 cols) */}
                    <div className="lg:col-span-7">
                        {activeDetailProject ? (
                            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm space-y-6">
                                {/* Title and refresh action */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                                                AI Architecture Review
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                Score: {activeDetailProject.completeness_score}%
                                            </span>
                                        </div>
                                        <h2 className="text-xl font-bold text-slate-100 mt-1">
                                            {activeDetailProject.title}
                                        </h2>
                                    </div>

                                    <button
                                        onClick={() => handleTriggerAnalyze(activeDetailProject.id)}
                                        disabled={isAnalyzing}
                                        className="px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded-xl font-medium text-xs transition-all border border-emerald-500/30 flex items-center gap-1.5 self-start sm:self-auto disabled:opacity-50"
                                    >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        {isAnalyzing ? 'Re-analyzing...' : 'Refresh Review'}
                                    </button>
                                </div>

                                {/* Architecture Review Section */}
                                <div className="space-y-3">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-emerald-400" />
                                        System Design & Architecture Critique
                                    </h3>
                                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                                        {activeDetailProject.architecture_review || 'Architectural critique processing...'}
                                    </div>
                                </div>

                                {/* Likely Interview Questions */}
                                <div className="space-y-3">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                        <HelpCircle className="w-4 h-4 text-teal-400" />
                                        Predicted Technical Interview Questions
                                    </h3>
                                    <div className="space-y-2">
                                        {(activeDetailProject.suggested_interview_questions || []).map((q, idx) => (
                                            <div key={idx} className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 flex items-start gap-3 text-xs">
                                                <span className="w-5 h-5 flex items-center justify-center bg-teal-500/20 text-teal-300 font-bold rounded text-[11px] flex-shrink-0">
                                                    Q{idx + 1}
                                                </span>
                                                <p className="text-slate-200 font-medium leading-relaxed">
                                                    "{q}"
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Resume STAR Bullet Points with Copy Action */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-emerald-400" />
                                            ATS Resume Bullet Points (STAR Format)
                                        </h3>
                                        <span className="text-[11px] text-slate-500">Ready for resume insertion</span>
                                    </div>

                                    <div className="space-y-2">
                                        {(activeDetailProject.bullet_point_improvements || []).map((bullet, idx) => (
                                            <div key={idx} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start justify-between gap-3 text-xs group">
                                                <p className="text-slate-300 leading-relaxed">
                                                    • {bullet}
                                                </p>
                                                <button
                                                    onClick={() => handleCopyBullet(bullet, idx)}
                                                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-emerald-400 transition-colors flex-shrink-0"
                                                    title="Copy bullet"
                                                >
                                                    {copiedBulletIdx === idx ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                    ) : (
                                                        <Copy className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Actionable Upgrade Recommendations */}
                                {(activeDetailProject.recommendations || []).length > 0 && (
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            <TrendingUp className="w-4 h-4 text-amber-400" />
                                            Recommended Architectural Enhancements
                                        </h3>
                                        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                                            {activeDetailProject.recommendations.map((rec, idx) => (
                                                <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                                                    <span className="text-amber-400 font-bold">•</span>
                                                    <span>{rec}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-12 text-center text-slate-400">
                                Select a project from the left to view architectural review.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* CREATE / EDIT PROJECT MODAL */}
            {isFormOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-xl w-full space-y-4 shadow-2xl">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-700">
                            <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                                <FolderGit2 className="w-5 h-5 text-emerald-400" />
                                {editingProjectId ? 'Edit Project' : 'Add New Portfolio Project'}
                            </h3>
                            <button
                                onClick={() => setIsFormOpen(false)}
                                className="text-slate-400 hover:text-slate-200 p-1"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                    Project Title *
                                </label>
                                <input
                                    type="text"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    required
                                    placeholder="e.g. Distributed Task Queue & Telemetry Engine"
                                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                    Technical Architecture & Description *
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    required
                                    rows={4}
                                    placeholder="Describe the system architecture, caching strategy, concurrency model, database schema, and throughput..."
                                    className="w-full p-3.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none font-sans leading-relaxed"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                    Tech Stack (Comma-separated)
                                </label>
                                <input
                                    type="text"
                                    value={formData.tech_stack_input}
                                    onChange={(e) => setFormData({ ...formData, tech_stack_input: e.target.value })}
                                    placeholder="e.g. Python, FastAPI, Redis, PostgreSQL, Docker"
                                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                        GitHub Repository URL
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.github_url}
                                        onChange={(e) => setFormData({ ...formData, github_url: e.target.value })}
                                        placeholder="https://github.com/..."
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                                        Live Demo URL
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.live_url}
                                        onChange={(e) => setFormData({ ...formData, live_url: e.target.value })}
                                        placeholder="https://..."
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setIsFormOpen(false)}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Sparkles className="w-4 h-4" />
                                    {isSubmitting ? 'Analyzing & Saving...' : (editingProjectId ? 'Update Project' : 'Save & Analyze Project')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentProjects;
