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
DELETE /{id} permanently deletes a STUDENT of the caller's organization (never an Admin or Super Admin, whoever calls it); see
services/student_deletion.py for exactly what is removed and what is retained.

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

import secrets
import string

import database
import models
import utils
from routers.auth import TenantContext, require_organization_admin_context
from services import assessment_access, credential_delivery, local_auth, student_deletion
from services.rate_limiter import SlidingWindowLimiter

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

_bulk_share_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
_bulk_replace_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)

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


class AssessmentAccessRequest(BaseModel):
    granted: bool


class BulkShareCredentialsRequest(BaseModel):
    user_ids: List[int] = Field(..., min_length=1, max_length=100)


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


def generate_secure_password(email: Optional[str] = None) -> str:
    """Generates a cryptographically secure, unique password satisfying the password policy."""
    special_chars = "!@#$%^&*_-+="
    alphabet = string.ascii_letters + string.digits + special_chars
    rand = secrets.SystemRandom()
    for _ in range(100):
        chars = [
            rand.choice(string.ascii_lowercase),
            rand.choice(string.ascii_lowercase),
            rand.choice(string.ascii_uppercase),
            rand.choice(string.ascii_uppercase),
            rand.choice(string.digits),
            rand.choice(string.digits),
            rand.choice(special_chars),
            rand.choice(special_chars),
        ] + [rand.choice(alphabet) for _ in range(8)]
        rand.shuffle(chars)
        pwd = "".join(chars)
        if not local_auth.password_policy_errors(pwd, email):
            return pwd
    token = secrets.token_urlsafe(12)
    return f"P@ss{token}1A!"


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
    if user.role == STUDENT:
        data["assessment_access_granted"] = assessment_access.is_granted(profile)
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
    ready = credential_delivery.ready_user_ids(db, [u.id for u in rows if u.role == STUDENT])
    items = [{**_serialize(db, u), "credentials_ready": u.id in ready} for u in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


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
        if role == STUDENT:
            credential_delivery.retain(db, user, payload.password, ctx.user.id)   # encrypted + short-lived, for "Share"
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


@router.put("/{user_id}/assessment-access")
def set_assessment_access(
    user_id: int,
    payload: AssessmentAccessRequest,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """
    Grants or revokes ONE student's access to the normal assessment. Same hierarchy as every other action here: the target must be an
    account the caller may manage inside the caller's organization (an Admin: Students only). Only Students have this switch.
    Revoking never ends an attempt in progress and never deletes anything; it only stops new attempts from starting.
    """
    target = _load_target(db, ctx, user_id, manage=True)
    if target.role != STUDENT:
        raise _fail(400, "Assessment access applies to Student accounts only.")
    profile = _profile(db, target)
    if profile is None:
        profile = models.StudentProfile(
            user_id=target.id, organization_id=target.organization_id or ctx.tenant_id, email=target.email,
            full_name=target.full_name or target.email.split("@")[0], phone=target.phone, target_role="",
        )
        db.add(profile)
        db.flush()
    changed = assessment_access.set_access(profile, payload.granted, ctx.user.id)
    if changed:
        _audit(db, ctx, "assessment_access_granted" if payload.granted else "assessment_access_revoked", target)
    db.commit()
    state = "granted" if payload.granted else "revoked"
    verb = "was" if changed else "was already"
    return {"message": f"Assessment access {verb} {state} for {target.email}.", "changed": changed, "user": _serialize(db, target)}


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


@router.delete("/{user_id}")
def delete_student_account(
    user_id: int,
    confirm_email: str = Query(..., max_length=150, description="The student's e-mail address, typed back as an explicit confirmation"),
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """
    PERMANENTLY deletes one Student account of the caller's organization together with its personal data (see
    services/student_deletion.py for exactly what is removed and what is retained). Student accounts only: Admin and Super Admin
    accounts are refused for every caller. The caller's e-mail confirmation must match the stored address, so a stale or mistyped id
    (SQLite can re-use the id of a deleted row) can never delete somebody else. An unknown / already deleted / other-organization id is a 404.
    """
    target = _load_target(db, ctx, user_id)                                   # 404 outside the caller's organization
    if target.role != STUDENT:
        raise _fail(403, "Only Student accounts can be deleted. Administrator accounts cannot be deleted here.")
    if target.id == ctx.user.id:
        raise _fail(400, "You cannot delete your own account.")
    if local_auth.normalize_email(confirm_email) != local_auth.normalize_email(target.email):
        raise _fail(400, "The confirmation e-mail does not match this account. Nothing was deleted.")
    email = target.email
    try:
        result = student_deletion.delete_student(db, user=target, actor_id=ctx.user.id, org_id=ctx.tenant_id)
    except student_deletion.StudentDeletionError as exc:
        raise _fail(exc.status, {"code": exc.code, "message": exc.message})
    except Exception:
        raise _fail(500, {"code": "DELETE_FAILED", "message": "The account could not be deleted and nothing was changed. Please try again."})
    return {"message": f"The account of {email} and its personal data were permanently deleted.", **result}


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
    if target.role == STUDENT:
        credential_delivery.retain(db, target, payload.new_password, ctx.user.id)   # the new password replaces any retained one
    else:
        credential_delivery.discard(db, target.id)
    _audit(db, ctx, "user_password_reset", target, f"sessions_revoked={revoked}")
    db.commit()
    return {"message": f"Password replaced for {target.email}. Their existing sessions were signed out."}


@router.post("/share-credentials/bulk")
@router.post("/share-credentials/bulk/")
def bulk_share_credentials(
    payload: BulkShareCredentialsRequest,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """
    E-mails each selected student their login credentials in a single bulk operation.
    Processes each student independently so a failure does not stop the batch.
    Retained credentials are deleted upon SMTP acceptance.
    Never logs or returns plaintext credentials.
    """
    if not _bulk_share_limiter.allow((ctx.tenant_id, ctx.user.id)):
        raise _fail(429, "Too many bulk credential sharing requests. Please wait a minute and try again.")

    ids = list(dict.fromkeys(payload.user_ids))
    results = []

    for user_id in ids:
        target = _tenant_users(db, ctx.tenant_id).filter(models.User.id == user_id).first()
        if target is None:
            results.append({
                "id": user_id,
                "name": None,
                "email": None,
                "status": "unauthorized",
                "code": "UNAUTHORIZED",
                "message": "User not found or you do not have permission to manage this account.",
            })
            continue

        if target.role not in MANAGEABLE_ROLES.get(_caller_role(ctx), ()):
            results.append({
                "id": user_id,
                "name": target.full_name,
                "email": target.email,
                "status": "unauthorized",
                "code": "ROLE_NOT_MANAGEABLE",
                "message": f"Your role cannot manage {target.role.replace('_', ' ').title()} accounts.",
            })
            continue

        profile = _profile(db, target)
        student_name = target.full_name or (profile.full_name if profile else None) or "Student"

        if target.role != STUDENT:
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "skipped",
                "code": "NOT_A_STUDENT",
                "message": "Login credentials can only be shared for student accounts.",
            })
            continue

        if not target.is_active:
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "skipped",
                "code": "ACCOUNT_INACTIVE",
                "message": "Activate this account before sharing its login credentials.",
            })
            continue

        try:
            res = credential_delivery.send_credentials(db, user=target, actor_id=ctx.user.id, org_id=ctx.tenant_id)
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "sent",
                "code": "SENT",
                "message": res["message"],
            })
        except credential_delivery.CredentialShareError as exc:
            status_label = "skipped" if exc.code in ("PASSWORD_NOT_AVAILABLE", "SEND_IN_PROGRESS") else "failed"
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": status_label,
                "code": exc.code,
                "message": exc.message,
            })
        except Exception:
            db.rollback()
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "failed",
                "code": "EMAIL_FAILED",
                "message": "The e-mail could not be sent. Nothing was changed; you can try again.",
            })

    sent_count = sum(1 for r in results if r["status"] == "sent")
    failed_count = sum(1 for r in results if r["status"] == "failed")
    skipped_count = sum(1 for r in results if r["status"] in ("skipped", "unauthorized"))

    return {
        "total": len(ids),
        "sent": sent_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "summary": {
            "total": len(ids),
            "sent": sent_count,
            "failed": failed_count,
            "skipped": skipped_count,
        },
        "results": results,
    }


@router.post("/replace-passwords-and-share/bulk")
@router.post("/replace-passwords-and-share/bulk/")
def bulk_replace_passwords_and_share(
    payload: BulkShareCredentialsRequest,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """
    Generates a new secure password for each selected student, updates their account,
    revokes sessions, and e-mails their new credentials in a single bulk operation.
    Distinguishes password replacement failure from email delivery failure.
    If email delivery fails, the new password remains safely retained for retry via standard Share.
    Never returns or logs plaintext passwords.
    """
    if not _bulk_replace_limiter.allow((ctx.tenant_id, ctx.user.id)):
        raise _fail(429, "Too many bulk credential sharing requests. Please wait a minute and try again.")

    ids = list(dict.fromkeys(payload.user_ids))
    results = []

    for user_id in ids:
        target = _tenant_users(db, ctx.tenant_id).filter(models.User.id == user_id).first()
        if target is None:
            results.append({
                "id": user_id,
                "name": None,
                "email": None,
                "status": "unauthorized",
                "stage": "authorization",
                "code": "UNAUTHORIZED",
                "message": "User not found or you do not have permission to manage this account.",
            })
            continue

        if target.role not in MANAGEABLE_ROLES.get(_caller_role(ctx), ()):
            results.append({
                "id": user_id,
                "name": target.full_name,
                "email": target.email,
                "status": "unauthorized",
                "stage": "authorization",
                "code": "ROLE_NOT_MANAGEABLE",
                "message": f"Your role cannot manage {target.role.replace('_', ' ').title()} accounts.",
            })
            continue

        profile = _profile(db, target)
        student_name = target.full_name or (profile.full_name if profile else None) or "Student"

        if target.role != STUDENT:
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "skipped",
                "stage": "validation",
                "code": "NOT_A_STUDENT",
                "message": "Password replacement and credential sharing can only be performed for student accounts.",
            })
            continue

        if not target.is_active:
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "skipped",
                "stage": "validation",
                "code": "ACCOUNT_INACTIVE",
                "message": "Activate this account before replacing and sharing its login credentials.",
            })
            continue

        new_password = generate_secure_password(target.email)

        # Step 1: Update student password, revoke active sessions, and retain encrypted credential
        try:
            target.hashed_password = utils.get_password_hash(new_password)
            target.password_changed = False
            revoked = local_auth.revoke_user_sessions(db, target.id)
            credential_delivery.retain(db, target, new_password, ctx.user.id)
            _audit(db, ctx, "user_password_reset_bulk", target, f"sessions_revoked={revoked}")
            db.commit()
        except Exception:
            db.rollback()
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "failed",
                "stage": "password_replacement",
                "code": "PASSWORD_REPLACE_FAILED",
                "message": "Failed to update student password.",
            })
            continue
        finally:
            del new_password

        # Step 2: Deliver credentials via SMTP
        try:
            res = credential_delivery.send_credentials(db, user=target, actor_id=ctx.user.id, org_id=ctx.tenant_id)
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "sent",
                "stage": "email_delivery",
                "code": "SENT",
                "message": res["message"],
            })
        except credential_delivery.CredentialShareError as exc:
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "failed",
                "stage": "email_delivery",
                "code": exc.code,
                "message": f"Password was replaced, but email delivery failed: {exc.message} You can retry sharing without replacing the password again.",
            })
        except Exception:
            db.rollback()
            results.append({
                "id": user_id,
                "name": student_name,
                "email": target.email,
                "status": "failed",
                "stage": "email_delivery",
                "code": "EMAIL_FAILED",
                "message": "Password was replaced, but the email could not be sent. You can retry sharing without replacing the password again.",
            })

    sent_count = sum(1 for r in results if r["status"] == "sent")
    failed_count = sum(1 for r in results if r["status"] == "failed")
    skipped_count = sum(1 for r in results if r["status"] in ("skipped", "unauthorized"))

    return {
        "total": len(ids),
        "sent": sent_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "summary": {
            "total": len(ids),
            "sent": sent_count,
            "failed": failed_count,
            "skipped": skipped_count,
        },
        "results": results,
    }


@router.post("/{user_id}/share-credentials")
@router.post("/{user_id}/share-credentials/")
def share_credentials(
    user_id: int,
    ctx: TenantContext = Depends(require_organization_admin_context),
    db: Session = Depends(database.get_db),
):
    """
    E-mails the student's login e-mail (from the database) and the password that was assigned when the account was created or last
    replaced. It never changes a password. A password that is no longer available (older than the retention window, already shared,
    or changed since) cannot be recovered: the answer says to use Replace password first. Nothing here returns or logs a password.
    """
    target = _load_target(db, ctx, user_id, manage=True)          # same organization and role-hierarchy rules as every other action
    if target.role != STUDENT:
        raise _fail(403, "Login credentials can only be shared for student accounts.")
    if not target.is_active:
        raise _fail(409, "Activate this account before sharing its login credentials.")
    try:
        result = credential_delivery.send_credentials(db, user=target, actor_id=ctx.user.id, org_id=ctx.tenant_id)
    except credential_delivery.CredentialShareError as exc:
        raise _fail(exc.status, {"code": exc.code, "message": exc.message})
    return {"status": "sent", "message": result["message"]}

