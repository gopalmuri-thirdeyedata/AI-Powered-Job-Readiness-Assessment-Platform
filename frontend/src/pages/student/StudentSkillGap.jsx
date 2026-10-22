import React, { useState, useEffect } from 'react';
import {
    Target,
    CheckCircle2,
    XCircle,
    TrendingUp,
    Sparkles,
    Compass,
    Award,
    Layers,
    ArrowRight,
    RefreshCw,
    Plus,
    X,
    Building2,
    ScanSearch,
    Gauge,
    ListChecks,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PageHero, Stagger, StaggerItem, AnimatedBar } from '../../components/student-ui/StudentMotion';
import { Reveal, Counter, SpotlightCard, EASE } from '../../components/home/primitives';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';
import studentApi from '../../services/studentApi';

const LOADING_STAGES = [
    { icon: ScanSearch, label: 'Reading your skills' },
    { icon: Target, label: 'Matching against the role benchmark' },
    { icon: Gauge, label: 'Scoring your fit' },
    { icon: ListChecks, label: 'Finding the gaps to close' },
];
const LOADING_TIPS = [
    'Required skills carry 75% of your match score.',
    'Try the What-If simulator to see which skill moves your score most.',
    'Close missing required skills first, then bonus skills.',
];

const CHIP_TONES = {
    present: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20',
    missing: 'bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-500/20',
    growth: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};
const CHIP_ICON = {
    present: 'text-emerald-600 dark:text-emerald-400',
    missing: 'text-rose-600 dark:text-rose-400',
    growth: 'text-slate-500',
};

/** Skill chip: present / missing / growth tones, staggered via the parent Stagger. */
// Each chip animates on its own. Chips are re-created whenever the target role changes, long after the parent's
// one-time stagger has played, so relying on the parent's variants would leave the new chips invisible.
const SkillChip = ({ tone = 'present', icon: Icon, index = 0, children }) => {
    const reduce = useReducedMotion();
    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: reduce ? 0 : Math.min(index * 0.04, 0.4) }}
        >
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-lg text-xs font-medium border transition-transform hover:-translate-y-0.5 ${CHIP_TONES[tone]}`}>
                {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${CHIP_ICON[tone]}`} />}
                {children}
            </span>
        </motion.div>
    );
};

/** Circular match gauge that sweeps in. Purely derived from the match percentage. */
const MatchRing = ({ value = 0, tone = 'emerald' }) => {
    const reduce = useReducedMotion();
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    const r = 30;
    const c = 2 * Math.PI * r;
    const stroke = tone === 'rose' ? '#f43f5e' : tone === 'amber' ? '#f59e0b' : '#10b981';
    return (
        <svg viewBox="0 0 72 72" className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 -rotate-90" aria-hidden="true">
            <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-800" />
            <motion.circle
                cx="36" cy="36" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
                stroke={stroke}
                strokeDasharray={c}
                initial={reduce ? false : { strokeDashoffset: c }}
                whileInView={{ strokeDashoffset: c * (1 - pct / 100) }}
                viewport={{ once: true }}
                transition={{ duration: 1.3, ease: EASE }}
                animate={reduce ? { strokeDashoffset: c * (1 - pct / 100) } : undefined}
            />
        </svg>
    );
};

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
            <AssessmentLoadingOverlay
                open
                title="Analyzing your skills"
                subtitle="Analyzing skill taxonomy & benchmarks..."
                stages={LOADING_STAGES}
                tips={LOADING_TIPS}
                footnote="Hang tight. This usually takes a few seconds."
            />
        );
    }

    const matchPercent = activeGap?.match_percentage || 0;
    const fitLevel = activeGap?.career_path_advice?.current_fit_level || 'Developing';

    const getFitBadge = (level) => {
        switch (level) {
            case 'High':
                return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30';
            case 'Moderate':
                return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
        }
    };

    const matchedReq = activeGap?.matched_skills?.filter(s => !activeGap?.missing_required?.includes(s)) || [];
    const matchedPref = activeGap?.matched_skills?.filter(s => !activeGap?.missing_preferred?.includes(s) && !activeGap?.missing_required?.includes(s)) || [];
    const reqTotal = activeGap?.required_skills_count || 0;
    const reqMatched = activeGap?.matched_required_count || 0;
    const reqPct = reqTotal > 0 ? Math.round((reqMatched / reqTotal) * 100) : 0;
    const matchTone = matchPercent >= 75 ? 'emerald' : matchPercent >= 50 ? 'amber' : 'rose';

    return (
        <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto min-w-0">
            <AssessmentLoadingOverlay
                open={isLoading}
                title="Analyzing your skills"
                subtitle="Benchmarking your profile against the target role."
                stages={LOADING_STAGES}
                tips={LOADING_TIPS}
                footnote="Hang tight. This usually takes a few seconds."
            />

            {/* Header & Target Role Selector */}
            <PageHero
                icon={Target}
                eyebrow="Role intelligence"
                title="Skill Gap & Role Intelligence"
                subtitle="Benchmark your resume and skills against industry role expectations"
                actions={(
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Target Benchmark:
                        </label>
                        <select
                            value={selectedRole}
                            onChange={(e) => handleRoleChange(e.target.value)}
                            className="w-full sm:w-auto min-h-[44px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white font-medium text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all cursor-pointer"
                        >
                            {targetRoles.map((r) => (
                                <option key={r.title} value={r.title}>
                                    {r.title}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            >
                {activeGap?.role_description && (
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <p className="line-clamp-2 italic">{activeGap.role_description}</p>
                        {activeGap.target_company && (
                            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 w-fit sm:whitespace-nowrap">
                                <Building2 className="w-3.5 h-3.5" /> Target: {activeGap.target_company}
                            </span>
                        )}
                    </div>
                )}
            </PageHero>

            {/* Core Metrics: Match Gauge & Fit */}
            <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6" gap={0.1}>
                {/* Metric 1: Role Match % */}
                <StaggerItem className="h-full">
                    <SpotlightCard className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs relative overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role Match Score</span>
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${getFitBadge(fitLevel)}`}>
                                {fitLevel} Fit
                            </span>
                        </div>
                        <div className="mt-4 flex items-center gap-4">
                            <MatchRing value={matchPercent} tone={matchTone} />
                            <div className="min-w-0">
                                <div className="text-4xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                                    <Counter to={Number(matchPercent) || 0} suffix="%" />
                                </div>
                                <span className="text-xs text-slate-500 dark:text-slate-400">weighted alignment</span>
                            </div>
                        </div>
                        <AnimatedBar value={Math.min(matchPercent, 100)} tone={matchTone} height="h-2.5" className="mt-4" label="Role match" />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                            Required skills (75% weight) + Preferred competencies (25% weight)
                        </p>
                    </SpotlightCard>
                </StaggerItem>

                {/* Metric 2: Required Skills Ratio */}
                <StaggerItem className="h-full">
                    <SpotlightCard className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Core Requirements</span>
                            <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="mt-4 flex items-baseline gap-2 flex-wrap">
                            <span className="text-4xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                                <Counter to={reqMatched} /> / {reqTotal}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">verified skills</span>
                        </div>
                        <AnimatedBar value={reqPct} tone="blue" height="h-2.5" className="mt-4" label="Core requirements met" />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                            {activeGap?.missing_required?.length === 0
                                ? 'All mandatory technical qualifications satisfied!'
                                : `${activeGap?.missing_required?.length || 0} critical skill(s) missing to unlock placement eligibility.`}
                        </p>
                    </SpotlightCard>
                </StaggerItem>

                {/* Metric 3: Next Immediate Milestone */}
                <StaggerItem className="h-full">
                    <SpotlightCard className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col justify-between hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                        <div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Primary Next Step</span>
                                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <h3 className="text-base font-semibold text-slate-900 dark:text-white mt-3">
                                {activeGap?.career_path_advice?.primary_focus_area || 'Master Core Fundamentals'}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {activeGap?.career_path_advice?.next_milestone || 'Solve practice problems to close knowledge gaps.'}
                            </p>
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                            <Link
                                to="/student/roadmap"
                                className="group inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
                            >
                                Open Preparation Roadmap <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                            </Link>
                        </div>
                    </SpotlightCard>
                </StaggerItem>
            </Stagger>

            {/* Detailed Skills Taxonomy Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
                {/* Required Skills Card */}
                <Reveal className="h-full">
                    <div className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-6">
                        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                                    <CheckCircle2 className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Mandatory Required Skills</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Core filters used by technical recruiters</p>
                                </div>
                            </div>
                            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                                {activeGap?.matched_required_count || 0} of {activeGap?.required_skills_count || 0}
                            </span>
                        </div>

                        {/* Matched Required */}
                        <div>
                            <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-3">
                                Matched Skills ({activeGap?.matched_skills?.filter(s => !activeGap?.missing_required?.includes(s)).length || 0})
                            </h4>
                            <Stagger className="flex flex-wrap gap-2" gap={0.05}>
                                {matchedReq.map((skill, i) => (
                                    <SkillChip key={skill} index={i} tone="present" icon={CheckCircle2}>{skill}</SkillChip>
                                ))}
                                {(!activeGap?.matched_skills || activeGap?.matched_skills.length === 0) && (
                                    <span className="text-xs text-slate-400 italic">No required skills matched yet.</span>
                                )}
                            </Stagger>
                        </div>

                        {/* Missing Required */}
                        <div>
                            <h4 className="text-xs font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-3">
                                Missing Required Skills ({activeGap?.missing_required?.length || 0})
                            </h4>
                            <Stagger className="flex flex-wrap gap-2" gap={0.05}>
                                {activeGap?.missing_required?.map((skill, i) => (
                                    <SkillChip key={skill} index={i} tone="missing" icon={XCircle}>{skill}</SkillChip>
                                ))}
                                {(!activeGap?.missing_required || activeGap?.missing_required.length === 0) && (
                                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">None! You satisfy all core technical requirements.</span>
                                )}
                            </Stagger>
                        </div>
                    </div>
                </Reveal>

                {/* Preferred Skills Card */}
                <Reveal delay={0.08} className="h-full">
                    <div className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-6">
                        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                                    <Award className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Preferred & Bonus Skills</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Competitive differentiators that elevate your rank</p>
                                </div>
                            </div>
                            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                                {activeGap?.matched_preferred_count || 0} of {activeGap?.preferred_skills_count || 0}
                            </span>
                        </div>

                        {/* Matched Preferred */}
                        <div>
                            <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-3">
                                Acquired Advantages ({activeGap?.matched_preferred_count || 0})
                            </h4>
                            <Stagger className="flex flex-wrap gap-2" gap={0.05}>
                                {matchedPref.map((skill, i) => (
                                    <SkillChip key={skill} index={i} tone="present" icon={Sparkles}>{skill}</SkillChip>
                                ))}
                                {activeGap?.matched_preferred_count === 0 && (
                                    <span className="text-xs text-slate-400 italic">No preferred skills acquired yet.</span>
                                )}
                            </Stagger>
                        </div>

                        {/* Missing Preferred */}
                        <div>
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                                Growth Opportunities ({activeGap?.missing_preferred?.length || 0})
                            </h4>
                            <Stagger className="flex flex-wrap gap-2" gap={0.05}>
                                {activeGap?.missing_preferred?.map((skill, i) => (
                                    <SkillChip key={skill} index={i} tone="growth">{skill}</SkillChip>
                                ))}
                                {(!activeGap?.missing_preferred || activeGap?.missing_preferred.length === 0) && (
                                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">All preferred skills mastered!</span>
                                )}
                            </Stagger>
                        </div>
                    </div>
                </Reveal>
            </div>

            {/* "What If?" Interactive Skill Simulator */}
            <Reveal>
                <div className="bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40 dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-900 border border-emerald-200 dark:border-emerald-800/60 rounded-3xl p-5 sm:p-6 shadow-xs">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-emerald-100 dark:border-slate-800">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">"What If?" Skill Simulator</h3>
                                <p className="text-xs text-slate-600 dark:text-slate-400">
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
                                className="text-xs min-h-[40px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium self-start md:self-auto cursor-pointer"
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
                            className="flex-1 min-w-0 min-h-[44px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                        <button
                            onClick={handleAddHypotheticalSkill}
                            disabled={isSimulating || !hypotheticalInput.trim()}
                            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-xs cursor-pointer active:scale-95"
                        >
                            <Plus className="w-4 h-4" /> Add to Simulation
                        </button>
                    </div>

                    {simulatedSkills.length > 0 && (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium mr-1">Simulated Skills:</span>
                            <AnimatePresence initial={false}>
                                {simulatedSkills.map((s) => (
                                    <motion.span
                                        key={s}
                                        layout
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                    >
                                        {s}
                                        <button
                                            onClick={() => handleRemoveHypotheticalSkill(s)}
                                            className="hover:text-red-500 cursor-pointer w-6 h-6 inline-flex items-center justify-center rounded-full"
                                            aria-label={`Remove ${s}`}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </motion.span>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </Reveal>

            {/* Recommendations & Typical Interview Rounds */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
                {/* Actionable Recommendations */}
                <Reveal className="h-full">
                    <div className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-2.5">
                            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Strategic Guidance</h3>
                        </div>
                        <Stagger className="space-y-3" gap={0.07}>
                            {activeGap?.recommendations?.map((rec, idx) => (
                                <StaggerItem key={idx}>
                                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all">
                                        <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                            {idx + 1}
                                        </span>
                                        <p className="min-w-0">{rec}</p>
                                    </div>
                                </StaggerItem>
                            ))}
                        </Stagger>
                    </div>
                </Reveal>

                {/* Anticipated Interview Process */}
                <Reveal delay={0.08} className="h-full">
                    <div className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-2.5">
                            <Compass className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Typical Interview Stages for {selectedRole}</h3>
                        </div>
                        <Stagger className="space-y-3" gap={0.07}>
                            {activeGap?.typical_interview_rounds?.map((round, idx) => (
                                <StaggerItem key={idx}>
                                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 flex items-center justify-between gap-3 text-sm hover:-translate-y-0.5 hover:border-teal-300 dark:hover:border-teal-700 transition-all">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="w-6 h-6 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-bold flex items-center justify-center shrink-0">
                                                R{idx + 1}
                                            </span>
                                            <span className="font-semibold text-slate-900 dark:text-white">{round}</span>
                                        </div>
                                        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Standard Round</span>
                                    </div>
                                </StaggerItem>
                            ))}
                        </Stagger>
                    </div>
                </Reveal>
            </div>

            {/* Alternative Career Fit Matrix */}
            {careerPaths?.all_role_fits && (
                <Reveal>
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4">
                            <div className="flex items-center gap-2.5">
                                <Compass className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Cross-Role Fit Assessment</h3>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">How your current skills translate across tech roles</p>
                        </div>

                        <Stagger className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 pt-2" gap={0.06}>
                            {careerPaths.all_role_fits.map((fit) => (
                                <StaggerItem key={fit.role} className="h-full">
                                    <div
                                        onClick={() => handleRoleChange(fit.role)}
                                        className={`h-full p-4 rounded-xl border transition-all cursor-pointer hover:-translate-y-1 hover:shadow-md ${
                                            fit.role === selectedRole
                                                ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-500 shadow-xs'
                                                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700/50 hover:border-emerald-400 hover:bg-white dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <span className="font-bold text-slate-900 dark:text-white text-sm line-clamp-1">{fit.role}</span>
                                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fit.match_percentage}%</span>
                                        </div>
                                        <AnimatedBar value={fit.match_percentage} tone="emerald" height="h-1.5" label={`${fit.role} match`} />
                                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                            <span>{fit.fit_level} Fit</span>
                                            {fit.is_current_target && (
                                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Active</span>
                                            )}
                                        </div>
                                    </div>
                                </StaggerItem>
                            ))}
                        </Stagger>
                    </div>
                </Reveal>
            )}
        </div>
    );
};

export default StudentSkillGap;
