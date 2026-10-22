// Form logic for the student profile page, kept free of React so it can be tested.

export const COMMON_ROLES = [
    'Software Engineer',
    'Full Stack Developer',
    'Frontend Developer',
    'Backend Developer',
    'Python Developer',
    'Java Developer',
    'Data Engineer',
    'Machine Learning Engineer',
    'DevOps Engineer',
    'Cloud Engineer',
];

// Fired after a profile save so other parts of the app (sidebar, header) can show the new name and role
export const PROFILE_UPDATED_EVENT = 'prepwin:profile-updated';

export const LIMITS = { fullName: 150, role: 100, company: 100, college: 200, education: 100, skill: 60, skills: 100 };

export const EMPTY_FORM = {
    fullName: '', targetRole: 'Software Engineer', customRole: '', targetCompany: '',
    collegeName: '', education: '', graduationYear: '', cgpa: '', skills: [],
};

/** Server profile -> form values. A saved value that is not in the role list is shown as "Other". */
export const formFromProfile = (data) => {
    if (!data) return { ...EMPTY_FORM };
    const role = data.target_role || '';
    const known = COMMON_ROLES.includes(role);
    return {
        fullName: data.full_name || '',
        targetRole: known ? role : (role ? 'Other' : 'Software Engineer'),
        customRole: known ? '' : role,
        targetCompany: data.target_company || '',
        collegeName: data.college_name || '',
        education: data.education || data.branch || '',
        graduationYear: data.graduation_year != null ? String(data.graduation_year) : '',
        cgpa: data.cgpa != null ? String(data.cgpa) : '',
        skills: Array.isArray(data.current_skills) ? [...data.current_skills] : [],
    };
};

/** True once the student has saved any education or skills, so the page can open in read-only view. */
export const hasSavedDetails = (data) => Boolean(
    data && (data.education || data.branch || data.college_name || data.graduation_year != null
        || data.cgpa != null || (Array.isArray(data.current_skills) && data.current_skills.length)),
);

export const effectiveRole = (form) => (form.targetRole === 'Other' ? form.customRole : form.targetRole).trim();

/** Adds a skill unless it is empty, too long or already there (ignoring case). Returns the new list. */
export const addSkill = (skills, raw) => {
    const skill = String(raw ?? '').trim().slice(0, LIMITS.skill);
    if (!skill || skills.length >= LIMITS.skills || skills.some((s) => s.toLowerCase() === skill.toLowerCase())) return skills;
    return [...skills, skill];
};

/** Field-level problems, empty when the form can be saved. */
export const validateProfileForm = (form) => {
    const errors = {};
    if (!form.fullName.trim()) errors.fullName = 'Please enter your full name.';
    else if (form.fullName.trim().length > LIMITS.fullName) errors.fullName = `Keep your name under ${LIMITS.fullName} characters.`;
    const role = effectiveRole(form);
    if (!role) errors.targetRole = 'Please specify your target career role.';
    else if (role.length > LIMITS.role) errors.targetRole = `Keep the role under ${LIMITS.role} characters.`;
    if (form.targetCompany.trim().length > LIMITS.company) errors.targetCompany = `Keep the company under ${LIMITS.company} characters.`;
    if (form.collegeName.trim().length > LIMITS.college) errors.collegeName = `Keep the college name under ${LIMITS.college} characters.`;
    if (form.education.trim().length > LIMITS.education) errors.education = `Keep this under ${LIMITS.education} characters.`;

    if (form.graduationYear.trim() !== '') {
        const year = Number(form.graduationYear);
        if (!Number.isInteger(year) || year < 1950 || year > 2100) errors.graduationYear = 'Enter a year between 1950 and 2100.';
    }
    if (form.cgpa.trim() !== '') {
        const cgpa = Number(form.cgpa);
        if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 100) errors.cgpa = 'Enter a number between 0 and 100.';
    }
    return errors;
};

/** Form values -> request body. Cleared optional fields are sent as null so the server really clears them. */
export const buildPayload = (form) => {
    const orNull = (v) => (v.trim() === '' ? null : v.trim());
    return {
        full_name: form.fullName.trim(),
        target_role: effectiveRole(form),
        target_company: orNull(form.targetCompany),
        college_name: orNull(form.collegeName),
        education: orNull(form.education),
        graduation_year: form.graduationYear.trim() === '' ? null : parseInt(form.graduationYear, 10),
        cgpa: form.cgpa.trim() === '' ? null : parseFloat(form.cgpa),
        current_skills: form.skills,
    };
};

export const isDirty = (form, savedProfile) => JSON.stringify(form) !== JSON.stringify(formFromProfile(savedProfile));

/** A readable message from an Axios error, including FastAPI's list-style validation errors. */
export const apiErrorMessage = (err, fallback = 'Failed to update profile. Please try again.') => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail.length) {
        return detail
            .map((d) => {
                const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : '';
                return field ? `${String(field).replace(/_/g, ' ')}: ${d.msg}` : d.msg;
            })
            .join('. ');
    }
    if (err && !err.response) return 'Could not reach the server. Check your connection and try again.';
    return fallback;
};
