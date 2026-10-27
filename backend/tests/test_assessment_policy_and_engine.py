"""
Unit tests (no database, no network) for the canonical timing / scoring policy and the shared assessment engine that the
Student Platform and the Admin Recruitment shared-link workflow both use.
"""
import copy
import json
from datetime import datetime, timedelta, timezone

import pytest

from services import assessment_engine as engine
from services import assessment_policy as policy
from services import gemini_mock_fixtures, jd_blueprint_service, judge0_service


# ============================================================================== policy
def test_canonical_limits():
    assert policy.SECTION_MINUTES == 20 and policy.OVERALL_MINUTES == 60
    assert policy.SECTION_ORDER == ("APTITUDE", "CODING", "INTERVIEW")


def test_equal_weight_overall_example_from_the_requirements():
    assert policy.overall_score(80, 60, 90) == 76.67
    assert policy.overall_score(100, 100, 100) == 100.0
    assert policy.overall_score(0, 0, 0) == 0.0   # a genuine zero is a score; a missing section is not


@pytest.mark.parametrize("scores", [(None, 60, 90), (80, None, 90), (80, 60, None), (None, None, None)])
def test_any_missing_section_makes_the_overall_null(scores):
    assert policy.overall_score(*scores) is None


def test_scores_are_normalized_to_percentages():
    assert policy.overall_score(150, -20, 90) == round((100 + 0 + 90) / 3, 2)
    assert policy.normalize_pct("72.5") == 72.5 and policy.normalize_pct("abc") is None and policy.normalize_pct(None) is None


def test_old_student_weighting_is_not_the_formula():
    assert policy.overall_score(80, 60, 90) != round(80 * 0.25 + 60 * 0.40 + 90 * 0.35, 2)


def test_section_deadline_never_outlives_the_overall_deadline():
    t0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    overall = policy.overall_deadline(t0)
    assert overall == t0 + timedelta(minutes=60)
    assert policy.section_deadline(t0, overall) == t0 + timedelta(minutes=20)
    late = t0 + timedelta(minutes=50)
    assert policy.section_deadline(late, overall) == overall            # only 10 minutes left of the 60
    assert policy.section_deadline(t0, None) == t0 + timedelta(minutes=20)


def test_scoring_model_stamp():
    assert policy.scoring_model_of({"scoring_model": "equal_v1"}) == "equal_v1"
    assert policy.scoring_model_of({}) == policy.LEGACY_SCORING_MODEL
    assert policy.scoring_model_of(None) == policy.LEGACY_SCORING_MODEL


# ============================================================================== blueprint adapter
@pytest.fixture
def blueprint():
    return jd_blueprint_service.validate_blueprint(gemini_mock_fixtures.sample_blueprint()).model_dump()


def test_adapter_produces_the_student_round_formats(blueprint):
    payloads = engine.adapt_blueprint(blueprint)
    apt_client, apt_keys = payloads["APTITUDE"]
    assert len(apt_client) == 15 and [o["key"] for o in apt_client[0]["options"]] == ["A", "B", "C", "D"]   # list of {key, text}
    assert set(apt_keys["A1"]) == {"correct_key", "explanation"}
    assert all("correct_key" not in q and "explanation" not in q for q in apt_client)

    code_client, code_keys = payloads["CODING"]
    assert [p["id"] for p in code_client] == ["C1", "C2"]
    assert set(code_client[0]["starter_code"]) == {"python", "java"}
    first = code_client[0]["public_test_cases"][0]
    assert first["input"] == "1\n2\n" and first["expected_output"] == "3"             # stdin text, not a JSON object
    assert code_keys["C1"]["comparison"] == "json" and len(code_keys["C1"]["hidden_test_cases"]) == 3
    assert "hidden" not in json.dumps(code_client).lower()

    int_client, int_keys = payloads["INTERVIEW"]
    assert [set(q) for q in int_client] == [{"id", "category", "question"}] * 5       # no rubric for the candidate
    assert int_keys["questions"][0]["evaluation_criteria"].startswith("Technical accuracy")


def test_adapter_orders_stdin_by_the_solve_signature_not_by_json_key_order(blueprint):
    bp = copy.deepcopy(blueprint)
    bp["coding_problems"][0]["starter_code"] = {"python": "def solve(b, a):\n    return a - b\n"}
    bp["coding_problems"][0]["public_test_cases"] = [{"input": {"a": 10, "b": 3}, "expected": 7}]
    case = engine.adapt_blueprint(bp)["CODING"][0][0]["public_test_cases"][0]
    assert case["input"] == "3\n10\n"                                                  # b first, as declared


def test_python_starter_carries_the_stdin_harness_and_runs(blueprint):
    starter = engine.adapt_blueprint(blueprint)["CODING"][0][0]["starter_code"]["python"]
    assert "def solve(a, b)" in starter and "__main__" in starter and "json.dumps(solve(*_args))" in starter
    code = starter.replace("    pass", "    return a + b")
    import subprocess, sys
    out = subprocess.run([sys.executable, "-c", code], input="1\n2\n", capture_output=True, text=True, timeout=20).stdout
    assert out.strip() == "3"
    assert "Scanner" in engine.adapt_blueprint(blueprint)["CODING"][0][0]["starter_code"]["java"]


# ============================================================================== comparison
def test_text_mode_is_the_student_platforms_exact_comparison():
    assert engine.outputs_equal("3\n", "3") and engine.outputs_equal("a b  \n", "a b")
    assert not engine.outputs_equal("[0, 1]", "[0,1]") and not engine.outputs_equal("True", "true")


@pytest.mark.parametrize("actual,expected", [
    ("[0, 1]", "[0,1]"), ("True", "true"), ("3.0", "3"), ("abc", '"abc"'), ("['a', 'b']", '["a", "b"]'), ("(1, 2)", "[1, 2]"),
])
def test_json_mode_accepts_equivalent_values(actual, expected):
    assert engine.outputs_equal(actual, expected, "json")


@pytest.mark.parametrize("actual,expected", [("4", "3"), ("[1, 0]", "[0, 1]"), ("", "0"), ("false", "true")])
def test_json_mode_still_rejects_wrong_values(actual, expected):
    assert not engine.outputs_equal(actual, expected, "json")


# ============================================================================== aptitude
def test_aptitude_evaluation_is_percent_correct_with_zero_for_unanswered():
    keys = {str(i): {"correct_key": "A", "explanation": f"e{i}"} for i in range(1, 4)}
    res = engine.evaluate_aptitude(keys, {"1": "a", "2": "B"})          # case-insensitive; "3" unanswered
    assert res["score"] == pytest.approx(100 / 3, abs=1e-9) and res["correct_count"] == 1 and res["total_questions"] == 3   # full precision
    assert [b["is_correct"] for b in res["breakdown"]] == [True, False, False]
    assert engine.evaluate_aptitude(keys, None)["score"] == 0.0 and engine.evaluate_aptitude({}, {})["score"] == 0.0


# ============================================================================== coding
def _fake(stdout_by_stdin, status="success", calls=None):
    def _exec(language, code, stdin=""):
        if calls is not None:
            calls.append((language, stdin))
        return {"status": status, "output": stdout_by_stdin.get(stdin, ""), "stdout": stdout_by_stdin.get(stdin, ""),
                "stderr": "", "compile_output": "", "timed_out": False, "execution_time_ms": 1.0, "raw": {}}
    return _exec


PROBLEMS = [{"id": "1", "title": "P1"}, {"id": "2", "title": "P2"}]
KEYS = {"1": {"hidden_test_cases": [{"input": "x", "expected_output": "1"}, {"input": "y", "expected_output": "2"}]},
        "2": {"hidden_test_cases": [{"input": "z", "expected_output": "9"}]}}


def test_coding_score_is_hidden_tests_passed_over_hidden_tests_total():
    calls = []
    res = engine.evaluate_coding(PROBLEMS, KEYS, {"1": {"code": "c1", "language": "python"}, "2": {"code": "c2", "language": "java"}},
                                 execute=_fake({"x": "1", "y": "nope", "z": "9"}, calls=calls))
    assert res["passed_hidden_tests"] == 2 and res["total_hidden_tests"] == 3 and res["score"] == pytest.approx(200 / 3, abs=1e-9)
    p1, p2 = res["problems"]
    assert (p1["passed_tests"], p1["total_tests"], p1["score"]) == (1, 2, 50.0) and p2["score"] == 100.0 and p2["language"] == "java"
    assert {c[0] for c in calls} == {"python", "java"}
    assert all("expected" not in stdin for _, stdin in calls)       # only inputs go to the sandbox


def test_empty_solution_scores_zero_without_touching_the_sandbox():
    calls = []
    res = engine.evaluate_coding(PROBLEMS, KEYS, {"1": {"code": "   ", "language": "python"}}, execute=_fake({}, calls=calls))
    assert res["score"] == 0.0 and calls == [] and res["problems"][0]["classification"] == "NO_SUBMISSION"


def test_sandbox_outage_raises_instead_of_scoring_zero():
    with pytest.raises(engine.SandboxUnavailable):
        engine.evaluate_coding(PROBLEMS, KEYS, {"1": {"code": "c", "language": "python"}}, execute=_fake({}, status="service_error"))


def test_busy_sandbox_is_retried_then_reported_as_unavailable(monkeypatch):
    monkeypatch.setattr(engine, "BUSY_RETRY_DELAY", 0)
    attempts = {"n": 0}

    def busy(language, code, stdin=""):
        attempts["n"] += 1
        raise engine.SandboxBusy("full")

    with pytest.raises(engine.SandboxUnavailable):
        engine.evaluate_coding(PROBLEMS, KEYS, {"2": {"code": "c", "language": "python"}}, execute=busy)
    assert attempts["n"] == engine.BUSY_RETRIES


def test_json_comparison_flag_is_per_problem():
    keys = {"1": {"hidden_test_cases": [{"input": "x", "expected_output": "[0,1]"}], "comparison": "json"}}
    res = engine.evaluate_coding([PROBLEMS[0]], keys, {"1": {"code": "c", "language": "python"}}, execute=_fake({"x": "[0, 1]"}))
    assert res["score"] == 100.0
    keys["1"]["comparison"] = "text"
    res = engine.evaluate_coding([PROBLEMS[0]], keys, {"1": {"code": "c", "language": "python"}}, execute=_fake({"x": "[0, 1]"}))
    assert res["score"] == 0.0


def test_unsupported_language_is_rejected():
    assert engine.normalize_language("PYTHON3") == "python" and engine.normalize_language("java") == "java"
    with pytest.raises(ValueError):
        engine.normalize_language("cobol")


def test_sample_run_reports_the_student_shape_and_flags_failures():
    problem = {"public_test_cases": [{"id": "p1", "input": "x", "expected_output": "1"}, {"id": "p2", "input": "y", "expected_output": "2"}]}
    out = engine.run_sample_tests(problem, "code", "python", execute=_fake({"x": "1", "y": "3"}))
    assert out["all_passed"] is False and [t["passed"] for t in out["test_results"]] == [True, False]
    assert out["language"] == "python" and out["status"] == "success"


# ============================================================================== interview
def test_interview_without_answers_scores_zero_and_never_calls_the_evaluator():
    def boom(**kw):
        raise AssertionError("must not be called")
    res = engine.evaluate_interview([{"id": "1"}], [], role="Dev", evaluate_fn=boom)
    assert res["score"] == 0.0 and res["evaluation_source"] == "no_answers"


def test_interview_score_is_the_evaluators_overall_score_clamped():
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return {"score": 140, "summary": "great", "evaluation_source": "ai", "question_evaluations": [{"question_id": 1}]}

    res = engine.evaluate_interview([{"id": "1"}], [{"question_id": "1", "response": "x"}], role="Dev", jd_summary="jd",
                                    transcript=[{"role": "user", "text": "hi"}], evaluate_fn=fake, call_gemini_fn=lambda *a, **k: None)
    assert res["score"] == 100.0 and res["qualitative_feedback"] == "great" and res["evaluation_source"] == "ai"
    assert seen["role"] == "Dev" and seen["transcript"] == [{"role": "user", "text": "hi"}] and "call_gemini_fn" in seen


# ============================================================================== normalization
QUESTIONS = [{"id": "A1"}, {"id": "A2"}]


def test_aptitude_normalization_drops_unknown_ids_and_invalid_choices():
    out = engine.normalize_submission("APTITUDE", {"answers": {"A1": "b", "A2": "Z", "ZZ": "A"}}, QUESTIONS)
    assert out == {"answers": {"A1": "B"}}


def test_coding_normalization_enforces_size_and_language():
    out = engine.normalize_submission("CODING", {"solutions": {"A1": {"code": "x", "language": "COBOL"}, "nope": {"code": "y"}}}, QUESTIONS)
    assert out == {"solutions": {"A1": {"language": "python", "code": "x"}}}
    with pytest.raises(ValueError):
        engine.normalize_submission("CODING", {"solutions": {"A1": {"code": "x" * (engine.MAX_CODE_BYTES + 1)}}}, QUESTIONS)


def test_interview_normalization_accepts_voice_list_and_typed_map():
    voice = engine.normalize_submission("INTERVIEW", {"answers": [{"question_id": "A1", "response": "r", "follow_ups": [{"response": "f"}]},
                                                                {"question_id": "ghost", "response": "x"}],
                                                      "transcript": [{"role": "assistant", "text": "q"}, {"role": "user", "text": "a"}, {"text": ""}]}, QUESTIONS)
    assert [a["question_id"] for a in voice["answers"]] == ["A1"] and voice["answers"][0]["follow_ups"][0]["response"] == "f"
    assert [t["role"] for t in voice["transcript"]] == ["ai", "user"]
    typed = engine.normalize_submission("INTERVIEW", {"answers": {"A2": "typed"}}, QUESTIONS)
    assert typed["answers"] == [{"question_id": "A2", "response": "typed", "follow_ups": []}]
