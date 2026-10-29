"""The interview is a conversation, not five fixed questions: what the candidate showed counts, unreached questions are not zeros."""
from services import interview_evaluation as ie

QUESTIONS = [{"id": i, "category": "Technical", "question": f"Prepared question {i}?"} for i in range(1, 6)]
EMPTY_ANSWERS = [{"question_id": i, "response": "", "follow_ups": []} for i in range(1, 6)]


def _fake_ai(score, seen):
    def call(prompt, system_prompt=""):
        seen.append(prompt)
        return {"overall_score": score, "technical_depth_score": score, "communication_score": score, "summary": "Limited evidence but clear.",
                "key_strengths": ["Clear"], "key_areas_for_improvement": [], "question_evaluations": [
                    {"question_id": i, "score": score, "status": "correct", "explanation": "x"} for i in range(1, 6)]}
    return call


def _talk(words):
    return [{"role": "ai", "text": "Hello, please introduce yourself."}, {"role": "user", "text": " ".join(["word"] * words)}]


def test_a_candidate_who_spoke_is_never_scored_zero_just_because_no_prepared_question_was_reached():
    seen = []
    res = ie.evaluate_five_technical_questions(QUESTIONS, EMPTY_ANSWERS, "Full Stack Engineer", transcript=_talk(120), call_gemini_fn=_fake_ai(70.0, seen))
    assert res["evaluation_source"] == "ai" and res["score"] > 0
    assert len(seen) == 1 and "FULL CONVERSATION" in seen[0] and "Candidate: word word" in seen[0]
    assert "Not reached" in seen[0] and "never asked" in seen[0]                       # the evaluator is told these are not failures
    assert all(q["status"] == "not_assessed" and q["score"] == 0.0 for q in res["question_evaluations"])      # shown as "Not reached", not as 0% answers


def test_the_score_cannot_exceed_what_the_amount_of_speech_can_prove():
    for words, cap in ((50, 44.0), (100, 58.0), (250, 100.0), (600, 100.0)):
        res = ie.evaluate_five_technical_questions(QUESTIONS, EMPTY_ANSWERS, "Role", transcript=_talk(words), call_gemini_fn=_fake_ai(95.0, []))
        assert abs(res["score"] - min(95.0, cap)) < 0.01, (words, res["score"])
        assert res["technical_depth_score"] <= cap + 0.01 and res["communication_score"] <= cap + 0.01


def test_a_reached_question_is_scored_and_only_the_unreached_ones_are_not_assessed():
    answers = [{"question_id": 1, "response": "I would profile the endpoint and add an index.", "follow_ups": []}] + EMPTY_ANSWERS[1:]
    transcript = _talk(300) + [{"role": "ai", "text": "How would you debug a slow API?", "q": 1}, {"role": "user", "text": "I would profile the endpoint and add an index."}]
    res = ie.evaluate_five_technical_questions(QUESTIONS, answers, "Role", transcript=transcript, call_gemini_fn=_fake_ai(80.0, []))
    status = {q["question_id"]: q["status"] for q in res["question_evaluations"]}
    assert status[1] == "correct" and all(status[i] == "not_assessed" for i in (2, 3, 4, 5))
    assert res["score"] == 80.0


def test_no_speech_at_all_is_still_zero_without_calling_the_ai():
    seen = []
    res = ie.evaluate_five_technical_questions(QUESTIONS, EMPTY_ANSWERS, "Role", transcript=[{"role": "ai", "text": "Hello?"}], call_gemini_fn=_fake_ai(90.0, seen))
    assert res["score"] == 0.0 and res["evaluation_source"] == "no_answers" and not seen
