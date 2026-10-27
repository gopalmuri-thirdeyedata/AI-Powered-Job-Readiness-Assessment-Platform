"""
Student AI Mock Interview Service (Phase 4 / Phase 5).
Manages conversational technical & behavioral mock interview sessions,
STAR-method answer evaluation, and communication feedback.
Keeps frozen recruiter interview services (elevenlabs_service, interview_evaluation) strictly intact.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session

import models

# ==============================================================================
# CANONICAL INTERVIEW QUESTION TEMPLATES & EVALUATION RUBRICS
# ==============================================================================

ROLE_INTERVIEW_QUESTIONS: Dict[str, Dict[str, List[str]]] = {
    "Full Stack Developer": {
        "TECHNICAL": [
            "Can you walk me through the architecture of a full-stack project you recently built? What trade-offs did you make between frontend responsiveness and backend processing?",
            "How do you handle state management across complex user interactions in React, and how does that communicate with your REST or GraphQL APIs?",
            "Suppose your API endpoint is experiencing slow query response times under high concurrency. What systematic steps would you take to diagnose and optimize the bottleneck?",
            "Explain how you implement secure authentication and authorization across the stack, specifically protecting against CSRF, XSS, and token hijacking."
        ],
        "HR": [
            "Tell me about a time you encountered a severe disagreement with a teammate or peer regarding technical design. How did you resolve it?",
            "Can you describe a situation where you had to learn a completely unfamiliar technology or framework under a tight deadline? What was your approach?",
            "Why are you interested in becoming a Full Stack Developer, and where do you see your engineering journey in the next 3 years?",
            "Describe a project that failed or did not meet expectations. What went wrong, and what specific lesson did you take away?"
        ]
    },
    "Backend Engineer": {
        "TECHNICAL": [
            "Explain the difference between horizontal and vertical database scaling. When would you choose read-replicas versus database sharding?",
            "How do you design an idempotent payment processing API to guarantee zero duplicate transactions in the event of network timeouts?",
            "Walk me through your experience with caching strategies (e.g. Cache-Aside vs Write-Through) using Redis.",
            "How do you structure microservices communication? When is synchronous REST/gRPC appropriate versus asynchronous event streams via Kafka or RabbitMQ?"
        ],
        "HR": [
            "Describe a time you had to deliver a feature while balancing code quality with an urgent production deadline. How did you make trade-offs?",
            "Tell me about a challenging bug you spent days debugging. How did you stay motivated and finally isolate the root cause?",
            "How do you receive and incorporate critical feedback during code reviews?",
            "What makes a development team high-performing in your perspective, and what role do you naturally play in group dynamics?"
        ]
    },
    "DEFAULT": {
        "TECHNICAL": [
            "Can you walk me through the most technically complex software project listed on your resume? What was your personal contribution?",
            "How do you approach testing in your development cycle? What is your philosophy regarding unit tests, integration tests, and manual verification?",
            "Explain how hash tables work under the hood. How are collisions resolved, and what causes worst-case time complexity?",
            "How do you design software modules to be maintainable, reusable, and resistant to regression bugs?"
        ],
        "HR": [
            "Tell me about yourself, your background in computer science, and what technical challenges excite you most.",
            "Can you share an example of a project where you took initiative beyond the assigned requirements?",
            "How do you prioritize competing tasks when multiple deadlines coincide during academic or project sprints?",
            "What do you consider your greatest technical strength, and what is one area you are currently actively improving?"
        ]
    }
}


def get_role_questions(target_role: str, interview_type: str) -> List[str]:
    """Resolves questions for target role and interview type."""
    type_key = "HR" if interview_type.upper() == "HR" else "TECHNICAL"
    
    role_dict = ROLE_INTERVIEW_QUESTIONS.get(target_role)
    if not role_dict:
        # Check substring match
        for k in ROLE_INTERVIEW_QUESTIONS.keys():
            if k.lower() in target_role.lower():
                role_dict = ROLE_INTERVIEW_QUESTIONS[k]
                break
    if not role_dict:
        role_dict = ROLE_INTERVIEW_QUESTIONS["DEFAULT"]

    return role_dict.get(type_key, ROLE_INTERVIEW_QUESTIONS["DEFAULT"][type_key])


def evaluate_student_answer(
    question: str,
    answer: str,
    interview_type: str,
    target_role: str
) -> Dict[str, Any]:
    """
    Evaluates student response based on:
    - STAR answer structure (Situation, Task, Action, Result)
    - Technical depth & accuracy
    - Articulation & clarity
    """
    if not answer or len(answer.strip()) < 15:
        return {
            "score": 30.0,
            "star_score": 25.0,
            "tech_score": 30.0,
            "feedback": "Answer was too brief. Expand on your specific actions, architectural choices, and measurable results.",
            "strengths": ["Attempted response"],
            "improvements": ["Provide concrete technical specifics and quantify the outcome."]
        }

    word_count = len(answer.strip().split())
    has_action = any(w in answer.lower() for w in ["implemented", "built", "designed", "created", "refactored", "optimized", "decided", "tested"])
    has_result = any(w in answer.lower() for w in ["result", "improved", "reduced", "increased", "achieved", "learned", "delivered", "outcome"])
    has_tech = any(w in answer.lower() for w in ["api", "database", "sql", "react", "python", "docker", "service", "query", "cache", "latency", "scale"])

    # Score calculation
    base_score = 65.0
    if word_count >= 50:
        base_score += 10.0
    if has_action:
        base_score += 10.0
    if has_result:
        base_score += 8.0
    if has_tech:
        base_score += 7.0

    score = min(round(base_score, 1), 98.0)
    star_score = round(70.0 + (15.0 if has_action else 0.0) + (15.0 if has_result else 0.0), 1)
    tech_score = round(65.0 + (25.0 if has_tech else 5.0), 1)

    strengths = []
    if has_action:
        strengths.append("Clearly highlighted personal actions and engineering responsibilities.")
    if has_result:
        strengths.append("Concluded with tangible results and lessons learned (STAR structure).")
    if has_tech:
        strengths.append(f"Demonstrated domain familiarity relevant to {target_role}.")
    if not strengths:
        strengths.append("Communicated clearly and addressed the prompt directly.")

    improvements = []
    if not has_result:
        improvements.append("Strengthen the 'Result' phase of STAR: state the outcome or business impact.")
    if word_count < 40:
        improvements.append("Elaborate further with concrete real-world engineering examples.")
    if not has_tech and interview_type == "TECHNICAL":
        improvements.append("Incorporate specific algorithms, libraries, or architectural patterns.")
    if not improvements:
        improvements.append("Maintain this strong level of detail and pacing.")

    feedback = f"Solid response ({word_count} words). " + " ".join(strengths[:1]) + " " + " ".join(improvements[:1])

    return {
        "score": score,
        "star_score": star_score,
        "tech_score": tech_score,
        "feedback": feedback,
        "strengths": strengths,
        "improvements": improvements
    }


def start_mock_interview(
    profile: models.StudentProfile,
    interview_type: str,
    target_role: Optional[str],
    db: Session
) -> models.StudentMockInterview:
    """Initializes a new mock interview session and generates the first turn."""
    role = target_role or profile.target_role or "Software Engineer"
    interview = models.StudentMockInterview(
        student_profile_id=profile.id,
        organization_id=profile.organization_id,
        interview_type=interview_type.upper(),
        target_role=role,
        status="IN_PROGRESS",
        overall_score=0.0,
        star_structure_score=0.0,
        technical_accuracy_score=0.0
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)

    # First question
    questions = get_role_questions(role, interview_type)
    first_q = questions[0] if questions else "Can you walk me through your technical background and key projects?"

    first_turn = models.StudentMockInterviewTurn(
        mock_interview_id=interview.id,
        student_profile_id=profile.id,
        organization_id=profile.organization_id,
        turn_number=1,
        question_text=first_q,
        turn_score=0.0
    )
    db.add(first_turn)
    db.commit()

    return interview


def process_interview_turn(
    interview: models.StudentMockInterview,
    student_response: str,
    db: Session
) -> Dict[str, Any]:
    """
    Evaluates current turn answer and determines next question or interview completion.
    """
    # Current active turn
    current_turn = db.query(models.StudentMockInterviewTurn).filter(
        models.StudentMockInterviewTurn.mock_interview_id == interview.id,
        models.StudentMockInterviewTurn.student_response == None
    ).order_by(models.StudentMockInterviewTurn.turn_number.asc()).first()

    if not current_turn:
        # Fallback to latest turn
        current_turn = db.query(models.StudentMockInterviewTurn).filter(
            models.StudentMockInterviewTurn.mock_interview_id == interview.id
        ).order_by(models.StudentMockInterviewTurn.turn_number.desc()).first()

    # Evaluate student response
    eval_res = evaluate_student_answer(
        question=current_turn.question_text,
        answer=student_response,
        interview_type=interview.interview_type,
        target_role=interview.target_role
    )

    current_turn.student_response = student_response
    current_turn.feedback = eval_res["feedback"]
    current_turn.turn_score = eval_res["score"]
    db.commit()

    # Check if more questions remain
    all_role_questions = get_role_questions(interview.target_role, interview.interview_type)
    next_turn_number = current_turn.turn_number + 1
    max_turns = min(len(all_role_questions), 4)

    is_finished = next_turn_number > max_turns
    next_question = None

    if not is_finished:
        next_q_text = all_role_questions[next_turn_number - 1]
        next_turn = models.StudentMockInterviewTurn(
            mock_interview_id=interview.id,
            student_profile_id=interview.student_profile_id,
            organization_id=interview.organization_id,
            turn_number=next_turn_number,
            question_text=next_q_text,
            turn_score=0.0
        )
        db.add(next_turn)
        db.commit()
        next_question = next_q_text
    else:
        # Finalize interview
        finalize_mock_interview(interview, db)

    return {
        "turn_number": current_turn.turn_number,
        "score": eval_res["score"],
        "star_score": eval_res["star_score"],
        "feedback": eval_res["feedback"],
        "strengths": eval_res["strengths"],
        "improvements": eval_res["improvements"],
        "next_question": next_question,
        "is_finished": is_finished
    }


def finalize_mock_interview(
    interview: models.StudentMockInterview,
    db: Session
) -> models.StudentMockInterview:
    """Aggregates all turns and marks interview as COMPLETED."""
    turns = db.query(models.StudentMockInterviewTurn).filter(
        models.StudentMockInterviewTurn.mock_interview_id == interview.id,
        models.StudentMockInterviewTurn.student_response != None
    ).all()

    if turns:
        scores = [t.turn_score for t in turns]
        avg_score = round(sum(scores) / len(scores), 1)
    else:
        avg_score = 50.0

    interview.overall_score = avg_score
    interview.star_structure_score = round(avg_score * 0.95, 1)
    interview.technical_accuracy_score = round(avg_score * 1.02, 1)
    interview.status = "COMPLETED"
    interview.completed_at = datetime.utcnow()

    summary = (
        f"Mock {interview.interview_type.lower()} interview for {interview.target_role} completed with overall score of {avg_score}%. "
        f"Demonstrated good response structuring and clear articulation across {len(turns)} interview questions."
    )
    interview.feedback_summary = summary
    interview.strengths = [
        "Consistent answer pacing and logical progression",
        "Clear articulation of problem context"
    ]
    interview.areas_to_improve = [
        "Include more concrete numerical metrics in project outcomes",
        "Deepen architectural justification for design trade-offs"
    ]

    db.commit()
    db.refresh(interview)
    return interview
