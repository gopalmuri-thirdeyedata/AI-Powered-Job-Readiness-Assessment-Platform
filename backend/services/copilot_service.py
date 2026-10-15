"""
Student Career Copilot Service (Phase 8).
Provides an intelligent conversational AI assistant grounded in the student's unique profile,
target role benchmarks, missing skills, roadmap status, and assessment metrics.
Strictly isolated from recruiter services.
"""

from typing import Dict, Any
from sqlalchemy.orm import Session

import models


def assemble_student_context(profile: models.StudentProfile, db: Session) -> Dict[str, Any]:
    """Collects real-time preparatory context for grounding the Copilot."""
    # 1. Latest resume
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    # 2. Roadmap progress
    total_tasks = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.student_profile_id == profile.id
    ).count()
    completed_tasks = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.student_profile_id == profile.id,
        models.StudentDailyTask.status == "COMPLETED"
    ).count()

    # 3. Practice questions solved
    practice_solved = db.query(models.StudentPracticeAttempt).filter(
        models.StudentPracticeAttempt.student_profile_id == profile.id,
        models.StudentPracticeAttempt.is_correct == True
    ).count()

    # 4. Mock interviews
    interviews = db.query(models.StudentMockInterview).filter(
        models.StudentMockInterview.student_profile_id == profile.id,
        models.StudentMockInterview.status == "COMPLETED"
    ).all()
    avg_interview_score = round(sum(i.overall_score for i in interviews) / len(interviews), 1) if interviews else 0.0

    # 5. Projects
    projects_count = db.query(models.StudentProject).filter(
        models.StudentProject.student_profile_id == profile.id
    ).count()

    # 6. Placement simulations
    sim = db.query(models.StudentPlacementSimulation).filter(
        models.StudentPlacementSimulation.student_profile_id == profile.id,
        models.StudentPlacementSimulation.status == "COMPLETED"
    ).order_by(models.StudentPlacementSimulation.completed_at.desc()).first()

    return {
        "full_name": profile.full_name,
        "target_role": profile.target_role or "Software Engineer",
        "target_company": profile.target_company or "Tier-1 Tech",
        "current_skills": profile.current_skills or [],
        "readiness_score": profile.readiness_score,
        "resume_score": latest_resume.overall_score if latest_resume else 0.0,
        "ats_score": latest_resume.ats_score if latest_resume else 0.0,
        "roadmap_completed": completed_tasks,
        "roadmap_total": total_tasks,
        "practice_solved": practice_solved,
        "mock_interviews_count": len(interviews),
        "avg_interview_score": avg_interview_score,
        "projects_count": projects_count,
        "simulation_score": sim.overall_score if sim else None
    }


def generate_grounded_response(user_query: str, ctx: Dict[str, Any]) -> tuple[str, str]:
    """Generates context-grounded response and identifies intent."""
    q_lower = user_query.lower()
    role = ctx["target_role"]
    readiness = ctx["readiness_score"]
    skills = ", ".join(ctx["current_skills"][:4]) if ctx["current_skills"] else "core programming"

    # Intent detection
    if any(k in q_lower for k in ["roadmap", "today", "schedule", "week", "plan", "task"]):
        intent = "ROADMAP_HELP"
        remaining = ctx["roadmap_total"] - ctx["roadmap_completed"]
        reply = (
            f"Based on your 4-week preparation plan for **{role}**, you have completed **{ctx['roadmap_completed']} of {ctx['roadmap_total']}** daily tasks. "
            f"To keep your momentum: prioritize today's high-yield technical task and practice 2 DSA problems. "
            f"Completing your {remaining} remaining tasks will systematically raise your Placement Readiness Score from **{readiness}%**."
        )

    elif any(k in q_lower for k in ["skill", "gap", "learn", "tech", "stack", "react", "python", "fastapi", "docker"]):
        intent = "SKILL_GAP"
        reply = (
            f"Your current verified skills include: **{skills}**. "
            f"To maximize competitiveness for **{role}** roles, top hiring managers expect strong proficiency in:\n"
            f"1. **Scalable System Architecture & Microservices** (Docker, Redis caching)\n"
            f"2. **Database Optimization** (PostgreSQL/MySQL indexing, transactions)\n"
            f"3. **Production API Security** (JWT auth, rate-limiting)\n\n"
            f"You can explore the interactive **Skill Gap Simulator** in the portal to test how adding these technologies increases your match percentage!"
        )

    elif any(k in q_lower for k in ["interview", "mock", "star", "behavioral", "question", "answer"]):
        intent = "INTERVIEW_PREP"
        reply = (
            f"For **{role}** interviews, structure every technical and situational story using the **STAR method**:\n"
            f"• **Situation**: 1-2 sentences setting the engineering context or outage.\n"
            f"• **Task**: What specific component or deliverable you owned.\n"
            f"• **Action**: Concrete technical choices (libraries, schemas, refactoring).\n"
            f"• **Result**: Quantified impact (e.g., *'reduced latency by 35%'*, *'eliminated duplicate transactions'*).\n\n"
            f"You've completed **{ctx['mock_interviews_count']} mock interview sessions** with an average score of **{ctx['avg_interview_score']}%**. "
            f"Head over to the **Mock Interview** tab to run a targeted 4-question session!"
        )

    elif any(k in q_lower for k in ["project", "portfolio", "github", "architecture"]):
        intent = "PROJECT_HELP"
        reply = (
            f"You currently have **{ctx['projects_count']} projects** listed in your portfolio. "
            f"For top-tier placements, quality beats quantity. Make sure each project features:\n"
            f"• A public GitHub repository with architectural diagrams and a clear README\n"
            f"• A live deployed demo link recruiters can test\n"
            f"• Automated unit/integration test coverage\n\n"
            f"Use the **Portfolio Projects** tab to generate instant AI architectural critiques and predicted interview questions for your projects!"
        )

    elif any(k in q_lower for k in ["readiness", "score", "improve", "percentage", "rank"]):
        intent = "READINESS_HELP"
        reply = (
            f"Your current Placement Readiness Indicator stands at **{readiness}%**. "
            f"This composite metric reflects 5 active dimensions:\n"
            f"• **Resume & ATS Quality**: {ctx['ats_score']}% ATS score\n"
            f"• **Practice Problems**: {ctx['practice_solved']} solved\n"
            f"• **Mock Interviews**: {ctx['mock_interviews_count']} sessions ({ctx['avg_interview_score']} avg)\n"
            f"• **Portfolio Projects**: {ctx['projects_count']} documented\n\n"
            f"The fastest way to reach the **85%+ Tier-1 Readiness** bracket is to complete a full **Campus Placement Drive Simulation**!"
        )

    else:
        intent = "GENERAL"
        reply = (
            f"Hello {ctx['full_name']}! I'm your dedicated Career Copilot for your **{role}** journey. "
            f"Your current readiness score is **{readiness}%**. I can help you with:\n"
            f"• **Daily Preparation**: Prioritizing roadmap tasks and DSA practice\n"
            f"• **Skill Intelligence**: Addressing missing skills for {role}\n"
            f"• **Interview Coaching**: Crafting STAR responses and technical design trade-offs\n"
            f"• **Project Reviews**: Elevating your portfolio architecture\n\n"
            f"What would you like to focus on right now?"
        )

    return reply, intent


def send_copilot_message(
    profile: models.StudentProfile,
    user_content: str,
    db: Session
) -> models.StudentCopilotMessage:
    """Processes student message, saves user & assistant turns, returns assistant response."""
    # 1. Save user turn
    user_msg = models.StudentCopilotMessage(
        student_profile_id=profile.id,
        organization_id=profile.organization_id,
        role="USER",
        content=user_content.strip()
    )
    db.add(user_msg)
    db.commit()

    # 2. Assemble context & generate grounded response
    ctx = assemble_student_context(profile, db)
    assistant_content, intent = generate_grounded_response(user_content, ctx)

    # 3. Save assistant turn
    assistant_msg = models.StudentCopilotMessage(
        student_profile_id=profile.id,
        organization_id=profile.organization_id,
        role="ASSISTANT",
        content=assistant_content,
        intent=intent,
        context_metadata={"readiness_score": ctx["readiness_score"], "target_role": ctx["target_role"]}
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    return assistant_msg


def get_copilot_history(profile: models.StudentProfile, db: Session, limit: int = 50) -> Dict[str, Any]:
    """Retrieves conversation history and contextual starter suggestions."""
    messages = db.query(models.StudentCopilotMessage).filter(
        models.StudentCopilotMessage.student_profile_id == profile.id,
        models.StudentCopilotMessage.organization_id == profile.organization_id
    ).order_by(models.StudentCopilotMessage.created_at.asc()).limit(limit).all()

    target_role = profile.target_role or "Software Engineer"
    suggestions = [
        f"How can I improve my Placement Readiness Score for {target_role}?",
        "What are the top 3 skills I should focus on this week?",
        "How do I structure a STAR response for a technical project setback?",
        "Review what I should do today on my preparation roadmap"
    ]

    return {
        "messages": messages,
        "suggestions": suggestions
    }


def clear_copilot_history(profile: models.StudentProfile, db: Session) -> int:
    """Clears student's copilot chat history."""
    count = db.query(models.StudentCopilotMessage).filter(
        models.StudentCopilotMessage.student_profile_id == profile.id,
        models.StudentCopilotMessage.organization_id == profile.organization_id
    ).delete()
    db.commit()
    return count
