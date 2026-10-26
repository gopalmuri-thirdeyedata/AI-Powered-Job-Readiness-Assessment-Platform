"""
College Placement Officer & Campus Drives API Router — Phase 9
Provides cohort-level intelligence, student readiness roster,
and placement drive management with strict multi-tenant organization isolation.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

import models
import database
import schemas
from routers.auth import get_current_user
from services import college_service

router = APIRouter(
    prefix="/api/college",
    tags=["college"]
)


def get_current_college_admin(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.User:
    """
    Enforces authorization for college placement officers and administrators.
    Rejects students, candidates, and users without an active college organization.
    """
    if not models.is_admin_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Students are not authorized to access college administrative resources."
        )

    # Resolve organization_id
    org_id = current_user.organization_id
    if not org_id:
        member = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.user_id == current_user.id,
            models.OrganizationMember.status == "active"
        ).first()
        if member:
            org_id = member.organization_id

    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active college organization membership required."
        )

    org = db.query(models.Organization).filter(models.Organization.id == org_id).first()
    if not org or org.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your college organization is inactive or suspended."
        )

    # Attach verified org_id to current_user
    current_user.organization_id = org_id
    return current_user


# ==============================================================================
# 1. COHORT ANALYTICS & OVERVIEW
# ==============================================================================

@router.get("/overview", response_model=schemas.CollegeCohortOverviewResponse)
def get_college_overview(
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Returns aggregated cohort intelligence:
    - Average readiness score across enrolled students
    - Readiness tiers (High >= 75%, Moderate 50-74%, At-Risk < 50%)
    - Top student skills and common curriculum/readiness gaps
    - Placement drives and active hiring metrics
    """
    return college_service.get_cohort_overview(
        organization_id=admin_user.organization_id,
        db=db
    )


# ==============================================================================
# 2. STUDENT ROSTER & MONITORING
# ==============================================================================

@router.get("/students", response_model=List[schemas.CollegeStudentListItemResponse])
def get_college_students(
    search: Optional[str] = Query(None, description="Search by name, email, or target role"),
    branch: Optional[str] = Query(None, description="Filter by branch"),
    min_readiness: Optional[float] = Query(None, description="Minimum readiness score"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Returns the student roster for the college with readiness scores,
    resume status, CGPA, and drive application counts.
    Strictly scoped to the officer's college organization.
    """
    return college_service.get_cohort_students(
        organization_id=admin_user.organization_id,
        db=db,
        search=search,
        branch=branch,
        min_readiness=min_readiness,
        limit=limit,
        offset=offset
    )


# ==============================================================================
# 3. PLACEMENT DRIVES MANAGEMENT
# ==============================================================================

@router.get("/drives", response_model=List[schemas.PlacementDriveResponse])
def list_college_placement_drives(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by OPEN, CLOSED, or COMPLETED"),
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Lists on-campus placement drives organized by the college.
    """
    return college_service.list_placement_drives(
        organization_id=admin_user.organization_id,
        db=db,
        status_filter=status_filter
    )


@router.post("/drives", response_model=schemas.PlacementDriveResponse, status_code=status.HTTP_201_CREATED)
def create_college_placement_drive(
    payload: schemas.PlacementDriveCreateRequest,
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Creates a new campus recruitment drive with eligibility criteria (minimum CGPA, skills, package).
    """
    drive = college_service.create_placement_drive(
        organization_id=admin_user.organization_id,
        drive_data=payload.dict(),
        db=db
    )
    return schemas.PlacementDriveResponse(
        id=drive.id,
        organization_id=drive.organization_id,
        company_name=drive.company_name,
        role_title=drive.role_title,
        description=drive.description,
        eligibility_criteria=drive.eligibility_criteria,
        minimum_cgpa=drive.minimum_cgpa,
        required_skills=drive.required_skills or [],
        package_lpa=drive.package_lpa,
        application_deadline=drive.application_deadline,
        status=drive.status,
        created_at=drive.created_at,
        updated_at=drive.updated_at,
        applicant_count=0
    )


@router.get("/drives/{drive_id}", response_model=schemas.PlacementDriveResponse)
def get_college_placement_drive(
    drive_id: int,
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Retrieves full details of a specific placement drive.
    Tenant-isolated: Returns 404 if drive does not belong to the college.
    """
    drive = college_service.get_placement_drive_detail(
        organization_id=admin_user.organization_id,
        drive_id=drive_id,
        db=db
    )
    if not drive:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Placement drive not found in your college organization."
        )

    applicant_count = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.drive_id == drive.id
    ).count()

    return schemas.PlacementDriveResponse(
        id=drive.id,
        organization_id=drive.organization_id,
        company_name=drive.company_name,
        role_title=drive.role_title,
        description=drive.description,
        eligibility_criteria=drive.eligibility_criteria,
        minimum_cgpa=drive.minimum_cgpa,
        required_skills=drive.required_skills or [],
        package_lpa=drive.package_lpa,
        application_deadline=drive.application_deadline,
        status=drive.status,
        created_at=drive.created_at,
        updated_at=drive.updated_at,
        applicant_count=applicant_count
    )


@router.put("/drives/{drive_id}", response_model=schemas.PlacementDriveResponse)
def update_college_placement_drive(
    drive_id: int,
    payload: schemas.PlacementDriveUpdateRequest,
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Updates details or status of a placement drive.
    """
    drive = college_service.update_placement_drive(
        organization_id=admin_user.organization_id,
        drive_id=drive_id,
        update_data=payload.dict(exclude_unset=True),
        db=db
    )
    if not drive:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Placement drive not found in your college organization."
        )

    applicant_count = db.query(models.PlacementDriveApplication).filter(
        models.PlacementDriveApplication.drive_id == drive.id
    ).count()

    return schemas.PlacementDriveResponse(
        id=drive.id,
        organization_id=drive.organization_id,
        company_name=drive.company_name,
        role_title=drive.role_title,
        description=drive.description,
        eligibility_criteria=drive.eligibility_criteria,
        minimum_cgpa=drive.minimum_cgpa,
        required_skills=drive.required_skills or [],
        package_lpa=drive.package_lpa,
        application_deadline=drive.application_deadline,
        status=drive.status,
        created_at=drive.created_at,
        updated_at=drive.updated_at,
        applicant_count=applicant_count
    )


# ==============================================================================
# 4. DRIVE APPLICATIONS & APPLICANT STATUS
# ==============================================================================

@router.get("/drives/{drive_id}/applications", response_model=List[schemas.DriveApplicationResponse])
def get_drive_applications(
    drive_id: int,
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Lists all candidate submissions for a specific placement drive with student details.
    """
    # Verify drive exists in this org
    drive = college_service.get_placement_drive_detail(
        organization_id=admin_user.organization_id,
        drive_id=drive_id,
        db=db
    )
    if not drive:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Placement drive not found in your college organization."
        )

    return college_service.get_drive_applications(
        organization_id=admin_user.organization_id,
        drive_id=drive_id,
        db=db
    )


@router.patch("/applications/{application_id}/status", response_model=schemas.DriveApplicationResponse)
def update_drive_application_status(
    application_id: int,
    payload: schemas.DriveApplicationStatusUpdateRequest,
    admin_user: models.User = Depends(get_current_college_admin),
    db: Session = Depends(database.get_db)
):
    """
    Updates the candidate placement status (e.g. APPLIED, SHORTLISTED, REJECTED, PLACED).
    """
    valid_statuses = {"APPLIED", "SHORTLISTED", "REJECTED", "PLACED"}
    if payload.status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status '{payload.status}'. Must be one of: {', '.join(valid_statuses)}"
        )

    updated_app = college_service.update_application_status(
        organization_id=admin_user.organization_id,
        application_id=application_id,
        status=payload.status,
        notes=payload.notes,
        db=db
    )

    if not updated_app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Placement application not found in your college organization."
        )

    student = updated_app.student_profile
    drive = updated_app.drive

    return schemas.DriveApplicationResponse(
        id=updated_app.id,
        drive_id=updated_app.drive_id,
        student_profile_id=updated_app.student_profile_id,
        organization_id=updated_app.organization_id,
        status=updated_app.status,
        notes=updated_app.notes,
        applied_at=updated_app.applied_at,
        student_name=student.full_name if student else "Unknown",
        student_email=student.email if student else "Unknown",
        student_branch=student.branch if student else None,
        student_cgpa=student.cgpa if student else None,
        student_readiness_score=student.readiness_score if student else None,
        student_skills=student.current_skills if student else [],
        company_name=drive.company_name if drive else None,
        role_title=drive.role_title if drive else None
    )
