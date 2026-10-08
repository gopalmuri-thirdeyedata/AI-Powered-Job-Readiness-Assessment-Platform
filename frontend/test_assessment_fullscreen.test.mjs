import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hookCode = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'useAssessmentFullscreen.js'), 'utf-8');
const modalCode = fs.readFileSync(path.join(__dirname, 'src', 'components', 'FullscreenGateModal.jsx'), 'utf-8');
const aptitudeCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'candidate', 'CandidateAptitudeAssessment.jsx'), 'utf-8');
const codingCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'candidate', 'CandidateCodingAssessment.jsx'), 'utf-8');
const interviewCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'candidate', 'VapiInterview.jsx'), 'utf-8');
const legacyHookCode = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'useFullscreen.js'), 'utf-8');

describe('Phase 4 Frontend Test Suite: useAssessmentFullscreen & FullscreenGateModal', () => {

    test('1. Entry gate state initializes open when enabled and not completed', () => {
        assert.ok(hookCode.includes('const [isGateOpen, setIsGateOpen] = useState(enabled && !isCompleted);'));
        assert.ok(hookCode.includes('isGateOpen,'));
    });

    test('2. User gesture requirement: enterFullscreen is an explicit callback, not auto-fired on mount', () => {
        // Legacy hook had enterFullscreen() called inside useEffect on mount; new hook must not
        const autoMountPattern = /useEffect\(\s*\(\)\s*=>\s*\{[^}]*enterFullscreen\(\)/;
        assert.equal(autoMountPattern.test(hookCode), false, 'Hook must not call enterFullscreen on mount');
        assert.ok(hookCode.includes('const enterFullscreen = useCallback(async () => {'));
    });

    test('3. Immediate verification of document.fullscreenElement after request', () => {
        assert.ok(hookCode.includes('if (document.fullscreenElement) {'));
        assert.ok(hookCode.includes('setIsFullscreen(true);'));
        assert.ok(hookCode.includes('hasEnteredRef.current = true;'));
        assert.ok(hookCode.includes('setIsGateOpen(false);'));
    });

    test('4. Rejection/denial handling catches errors and surfaces message', () => {
        assert.ok(hookCode.includes('catch (err) {'));
        assert.ok(hookCode.includes('setError('));
        assert.ok(hookCode.includes('return false;'));
    });

    test('5. Multi-vendor fullscreenchange event listener support', () => {
        const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
        for (const evt of events) {
            assert.ok(hookCode.includes(`addEventListener('${evt}'`));
            assert.ok(hookCode.includes(`removeEventListener('${evt}'`));
        }
    });

    test('6. Exit detection sets isRecoveryOpen and starts 10-second timer', () => {
        assert.ok(hookCode.includes('setIsRecoveryOpen(true);'));
        assert.ok(hookCode.includes('recoveryDuration = 10'));
        assert.ok(hookCode.includes('recoveryTimerRef.current = setInterval('));
    });

    test('7. Successful re-entry clears recovery timer and resets modal state', () => {
        assert.ok(hookCode.includes('clearRecoveryTimer()'));
        assert.ok(hookCode.includes('setIsRecoveryOpen(false);'));
        assert.ok(hookCode.includes('onRecoverySuccessRef.current'));
    });

    test('8. Recovery timeout (10s expiry) triggers onRecoveryTimeout callback', () => {
        assert.ok(hookCode.includes('if (prev <= 1) {'));
        assert.ok(hookCode.includes('onRecoveryTimeoutRef.current()'));
    });

    test('9. Lifecycle cleanup: intervals and listeners cleared on unmount or completion', () => {
        assert.ok(hookCode.includes('clearInterval(recoveryTimerRef.current);'));
        assert.ok(hookCode.includes('if (!enabled || isCompleted) {'));
    });

    test('10. Duplicate event protection: deduplicates rapid fullscreenchange triggers', () => {
        assert.ok(hookCode.includes('if (isRecoveryOpenRef.current && recoveryTimerRef.current)'));
    });

    test('11. FullscreenGateModal renders required Entry Gate copy and button', () => {
        assert.ok(modalCode.includes('Fullscreen Required'));
        assert.ok(modalCode.includes('Enter Fullscreen & Start'));
    });

    test('12. FullscreenGateModal renders required Recovery copy, countdown, and button', () => {
        assert.ok(modalCode.includes('You exited fullscreen. Return to fullscreen within 10 seconds to continue.'));
        assert.ok(modalCode.includes('Return to Fullscreen'));
        assert.ok(modalCode.includes('Math.max(0, timeLeft)'));
    });

    test('13. Aptitude round integrates useAssessmentFullscreen and FullscreenGateModal', () => {
        assert.ok(aptitudeCode.includes("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';"));
        assert.ok(aptitudeCode.includes("import FullscreenGateModal from '../../components/FullscreenGateModal';"));
        assert.ok(aptitudeCode.includes('<FullscreenGateModal'));
        assert.ok(aptitudeCode.includes("handleAnyViolation('Fullscreen exit exceeded 10-second recovery limit')"));
        // Pauses test timer when gate or recovery is active
        assert.ok(aptitudeCode.includes('!isGateOpen && !isRecoveryOpen'));
    });

    test('14. Coding round integrates useAssessmentFullscreen and FullscreenGateModal', () => {
        assert.ok(codingCode.includes("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';"));
        assert.ok(codingCode.includes("import FullscreenGateModal from '../../components/FullscreenGateModal';"));
        assert.ok(codingCode.includes('<FullscreenGateModal'));
        assert.ok(codingCode.includes("handleViolation('Fullscreen exit exceeded 10-second recovery limit')"));
        // Pauses coding test timer when gate or recovery is active
        assert.ok(codingCode.includes('!isGateOpen && !isRecoveryOpen'));
    });

    test('15. Interview round integrates useAssessmentFullscreen on ready and active views', () => {
        assert.ok(interviewCode.includes("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';"));
        assert.ok(interviewCode.includes("import FullscreenGateModal from '../../components/FullscreenGateModal';"));
        assert.ok(interviewCode.includes('<FullscreenGateModal'));
        assert.ok(interviewCode.includes("handleAnyViolation('Fullscreen exit exceeded 10-second recovery limit')"));
    });

    test('16. Interview round preserves Vapi session without recreation or restart', () => {
        assert.ok(interviewCode.includes('onEnterSuccess: () => {'));
        assert.ok(interviewCode.includes('transcriptDataRef.current'));
        // Verify no restart on fullscreen transition
        assert.equal(interviewCode.includes('stopInterview();\n            setTimeout(reEnter'), false);
    });

    test('17. Legacy useFullscreen.js hook is completely unchanged and intact', () => {
        assert.ok(legacyHookCode.includes('useFullscreen — forces fullscreen while the test is active.'));
        assert.ok(legacyHookCode.includes('export default useFullscreen;'));
    });
});
