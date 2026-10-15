"""
Placement Readiness Scoring Service (Modular).
Calculates an initial 0–100 Placement Readiness Indicator using available student resume & profile data.
Designed to seamlessly incorporate DSA, Aptitude, Interview, Communication, and Practice dimensions in subsequent phases.
"""

from typing import Dict, Any, Optional
import models
from sqlalchemy.orm import object_session

def _resume_profile_readiness(
    profile: models.StudentProfile,
    latest_resume: Optional[models.StudentResume] = None
) -> Dict[str, Any]:
    """
    Resume/profile-only readiness (the "preparation baseline"): resume, skills, projects,
    experience, education and ATS quality. Activity signals are blended on top by
    calculate_placement_readiness().
    """
    if not latest_resume:
        # Default baseline when no resume is uploaded yet
        return {
            "indicator_title": "Placement Readiness Indicator",
            "disclaimer": "This score is an automated preparation indicator to guide your learning and practice. It is not an objective guarantee of employment.",
            "overall_score": 15.0,
            "breakdown": {
                "resume": 0.0,
                "technical_skills": min(100.0, len(profile.current_skills or []) * 10.0),
                "projects": 0.0,
                "experience": 0.0,
                "education": 50.0 if profile.graduation_year else 20.0,
                "ats_quality": 0.0
            },
            "strengths": ["Profile registered for placement preparation"],
            "areas_to_improve": [
                "Upload your latest resume to generate comprehensive readiness scores",
                "Select target role to initiate customized skill gap tracking"
            ]
        }

    analysis = latest_resume.analysis_data or {}
    
    # 1. Dimension: Resume Overall Score (0-100)
    resume_score = float(latest_resume.overall_score or 50.0)

    # 2. Dimension: Technical Skills (0-100)
    # Based on extracted technical skills count and profile skills
    tech_skills = analysis.get("technical_skills") or profile.current_skills or []
    tech_count = len(tech_skills)
    technical_skills_score = min(100.0, max(25.0, tech_count * 7.5))

    # 3. Dimension: Projects (0-100)
    projects = analysis.get("projects") or []
    has_metrics_count = sum(1 for p in projects if isinstance(p, dict) and p.get("has_metrics"))
    projects_score = min(100.0, max(20.0, (len(projects) * 30.0) + (has_metrics_count * 15.0)))
    # Portfolio projects reviewed on the Projects page also count (best of the two sources)
    portfolio_score = _portfolio_projects_score(profile)
    if portfolio_score is not None:
        projects_score = max(projects_score, portfolio_score)

    # 4. Dimension: Experience / Internships (0-100)
    # For students, 1 internship = 70, 2+ = 90; 0 internships = 40 (based on practical work)
    experience = analysis.get("experience") or []
    if len(experience) >= 2:
        experience_score = 90.0
    elif len(experience) == 1:
        experience_score = 75.0
    else:
        experience_score = 45.0

    # 5. Dimension: Education & Academics (0-100)
    cgpa = profile.cgpa
    if cgpa:
        # Scale 10.0 CGPA to 100
        education_score = min(100.0, max(50.0, cgpa * 10.0 if cgpa <= 10.0 else cgpa))
    else:
        education_score = 75.0 if profile.graduation_year else 60.0

    # 6. Dimension: ATS / Resume Quality (0-100)
    ats_score = float(latest_resume.ats_score or 50.0)
    quality_score = float(analysis.get("resume_quality", {}).get("score", ats_score))
    ats_quality_score = round((ats_score * 0.6) + (quality_score * 0.4), 1)

    # Phase 1 Weights
    # Resume: 25%, Technical Skills: 25%, Projects: 20%, Experience: 10%, Education: 10%, ATS/Quality: 10%
    overall_score = round(
        (resume_score * 0.25) +
        (technical_skills_score * 0.25) +
        (projects_score * 0.20) +
        (experience_score * 0.10) +
        (education_score * 0.10) +
        (ats_quality_score * 0.10),
        1
    )
    overall_score = min(100.0, max(10.0, overall_score))

    # Derive top strengths and areas to improve
    strengths = latest_resume.strengths or [
        f"Solid technical skills base ({len(tech_skills)} skills listed)",
        "Structured resume with academic credentials"
    ]

    areas_to_improve = []
    if projects_score < 70.0:
        areas_to_improve.append("Add 1-2 production-ready projects with measurable outcomes")
    if technical_skills_score < 70.0:
        areas_to_improve.append("Expand core technologies aligned with your target role")
    if experience_score < 60.0:
        areas_to_improve.append("Highlight open-source contributions, academic research, or virtual internships")
    if ats_quality_score < 70.0:
        areas_to_improve.append("Improve ATS formatting and keyword density")

    if not areas_to_improve and latest_resume.weaknesses:
        areas_to_improve = latest_resume.weaknesses[:3]

    if not areas_to_improve:
        areas_to_improve = ["Prepare for technical interviews and coding round challenges"]

    return {
        "indicator_title": "Placement Readiness Indicator",
        "disclaimer": "This score is an automated preparation indicator to guide your learning and practice. It is not an objective guarantee of employment.",
        "overall_score": overall_score,
        "breakdown": {
            "resume": round(resume_score, 1),
            "technical_skills": round(technical_skills_score, 1),
            "projects": round(projects_score, 1),
            "experience": round(experience_score, 1),
            "education": round(education_score, 1),
            "ats_quality": round(ats_quality_score, 1)
        },
        "strengths": strengths[:4],
        "areas_to_improve": areas_to_improve[:4]
    }


# Weight of each signal in the final score. Signals with no data yet are dropped and the
# remaining weights are renormalised, so a student with only a resume keeps the baseline score.
ACTIVITY_WEIGHTS = {
    "baseline": 0.40,    # resume + profile
    "assessment": 0.25,  # latest RoleReady self-assessment
    "interview": 0.10,   # mock interviews average
    "practice": 0.10,    # practice questions solved
    "roadmap": 0.10,     # roadmap tasks completed
    "simulation": 0.05,  # placement simulation overall
}


def _portfolio_projects_score(profile: models.StudentProfile) -> Optional[float]:
    db = object_session(profile)
    if db is None:
        return None
    rows = db.query(models.StudentProject.completeness_score).filter(
        models.StudentProject.student_profile_id == profile.id
    ).all()
    if not rows:
        return None
    avg = sum(float(r[0] or 0.0) for r in rows) / len(rows)
    return min(100.0, max(20.0, avg + min(len(rows), 3) * 5.0))


def _gather_activity_scores(profile: models.StudentProfile) -> Dict[str, float]:
    """Real 0-100 scores for each activity the student has actually done. Missing = not returned."""
    db = object_session(profile)
    if db is None:
        return {}
    scores: Dict[str, float] = {}

    session = db.query(models.RoleReadySession).filter(
        models.RoleReadySession.student_profile_id == profile.id,
        models.RoleReadySession.current_state == models.RoleReadySessionState.COMPLETED
    ).order_by(models.RoleReadySession.completed_at.desc()).first()
    if session is not None:
        scores["assessment"] = float(session.overall_readiness_score or 0.0)

    interviews = db.query(models.StudentMockInterview.overall_score).filter(
        models.StudentMockInterview.student_profile_id == profile.id,
        models.StudentMockInterview.status == "COMPLETED"
    ).all()
    if interviews:
        scores["interview"] = sum(float(i[0] or 0.0) for i in interviews) / len(interviews)

    solved = db.query(models.StudentPracticeAttempt).filter(
        models.StudentPracticeAttempt.student_profile_id == profile.id,
        models.StudentPracticeAttempt.is_correct == True  # noqa: E712
    ).count()
    if solved:
        scores["practice"] = min(100.0, solved * 5.0)  # 20 correct answers = full marks

    total_tasks = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.student_profile_id == profile.id
    ).count()
    if total_tasks:
        done = db.query(models.StudentDailyTask).filter(
            models.StudentDailyTask.student_profile_id == profile.id,
            models.StudentDailyTask.status == "COMPLETED"
        ).count()
        scores["roadmap"] = done / total_tasks * 100.0

    sim = db.query(models.StudentPlacementSimulation).filter(
        models.StudentPlacementSimulation.student_profile_id == profile.id,
        models.StudentPlacementSimulation.status == "COMPLETED"
    ).order_by(models.StudentPlacementSimulation.completed_at.desc()).first()
    if sim is not None:
        scores["simulation"] = float(sim.overall_score or 0.0)

    return scores


def calculate_placement_readiness(
    profile: models.StudentProfile,
    latest_resume: Optional[models.StudentResume] = None
) -> Dict[str, Any]:
    """
    Placement Readiness Indicator: the resume/profile baseline blended with the student's real
    activity (assessments, mock interviews, practice, roadmap, simulation). Every caller gets the
    blended score, so the dashboard, college views and drive eligibility stay consistent.
    Does not present as an objective guarantee of placement.
    """
    result = _resume_profile_readiness(profile, latest_resume)
    activity = _gather_activity_scores(profile)
    if not activity:
        return result

    weights = {"baseline": ACTIVITY_WEIGHTS["baseline"], **{k: ACTIVITY_WEIGHTS[k] for k in activity}}
    total_weight = sum(weights.values())
    blended = result["overall_score"] * weights["baseline"] + sum(activity[k] * weights[k] for k in activity)
    result["overall_score"] = round(min(100.0, max(10.0, blended / total_weight)), 1)
    result["breakdown"] = {**result["breakdown"], **{k: round(v, 1) for k, v in activity.items()}}

    labels = {
        "assessment": "Complete a RoleReady assessment and review the report to lift this score",
        "interview": "Practise mock interviews using the STAR format",
        "practice": "Solve more practice questions to build speed and accuracy",
        "roadmap": "Finish your daily roadmap tasks to keep momentum",
        "simulation": "Retake the placement simulation after revising weak rounds",
    }
    weak = [labels[k] for k, v in sorted(activity.items(), key=lambda kv: kv[1]) if v < 60.0][:2]
    result["areas_to_improve"] = (weak + result["areas_to_improve"])[:4]
    return result


def refresh_profile_readiness(db, profile: Optional[models.StudentProfile]) -> None:
    """Recomputes and stores the profile's readiness after real activity. Never raises."""
    if profile is None:
        return
    try:
        latest_resume = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == profile.id
        ).order_by(models.StudentResume.version.desc()).first()
        readiness = calculate_placement_readiness(profile, latest_resume)
        profile.readiness_score = readiness["overall_score"]
        profile.readiness_breakdown = readiness["breakdown"]
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[Readiness] refresh skipped: {e}")
