"""
Coding-section scoring behaviour, identical in the Student Platform and Admin Recruitment (both call
services.assessment_engine.evaluate_coding):

    section % = hidden tests passed / hidden tests total, pooled across the problems.

Public sample tests are for the candidate's own feedback ("Run Public Tests") and never earn credit, so a solution that only
reproduces the sample outputs cannot score. Hidden inputs are sent to the sandbox one test at a time; hidden expected outputs
never leave the backend.

OPEN PRODUCT DECISION (documented, not silently changed): the finalized recruitment plan (section 9.3) describes
per-problem 50/50 scoring over public + hidden cases; the Student Platform has always pooled hidden tests only, and the
unification request made the student engine the source of truth. These tests lock in the CURRENT shared behaviour.

Mocked: the sandbox (a local Python subprocess, so the code genuinely executes) - not a live-Judge0 proof.
"""
import json

import pytest

from services import assessment_engine as engine
from services import jd_blueprint_service, gemini_mock_fixtures
from tests import recruitment_helpers as h
from tests.test_assessment_parity_matrix import (  # noqa: F401  (fixtures + helpers shared with the parity suite)
    GOOD, HALF, WRONG, _blueprint, _setup, _student_session, clk, db, env)
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401

client = h.client


def _adapted():
    client_problems, keys = engine.adapt_blueprint(_blueprint())["CODING"]
    return client_problems, keys


def _local(monkeypatch):
    return h.install_local_sandbox(monkeypatch)


def _run(solutions, monkeypatch):
    problems, keys = _adapted()
    _local(monkeypatch)
    return engine.evaluate_coding(problems, keys, solutions)


def _hardcoded_samples():
    """A 'solution' that prints the expected output for each PUBLIC sample input and a constant for anything else."""
    problems, _ = _adapted()
    out = {}
    for p in problems:
        table = {tc["input"].strip(): tc["expected_output"] for tc in p["public_test_cases"]}
        code = f"import sys\n_t = {table!r}\nprint(_t.get(sys.stdin.read().strip(), '0'))\n"
        out[p["id"]] = {"language": "python", "code": code}
    return out


# ------------------------------------------------------------------------------ the engine's rule
def test_correct_solutions_score_full_marks(monkeypatch):
    res = _run(GOOD, monkeypatch)
    assert res["score"] == 100.0 and res["passed_hidden_tests"] == res["total_hidden_tests"] > 0
    assert all(p["classification"] == "OK" for p in res["problems"])


def test_incorrect_solutions_score_zero_without_being_an_outage(monkeypatch):
    never_right = {"C1": {"language": "python", "code": h.program("def solve(a, b):\n    return -999\n")},
                   "C2": {"language": "python", "code": h.program("def solve(s):\n    return '__never__'\n")}}
    res = _run(never_right, monkeypatch)
    assert res["score"] == 0.0 and res["passed_hidden_tests"] == 0 and all(p["classification"] == "OK" for p in res["problems"])


def test_partial_credit_is_the_share_of_hidden_tests_passed(monkeypatch):
    problems, keys = _adapted()
    res = _run(HALF, monkeypatch)                                   # problem 1 correct, problem 2 returns its input unchanged
    by_id = {p["problem_id"]: p for p in res["problems"]}
    assert by_id["C1"]["score"] == 100.0 and by_id["C2"]["score"] < 100.0
    total = sum(len(k["hidden_test_cases"]) for k in keys.values())
    expected = (by_id["C1"]["passed_tests"] + by_id["C2"]["passed_tests"]) / total * 100
    assert res["score"] == pytest.approx(expected)                  # pooled hidden tests, full precision
    assert 0 < res["score"] < 100


def test_a_missing_or_blank_solution_scores_zero_for_that_problem_only(monkeypatch):
    res = _run({"C1": GOOD["C1"]}, monkeypatch)
    by_id = {p["problem_id"]: p for p in res["problems"]}
    assert by_id["C1"]["score"] == 100.0 and by_id["C2"]["score"] == 0.0 and by_id["C2"]["classification"] == "NO_SUBMISSION"
    assert 0 < res["score"] < 100


def test_pooled_weighting_follows_the_number_of_hidden_tests(monkeypatch):
    """Problems are weighted by their hidden tests (not 50/50): a problem with more hidden tests moves the section more."""
    problems, keys = _adapted()
    keys = {**keys, "C1": {**keys["C1"], "hidden_test_cases": keys["C1"]["hidden_test_cases"][:2]}}   # C1 now has 2 hidden tests
    n1, n2 = len(keys["C1"]["hidden_test_cases"]), len(keys["C2"]["hidden_test_cases"])
    assert n1 != n2
    _local(monkeypatch)
    only_c1 = engine.evaluate_coding(problems, keys, {"C1": GOOD["C1"]})
    only_c2 = engine.evaluate_coding(problems, keys, {"C2": GOOD["C2"]})
    assert only_c1["score"] == pytest.approx(n1 / (n1 + n2) * 100) and only_c2["score"] == pytest.approx(n2 / (n1 + n2) * 100)


# ------------------------------------------------------------------------------ sample hardcoding cannot score
def test_hardcoded_sample_outputs_cannot_pass_hidden_tests(monkeypatch):
    problems, keys = _adapted()
    solutions = _hardcoded_samples()
    res = _run(solutions, monkeypatch)
    hidden_total = res["total_hidden_tests"]
    assert res["passed_hidden_tests"] < hidden_total and res["score"] < 50.0
    # credit can only come from a hidden test that happens to expect the constant the code prints; samples add nothing
    coincidences = sum(1 for p in problems for tc in keys[p["id"]]["hidden_test_cases"] if tc["expected_output"].strip() == "0")
    assert res["passed_hidden_tests"] == coincidences


def test_both_workflows_score_hardcoded_samples_identically(db, env, db_session, setup_test_data, clk, monkeypatch):
    _local(monkeypatch)
    solutions = _hardcoded_samples()
    reference = engine.evaluate_coding(*_adapted(), solutions)["score"]

    sess = _student_session(db_session, setup_test_data, _blueprint())
    hdr, base = setup_test_data["auth_headers"], f"/api/roleready/session/{sess.session_uuid}"
    client.post(f"{base}/start-aptitude", headers=hdr)
    client.post(f"{base}/submit-aptitude", headers=hdr, json={"answers": {}})
    client.post(f"{base}/start-coding", headers=hdr)
    assert client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": solutions}).status_code == 200

    token, _ = h.register_ok(env["token"])
    s = h.start_ok(env["token"], token)
    client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": {}})
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": solutions}).status_code == 200

    db_session.expire_all()
    student = db_session.query(type(h.session_row(db, s["session_uuid"]))).filter_by(id=sess.id).first()
    assert student.coding_score == pytest.approx(reference) == pytest.approx(h.session_row(db, s["session_uuid"]).coding_score)


# ------------------------------------------------------------------------------ privacy of hidden tests
def test_hidden_inputs_go_to_the_sandbox_one_test_at_a_time_and_expected_outputs_never_do(monkeypatch):
    problems, keys = _adapted()
    calls = _local(monkeypatch)
    engine.evaluate_coding(problems, keys, GOOD)
    hidden_inputs = {tc["input"] for k in keys.values() for tc in k["hidden_test_cases"]}
    expected = {tc["expected_output"].strip() for k in keys.values() for tc in k["hidden_test_cases"]}
    assert set(calls["stdins"]) == hidden_inputs and len(calls["stdins"]) == len(hidden_inputs)
    sent_code = "\n".join(calls["sources"])
    assert not any(e and len(e) > 3 and e in sent_code for e in expected)


def test_candidate_payloads_never_carry_hidden_tests_or_expected_outputs():
    problems, keys = _adapted()
    shown = json.dumps(problems)
    assert "hidden" not in shown.lower()
    for k in keys.values():
        for tc in k["hidden_test_cases"]:
            assert json.dumps(tc["input"]) not in shown or tc["input"] in {c["input"] for p in problems for c in p["public_test_cases"]}
