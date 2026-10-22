import React, { useState, useEffect, useCallback } from 'react';
import {
    User,
    Target,
    Building2,
    GraduationCap,
    Code,
    Save,
    CheckCircle,
    AlertTriangle,
    Award,
    Plus,
    X,
    RefreshCw,
    Pencil,
    School,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero } from '../../components/student-ui/StudentMotion';
import { Reveal, Counter, EASE } from '../../components/home/primitives';
import {
    COMMON_ROLES, LIMITS, PROFILE_UPDATED_EVENT, addSkill, apiErrorMessage, buildPayload, effectiveRole, formFromProfile,
    hasSavedDetails, isDirty, validateProfileForm,
} from '../../utils/profileForm';

const INPUT = 'h-11 w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 hover:border-emerald-400/60 dark:hover:border-emerald-600/50 focus:border-emerald-500 transition-colors';
const INPUT_ERROR = 'border-rose-400 dark:border-rose-500 focus:border-rose-500 focus:ring-rose-500/15';
const LABEL = 'block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5';
const CARD = 'bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4';
const CARD_TITLE = 'text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800';

const FieldError = ({ id, message }) => (message ? <p id={id} role="alert" className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">{message}</p> : null);

const SummaryRow = ({ label, value }) => (
    <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
        <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white break-words">
            {value || <span className="text-slate-400 dark:text-slate-500 italic font-normal">Not added yet</span>}
        </dd>
    </div>
);

const SkillChip = ({ children, onRemove, reduce }) => (
    <motion.span
        initial={reduce ? false : { opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5"
    >
        <span>{children}</span>
        {onRemove && (
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${children}`}
                className="text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 p-1 -m-0.5 min-w-6 min-h-6 flex items-center justify-center rounded transition-colors cursor-pointer"
            >
                <X className="w-3 h-3" />
            </button>
        )}
    </motion.span>
);

const StudentProfile = () => {
    const reduce = useReducedMotion();
    const [profile, setProfile] = useState(null); // what is saved on the server
    const [form, setForm] = useState(() => formFromProfile(null));
    const [errors, setErrors] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null); // { type: 'success'|'error', message }
    const [newSkillInput, setNewSkillInput] = useState('');

    const setField = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    };

    const loadProfile = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const data = await studentApi.getProfile();
            setProfile(data);
            setForm(formFromProfile(data));
            // a student who has saved nothing yet lands straight in the form; everyone else sees their saved profile
            setIsEditing(!hasSavedDetails(data));
        } catch (err) {
            console.error('Failed to load student profile:', err);
            setLoadError(apiErrorMessage(err, 'Failed to load your profile. Please try again.'));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { loadProfile(); }, [loadProfile]);

    const dirty = isEditing && profile ? isDirty(form, profile) : false;

    // Warn before a reload or tab close would throw away unsaved edits
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const startEditing = () => {
        setForm(formFromProfile(profile));
        setErrors({});
        setSaveStatus(null);
        setIsEditing(true);
    };

    const cancelEditing = () => {
        if (dirty && !window.confirm('Discard your unsaved changes?')) return;
        setForm(formFromProfile(profile));
        setErrors({});
        setSaveStatus(null);
        setNewSkillInput('');
        setIsEditing(false);
    };

    const handleAddSkill = (e) => {
        e.preventDefault();
        const next = addSkill(form.skills, newSkillInput);
        if (next !== form.skills) setField('skills', next);
        setNewSkillInput('');
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (isSaving) return;
        // a skill typed but not yet added would otherwise be lost silently
        const pending = addSkill(form.skills, newSkillInput);
        const toSave = pending === form.skills ? form : { ...form, skills: pending };

        const found = validateProfileForm(toSave);
        if (Object.keys(found).length) {
            setErrors(found);
            setSaveStatus({ type: 'error', message: 'Please fix the highlighted fields and save again.' });
            return;
        }

        setIsSaving(true);
        setSaveStatus(null);
        try {
            const updated = await studentApi.updateProfile(buildPayload(toSave));
            setProfile(updated);
            setForm(formFromProfile(updated)); // show exactly what the server stored
            setNewSkillInput('');
            setErrors({});
            setIsEditing(false);
            setSaveStatus({ type: 'success', message: 'Your profile was saved. It will be here whenever you sign in again.' });
            window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: updated }));
            window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
            setTimeout(() => setSaveStatus((s) => (s?.type === 'success' ? null : s)), 5000);
        } catch (err) {
            console.error('Profile update failed:', err);
            setSaveStatus({ type: 'error', message: apiErrorMessage(err) });
        } finally {
            setIsSaving(false);
        }
    };

    // Completeness follows what is saved while viewing, and the live form while editing
    const shown = isEditing ? form : formFromProfile(profile);
    const completenessChecks = [
        shown.fullName.trim(), effectiveRole(shown), shown.targetCompany.trim(), shown.collegeName.trim(),
        shown.education.trim(), shown.graduationYear, shown.cgpa, shown.skills.length > 0,
    ];
    const completeness = Math.round((completenessChecks.filter(Boolean).length / completenessChecks.length) * 100);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
                <RefreshCw className="w-8 h-8 text-emerald-500 dark:text-emerald-400 animate-spin" />
                <p className="text-slate-500 dark:text-slate-400 text-sm">Loading career profile...</p>
            </div>
        );
    }

    if (loadError && !profile) {
        return (
            <div className="max-w-md mx-auto text-center space-y-4 min-h-[50vh] flex flex-col items-center justify-center">
                <AlertTriangle className="w-9 h-9 text-rose-500" />
                <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
                <button
                    type="button"
                    onClick={loadProfile}
                    className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                    <RefreshCw className="w-4 h-4" /> Try again
                </button>
            </div>
        );
    }

    const savedRole = effectiveRole(formFromProfile(profile));
    const saved = formFromProfile(profile);

    return (
        <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
            <PageHero
                icon={User}
                eyebrow="Your Career Profile"
                title="Student Career Profile"
                subtitle="Your target role, dream company, education details, and key technical skills."
                actions={profile && (
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-4 py-2 rounded-xl flex items-center gap-3 shadow-xs">
                            <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <div>
                                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400 block">Readiness Indicator</span>
                                <span className="text-lg font-bold text-slate-900 dark:text-white">{Math.round(profile.readiness_score || 0)} / 100</span>
                            </div>
                        </div>
                        {!isEditing && (
                            <button
                                type="button"
                                id="profile-edit-btn"
                                onClick={startEditing}
                                className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                            >
                                <Pencil className="w-4 h-4" /> Edit Profile
                            </button>
                        )}
                    </div>
                )}
            >
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Profile completeness</span>
                        <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums"><Counter to={completeness} suffix="%" /></span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness} aria-label="Profile completeness">
                        <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                            initial={reduce ? false : { width: 0 }}
                            animate={{ width: `${completeness}%` }}
                            transition={{ duration: 1, ease: EASE }}
                        />
                    </div>
                    <p className="mt-2 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                        {completeness >= 100 ? 'Your profile is fully filled in. Great work!' : 'Fill in the remaining fields to get sharper recommendations.'}
                    </p>
                </div>
            </PageHero>

            <AnimatePresence>
                {saveStatus && (
                    <motion.div
                        key={saveStatus.message}
                        role={saveStatus.type === 'error' ? 'alert' : 'status'}
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className={`p-4 rounded-xl text-sm flex items-center gap-3 ${
                            saveStatus.type === 'success'
                                ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300'
                        }`}
                    >
                        {saveStatus.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
                        <span>{saveStatus.message}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {!isEditing ? (
                /* ───────────── Read-only view ───────────── */
                <div id="profile-view" className="space-y-6">
                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Personal & Account Information</h2>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <SummaryRow label="Full Name" value={saved.fullName} />
                            <SummaryRow label="Email Address" value={profile?.email} />
                        </dl>
                    </Reveal>

                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Career Targets</h2>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <SummaryRow label="Target Role" value={savedRole} />
                            <SummaryRow label="Target Company" value={saved.targetCompany} />
                        </dl>
                    </Reveal>

                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Education & Graduation</h2>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <SummaryRow label="College / University" value={saved.collegeName} />
                            <SummaryRow label="Degree & Branch" value={saved.education} />
                            <SummaryRow label="Graduation Year" value={saved.graduationYear} />
                            <SummaryRow label="CGPA / Percentage" value={saved.cgpa} />
                        </dl>
                    </Reveal>

                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><Code className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Current Skills</h2>
                        <div className="flex flex-wrap gap-2">
                            {saved.skills.length === 0 ? (
                                <span className="text-xs text-slate-400 dark:text-slate-500 italic">No skills added yet.</span>
                            ) : (
                                saved.skills.map((skill) => <SkillChip key={skill} reduce={reduce}>{skill}</SkillChip>)
                            )}
                        </div>
                    </Reveal>

                    <div className="flex justify-end pb-2">
                        <button
                            type="button"
                            onClick={startEditing}
                            className="h-12 w-full sm:w-auto justify-center px-6 sm:px-8 border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition-all cursor-pointer"
                        >
                            <Pencil className="w-4 h-4" /> Edit Profile
                        </button>
                    </div>
                </div>
            ) : (
                /* ───────────── Edit form ───────────── */
                <form id="profile-form" onSubmit={handleSave} noValidate className="space-y-6">
                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Personal & Account Information</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="pf-name" className={LABEL}>Full Name</label>
                                <input
                                    id="pf-name"
                                    type="text"
                                    value={form.fullName}
                                    maxLength={LIMITS.fullName}
                                    onChange={(e) => setField('fullName', e.target.value)}
                                    placeholder="e.g. Alex Kumar"
                                    aria-invalid={Boolean(errors.fullName)}
                                    aria-describedby={errors.fullName ? 'pf-name-err' : undefined}
                                    className={`${INPUT} ${errors.fullName ? INPUT_ERROR : ''}`}
                                />
                                <FieldError id="pf-name-err" message={errors.fullName} />
                            </div>
                            <div>
                                <label htmlFor="pf-email" className={LABEL}>Email Address</label>
                                <input id="pf-email" type="email" value={profile?.email || ''} disabled className="h-11 w-full bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed" />
                            </div>
                        </div>
                    </Reveal>

                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Career Targets</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="pf-role" className={LABEL}>Target Role</label>
                                <select
                                    id="pf-role"
                                    value={form.targetRole}
                                    onChange={(e) => setField('targetRole', e.target.value)}
                                    className={`${INPUT} ${errors.targetRole ? INPUT_ERROR : ''}`}
                                >
                                    {COMMON_ROLES.map((r) => (
                                        <option key={r} value={r} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{r}</option>
                                    ))}
                                    <option value="Other" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Other (Specify below)</option>
                                </select>
                                {form.targetRole === 'Other' && (
                                    <input
                                        type="text"
                                        aria-label="Custom target role"
                                        value={form.customRole}
                                        maxLength={LIMITS.role}
                                        onChange={(e) => setField('customRole', e.target.value)}
                                        placeholder="Enter your custom target role"
                                        className={`${INPUT} mt-2.5 ${errors.targetRole ? INPUT_ERROR : ''}`}
                                    />
                                )}
                                <FieldError id="pf-role-err" message={errors.targetRole} />
                            </div>
                            <div>
                                <label htmlFor="pf-company" className={LABEL}>
                                    Target Company <span className="text-slate-400 font-normal lowercase">(optional)</span>
                                </label>
                                <div className="relative">
                                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                    <input
                                        id="pf-company"
                                        type="text"
                                        value={form.targetCompany}
                                        maxLength={LIMITS.company}
                                        onChange={(e) => setField('targetCompany', e.target.value)}
                                        placeholder="e.g. Google, Microsoft, Startup (Optional)"
                                        className={`${INPUT} pl-10 ${errors.targetCompany ? INPUT_ERROR : ''}`}
                                    />
                                </div>
                                <FieldError id="pf-company-err" message={errors.targetCompany} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Leave blank if you are open to multiple organizations.</p>
                            </div>
                        </div>
                    </Reveal>

                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Education & Graduation</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <label htmlFor="pf-college" className={LABEL}>College / University</label>
                                <div className="relative">
                                    <School className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                    <input
                                        id="pf-college"
                                        type="text"
                                        value={form.collegeName}
                                        maxLength={LIMITS.college}
                                        onChange={(e) => setField('collegeName', e.target.value)}
                                        placeholder="e.g. KLS Vishwanathrao Deshpande Institute of Technology"
                                        className={`${INPUT} pl-10 ${errors.collegeName ? INPUT_ERROR : ''}`}
                                    />
                                </div>
                                <FieldError id="pf-college-err" message={errors.collegeName} />
                            </div>
                            <div className="sm:col-span-2">
                                <label htmlFor="pf-education" className={LABEL}>Degree & Branch</label>
                                <input
                                    id="pf-education"
                                    type="text"
                                    value={form.education}
                                    maxLength={LIMITS.education}
                                    onChange={(e) => setField('education', e.target.value)}
                                    placeholder="e.g. B.E. Computer Science and Engineering"
                                    aria-invalid={Boolean(errors.education)}
                                    className={`${INPUT} ${errors.education ? INPUT_ERROR : ''}`}
                                />
                                <FieldError id="pf-education-err" message={errors.education} />
                            </div>
                            <div>
                                <label htmlFor="pf-year" className={LABEL}>Graduation Year</label>
                                <input
                                    id="pf-year"
                                    type="number"
                                    inputMode="numeric"
                                    min="1950"
                                    max="2100"
                                    value={form.graduationYear}
                                    onChange={(e) => setField('graduationYear', e.target.value)}
                                    placeholder="e.g. 2026"
                                    aria-invalid={Boolean(errors.graduationYear)}
                                    className={`${INPUT} ${errors.graduationYear ? INPUT_ERROR : ''}`}
                                />
                                <FieldError id="pf-year-err" message={errors.graduationYear} />
                            </div>
                            <div>
                                <label htmlFor="pf-cgpa" className={LABEL}>CGPA / Percentage</label>
                                <input
                                    id="pf-cgpa"
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    value={form.cgpa}
                                    onChange={(e) => setField('cgpa', e.target.value)}
                                    placeholder="e.g. 8.5"
                                    aria-invalid={Boolean(errors.cgpa)}
                                    className={`${INPUT} ${errors.cgpa ? INPUT_ERROR : ''}`}
                                />
                                <FieldError id="pf-cgpa-err" message={errors.cgpa} />
                            </div>
                        </div>
                    </Reveal>

                    <Reveal className={CARD}>
                        <h2 className={CARD_TITLE}><Code className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Current Skills</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Add the programming languages, frameworks, and tools in your current repertoire.</p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="text"
                                aria-label="New skill"
                                value={newSkillInput}
                                maxLength={LIMITS.skill}
                                onChange={(e) => setNewSkillInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSkill(e); }}
                                placeholder="Add a skill (e.g. React, Python, Docker) and press Add"
                                className={`${INPUT} flex-1 min-w-0`}
                            />
                            <button
                                type="button"
                                onClick={handleAddSkill}
                                className="h-11 px-4 justify-center bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            >
                                <Plus className="w-4 h-4" /> Add
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-2">
                            {form.skills.length === 0 ? (
                                <span className="text-xs text-slate-400 dark:text-slate-500 italic">No skills added yet.</span>
                            ) : (
                                form.skills.map((skill) => (
                                    <SkillChip key={skill} reduce={reduce} onRemove={() => setField('skills', form.skills.filter((s) => s !== skill))}>{skill}</SkillChip>
                                ))
                            )}
                        </div>
                    </Reveal>

                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 pb-2">
                        <button
                            type="button"
                            id="profile-cancel-btn"
                            onClick={cancelEditing}
                            disabled={isSaving}
                            className="h-12 w-full sm:w-auto justify-center px-6 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <X className="w-4 h-4" /> Cancel
                        </button>
                        <motion.button
                            whileTap={{ scale: 0.97 }}
                            type="submit"
                            id="profile-save-btn"
                            disabled={isSaving}
                            className="h-12 w-full sm:w-auto justify-center px-6 sm:px-8 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            {isSaving ? (
                                <><RefreshCw className="w-4 h-4 animate-spin" /><span>Saving Profile...</span></>
                            ) : (
                                <><Save className="w-4 h-4" /><span>Save Changes</span></>
                            )}
                        </motion.button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default StudentProfile;
