"""
Admin User Management: the ONLY way accounts are created.

Every endpoint requires an authenticated administrator of the organization being managed (routers.auth.require_organization_admin_context:
Students, deactivated users and unauthenticated callers are rejected before any handler code runs). Everything is scoped to the
caller's resolved organization. The role hierarchy is enforced HERE, on the server, for every call:

    caller        may create                     may manage (edit / activate / deactivate / replace password)
    SUPER_ADMIN   SUPER_ADMIN, ADMIN, STUDENT    every account in the organization (never itself into a lock-out)
    ADMIN         STUDENT                        STUDENT accounts only
    STUDENT       -                              - (rejected before the handler runs)

No endpoint changes the role of an existing account, so nobody can promote themselves or anyone else.

Passwords are hashed with bcrypt, never returned by any response, never logged, and never re-displayed after creation.
"""
from datetime import datetime
from typing import List, Optional

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

import database
import models
import utils
from routers.auth import TenantContext, require_organization_admin_context
from services import local_auth

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

SUPER, ADMIN, STUDENT = (models.UserRole.SUPER_ADMIN.value, models.UserRole.ADMIN.value, models.UserRole.STUDENT.value)
ASSIGNABLE_ROLES = (SUPER, ADMIN, STUDENT)

# caller role -> roles it may create / manage
CREATABLE_ROLES = {SUPER: (SUPER, ADMIN, STUDENT), ADMIN: (STUDENT,)}
MANAGEABLE_ROLES = {SUPER: (SUPER, ADMIN, STUDENT), ADMIN: (STUDENT,)}


# ------------------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------------------
class CreateUserRequest(BaseModel):
    role: str
    full_name: str = Field(..., max_length=150)
    email: str = Field(..., max_length=150)
    password: str = Field(..., max_length=200)
    phone: Optional[str] = Field(None, max_length=50)


class UpdateUserRequest(BaseModel):
    full_name: Optional[str] = Field(None, max_length=150)
    phone: Optional[str] = Field(None, max_length=50)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., max_length=200)


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
def _fail(code: int, detail):
    return HTTPException(status_code=code, detail=detail)


def _valid_email(raw: str) -> str:
    cleaned = local_auth.normalize_email(raw)
    try:
        return validate_email(cleaned, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise _fail(422, "Enter a valid e-mail address.")


def _clean_name(raw: Optional[str]) -> str:
    name = " ".join((raw or "").split())
    if not name:
        raise _fail(422, "Name is required.")
    if len(name) > 150:
        raise _fail(422, "Name must be at most 150 characters.")
    return name


def _clean_phone(raw: Optional[str]) -> Optional[str]:
    try:
        return local_auth.normalize_phone(raw)
    except ValueError as exc:
        raise _fail(422, str(exc))


def _tenant_users(db: Session, tenant_id: int):
    """Login accounts (ADMIN/STUDENT, never internal candidate shadow users) that belong to one organization."""
    member_ids = db.query(models.OrganizationMember.user_id).filter(models.OrganizationMember.organization_id == tenant_id)
    return db.query(models.User).filter(
        models.User.role.in_(ASSIGNABLE_ROLES),
        ~models.User.email.like("%.internal"),
        or_(models.User.organization_id == tenant_id, models.User.id.in_(member_ids)),
    )


def _profile(db: Session, user: models.User) -> Optional[models.StudentProfile]:
    if user.role != models.UserRole.STUDENT:
        return None
    return db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()


def _caller_role(ctx: TenantContext) -> str:
    return str(getattr(ctx.user.role, "value", ctx.user.role))


def _serialize(db: Session, user: models.User, detail: bool = False) -> dict:
    profile = _profile(db, user)
    data = {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name or (profile.full_name if profile else None),
        "phone": user.phone or (profile.phone if profile else None),
        "role": user.role if user.role in ASSIGNABLE_ROLES else STUDENT,
        "is_active": bool(user.is_active),
        "organization_id": user.organization_id,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }
    if detail:
        org = db.query(models.Organization).filter(models.Organization.id == user.organization_id).first() if user.organization_id else None
        data["organization_name"] = org.name if org else None
        data["active_sessions"] = db.query(models.AuthSession).filter(
            models.AuthSession.user_id == user.id,
            models.AuthSession.revoked_at.is_(None),
            models.AuthSession.expires_at > local_auth.utcnow(),
        ).count()
        if profile:
            data["student_profile"] = {
                "college_name": profile.college_name,
                "branch": profile.branch,
                "graduation_year": profile.graduation_year,
                "target_role": profile.target_role,
                "is_onboarded": bool(profile.is_onboarded),
            }
    return data


def _load_target(db: Session, ctx: TenantContext, user_id: int, manage: bool = False) -> models.User:
    """
    Target account inside the caller's organization; anything else is a plain 404 (no cross-tenant existence leak).
    With manage=True the caller's role must also be allowed to manage the target's role (an ADMIN can manage Students only).
    """
    target = _tenant_users(db, ctx.tenant_id).filter(models.User.id == user_id).first()
    if target is None:
        raise _fail(404, "User not found.")
    if manage and target.role not in MANAGEABLE_ROLES.get(_caller_role(ctx), ()):
        raise _fail(403, f"Your role cannot manage {target.role.replace('_', ' ').title()} accounts.")
    return target


def _audit(db: Session, ctx: TenantContext, action: str, target: models.User, details: str = ""):
    db.add(models.ActivityLog(user_id=ctx.user.id, organization_id=ctx.tenant_id, action=action, target=target.email, details=details or None))


def _active_count(db: Session, tenant_id: int, *roles: str) -> int:
    return _tenant_users(db, tenant_id).filter(models.User.role.in_(roles), models.User.is_active.is_(True)).count()


# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------
@router.get("/")
def list_users(
    q: Optional[str] = Query(None, max_length=100, description="Search by name or e-mail"),
    role: Optional[str] = Query(None, description="ADMIN or STUDENT"),
    is_active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    query = _tenant_users(db, ctx.tenant_id)
    if role:
        wanted = role.strip().upper()
        if wanted not in ASSIGNABLE_ROLES:
            raise _fail(422, "Role filter must be SUPER_ADMIN, ADMIN or STUDENT.")
        query = query.filter(models.User.role == wanted)
    if is_active is not None:
        query = query.filter(models.User.is_active.is_(is_active))
    if q and q.strip():
        needle = q.strip().lower()
        profile_ids = db.query(models.StudentProfile.user_id).filter(func.lower(models.StudentProfile.full_name).contains(needle, autoescape=True))
        query = query.filter(or_(
            func.lower(models.User.email).contains(needle, autoescape=True),
            func.lower(func.coalesce(models.User.full_name, "")).contains(needle, autoescape=True),
            models.User.id.in_(profile_ids),
        ))
    total = query.count()
    rows = query.order_by(models.User.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_serialize(db, u) for u in rows], "total": total, "page": page, "page_size": page_size}


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: CreateUserRequest,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    role = (payload.role or "").strip().upper()
    if role not in ASSIGNABLE_ROLES:
        raise _fail(422, "Role must be SUPER_ADMIN, ADMIN or STUDENT.")
    if role not in CREATABLE_ROLES.get(_caller_role(ctx), ()):
        raise _fail(403, f"Your role cannot create {role.replace('_', ' ').title()} accounts.")
    name = _clean_name(payload.full_name)
    email = _valid_email(payload.email)
    phone = _clean_phone(payload.phone)
    if email.endswith(".internal"):
        raise _fail(422, "This e-mail domain is reserved.")
    problems = local_auth.password_policy_errors(payload.password, email)
    if problems:
        raise _fail(422, problems)

    if db.query(models.User.id).filter(func.lower(models.User.email) == email).first() is not None:
        raise _fail(409, "An account with this e-mail address already exists.")

    try:
        user = models.User(
            email=email,
            full_name=name,
            phone=phone,
            role=role,
            hashed_password=utils.get_password_hash(payload.password),
            is_active=True,
            password_changed=False,
            organization_id=ctx.tenant_id,
        )
        db.add(user)
        db.flush()
        if role == STUDENT:
            db.add(models.StudentProfile(
                user_id=user.id, organization_id=ctx.tenant_id, email=email, full_name=name, phone=phone, target_role="",
            ))
        elif role == ADMIN:
            db.add(models.OrganizationMember(organization_id=ctx.tenant_id, user_id=user.id, role="ADMIN", status="active"))
        # SUPER_ADMIN is platform scope: no organization membership is needed (or granted)
        _audit(db, ctx, "user_created", user, f"role={role}")
        db.commit()  # user, profile/membership and audit row are one transaction
    except IntegrityError:
        db.rollback()
        raise _fail(409, "An account with this e-mail address already exists.")
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return {"message": f"{role.title()} account created for {email}.", "user": _serialize(db, user)}


@router.get("/{user_id}")
def get_user(user_id: int, ctx: TenantContext = Depends(require_organization_admin_context), db: Session = Depends(database.get_db)):
    return _serialize(db, _load_target(db, ctx, user_id), detail=True)


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """Edits profile information only (name, mobile number). Role, e-mail and organization are never changed here."""
    target = _load_target(db, ctx, user_id, manage=True)
    fields = payload.model_fields_set
    if not fields & {"full_name", "phone"}:
        raise _fail(422, "Nothing to update.")
    profile = _profile(db, target)
    if "full_name" in fields:
        target.full_name = _clean_name(payload.full_name)
        if profile:
            profile.full_name = target.full_name
    if "phone" in fields:
        target.phone = _clean_phone(payload.phone)
        if profile:
            profile.phone = target.phone
    _audit(db, ctx, "user_updated", target, "fields=" + ",".join(sorted(fields & {"full_name", "phone"})))
    db.commit()
    db.refresh(target)
    return _serialize(db, target, detail=True)


@router.post("/{user_id}/deactivate")
def deactivate_user(user_id: int, ctx: TenantContext = Depends(require_organization_admin_context), db: Session = Depends(database.get_db)):
    target = _load_target(db, ctx, user_id, manage=True)
    if target.id == ctx.user.id:
        raise _fail(400, "You cannot deactivate your own account.")
    if target.role == SUPER and target.is_active and _active_count(db, ctx.tenant_id, SUPER) <= 1:
        raise _fail(400, "You cannot deactivate the last active Super Admin.")
    if target.role in (ADMIN, SUPER) and target.is_active and _active_count(db, ctx.tenant_id, ADMIN, SUPER) <= 1:
        raise _fail(400, "You cannot deactivate the last active administrator.")
    target.is_active = False
    revoked = local_auth.revoke_user_sessions(db, target.id)
    _audit(db, ctx, "user_deactivated", target, f"sessions_revoked={revoked}")
    db.commit()
    return {"message": f"{target.email} was deactivated and signed out.", "user": _serialize(db, target)}


@router.post("/{user_id}/activate")
def activate_user(user_id: int, ctx: TenantContext = Depends(require_organization_admin_context), db: Session = Depends(database.get_db)):
    target = _load_target(db, ctx, user_id, manage=True)
    target.is_active = True
    _audit(db, ctx, "user_activated", target)
    db.commit()
    return {"message": f"{target.email} was activated.", "user": _serialize(db, target)}


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """Administrator-controlled password replacement. The new password is never echoed; every session of the target is revoked."""
    target = _load_target(db, ctx, user_id, manage=True)
    if target.id == ctx.user.id:
        raise _fail(400, "Use 'Change password' (it requires your current password) to change your own password.")
    problems = local_auth.password_policy_errors(payload.new_password, target.email)
    if problems:
        raise _fail(422, problems)
    target.hashed_password = utils.get_password_hash(payload.new_password)
    target.password_changed = False
    revoked = local_auth.revoke_user_sessions(db, target.id)
    _audit(db, ctx, "user_password_reset", target, f"sessions_revoked={revoked}")
    db.commit()
    return {"message": f"Password replaced for {target.email}. Their existing sessions were signed out."}
