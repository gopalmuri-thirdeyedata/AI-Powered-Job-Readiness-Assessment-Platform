import React, { useState } from 'react';
import { 
    Sparkles, 
    Target, 
    GraduationCap, 
    Code2, 
    FileText, 
    Check, 
    ChevronRight, 
    ChevronLeft, 
    X, 
    Upload, 
    CheckCircle2, 
    AlertCircle 
} from 'lucide-react';
import studentApi from '../../services/studentApi';

const COMMON_ROLES = [
    'Full Stack Developer',
    'Backend Engineer',
    'Frontend Engineer',
    'Data Engineer',
    'DevOps Engineer',
    'AI / Machine Learning Engineer'
];

const SUGGESTED_SKILLS = [
    'React', 'Python', 'Node.js', 'Java', 'SQL',
    'Docker', 'DSA', 'FastAPI', 'JavaScript', 'Git',
    'AWS', 'TypeScript', 'MongoDB', 'System Design'
];

const StudentOnboardingWizard = ({ isOpen, onClose, onCompleted, initialProfile = {} }) => {
    const [currentStep, setCurrentStep] = useState(1);
    const [targetRole, setTargetRole] = useState(initialProfile.target_role || 'Full Stack Developer');
    const [targetCompany, setTargetCompany] = useState(initialProfile.target_company || '');
    const [collegeName, setCollegeName] = useState(initialProfile.college_name || '');
    const [branch, setBranch] = useState(initialProfile.branch || 'Computer Science');
    const [graduationYear, setGraduationYear] = useState(initialProfile.graduation_year || 2026);
    const [cgpa, setCgpa] = useState(initialProfile.cgpa || 8.0);
    const [skills, setSkills] = useState(initialProfile.current_skills?.length ? initialProfile.current_skills : ['React', 'Python']);
    const [customSkill, setCustomSkill] = useState('');
    const [resumeFile, setResumeFile] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    if (!isOpen) return null;

    const handleAddSkill = (skillToAdd) => {
        const clean = skillToAdd.trim();
        if (clean && !skills.includes(clean)) {
            setSkills([...skills, clean]);
        }
    };

    const handleRemoveSkill = (skillToRemove) => {
        setSkills(skills.filter(s => s !== skillToRemove));
    };

    const handleNextStep = async () => {
        setIsSaving(true);
        setErrorMsg(null);
        try {
            if (currentStep === 1) {
                await studentApi.saveOnboardingStep({
                    step: 1,
                    target_role: targetRole,
                    target_company: targetCompany
                });
            } else if (currentStep === 2) {
                await studentApi.saveOnboardingStep({
                    step: 2,
                    college_name: collegeName,
                    branch: branch,
                    graduation_year: parseInt(graduationYear),
                    cgpa: parseFloat(cgpa)
                });
            } else if (currentStep === 3) {
                await studentApi.saveOnboardingStep({
                    step: 3,
                    current_skills: skills
                });
            }
            setCurrentStep(prev => prev + 1);
        } catch (err) {
            console.error('Failed to save step:', err);
            setErrorMsg(err.response?.data?.detail || 'Failed to save progress. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleFinalizeOnboarding = async () => {
        setIsSaving(true);
        setErrorMsg(null);
        try {
            // If resume selected, upload it
            if (resumeFile) {
                const formData = new FormData();
                formData.append('file', resumeFile);
                await studentApi.uploadResume(formData);
            }

            // Complete onboarding
            const updated = await studentApi.completeOnboarding({
                target_role: targetRole,
                target_company: targetCompany,
                college_name: collegeName,
                branch: branch,
                graduation_year: parseInt(graduationYear),
                cgpa: parseFloat(cgpa),
                current_skills: skills
            });

            if (onCompleted) onCompleted(updated);
            if (onClose) onClose();
        } catch (err) {
            console.error('Failed to finalize onboarding:', err);
            setErrorMsg(err.response?.data?.detail || 'Failed to complete onboarding.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 font-sans">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
                {/* Header */}
                <div className="p-6 bg-slate-50/80 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-200 dark:border-emerald-500/30">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <span>Career Readiness Onboarding</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-500/30">
                                    Step {currentStep} of 4
                                </span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Configure your personalized preparation plan</p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg cursor-pointer transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Stepper Progress Bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5">
                    <div
                        className="bg-emerald-500 h-full transition-all duration-300"
                        style={{ width: `${(currentStep / 4) * 100}%` }}
                    />
                </div>

                {/* Error Banner */}
                {errorMsg && (
                    <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{errorMsg}</span>
                    </div>
                )}

                {/* Step Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs text-slate-700 dark:text-slate-200">
                    {/* STEP 1: TARGET ROLE & COMPANY */}
                    {currentStep === 1 && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <div>
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                                    <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>Target Career Role Benchmark</span>
                                </h3>
                                <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                                    Select the primary engineering profile you want to prepare and simulate drives for:
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                                {COMMON_ROLES.map((role) => (
                                    <button
                                        key={role}
                                        type="button"
                                        onClick={() => setTargetRole(role)}
                                        className={`p-3 rounded-xl text-left font-medium transition-all border flex items-center justify-between cursor-pointer ${
                                            targetRole === role
                                                ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/50 shadow-xs'
                                                : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <span>{role}</span>
                                        {targetRole === role && <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                                    </button>
                                ))}
                            </div>

                            <div className="pt-2">
                                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                                    Target Dream Company (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={targetCompany}
                                    onChange={(e) => setTargetCompany(e.target.value)}
                                    placeholder="e.g. Google, Microsoft, Amazon, Stripe..."
                                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: ACADEMIC PROFILE */}
                    {currentStep === 2 && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <div>
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                                    <GraduationCap className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                                    <span>Academic Credentials</span>
                                </h3>
                                <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                                    College placement drives enforce academic eligibility cutoffs:
                                </p>
                            </div>

                            <div>
                                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">College / University</label>
                                <input
                                    type="text"
                                    value={collegeName}
                                    onChange={(e) => setCollegeName(e.target.value)}
                                    placeholder="e.g. Institute of Technology"
                                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Branch / Major</label>
                                    <select
                                        value={branch}
                                        onChange={(e) => setBranch(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                                    >
                                        <option value="Computer Science">Computer Science</option>
                                        <option value="Information Technology">Information Technology</option>
                                        <option value="Electronics & Communication">Electronics & Communication</option>
                                        <option value="Electrical Engineering">Electrical Engineering</option>
                                        <option value="Mechanical Engineering">Mechanical Engineering</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Graduation Year</label>
                                    <select
                                        value={graduationYear}
                                        onChange={(e) => setGraduationYear(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                                    >
                                        <option value={2025}>2025</option>
                                        <option value={2026}>2026</option>
                                        <option value={2027}>2027</option>
                                        <option value={2028}>2028</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                                    Current CGPA (Out of 10.0)
                                </label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="10"
                                    value={cgpa}
                                    onChange={(e) => setCgpa(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* STEP 3: TECHNICAL SKILLS INTAKE */}
                    {currentStep === 3 && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <div>
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                                    <Code2 className="w-4 h-4 text-amber-500" />
                                    <span>Technical Skills Self-Assessment</span>
                                </h3>
                                <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                                    Select the languages, frameworks, and tools you currently know:
                                </p>
                            </div>

                            {/* Active Skills */}
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl min-h-[60px] flex flex-wrap gap-2 items-center">
                                {skills.length === 0 ? (
                                    <span className="text-slate-400 dark:text-slate-500 italic">No skills selected yet. Click from suggestions below.</span>
                                ) : (
                                    skills.map((s) => (
                                        <span
                                            key={s}
                                            className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded-lg flex items-center gap-1.5 font-medium"
                                        >
                                            <span>{s}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveSkill(s)}
                                                className="hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    ))
                                )}
                            </div>

                            {/* Quick add suggestions */}
                            <div>
                                <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    Suggested Skills:
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {SUGGESTED_SKILLS.map((item) => (
                                        <button
                                            key={item}
                                            type="button"
                                            onClick={() => handleAddSkill(item)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] border transition-all cursor-pointer ${
                                                skills.includes(item)
                                                    ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40 opacity-60'
                                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
                                            }`}
                                        >
                                            + {item}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Custom Skill Input */}
                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="text"
                                    value={customSkill}
                                    onChange={(e) => setCustomSkill(e.target.value)}
                                    placeholder="Add other skill (e.g. Kotlin, Kubernetes)..."
                                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        handleAddSkill(customSkill);
                                        setCustomSkill('');
                                    }}
                                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white border border-slate-200 dark:border-slate-700 font-medium rounded-xl cursor-pointer transition-colors"
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 4: RESUME & CONFIRMATION */}
                    {currentStep === 4 && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <div>
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-indigo-500" />
                                    <span>Resume Upload & Profile Review</span>
                                </h3>
                                <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                                    Upload your resume now for automatic ATS scoring, or finish setup and upload later:
                                </p>
                            </div>

                            {/* File Upload Box */}
                            <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-emerald-500/50 rounded-2xl p-5 text-center transition-all bg-slate-50 dark:bg-slate-850/50">
                                <input
                                    type="file"
                                    id="onboarding-resume"
                                    accept=".pdf,.docx,.doc,.txt"
                                    onChange={(e) => setResumeFile(e.target.files[0] || null)}
                                    className="hidden"
                                />
                                <label htmlFor="onboarding-resume" className="cursor-pointer space-y-2 block">
                                    <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
                                    {resumeFile ? (
                                        <div className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-center gap-1.5">
                                            <CheckCircle2 className="w-4 h-4" />
                                            <span>{resumeFile.name} (Ready to analyze)</span>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="font-semibold text-slate-800 dark:text-white">Click to select resume file (PDF / DOCX)</p>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Optional: you can also upload this anytime from dashboard</p>
                                        </>
                                    )}
                                </label>
                            </div>

                            {/* Summary Card */}
                            <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2 text-xs">
                                <span className="font-bold text-slate-900 dark:text-white block text-xs">Profile Summary:</span>
                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                    <div><span className="text-slate-500 dark:text-slate-400">Target Role:</span> <strong className="text-slate-900 dark:text-white">{targetRole}</strong></div>
                                    <div><span className="text-slate-500 dark:text-slate-400">Target Company:</span> <strong className="text-slate-900 dark:text-white">{targetCompany || 'Open'}</strong></div>
                                    <div><span className="text-slate-500 dark:text-slate-400">Branch:</span> <strong className="text-slate-900 dark:text-white">{branch}</strong></div>
                                    <div><span className="text-slate-500 dark:text-slate-400">CGPA:</span> <strong className="text-emerald-600 dark:text-emerald-400">{cgpa}</strong></div>
                                    <div className="col-span-2"><span className="text-slate-500 dark:text-slate-400">Skills ({skills.length}):</span> <strong className="text-slate-900 dark:text-white">{skills.join(', ')}</strong></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Controls */}
                <div className="p-4 bg-slate-50/80 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    {currentStep > 1 ? (
                        <button
                            type="button"
                            onClick={() => setCurrentStep(prev => prev - 1)}
                            disabled={isSaving}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Back</span>
                        </button>
                    ) : <div />}

                    {currentStep < 4 ? (
                        <button
                            type="button"
                            onClick={handleNextStep}
                            disabled={isSaving}
                            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-all shadow-xs disabled:opacity-40 cursor-pointer"
                        >
                            <span>Continue</span>
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleFinalizeOnboarding}
                            disabled={isSaving}
                            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-40 cursor-pointer"
                        >
                            <Sparkles className="w-4 h-4" />
                            <span>{isSaving ? 'Activating...' : 'Complete & Launch Career Hub'}</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentOnboardingWizard;
