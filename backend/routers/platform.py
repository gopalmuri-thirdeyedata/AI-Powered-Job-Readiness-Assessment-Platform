from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from pydantic import BaseModel, EmailStr
import re

import models
import database
from routers.auth import require_platform_admin
from services import clerk_service
from routers.settings import DEFAULT_CONFIG

router = APIRouter(
    prefix="/api/platform",
    tags=["platform"]
)

class CreateOrganizationSchema(BaseModel):
    name: str
    admin_email: EmailStr

class UpdateOrganizationStatusSchema(BaseModel):
    status: str # 'active' or 'deactivated'

def slugify(text: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9\s-]', '', text).strip().lower()
    return re.sub(r'[\s_-]+', '-', cleaned)

@router.get("/organizations")
def list_organizations(
    db: Session = Depends(database.get_db),
    admin_user: models.User = Depends(require_platform_admin)
):
    """
    Platform Admin: Lists all customer organizations with statistics.
    """
    orgs = db.query(models.Organization).order_by(models.Organization.id.desc()).all()
    results = []
    for org in orgs:
        # Find org admin
        admin_member = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.organization_id == org.id,
            models.OrganizationMember.role == "ORGANIZATION_ADMIN"
        ).first()
        admin_email = admin_member.user.email if admin_member and admin_member.user else "N/A"

        member_count = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.organization_id == org.id
        ).count()

        candidate_count = db.query(models.Candidate).filter(
            models.Candidate.organization_id == org.id
        ).count()

        results.append({
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "status": org.status,
            "admin_email": admin_email,
            "member_count": member_count,
            "candidate_count": candidate_count,
            "clerk_org_id": org.clerk_org_id,
            "created_at": org.created_at.isoformat() if org.created_at else None,
            "updated_at": org.updated_at.isoformat() if org.updated_at else None
        })
    return results

@router.post("/organizations")
def create_organization(
    payload: CreateOrganizationSchema,
    db: Session = Depends(database.get_db),
    admin_user: models.User = Depends(require_platform_admin)
):
    """
    Platform Admin: Creates a new customer organization and provisions the first Organization Admin.
    """
    org_name = payload.name.strip()
    admin_email = payload.admin_email.strip().lower()

    if not org_name:
        raise HTTPException(status_code=400, detail="Organization name is required.")

    # Generate slug and ensure uniqueness
    base_slug = slugify(org_name) or "org"
    slug = base_slug
    counter = 1
    while db.query(models.Organization).filter(models.Organization.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1

    # Attempt to provision in Clerk if configured
    clerk_org = clerk_service.create_clerk_organization(org_name, slug)
    clerk_org_id = clerk_org.get("id") if clerk_org else None

    # Create local organization
    org = models.Organization(
        name=org_name,
        slug=slug,
        clerk_org_id=clerk_org_id,
        status="active"
    )
    db.add(org)
    db.commit()
    db.refresh(org)

    # Provision or update Organization Admin user
    import utils
    target_user = db.query(models.User).filter(func.lower(models.User.email) == admin_email).first()
    if not target_user:
        target_user = models.User(
            email=admin_email,
            role=models.UserRole.ORGANIZATION_ADMIN,
            hashed_password=utils.get_password_hash("clerk_managed_user"),
            is_active=True,
            organization_id=org.id
        )
        db.add(target_user)
        db.commit()
        db.refresh(target_user)
    else:
        target_user.organization_id = org.id
        if target_user.role != models.UserRole.PLATFORM_ADMIN:
            target_user.role = models.UserRole.ORGANIZATION_ADMIN
        db.commit()

    # Assign membership
    member = models.OrganizationMember(
        organization_id=org.id,
        user_id=target_user.id,
        role="ORGANIZATION_ADMIN",
        status="active"
    )
    db.add(member)

    # Initialize Organization GlobalSettings
    org_settings = models.GlobalSettings(
        key=f"org_{org.id}",
        config=DEFAULT_CONFIG,
        created_by=target_user.id,
        organization_id=org.id
    )
    db.add(org_settings)
    db.commit()

    # Dispatch Clerk Invitation if configured
    invite_status = "invited"
    if clerk_org_id:
        clerk_inv = clerk_service.invite_to_clerk_organization(clerk_org_id, admin_email, role="org:admin")
        if not clerk_inv:
            clerk_service.create_clerk_invitation(admin_email)
    else:
        clerk_service.create_clerk_invitation(admin_email)

    return {
        "message": f"Organization '{org.name}' created successfully.",
        "organization": {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "status": org.status,
            "admin_email": admin_email,
            "invitation_status": invite_status
        }
    }

@router.get("/organizations/{org_id}")
def get_organization_detail(
    org_id: int,
    db: Session = Depends(database.get_db),
    admin_user: models.User = Depends(require_platform_admin)
):
    """
    Platform Admin: Get detailed metadata for a specific organization.
    """
    org = db.query(models.Organization).filter(models.Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")

    members = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.organization_id == org.id
    ).all()

    candidates_count = db.query(models.Candidate).filter(
        models.Candidate.organization_id == org.id
    ).count()

    jobs_count = db.query(models.JobDescription).filter(
        models.JobDescription.organization_id == org.id
    ).count()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "clerk_org_id": org.clerk_org_id,
        "created_at": org.created_at.isoformat() if org.created_at else None,
        "metrics": {
            "members": len(members),
            "candidates": candidates_count,
            "jobs": jobs_count
        },
        "members": [
            {
                "id": m.id,
                "user_id": m.user_id,
                "email": m.user.email if m.user else "N/A",
                "role": m.role,
                "status": m.status,
                "created_at": m.created_at.isoformat() if m.created_at else None
            }
            for m in members
        ]
    }

@router.patch("/organizations/{org_id}")
def update_organization_status(
    org_id: int,
    payload: UpdateOrganizationStatusSchema,
    db: Session = Depends(database.get_db),
    admin_user: models.User = Depends(require_platform_admin)
):
    """
    Platform Admin: Activate or deactivate a customer organization.
    """
    status_val = payload.status.strip().lower()
    if status_val not in ("active", "deactivated"):
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'deactivated'.")

    org = db.query(models.Organization).filter(models.Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")

    org.status = status_val
    db.commit()
    return {"message": f"Organization status updated to '{status_val}'.", "status": org.status}

@router.get("/stats")
def get_platform_stats(
    db: Session = Depends(database.get_db),
    admin_user: models.User = Depends(require_platform_admin)
):
    """
    Platform Admin: Returns high-level platform analytics.
    """
    total_orgs = db.query(models.Organization).count()
    active_orgs = db.query(models.Organization).filter(models.Organization.status == "active").count()
    total_recruiters = db.query(models.User).filter(
        models.User.role.in_([models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR, models.UserRole.HR_ADMIN])
    ).count()
    total_candidates = db.query(models.Candidate).count()

    return {
        "total_organizations": total_orgs,
        "active_organizations": active_orgs,
        "total_recruiters": total_recruiters,
        "total_candidates": total_candidates
    }

@router.delete("/organizations/{org_id}/members/{member_id}")
def remove_organization_member_by_platform(
    org_id: int,
    member_id: int,
    db: Session = Depends(database.get_db),
    admin_user: models.User = Depends(require_platform_admin)
):
    """
    Platform Admin: Directly removes any member from an organization.
    """
    member = db.query(models.OrganizationMember).filter(
        (models.OrganizationMember.id == member_id) | (models.OrganizationMember.user_id == member_id),
        models.OrganizationMember.organization_id == org_id
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found in organization.")

    user = member.user
    db.delete(member)
    if user and user.role != models.UserRole.PLATFORM_ADMIN:
        user.organization_id = None
        user.is_active = False
    db.commit()
    return {"message": "Member removed successfully by platform admin."}
