"""
Student Onboarding & Guided Career Intake Service — Phase 10
Handles progressive onboarding steps, diagnostic career intake,
and baseline readiness initialization.
"""

from typing import Dict, Any, List
from sqlalchemy.orm import Session
import models
from services.readiness_service import calculate_placement_readiness


def get_student_onboarding_status(profile: models.StudentProfile, db: Session) -> Dict[str, Any]:
    """
    Returns the onboarding completion state, diagnostic progress,
    and guided step recommendation for the student.
    """
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).first()
    has_resume = latest_resume is not None

    completed_steps = []
    # Step 1: Target Role
    if profile.target_role and profile.target_role.strip():
        completed_steps.append(1)

    # Step 2: Academics (Branch and Graduation Year)
    if profile.branch and profile.graduation_year:
        completed_steps.append(2)

    # Step 3: Technical Skills
    if profile.current_skills and len(profile.current_skills) > 0:
        completed_steps.append(3)

    # Step 4: Resume or Final confirmation
    if has_resume or profile.is_onboarded:
        completed_steps.append(4)

    recommended_action = "Complete the 4-step Career Onboarding Wizard to personalize your roadmap, benchmark gaps, and drive eligibility."
    if profile.is_onboarded:
        if not has_resume:
            recommended_action = "Upload your resume to activate 9-dimension ATS scoring and placement simulation."
        else:
            recommended_action = "Your onboarding is complete. Explore campus placement drives and daily practice tasks."

    return {
        "is_onboarded": profile.is_onboarded,
        "onboarding_step": profile.onboarding_step,
        "has_resume": has_resume,
        "target_role": profile.target_role,
        "target_company": profile.target_company,
        "branch": profile.branch,
        "graduation_year": profile.graduation_year,
        "cgpa": profile.cgpa,
        "skills_count": len(profile.current_skills or []),
        "completed_steps": completed_steps,
        "recommended_action": recommended_action
    }


def process_onboarding_step(
    profile: models.StudentProfile,
    step_data: Dict[str, Any],
    db: Session
) -> models.StudentProfile:
    """
    Progressively persists student responses during the onboarding flow.
    """
    step = step_data.get("step", 1)

    if step_data.get("target_role"):
        profile.target_role = step_data["target_role"].strip()
    if step_data.get("target_company") is not None:
        profile.target_company = step_data["target_company"].strip()
    if step_data.get("college_name"):
        profile.college_name = step_data["college_name"].strip()
    if step_data.get("branch"):
        profile.branch = step_data["branch"].strip()
    if step_data.get("graduation_year") is not None:
        profile.graduation_year = step_data["graduation_year"]
    if step_data.get("cgpa") is not None:
        profile.cgpa = step_data["cgpa"]
    if step_data.get("current_skills") is not None:
        profile.current_skills = list(dict.fromkeys(step_data["current_skills"]))

    # Advance step tracker
    profile.onboarding_step = max(profile.onboarding_step, min(step + 1, 4))

    # Recalculate baseline readiness
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    readiness = calculate_placement_readiness(profile, latest_resume)
    profile.readiness_score = readiness["overall_score"]
    profile.readiness_breakdown = readiness["breakdown"]

    db.commit()
    db.refresh(profile)
    return profile


def finalize_onboarding(
    profile: models.StudentProfile,
    complete_data: Dict[str, Any],
    db: Session
) -> models.StudentProfile:
    """
    Marks the student onboarding as complete and calculates full readiness baseline.
    """
    if complete_data.get("target_role"):
        profile.target_role = complete_data["target_role"].strip()
    if complete_data.get("target_company") is not None:
        profile.target_company = complete_data["target_company"].strip()
    if complete_data.get("college_name"):
        profile.college_name = complete_data["college_name"].strip()
    if complete_data.get("branch"):
        profile.branch = complete_data["branch"].strip()
    if complete_data.get("graduation_year") is not None:
        profile.graduation_year = complete_data["graduation_year"]
    if complete_data.get("cgpa") is not None:
        profile.cgpa = complete_data["cgpa"]
    if complete_data.get("current_skills") is not None:
        profile.current_skills = list(dict.fromkeys(complete_data["current_skills"]))

    profile.is_onboarded = True
    profile.onboarding_step = 4

    # Recalculate baseline readiness
    latest_resume = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    readiness = calculate_placement_readiness(profile, latest_resume)
    profile.readiness_score = readiness["overall_score"]
    profile.readiness_breakdown = readiness["breakdown"]

    db.commit()
    db.refresh(profile)
    return profile
