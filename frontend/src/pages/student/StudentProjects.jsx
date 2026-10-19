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
    Layers,
    HelpCircle,
    TrendingUp,
    X,
    FileText,
    ScanText,
    Brain,
    ShieldCheck,
    ListChecks,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero, Stagger, StaggerItem, EmptyState, AnimatedBar } from '../../components/student-ui/StudentMotion';
import { Counter, EASE } from '../../components/home/primitives';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';

const RING_COLORS = { emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e' };
const ringTone = (v) => ((Number(v) || 0) >= 70 ? 'emerald' : (Number(v) || 0) >= 45 ? 'amber' : 'rose');

/** Animated architecture score ring. Purely presentational. */
const ScoreRing = ({ value, size = 84 }) => {
    const reduce = useReducedMotion();
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    const stroke = 7;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const target = c * (1 - v / 100);
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Architecture score ${Math.round(v)} percent`}>
            <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-slate-800" />
                <motion.circle
                    key={Math.round(v)}
                    cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
                    stroke={RING_COLORS[ringTone(v)]}
                    strokeDasharray={c}
                    initial={{ strokeDashoffset: reduce ? target : c }}
                    animate={{ strokeDashoffset: target }}
                    transition={{ duration: 1.2, ease: EASE, delay: 0.1 }}
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-black tabular-nums text-slate-900 dark:text-white">
                <Counter key={Math.round(v)} to={Math.round(v)} suffix="%" />
            </div>
        </div>
    );
};

const ANALYZE_STAGES = [
    { icon: ScanText, label: 'Reading your repo description' },
    { icon: Layers, label: 'Reviewing architecture' },
    { icon: ShieldCheck, label: 'Checking code quality' },
    { icon: HelpCircle, label: 'Writing interview questions' },
    { icon: ListChecks, label: 'Drafting resume bullet points' },
];
const ANALYZE_TIPS = [
    'Mention scale, caching, and database choices. Reviewers love specifics.',
    'Every project should have a number: users, latency, test coverage, or throughput.',
    'Copy the STAR bullets straight into your resume once the review is ready.',
];

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
            <AssessmentLoadingOverlay
                open={isAnalyzing || isSubmitting}
                title="Reviewing your project"
                subtitle="Our AI is reading it like a senior interviewer would."
                stages={ANALYZE_STAGES}
                tips={ANALYZE_TIPS}
                footnote="Please keep this page open. This usually takes a few seconds."
            />

            {/* Header banner */}
            <PageHero
                icon={FolderGit2}
                eyebrow="Portfolio Intelligence"
                title="Technical Projects & Architecture Review"
                subtitle="Showcase your engineering work, get deep architectural critiques, and prep for technical interview questions."
                actions={(
                    <button
                        onClick={handleOpenCreate}
                        className="px-5 h-11 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all shadow-xs hover:shadow-lg hover:shadow-emerald-500/25 active:scale-95 flex items-center gap-2 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        Add Project
                    </button>
                )}
            />

            {/* Notifications */}
            {successMessage && (
                <div role="status" className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-3 text-sm animate-fadeIn">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>{successMessage}</span>
                </div>
            )}
            {error && (
                <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-xl flex items-center gap-3 text-sm animate-fadeIn">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Main Content: Split layout with Projects list & Active Deep Dive */}
            {isLoading ? (
                <div className="space-y-4">
                    <div className="py-4 text-center text-slate-500 dark:text-slate-400 text-sm">Loading projects...</div>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" aria-hidden="true">
                        <div className="lg:col-span-5 space-y-4">
                            {[0, 1].map(i => (
                                <div key={i} className="h-36 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse motion-reduce:animate-none" />
                            ))}
                        </div>
                        <div className="lg:col-span-7 h-72 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse motion-reduce:animate-none" />
                    </div>
                </div>
            ) : projects.length === 0 ? (
                <EmptyState
                    icon={FolderGit2}
                    title="No Portfolio Projects Added Yet"
                    body="Adding full-stack, distributed, or algorithmic projects demonstrates real-world software engineering depth to recruiters."
                    action={(
                        <button
                            onClick={handleOpenCreate}
                            className="px-5 h-11 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all shadow-xs hover:shadow-lg hover:shadow-emerald-500/25 active:scale-95 inline-flex items-center gap-2 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" />
                            Add Your First Project
                        </button>
                    )}
                />
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Column: Project Cards List (5 cols) */}
                    <Stagger className="lg:col-span-5 space-y-4" gap={0.07}>
                        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
                            <span>Your Projects ({projects.length})</span>
                            <span>Click card to inspect</span>
                        </div>

                        {projects.map((proj) => {
                            const isSelected = activeDetailProject?.id === proj.id;
                            return (
                                <StaggerItem key={proj.id}>
                                <div
                                    onClick={() => setActiveDetailProject(proj)}
                                    className={`p-4 sm:p-5 rounded-2xl border transition-all duration-300 cursor-pointer relative hover:-translate-y-0.5 hover:shadow-lg ${
                                        isSelected
                                            ? 'bg-emerald-50/70 dark:bg-slate-800/90 border-emerald-500/60 dark:border-emerald-500/50 ring-1 ring-emerald-500/30 shadow-xs'
                                            : 'bg-white dark:bg-slate-800/40 border-slate-200/90 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/70 hover:border-slate-300 dark:hover:border-slate-600 shadow-xs'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 break-words group-hover:text-emerald-600 dark:group-hover:text-emerald-300">
                                                {proj.title}
                                            </h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                                                {proj.description}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end shrink-0">
                                            <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                                                {proj.completeness_score}%
                                            </span>
                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Completeness</span>
                                        </div>
                                    </div>
                                    <AnimatedBar value={proj.completeness_score} tone={ringTone(proj.completeness_score)} height="h-1" className="mt-3" label="Completeness" />

                                    {/* Tech stack badges */}
                                    {proj.tech_stack && proj.tech_stack.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-3">
                                            {proj.tech_stack.slice(0, 4).map((tech, idx) => (
                                                <span 
                                                    key={idx}
                                                    className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 transition-colors hover:border-emerald-400 dark:hover:border-emerald-500/60"
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
                                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/50 text-xs">
                                        <div className="flex items-center gap-3">
                                            {proj.github_url && (
                                                <a
                                                    href={proj.github_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 flex items-center gap-1 min-h-[40px]"
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
                                                    className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 min-h-[40px]"
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
                                                className="p-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                                title="Edit Project"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(proj.id);
                                                }}
                                                className="p-2.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                                                title="Delete Project"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                </StaggerItem>
                            );
                        })}
                    </Stagger>

                    {/* Right Column: Deep Architectural Critique & Interview Drilldown (7 cols) */}
                    <div className="lg:col-span-7">
                        {activeDetailProject ? (
                            <motion.div
                                key={activeDetailProject.id}
                                initial={{ opacity: 0, y: 18 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, ease: EASE }}
                                className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-6"
                            >
                                {/* Title and refresh action */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <ScoreRing value={activeDetailProject.completeness_score} size={84} />
                                        <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-500/30">
                                                AI Architecture Review
                                            </span>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                Score: {activeDetailProject.completeness_score}%
                                            </span>
                                        </div>
                                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 break-words">
                                            {activeDetailProject.title}
                                        </h2>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => handleTriggerAnalyze(activeDetailProject.id)}
                                        disabled={isAnalyzing}
                                        className="px-4 min-h-[44px] bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 rounded-xl font-medium text-xs transition-all border border-emerald-200 dark:border-emerald-500/30 flex items-center gap-1.5 self-start sm:self-auto disabled:opacity-50 shadow-xs active:scale-95"
                                    >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        {isAnalyzing ? 'Re-analyzing...' : 'Refresh Review'}
                                    </button>
                                </div>

                                {/* Architecture Review Section */}
                                <motion.div className="space-y-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: EASE }}>
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                        System Design & Architecture Critique
                                    </h3>
                                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                                        {activeDetailProject.architecture_review || 'Architectural critique processing...'}
                                    </div>
                                </motion.div>

                                {/* Likely Interview Questions */}
                                <motion.div className="space-y-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2, ease: EASE }}>
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                        <HelpCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                                        Predicted Technical Interview Questions
                                    </h3>
                                    <div className="space-y-2">
                                        {(activeDetailProject.suggested_interview_questions || []).map((q, idx) => (
                                            <motion.div
                                                key={idx}
                                                initial={{ opacity: 0, x: -12 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ duration: 0.4, delay: 0.3 + Math.min(idx, 6) * 0.06, ease: EASE }}
                                                className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800 flex items-start gap-3 text-xs"
                                            >
                                                <span className="w-5 h-5 flex items-center justify-center bg-teal-50 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 font-bold rounded text-[11px] shrink-0 border border-teal-200 dark:border-transparent">
                                                    Q{idx + 1}
                                                </span>
                                                <p className="text-slate-800 dark:text-slate-200 font-medium leading-relaxed">
                                                    "{q}"
                                                </p>
                                            </motion.div>
                                        ))}
                                    </div>
                                </motion.div>

                                {/* Resume STAR Bullet Points with Copy Action */}
                                <motion.div className="space-y-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3, ease: EASE }}>
                                    <div className="flex flex-wrap items-center justify-between gap-1">
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                            ATS Resume Bullet Points (STAR Format)
                                        </h3>
                                        <span className="text-[11px] text-slate-400 dark:text-slate-500">Ready for resume insertion</span>
                                    </div>

                                    <div className="space-y-2">
                                        {(activeDetailProject.bullet_point_improvements || []).map((bullet, idx) => (
                                            <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-start justify-between gap-3 text-xs group">
                                                <p className="text-slate-700 dark:text-slate-300 leading-relaxed min-w-0 break-words">
                                                    • {bullet}
                                                </p>
                                                <button
                                                    onClick={() => handleCopyBullet(bullet, idx)}
                                                    className="p-2.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all active:scale-90 shrink-0 border border-slate-200 dark:border-slate-700"
                                                    title="Copy bullet"
                                                >
                                                    {copiedBulletIdx === idx ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                    ) : (
                                                        <Copy className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>

                                {/* Actionable Upgrade Recommendations */}
                                {(activeDetailProject.recommendations || []).length > 0 && (
                                    <motion.div className="space-y-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4, ease: EASE }}>
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                            Recommended Architectural Enhancements
                                        </h3>
                                        <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 space-y-2">
                                            {activeDetailProject.recommendations.map((rec, idx) => (
                                                <div key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                                                    <span className="text-amber-600 dark:text-amber-400 font-bold">•</span>
                                                    <span>{rec}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </motion.div>
                        ) : (
                            <div className="bg-white dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-700/60 rounded-2xl p-6 sm:p-12 text-center text-slate-500 dark:text-slate-400 shadow-xs">
                                Select a project from the left to view architectural review.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* CREATE / EDIT PROJECT MODAL */}
            <AnimatePresence>
            {isFormOpen && (
                <motion.div
                    key="project-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
                >
                    <motion.div
                        initial={{ opacity: 0, y: 40, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 24, scale: 0.98 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl"
                    >
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
                            <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                <FolderGit2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                {editingProjectId ? 'Edit Project' : 'Add New Portfolio Project'}
                            </h3>
                            <button
                                onClick={() => setIsFormOpen(false)}
                                aria-label="Close"
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                                    Project Title *
                                </label>
                                <input
                                    type="text"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    required
                                    placeholder="e.g. Distributed Task Queue & Telemetry Engine"
                                    className="w-full px-4 py-2.5 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                                    Technical Architecture & Description *
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    required
                                    rows={4}
                                    placeholder="Describe the system architecture, caching strategy, concurrency model, database schema, and throughput..."
                                    className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none font-sans leading-relaxed"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                                    Tech Stack (Comma-separated)
                                </label>
                                <input
                                    type="text"
                                    value={formData.tech_stack_input}
                                    onChange={(e) => setFormData({ ...formData, tech_stack_input: e.target.value })}
                                    placeholder="e.g. Python, FastAPI, Redis, PostgreSQL, Docker"
                                    className="w-full px-4 py-2.5 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                                        GitHub Repository URL
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.github_url}
                                        onChange={(e) => setFormData({ ...formData, github_url: e.target.value })}
                                        placeholder="https://github.com/..."
                                        className="w-full px-4 py-2.5 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                                        Live Demo URL
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.live_url}
                                        onChange={(e) => setFormData({ ...formData, live_url: e.target.value })}
                                        placeholder="https://..."
                                        className="w-full px-4 py-2.5 min-h-[44px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setIsFormOpen(false)}
                                    className="px-4 min-h-[44px] bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-5 h-11 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition-all shadow-xs active:scale-95 flex items-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                                >
                                    <Sparkles className="w-4 h-4" />
                                    {isSubmitting ? 'Analyzing & Saving...' : (editingProjectId ? 'Update Project' : 'Save & Analyze Project')}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
            </AnimatePresence>
        </div>
    );
};

export default StudentProjects;
