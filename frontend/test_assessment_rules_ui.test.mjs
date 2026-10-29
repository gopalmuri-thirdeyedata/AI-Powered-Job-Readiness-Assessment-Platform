import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const workspace = read('src/pages/roleready/RoleReadyAssessment.jsx');
const recruitmentPage = read('src/pages/candidate/RecruitmentAssessmentPage.jsx');
const instructions = read('src/pages/candidate/ExamInstructions.jsx');
const slice = (src, from, length) => src.slice(src.indexOf(from), src.indexOf(from) + length);

// The recruitment candidate must never be shown student-only wording. The student rules card is rendered only in the
// 'instructions' stage; recruitment skips that stage (skipInstructions) and its Back button must not lead into it.
describe('Rules shown to Recruitment candidates inside the shared workspace', () => {
    test('the student 3-strike rules card is unreachable in recruitment mode', () => {
        assert.ok(recruitmentPage.includes('skipInstructions') && recruitmentPage.includes('proctoringPolicy="flag"'));
        const back = slice(workspace, '(!isRecruitment || onBackToInstructions)', 700);
        assert.ok(back.includes("isRecruitment ? onBackToInstructions() : setCurrentStage('instructions')"), 'recruitment leaves via the Exam Instructions page');
        assert.ok(recruitmentPage.includes('/assessment/join/${shareToken}/instructions') && recruitmentPage.includes('onBackToInstructions='));
        assert.ok(workspace.indexOf("currentStage === 'instructions' && (") < workspace.indexOf('Rules & 3-Warning Integrity Policy'),
            'the 3-warning card lives only inside the instructions stage');
    });

    test('device-check text states the recruitment policy: recorded events, a second tab switch disqualifies, more than 5 events end the attempt', () => {
        const block = slice(workspace, 'Fullscreen Proctoring Environment', 1800);
        const recruitmentText = block.slice(block.indexOf('isRecruitment'), block.indexOf('10-second countdown recovery window') + 60);
        assert.match(recruitmentText, /recorded as integrity events for the hiring team\. Switching to another tab more than once disqualifies you/);
        assert.ok(recruitmentText.includes('${MAX_INTEGRITY_EVENTS} integrity events end your assessment'));
        assert.doesNotMatch(recruitmentText, /strike/i);
        assert.match(recruitmentText, /10-second countdown recovery window/);
    });

    test('aptitude, coding and interview screens make no student-only promises to recruitment candidates', () => {
        assert.ok(workspace.includes("'Unanswered questions score zero. Submitting is final and starts the Coding section immediately.'"),
            'aptitude no longer claims all questions must be answered');
        assert.ok(workspace.includes('The interview timer has already started'), 'coding confirmation says the next clock is running');
        const pending = slice(workspace, 'coding-eval-pending', 900);
        assert.ok(pending.includes('isRecruitment') && pending.includes('will be checked later') && pending.includes('final report'),
            'the "final report" promise stays student-only');
        const modal = slice(workspace, 'Finish AI Technical Interview?', 2400).replace(/\s+/g, ' ');
        assert.ok(modal.includes('isRecruitment') && modal.includes('Submitting your interview...'));
        assert.ok(modal.includes('This is final and cannot be reopened.'));
        assert.ok(/isRecruitment\s*\?[^:]*:\s*'Synthesizing speech analysis/.test(modal), 'the dossier wording survives only on the student branch');
    });

    test('the interview offers Retry and a written alternative only after a voice failure, and recruitment gets no assistant override', () => {
        assert.ok(workspace.includes('Retry Connection') && workspace.includes('Answer in writing instead'));
        assert.ok(workspace.includes("writtenFallback && voiceCallStatus === 'error'"), 'written answers are reachable only after a voice failure');
        assert.ok(workspace.includes('{!isRecruitment && (') && workspace.includes('Assistant ID Override'));
        assert.ok(/currentStage === 'interview'\) handleSubmitInterview\(\)/.test(workspace), 'time running out submits the interview');
    });

    test('Start requires an accepted checkbox and a working camera, but not a microphone or the proctoring model', () => {
        const at = workspace.lastIndexOf('Start Assessment & Enter Fullscreen<');
        const startBtn = workspace.slice(at - 3500, at);
        assert.ok(startBtn.includes("disabled={!instructionsAccepted || isStartingAssessment || cameraStatus !== 'allowed'}"));
        const gate = startBtn.slice(startBtn.indexOf('disabled='), startBtn.indexOf('disabled=') + 140);
        assert.ok(!gate.includes('micStatus') && !gate.includes('modelStatus'));
        assert.ok(workspace.includes("if (!instructionsAccepted || cameraStatus !== 'allowed') return;"));
    });

    test('autosave, heartbeat and the unload guard back the "a reload resumes the same attempt" wording', () => {
        assert.match(workspace, /DRAFT_DEBOUNCE_MS = 4000/);
        assert.ok(recruitmentPage.includes('HEARTBEAT_MS = 15000') && recruitmentPage.includes("addEventListener('beforeunload'"));
        assert.ok(recruitmentPage.includes('Reloading is allowed, but the timer keeps running and the reload is recorded.'));
        assert.ok(!recruitmentPage.includes('cannot be resumed after a reload'));
        const closed = slice(recruitmentPage, "if (phase === 'closed')", 800);
        assert.ok(closed.includes('Thank you. Your responses have been received and will be reviewed by the hiring team.'));
        assert.ok(!/score|report/i.test(closed.replace('reviewed by the hiring team', '')), 'no score or report is shown on completion');
    });

    test('the acknowledgement on the instructions page never starts an attempt', () => {
        assert.ok(instructions.includes('saveAcknowledgement(shareToken)') && !instructions.includes('candidateApi.start('));
        assert.ok(instructions.includes('Your timer has <b>not</b> started'));
    });
});
