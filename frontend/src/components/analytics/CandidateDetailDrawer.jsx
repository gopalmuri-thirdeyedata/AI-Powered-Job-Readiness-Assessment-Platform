import React, { useState, useEffect } from 'react';
import {
    X,
    Mail,
    Briefcase,
    Sparkles,
    Copy,
    Check,
    ExternalLink,
    Code,
    BookOpen,
    MessageSquare,
    FileCheck,
    Phone,
    Calendar,
    Hash,
} from 'lucide-react';

export default function CandidateDetailDrawer({ candidate, isOpen, onClose }) {
    const [copiedEmail, setCopiedEmail] = useState(false);

    // Keyboard Escape to close drawer
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !candidate) return null;

    const handleCopyEmail = (email) => {
        if (!email) return;
        navigator.clipboard.writeText(email);
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
    };

    // Candidate initials derived from actual candidate name
    const getInitials = (name) => {
        if (!name || typeof name !== 'string') return 'C';
        const parts = name.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return 'C';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    };

    // Extract scoring & metadata safely
    const analysis = candidate.analysis_data || {};
    const effectiveScore = typeof candidate.score === 'number' 
        ? Math.round(candidate.score) 
        : (typeof candidate.score === 'string' && !isNaN(Number(candidate.score)))
            ? Math.round(Number(candidate.score))
            : (analysis.score_percentage !== undefined ? Math.round(analysis.score_percentage) : null);

    // Rounds breakdown
    const resumeScore = analysis.resume_score ?? analysis.screening_score ?? (effectiveScore !== null ? effectiveScore : null);
    
    // Aptitude round
    const aptitudeScore = analysis.aptitude_score ?? analysis.aptitude?.score_percentage ?? null;
    const aptitudePassed = analysis.aptitude?.passed ?? (aptitudeScore !== null ? aptitudeScore >= 60 : null);
    
    // Coding round
    const codingScore = analysis.coding_score ?? analysis.coding?.score_percentage ?? null;
    const codingPassed = analysis.coding?.passed ?? (codingScore !== null ? codingScore >= 60 : null);
    
    // Technical Interview round
    const interviewScore = analysis.interview_score ?? analysis.interview?.score ?? null;

    // Skills
    const skillsList = Array.isArray(candidate.skills) && candidate.skills.length > 0
        ? candidate.skills
        : Array.isArray(analysis.skills)
            ? analysis.skills
            : Array.isArray(analysis.extracted_skills)
                ? analysis.extracted_skills
                : [];

    // Recruiter summary (strictly sanitized: no internal prompts, no hidden reasoning/CoT tokens)
    const recruiterSummary = analysis.executive_summary 
        || analysis.summary 
        || analysis.recommendation_reason 
        || analysis.feedback 
        || (candidate.notes ? candidate.notes : null);

    // Recommendation badge styling
    const recText = candidate.recommendation || analysis.recommendation || (effectiveScore >= 75 ? 'Strong Hire' : effectiveScore >= 60 ? 'Consider' : effectiveScore !== null ? 'Review' : 'Pending Evaluation');
    const getRecBadge = (rec) => {
        const lower = String(rec).toLowerCase();
        if (lower.includes('strong') || lower.includes('hire')) {
            return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
        }
        if (lower.includes('consider') || lower.includes('pass')) {
            return 'bg-blue-500/15 text-blue-400 border border-blue-500/30';
        }
        if (lower.includes('review') || lower.includes('hold')) {
            return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
        }
        return 'bg-slate-800 text-slate-300 border border-slate-700';
    };

    // Format experience accurately (no fake '0 years' if data is missing)
    const formatExperience = (exp) => {
        if (!exp && exp !== 0) return 'Not available';
        if (typeof exp === 'string') {
            const trimmed = exp.trim();
            if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined' || trimmed === '0' || trimmed.toLowerCase() === '0 years') {
                return 'Not available';
            }
            return trimmed;
        }
        if (typeof exp === 'number') {
            if (exp <= 0) return 'Not available';
            return `${exp} ${exp === 1 ? 'year' : 'years'}`;
        }
        return 'Not available';
    };

    const experienceDisplay = formatExperience(candidate.experience || analysis.experience);

    // Format applied date
    const formatAppliedDate = (dateStr) => {
        if (!dateStr) return 'Not available';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return 'Not available';
            return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        } catch {
            return 'Not available';
        }
    };

    const candidateInitials = getInitials(candidate.name);
    const appliedRole = candidate.applied_role || candidate.role || 'Full Stack Software Engineer';

    return (
        <div 
            className="fixed inset-0 z-50 overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Candidate Profile"
        >
            {/* Backdrop: subtle rgba(0, 0, 0, 0.45) with slight blur */}
            <div 
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300"
                onClick={onClose}
            />

            {/* Right-Side Drawer Container */}
            <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
                <div className="w-screen max-w-full sm:max-w-[480px] bg-[#0F172A] border-l border-slate-800 text-slate-100 shadow-2xl flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-300">
                    
                    {/* 1. FIXED HEADER */}
                    <div className="p-6 border-b border-slate-800/80 bg-[#0F172A]/95 backdrop-blur-md shrink-0 z-10 space-y-4">
                        {/* Top Row: AI Rating + Current Stage + Close Button */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold tracking-wide ${getRecBadge(recText)}`}>
                                    {recText}
                                </span>
                                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800/90 text-slate-300 border border-slate-700/80">
                                    {candidate.stage || 'Resume Screening'}
                                </span>
                            </div>
                            <button 
                                type="button"
                                onClick={onClose}
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
                                aria-label="Close candidate profile"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Candidate Identity: Avatar + Name + Role + Active Status */}
                        <div className="flex items-start gap-3.5">
                            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-slate-800 to-blue-500/20 border border-emerald-500/30 text-emerald-400 font-extrabold text-lg flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/5">
                                {candidateInitials}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h2 className="text-2xl font-bold text-white tracking-tight truncate leading-tight">
                                    {candidate.name || 'Anonymous Candidate'}
                                </h2>
                                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1 truncate">
                                    <Briefcase className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                    <span className="truncate">{appliedRole}</span>
                                </p>
                                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold text-emerald-400">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                    <span>{candidate.status || 'Active candidate'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 2. SCROLLABLE CONTENT BODY */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700/60 scrollbar-track-transparent hover:scrollbar-thumb-slate-600">
                        
                        {/* Contact Information Bar */}
                        <div className="bg-[#162033] rounded-xl p-3.5 border border-slate-800/80 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 text-sm text-slate-300 truncate min-w-0">
                                    <Mail className="w-4 h-4 text-emerald-400 shrink-0" />
                                    <span className="truncate font-medium">{candidate.email || 'No email provided'}</span>
                                </div>
                                {candidate.email && (
                                    <button
                                        type="button"
                                        onClick={() => handleCopyEmail(candidate.email)}
                                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors shrink-0 cursor-pointer"
                                        title="Copy email to clipboard"
                                    >
                                        {copiedEmail ? (
                                            <>
                                                <Check className="w-3 h-3 text-emerald-400" />
                                                <span className="text-emerald-400 font-semibold">Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="w-3 h-3" />
                                                <span>Copy</span>
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                            {candidate.phone && (
                                <div className="flex items-center gap-2.5 text-xs text-slate-400 border-t border-slate-800/60 pt-2">
                                    <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                    <span>{candidate.phone}</span>
                                </div>
                            )}
                        </div>

                        {/* Candidate Snapshot: 3 Equal-Height Cards */}
                        <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
                            {/* Talent Score */}
                            <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between min-h-[110px]">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Talent Score</p>
                                    <p className="text-2xl font-extrabold text-emerald-400 mt-1">
                                        {effectiveScore !== null ? `${effectiveScore}%` : '—'}
                                    </p>
                                </div>
                                {effectiveScore !== null ? (
                                    <div className="mt-2 space-y-1">
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                            <div 
                                                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(100, Math.max(0, effectiveScore))}%` }}
                                            />
                                        </div>
                                        <p className="text-[10px] text-slate-400 truncate">Overall score</p>
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-slate-500 mt-2">Pending</p>
                                )}
                            </div>

                            {/* Status */}
                            <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between min-h-[110px]">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</p>
                                    <p className="text-sm font-bold text-slate-200 mt-1.5 truncate">
                                        {candidate.status || 'Applied'}
                                    </p>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                    <span className="truncate">Active candidate</span>
                                </div>
                            </div>

                            {/* Experience */}
                            <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between min-h-[110px]">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Experience</p>
                                    <p className="text-sm font-bold text-slate-200 mt-1.5 truncate">
                                        {experienceDisplay}
                                    </p>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-2 truncate">
                                    {experienceDisplay !== 'Not available' ? 'Profile data' : 'Not recorded'}
                                </p>
                            </div>
                        </div>

                        {/* Recruiter Evaluation Brief */}
                        <div className="bg-gradient-to-br from-[#162033] to-[#0F172A] rounded-xl p-4 border border-slate-800/80 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                                <Sparkles className="w-4 h-4 shrink-0" />
                                <span>Recruiter Evaluation Brief</span>
                            </div>
                            {recruiterSummary ? (
                                <p className="text-sm text-slate-300 leading-relaxed font-normal">
                                    {typeof recruiterSummary === 'string' ? recruiterSummary : JSON.stringify(recruiterSummary)}
                                </p>
                            ) : (
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    No candidate summary available yet. Complete additional screening rounds to generate the evaluation summary.
                                </p>
                            )}
                        </div>

                        {/* Round Performance */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                    Round Performance
                                </h3>
                                <span className="text-[11px] text-slate-500 font-medium">4 Evaluation Stages</span>
                            </div>
                            
                            <div className="space-y-2.5">
                                {/* 1. Resume Screening */}
                                <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 transition-all">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                                                <FileCheck className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-200">Resume Screening</p>
                                                <p className="text-[11px] text-slate-400">Profile & JD match</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-extrabold text-emerald-400">
                                                {resumeScore !== null ? `${resumeScore}%` : '—'}
                                            </p>
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                resumeScore !== null ? (resumeScore >= 60 ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10') : 'text-slate-500'
                                            }`}>
                                                {resumeScore !== null ? (resumeScore >= 60 ? 'Passed' : 'Low match') : 'Pending'}
                                            </span>
                                        </div>
                                    </div>
                                    {resumeScore !== null && (
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1.5">
                                            <div 
                                                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(100, Math.max(0, resumeScore))}%` }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 2. Aptitude Round */}
                                <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 transition-all">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                                                <BookOpen className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-200">Aptitude Round</p>
                                                <p className="text-[11px] text-slate-400">Logic & reasoning test</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-extrabold text-blue-400">
                                                {aptitudeScore !== null ? `${aptitudeScore}%` : '—'}
                                            </p>
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                aptitudeScore !== null 
                                                    ? (aptitudePassed === true ? 'text-emerald-400 bg-emerald-500/10' : aptitudePassed === false ? 'text-rose-400 bg-rose-500/10' : 'text-blue-400 bg-blue-500/10')
                                                    : 'text-slate-500'
                                            }`}>
                                                {aptitudeScore !== null ? (aptitudePassed === true ? 'Passed' : aptitudePassed === false ? 'Failed' : 'Completed') : 'Pending'}
                                            </span>
                                        </div>
                                    </div>
                                    {aptitudeScore !== null && (
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1.5">
                                            <div 
                                                className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(100, Math.max(0, aptitudeScore))}%` }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 3. Coding Challenge */}
                                <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 transition-all">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                                <Code className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-200">Coding Challenge</p>
                                                <p className="text-[11px] text-slate-400">Algorithmic execution</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-extrabold text-indigo-400">
                                                {codingScore !== null ? `${codingScore}%` : '—'}
                                            </p>
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                codingScore !== null 
                                                    ? (codingPassed === true ? 'text-emerald-400 bg-emerald-500/10' : codingPassed === false ? 'text-rose-400 bg-rose-500/10' : 'text-indigo-400 bg-indigo-500/10')
                                                    : 'text-slate-500'
                                            }`}>
                                                {codingScore !== null ? (codingPassed === true ? 'Passed' : codingPassed === false ? 'Failed' : 'Completed') : 'Pending'}
                                            </span>
                                        </div>
                                    </div>
                                    {codingScore !== null && (
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1.5">
                                            <div 
                                                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(100, Math.max(0, codingScore))}%` }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 4. Technical Interview */}
                                <div className="bg-[#162033] border border-slate-800/80 rounded-xl p-3.5 transition-all">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
                                                <MessageSquare className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-slate-200">Technical Interview</p>
                                                <p className="text-[11px] text-slate-400">Domain interview</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-extrabold text-purple-400">
                                                {interviewScore !== null ? `${interviewScore}%` : '—'}
                                            </p>
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                interviewScore !== null ? (interviewScore >= 60 ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10') : 'text-slate-500'
                                            }`}>
                                                {interviewScore !== null ? (interviewScore >= 60 ? 'Recommended' : 'Needs Review') : 'Pending'}
                                            </span>
                                        </div>
                                    </div>
                                    {interviewScore !== null && (
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1.5">
                                            <div 
                                                className="bg-purple-500 h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(100, Math.max(0, interviewScore))}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Verified & Extracted Skills */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                    Verified & Extracted Skills
                                </h3>
                                {skillsList.length > 0 && (
                                    <span className="text-[11px] text-slate-500 font-medium">
                                        {skillsList.length} {skillsList.length === 1 ? 'skill' : 'skills'}
                                    </span>
                                )}
                            </div>
                            {skillsList.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {skillsList.map((skill, idx) => (
                                        <span 
                                            key={idx}
                                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800/90 border border-slate-700/80 text-slate-200 shadow-xs"
                                        >
                                            {skill}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 italic bg-[#162033] p-3 rounded-xl border border-slate-800/60">
                                    No verified skills extracted yet.
                                </p>
                            )}
                        </div>

                        {/* Candidate Information Metadata */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                Candidate Information
                            </h3>
                            <div className="bg-[#162033] rounded-xl p-4 border border-slate-800/80 divide-y divide-slate-800/60 text-xs">
                                <div className="flex items-center justify-between pb-2.5">
                                    <span className="text-slate-400 flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                        Applied
                                    </span>
                                    <span className="font-semibold text-slate-200">{formatAppliedDate(candidate.created_at)}</span>
                                </div>
                                <div className="flex items-center justify-between py-2.5">
                                    <span className="text-slate-400 flex items-center gap-1.5">
                                        <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                                        Job Role
                                    </span>
                                    <span className="font-semibold text-slate-200 truncate max-w-[200px]">{appliedRole}</span>
                                </div>
                                <div className="flex items-center justify-between pt-2.5">
                                    <span className="text-slate-400 flex items-center gap-1.5">
                                        <Hash className="w-3.5 h-3.5 text-slate-500" />
                                        Candidate ID
                                    </span>
                                    <span className="font-mono font-semibold text-emerald-400">#{candidate.id}</span>
                                </div>
                            </div>
                        </div>

                        {/* Candidate Timeline */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                Candidate Timeline
                            </h3>
                            <div className="bg-[#162033] rounded-xl p-4 border border-slate-800/80 space-y-3 text-xs">
                                {/* Milestone 1: Application */}
                                <div className="flex items-start gap-2.5">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0"></div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-slate-200">Application submitted</p>
                                        <p className="text-[11px] text-slate-400">{formatAppliedDate(candidate.created_at)}</p>
                                    </div>
                                </div>

                                {/* Milestone 2: Resume Screening */}
                                <div className="flex items-start gap-2.5">
                                    <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${resumeScore !== null ? 'bg-emerald-400' : 'bg-slate-600'}`}></div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-slate-200">
                                            {resumeScore !== null ? `Resume screening completed (${resumeScore}%)` : 'Resume screening'}
                                        </p>
                                        <p className="text-[11px] text-slate-400">
                                            {resumeScore !== null ? (candidate.created_at ? formatAppliedDate(candidate.created_at) : 'Completed') : 'Pending'}
                                        </p>
                                    </div>
                                </div>

                                {/* Milestone 3: Assessment */}
                                <div className="flex items-start gap-2.5">
                                    <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                                        (aptitudeScore !== null || codingScore !== null) ? 'bg-emerald-400' : 
                                        (candidate.stage === 'Aptitude Round' || candidate.stage === 'Coding Round') ? 'bg-blue-400' : 'bg-slate-600'
                                    }`}></div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-slate-200">
                                            {(aptitudeScore !== null || codingScore !== null) 
                                                ? 'Technical assessments completed' 
                                                : (candidate.stage === 'Aptitude Round' || candidate.stage === 'Coding Round')
                                                    ? 'Assessment in progress'
                                                    : 'Aptitude & Coding assessments'}
                                        </p>
                                        <p className="text-[11px] text-slate-400">
                                            {(aptitudeScore !== null || codingScore !== null) ? 'Completed' : 'Pending'}
                                        </p>
                                    </div>
                                </div>

                                {/* Milestone 4: Technical Interview */}
                                <div className="flex items-start gap-2.5">
                                    <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                                        interviewScore !== null ? 'bg-emerald-400' : 
                                        candidate.stage === 'Technical Interview' ? 'bg-purple-400' : 'bg-slate-600'
                                    }`}></div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-slate-200">
                                            {interviewScore !== null 
                                                ? `Technical interview completed (${interviewScore}%)` 
                                                : candidate.stage === 'Technical Interview'
                                                    ? 'Candidate moved to interview'
                                                    : 'Technical interview'}
                                        </p>
                                        <p className="text-[11px] text-slate-400">
                                            {interviewScore !== null ? 'Completed' : 'Pending'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* 3. FIXED ACTION FOOTER */}
                    <div className="p-4 border-t border-slate-800/80 bg-[#0F172A]/95 backdrop-blur-md shrink-0 flex items-center justify-between gap-3 z-10">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer border border-slate-700/60"
                        >
                            Close
                        </button>
                        <div className="flex items-center gap-2">
                            {candidate.email && (
                                <a
                                    href={`mailto:${candidate.email}`}
                                    className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5 border border-slate-700/60"
                                    title={`Email ${candidate.name || 'candidate'}`}
                                >
                                    <Mail size={15} />
                                    <span className="hidden sm:inline">Email</span>
                                </a>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    window.location.href = `/screened-candidates?search=${encodeURIComponent(candidate.name || '')}`;
                                }}
                                className="px-4 py-2.5 bg-[#5d8c2c] hover:bg-[#4d7424] text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-[#5d8c2c]/20 flex items-center gap-1.5 cursor-pointer"
                            >
                                <span>View Candidate</span>
                                <ExternalLink size={14} />
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
