"""
Aptitude fairness and correctness:
  * every candidate gets their own paper (question order and option order shuffled), with the answer key remapped so scoring is unchanged;
  * every answer key is confirmed by a second, independent Gemini call before a blueprint is stored; disagreeing questions are replaced.
"""
import copy
import random

import pytest

from services import assessment_engine as engine
from services import gemini_mock_fixtures, jd_blueprint_service as jd
from tests import recruitment_helpers as h

client = h.client


def sample():
    return gemini_mock_fixtures.sample_blueprint()


def adapted(neutral=False):
    """The sample paper. `neutral=True` gives every option its own plain text (the fixture's "Option A for question 1" refers to a letter, so
    the shuffle deliberately leaves such a question alone; real questions rarely do)."""
    questions, keys = engine.adapt_blueprint(sample())["APTITUDE"]
    if neutral:
        for q in questions:
            for k, o in zip("ABCD", q["options"]):
                o["text"] = f"Value {ord(k) - 64}{q['id']}"
    return questions, keys


# ------------------------------------------------------------------------------ shuffling
def test_the_key_follows_the_shuffle_so_every_correct_answer_still_scores():
    questions, keys = adapted(neutral=True)
    shuffled_q, shuffled_k = engine.shuffle_aptitude(questions, keys, random.Random(7))
    original_text = {q["id"]: {o["key"]: o["text"] for o in q["options"]} for q in questions}
    for q in shuffled_q:
        assert [o["key"] for o in q["options"]] == ["A", "B", "C", "D"]
        correct_text_before = original_text[q["id"]][keys[q["id"]]["correct_key"]]
        correct_text_now = {o["key"]: o["text"] for o in q["options"]}[shuffled_k[q["id"]]["correct_key"]]
        assert correct_text_now == correct_text_before, "the option that was correct is still the correct one"
        assert sorted(o["text"] for o in q["options"]) == sorted(original_text[q["id"]].values())
    answers = {q["id"]: shuffled_k[q["id"]]["correct_key"] for q in shuffled_q}
    assert engine.evaluate_aptitude(shuffled_k, answers)["score"] == 100.0
    assert engine.evaluate_aptitude(keys, answers)["score"] < 100.0          # the ORIGINAL key would mark some of these answers wrong: the remap matters


def test_questions_and_options_really_change_order_and_the_originals_are_not_modified():
    questions, keys = adapted(neutral=True)
    snapshot = copy.deepcopy(questions)
    a, _ = engine.shuffle_aptitude(questions, keys, random.Random(1))
    b, _ = engine.shuffle_aptitude(questions, keys, random.Random(2))
    assert [q["id"] for q in a] != [q["id"] for q in questions] and [q["id"] for q in a] != [q["id"] for q in b]
    assert any([o["text"] for o in x["options"]] != [o["text"] for o in y["options"]] for x, y in zip(sorted(a, key=lambda q: q["id"]), sorted(b, key=lambda q: q["id"])))
    assert questions == snapshot and sorted(q["id"] for q in a) == sorted(q["id"] for q in questions)


@pytest.mark.parametrize("text", ["Both A and B", "All of the above", "None of these", "Option C", "A and C", "neither of them"])
def test_options_that_refer_to_each_other_keep_their_place(text):
    questions, keys = adapted(neutral=True)
    questions[0]["options"][3] = {"key": "D", "text": text}
    for seed in range(6):
        out, _ = engine.shuffle_aptitude(questions, keys, random.Random(seed))
        same = next(q for q in out if q["id"] == questions[0]["id"])
        assert same["options"] == questions[0]["options"], "reordering would have made this question wrong"


def test_plain_words_are_not_mistaken_for_option_references():
    questions, keys = adapted(neutral=True)
    questions[0]["options"][0] = {"key": "A", "text": "an apple or a banana"}
    questions[0]["options"][1] = {"key": "B", "text": "Cats and dogs"}
    out = [next(q for q in engine.shuffle_aptitude(questions, keys, random.Random(s))[0] if q["id"] == questions[0]["id"]) for s in range(8)]
    assert any(q["options"] != questions[0]["options"] for q in out)


class Fixed:
    """A random source that shuffles nothing, to prove malformed input is left alone."""
    def shuffle(self, x):
        pass


def test_a_question_without_four_options_is_left_alone():
    questions, keys = adapted(neutral=True)
    questions[1]["options"] = questions[1]["options"][:3]
    out, _ = engine.shuffle_aptitude(questions, keys, Fixed())
    assert next(q for q in out if q["id"] == questions[1]["id"])["options"] == questions[1]["options"]


def start_candidate(env):
    token, _ = h.register_ok(env["token"])
    return h.start_ok(env["token"], token)


@pytest.fixture(scope="module")
def env():
    db = h.new_session()
    mp = pytest.MonkeyPatch()
    admin = h.make_admin(db)
    job = h.create_published_job(admin, mp)
    yield {"db": db, "token": job["share_token"]}
    mp.undo()
    h.cleanup_orgs(db, [admin["org"].id])
    db.close()


def test_two_candidates_of_one_link_get_different_papers_that_both_score_correctly(env, monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    first, second = start_candidate(env), start_candidate(env)
    order = lambda s: [q["id"] for q in s["state"]["section"]["questions"]]                         # noqa: E731
    texts = lambda s: [[o["text"] for o in q["options"]] for q in s["state"]["section"]["questions"]]  # noqa: E731
    assert sorted(order(first)) == sorted(order(second))
    assert order(first) != order(second) or texts(first) != texts(second), "two candidates must not get the same paper"
    for started in (first, second):                       # each paper is scored against ITS OWN key
        answers = h.correct_aptitude_answers(env["db"], started["session_uuid"])
        r = client.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": answers})
        assert r.status_code == 200
        assert h.session_row(env["db"], started["session_uuid"]).aptitude_score == 100.0


# ------------------------------------------------------------------------------ answer-key verification
def core_of(blueprint):
    return jd._CoreBlueprint(**{k: v for k, v in blueprint.items() if k in ("role_title", "seniority_level", "required_technical_skills",
                                                                           "aptitude_questions", "interview_questions")})


def replacement(qid, correct="B"):
    return {"id": qid, "domain": "Logical", "difficulty": "Medium", "question": f"Replacement for {qid}: pick B.",
            "options": {"A": "no", "B": "yes", "C": "maybe", "D": "never"}, "correct_key": correct, "explanation": "B."}


def test_agreeing_keys_pass_without_replacements(monkeypatch):
    bp = sample()
    calls = []

    def fake(prompt, **kw):
        calls.append(prompt)
        return {"answers": [{"id": q["id"], "answer": q["correct_key"]} for q in bp["aptitude_questions"]]}

    monkeypatch.setattr(jd.gemini_client, "call_gemini", fake)
    core = jd._verify_and_repair_aptitude(core_of(bp), "jd text", "Dev")
    assert len(core.aptitude_questions) == 15 and len(calls) == 1 and "APTITUDE ANSWER CHECK" in calls[0]
    assert "correct_key" not in calls[0] and "explanation" not in calls[0], "the check must not be shown the intended answers"


def test_a_disagreeing_key_is_replaced_and_the_replacement_is_checked_too(monkeypatch):
    bp = sample()
    wrong_ids = {"A3", "A9"}
    state = {"round": 0}

    def fake(prompt, **kw):
        if "APTITUDE ANSWER CHECK" in prompt:
            state["round"] += 1
            answers = []
            for q in jd_questions_in(prompt):
                if state["round"] == 1 and q in wrong_ids:
                    answers.append({"id": q, "answer": "X"})               # ambiguous / disagreeing on the first pass
                else:
                    key = next((x["correct_key"] for x in bp["aptitude_questions"] if x["id"] == q), "B")
                    answers.append({"id": q, "answer": "B" if q in wrong_ids else key})
            return {"answers": answers}
        assert "REPLACE" in prompt and "A3" in prompt and "A9" in prompt
        return {"aptitude_questions": [replacement("A3"), replacement("A9")]}

    monkeypatch.setattr(jd.gemini_client, "call_gemini", fake)
    core = jd._verify_and_repair_aptitude(core_of(bp), "jd text", "Dev")
    by_id = {q.id: q for q in core.aptitude_questions}
    assert len(by_id) == 15 and by_id["A3"].question.startswith("Replacement") and by_id["A9"].question.startswith("Replacement")
    assert not by_id["A1"].question.startswith("Replacement")


def jd_questions_in(prompt):
    import re
    return re.findall(r"\[(A\d+)\]", prompt)


def test_keys_that_stay_unconfirmed_reject_the_blueprint(monkeypatch):
    bp = sample()

    def fake(prompt, **kw):
        if "APTITUDE ANSWER CHECK" in prompt:
            return {"answers": [{"id": q, "answer": "X"} for q in jd_questions_in(prompt)]}       # every question "ambiguous", forever
        import re
        wanted = re.search(r"Use exactly these ids: ([A0-9, ]+)\.", prompt).group(1).replace(" ", "").split(",")
        return {"aptitude_questions": [replacement(q) for q in wanted]}

    monkeypatch.setattr(jd.gemini_client, "call_gemini", fake)
    with pytest.raises(jd.coding_problem_factory.ProblemRejected, match="could not be confirmed"):
        jd._verify_and_repair_aptitude(core_of(bp), "jd text", "Dev")


def test_an_unusable_check_answer_is_never_taken_as_confirmation(monkeypatch):
    bp = sample()
    monkeypatch.setattr(jd.gemini_client, "call_gemini", lambda prompt, **kw: {"something": "else"})
    with pytest.raises(jd.coding_problem_factory.ProblemRejected):
        jd._verify_and_repair_aptitude(core_of(bp), "jd text", "Dev")


def test_the_generate_endpoint_path_runs_the_check(monkeypatch):
    seen = []
    real = jd._verify_and_repair_aptitude
    monkeypatch.setattr(jd, "_verify_and_repair_aptitude", lambda core, text, role: seen.append(1) or real(core, text, role))
    blueprint = jd.generate_jd_blueprint("We need a backend engineer who builds Python services, REST APIs and SQL databases in production.")
    assert seen == [1] and len(blueprint.aptitude_questions) == 15
