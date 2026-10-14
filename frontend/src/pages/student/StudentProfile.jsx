import React, { useState, useEffect } from 'react';
import { 
    User, 
    Target, 
    Building2, 
    GraduationCap, 
    Calendar, 
    Code, 
    Save, 
    CheckCircle, 
    AlertTriangle, 
    Award, 
    Plus, 
    X,
    RefreshCw
} from 'lucide-react';
import studentApi from '../../services/studentApi';

const COMMON_ROLES = [
    'Software Engineer',
    'Full Stack Developer',
    'Frontend Developer',
    'Backend Developer',
    'Python Developer',
    'Java Developer',
    'Data Engineer',
    'Machine Learning Engineer',
    'DevOps Engineer',
    'Cloud Engineer'
];

const StudentProfile = () => {
    const [profile, setProfile] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null); // { type: 'success'|'error', message: '' }

    // Form fields
    const [fullName, setFullName] = useState('');
    const [targetRole, setTargetRole] = useState('Software Engineer');
    const [customRole, setCustomRole] = useState('');
    const [targetCompany, setTargetCompany] = useState('');
    const [education, setEducation] = useState('');
    const [graduationYear, setGraduationYear] = useState('');
    const [cgpa, setCgpa] = useState('');
    const [skills, setSkills] = useState([]);
    const [newSkillInput, setNewSkillInput] = useState('');

    const loadProfile = async () => {
        setIsLoading(true);
        try {
            const data = await studentApi.getProfile();
            setProfile(data);
            setFullName(data.full_name || '');
            
            if (COMMON_ROLES.includes(data.target_role)) {
                setTargetRole(data.target_role);
                setCustomRole('');
            } else if (data.target_role) {
                setTargetRole('Other');
                setCustomRole(data.target_role);
            } else {
                setTargetRole('Software Engineer');
            }

            setTargetCompany(data.target_company || '');
            setEducation(data.education || '');
            setGraduationYear(data.graduation_year ? String(data.graduation_year) : '');
            setCgpa(data.cgpa ? String(data.cgpa) : '');
            setSkills(Array.isArray(data.current_skills) ? data.current_skills : []);
        } catch (err) {
            console.error('Failed to load student profile:', err);
            setSaveStatus({
                type: 'error',
                message: 'Failed to load your profile. Please refresh the page.'
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadProfile();
    }, []);

    const handleAddSkill = (e) => {
        e.preventDefault();
        const trimmed = newSkillInput.trim();
        if (trimmed && !skills.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
            setSkills([...skills, trimmed]);
            setNewSkillInput('');
        }
    };

    const handleRemoveSkill = (skillToRemove) => {
        setSkills(skills.filter(s => s !== skillToRemove));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveStatus(null);

        const effectiveRole = targetRole === 'Other' ? customRole.trim() : targetRole;
        if (!effectiveRole) {
            setSaveStatus({
                type: 'error',
                message: 'Please specify your target career role.'
            });
            setIsSaving(false);
            return;
        }

        const payload = {
            full_name: fullName.trim() || undefined,
            target_role: effectiveRole,
            target_company: targetCompany.trim() || null,
            education: education.trim() || null,
            graduation_year: graduationYear ? parseInt(graduationYear, 10) : null,
            cgpa: cgpa ? parseFloat(cgpa) : null,
            current_skills: skills
        };

        try {
            const updated = await studentApi.updateProfile(payload);
            setProfile(updated);
            setSaveStatus({
                type: 'success',
                message: 'Your career profile and target goals have been successfully updated!'
            });
            // Clear message after 4s
            setTimeout(() => setSaveStatus(null), 4000);
        } catch (err) {
            console.error('Profile update failed:', err);
            setSaveStatus({
                type: 'error',
                message: err.response?.data?.detail || 'Failed to update profile. Please try again.'
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
                <RefreshCw className="w-8 h-8 text-emerald-500 dark:text-emerald-400 animate-spin" />
                <p className="text-slate-500 dark:text-slate-400 text-sm">Loading career profile...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                        Student Career Profile
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Configure your target role, dream company, education details, and key technical skills.
                    </p>
                </div>
                {profile && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-4 py-2 rounded-xl flex items-center gap-3 shadow-xs">
                        <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        <div>
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400 block">
                                Readiness Indicator
                            </span>
                            <span className="text-lg font-bold text-slate-900 dark:text-white">
                                {Math.round(profile.readiness_score || 0)} / 100
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {saveStatus && (
                <div
                    className={`p-4 rounded-xl text-sm flex items-center gap-3 ${
                        saveStatus.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300'
                    }`}
                >
                    {saveStatus.type === 'success' ? (
                        <CheckCircle className="w-5 h-5 shrink-0" />
                    ) : (
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                    )}
                    <span>{saveStatus.message}</span>
                </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
                {/* 1. Basic Info */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                        <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Personal & Account Information
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                Full Name
                            </label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="e.g. Alex Kumar"
                                className="h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={profile?.email || ''}
                                disabled
                                className="h-11 w-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
                            />
                        </div>
                    </div>
                </div>

                {/* 2. Target Role & Company */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                        <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Career Targets
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Target Role */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                Target Role
                            </label>
                            <select
                                value={targetRole}
                                onChange={(e) => setTargetRole(e.target.value)}
                                className="h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                            >
                                {COMMON_ROLES.map((r) => (
                                    <option key={r} value={r} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                        {r}
                                    </option>
                                ))}
                                <option value="Other" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                    Other (Specify below)
                                </option>
                            </select>

                            {targetRole === 'Other' && (
                                <input
                                    type="text"
                                    value={customRole}
                                    onChange={(e) => setCustomRole(e.target.value)}
                                    placeholder="Enter your custom target role"
                                    className="h-11 w-full mt-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                                />
                            )}
                        </div>

                        {/* Target Company */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                Target Company <span className="text-slate-400 font-normal lowercase">(optional)</span>
                            </label>
                            <div className="relative">
                                <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                <input
                                    type="text"
                                    value={targetCompany}
                                    onChange={(e) => setTargetCompany(e.target.value)}
                                    placeholder="e.g. Google, Microsoft, Startup (Optional)"
                                    className="h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                Leave blank if you are open to multiple organizations.
                            </p>
                        </div>
                    </div>
                </div>

                {/* 3. Education Details */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                        <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Education & Graduation
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                Degree & Branch
                            </label>
                            <input
                                type="text"
                                value={education}
                                onChange={(e) => setEducation(e.target.value)}
                                placeholder="e.g. B.Tech Computer Science"
                                className="h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                Graduation Year
                            </label>
                            <input
                                type="number"
                                min="2000"
                                max="2035"
                                value={graduationYear}
                                onChange={(e) => setGraduationYear(e.target.value)}
                                placeholder="e.g. 2026"
                                className="h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                CGPA / Percentage
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={cgpa}
                                onChange={(e) => setCgpa(e.target.value)}
                                placeholder="e.g. 8.5"
                                className="h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                            />
                        </div>
                    </div>
                </div>

                {/* 4. Current Skills */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                        <Code className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Current Skills
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Add the programming languages, frameworks, and tools in your current repertoire.
                    </p>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newSkillInput}
                            onChange={(e) => setNewSkillInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddSkill(e);
                                }
                            }}
                            placeholder="Add a skill (e.g. React, Python, Docker) and press Add"
                            className="h-11 flex-1 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                        />
                        <button
                            type="button"
                            onClick={handleAddSkill}
                            className="h-11 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                        >
                            <Plus className="w-4 h-4" /> Add
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                        {skills.length === 0 ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500 italic">No skills added yet.</span>
                        ) : (
                            skills.map((skill, idx) => (
                                <span
                                    key={idx}
                                    className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5"
                                >
                                    <span>{skill}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveSkill(skill)}
                                        className="text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 p-0.5 rounded transition-colors cursor-pointer"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            ))
                        )}
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end pt-2">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="h-11 px-8 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:cursor-not-allowed"
                    >
                        {isSaving ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Saving Profile...</span>
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                <span>Save Changes</span>
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default StudentProfile;
