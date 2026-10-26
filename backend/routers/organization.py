from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from pydantic import BaseModel, EmailStr
from typing import Optional
import os

import models
import database
import utils
from routers.auth import get_current_tenant, require_organization_admin, require_hr_or_admin
from services import local_auth

router = APIRouter(
    prefix="/api/organization",
    tags=["organization"]
)

class InviteUserSchema(BaseModel):
    email: EmailStr
    role: Optional[str] = "HR" # 'HR' or 'ORGANIZATION_ADMIN'
    # Optional initial password. Without one the account cannot sign in until an administrator sets a password.
    password: Optional[str] = None

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
    raw_role = (payload.role or "ADMIN").upper()
    if payload.password is not None:
        problems = local_auth.password_policy_errors(payload.password, email)
        if problems:
            raise HTTPException(status_code=422, detail=problems)

    if raw_role in ("HR", "ORGANIZATION_ADMIN", "ADMIN"):
        target_role = "ADMIN"
    elif raw_role == "STUDENT":
        target_role = "STUDENT"
    else:
        raise HTTPException(status_code=400, detail="Role must be 'ADMIN' or 'STUDENT'.")

    # Role hierarchy (server-side): only a Super Admin can add administrators; an Admin can only add Students.
    if target_role == "ADMIN" and not models.is_super_admin_role(current_user.role):
        raise HTTPException(status_code=403, detail="Only a Super Admin can add Admin accounts.")

    # Prevent inviting seed platform admin accounts into a tenant
    platform_admin_email = os.getenv("PLATFORM_ADMIN_EMAIL", "admin@thirdeyedata.ai").strip().lower()
    if email in (platform_admin_email, "admin@hiringai.com", "admin@thirdeyedata.ai"):
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
            hashed_password=(utils.get_password_hash(payload.password) if payload.password else utils.make_unusable_password_hash()),
            is_active=True,
            organization_id=current_tenant.id
        )
        db.add(target_user)
        db.commit()
        db.refresh(target_user)
    else:
        if not target_user.organization_id:
            target_user.organization_id = current_tenant.id
        if not models.is_admin_role(target_user.role):
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

    return {
        "message": f"'{email}' was added to the organization." + ("" if payload.password else " Set a password for the account before it can sign in."),
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

    # Role hierarchy (server-side): an Admin may only change the status of Student members; roles and administrators
    # are the Super Admin's. Nobody can change their own role.
    is_super = models.is_super_admin_role(current_user.role)
    target_user_role = member.user.role if member.user else None
    if not is_super:
        if payload.role:
            raise HTTPException(status_code=403, detail="Only a Super Admin can change roles.")
        if member.role != "STUDENT" or models.is_admin_role(target_user_role):
            raise HTTPException(status_code=403, detail="Only a Super Admin can manage administrator accounts.")
    if payload.role and member.user_id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot change your own role.")
    if models.is_super_admin_role(target_user_role) and not is_super:
        raise HTTPException(status_code=403, detail="Only a Super Admin can manage Super Admin accounts.")

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
        member.role = new_role   # membership label only: the account's own role is never rewritten here

    if payload.status:
        new_status = payload.status.lower()
        if new_status not in ("active", "deactivated"):
            raise HTTPException(status_code=400, detail="Status must be 'active' or 'deactivated'.")
        member.status = new_status
        if member.user and new_status == "deactivated":
            member.user.is_active = False

    # Legacy duplicate rows for the same user in this org must never keep a role/status the admin just removed.
    for duplicate in db.query(models.OrganizationMember).filter(
        models.OrganizationMember.organization_id == current_tenant.id,
        models.OrganizationMember.user_id == member.user_id,
        models.OrganizationMember.id != member.id
    ).all():
        duplicate.role = member.role
        duplicate.status = member.status

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
    # Role hierarchy (server-side): an Admin can remove Students only
    if not models.is_super_admin_role(current_user.role) and (member.role != "STUDENT" or (member.user and models.is_admin_role(member.user.role))):
        raise HTTPException(status_code=403, detail="Only a Super Admin can remove administrator accounts.")

    user_to_remove = member.user
    db.delete(member)
    if user_to_remove and user_to_remove.role != models.UserRole.PLATFORM_ADMIN:
        user_to_remove.organization_id = None
        user_to_remove.is_active = False
    db.commit()
    return {"message": "Member removed successfully from organization."}
