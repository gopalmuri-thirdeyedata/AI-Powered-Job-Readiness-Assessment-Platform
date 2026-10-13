"""
Placement Readiness Scoring Service (Modular).
Calculates an initial 0–100 Placement Readiness Indicator using available student resume & profile data.
Designed to seamlessly incorporate DSA, Aptitude, Interview, Communication, and Practice dimensions in subsequent phases.
"""

from typing import Dict, Any, List, Optional
import models

def calculate_placement_readiness(
    profile: models.StudentProfile,
    latest_resume: Optional[models.StudentResume] = None
) -> Dict[str, Any]:
    """
    Computes a modular Placement Readiness Indicator score and detailed breakdown.
    Does not present as an objective guarantee of placement.
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
