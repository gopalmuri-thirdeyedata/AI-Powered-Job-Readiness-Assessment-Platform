import React, { useState } from 'react';
import { Plus, X, Tag, AlertCircle } from 'lucide-react';

/**
 * SkillTagInput
 *
 * Reusable tag input for recruiter skill selection with duplicate prevention,
 * whitespace normalization, and clear visual tags.
 *
 * Props:
 * - label: string (e.g. "Required Skills", "Preferred Skills")
 * - skills: string[] (array of currently selected skills)
 * - onChange: (updatedSkills: string[]) => void
 * - placeholder: string
 * - badgeVariant: 'blue' | 'purple' | 'emerald' | 'amber'
 * - helperText: string
 */
const SkillTagInput = ({
    label = 'Skills',
    skills = [],
    onChange,
    placeholder = 'Type skill (e.g. Python, Docker) and press Enter...',
    badgeVariant = 'blue',
    helperText
}) => {
    const [inputValue, setInputValue] = useState('');
    const [duplicateError, setDuplicateError] = useState(null);

    const variantStyles = {
        blue: {
            tag: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
            button: 'bg-blue-600 hover:bg-blue-700 text-white',
            border: 'focus:border-blue-500 focus:ring-blue-100'
        },
        purple: {
            tag: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
            button: 'bg-purple-600 hover:bg-purple-700 text-white',
            border: 'focus:border-purple-500 focus:ring-purple-100'
        },
        emerald: {
            tag: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
            button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
            border: 'focus:border-emerald-500 focus:ring-emerald-100'
        },
        amber: {
            tag: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
            button: 'bg-amber-600 hover:bg-amber-700 text-white',
            border: 'focus:border-amber-500 focus:ring-amber-100'
        }
    };

    const currentStyle = variantStyles[badgeVariant] || variantStyles.blue;

    const handleAddSkill = (skillToAdd) => {
        const raw = (skillToAdd || inputValue).trim();
        if (!raw) return;

        // Clean formatting
        const cleanSkill = raw.replace(/^[,;.\s]+|[,;.\s]+$/g, '');
        if (!cleanSkill) return;

        // Duplicate check (case-insensitive)
        const isDuplicate = skills.some(s => s.toLowerCase() === cleanSkill.toLowerCase());
        if (isDuplicate) {
            setDuplicateError(`"${cleanSkill}" is already in this skill list.`);
            setTimeout(() => setDuplicateError(null), 3000);
            return;
        }

        setDuplicateError(null);
        const updated = [...skills, cleanSkill];
        if (onChange) onChange(updated);
        setInputValue('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            handleAddSkill();
        }
    };

    const handleRemoveSkill = (indexToRemove) => {
        const updated = skills.filter((_, idx) => idx !== indexToRemove);
        if (onChange) onChange(updated);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Tag size={13} className="text-gray-400" />
                    <span>{label}</span>
                    <span className="text-xs font-normal text-gray-500 lowercase">({skills.length} selected)</span>
                </label>
                {helperText && <span className="text-xs text-gray-400">{helperText}</span>}
            </div>

            {/* Input Row */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            if (duplicateError) setDuplicateError(null);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        className={`w-full px-3.5 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 ${currentStyle.border} transition-all`}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => handleAddSkill()}
                    className={`px-4 py-2 text-sm font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-sm ${currentStyle.button}`}
                >
                    <Plus size={15} /> Add
                </button>
            </div>

            {/* Duplicate Error Alert */}
            {duplicateError && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span>{duplicateError}</span>
                </div>
            )}

            {/* Selected Skill Tags */}
            {skills.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                    {skills.map((skill, index) => (
                        <span
                            key={`${skill}-${index}`}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${currentStyle.tag}`}
                        >
                            <span>{skill}</span>
                            <button
                                type="button"
                                onClick={() => handleRemoveSkill(index)}
                                title={`Remove ${skill}`}
                                className="p-0.5 rounded-md hover:bg-black/10 transition-colors"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-gray-400 italic pt-1">No skills selected yet. Add skills or select from AI suggestions.</p>
            )}
        </div>
    );
};

export default SkillTagInput;
