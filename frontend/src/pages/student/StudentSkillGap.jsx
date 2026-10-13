import React, { useState, useEffect } from 'react';
import { 
    Target, 
    CheckCircle2, 
    XCircle, 
    AlertTriangle, 
    TrendingUp, 
    Sparkles, 
    BookOpen, 
    Compass, 
    Award, 
    Layers, 
    ArrowRight,
    RefreshCw,
    Plus,
    X,
    Building2
} from 'lucide-react';
import { Link } from 'react-router-dom';
import studentApi from '../../services/studentApi';

const StudentSkillGap = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [targetRoles, setTargetRoles] = useState([]);
    const [activeGap, setActiveGap] = useState(null);
    const [selectedRole, setSelectedRole] = useState('');
    const [careerPaths, setCareerPaths] = useState(null);
    
    // What-If Simulator state
    const [simulatedSkills, setSimulatedSkills] = useState([]);
    const [hypotheticalInput, setHypotheticalInput] = useState('');
    const [isSimulating, setIsSimulating] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [roles, gap, paths] = await Promise.all([
                studentApi.getTargetRoles(),
                studentApi.getSkillGap(),
                studentApi.getCareerPaths()
            ]);
            setTargetRoles(roles || []);
            setActiveGap(gap);
            setSelectedRole(gap?.target_role || 'Software Engineer');
            setCareerPaths(paths);
        } catch (error) {
            console.error('Failed to load skill gap data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRoleChange = async (newRole) => {
        setSelectedRole(newRole);
        setIsLoading(true);
        try {
            const simulated = await studentApi.simulateSkillGap(newRole, activeGap?.target_company, simulatedSkills);
            setActiveGap(simulated);
        } catch (error) {
            console.error('Failed to switch role:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddHypotheticalSkill = async () => {
        if (!hypotheticalInput.trim()) return;
        const skill = hypotheticalInput.trim();
        if (simulatedSkills.includes(skill)) return;

        const updated = [...simulatedSkills, skill];
        setSimulatedSkills(updated);
        setHypotheticalInput('');
        setIsSimulating(true);

        try {
            const simulated = await studentApi.simulateSkillGap(selectedRole, activeGap?.target_company, updated);
            setActiveGap(simulated);
        } catch (error) {
            console.error('Simulation error:', error);
        } finally {
            setIsSimulating(false);
        }
    };

    const handleRemoveHypotheticalSkill = async (skillToRemove) => {
        const updated = simulatedSkills.filter(s => s !== skillToRemove);
        setSimulatedSkills(updated);
        setIsSimulating(true);

        try {
            const simulated = await studentApi.simulateSkillGap(selectedRole, activeGap?.target_company, updated);
            setActiveGap(simulated);
        } catch (error) {
            console.error('Simulation error:', error);
        } finally {
            setIsSimulating(false);
        }
    };

    if (isLoading && !activeGap) {
        return (
            <div className="flex items-center justify-center min-h-[500px]">
                <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                    <p className="text-slate-400 font-medium">Analyzing skill taxonomy & benchmarks...</p>
                </div>
            </div>
        );
    }

    const matchPercent = activeGap?.match_percentage || 0;
    const fitLevel = activeGap?.career_path_advice?.current_fit_level || 'Developing';

    const getFitBadge = (level) => {
        switch (level) {
            case 'High':
                return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            case 'Moderate':
                return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
            default:
                return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
        }
    };

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            {/* Header & Target Role Selector */}
            <div className="bg-slate-800/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                <Target className="w-6 h-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white tracking-tight">Skill Gap & Role Intelligence</h1>
                                <p className="text-slate-400 text-sm mt-0.5">
                                    Benchmark your resume and skills against industry role expectations
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Target Benchmark:
                        </label>
                        <select
                            value={selectedRole}
                            onChange={(e) => handleRoleChange(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                        >
                            {targetRoles.map((r) => (
                                <option key={r.title} value={r.title}>
                                    {r.title}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {activeGap?.role_description && (
                    <div className="mt-5 pt-5 border-t border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
                        <p className="line-clamp-2 italic">{activeGap.role_description}</p>
                        {activeGap.target_company && (
                            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-indigo-300 border border-slate-700 whitespace-nowrap">
                                <Building2 className="w-3.5 h-3.5" /> Target: {activeGap.target_company}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Core Metrics: Match Gauge & Fit */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Metric 1: Role Match % */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Role Match Score</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${getFitBadge(fitLevel)}`}>
                            {fitLevel} Fit
                        </span>
                    </div>
                    <div className="mt-4 flex items-baseline gap-2">
                        <span className="text-4xl font-extrabold text-white">{matchPercent}%</span>
                        <span className="text-xs text-slate-400">weighted alignment</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full bg-slate-900 h-2.5 rounded-full mt-4 overflow-hidden">
                        <div 
                            className={`h-full transition-all duration-700 rounded-full ${
                                matchPercent >= 75 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' :
                                matchPercent >= 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                                'bg-gradient-to-r from-indigo-500 to-purple-500'
                            }`}
                            style={{ width: `${Math.min(matchPercent, 100)}%` }}
                        />
                    </div>
                    <p className="text-xs text-slate-400 mt-3">
                        Required skills (75% weight) + Preferred competencies (25% weight)
                    </p>
                </div>

                {/* Metric 2: Required Skills Ratio */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Core Requirements</span>
                        <Layers className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="mt-4 flex items-baseline gap-2">
                        <span className="text-4xl font-extrabold text-white">
                            {activeGap?.matched_required_count || 0} / {activeGap?.required_skills_count || 0}
                        </span>
                        <span className="text-xs text-slate-400">verified skills</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-4">
                        {activeGap?.missing_required?.length === 0 
                            ? 'All mandatory technical qualifications satisfied!'
                            : `${activeGap?.missing_required?.length || 0} critical skill(s) missing to unlock placement eligibility.`}
                    </p>
                </div>

                {/* Metric 3: Next Immediate Milestone */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Primary Next Step</span>
                            <Sparkles className="w-4 h-4 text-indigo-400" />
                        </div>
                        <h3 className="text-base font-semibold text-white mt-3">
                            {activeGap?.career_path_advice?.primary_focus_area || 'Master Core Fundamentals'}
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                            {activeGap?.career_path_advice?.next_milestone || 'Solve practice problems to close knowledge gaps.'}
                        </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-700/50">
                        <Link 
                            to="/student/roadmap" 
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                            Open Preparation Roadmap <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* Detailed Skills Taxonomy Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Required Skills Card */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-6">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-700/60">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                                <CheckCircle2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Mandatory Required Skills</h3>
                                <p className="text-xs text-slate-400">Core filters used by technical recruiters</p>
                            </div>
                        </div>
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-900 text-slate-300 border border-slate-700">
                            {activeGap?.matched_required_count || 0} of {activeGap?.required_skills_count || 0}
                        </span>
                    </div>

                    {/* Matched Required */}
                    <div>
                        <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                            Matched Skills ({activeGap?.matched_skills?.filter(s => !activeGap?.missing_required?.includes(s)).length || 0})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {activeGap?.matched_skills?.filter(s => !activeGap?.missing_required?.includes(s)).map((skill) => (
                                <span 
                                    key={skill}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    {skill}
                                </span>
                            ))}
                            {(!activeGap?.matched_skills || activeGap?.matched_skills.length === 0) && (
                                <span className="text-xs text-slate-500 italic">No required skills matched yet.</span>
                            )}
                        </div>
                    </div>

                    {/* Missing Required */}
                    <div>
                        <h4 className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-3">
                            Missing Required Skills ({activeGap?.missing_required?.length || 0})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {activeGap?.missing_required?.map((skill) => (
                                <span 
                                    key={skill}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20"
                                >
                                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                                    {skill}
                                </span>
                            ))}
                            {(!activeGap?.missing_required || activeGap?.missing_required.length === 0) && (
                                <span className="text-xs text-emerald-400 font-medium">None! You satisfy all core technical requirements.</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Preferred Skills Card */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-6">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-700/60">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                                <Award className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Preferred & Bonus Skills</h3>
                                <p className="text-xs text-slate-400">Competitive differentiators that elevate your rank</p>
                            </div>
                        </div>
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-900 text-slate-300 border border-slate-700">
                            {activeGap?.matched_preferred_count || 0} of {activeGap?.preferred_skills_count || 0}
                        </span>
                    </div>

                    {/* Matched Preferred */}
                    <div>
                        <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">
                            Acquired Advantages ({activeGap?.matched_preferred_count || 0})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {activeGap?.matched_skills?.filter(s => !activeGap?.missing_preferred?.includes(s) && !activeGap?.missing_required?.includes(s)).map((skill) => (
                                <span 
                                    key={skill}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                                >
                                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                    {skill}
                                </span>
                            ))}
                            {activeGap?.matched_preferred_count === 0 && (
                                <span className="text-xs text-slate-500 italic">No preferred skills acquired yet.</span>
                            )}
                        </div>
                    </div>

                    {/* Missing Preferred */}
                    <div>
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                            Growth Opportunities ({activeGap?.missing_preferred?.length || 0})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {activeGap?.missing_preferred?.map((skill) => (
                                <span 
                                    key={skill}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-400 border border-slate-700"
                                >
                                    {skill}
                                </span>
                            ))}
                            {(!activeGap?.missing_preferred || activeGap?.missing_preferred.length === 0) && (
                                <span className="text-xs text-emerald-400 font-medium">All preferred skills mastered!</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* "What If?" Interactive Skill Simulator */}
            <div className="bg-gradient-to-br from-indigo-950/40 via-slate-800/80 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-indigo-500/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-300">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">"What If?" Skill Simulator</h3>
                            <p className="text-xs text-slate-300">
                                Simulate adding new skills to observe how your match percentage and readiness would increase
                            </p>
                        </div>
                    </div>

                    {simulatedSkills.length > 0 && (
                        <button
                            onClick={() => {
                                setSimulatedSkills([]);
                                handleRoleChange(selectedRole);
                            }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium self-start md:self-auto"
                        >
                            Reset Simulation
                        </button>
                    )}
                </div>

                <div className="mt-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <input
                        type="text"
                        placeholder="e.g. Docker, TypeScript, Microservices..."
                        value={hypotheticalInput}
                        onChange={(e) => setHypotheticalInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddHypotheticalSkill()}
                        className="flex-1 bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                        onClick={handleAddHypotheticalSkill}
                        disabled={isSimulating || !hypotheticalInput.trim()}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/20"
                    >
                        <Plus className="w-4 h-4" /> Add to Simulation
                    </button>
                </div>

                {simulatedSkills.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-400 font-medium mr-1">Simulated Skills:</span>
                        {simulatedSkills.map((s) => (
                            <span 
                                key={s} 
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                            >
                                {s}
                                <button 
                                    onClick={() => handleRemoveHypotheticalSkill(s)} 
                                    className="hover:text-white"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Recommendations & Typical Interview Rounds */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Actionable Recommendations */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center gap-2.5">
                        <TrendingUp className="w-5 h-5 text-indigo-400" />
                        <h3 className="text-lg font-bold text-white">Strategic Guidance</h3>
                    </div>
                    <div className="space-y-3">
                        {activeGap?.recommendations?.map((rec, idx) => (
                            <div 
                                key={idx}
                                className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-700/50 flex items-start gap-3 text-sm text-slate-300"
                            >
                                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                    {idx + 1}
                                </span>
                                <p>{rec}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Anticipated Interview Process */}
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center gap-2.5">
                        <Compass className="w-5 h-5 text-teal-400" />
                        <h3 className="text-lg font-bold text-white">Typical Interview Stages for {selectedRole}</h3>
                    </div>
                    <div className="space-y-3">
                        {activeGap?.typical_interview_rounds?.map((round, idx) => (
                            <div 
                                key={idx}
                                className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-700/50 flex items-center justify-between text-sm"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-6 h-6 rounded-lg bg-teal-500/10 text-teal-400 text-xs font-bold flex items-center justify-center">
                                        R{idx + 1}
                                    </span>
                                    <span className="font-semibold text-white">{round}</span>
                                </div>
                                <span className="text-xs text-slate-400">Standard Round</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Alternative Career Fit Matrix */}
            {careerPaths?.all_role_fits && (
                <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Compass className="w-5 h-5 text-indigo-400" />
                            <h3 className="text-lg font-bold text-white">Cross-Role Fit Assessment</h3>
                        </div>
                        <p className="text-xs text-slate-400">How your current skills translate across tech roles</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-2">
                        {careerPaths.all_role_fits.map((fit) => (
                            <div 
                                key={fit.role}
                                onClick={() => handleRoleChange(fit.role)}
                                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                                    fit.role === selectedRole 
                                        ? 'bg-indigo-600/10 border-indigo-500 shadow-md shadow-indigo-500/10'
                                        : 'bg-slate-900/60 border-slate-700/50 hover:border-slate-600 hover:bg-slate-900'
                                }`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-bold text-white text-sm line-clamp-1">{fit.role}</span>
                                    <span className="text-xs font-bold text-indigo-400">{fit.match_percentage}%</span>
                                </div>
                                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-indigo-500 rounded-full" 
                                        style={{ width: `${fit.match_percentage}%` }}
                                    />
                                </div>
                                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                                    <span>{fit.fit_level} Fit</span>
                                    {fit.is_current_target && (
                                        <span className="text-indigo-400 font-semibold">Active</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentSkillGap;
