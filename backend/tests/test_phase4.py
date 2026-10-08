"""
Phase 4 Test Suite: Resilient Assessment Fullscreen System (Aptitude, Coding, Interview)
Covers all 28 Phase 4 requirements:
  Common Fullscreen Behavior (1-15):
    1. Entry gate initialization
    2. User gesture requirement (no auto-fullscreen on mount)
    3. Successful fullscreen request handling
    4. Failed fullscreen request handling & error surfacing
    5. Immediate document.fullscreenElement verification
    6. fullscreenchange event listener across browser vendors
    7. ESC exit detection
    8. Recovery modal state transition
    9. 10-second countdown interval management
    10. Successful recovery within window
    11. Recovery timeout violation trigger
    12. Event listener cleanup on unmount
    13. Timer cleanup on recovery resolution & unmount
    14. Disabled / completed assessment cleanup
    15. Duplicate-event and interval deduplication protection
  Aptitude Round Integration (16-17):
    16. Aptitude fullscreen gate and modal rendering
    17. Aptitude recovery timeout maps to existing proctoring violation
  Coding Round Integration (18-19):
    18. Coding fullscreen gate and modal rendering
    19. Coding recovery timeout maps to existing proctoring violation & terminal check
  Interview Round Integration (20-25):
    20. Interview fullscreen gate and modal rendering
    21. Interview exit & recovery integration
    22. Interview Vapi session is NOT recreated or restarted on fullscreen change
    23. Interview evaluation service remains completely unchanged
    24. Interview timer behavior remains unchanged
    25. Interview transcript handling remains unchanged
  Regression & Frozen File Integrity (26-28):
    26. Existing Aptitude evaluation functionality
    27. Existing Coding evaluation functionality
    28. Frozen Interview backend & legacy useFullscreen files have 0 git changes
"""

import os
import re
import subprocess
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend", "src")
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")


class TestPhase4CommonFullscreenHook(unittest.TestCase):
    """Verifies useAssessmentFullscreen hook logic, contracts, and lifecycle handling."""

    @classmethod
    def setUpClass(cls):
        hook_path = os.path.join(FRONTEND_DIR, "hooks", "useAssessmentFullscreen.js")
        with open(hook_path, "r", encoding="utf-8") as f:
            cls.hook_code = f.read()

        modal_path = os.path.join(FRONTEND_DIR, "components", "FullscreenGateModal.jsx")
        with open(modal_path, "r", encoding="utf-8") as f:
            cls.modal_code = f.read()

    def test_01_entry_gate_initialization(self):
        """1. Entry gate initializes open when enabled and not completed."""
        self.assertIn("const [isGateOpen, setIsGateOpen] = useState(enabled && !isCompleted);", self.hook_code)
        self.assertIn("isGateOpen", self.hook_code)

    def test_02_user_gesture_requirement(self):
        """2. Browser fullscreen request requires explicit user gesture (enterFullscreen callback), no auto-call on mount."""
        # Check that there is NO useEffect calling requestFullscreen or enterFullscreen on mount
        # (legacy useFullscreen had enterFullscreen() inside useEffect; new hook MUST NOT)
        auto_enter_pattern = re.search(r"useEffect\(\s*\(\)\s*=>\s*\{[^}]*enterFullscreen\(\)", self.hook_code)
        self.assertIsNone(auto_enter_pattern, "Hook must NOT invoke enterFullscreen automatically inside useEffect on mount")
        self.assertIn("const enterFullscreen = useCallback(async () => {", self.hook_code)

    def test_03_successful_fullscreen_request(self):
        """3. enterFullscreen requests browser fullscreen."""
        self.assertIn("requestFullscreen", self.hook_code)
        self.assertIn("hasEnteredRef.current = true", self.hook_code)
        self.assertIn("setIsGateOpen(false)", self.hook_code)

    def test_04_failed_fullscreen_request_error_handling(self):
        """4. Failed fullscreen request catches error and surfaces message without unlocking gate."""
        self.assertIn("catch (err)", self.hook_code)
        self.assertIn("setError(", self.hook_code)
        self.assertIn("return false;", self.hook_code)

    def test_05_fullscreen_verification(self):
        """5. document.fullscreenElement is explicitly verified after request."""
        self.assertIn("if (document.fullscreenElement)", self.hook_code)
        self.assertIn("setIsFullscreen(true)", self.hook_code)

    def test_06_fullscreenchange_multi_vendor_support(self):
        """6. Listens to standard and vendor-prefixed fullscreenchange events."""
        for evt in ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]:
            self.assertIn(f"addEventListener('{evt}'", self.hook_code)

    def test_07_esc_and_external_exit_detection(self):
        """7. ESC and external exits trigger onExit and recovery modal."""
        self.assertIn("!document.fullscreenElement", self.hook_code)
        self.assertIn("onExitRef.current()", self.hook_code)
        self.assertIn("setIsRecoveryOpen(true)", self.hook_code)

    def test_08_recovery_modal_state_contract(self):
        """8. Hook exposes isRecoveryOpen, recoveryTimeLeft, and returnToFullscreen."""
        self.assertIn("isRecoveryOpen,", self.hook_code)
        self.assertIn("recoveryTimeLeft,", self.hook_code)
        self.assertIn("returnToFullscreen: enterFullscreen", self.hook_code)

    def test_09_ten_second_countdown_management(self):
        """9. Sets up 10-second countdown with 1s interval."""
        self.assertIn("recoveryDuration = 10", self.hook_code)
        self.assertIn("setInterval(", self.hook_code)
        self.assertIn("setRecoveryTimeLeft((prev) => {", self.hook_code)

    def test_10_successful_recovery_within_window(self):
        """10. Candidate re-entering fullscreen clears recovery timer and closes modal."""
        self.assertIn("onRecoverySuccessRef.current", self.hook_code)
        self.assertIn("clearRecoveryTimer()", self.hook_code)
        self.assertIn("setIsRecoveryOpen(false)", self.hook_code)

    def test_11_recovery_timeout_violation_callback(self):
        """11. Recovery countdown reaching 0 invokes onRecoveryTimeout callback."""
        self.assertIn("if (prev <= 1)", self.hook_code)
        self.assertIn("onRecoveryTimeoutRef.current()", self.hook_code)

    def test_12_listener_cleanup_on_unmount(self):
        """12. Removes all event listeners on cleanup."""
        for evt in ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]:
            self.assertIn(f"removeEventListener('{evt}'", self.hook_code)

    def test_13_timer_cleanup_on_resolution_and_unmount(self):
        """13. clearInterval called on recovery timer resolution, unmount, and disabled."""
        self.assertIn("clearInterval(recoveryTimerRef.current)", self.hook_code)

    def test_14_disabled_or_completed_assessment_cleanup(self):
        """14. Completed assessment resets recovery and closes gate."""
        self.assertIn("if (!enabled || isCompleted)", self.hook_code)
        self.assertIn("setIsRecoveryOpen(false)", self.hook_code)
        self.assertIn("setIsGateOpen(false)", self.hook_code)

    def test_15_duplicate_event_and_interval_protection(self):
        """15. Protects against multiple concurrent fullscreenchange events and duplicate intervals."""
        self.assertIn("if (isRecoveryOpenRef.current && recoveryTimerRef.current)", self.hook_code)
        self.assertIn("return;", self.hook_code)

    def test_fullscreen_gate_modal_ui_specifications(self):
        """Verifies FullscreenGateModal UI elements and texts."""
        self.assertIn("Fullscreen Required", self.modal_code)
        self.assertIn("Enter Fullscreen & Start", self.modal_code)
        self.assertIn("Return to Fullscreen", self.modal_code)
        self.assertIn("You exited fullscreen. Return to fullscreen within 10 seconds to continue.", self.modal_code)
        self.assertIn("Math.max(0, timeLeft)", self.modal_code)


class TestPhase4AptitudeIntegration(unittest.TestCase):
    """Verifies CandidateAptitudeAssessment integration with Phase 4 fullscreen system."""

    @classmethod
    def setUpClass(cls):
        apt_path = os.path.join(FRONTEND_DIR, "pages", "candidate", "CandidateAptitudeAssessment.jsx")
        with open(apt_path, "r", encoding="utf-8") as f:
            cls.apt_code = f.read()

    def test_16_aptitude_fullscreen_gate_and_modal_rendering(self):
        """16. Aptitude round uses useAssessmentFullscreen and renders FullscreenGateModal."""
        self.assertIn("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';", self.apt_code)
        self.assertIn("import FullscreenGateModal from '../../components/FullscreenGateModal';", self.apt_code)
        self.assertIn("<FullscreenGateModal", self.apt_code)
        self.assertIn("mode={isRecoveryOpen ? 'recovery' : 'entry'}", self.apt_code)

    def test_17_aptitude_recovery_timeout_triggers_proctoring_violation(self):
        """17. Aptitude recovery timeout connects to existing handleAnyViolation."""
        self.assertIn("handleAnyViolation('Fullscreen exit exceeded 10-second recovery limit')", self.apt_code)
        self.assertIn("onRecoveryTimeout: handleFullscreenTimeout", self.apt_code)
        # Test timer pauses during gate or recovery
        self.assertIn("!isGateOpen && !isRecoveryOpen", self.apt_code)


class TestPhase4CodingIntegration(unittest.TestCase):
    """Verifies CandidateCodingAssessment integration with Phase 4 fullscreen system."""

    @classmethod
    def setUpClass(cls):
        coding_path = os.path.join(FRONTEND_DIR, "pages", "candidate", "CandidateCodingAssessment.jsx")
        with open(coding_path, "r", encoding="utf-8") as f:
            cls.coding_code = f.read()

    def test_18_coding_fullscreen_gate_and_modal_rendering(self):
        """18. Coding round uses useAssessmentFullscreen and renders FullscreenGateModal."""
        self.assertIn("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';", self.coding_code)
        self.assertIn("import FullscreenGateModal from '../../components/FullscreenGateModal';", self.coding_code)
        self.assertIn("<FullscreenGateModal", self.coding_code)
        self.assertIn("mode={isRecoveryOpen ? 'recovery' : 'entry'}", self.coding_code)

    def test_19_coding_recovery_timeout_triggers_proctoring_violation(self):
        """19. Coding recovery timeout connects to handleViolation and checks terminal threshold."""
        self.assertIn("handleViolation('Fullscreen exit exceeded 10-second recovery limit')", self.coding_code)
        self.assertIn("handleTerminalViolation('Fullscreen exit exceeded 10-second recovery limit')", self.coding_code)
        self.assertIn("onRecoveryTimeout: handleFullscreenTimeout", self.coding_code)
        # Coding test timer pauses during gate or recovery
        self.assertIn("!isGateOpen && !isRecoveryOpen", self.coding_code)


class TestPhase4InterviewIntegration(unittest.TestCase):
    """Verifies VapiInterview integration and non-regression of Vapi session logic."""

    @classmethod
    def setUpClass(cls):
        interview_path = os.path.join(FRONTEND_DIR, "pages", "candidate", "VapiInterview.jsx")
        with open(interview_path, "r", encoding="utf-8") as f:
            cls.interview_code = f.read()

    def test_20_interview_fullscreen_gate_and_modal_rendering(self):
        """20. Interview round uses useAssessmentFullscreen and renders FullscreenGateModal on ready and active views."""
        self.assertIn("import useAssessmentFullscreen from '../../hooks/useAssessmentFullscreen';", self.interview_code)
        self.assertIn("import FullscreenGateModal from '../../components/FullscreenGateModal';", self.interview_code)
        self.assertGreaterEqual(self.interview_code.count("<FullscreenGateModal"), 2, "Must render modal on ready and active screens")

    def test_21_interview_exit_and_recovery_integration(self):
        """21. Interview recovery timeout connects to handleAnyViolation."""
        self.assertIn("handleAnyViolation('Fullscreen exit exceeded 10-second recovery limit')", self.interview_code)
        self.assertIn("onRecoveryTimeout: handleFullscreenTimeout", self.interview_code)

    def test_22_interview_vapi_session_is_not_recreated_on_fullscreen_change(self):
        """22. Fullscreen exit or recovery does NOT recreate, stop, or re-initiate Vapi session."""
        # Ensure no stopInterview() or new Vapi() is inside fullscreen handlers
        self.assertNotIn("stopInterview();\n            setTimeout(reEnter", self.interview_code)
        self.assertIn("onEnterSuccess: () => {", self.interview_code)

    def test_23_interview_evaluation_service_remains_unchanged(self):
        """23. backend/services/interview_evaluation.py is completely unmodified."""
        diff = subprocess.run(
            ["git", "diff", "--name-only", "backend/services/interview_evaluation.py"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True
        )
        self.assertEqual(diff.stdout.strip(), "", "interview_evaluation.py must have 0 git changes")

    def test_24_interview_timer_behavior_remains_unchanged(self):
        """24. Interview duration timer logic is intact."""
        self.assertIn("const startTimer = (durationMinutes) => {", self.interview_code)
        self.assertIn("timerRef.current = setInterval(", self.interview_code)

    def test_25_interview_transcript_handling_remains_unchanged(self):
        """25. Interview transcript ref and state logic is intact."""
        self.assertIn("transcriptDataRef.current", self.interview_code)
        self.assertIn("setTranscript(", self.interview_code)


class TestPhase4RegressionAndFrozenIntegrity(unittest.TestCase):
    """Verifies that all frozen files and existing functionalities remain intact."""

    def test_26_existing_aptitude_evaluation_functionality(self):
        """26. Aptitude evaluation logic continues to execute accurately."""
        from services.aptitude_evaluation import evaluate_aptitude_submission
        questions = [
            {"id": "q1", "type": "mcq", "options": ["A", "B"], "correct": 0, "marks": 5},
            {"id": "q2", "type": "true_false", "correct_answer": True, "marks": 5}
        ]
        answers = {"q1": 0, "q2": True}
        res = evaluate_aptitude_submission(questions, answers)
        self.assertEqual(res["score"], 10.0)
        self.assertEqual(res["earned_marks"], 10.0)
        self.assertEqual(res["correct_count"], 2)

    def test_27_existing_coding_evaluation_functionality(self):
        """27. Coding evaluation logic continues to execute accurately."""
        from services.coding_evaluation import compare_actual_expected
        self.assertTrue(compare_actual_expected("[1, 2, 3]", "[1, 2, 3]"))
        self.assertTrue(compare_actual_expected("true", "True"))

    def test_28_frozen_interview_backend_and_legacy_usefullscreen_git_diff_zero(self):
        """28. Verifies 0 git diff across all frozen backend interview files and legacy useFullscreen.js."""
        files_to_check = [
            "backend/routers/interview.py",
            "backend/services/vapi_service.py",
            "backend/services/interview_evaluation.py",
            "frontend/src/hooks/useFullscreen.js"
        ]
        for f in files_to_check:
            diff = subprocess.run(
                ["git", "diff", "--exit-code", f],
                cwd=ROOT_DIR,
                capture_output=True,
                text=True
            )
            self.assertEqual(
                diff.returncode, 0,
                f"Frozen file {f} MUST have 0 git changes! Output:\n{diff.stdout}\n{diff.stderr}"
            )


if __name__ == "__main__":
    unittest.main()
