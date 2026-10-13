from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
import os

import models
import database
import utils
from routers.auth import get_current_user, get_current_tenant, require_organization_admin, require_hr_or_admin
from services import clerk_service

router = APIRouter(
    prefix="/api/organization",
    tags=["organization"]
)

class InviteUserSchema(BaseModel):
    email: EmailStr
    role: Optional[str] = "HR" # 'HR' or 'ORGANIZATION_ADMIN'

class UpdateMemberSchema(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None # 'active', 'deactivated'

@router.get("/")
def get_current_organization_info(
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Get metadata for the currently authenticated organization.
    """
    if not current_tenant:
        raise HTTPException(status_code=404, detail="No active organization context found.")

    member_count = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.organization_id == current_tenant.id
    ).count()

    return {
        "id": current_tenant.id,
        "name": current_tenant.name,
        "slug": current_tenant.slug,
        "status": current_tenant.status,
        "member_count": member_count,
        "created_at": current_tenant.created_at.isoformat() if current_tenant.created_at else None
    }

@router.get("/users")
def list_organization_users(
    current_user: models.User = Depends(require_hr_or_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    List all team members belonging to the current organization.
    """
    if not current_tenant:
        raise HTTPException(status_code=404, detail="No active organization context found.")

    members = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.organization_id == current_tenant.id
    ).order_by(models.OrganizationMember.id.asc()).all()

    return [
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

@router.post("/users/invite")
def invite_organization_user(
    payload: InviteUserSchema,
    current_user: models.User = Depends(require_organization_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Organization Admin: Invites an HR or Admin user to the organization.
    """
    if not current_tenant:
        raise HTTPException(status_code=404, detail="No active organization context found.")

    email = payload.email.strip().lower()
    target_role = (payload.role or "HR").upper()

    if target_role not in ("HR", "ORGANIZATION_ADMIN", "STUDENT"):
        raise HTTPException(status_code=400, detail="Role must be 'HR', 'ORGANIZATION_ADMIN', or 'STUDENT'.")

    # Prevent inviting as Platform Admin
    platform_admin_email = os.getenv("PLATFORM_ADMIN_EMAIL", "gopalmuri1919@gmail.com").strip().lower()
    if email == platform_admin_email or email == "admin@hiringai.com":
        raise HTTPException(status_code=400, detail="Cannot invite Platform Admin account into an organization.")

    # Check if user already exists as a member in this organization
    existing_member = db.query(models.OrganizationMember).join(
        models.User, models.OrganizationMember.user_id == models.User.id
    ).filter(
        models.OrganizationMember.organization_id == current_tenant.id,
        func.lower(models.User.email) == email
    ).first()

    if existing_member:
        raise HTTPException(status_code=400, detail="User is already a member of this organization.")

    # Find or create target User record
    target_user = db.query(models.User).filter(func.lower(models.User.email) == email).first()
    if not target_user:
        target_user = models.User(
            email=email,
            role=target_role,
            hashed_password=utils.get_password_hash("clerk_managed_user"),
            is_active=True,
            organization_id=current_tenant.id
        )
        db.add(target_user)
        db.commit()
        db.refresh(target_user)
    else:
        target_user.organization_id = current_tenant.id
        target_user.role = target_role
        db.commit()

    # Add organization membership
    new_member = models.OrganizationMember(
        organization_id=current_tenant.id,
        user_id=target_user.id,
        role=target_role,
        status="pending" if target_role == "STUDENT" else "active"
    )
    db.add(new_member)

    # Pre-provision StudentProfile if inviting student
    if target_role == "STUDENT":
        student_prof = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == target_user.id).first()
        if not student_prof:
            student_prof = models.StudentProfile(
                user_id=target_user.id,
                organization_id=current_tenant.id,
                full_name=email.split('@')[0].replace('.', ' ').title(),
                email=email,
                target_role="Software Engineer"
            )
            db.add(student_prof)

    db.commit()
    db.refresh(new_member)

    # Dispatch Clerk invitation if configured
    clerk_role = "org:admin" if target_role == "ORGANIZATION_ADMIN" else "org:member"
    if current_tenant.clerk_org_id:
        clerk_service.invite_to_clerk_organization(current_tenant.clerk_org_id, email, role=clerk_role)
    else:
        clerk_service.create_clerk_invitation(email)

    return {
        "message": f"Invitation sent to '{email}'.",
        "member": {
            "id": new_member.id,
            "user_id": target_user.id,
            "email": target_user.email,
            "role": new_member.role,
            "status": new_member.status
        }
    }

@router.patch("/users/{member_id}")
def update_organization_member(
    member_id: int,
    payload: UpdateMemberSchema,
    current_user: models.User = Depends(require_organization_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Organization Admin: Updates an existing team member's role or status.
    Strictly tenant-scoped.
    """
    if not current_tenant:
        raise HTTPException(status_code=404, detail="No active organization context found.")

    member = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.id == member_id,
        models.OrganizationMember.organization_id == current_tenant.id
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found in your organization.")

    # Prevent modifying self away from admin if last admin
    if member.user_id == current_user.id and payload.role == "HR":
        admin_count = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.organization_id == current_tenant.id,
            models.OrganizationMember.role == "ORGANIZATION_ADMIN",
            models.OrganizationMember.status == "active"
        ).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the sole active Organization Admin.")

    if payload.role:
        new_role = payload.role.upper()
        if new_role not in ("HR", "ORGANIZATION_ADMIN"):
            raise HTTPException(status_code=400, detail="Role must be 'HR' or 'ORGANIZATION_ADMIN'.")
        member.role = new_role
        if member.user:
            member.user.role = new_role

    if payload.status:
        new_status = payload.status.lower()
        if new_status not in ("active", "deactivated"):
            raise HTTPException(status_code=400, detail="Status must be 'active' or 'deactivated'.")
        member.status = new_status
        if member.user and new_status == "deactivated":
            member.user.is_active = False

    db.commit()
    return {
        "message": "Member updated successfully.",
        "member": {
            "id": member.id,
            "email": member.user.email if member.user else "N/A",
            "role": member.role,
            "status": member.status
        }
    }

@router.delete("/users/{member_id}")
def remove_organization_member(
    member_id: int,
    current_user: models.User = Depends(require_organization_admin),
    current_tenant: Optional[models.Organization] = Depends(get_current_tenant),
    db: Session = Depends(database.get_db)
):
    """
    Organization Admin / Platform Admin: Removes a user from the organization.
    Strictly tenant-scoped.
    """
    if not current_tenant:
        raise HTTPException(status_code=404, detail="No active organization context found.")

    member = db.query(models.OrganizationMember).filter(
        (models.OrganizationMember.id == member_id) | (models.OrganizationMember.user_id == member_id),
        models.OrganizationMember.organization_id == current_tenant.id
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found in your organization.")

    if member.user_id == current_user.id and current_user.role != models.UserRole.PLATFORM_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from your organization.")

    user_to_remove = member.user
    db.delete(member)
    if user_to_remove and user_to_remove.role != models.UserRole.PLATFORM_ADMIN:
        user_to_remove.organization_id = None
        user_to_remove.is_active = False
    db.commit()
    return {"message": "Member removed successfully from organization."}
