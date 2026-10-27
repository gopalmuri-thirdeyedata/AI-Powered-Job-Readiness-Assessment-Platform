import os
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

import schemas, models, utils, database
from services import local_auth
from services.rate_limiter import client_ip

router = APIRouter(
    prefix="/api/auth",
    tags=["auth"]
)

# ------------------------------------------------------------------------------
# Local authentication (email + password, HttpOnly cookie session)
#
#   POST /api/auth/login/            one login for Admin and Student; the role comes from the account row, never from the client
#   POST /api/auth/logout/           revokes the server-side session and clears the cookie
#   GET  /api/auth/me                current user + CSRF token for the cookie session
#   POST /api/auth/change-password/  current password required; revokes every other session and rotates this one
#
# There is deliberately NO public registration endpoint: accounts are created by an authenticated administrator
# (routers/users.py). The Clerk token-exchange endpoint was removed: it minted a session for any e-mail without verification.
# ------------------------------------------------------------------------------
LOGIN_ROLES = (models.UserRole.SUPER_ADMIN.value, models.UserRole.ADMIN.value, models.UserRole.STUDENT.value)
HOME_FOR_ROLE = {"SUPER_ADMIN": "/admin/dashboard", "ADMIN": "/admin/dashboard", "STUDENT": "/assessment/setup"}
INVALID_CREDENTIALS = "Invalid email or password."

# Verified against when the e-mail is unknown, so "no such account" costs the same time as "wrong password".
_DUMMY_HASH = utils.get_password_hash("prepwin-timing-equalizer-not-a-credential")


class LoginSchema(BaseModel):
    email: Optional[str] = Field(None, max_length=320)
    username: Optional[str] = Field(None, max_length=320)  # legacy field name of the previous login form
    password: str = Field(..., max_length=1024)


def _no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _login_denied(detail: str = INVALID_CREDENTIALS, code: int = status.HTTP_401_UNAUTHORIZED, headers: Optional[dict] = None):
    return HTTPException(status_code=code, detail=detail, headers=headers)


def _organization_for(user: models.User, db: Session):
    """(organization, active admin membership) the account is anchored to. Either may be None (platform administrators)."""
    members = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == user.id,
        models.OrganizationMember.status == "active",
    ).order_by(models.OrganizationMember.id).all()
    member = _strongest_membership(members, user.organization_id) if user.organization_id else None
    if member is None and members:
        member = members[0]
    org_id = member.organization_id if member else user.organization_id
    org = db.query(models.Organization).filter(models.Organization.id == org_id).first() if org_id else None
    return org, member


def _public_user(user: models.User, db: Session) -> dict:
    """Non-sensitive account view. Never includes the password hash."""
    org, _member = _organization_for(user, db)
    role = user.role if user.role in LOGIN_ROLES else "STUDENT"
    full_name = user.full_name
    if not full_name and role == "STUDENT":
        profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
        full_name = profile.full_name if profile else None
    return {
        "user_id": user.id,
        "email": user.email,
        "full_name": full_name,
        "phone": user.phone,
        "role": role,
        "is_active": bool(user.is_active),
        "organization_id": org.id if org else None,
        "organization_name": org.name if org else ("Platform Administration" if models.is_admin_role(role) else "PrepWin Student Assessment Hub"),
        "organization_slug": org.slug if org else ("platform" if models.is_admin_role(role) else "roleready-students"),
    }


@router.post("/login/")
def login(login_data: LoginSchema, request: Request, response: Response, db: Session = Depends(database.get_db)):
    _no_store(response)
    email = local_auth.normalize_email(login_data.email or login_data.username)
    ip = client_ip(request)

    wait = local_auth.login_tracker.retry_after(email, ip)
    if wait:
        raise _login_denied(
            "Too many failed sign-in attempts. Please wait a few minutes and try again.",
            status.HTTP_429_TOO_MANY_REQUESTS, {"Retry-After": str(wait)},
        )

    user = db.query(models.User).filter(func.lower(models.User.email) == email).first() if email else None
    stored_hash = user.hashed_password if user is not None else _DUMMY_HASH
    password_ok = utils.verify_password(login_data.password, stored_hash) and login_data.password not in utils.LEGACY_PLACEHOLDER_PASSWORDS

    # Unknown e-mail, wrong password, an internal shadow/candidate record: all indistinguishable to the caller.
    if user is None or not password_ok or user.role not in LOGIN_ROLES or (user.email or "").endswith(".internal"):
        local_auth.login_tracker.record_failure(email, ip)
        raise _login_denied()

    if user.is_active is False:
        # The caller proved they own the password, so telling them why is not an enumeration risk.
        raise _login_denied("This account has been deactivated. Please contact your administrator.", status.HTTP_403_FORBIDDEN)

    org, member = _organization_for(user, db)
    if models.is_admin_role(user.role) and not models.is_super_admin_role(user.role) and member is not None and (org is None or org.status != "active"):
        raise _login_denied("Your organization account is inactive or suspended. Please contact your administrator.", status.HTTP_403_FORBIDDEN)
    if user.role == models.UserRole.STUDENT and org is not None and org.status != "active":
        raise _login_denied("Your college organization is inactive or suspended.", status.HTTP_403_FORBIDDEN)

    local_auth.login_tracker.record_success(email, ip)

    # Session rotation: a session id presented with the login request is never reused or elevated.
    stale = local_auth.resolve_session(db, request.cookies.get(local_auth.SESSION_COOKIE))
    if stale is not None:
        local_auth.revoke_session(db, stale[0])
    raw, row = local_auth.create_session(db, user, ip=ip, user_agent=request.headers.get("user-agent"))
    user.last_login_at = local_auth.utcnow()
    db.commit()

    local_auth.set_session_cookie(response, raw)
    payload = _public_user(user, db)
    return {
        "user": payload,
        "role": payload["role"],                      # from the stored account, never from the request
        "organization_id": payload["organization_id"],
        "redirect": HOME_FOR_ROLE[payload["role"]],
        "csrf_token": row.csrf_token,
        "expires_at": row.expires_at.isoformat() + "Z",
    }


@router.post("/logout/")
def logout(request: Request, response: Response, db: Session = Depends(database.get_db)):
    """Idempotent: always clears the cookie; revokes the server-side session when one is presented."""
    _no_store(response)
    resolved = local_auth.resolve_session(db, request.cookies.get(local_auth.SESSION_COOKIE))
    if resolved is not None:
        local_auth.revoke_session(db, resolved[0])
        db.commit()
    local_auth.clear_session_cookie(response)
    return {"message": "Signed out."}


class CandidateLoginSchema(BaseModel):
    username: str
    password: str


@router.post("/candidate-login/", response_model=schemas.Token)
def candidate_login(login_data: CandidateLoginSchema, db: Session = Depends(database.get_db)):
    candidate = db.query(models.Candidate).filter(models.Candidate.email == login_data.username).first()

    if not candidate:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not candidate.hashed_password:
        raise HTTPException(status_code=401, detail="Access not authorized")

    if not utils.verify_password(login_data.password, candidate.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Map to internal user account for JWT auth
    shadow_email = f"candidate_{candidate.id}@hiringai.internal"

    shadow_user = db.query(models.User).filter(models.User.email == shadow_email).first()
    if not shadow_user:
         raise HTTPException(status_code=401, detail="System configuration error. Please contact HR.")

    # Check if ALL of THIS candidate's assessments are completed — block login if nothing pending
    all_assessments = db.query(models.Assessment).filter(
        models.Assessment.user_id == shadow_user.id
    ).all()

    if all_assessments:
        has_pending = any(a.status in ("pending", "in_progress") for a in all_assessments)
        if not has_pending:
            raise HTTPException(
                status_code=403,
                detail="All assessments have been completed. Thank you for participating!"
            )

    access_token = utils.create_access_token(data={"sub": shadow_email})
    return {"access": access_token, "token_type": "bearer"}

# Dependency
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login/", auto_error=False)


def _usable_bearer(token: Optional[str]) -> Optional[str]:
    """A Bearer value that is really a credential. Front-end code that stringified a missing token ("null"/"undefined") sent nothing."""
    token = (token or "").strip()
    return None if token.lower() in ("", "null", "undefined", "none") else token


def cookie_session_user(request: Request, db: Session) -> Optional[models.User]:
    """
    The user behind a valid HttpOnly session cookie, or None. Every endpoint that authenticates on its own (instead of through
    get_current_user) must resolve cookie sessions through this function so expiry, revocation, deactivation and CSRF apply equally.
    Raises 403 when a state-changing request lacks the session's CSRF token.
    """
    resolved = local_auth.resolve_session(db, request.cookies.get(local_auth.SESSION_COOKIE))
    if resolved is None:
        return None
    session_row, user = resolved
    if request.method in local_auth.UNSAFE_METHODS and not local_auth.csrf_matches(session_row, request.headers.get(local_auth.CSRF_HEADER)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed.")
    user._token_role = user.role  # the role is always the stored account role for cookie sessions
    request.state.auth_session = session_row
    return user


def get_current_user(request: Request, token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(database.get_db)):
    """
    Resolves the caller from either
      1. an explicit `Authorization: Bearer <signed JWT>` (candidate-portal shadow accounts and API clients), or
      2. the HttpOnly session cookie issued by /api/auth/login/ (every Admin/Student browser session).
    An explicit but invalid Bearer value is rejected, never silently replaced by the cookie. Cookie sessions are checked against
    the server-side session table (revocation, expiry, idle timeout, active account) and, for state-changing methods, the CSRF token.
    """
    token = _usable_bearer(token)
    if token is None:
        user = cookie_session_user(request, db)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, utils.SECRET_KEY, algorithms=[utils.ALGORITHM])
        email: str = payload.get("sub")
        role_claim: Optional[str] = payload.get("role")
        if email is None:
            raise credentials_exception
        token_data = schemas.TokenData(email=email)
    except JWTError as e:
        raise HTTPException(
            status_code=401,
            detail=f"JWT Error: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"}
        )

    user = db.query(models.User).filter(models.User.email == token_data.email).first()
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # Reject stale tokens claiming administrative privileges the stored account no longer has (the DATABASE role is authoritative)
    stale_admin = role_claim == "ADMIN" and not models.is_admin_role(user.role)
    stale_super = role_claim == "SUPER_ADMIN" and not models.is_super_admin_role(user.role)
    if stale_admin or stale_super:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrative privileges for this token have been revoked. Please re-authenticate.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user._token_role = role_claim or user.role
    return user


class ChangePasswordSchema(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password/")
def change_password(
    payload: ChangePasswordSchema,
    request: Request,
    response: Response,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db),
):
    """Self-service password change. Requires the current password; every other session of the user is revoked and this one is rotated."""
    _no_store(response)
    if current_user.role not in LOGIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password changes are not available for this account type.")
    if not utils.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    problems = local_auth.password_policy_errors(payload.new_password, current_user.email)
    if problems:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problems)
    if utils.verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=["The new password must differ from the current password."])

    current_user.hashed_password = utils.get_password_hash(payload.new_password)
    current_user.password_changed = True
    local_auth.revoke_user_sessions(db, current_user.id)
    raw, row = local_auth.create_session(db, current_user, ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    db.commit()
    local_auth.set_session_cookie(response, raw)
    return {"message": "Password updated. Other sessions were signed out.", "csrf_token": row.csrf_token}


def get_current_tenant(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> Optional[models.Organization]:
    """
    Centralized dependency resolving the active Organization for the authenticated user.
    Never trusts frontend-provided organization identifiers.
    """
    # Candidate users operate within their shadow user assessment context
    if current_user.email.endswith(".internal") or current_user.role == models.UserRole.CANDIDATE:
        return None

    # Check organization membership
    member = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == current_user.id,
        models.OrganizationMember.status == "active"
    ).first()

    org = None
    if member:
        org = db.query(models.Organization).filter(models.Organization.id == member.organization_id).first()
    elif current_user.organization_id:
        org = db.query(models.Organization).filter(models.Organization.id == current_user.organization_id).first()

    if not org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active organization membership required."
        )

    if org.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Organization '{org.name}' is currently {org.status}. Access denied."
        )

    return org

def _is_platform_unanchored_admin(current_user: models.User, db: Session) -> bool:
    """Platform scope belongs to the SUPER_ADMIN role stored on the account. It is never inferred from an e-mail pattern."""
    return models.is_super_admin_role(current_user.role)

def require_platform_admin(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.User:
    """Security check: Ensures only authorized platform administrators can execute platform operations."""
    if not _is_platform_unanchored_admin(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin privileges required."
        )
    return current_user


# ------------------------------------------------------------------------------
# Canonical admin authorization (Admin Recruitment Workflow)
# ------------------------------------------------------------------------------
ADMIN_MEMBER_ROLES = ("ADMIN", "ORGANIZATION_ADMIN", "HR", "HR_ADMIN", "RECRUITER")
ORG_OWNER_ROLES = ("ADMIN", "ORGANIZATION_ADMIN")


@dataclass(frozen=True)
class TenantContext:
    """Immutable, request-scoped tenant resolution result. Never persisted, never mutates the user row."""
    tenant_id: int
    organization: models.Organization
    user: models.User
    member: Optional[models.OrganizationMember]
    is_platform_admin: bool


def _assert_admin_identity(current_user: models.User, db: Session) -> bool:
    """Shared identity gate. Returns True for unanchored/platform admins; raises 403 for students or inactive accounts."""
    if getattr(current_user, "is_active", True) is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is deactivated.")
    active_role = getattr(current_user, "_token_role", None) or current_user.role
    if not models.is_admin_role(active_role) or not models.is_admin_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidates and students are not permitted to access recruiter tools."
        )
    return _is_platform_unanchored_admin(current_user, db)


def _parse_org_header(request: Optional[Request]) -> Optional[int]:
    raw = request.headers.get("x-organization-id") if request is not None else None
    if raw is None or str(raw).strip() == "":
        return None
    try:
        value = int(str(raw).strip())
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="X-Organization-Id must be an integer.")
    if value <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="X-Organization-Id must be a positive integer.")
    return value


def _strongest_membership(memberships, organization_id):
    """Highest-privilege active membership in one org (tolerates historical duplicate rows deterministically)."""
    in_org = [m for m in memberships if m.organization_id == organization_id]
    if not in_org:
        return None
    return min(in_org, key=lambda m: (m.role not in ORG_OWNER_ROLES, m.id))


def _resolve_tenant_context(
    request: Optional[Request],
    current_user: models.User,
    db: Session,
    is_platform_admin: bool,
) -> TenantContext:
    """
    Deterministic tenant resolution: explicit header -> persistent anchor -> single membership.
    Multiple memberships without an explicit header/anchor are rejected (no arbitrary .first()).
    The user row is never modified.
    """
    header_org_id = _parse_org_header(request)
    member = None
    org = None

    active_memberships = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == current_user.id,
        models.OrganizationMember.status == "active",
    ).all()

    if header_org_id is not None:
        org = db.query(models.Organization).filter(models.Organization.id == header_org_id).first()
        member = _strongest_membership(active_memberships, header_org_id)
        if is_platform_admin:
            if not org:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found.")
        elif member is None or org is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is not an active member of the specified organization."
            )
    else:
        anchor_id = current_user.organization_id
        anchor_member = _strongest_membership(active_memberships, anchor_id) if anchor_id else None
        if anchor_member is not None:
            member = anchor_member
        elif len(active_memberships) == 1:
            member = active_memberships[0]
        elif len(active_memberships) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User belongs to multiple organizations. An explicit 'X-Organization-Id' header is required."
            )
        elif is_platform_admin and anchor_id:
            org = db.query(models.Organization).filter(models.Organization.id == anchor_id).first()
        elif is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Platform administrators must specify a target organization via 'X-Organization-Id'."
            )
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no active organization memberships.")
        if org is None and member is not None:
            org = db.query(models.Organization).filter(models.Organization.id == member.organization_id).first()

    if org is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active organization membership required.")
    if org.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Organization '{org.name}' is currently {org.status}. Access denied."
        )

    return TenantContext(tenant_id=org.id, organization=org, user=current_user, member=member, is_platform_admin=is_platform_admin)


def require_admin_user(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db),
) -> TenantContext:
    """
    Canonical dependency for every recruitment/admin operation. Authorizes ADMIN identities
    and returns an immutable TenantContext.
    """
    is_platform_admin = _assert_admin_identity(current_user, db)
    ctx = _resolve_tenant_context(request, current_user, db, is_platform_admin)
    if not is_platform_admin and (ctx.member is None or ctx.member.role not in ADMIN_MEMBER_ROLES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has not been invited to HiringAI. Please contact your organization administrator."
        )
    return ctx


def require_organization_admin_context(
    ctx: TenantContext = Depends(require_admin_user),
) -> TenantContext:
    """Tenant administrators only."""
    if ctx.is_platform_admin:
        return ctx
    if ctx.member is None or ctx.member.role not in ORG_OWNER_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization administrator privileges required.")
    return ctx


def require_organization_admin(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.User:
    """Admin user identity check and tenant resolution."""
    is_platform_admin = _assert_admin_identity(current_user, db)
    if is_platform_admin:
        return current_user
    ctx = _resolve_tenant_context(request, current_user, db, False)
    if ctx.member is None or ctx.member.role not in ORG_OWNER_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization administrator privileges required.")
    return current_user


def require_hr_or_admin(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.User:
    """Backward-compatible admin user authorization."""
    is_platform_admin = _assert_admin_identity(current_user, db)
    if is_platform_admin:
        return current_user
    return require_admin_user(request, current_user, db).user

@router.get("/me")
def get_current_user_profile(
    request: Request,
    response: Response,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Returns the authenticated user's profile, role and resolved organization (always from the stored account), plus the CSRF
    token of the cookie session so a freshly loaded page can send state-changing requests.
    """
    _no_store(response)
    data = _public_user(current_user, db)
    session_row = getattr(request.state, "auth_session", None)
    if session_row is not None:
        data["csrf_token"] = session_row.csrf_token
    return data
