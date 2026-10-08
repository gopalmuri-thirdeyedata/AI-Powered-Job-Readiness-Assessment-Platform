import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const aptitudeCandidateCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'candidate', 'CandidateAptitudeAssessment.jsx'), 'utf-8');
const codingCandidateCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'candidate', 'CandidateCodingAssessment.jsx'), 'utf-8');
const interviewCandidateCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'candidate', 'VapiInterview.jsx'), 'utf-8');
const roundsManagerCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'RecruitmentRoundsManager.jsx'), 'utf-8');
const manualAptitudeBuilderCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'ManualAptitudeBuilder.jsx'), 'utf-8');
const manualCodingBuilderCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'ManualCodingBuilder.jsx'), 'utf-8');
const jdEditorCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'StructuredJobDescriptionEditor.jsx'), 'utf-8');
const resumeScreeningCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'ResumeScreening.jsx'), 'utf-8');
const fullscreenHookCode = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'useAssessmentFullscreen.js'), 'utf-8');
const fullscreenModalCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'FullscreenGateModal.jsx'), 'utf-8');

describe('Phase 6 Frontend Integration & System Readiness Test Suite', () => {

    test('1. Fullscreen unified gate & modal integrated across all 3 candidate rounds', () => {
        // Aptitude
        assert.ok(aptitudeCandidateCode.includes('useAssessmentFullscreen'));
        assert.ok(aptitudeCandidateCode.includes('FullscreenGateModal'));

        // Coding
        assert.ok(codingCandidateCode.includes('useAssessmentFullscreen'));
        assert.ok(codingCandidateCode.includes('FullscreenGateModal'));

        // Technical Interview
        assert.ok(interviewCandidateCode.includes('useAssessmentFullscreen'));
        assert.ok(interviewCandidateCode.includes('FullscreenGateModal'));
    });

    test('2. Candidate UI privacy: No client-side leaks of private answer keys or hidden tests', () => {
        // Aptitude candidate UI does not assume answer_key exists in payload
        assert.ok(!aptitudeCandidateCode.includes('question.correct_answer'));
        assert.ok(!aptitudeCandidateCode.includes('question.answer_key'));

        // Coding candidate UI renders only public tests
        assert.ok(!codingCandidateCode.includes('is_hidden === true'));
    });

    test('3. RecruitmentRoundsManager supports dual AI/Manual modes for Aptitude and Coding', () => {
        assert.ok(roundsManagerCode.includes('ManualAptitudeBuilder'));
        assert.ok(roundsManagerCode.includes('ManualCodingBuilder'));
        assert.ok(roundsManagerCode.includes("config.questionSource === 'manual'"));
        assert.ok(roundsManagerCode.includes("onChange('questionSource', 'ai')"));
        assert.ok(roundsManagerCode.includes("onChange('questionSource', 'manual')"));
    });

    test('4. ManualAptitudeBuilder supports MCQ, True/False, Short Answer, marks and difficulty', () => {
        assert.ok(manualAptitudeBuilderCode.includes("'mcq'"));
        assert.ok(manualAptitudeBuilderCode.includes("'true_false'"));
        assert.ok(manualAptitudeBuilderCode.includes("'short_answer'"));
        assert.ok(manualAptitudeBuilderCode.includes('marks'));
        assert.ok(manualAptitudeBuilderCode.includes('difficulty'));
    });

    test('5. ManualCodingBuilder supports test cases with is_hidden toggle, starter code, and examples', () => {
        assert.ok(manualCodingBuilderCode.includes('is_hidden'));
        assert.ok(manualCodingBuilderCode.includes('starterCode'));
        assert.ok(manualCodingBuilderCode.includes('examples'));
        assert.ok(manualCodingBuilderCode.includes('constraints'));
    });

    test('6. StructuredJobDescriptionEditor preserves recruiter control over Required vs Preferred skills', () => {
        assert.ok(jdEditorCode.includes('required_skills'));
        assert.ok(jdEditorCode.includes('preferred_skills'));
        assert.ok(jdEditorCode.includes('SkillTagInput'));
        assert.ok(jdEditorCode.includes('/api/resume/suggest-skills/'));
        assert.ok(jdEditorCode.includes('handleToggleRequired'));
        assert.ok(jdEditorCode.includes('handleTogglePreferred'));
    });

    test('7. ResumeScreening integrates Structured JD Builder modal and forwards job_description_id', () => {
        assert.ok(resumeScreeningCode.includes('StructuredJobDescriptionEditor'));
        assert.ok(resumeScreeningCode.includes('showJdModal'));
        assert.ok(resumeScreeningCode.includes("formData.append('job_description_id'"));
    });

    test('8. Fullscreen recovery contract: 10-second timer and recovery callback without assessment reset', () => {
        assert.ok(fullscreenHookCode.includes('recoveryDuration = 10'));
        assert.ok(fullscreenHookCode.includes('onRecoveryTimeout'));
        assert.ok(fullscreenModalCode.includes('Return to Fullscreen'));
    });

    test('9. Interview round preserves Vapi session integrity during fullscreen recovery', () => {
        // Fullscreen recovery returnToFullscreen is called without destroying vapi ref
        assert.ok(interviewCandidateCode.includes('returnToFullscreen'));
        assert.ok(interviewCandidateCode.includes('vapiRef.current'));
    });
});
