"""
Candidate-facing "Rules of Assessment" for the Admin Recruitment shared-link workflow.

This is the single source of the wording the Exam Instructions page shows (served in the public metadata as `rules`).
Every number is read from the module that enforces it, so the text cannot drift from the behaviour:
  * section / overall minutes ............ services.assessment_policy
  * question and problem counts .......... services.jd_blueprint_service (what publishing validates)
  * languages and the code size cap ...... services.assessment_engine
  * the "no heartbeat" interruption window services.assessment_sweeper_service
Statements about the browser (fullscreen recovery window, camera-check cadence) mirror constants in the shared workspace;
tests/test_assessment_rules.py pins them to the frontend source so a change there fails a test here.

Only enforced or supported behaviour is described. Deliberately NOT promised: that autosaved work lets a candidate resume,
that transcription / AI evaluation / scoring will succeed, that candidates see scores or a report, or that a browser event
proves misconduct. Recruitment never ends an attempt because of an integrity event.
"""
from typing import Any, Dict, List

from services import assessment_engine as engine
from services import assessment_policy as policy
from services import assessment_sweeper_service as sweeper
from services import jd_blueprint_service as blueprint

# Mirrors of workspace constants (frontend): useAssessmentFullscreen recoveryDuration, useFaceProctoring NO_PERSON_THRESHOLD * CHECK_INTERVAL_MS.
FULLSCREEN_RECOVERY_SECONDS = 10
NO_PERSON_SECONDS = 6


def _item(text: str, important: bool = False) -> Dict[str, Any]:
    return {"text": text, "important": important}


def _language_names() -> str:
    names = sorted({"Python" if code in ("python", "python3") else code.capitalize() for code in engine.SUPPORTED_LANGUAGES})
    return " or ".join(names)


def candidate_rules() -> List[Dict[str, Any]]:
    section = policy.SECTION_MINUTES
    interview = policy.section_minutes("INTERVIEW")
    overall = policy.OVERALL_MINUTES
    code_kb = engine.MAX_CODE_BYTES // 1024
    drop_seconds = sweeper.HEARTBEAT_ABANDON_SECONDS
    drop = "a minute" if drop_seconds == 60 else f"{drop_seconds} seconds"

    return [
        {"key": "structure", "title": "Assessment Structure", "items": [
            _item(f"The assessment has three sections, always in this order: Aptitude ({blueprint.APTITUDE_COUNT} multiple-choice questions), "
                  f"Coding ({blueprint.CODING_COUNT} programming problems) and a voice-based AI Technical Interview "
                  f"({blueprint.INTERVIEW_COUNT} questions)."),
            _item("You cannot skip a section or go back to one. You move on only by submitting the current section, or when its time ends. "
                  "A submitted section is final: it cannot be reopened or changed.", True),
            _item("You have one attempt. It cannot be paused or restarted.", True),
        ]},
        {"key": "timing", "title": "Timing", "items": [
            _item("Nothing is timed until you select Start Assessment on the device check page. Reading these instructions, "
                  "ticking the confirmation box and checking your devices do not start any timer.", True),
            _item(f"Aptitude and Coding each have a {section}-minute timer and the Technical Interview has {interview} minutes. The whole assessment has a hard limit of {overall} minutes, "
                  "counted from the moment you select Start Assessment. It never pauses and never resets.", True),
            _item("The next section's timer starts as soon as you submit the previous one, even if a confirmation screen is still showing. "
                  "Time between sections is not paused, so continue straight away.", True),
            _item("The server clock is the only clock that counts; the timers on screen are for display. Refreshing the page or changing "
                  "your device's clock does not reset or pause anything."),
            _item("When a section's time ends, the work you have entered is submitted automatically and the next section begins. "
                  f"When the {overall} minutes end, the section in progress is submitted, sections you have not reached are not scored, "
                  "and the assessment ends.", True),
        ]},
        {"key": "answering", "title": "Answering and Submitting", "items": [
            _item("Your work is saved automatically every few seconds. This saved copy is used only to score a section that ends before you "
                  "submit it (time runs out or the attempt ends early), and to restore your work if the page reloads."),
            _item("You can change your answers as often as you like until you submit the section."),
            _item("If the page reloads or the tab closes by accident, open the assessment link again in the same browser: your attempt resumes where "
                  "you left off, with your saved work, and the timers keep running (they are never paused). Each resume is recorded and the number of "
                  "resumes is limited. Do not open the assessment in a second tab or window.", True),
            _item("Switching to another tab, leaving fullscreen, or the camera not seeing your face, or seeing a phone or "
                  "another person, is recorded as an integrity event. If you switch to another tab more than once "
                  "you are disqualified, and if more than 5 integrity events of any kind are recorded, the assessment ends and the "
                  "work you have done so far is submitted.", True),
            _item(f"Keep a stable internet connection. A short drop while the page stays open is tolerated, but if the server hears nothing "
                  f"from your page for about {drop} (for example you lost your connection and did not come back), your attempt is ended and cannot be "
                  "resumed. Work saved before that point is kept and the attempt is recorded as incomplete.", True),
        ]},
        {"key": "aptitude", "title": "Aptitude", "items": [
            _item("Questions appear one at a time with answer options A to D. Select one option, and move between questions with "
                  "Previous / Next or the question palette."),
            _item("You may leave questions unanswered; they score zero. Wrong answers do not lose marks. "
                  "The submit button is on the last question."),
        ]},
        {"key": "coding", "title": "Coding", "items": [
            _item(f"Write each solution in {_language_names()} using the language buttons above the editor. Start from the code provided, "
                  "and read each problem's Input Format and Output Format: your program reads standard input and prints its result. "
                  + ("In Java keep the class name Main. " if "java" in engine.SUPPORTED_LANGUAGES else "")
                  + f"Code is limited to {code_kb} KB."),
            _item("Run Public Tests runs your code on the sample tests shown with the problem and shows its output, and any compile, runtime or "
                  "time-limit error. Runs are limited and do not affect your score; if the code runner is unavailable, your work is not affected."),
            _item("There is one submission for all problems. It runs your code against additional hidden tests that are never shown, and "
                  "passing more of them gives a higher coding score. A problem with no code scores zero. "
                  "You can edit and run as often as you like until you submit or the time ends."),
            _item("If the code runner cannot be reached when you submit, your code is kept and checked later, and you can continue."),
        ]},
        {"key": "interview", "title": "Technical Interview", "items": [
            _item(f"The interview is a spoken conversation with an AI interviewer about {blueprint.INTERVIEW_COUNT} questions. "
                  f"It connects as soon as the section begins, and the {interview}-minute timer is already running. "
                  "Allow microphone access when your browser asks, and speak your answers. You can mute yourself or change microphone."),
            _item("If the microphone is blocked or the voice connection fails, you can choose Retry Connection or Answer in writing instead "
                  "(type an answer to each question). The written option appears only after a voice connection has failed."),
            _item("To finish, select End Interview and confirm. If you do not, your interview is submitted automatically when the time ends. "
                  "Your spoken answers and the conversation transcript are saved automatically while you talk.", True),
            _item("After you submit, your responses are passed on for evaluation. If automatic evaluation is unavailable, "
                  "your responses are kept and evaluated later."),
        ]},
        {"key": "proctoring", "title": "Proctoring and Integrity", "items": [
            _item("A working camera is required: the Start Assessment button stays disabled until your camera works. "
                  "The voice interview needs a microphone (see above)."),
            _item(f"The assessment runs in fullscreen. If you leave fullscreen you have {FULLSCREEN_RECOVERY_SECONDS} seconds to return; "
                  "after that an integrity event is recorded. Switching tabs or windows, or the page losing focus, records one straight away."),
            _item(f"Your camera view is checked automatically while you work. An integrity event is recorded if nobody is visible for about "
                  f"{NO_PERSON_SECONDS} seconds, if more than one person is in view, or if a phone, another device or notes are detected."),
            _item("Integrity events are recorded and shared with the hiring team. They never stop or end your assessment automatically, "
                  "and they are signals for review, not proof of misconduct. The hiring team makes any decision.", True),
            _item("If the automatic camera check is temporarily unavailable, your assessment continues. Fullscreen and tab events are still recorded."),
        ]},
        {"key": "completion", "title": "Completion and Results", "items": [
            _item("The assessment is complete when all three sections have been submitted. You will see a confirmation screen at the end."),
            _item("If time runs out or the attempt is interrupted first, the assessment is closed as incomplete: work saved in the active "
                  "section is still reviewed, later sections are not scored, and no overall score is produced."),
            _item("Scores and reports are visible only to the hiring team. They are not shown to you at the end of the assessment."),
            _item("If a verified problem on our platform interrupts your attempt, contact the hiring team so they can review it. "
                  "Interruptions caused by your own device, browser or connection are not treated as platform problems."),
        ]},
    ]


def flat_rule_texts() -> List[str]:
    """Every rule sentence in display order (used by tests and any plain-text consumer)."""
    return [item["text"] for group in candidate_rules() for item in group["items"]]
