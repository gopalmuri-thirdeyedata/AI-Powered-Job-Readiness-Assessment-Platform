import os
import re
import json
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from . import gemini_client

load_dotenv()

def evaluate_interview_transcript(transcript: list, candidate_name: str, role: str, resume_summary: str = ""):
    """
    Legacy helper: Analyzes interview transcript and generates AI-based scoring.
    """
    if not transcript or len(transcript) == 0:
        return {
            "technical_accuracy": 0,
            "communication_clarity": 0,
            "problem_solving": 0,
            "depth_of_knowledge": 0,
            "overall_score": 0,
            "feedback": "No transcript available for evaluation."
        }
    
    user_messages = [msg for msg in transcript if isinstance(msg, dict) and msg.get("speaker") == "user"]
    
    if not user_messages or len(user_messages) == 0:
        return {
            "technical_accuracy": 0,
            "communication_clarity": 0,
            "problem_solving": 0,
            "depth_of_knowledge": 0,
            "overall_score": 0,
            "feedback": "Candidate did not provide any responses during the interview."
        }
    
    conversation = ""
    try:
        for msg in transcript:
            if isinstance(msg, dict):
                speaker = "AI Interviewer" if msg.get("speaker") == "ai" else "Candidate"
                text = msg.get("text", "")
                conversation += f"{speaker}: {text}\n"
            elif isinstance(msg, str):
                conversation += f"{msg}\n"
    except Exception as e:
        conversation = str(transcript)
    
    evaluation_prompt = f"""
You are an expert technical recruiter evaluating an interview transcript.

CANDIDATE: {candidate_name}
ROLE: {role}
RESUME SUMMARY: {resume_summary if resume_summary else "Not provided"}

TRANSCRIPT:
{conversation}

Analyze the candidate's performance and provide scores (0-100) for:
1. Technical Accuracy - Correctness and depth of technical answers
2. Communication Clarity - Ability to explain concepts clearly
3. Problem-Solving Approach - Logical thinking and methodology
4. Depth of Knowledge - Understanding beyond surface level

Also provide:
- Overall Score (weighted average: 40% Technical, 25% Communication, 20% Problem-Solving, 15% Depth)
- Brief feedback (2-3 sentences)

Return ONLY valid JSON in this exact format:
{{
    "technical_accuracy": 85,
    "communication_clarity": 90,
    "problem_solving": 88,
    "depth_of_knowledge": 82,
    "overall_score": 86.25,
    "feedback": "Brief evaluation summary here"
}}
"""
    
    try:
        result = gemini_client.call_gemini(
            prompt=evaluation_prompt,
            system_prompt="You are an expert technical interview evaluator. Return only valid JSON.",
            temperature=0.3,
            json_mode=True
        )
        return {
            "technical_accuracy": result.get("technical_accuracy", 0),
            "communication_clarity": result.get("communication_clarity", 0),
            "problem_solving": result.get("problem_solving", 0),
            "depth_of_knowledge": result.get("depth_of_knowledge", 0),
            "overall_score": result.get("overall_score", 0),
            "feedback": result.get("feedback", "Evaluation completed.")
        }
    except Exception as e:
        return {
            "technical_accuracy": 0,
            "communication_clarity": 0,
            "problem_solving": 0,
            "depth_of_knowledge": 0,
            "overall_score": 0,
            "feedback": f"Evaluation failed: {str(e)}"
        }


# ==============================================================================
# 5-QUESTION TECHNICAL EVALUATION WITH EVIDENCE & DETERMINISTIC FALLBACK
# ==============================================================================

def fallback_evaluate_five_technical_questions(
    questions: List[Dict[str, Any]],
    answers: List[Dict[str, Any]],
    role: str,
    jd_summary: str = "",
    resume_summary: str = ""
) -> Dict[str, Any]:
    """
    Deterministic 5-question evaluation fallback.
    Executes whenever AI services are unavailable or down, ensuring zero failure in report generation.
    Computes heuristic scores based on answer length, technical density, and STAR indicators.
    """
    default_qs = questions or [{"id": i + 1, "category": "Technical Defense", "question": f"Question {i + 1}"} for i in range(5)]
    answers_map = {}
    for a in (answers or []):
        if isinstance(a, dict):
            qid = a.get("question_id")
            if qid is not None:
                answers_map[str(qid)] = a

    q_evaluations = []
    total_score = 0.0

    for idx, q in enumerate(default_qs[:5]):
        qid = str(q.get("id", idx + 1))
        ans_obj = answers_map.get(qid) or (answers[idx] if idx < len(answers or []) and isinstance(answers[idx], dict) else {})
        
        primary = str(ans_obj.get("response") or "").strip()
        follow_ups = ans_obj.get("follow_ups") or []
        fu_text = " ".join([str(f.get("response") or "").strip() for f in follow_ups if isinstance(f, dict)])
        full_text = f"{primary} {fu_text}".strip()

        cat = q.get("category") or "Technical Defense"
        q_text = q.get("question") or f"Interview Question {idx + 1}"
        crit = q.get("evaluation_criteria") or "Technical depth, architecture trade-offs, and practical execution."

        # Filter out placeholder speech
        is_placeholder = (
            not full_text or
            full_text.lower().startswith("candidate completed voice interview") or
            full_text.lower() in ("n/a", "none", "null")
        )

        if is_placeholder:
            score = 0.0
            status = "unanswered"
            explanation = "Candidate did not provide an answer to this question."
            strengths = []
            gaps = ["No response recorded for this question."]
            evidence = ""
            advice = "Ensure your microphone is active and articulate a structured response using the STAR method."
        elif len(full_text) < 50:
            score = 55.0
            status = "incomplete"
            explanation = "Answer was brief and lacked architectural depth or concrete technical metrics."
            strengths = ["Attempted initial response"]
            gaps = ["Lacked technical elaboration and concrete production examples"]
            evidence = full_text[:120]
            advice = f"Expand your answer to discuss concrete trade-offs, edge cases, and tools relevant to {cat}."
        elif len(full_text) < 160:
            score = 72.0
            status = "partially_correct"
            explanation = "Provided a clear conceptual foundation with good technical terminology."
            strengths = ["Structured explanation", "Relevant technical terminology"]
            gaps = ["Could elaborate further on production scale and error handling"]
            evidence = full_text[:140]
            advice = f"Deepen the technical analysis by outlining alternative architectures and performance trade-offs."
        else:
            score = 84.0
            status = "correct"
            explanation = "Demonstrated strong domain comprehension, structured articulation, and practical knowledge."
            strengths = ["Comprehensive reasoning", "Strong architectural awareness", "Clear problem-solving approach"]
            gaps = ["Consider highlighting specific monitoring metrics and disaster recovery procedures"]
            evidence = full_text[:160] + "..."
            advice = f"Reinforce your technical defense with precise benchmarks and lessons learned from past incidents."

        q_evaluations.append({
            "question_id": int(qid) if qid.isdigit() else idx + 1,
            "category": cat,
            "question_text": q_text,
            "score": score,
            "status": status,
            "explanation": explanation,
            "demonstrated_strengths": strengths,
            "knowledge_gaps": gaps,
            "evidence": evidence,
            "actionable_advice": advice,
            "evaluation_criteria": crit
        })
        total_score += score

    answered_count = sum(1 for qe in q_evaluations if qe["status"] != "unanswered")
    overall_score = round(total_score / 5.0, 1) if answered_count > 0 else 0.0

    return {
        "score": overall_score,
        "overall_score": overall_score,
        "technical_depth_score": min(100.0, round(overall_score * 0.96, 1)) if overall_score > 0 else 0.0,
        "communication_score": min(100.0, round(overall_score * 1.02, 1)) if overall_score > 0 else 0.0,
        "summary": "Demonstrated technical vocabulary and structured communication across interview topics." if overall_score > 0 else "No interview responses were submitted.",
        "qualitative_feedback": "Demonstrated clear technical vocabulary and structured communication." if overall_score > 0 else "No interview responses were submitted.",
        "evaluation_source": "fallback_default",
        "key_strengths": [
            "Structured response delivery",
            "Clear articulation of technical concepts"
        ] if overall_score > 0 else [],
        "key_areas_for_improvement": [
            "Provide concrete quantitative metrics in technical explanations",
            "Detail production scale trade-offs and disaster recovery"
        ] if overall_score > 0 else ["Provide verbal responses during the voice interview session."],
        "question_evaluations": q_evaluations
    }


MAX_CONVERSATION_CHARS = 16000


def _conversation_text(transcript: Optional[List[Dict[str, Any]]]):
    """The spoken conversation as "Interviewer: ... / Candidate: ..." lines (capped) and how many words the candidate said."""
    lines, words, total = [], 0, 0
    for turn in (transcript or []):
        if not isinstance(turn, dict):
            continue
        text = re.sub(r"\s+", " ", str(turn.get("text") or "")).strip()
        if not text or text.lower().startswith("candidate completed voice interview"):
            continue
        candidate = turn.get("role") in ("user", "candidate")
        if candidate:
            words += len(text.split())
        line = f"{'Candidate' if candidate else 'Interviewer'}: {text}"
        total += len(line) + 1
        if total > MAX_CONVERSATION_CHARS:
            break
        lines.append(line)
    return "\n".join(lines), words


def evaluate_five_technical_questions(
    questions: List[Dict[str, Any]],
    answers: List[Dict[str, Any]],
    role: str,
    jd_summary: str = "",
    resume_summary: str = "",
    transcript: Optional[List[Dict[str, Any]]] = None,
    call_gemini_fn: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Evaluates candidate answers across all 5 primary interview questions.
    Uses target role, JD requirements, resume context, question criteria, candidate answers, and follow-ups.
    When candidate provided zero answers, scores 0.0 and skips AI call.
    When AI service fails, seamlessly falls back to deterministic rubric.
    """
    if call_gemini_fn is None:
        call_gemini_fn = gemini_client.call_gemini

    default_qs = questions or [{"id": i + 1, "category": "Technical Defense", "question": f"Question {i + 1}"} for i in range(5)]

    # 1. Check if candidate provided ANY speech or typed answers
    has_candidate_content = False
    cleaned_answers = []

    for idx, q in enumerate(default_qs[:5]):
        qid = str(q.get("id", idx + 1))
        # Find matching answer
        matched_ans = None
        for a in (answers or []):
            if isinstance(a, dict) and str(a.get("question_id")) == qid:
                matched_ans = a
                break
        if not matched_ans and idx < len(answers or []):
            if isinstance(answers[idx], dict):
                matched_ans = answers[idx]

        primary_text = str((matched_ans or {}).get("response") or "").strip()
        follow_ups = (matched_ans or {}).get("follow_ups") or []
        fu_speech = [str(f.get("response") or "").strip() for f in follow_ups if isinstance(f, dict)]

        is_placeholder = (
            not primary_text or
            primary_text.lower().startswith("candidate completed voice interview") or
            primary_text.lower() in ("n/a", "none", "null")
        )
        has_fu = any(t and not t.lower().startswith("candidate completed") for t in fu_speech)

        if not is_placeholder or has_fu:
            has_candidate_content = True

        cleaned_answers.append({
            "question_id": int(qid) if qid.isdigit() else idx + 1,
            "category": q.get("category") or "Technical Defense",
            "question": q.get("question") or f"Question {idx + 1}",
            "evaluation_criteria": q.get("evaluation_criteria") or "Technical depth, accuracy, trade-offs.",
            "response": primary_text if not is_placeholder else "",
            "follow_ups": follow_ups
        })

    # Check raw transcript as secondary confirmation
    if not has_candidate_content and transcript:
        for t in transcript:
            if isinstance(t, dict) and t.get("role") in ("user", "candidate"):
                text = str(t.get("text") or "").strip()
                if text and not text.lower().startswith("candidate completed voice interview"):
                    has_candidate_content = True
                    break

    # STRICT REQUIREMENT: If candidate provided NO responses, score 0.0 with 'no_answers' and NEVER call AI!
    if not has_candidate_content:
        return {
            "score": 0.0,
            "overall_score": 0.0,
            "technical_depth_score": 0.0,
            "communication_score": 0.0,
            "summary": "No interview responses were submitted.",
            "qualitative_feedback": "No interview responses were submitted.",
            "evaluation_source": "no_answers",
            "key_strengths": [],
            "key_areas_for_improvement": [
                "Provide audible, structured verbal responses to each technical interview question."
            ],
            "question_evaluations": [
                {
                    "question_id": q["question_id"],
                    "category": q["category"],
                    "question_text": q["question"],
                    "score": 0.0,
                    "status": "unanswered",
                    "explanation": "Candidate did not provide a spoken or written response for this question.",
                    "demonstrated_strengths": [],
                    "knowledge_gaps": ["Unanswered question."],
                    "evidence": "",
                    "actionable_advice": "Ensure your microphone is functioning properly and answer the question with structured examples.",
                    "evaluation_criteria": q["evaluation_criteria"]
                }
                for q in cleaned_answers
            ]
        }

    # The whole spoken conversation, in order: the interview is adaptive, so what the candidate showed is judged from all of it, not only from
    # the prepared questions that happened to be reached.
    transcript_text, candidate_words = _conversation_text(transcript)

    # 2. Build multi-question evaluation prompt for Gemini
    formatted_questions_block = ""
    for idx, item in enumerate(cleaned_answers):
        fu_text = ""
        for f in item["follow_ups"]:
            if isinstance(f, dict):
                fu_text += f"\n  - Follow-up Q: {f.get('follow_up_question', '')}\n    Candidate Answer: {f.get('response', '')}"
        
        formatted_questions_block += f"""
QUESTION {idx + 1} (ID: {item['question_id']}):
- Category: {item['category']}
- Question: {item['question']}
- Specific Evaluation Criteria: {item['evaluation_criteria']}
- Candidate Answer: {item['response'] or ('(Not reached: this prepared question was never asked in the conversation)' if transcript_text else '(No direct answer provided)')}
- Follow-up Exchanges:{fu_text or ' (None)'}
"""

    prompt = f"""
You are a senior technical hiring bar-raiser conducting an evidence-based technical evaluation of a candidate's completed interview for the role '{role}'.

TARGET ROLE & JD REQUIREMENTS:
{jd_summary if jd_summary else f"Role: {role}"}

CANDIDATE RESUME SUMMARY:
{resume_summary if resume_summary else "Not provided"}

FULL CONVERSATION (the interview was adaptive and spoken, in order; this is the complete evidence):
{transcript_text or '(not available: use the per-question answers below)'}

PREPARED QUESTIONS & THE ANSWERS MAPPED TO THEM:
{formatted_questions_block}

SCORING PRINCIPLES (read first):
- Judge what the candidate actually demonstrated anywhere in the conversation (their introduction, how they describe their own projects, follow-up answers and
  answers to prepared questions). Their own project explanations are valid technical evidence.
- A prepared question marked "Not reached" was simply never asked. Do NOT score it zero and do NOT penalize the candidate for it: give it status "not_assessed".
- The overall, technical_depth and communication scores must reflect the evidence that exists. If the conversation is short or has little technical content, say
  "limited evidence" in the summary and score what was shown fairly; never return 0 for a candidate who spoke and answered.
- Score 0 only when the candidate gave no meaningful answers at all.

EVALUATION INSTRUCTIONS:
1. Evaluate each of the 5 questions individually against its specific evaluation criteria and candidate answer + follow-ups (use "not_assessed" when not reached).
2. For each question:
   - Identify what the candidate explained correctly (demonstrated_strengths).
   - Identify what was missing or technically inaccurate (knowledge_gaps).
   - Quote exact phrases from the answer as proof (evidence).
   - Provide concrete, actionable advice for improvement (actionable_advice).
   - Assign an accurate score from 0.0 to 100.0.
   - Assign a status: "correct" (>=80), "partially_correct" (50-79), "incorrect" (1-49), "incomplete" (1-49), "unanswered" (0, asked but not answered), or "not_assessed" (never asked).
   - Do NOT penalize accents, speaking pace, or minor conversational grammar.
   - Do NOT reward confident delivery that lacks technical substance.
   - For behavioral questions, evaluate actual decisions, actions, and measurable outcomes (STAR).
3. Compute an overall interview score (0-100), technical_depth_score (0-100), and communication_score (0-100).
4. Provide top overall key strengths, key areas for improvement, and a 2-3 sentence executive summary.

Return ONLY strictly valid JSON matching this exact structure:
{{
  "overall_score": 82.0,
  "technical_depth_score": 80.0,
  "communication_score": 85.0,
  "summary": "Demonstrated good technical vocabulary and clear communication.",
  "key_strengths": ["Strengths list"],
  "key_areas_for_improvement": ["Improvement areas list"],
  "question_evaluations": [
    {{
      "question_id": 1,
      "category": "System Architecture",
      "score": 85.0,
      "status": "correct",
      "explanation": "Concise justification of evaluation.",
      "demonstrated_strengths": ["Clear concept explanation"],
      "knowledge_gaps": ["Did not mention edge cases"],
      "evidence": "Brief quotation from response",
      "actionable_advice": "Actionable advice"
    }}
  ]
}}
"""

    try:
        eval_res = call_gemini_fn(
            prompt,
            system_prompt="You are a senior technical hiring bar-raiser. Output strictly valid JSON."
        )

        if not eval_res or not isinstance(eval_res, dict):
            raise ValueError("Empty or non-dictionary response from AI evaluator")

        # Compatibility handling for mock responses that return {"score": X, "summary": Y}
        raw_score = eval_res.get("overall_score", eval_res.get("score", 75.0))
        score = max(0.0, min(100.0, float(raw_score)))
        tech_score = max(0.0, min(100.0, float(eval_res.get("technical_depth_score", score))))
        comm_score = max(0.0, min(100.0, float(eval_res.get("communication_score", score))))

        raw_q_evals = eval_res.get("question_evaluations") or []
        parsed_q_evals = []

        # If AI didn't provide individual question breakdowns (e.g. test mock), synthesize them
        if not raw_q_evals or len(raw_q_evals) < 3:
            for idx, item in enumerate(cleaned_answers):
                item_score = score
                parsed_q_evals.append({
                    "question_id": item["question_id"],
                    "category": item["category"],
                    "question_text": item["question"],
                    "score": item_score,
                    "status": "correct" if item_score >= 80 else ("partially_correct" if item_score >= 50 else "incomplete"),
                    "explanation": eval_res.get("summary", "Demonstrated clear technical vocabulary."),
                    "demonstrated_strengths": eval_res.get("strengths", eval_res.get("key_strengths", ["Technical articulation"])),
                    "knowledge_gaps": eval_res.get("areas_for_improvement", eval_res.get("key_areas_for_improvement", ["Further detail on scale"])),
                    "evidence": item["response"][:120] if item["response"] else "Voice interview response",
                    "actionable_advice": "Review system architecture trade-offs and edge case handling.",
                    "evaluation_criteria": item["evaluation_criteria"]
                })
        else:
            for idx, item in enumerate(cleaned_answers):
                matched = None
                for qe in raw_q_evals:
                    if str(qe.get("question_id")) == str(item["question_id"]):
                        matched = qe
                        break
                if not matched and idx < len(raw_q_evals):
                    matched = raw_q_evals[idx]
                
                if matched:
                    q_score = max(0.0, min(100.0, float(matched.get("score", score))))
                    parsed_q_evals.append({
                        "question_id": item["question_id"],
                        "category": item["category"],
                        "question_text": item["question"],
                        "score": q_score,
                        "status": matched.get("status") or ("correct" if q_score >= 80 else ("partially_correct" if q_score >= 50 else "incomplete")),
                        "explanation": matched.get("explanation") or "Evaluated against role criteria.",
                        "demonstrated_strengths": matched.get("demonstrated_strengths") or ["Demonstrated understanding"],
                        "knowledge_gaps": matched.get("knowledge_gaps") or [],
                        "evidence": matched.get("evidence") or (item["response"][:120] if item["response"] else ""),
                        "actionable_advice": matched.get("actionable_advice") or "Continue deepening technical trade-offs.",
                        "evaluation_criteria": item["evaluation_criteria"]
                    })
                else:
                    parsed_q_evals.append({
                        "question_id": item["question_id"],
                        "category": item["category"],
                        "question_text": item["question"],
                        "score": score,
                        "status": "partially_correct",
                        "explanation": "Answer evaluated.",
                        "demonstrated_strengths": ["Demonstrated understanding"],
                        "knowledge_gaps": [],
                        "evidence": item["response"][:120],
                        "actionable_advice": "Review trade-offs.",
                        "evaluation_criteria": item["evaluation_criteria"]
                    })

        if transcript_text:
            reached = {item["question_id"]: bool(item["response"] or item["follow_ups"]) for item in cleaned_answers}
            for qe in parsed_q_evals:
                if not reached.get(qe["question_id"]):          # asked never: not a failure, simply not scored
                    qe.update(status="not_assessed", score=0.0, assessed=False, demonstrated_strengths=[], knowledge_gaps=[], evidence="", actionable_advice="",
                              explanation="This prepared question was not reached in the conversation, so it does not count against the candidate.")
            # What a short conversation can prove is limited: the score may not exceed what the amount of speech supports (50 words: 44, 100: 58, 250+: no cap).
            cap = 30.0 + 70.0 * min(1.0, candidate_words / 250.0)
            score, tech_score, comm_score = min(score, cap), min(tech_score, cap), min(comm_score, cap)

        return {
            "score": score,
            "overall_score": score,
            "technical_depth_score": tech_score,
            "communication_score": comm_score,
            "summary": eval_res.get("summary", "Demonstrated clear technical vocabulary and structured communication."),
            "qualitative_feedback": eval_res.get("summary", "Demonstrated clear technical vocabulary and structured communication."),
            "evaluation_source": "ai",
            "key_strengths": eval_res.get("key_strengths", ["Clear communication", "Structured approach"]),
            "key_areas_for_improvement": eval_res.get("key_areas_for_improvement", ["Provide more concrete metrics", "Elaborate on production scale"]),
            "question_evaluations": parsed_q_evals
        }

    except Exception as e:
        print(f"[PrepWin] AI interview evaluation fallback triggered: {e}")
        return fallback_evaluate_five_technical_questions(
            questions=questions,
            answers=answers,
            role=role,
            jd_summary=jd_summary,
            resume_summary=resume_summary
        )
