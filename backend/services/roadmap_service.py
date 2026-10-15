"""
Personalized Roadmap & Daily Preparation Plan Service (Phase 3).
Converts student skill gaps and target role requirements into an actionable
multi-week preparation roadmap with daily milestone tasks.
Preserves completed tasks during roadmap regeneration.
"""

from typing import List, Dict, Any
from sqlalchemy.orm import Session

import models
from services.skill_gap_service import analyze_skill_gap

def build_deterministic_curriculum(
    target_role: str,
    missing_required: List[str],
    missing_preferred: List[str]
) -> List[Dict[str, Any]]:
    """
    Constructs a 4-week, 20-task structured preparation curriculum tailored to
    the student's specific missing skills and target role.
    """
    p1 = missing_required[0] if missing_required else "Advanced Data Structures"
    p2 = missing_required[1] if len(missing_required) > 1 else (missing_preferred[0] if missing_preferred else "System Architecture")
    p3 = missing_preferred[0] if missing_preferred else "Cloud & Deployment Basics"

    tasks = [
        # WEEK 1: Foundations & High-Priority Skill Gap
        {
            "week_number": 1,
            "day_number": 1,
            "title": f"Core Foundations of {p1}",
            "description": f"Study the architecture, syntax, and foundational concepts of {p1}.",
            "category": "TECHNICAL_SKILL",
            "why_recommended": f"Closes critical missing required skill gap for {target_role}.",
            "estimated_minutes": 45
        },
        {
            "week_number": 1,
            "day_number": 2,
            "title": "Array & Two-Pointer Problem Solving",
            "description": "Solve 3 classic array questions focusing on optimal time complexity.",
            "category": "DSA",
            "why_recommended": "Core algorithmic pattern tested in campus coding elimination rounds.",
            "estimated_minutes": 50
        },
        {
            "week_number": 1,
            "day_number": 3,
            "title": f"Practical Exercises in {p1}",
            "description": f"Implement a minimal working module using {p1} to solidify practical understanding.",
            "category": "TECHNICAL_SKILL",
            "why_recommended": f"Translates theoretical knowledge of {p1} into demonstrable code.",
            "estimated_minutes": 60
        },
        {
            "week_number": 1,
            "day_number": 4,
            "title": "Quantitative Aptitude: Speed & Distance, Percentages",
            "description": "Complete 15 timed aptitude questions commonly featured in initial screening rounds.",
            "category": "APTITUDE",
            "why_recommended": "Campus placement round 1 requires high speed and accuracy.",
            "estimated_minutes": 35
        },
        {
            "week_number": 1,
            "day_number": 5,
            "title": "Resume Keyword Alignment & Project Bullet Points",
            "description": "Review resume project bullet points using action verbs and measurable metrics (STAR framework).",
            "category": "RESUME",
            "why_recommended": "Elevates ATS compatibility and increases interview callback rates.",
            "estimated_minutes": 30
        },

        # WEEK 2: Intermediate Competencies & Secondary Gaps
        {
            "week_number": 2,
            "day_number": 1,
            "title": f"Integration Patterns with {p2}",
            "description": f"Explore how {p2} connects with relational databases and backend services.",
            "category": "TECHNICAL_SKILL",
            "why_recommended": f"Addresses required qualification for {target_role}.",
            "estimated_minutes": 45
        },
        {
            "week_number": 2,
            "day_number": 2,
            "title": "String Manipulation & Hash Map Algorithms",
            "description": "Solve 3 medium difficulty DSA problems using Hash Maps and Frequency Arrays.",
            "category": "DSA",
            "why_recommended": "Highly frequent problem archetypes in technical interviews.",
            "estimated_minutes": 50
        },
        {
            "week_number": 2,
            "day_number": 3,
            "title": "Database Schema Design & Query Optimization",
            "description": "Design an indexing strategy and normalized database schema for an e-commerce platform.",
            "category": "SYSTEM_DESIGN",
            "why_recommended": "Core competence assessed in technical interview rounds.",
            "estimated_minutes": 55
        },
        {
            "week_number": 2,
            "day_number": 4,
            "title": "Logical Reasoning & Data Interpretation Practice",
            "description": "Solve 12 syllogism and data interpretation questions under timed conditions.",
            "category": "APTITUDE",
            "why_recommended": "Standard filter in MNC and Tier-1 placement rounds.",
            "estimated_minutes": 40
        },
        {
            "week_number": 2,
            "day_number": 5,
            "title": "Weekly Revision & Timed Mini-Test",
            "description": "Complete a 45-minute timed test containing 1 coding challenge and 10 aptitude questions.",
            "category": "DSA",
            "why_recommended": "Simulates exam pressure to build speed and stamina.",
            "estimated_minutes": 45
        },

        # WEEK 3: Advanced Topics & Preferred Skills
        {
            "week_number": 3,
            "day_number": 1,
            "title": f"Hands-on with {p3}",
            "description": f"Configure and experiment with {p3} to build an engineering differentiator.",
            "category": "TECHNICAL_SKILL",
            "why_recommended": f"Provides competitive edge for top-tier {target_role} candidates.",
            "estimated_minutes": 45
        },
        {
            "week_number": 3,
            "day_number": 2,
            "title": "Trees & Binary Search Tree Traversals",
            "description": "Implement inorder, preorder, and level-order traversal on binary trees.",
            "category": "DSA",
            "why_recommended": "Critical technical round topic across tech organizations.",
            "estimated_minutes": 60
        },
        {
            "week_number": 3,
            "day_number": 3,
            "title": "System Design: Microservices vs Monoliths & Caching",
            "description": "Understand Redis caching strategies and API rate-limiting patterns.",
            "category": "SYSTEM_DESIGN",
            "why_recommended": "Differentiates junior students from production-ready engineers.",
            "estimated_minutes": 50
        },
        {
            "week_number": 3,
            "day_number": 4,
            "title": "Technical Mock Interview Self-Audit",
            "description": "Practice answering 'Walk me through your most complex project' using the STAR method.",
            "category": "MOCK_INTERVIEW",
            "why_recommended": "Essential preparation for round 2 technical evaluations.",
            "estimated_minutes": 40
        },
        {
            "week_number": 3,
            "day_number": 5,
            "title": "Dynamic Programming: Knapsack & Subsequence Basics",
            "description": "Understand memoization and tabulation on 2 classic DP problems.",
            "category": "DSA",
            "why_recommended": "High-scoring differentiator in advanced coding rounds.",
            "estimated_minutes": 60
        },

        # WEEK 4: Placement Readiness & Full Simulation
        {
            "week_number": 4,
            "day_number": 1,
            "title": "Full Placement Simulation: Aptitude Round",
            "description": "Take a 30-minute timed simulation covering Quantitative, Logical, and Verbal aptitude.",
            "category": "APTITUDE",
            "why_recommended": "Simulates final on-campus drive round 1.",
            "estimated_minutes": 45
        },
        {
            "week_number": 4,
            "day_number": 2,
            "title": "Full Placement Simulation: Live Coding Round",
            "description": "Solve 2 timed algorithmic coding problems within 60 minutes with hidden test cases.",
            "category": "DSA",
            "why_recommended": "Simulates real-world testing environments like HackerRank/Judge0.",
            "estimated_minutes": 60
        },
        {
            "week_number": 4,
            "day_number": 3,
            "title": "AI Technical Mock Interview",
            "description": "Participate in an AI-powered technical interview targeting your core tech stack.",
            "category": "MOCK_INTERVIEW",
            "why_recommended": "Assesses verbal articulation, depth of project knowledge, and technical clarity.",
            "estimated_minutes": 40
        },
        {
            "week_number": 4,
            "day_number": 4,
            "title": "HR & Behavioral Interview Preparation",
            "description": "Prepare responses for strengths, weaknesses, conflict resolution, and career vision.",
            "category": "MOCK_INTERVIEW",
            "why_recommended": "Ensures strong performance in final culture and HR fitment rounds.",
            "estimated_minutes": 35
        },
        {
            "week_number": 4,
            "day_number": 5,
            "title": "Final Placement Readiness Audit & Reassessment",
            "description": "Review progress metrics, recalculate Placement Readiness Indicator, and finalize portfolio.",
            "category": "RESUME",
            "why_recommended": "Verifies placement readiness score improvement across all dimensions.",
            "estimated_minutes": 30
        }
    ]

    return tasks


def generate_or_update_roadmap(
    profile: models.StudentProfile,
    target_role: str,
    db: Session,
    regenerate: bool = False
) -> models.StudentRoadmap:
    """
    Creates or updates the student's active roadmap.
    If regenerating, completed tasks are preserved to protect student progress.
    """
    # Check for existing active roadmap
    active_roadmap = db.query(models.StudentRoadmap).filter(
        models.StudentRoadmap.student_profile_id == profile.id,
        models.StudentRoadmap.status == "ACTIVE"
    ).first()

    # Get skill gap analysis
    resume_skills = []
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    if latest_resume and latest_resume.analysis_data:
        resume_skills = latest_resume.analysis_data.get("technical_skills", [])

    gap = analyze_skill_gap(
        student_skills=profile.current_skills or [],
        resume_skills=resume_skills,
        target_role=target_role,
        target_company=profile.target_company
    )

    missing_required = gap.get("missing_required", [])
    missing_preferred = gap.get("missing_preferred", [])

    if not active_roadmap:
        # Create new roadmap
        active_roadmap = models.StudentRoadmap(
            student_profile_id=profile.id,
            organization_id=profile.organization_id,
            target_role=target_role,
            title=f"4-Week Preparation Roadmap: {target_role}",
            summary=f"Actionable preparation plan targeting {target_role}. Prioritizes {', '.join(missing_required[:2]) if missing_required else 'advanced algorithms and placement simulations'}.",
            total_weeks=4,
            current_week=1,
            status="ACTIVE"
        )
        db.add(active_roadmap)
        db.commit()
        db.refresh(active_roadmap)

        # Generate curriculum tasks
        curriculum = build_deterministic_curriculum(target_role, missing_required, missing_preferred)
        for item in curriculum:
            task = models.StudentDailyTask(
                roadmap_id=active_roadmap.id,
                student_profile_id=profile.id,
                organization_id=profile.organization_id,
                week_number=item["week_number"],
                day_number=item["day_number"],
                title=item["title"],
                description=item["description"],
                category=item["category"],
                why_recommended=item["why_recommended"],
                estimated_minutes=item["estimated_minutes"],
                status="PENDING"
            )
            db.add(task)
        db.commit()
        db.refresh(active_roadmap)
        return active_roadmap

    elif regenerate:
        # Save existing completed tasks by (week, day)
        existing_tasks = db.query(models.StudentDailyTask).filter(
            models.StudentDailyTask.roadmap_id == active_roadmap.id
        ).all()

        completed_task_keys = set()
        for t in existing_tasks:
            if t.status == "COMPLETED":
                completed_task_keys.add((t.week_number, t.day_number))

        # Delete non-completed tasks
        for t in existing_tasks:
            if t.status != "COMPLETED":
                db.delete(t)
        db.commit()

        # Update roadmap title & summary
        active_roadmap.target_role = target_role
        active_roadmap.title = f"4-Week Preparation Roadmap: {target_role}"
        active_roadmap.summary = f"Regenerated plan prioritizing: {', '.join(missing_required[:2]) if missing_required else 'placement readiness simulations'}."

        # Add new tasks for incomplete slots
        curriculum = build_deterministic_curriculum(target_role, missing_required, missing_preferred)
        for item in curriculum:
            key = (item["week_number"], item["day_number"])
            if key not in completed_task_keys:
                task = models.StudentDailyTask(
                    roadmap_id=active_roadmap.id,
                    student_profile_id=profile.id,
                    organization_id=profile.organization_id,
                    week_number=item["week_number"],
                    day_number=item["day_number"],
                    title=item["title"],
                    description=item["description"],
                    category=item["category"],
                    why_recommended=item["why_recommended"],
                    estimated_minutes=item["estimated_minutes"],
                    status="PENDING"
                )
                db.add(task)
        db.commit()
        db.refresh(active_roadmap)

    return active_roadmap


def get_roadmap_details(roadmap: models.StudentRoadmap, db: Session) -> Dict[str, Any]:
    """
    Serializes a roadmap with week-by-week grouping and completion stats.
    """
    tasks = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.roadmap_id == roadmap.id
    ).order_by(models.StudentDailyTask.week_number, models.StudentDailyTask.day_number).all()

    total_tasks = len(tasks)
    completed_tasks = sum(1 for t in tasks if t.status == "COMPLETED")
    in_progress_tasks = sum(1 for t in tasks if t.status == "IN_PROGRESS")
    completion_rate = round((completed_tasks / max(total_tasks, 1)) * 100.0, 1)

    weeks_dict: Dict[int, List[Dict[str, Any]]] = {}
    for t in tasks:
        if t.week_number not in weeks_dict:
            weeks_dict[t.week_number] = []
        weeks_dict[t.week_number].append({
            "id": t.id,
            "week_number": t.week_number,
            "day_number": t.day_number,
            "title": t.title,
            "description": t.description,
            "category": t.category,
            "why_recommended": t.why_recommended,
            "estimated_minutes": t.estimated_minutes,
            "status": t.status,
            "completed_at": t.completed_at
        })

    weeks_list = []
    for week_num in sorted(weeks_dict.keys()):
        week_tasks = weeks_dict[week_num]
        week_completed = sum(1 for wt in week_tasks if wt["status"] == "COMPLETED")
        weeks_list.append({
            "week_number": week_num,
            "title": f"Week {week_num}: " + (
                "Foundations & Critical Skill Gaps" if week_num == 1 else
                ("Intermediate Competencies & Problem Solving" if week_num == 2 else
                ("Advanced Topics & Competitive Advantage" if week_num == 3 else
                "Full Placement Drive Simulations"))
            ),
            "completed_count": week_completed,
            "total_count": len(week_tasks),
            "tasks": week_tasks
        })

    return {
        "id": roadmap.id,
        "target_role": roadmap.target_role,
        "title": roadmap.title,
        "summary": roadmap.summary,
        "total_weeks": roadmap.total_weeks,
        "current_week": roadmap.current_week,
        "status": roadmap.status,
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "in_progress_tasks": in_progress_tasks,
        "completion_rate": completion_rate,
        "weeks": weeks_list,
        "created_at": roadmap.created_at
    }
