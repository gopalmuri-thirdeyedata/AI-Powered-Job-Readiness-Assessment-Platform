import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COMMON_ROLES, EMPTY_FORM, formFromProfile, hasSavedDetails, effectiveRole, addSkill, validateProfileForm,
    buildPayload, isDirty, apiErrorMessage, PROFILE_UPDATED_EVENT,
} from './src/utils/profileForm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, 'src', ...p), 'utf-8');

const SERVER = {
    full_name: 'Gopal Muri', email: 'g@x.com', target_role: 'Software Engineer', target_company: 'google',
    college_name: 'KLS VDIT', education: 'B.E. Computer Science and Engineering', graduation_year: 2026, cgpa: 8.2,
    current_skills: ['Python', 'Java'],
};

describe('Profile form logic', () => {
    test('1. a saved profile fills every field, including the education that used to vanish', () => {
        const f = formFromProfile(SERVER);
        assert.equal(f.education, 'B.E. Computer Science and Engineering');
        assert.equal(f.collegeName, 'KLS VDIT');
        assert.equal(f.graduationYear, '2026');
        assert.equal(f.cgpa, '8.2');
        assert.deepEqual(f.skills, ['Python', 'Java']);
        assert.equal(f.targetCompany, 'google');
    });

    test('2. a CGPA or year of 0 is kept, only null is empty', () => {
        assert.equal(formFromProfile({ ...SERVER, cgpa: 0 }).cgpa, '0');
        assert.equal(formFromProfile({ ...SERVER, cgpa: null, graduation_year: null }).cgpa, '');
        assert.deepEqual(formFromProfile(null), EMPTY_FORM);
    });

    test('3. older responses that only carry `branch` still show the degree', () => {
        assert.equal(formFromProfile({ ...SERVER, education: null, branch: 'Mechanical' }).education, 'Mechanical');
    });

    test('4. a role outside the list is shown as "Other" with the saved text', () => {
        const f = formFromProfile({ ...SERVER, target_role: 'Quantum Plumber' });
        assert.equal(f.targetRole, 'Other');
        assert.equal(f.customRole, 'Quantum Plumber');
        assert.equal(effectiveRole(f), 'Quantum Plumber');
        assert.equal(effectiveRole(formFromProfile({ ...SERVER, target_role: COMMON_ROLES[2] })), COMMON_ROLES[2]);
    });

    test('5. the page opens in view mode only when something has been saved', () => {
        assert.equal(hasSavedDetails(SERVER), true);
        assert.equal(hasSavedDetails({ current_skills: [] }), false);
        assert.equal(hasSavedDetails({ cgpa: 0 }), true);
        assert.equal(hasSavedDetails({ education: 'B.Sc' }), true);
        assert.equal(hasSavedDetails(null), false);
    });
});

describe('Saving', () => {
    const form = () => formFromProfile(SERVER);

    test('6. the payload sends `education` (the field the server really stores) and parsed numbers', () => {
        const body = buildPayload(form());
        assert.equal(body.education, 'B.E. Computer Science and Engineering');
        assert.equal(body.college_name, 'KLS VDIT');
        assert.equal(body.graduation_year, 2026);
        assert.equal(body.cgpa, 8.2);
        assert.deepEqual(body.current_skills, ['Python', 'Java']);
    });

    test('7. a cleared optional field is sent as null so the server really clears it', () => {
        const body = buildPayload({ ...form(), targetCompany: '  ', collegeName: '', education: ' ', graduationYear: '', cgpa: '' });
        assert.equal(body.target_company, null);
        assert.equal(body.college_name, null);
        assert.equal(body.education, null);
        assert.equal(body.graduation_year, null);
        assert.equal(body.cgpa, null);
    });

    test('8. valid data passes, bad data is caught before any request is made', () => {
        assert.deepEqual(validateProfileForm(form()), {});
        assert.ok(validateProfileForm({ ...form(), fullName: '  ' }).fullName);
        assert.ok(validateProfileForm({ ...form(), targetRole: 'Other', customRole: ' ' }).targetRole);
        assert.ok(validateProfileForm({ ...form(), graduationYear: '1800' }).graduationYear);
        assert.ok(validateProfileForm({ ...form(), graduationYear: '2026.5' }).graduationYear);
        assert.ok(validateProfileForm({ ...form(), cgpa: '150' }).cgpa);
        assert.ok(validateProfileForm({ ...form(), cgpa: 'abc' }).cgpa);
        assert.ok(validateProfileForm({ ...form(), education: 'x'.repeat(101) }).education);
        assert.deepEqual(validateProfileForm({ ...form(), graduationYear: '', cgpa: '' }), {});
        assert.deepEqual(validateProfileForm({ ...form(), cgpa: '0' }), {});
    });

    test('9. skills are trimmed, de-duplicated ignoring case, and never added empty', () => {
        const base = ['Python'];
        assert.deepEqual(addSkill(base, '  React '), ['Python', 'React']);
        assert.equal(addSkill(base, 'python'), base);
        assert.equal(addSkill(base, '   '), base);
        assert.equal(addSkill(base, null), base);
        assert.equal(addSkill(base, 'x'.repeat(200)).at(-1).length, 60);
    });

    test('10. unsaved edits are detected, and undoing them is not "dirty"', () => {
        const f = form();
        assert.equal(isDirty(f, SERVER), false);
        assert.equal(isDirty({ ...f, education: 'Changed' }, SERVER), true);
        assert.equal(isDirty({ ...f, skills: [...f.skills, 'Go'] }, SERVER), true);
        assert.equal(isDirty({ ...f, education: SERVER.education }, SERVER), false);
    });

    test('11. server errors become readable messages', () => {
        assert.equal(apiErrorMessage({ response: { data: { detail: 'Not allowed' } } }), 'Not allowed');
        const list = apiErrorMessage({ response: { data: { detail: [{ loc: ['body', 'graduation_year'], msg: 'must be at most 2100' }] } } });
        assert.match(list, /graduation year: must be at most 2100/);
        assert.match(apiErrorMessage({ message: 'Network Error' }), /could not reach the server/i);
        assert.equal(apiErrorMessage({ response: { data: {} } }, 'fallback text'), 'fallback text');
    });
});

describe('Profile page wiring', () => {
    const page = read('pages', 'student', 'StudentProfile.jsx');

    test('12. there is an Edit Profile button, a read-only view, and Save and Cancel in the form', () => {
        assert.ok(page.includes('id="profile-edit-btn"') && page.includes('Edit Profile'));
        assert.ok(page.includes('id="profile-view"') && page.includes('id="profile-form"'));
        assert.ok(page.includes('id="profile-save-btn"') && page.includes('id="profile-cancel-btn"'));
    });

    test('13. after a save the page returns to the view and shows what the server stored', () => {
        const save = page.slice(page.indexOf('const handleSave'), page.indexOf('// Completeness follows'));
        assert.ok(save.includes('setProfile(updated)'));
        assert.ok(save.includes('setForm(formFromProfile(updated))'));
        assert.ok(save.includes('setIsEditing(false)'));
        assert.ok(save.includes('PROFILE_UPDATED_EVENT'));
    });

    test('14. a skill typed but not yet added is saved, and failed saves keep the form open with the error', () => {
        const save = page.slice(page.indexOf('const handleSave'), page.indexOf('// Completeness follows'));
        assert.ok(save.includes('addSkill(form.skills, newSkillInput)'));
        const catchBlock = save.slice(save.indexOf('} catch (err) {'), save.indexOf('} finally {'));
        assert.ok(!catchBlock.includes('setIsEditing(false)'), 'a failed save must not leave edit mode');
        assert.ok(catchBlock.includes('apiErrorMessage(err)'));
    });

    test('15. unsaved changes are protected: discard confirm and a page-unload warning', () => {
        assert.ok(page.includes("window.confirm('Discard your unsaved changes?')"));
        assert.ok(page.includes("'beforeunload'"));
    });

    test('16. the old broken field mix-up is gone: education is read from `education`, saved via the payload helper', () => {
        assert.ok(!page.includes('data.education || \'\''), 'no more reading an unsupported field ad hoc');
        assert.ok(page.includes('buildPayload('));
    });

    test('17. the sidebar refreshes the saved name and role through the shared event', () => {
        const layout = read('layouts', 'StudentLayout.jsx');
        assert.equal(PROFILE_UPDATED_EVENT, 'prepwin:profile-updated');
        assert.ok(layout.includes('PROFILE_UPDATED_EVENT') && layout.includes('addEventListener(PROFILE_UPDATED_EVENT'));
    });

    test('18. the page loads straight from the server every time, so saved data survives logout and login', () => {
        assert.ok(page.includes('studentApi.getProfile()'));
        assert.ok(!page.includes('localStorage'), 'profile data must come from the server, not a local copy');
    });
});
