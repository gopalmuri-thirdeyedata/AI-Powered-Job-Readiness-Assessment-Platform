import React, { useState, useEffect } from 'react';
import {
    Sparkles, Save, CheckCircle, AlertTriangle, RefreshCw,
    Briefcase, FileText, Target, Award, ListPlus, ChevronDown, Check, Plus
} from 'lucide-react';
import SkillTagInput from './SkillTagInput';
import API_URL from '../apiConfig';

/**
 * StructuredJobDescriptionEditor
 *
 * Recruiter component for authoring and editing structured Job Descriptions with:
 * - Role, Experience, Responsibilities, Targets, Achievements, Requirements
 * - AI Skill Suggestions via POST /api/resume/suggest-skills/
 * - Independent Required vs. Preferred skill management
 * - Recruiter selection/deselection and manual addition
 * - Saving / Updating via POST & PUT /api/resume/job-descriptions/
 * - Loading existing Job Descriptions
 */
const StructuredJobDescriptionEditor = ({
    initialJD = null,
    onSaveSuccess,
    onApplyToScreening
}) => {
    // Form State
    const [title, setTitle] = useState(initialJD?.title || initialJD?.role || '');
    const [role, setRole] = useState(initialJD?.role || initialJD?.title || '');
    const [experience, setExperience] = useState(initialJD?.experience_requirements || '');
    const [responsibilities, setResponsibilities] = useState(initialJD?.responsibilities || '');
    const [specificTargets, setSpecificTargets] = useState(initialJD?.specific_targets || '');
    const [expectedAchievements, setExpectedAchievements] = useState(initialJD?.expected_achievements || '');
    const [additionalRequirements, setAdditionalRequirements] = useState(initialJD?.additional_requirements || '');
    const [description, setDescription] = useState(initialJD?.description || '');

    // Skill Lists (Recruiter Selected)
    const [requiredSkills, setRequiredSkills] = useState(initialJD?.required_skills || []);
    const [preferredSkills, setPreferredSkills] = useState(initialJD?.preferred_skills || []);

    // AI Suggestions State
    const [aiSuggestions, setAiSuggestions] = useState([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [suggestionError, setSuggestionError] = useState(null);
    const [hasSuggested, setHasSuggested] = useState(false);

    // Save State
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);
    const [validationError, setValidationError] = useState(null);

    // Saved JDs list for loading
    const [savedJDs, setSavedJDs] = useState([]);
    const [selectedJdId, setSelectedJdId] = useState(initialJD?.id || '');

    // Fetch existing JDs on mount
    useEffect(() => {
        const fetchJDs = async () => {
            const token = localStorage.getItem('token');
            try {
                const res = await fetch(`${API_URL}/api/resume/job-descriptions/`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                });
                if (res.ok) {
                    const data = await res.json();
                    setSavedJDs(data || []);
                }
            } catch (err) {
                console.warn('[StructuredJD] Could not fetch saved JDs:', err);
            }
        };
        fetchJDs();
    }, []);

    // Load selected JD from dropdown
    const handleSelectExistingJD = (jdId) => {
        setSelectedJdId(jdId);
        if (!jdId) return;

        const found = savedJDs.find(j => String(j.id) === String(jdId));
        if (found) {
            setTitle(found.title || found.role || '');
            setRole(found.role || found.title || '');
            setExperience(found.experience_requirements || '');
            setResponsibilities(found.responsibilities || '');
            setSpecificTargets(found.specific_targets || '');
            setExpectedAchievements(found.expected_achievements || '');
            setAdditionalRequirements(found.additional_requirements || '');
            setDescription(found.description || '');
            setRequiredSkills(found.required_skills || []);
            setPreferredSkills(found.preferred_skills || []);
            setAiSuggestions([]);
            setHasSuggested(false);
        }
    };

    // AI Skill Suggestion Trigger
    const handleSuggestSkills = async () => {
        setIsSuggesting(true);
        setSuggestionError(null);

        const payload = {
            role: role || title,
            title: title || role,
            description: description,
            responsibilities: responsibilities,
            experience_requirements: experience,
            specific_targets: specificTargets,
            expected_achievements: expectedAchievements,
            additional_requirements: additionalRequirements,
            required_skills: requiredSkills,
            preferred_skills: preferredSkills
        };

        const token = localStorage.getItem('token');

        try {
            const res = await fetch(`${API_URL}/api/resume/suggest-skills/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Skill suggestion failed');
            }

            const data = await res.json();
            const suggestions = data.skills || [];
            setAiSuggestions(suggestions);
            setHasSuggested(true);

            if (suggestions.length === 0) {
                setSuggestionError('No specific skills were extracted. Please provide more detail in the Role or Responsibilities fields.');
            }
        } catch (err) {
            console.warn('[StructuredJD] AI Suggestion error:', err);
            setSuggestionError('AI suggestions could not be reached. You can manually enter your required and preferred skills below.');
        } finally {
            setIsSuggesting(false);
        }
    };

    // Toggle skill into Required
    const handleToggleRequired = (skill) => {
        const lower = skill.toLowerCase();
        if (requiredSkills.some(s => s.toLowerCase() === lower)) {
            setRequiredSkills(requiredSkills.filter(s => s.toLowerCase() !== lower));
        } else {
            // Remove from preferred if present to maintain separation
            setPreferredSkills(preferredSkills.filter(s => s.toLowerCase() !== lower));
            setRequiredSkills([...requiredSkills, skill]);
        }
    };

    // Toggle skill into Preferred
    const handleTogglePreferred = (skill) => {
        const lower = skill.toLowerCase();
        if (preferredSkills.some(s => s.toLowerCase() === lower)) {
            setPreferredSkills(preferredSkills.filter(s => s.toLowerCase() !== lower));
        } else {
            // Remove from required if present to maintain separation
            setRequiredSkills(requiredSkills.filter(s => s.toLowerCase() !== lower));
            setPreferredSkills([...preferredSkills, skill]);
        }
    };

    // Save / Persist Structured Job Description
    const handleSaveJD = async () => {
        setValidationError(null);
        setSaveMessage(null);

        const currentRole = (role || title).trim();
        if (!currentRole) {
            setValidationError('Job Role or Title is required to save.');
            return;
        }

        setIsSaving(true);
        const token = localStorage.getItem('token');

        const payload = {
            title: title.trim() || currentRole,
            role: currentRole,
            description: description.trim() || null,
            responsibilities: responsibilities.trim() || null,
            experience_requirements: experience.trim() || null,
            specific_targets: specificTargets.trim() || null,
            expected_achievements: expectedAchievements.trim() || null,
            additional_requirements: additionalRequirements.trim() || null,
            required_skills: requiredSkills,
            preferred_skills: preferredSkills
        };

        const isUpdate = Boolean(selectedJdId);
        const url = isUpdate
            ? `${API_URL}/api/resume/job-descriptions/${selectedJdId}/`
            : `${API_URL}/api/resume/job-descriptions/`;
        const method = isUpdate ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to save Job Description');
            }

            const savedData = await res.json();
            setSaveMessage(isUpdate ? 'Job Description updated successfully!' : 'Job Description saved successfully!');
            setTimeout(() => setSaveMessage(null), 4000);

            if (!isUpdate && savedData.id) {
                setSelectedJdId(savedData.id);
                setSavedJDs(prev => [savedData, ...prev]);
            }

            if (onSaveSuccess) onSaveSuccess(savedData);
        } catch (err) {
            setValidationError(err.message || 'Failed to save.');
        } finally {
            setIsSaving(false);
        }
    };

    // Compile text representation for resume screening or export
    const handleApply = () => {
        const composite = [
            `Role: ${role || title}`,
            experience ? `Experience Required: ${experience}` : '',
            responsibilities ? `Responsibilities:\n${responsibilities}` : '',
            requiredSkills.length ? `Required Skills: ${requiredSkills.join(', ')}` : '',
            preferredSkills.length ? `Preferred Skills: ${preferredSkills.join(', ')}` : '',
            specificTargets ? `Specific Targets: ${specificTargets}` : '',
            expectedAchievements ? `Expected Achievements: ${expectedAchievements}` : '',
            additionalRequirements ? `Additional Requirements: ${additionalRequirements}` : '',
            description ? `Overview: ${description}` : ''
        ].filter(Boolean).join('\n\n');

        if (onApplyToScreening) {
            onApplyToScreening({
                compiledText: composite,
                jobDescriptionId: selectedJdId || null,
                role: role || title,
                requiredSkills,
                preferredSkills
            });
        }
    };

    return (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-6">
            {/* Header / Selector */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-gray-100">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Briefcase size={20} className="text-[#5d8c2c]" />
                        <span>Structured Job Description</span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Define role criteria, responsibilities, and recruiter-curated skills.
                    </p>
                </div>

                {/* Dropdown for saved JDs */}
                {savedJDs.length > 0 && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">Load Saved:</label>
                        <select
                            value={selectedJdId}
                            onChange={(e) => handleSelectExistingJD(e.target.value)}
                            className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#5d8c2c] text-gray-700"
                        >
                            <option value="">-- New Job Description --</option>
                            {savedJDs.map(jd => (
                                <option key={jd.id} value={jd.id}>
                                    {jd.role || jd.title} (#{jd.id})
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Validation & Feedback Banners */}
            {validationError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-xs border border-red-200">
                    <AlertTriangle size={15} className="flex-shrink-0" />
                    <span>{validationError}</span>
                </div>
            )}
            {saveMessage && (
                <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-xl text-xs border border-green-200">
                    <CheckCircle size={15} className="flex-shrink-0" />
                    <span>{saveMessage}</span>
                </div>
            )}

            {/* Core Fields Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Role / Title */}
                <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                        Job Role / Title <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={role}
                        onChange={(e) => {
                            setRole(e.target.value);
                            if (!title) setTitle(e.target.value);
                        }}
                        placeholder="e.g. Backend Developer"
                        className="w-full px-3.5 py-2 text-sm bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 transition-all"
                    />
                </div>

                {/* Experience Requirements */}
                <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                        Experience Requirements
                    </label>
                    <input
                        type="text"
                        value={experience}
                        onChange={(e) => setExperience(e.target.value)}
                        placeholder="e.g. 2–4 years"
                        className="w-full px-3.5 py-2 text-sm bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 transition-all"
                    />
                </div>
            </div>

            {/* Responsibilities */}
            <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <FileText size={13} className="text-gray-400" />
                    <span>Responsibilities</span>
                </label>
                <textarea
                    rows={3}
                    value={responsibilities}
                    onChange={(e) => setResponsibilities(e.target.value)}
                    placeholder="Describe daily duties, architectural responsibilities, and team collaboration..."
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 transition-all resize-y"
                />
            </div>

            {/* Specific Targets & Expected Achievements */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <Target size={13} className="text-gray-400" />
                        <span>Specific Targets</span>
                    </label>
                    <input
                        type="text"
                        value={specificTargets}
                        onChange={(e) => setSpecificTargets(e.target.value)}
                        placeholder="e.g. High-throughput APIs, 99.9% uptime"
                        className="w-full px-3.5 py-2 text-sm bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 transition-all"
                    />
                </div>

                <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <Award size={13} className="text-gray-400" />
                        <span>Expected Achievements</span>
                    </label>
                    <input
                        type="text"
                        value={expectedAchievements}
                        onChange={(e) => setExpectedAchievements(e.target.value)}
                        placeholder="e.g. Lead migration to microservices"
                        className="w-full px-3.5 py-2 text-sm bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 transition-all"
                    />
                </div>
            </div>

            {/* Additional Requirements */}
            <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <ListPlus size={13} className="text-gray-400" />
                    <span>Additional Requirements</span>
                </label>
                <input
                    type="text"
                    value={additionalRequirements}
                    onChange={(e) => setAdditionalRequirements(e.target.value)}
                    placeholder="e.g. Willingness to work in hybrid environment, security clearance..."
                    className="w-full px-3.5 py-2 text-sm bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 transition-all"
                />
            </div>

            {/* AI Skill Suggestion Section */}
            <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-purple-50/40 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                            <Sparkles size={16} className="text-indigo-600 animate-pulse" />
                            <span>AI Skill Suggestions</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
                                Recommendation Only
                            </span>
                        </h3>
                        <p className="text-xs text-indigo-700/80 mt-0.5">
                            Analyze the job description fields above to generate technical skill recommendations.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={handleSuggestSkills}
                        disabled={isSuggesting}
                        className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-200/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                        {isSuggesting ? (
                            <>
                                <RefreshCw size={13} className="animate-spin" />
                                <span>Analyzing JD...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={13} />
                                <span>Generate Skill Suggestions</span>
                            </>
                        )}
                    </button>
                </div>

                {/* AI Error Banner */}
                {suggestionError && (
                    <div className="text-xs p-3 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 flex items-start gap-2">
                        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                        <div>
                            <span className="font-semibold">Notice: </span>
                            <span>{suggestionError}</span>
                        </div>
                    </div>
                )}

                {/* AI Suggestions Chips */}
                {aiSuggestions.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-indigo-100/70">
                        <div className="flex items-center justify-between text-xs text-indigo-900 font-semibold">
                            <span>Suggested Skills ({aiSuggestions.length}): Click to assign</span>
                            <span className="text-gray-400 font-normal">Recruiter controls final selection</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {aiSuggestions.map((skill) => {
                                const isReq = requiredSkills.some(s => s.toLowerCase() === skill.toLowerCase());
                                const isPref = preferredSkills.some(s => s.toLowerCase() === skill.toLowerCase());

                                return (
                                    <div
                                        key={skill}
                                        className={`inline-flex items-center rounded-lg border text-xs overflow-hidden shadow-sm transition-all ${
                                            isReq
                                                ? 'bg-blue-100/80 border-blue-300 text-blue-900'
                                                : isPref
                                                    ? 'bg-purple-100/80 border-purple-300 text-purple-900'
                                                    : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300'
                                        }`}
                                    >
                                        <span className="px-2.5 py-1 font-semibold flex items-center gap-1">
                                            {isReq && <Check size={12} className="text-blue-600" />}
                                            {isPref && <Check size={12} className="text-purple-600" />}
                                            <span>{skill}</span>
                                        </span>
                                        <div className="flex border-l border-gray-200/80 text-[10px]">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleRequired(skill)}
                                                className={`px-1.5 py-1 transition-colors ${
                                                    isReq
                                                        ? 'bg-blue-600 text-white font-bold'
                                                        : 'hover:bg-blue-50 text-blue-700 font-medium'
                                                }`}
                                                title={isReq ? 'Remove from Required' : 'Add to Required'}
                                            >
                                                {isReq ? '✓ Req' : '+ Req'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleTogglePreferred(skill)}
                                                className={`px-1.5 py-1 border-l border-gray-200/80 transition-colors ${
                                                    isPref
                                                        ? 'bg-purple-600 text-white font-bold'
                                                        : 'hover:bg-purple-50 text-purple-700 font-medium'
                                                }`}
                                                title={isPref ? 'Remove from Preferred' : 'Add to Preferred'}
                                            >
                                                {isPref ? '✓ Pref' : '+ Pref'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Recruiter Skill Selection (Required vs Preferred) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                {/* Required Skills Input */}
                <div className="bg-blue-50/30 rounded-2xl p-4 border border-blue-100/80">
                    <SkillTagInput
                        label="Required Skills"
                        skills={requiredSkills}
                        onChange={setRequiredSkills}
                        placeholder="Add required skill (e.g. Python, SQL)..."
                        badgeVariant="blue"
                        helperText="Mandatory qualifications"
                    />
                </div>

                {/* Preferred Skills Input */}
                <div className="bg-purple-50/30 rounded-2xl p-4 border border-purple-100/80">
                    <SkillTagInput
                        label="Preferred Skills"
                        skills={preferredSkills}
                        onChange={setPreferredSkills}
                        placeholder="Add preferred skill (e.g. Docker, AWS)..."
                        badgeVariant="purple"
                        helperText="Nice-to-have qualifications"
                    />
                </div>
            </div>

            {/* Footer Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-gray-100">
                <div className="text-xs text-gray-500">
                    Total Selected: <strong className="text-gray-800">{requiredSkills.length}</strong> required,{' '}
                    <strong className="text-gray-800">{preferredSkills.length}</strong> preferred
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    {onApplyToScreening && (
                        <button
                            type="button"
                            onClick={handleApply}
                            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                            Apply to Screening
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={handleSaveJD}
                        disabled={isSaving}
                        className="flex-1 sm:flex-none px-5 py-2.5 bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] hover:from-[#527d26] hover:to-[#406b1a] text-white rounded-xl text-xs font-bold shadow-md shadow-green-200/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                        {isSaving ? (
                            <>
                                <RefreshCw size={14} className="animate-spin" />
                                <span>Saving...</span>
                            </>
                        ) : (
                            <>
                                <Save size={14} />
                                <span>{selectedJdId ? 'Update Job Description' : 'Save Job Description'}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StructuredJobDescriptionEditor;
