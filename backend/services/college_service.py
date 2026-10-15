"""
College Placement Officer Service — Phase 9
Provides cohort readiness analytics, student roster monitoring,
and placement drive lifecycle management.
Strict multi-tenant organization scoping.
"""

from typing import List, Dict, Any, Optional
from collections import Counter
from sqlalchemy.orm import Session
from sqlalchemy import func

import models


def get_cohort_overview(organization_id: int, db: Session) -> Dict[str, Any]:
    """
    Computes aggregated cohort analytics for college placement officers:
    - Average readiness score across enrolled students
    - Readiness tiered breakdown (High >= 75, Moderate 50-74, At-Risk < 50)
    - Branch distribution
    - Top cohort technical skills & gaps
    - Drives & applications counts
    """
    students = db.query(models.StudentProfile).filter(
        models.StudentProfile.organization_id == organization_id
    ).all()

    total_students = len(students)
    if total_students == 0:
        avg_readiness = 0.0
        high_count = 0
        mod_count = 0
        risk_count = 0
        branch_dist = {}
        top_skills = []
        skill_gaps = []
    else:
        scores = [s.readiness_score for s in students]
        avg_readiness = round(sum(scores) / total_students, 1)
        high_count = sum(1 for s in scores if s >= 75)
        mod_count = sum(1 for s in scores if 50 <= s < 75)
        risk_count = sum(1 for s in scores if s < 50)

        # Branch distribution
        branches = [s.branch for s in students if s.branch]
        branch_dist = dict(Counter(branches))

        # Top skills
        all_skills = []
        for s in students:
            if s.current_skills:
                all_skills.extend([sk.strip() for sk in s.current_skills if sk and isinstance(sk, str)])
        skill_counts = Counter(all_skills)
        top_skills = [
            {"skill": skill, "count": count, "percentage": round((count / total_students) * 100, 1)}
            for skill, count in skill_counts.most_common(8)
        ]

        # Common skill gaps across target roles
        common_target_skills = {
            "Full Stack Developer": ["React", "Node.js", "Docker", "PostgreSQL", "System Design"],
            "Backend Engineer": ["Python", "FastAPI", "Redis", "Distributed Systems", "SQL"],
            "Frontend Engineer": ["TypeScript", "Next.js", "TailwindCSS", "Testing", "Web Performance"],
            "Data Engineer": ["Apache Spark", "Airflow", "Kafka", "Python", "SQL"]
        }
        gap_counter = Counter()
        for s in students:
            target = s.target_role or "Full Stack Developer"
            expected = common_target_skills.get(target, ["DSA", "System Design", "Cloud Computing"])
            student_skill_set = set([sk.lower() for sk in (s.current_skills or []) if isinstance(sk, str)])
            for req in expected:
                if req.lower() not in student_skill_set:
                    gap_counter[req] += 1

        skill_gaps = [
            {"skill": skill, "missing_students_count": count, "percentage": round((count / total_students) * 100, 1)}
            for skill, count in gap_counter.most_common(6)
        ]

    # Drives and placement metrics
    total_drives = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.organization_id == organization_id
    ).count()

    active_drives = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.organization_id == organization_id,
        models.PlacementDrive.status == "OPEN"
    ).count()

    total_applications = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.organization_id == organization_id
    ).count()

    total_placed = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.organization_id == organization_id,
        models.PlacementDriveApplication.status == "PLACED"
    ).count()

    return {
        "total_students": total_students,
        "average_readiness_score": avg_readiness,
        "high_readiness_count": high_count,
        "moderate_readiness_count": mod_count,
        "at_risk_count": risk_count,
        "total_drives": total_drives,
        "active_drives": active_drives,
        "total_applications": total_applications,
        "total_placed": total_placed,
        "top_cohort_skills": top_skills,
        "common_skill_gaps": skill_gaps,
        "branch_distribution": branch_dist
    }


def get_cohort_students(
    organization_id: int,
    db: Session,
    search: Optional[str] = None,
    branch: Optional[str] = None,
    min_readiness: Optional[float] = None,
    limit: int = 50,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """
    Returns list of students in the college organization with readiness and resume indicators.
    """
    query = db.query(models.StudentProfile).filter(
        models.StudentProfile.organization_id == organization_id
    )

    if branch:
        query = query.filter(models.StudentProfile.branch == branch)

    if min_readiness is not None:
        query = query.filter(models.StudentProfile.readiness_score >= min_readiness)

    if search:
        search_term = f"%{search.strip().lower()}%"
        query = query.filter(
            func.lower(models.StudentProfile.full_name).like(search_term) |
            func.lower(models.StudentProfile.email).like(search_term) |
            func.lower(models.StudentProfile.target_role).like(search_term)
        )

    students = query.order_by(models.StudentProfile.readiness_score.desc()).offset(offset).limit(limit).all()

    results = []
    for s in students:
        latest_resume = db.query(models.StudentResume).filter(
            models.StudentResume.student_profile_id == s.id
        ).order_by(models.StudentResume.version.desc()).first()

        app_count = db.query(models.PlacementDriveApplication).filter(
            models.PlacementDriveApplication.student_profile_id == s.id
        ).count()

        results.append({
            "id": s.id,
            "user_id": s.user_id,
            "organization_id": s.organization_id,
            "full_name": s.full_name,
            "email": s.email,
            "branch": s.branch,
            "graduation_year": s.graduation_year,
            "cgpa": s.cgpa,
            "target_role": s.target_role,
            "current_skills": s.current_skills or [],
            "readiness_score": s.readiness_score,
            "resume_score": latest_resume.overall_score if latest_resume else None,
            "has_resume": latest_resume is not None,
            "applications_count": app_count,
            "created_at": s.created_at
        })

    return results


def create_placement_drive(
    organization_id: int,
    drive_data: Dict[str, Any],
    db: Session
) -> models.PlacementDrive:
    """
    Creates an on-campus placement drive belonging to the college organization.
    """
    drive = models.PlacementDrive(
        organization_id=organization_id,
        company_name=drive_data["company_name"],
        role_title=drive_data["role_title"],
        description=drive_data["description"],
        eligibility_criteria=drive_data.get("eligibility_criteria"),
        minimum_cgpa=drive_data.get("minimum_cgpa", 0.0),
        required_skills=drive_data.get("required_skills", []),
        package_lpa=drive_data.get("package_lpa"),
        application_deadline=drive_data.get("application_deadline"),
        status=drive_data.get("status", "OPEN")
    )
    db.add(drive)
    db.commit()
    db.refresh(drive)
    return drive


def list_placement_drives(
    organization_id: int,
    db: Session,
    status_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Lists placement drives organized by the college along with applicant metrics.
    """
    query = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.organization_id == organization_id
    )

    if status_filter:
        query = query.filter(models.PlacementDrive.status == status_filter)

    drives = query.order_by(models.PlacementDrive.created_at.desc()).all()

    results = []
    for d in drives:
        applicant_count = db.query(models.PlacementDriveApplication).filter(
            models.PlacementDriveApplication.drive_id == d.id
        ).count()

        results.append({
            "id": d.id,
            "organization_id": d.organization_id,
            "company_name": d.company_name,
            "role_title": d.role_title,
            "description": d.description,
            "eligibility_criteria": d.eligibility_criteria,
            "minimum_cgpa": d.minimum_cgpa,
            "required_skills": d.required_skills or [],
            "package_lpa": d.package_lpa,
            "application_deadline": d.application_deadline,
            "status": d.status,
            "created_at": d.created_at,
            "updated_at": d.updated_at,
            "applicant_count": applicant_count
        })

    return results


def get_placement_drive_detail(
    organization_id: int,
    drive_id: int,
    db: Session
) -> Optional[models.PlacementDrive]:
    """
    Retrieves specific placement drive ensuring tenant ownership.
    """
    return db.query(models.PlacementDrive).filter(
        models.PlacementDrive.id == drive_id,
        models.PlacementDrive.organization_id == organization_id
    ).first()


def update_placement_drive(
    organization_id: int,
    drive_id: int,
    update_data: Dict[str, Any],
    db: Session
) -> Optional[models.PlacementDrive]:
    """
    Updates placement drive details.
    """
    drive = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.id == drive_id,
        models.PlacementDrive.organization_id == organization_id
    ).first()

    if not drive:
        return None

    for key, val in update_data.items():
        if val is not None and hasattr(drive, key):
            setattr(drive, key, val)

    db.commit()
    db.refresh(drive)
    return drive


def get_drive_applications(
    organization_id: int,
    drive_id: int,
    db: Session
) -> List[Dict[str, Any]]:
    """
    Retrieves applicants for a specific placement drive with student details.
    """
    # Verify drive belongs to org
    drive = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.id == drive_id,
        models.PlacementDrive.organization_id == organization_id
    ).first()

    if not drive:
        return []

    applications = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.drive_id == drive_id,
        models.PlacementDriveApplication.organization_id == organization_id
    ).order_by(models.PlacementDriveApplication.applied_at.desc()).all()

    results = []
    for app in applications:
        student = app.student_profile
        results.append({
            "id": app.id,
            "drive_id": app.drive_id,
            "student_profile_id": app.student_profile_id,
            "organization_id": app.organization_id,
            "status": app.status,
            "notes": app.notes,
            "applied_at": app.applied_at,
            "student_name": student.full_name if student else "Unknown",
            "student_email": student.email if student else "Unknown",
            "student_branch": student.branch if student else None,
            "student_cgpa": student.cgpa if student else None,
            "student_readiness_score": student.readiness_score if student else None,
            "student_skills": student.current_skills if student else [],
            "company_name": drive.company_name,
            "role_title": drive.role_title
        })

    return results


def update_application_status(
    organization_id: int,
    application_id: int,
    status: str,
    notes: Optional[str],
    db: Session
) -> Optional[models.PlacementDriveApplication]:
    """
    Updates applicant drive status (e.g., APPLIED -> SHORTLISTED -> PLACED).
    """
    app = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.id == application_id,
        models.PlacementDriveApplication.organization_id == organization_id
    ).first()

    if not app:
        return None

    app.status = status
    if notes is not None:
        app.notes = notes

    db.commit()
    db.refresh(app)
    return app


def apply_student_to_drive(
    student_profile: models.StudentProfile,
    drive_id: int,
    notes: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """
    Registers a student's application to a college placement drive.
    Validates eligibility (minimum CGPA) and checks for duplicate submission.
    """
    drive = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.id == drive_id,
        models.PlacementDrive.organization_id == student_profile.organization_id
    ).first()

    if not drive:
        raise ValueError("Placement drive not found in your college.")

    if drive.status != "OPEN":
        raise ValueError("This placement drive is not open for applications.")

    # Validate CGPA eligibility if specified
    if drive.minimum_cgpa > 0.0 and student_profile.cgpa is not None:
        if student_profile.cgpa < drive.minimum_cgpa:
            raise ValueError(
                f"Your CGPA ({student_profile.cgpa}) does not meet the minimum eligibility requirement of {drive.minimum_cgpa}."
            )

    # Check for existing application
    existing = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.drive_id == drive_id,
        models.PlacementDriveApplication.student_profile_id == student_profile.id
    ).first()

    if existing:
        raise ValueError("You have already submitted an application to this placement drive.")

    application = models.PlacementDriveApplication(
        drive_id=drive.id,
        student_profile_id=student_profile.id,
        organization_id=student_profile.organization_id,
        status="APPLIED",
        notes=notes
    )
    db.add(application)
    db.commit()
    db.refresh(application)

    return {
        "id": application.id,
        "drive_id": drive.id,
        "student_profile_id": student_profile.id,
        "organization_id": student_profile.organization_id,
        "status": application.status,
        "notes": application.notes,
        "applied_at": application.applied_at,
        "company_name": drive.company_name,
        "role_title": drive.role_title
    }


def get_student_available_drives(
    student_profile: models.StudentProfile,
    db: Session
) -> List[Dict[str, Any]]:
    """
    Lists all placement drives available to the student from their college,
    annotating eligibility and current application status.
    """
    drives = db.query(models.PlacementDrive).filter(
        models.PlacementDrive.organization_id == student_profile.organization_id
    ).order_by(models.PlacementDrive.created_at.desc()).all()

    # Get student's current applied drive IDs
    applied_map = {
        app.drive_id: app.status
        for app in db.query(models.PlacementDriveApplication).filter(
            models.PlacementDriveApplication.student_profile_id == student_profile.id
        ).all()
    }

    results = []
    for d in drives:
        is_eligible = True
        if d.minimum_cgpa > 0.0 and student_profile.cgpa is not None:
            is_eligible = student_profile.cgpa >= d.minimum_cgpa

        has_applied = d.id in applied_map

        results.append({
            "id": d.id,
            "organization_id": d.organization_id,
            "company_name": d.company_name,
            "role_title": d.role_title,
            "description": d.description,
            "eligibility_criteria": d.eligibility_criteria,
            "minimum_cgpa": d.minimum_cgpa,
            "required_skills": d.required_skills or [],
            "package_lpa": d.package_lpa,
            "application_deadline": d.application_deadline,
            "status": d.status,
            "created_at": d.created_at,
            "updated_at": d.updated_at,
            "is_eligible": is_eligible,
            "has_applied": has_applied,
            "application_status": applied_map.get(d.id)
        })

    return results
