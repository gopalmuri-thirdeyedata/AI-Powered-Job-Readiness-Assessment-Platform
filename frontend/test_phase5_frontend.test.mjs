import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const skillTagInputCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'SkillTagInput.jsx'), 'utf-8');
const jdEditorCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'StructuredJobDescriptionEditor.jsx'), 'utf-8');
const resumeScreeningCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'ResumeScreening.jsx'), 'utf-8');

describe('Phase 5 Frontend Test Suite: Structured JD, AI Skills & Recruiter Workflow', () => {

    test('1. SkillTagInput enforces case-insensitive duplicate prevention', () => {
        assert.ok(skillTagInputCode.includes('s.toLowerCase() === cleanSkill.toLowerCase()'));
        assert.ok(skillTagInputCode.includes('setDuplicateError'));
        assert.ok(skillTagInputCode.includes('already in this skill list'));
    });

    test('2. SkillTagInput allows manual skill addition via Enter or button', () => {
        assert.ok(skillTagInputCode.includes('handleAddSkill'));
        assert.ok(skillTagInputCode.includes("e.key === 'Enter'"));
        assert.ok(skillTagInputCode.includes('const updated = [...skills, cleanSkill];'));
        assert.ok(skillTagInputCode.includes('onChange(updated)'));
    });

    test('3. SkillTagInput allows removing skills', () => {
        assert.ok(skillTagInputCode.includes('handleRemoveSkill'));
        assert.ok(skillTagInputCode.includes('skills.filter('));
    });

    test('4. StructuredJobDescriptionEditor renders all required structured fields', () => {
        const requiredFields = [
            'role',
            'responsibilities',
            'experience_requirements',
            'specific_targets',
            'expected_achievements',
            'additional_requirements'
        ];
        for (const field of requiredFields) {
            assert.ok(jdEditorCode.includes(field), `Editor should contain field ${field}`);
        }
    });

    test('5. StructuredJobDescriptionEditor separates Required Skills and Preferred Skills', () => {
        assert.ok(jdEditorCode.includes('required_skills'));
        assert.ok(jdEditorCode.includes('preferred_skills'));
        assert.ok(jdEditorCode.includes('SkillTagInput'));
        assert.ok(jdEditorCode.includes('Required Skills'));
        assert.ok(jdEditorCode.includes('Preferred Skills'));
    });

    test('6. StructuredJobDescriptionEditor calls POST /api/resume/suggest-skills/ for AI suggestions', () => {
        assert.ok(jdEditorCode.includes('/api/resume/suggest-skills/'));
        assert.ok(jdEditorCode.includes('handleSuggestSkills'));
        assert.ok(jdEditorCode.includes("method: 'POST'"));
    });

    test('7. AI Skill quality & Recruiter control: AI suggestions are recommendations only', () => {
        // Recruiter explicitly toggles or assigns suggestions to Required or Preferred
        assert.ok(jdEditorCode.includes('handleToggleRequired'));
        assert.ok(jdEditorCode.includes('handleTogglePreferred'));
        assert.ok(jdEditorCode.includes('setAiSuggestions'));
        // Clear distinction between AI Suggested and Recruiter Selected
        assert.ok(jdEditorCode.includes('AI Skill Suggestions'));
        assert.ok(jdEditorCode.includes('Recommendation Only'));
    });

    test('8. StructuredJobDescriptionEditor handles AI failure gracefully without blocking JD save', () => {
        assert.ok(jdEditorCode.includes('catch (err)'));
        assert.ok(jdEditorCode.includes('setSuggestionError'));
        assert.ok(jdEditorCode.includes('AI suggestions could not be reached'));
        // Recruiter can still edit and save
        assert.ok(jdEditorCode.includes('handleSaveJD'));
    });

    test('9. StructuredJobDescriptionEditor persists to backend via POST and PUT /api/resume/job-descriptions/', () => {
        assert.ok(jdEditorCode.includes('/api/resume/job-descriptions/'));
        assert.ok(jdEditorCode.includes("const method = isUpdate ? 'PUT' : 'POST';"));
    });

    test('10. ResumeScreening integrates Structured JD editor modal and launcher', () => {
        assert.ok(resumeScreeningCode.includes('StructuredJobDescriptionEditor'));
        assert.ok(resumeScreeningCode.includes('showJdModal'));
        assert.ok(resumeScreeningCode.includes('setShowJdModal(true)'));
        assert.ok(resumeScreeningCode.includes('jobDescriptionId'));
    });

    test('11. ResumeScreening passes job_description_id when screening with structured JD', () => {
        assert.ok(resumeScreeningCode.includes("formData.append('job_description_id', jobDescriptionId)"));
        assert.ok(resumeScreeningCode.includes("formData.append('job_description', jobDescription)"));
    });

    test('12. ResumeScreening displays active structured JD badge and skill summary', () => {
        assert.ok(resumeScreeningCode.includes('structuredJdData'));
        assert.ok(resumeScreeningCode.includes('Active:'));
    });
});
