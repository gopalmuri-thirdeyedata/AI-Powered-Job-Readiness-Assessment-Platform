from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import schemas, models, utils, database

router = APIRouter(
    prefix="/api/auth",
    tags=["auth"]
)

from pydantic import BaseModel
class LoginSchema(BaseModel):
    username: str
    password: str

@router.post("/login/", response_model=schemas.Token)
def login(login_data: LoginSchema, db: Session = Depends(database.get_db)):
    email_clean = login_data.username.strip().lower()

    # Specialized direct Platform Admin authentication for admin@thirdeyedata.ai (Password auth, No OTP)
    default_admin_pass = os.getenv("ADMIN_DEFAULT_PASSWORD", "ThirdEyeAdmin@2026!").strip()
    user = db.query(models.User).filter(func.lower(models.User.email) == email_clean).first()

    if email_clean == "admin@thirdeyedata.ai":
        if not user:
            user = models.User(
                email="admin@thirdeyedata.ai",
                role=models.UserRole.PLATFORM_ADMIN,
                hashed_password=utils.get_password_hash(default_admin_pass),
                is_active=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        elif login_data.password.strip() == default_admin_pass or login_data.password == default_admin_pass:
            # Sync password if logging in with the default credential
            user.hashed_password = utils.get_password_hash(default_admin_pass)
            user.role = models.UserRole.PLATFORM_ADMIN
            user.is_active = True
            db.commit()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    is_valid = utils.verify_password(login_data.password, user.hashed_password) or utils.verify_password(login_data.password.strip(), user.hashed_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Authorization Check: Platform Admin or active Organization Membership
    platform_admin_email = os.getenv("PLATFORM_ADMIN_EMAIL", "admin@thirdeyedata.ai").strip().lower()
    is_platform = (
        user.email.lower() in (platform_admin_email, "admin@hiringai.com", "admin@thirdeyedata.ai")
        or user.role == models.UserRole.PLATFORM_ADMIN
    )

    if not is_platform:
        member = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.user_id == user.id,
            models.OrganizationMember.status == "active"
        ).first()
        if not member:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has not been invited to HiringAI (invite-only access). Please contact your organization administrator."
            )
        org = db.query(models.Organization).filter(models.Organization.id == member.organization_id).first()
        if not org or org.status != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your organization account is inactive or suspended. Please contact your administrator."
            )
    
    access_token = utils.create_access_token(data={"sub": user.email, "role": user.role})
    return {"access": access_token, "token_type": "bearer"}

@router.post("/candidate-login/", response_model=schemas.Token)
def candidate_login(login_data: LoginSchema, db: Session = Depends(database.get_db)):
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

import os
from typing import Optional
from pydantic import BaseModel

class CheckEmailSchema(BaseModel):
    email: str
    intent: Optional[str] = "admin"

def _check_email_allowed(raw_email: str, db: Session, intent: str = "admin") -> dict:
    raw_email = (raw_email or "").strip().lower()
    if not raw_email or "@" not in raw_email:
        return {
            "allowed": False,
            "detail": "Please enter a valid email address."
        }

    platform_admin_email = os.getenv("PLATFORM_ADMIN_EMAIL", "admin@thirdeyedata.ai").strip().lower()

    # 1. Explicit Platform Admin check
    if raw_email in (platform_admin_email, "admin@hiringai.com", "admin@thirdeyedata.ai"):
        return {
            "allowed": True,
            "role": "PLATFORM_ADMIN",
            "organization_name": "Platform Administration"
        }

    # 2. Student Intent Check: Student self-assessment is accessible to all students
    if intent == "student":
        return {
            "allowed": True,
            "role": "STUDENT",
            "organization_name": "PrepWin Student Assessment"
        }

    # 3. Organization Member check for Enterprise Administrator Suite
    membership = db.query(models.OrganizationMember).join(
        models.User, models.OrganizationMember.user_id == models.User.id
    ).filter(
        func.lower(models.User.email) == raw_email
    ).first()

    if not membership:
        direct_user = db.query(models.User).filter(func.lower(models.User.email) == raw_email).first()
        if direct_user and direct_user.role == models.UserRole.PLATFORM_ADMIN:
            return {
                "allowed": True,
                "role": "PLATFORM_ADMIN",
                "organization_name": "Platform Administration"
            }
        return {
            "allowed": False,
            "detail": "This email has not been invited to the PrepWin enterprise recruitment workspace. Please contact your organization administrator."
        }

    # Check organization status
    org = db.query(models.Organization).filter(models.Organization.id == membership.organization_id).first()
    if not org or org.status != "active":
        return {
            "allowed": False,
            "detail": "Your organization account is inactive or suspended. Please contact your administrator."
        }

    if membership.status == "deactivated":
        return {
            "allowed": False,
            "detail": "Your account has been deactivated. Please contact your organization administrator."
        }

    return {
        "allowed": True,
        "role": membership.role,
        "organization_id": org.id,
        "organization_name": org.name
    }

@router.post("/check-email/")
def check_email_registered_post(payload: CheckEmailSchema, db: Session = Depends(database.get_db)):
    """
    Pre-authentication authorization check:
    Validates whether an email address is authorized in PrepWin BEFORE sending OTP.
    """
    return _check_email_allowed(payload.email, db, intent=payload.intent or "admin")

@router.get("/check-email/")
def check_email_registered_get(email: str, intent: str = "admin", db: Session = Depends(database.get_db)):
    """GET variant of check-email."""
    return _check_email_allowed(email, db, intent=intent)

class ClerkSyncSchema(BaseModel):
    email: str
    clerk_user_id: Optional[str] = None
    clerk_org_id: Optional[str] = None
    org_slug: Optional[str] = None
    role_intent: Optional[str] = None

@router.post("/clerk-sync/", response_model=schemas.Token)
def clerk_sync(sync_data: ClerkSyncSchema, db: Session = Depends(database.get_db)):
    email = sync_data.email.strip().lower()
    clerk_id = sync_data.clerk_user_id.strip() if sync_data.clerk_user_id else None
    role_intent = (sync_data.role_intent or "").strip().lower()

    platform_admin_clerk_id = os.getenv("PLATFORM_ADMIN_CLERK_USER_ID", "").strip()
    platform_admin_email = os.getenv("PLATFORM_ADMIN_EMAIL", "admin@thirdeyedata.ai").strip().lower()

    # Helper: Ensure default community organization for students
    def get_or_create_student_org():
        student_org = db.query(models.Organization).filter_by(slug="roleready-students").first()
        if not student_org:
            student_org = models.Organization(
                name="PrepWin Student Assessment Hub",
                slug="roleready-students",
                status="active"
            )
            db.add(student_org)
            db.commit()
            db.refresh(student_org)
        return student_org

    # 1. EXPLICIT PLATFORM ADMIN CHECK
    existing_user = db.query(models.User).filter(func.lower(models.User.email) == email).first()
    is_platform = False
    if platform_admin_clerk_id and clerk_id and clerk_id == platform_admin_clerk_id:
        is_platform = True
    elif platform_admin_email and email == platform_admin_email:
        is_platform = True
    elif email in ("admin@hiringai.com", "admin@thirdeyedata.ai"):
        is_platform = True
    elif existing_user and existing_user.role == models.UserRole.PLATFORM_ADMIN:
        is_platform = True

    if is_platform:
        user = existing_user
        if not user:
            user = models.User(
                email=email,
                role=models.UserRole.PLATFORM_ADMIN,
                hashed_password=utils.get_password_hash("clerk_managed_user"),
                is_active=True,
                clerk_user_id=clerk_id
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.role = models.UserRole.PLATFORM_ADMIN
            if clerk_id:
                user.clerk_user_id = clerk_id
            db.commit()

        access_token = utils.create_access_token(data={"sub": user.email, "role": models.UserRole.PLATFORM_ADMIN})
        return {"access": access_token, "token_type": "bearer"}

    # 2. LOOKUP EXPLICIT RECRUITER MEMBERSHIP
    membership = None
    if clerk_id:
        membership = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.clerk_user_id == clerk_id
        ).first()

    if not membership:
        membership = db.query(models.OrganizationMember).join(
            models.User, models.OrganizationMember.user_id == models.User.id
        ).filter(
            func.lower(models.User.email) == email
        ).first()

    # 3. IF MEMBERSHIP EXISTS AND NOT EXPLICITLY IN STUDENT-ONLY MODE: PROVISION RECRUITER
    if membership and role_intent != "student":
        org = db.query(models.Organization).filter(models.Organization.id == membership.organization_id).first()
        if not org or org.status != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your organization account is inactive or suspended. Please contact your administrator."
            )

        user = db.query(models.User).filter(models.User.id == membership.user_id).first()
        if not user:
            user = db.query(models.User).filter(func.lower(models.User.email) == email).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has not been invited to PrepWin. Please contact your organization administrator."
            )

        if membership.status == "pending":
            membership.status = "active"

        if clerk_id:
            membership.clerk_user_id = clerk_id
            user.clerk_user_id = clerk_id

        assigned_role = membership.role
        if assigned_role not in ("ORGANIZATION_ADMIN", "HR"):
            assigned_role = "HR"

        user.role = assigned_role
        user.organization_id = membership.organization_id
        db.commit()

        access_token = utils.create_access_token(data={"sub": user.email, "role": user.role})
        return {"access": access_token, "token_type": "bearer"}

    # 4. STUDENT WORKFLOW / STUDENT ROLE INTENT
    if role_intent == "student" or (existing_user and (existing_user.role == models.UserRole.STUDENT or existing_user.student_profile)):
        student_org = get_or_create_student_org()

        if existing_user:
            if existing_user.role not in (models.UserRole.PLATFORM_ADMIN, models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR):
                existing_user.role = models.UserRole.STUDENT
            if not existing_user.organization_id:
                existing_user.organization_id = student_org.id
            if clerk_id:
                existing_user.clerk_user_id = clerk_id
            db.commit()

            # Ensure StudentProfile exists
            prof = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == existing_user.id).first()
            if not prof:
                prof = models.StudentProfile(
                    user_id=existing_user.id,
                    organization_id=existing_user.organization_id or student_org.id,
                    email=existing_user.email,
                    full_name=existing_user.email.split('@')[0].replace('.', ' ').replace('_', ' ').title(),
                    target_role="Software Engineer"
                )
                db.add(prof)
                db.commit()

            access_token = utils.create_access_token(data={"sub": existing_user.email, "role": existing_user.role})
            return {"access": access_token, "token_type": "bearer"}
        else:
            # Provision new student account
            new_student = models.User(
                email=email,
                role=models.UserRole.STUDENT,
                hashed_password=utils.get_password_hash("clerk_student_user"),
                is_active=True,
                organization_id=student_org.id,
                clerk_user_id=clerk_id
            )
            db.add(new_student)
            db.commit()
            db.refresh(new_student)

            prof = models.StudentProfile(
                user_id=new_student.id,
                organization_id=student_org.id,
                email=email,
                full_name=email.split('@')[0].replace('.', ' ').replace('_', ' ').title(),
                target_role="Software Engineer"
            )
            db.add(prof)
            db.commit()

            access_token = utils.create_access_token(data={"sub": new_student.email, "role": models.UserRole.STUDENT})
            return {"access": access_token, "token_type": "bearer"}

    # 5. ATTEMPTED ADMIN ACCESS WITHOUT PROVISIONED MEMBERSHIP
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Your account has not been provisioned for the PrepWin enterprise recruitment workspace. Please contact your organization administrator."
    )

# Dependency
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login/")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(database.get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, utils.SECRET_KEY, algorithms=[utils.ALGORITHM])
        email: str = payload.get("sub")
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
    return user

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
    elif current_user.role == models.UserRole.PLATFORM_ADMIN:
        if current_user.organization_id:
            org = db.query(models.Organization).filter(models.Organization.id == current_user.organization_id).first()
        if not org:
            org = db.query(models.Organization).filter(models.Organization.status == "active").first()
        if not org:
            org = db.query(models.Organization).first()
        if not org:
            org = models.Organization(
                name="ThirdEye Data",
                slug="thirdeyedata",
                status="active"
            )
            db.add(org)
            db.commit()
            db.refresh(org)
            current_user.organization_id = org.id
            db.commit()

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

def require_platform_admin(
    current_user: models.User = Depends(get_current_user)
) -> models.User:
    """Security check: Ensures only explicit Platform Admin can execute platform operations."""
    if current_user.role != models.UserRole.PLATFORM_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform administrator privileges required."
        )
    return current_user

def require_organization_admin(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.User:
    """Security check: Ensures user is an Organization Admin or Platform Admin."""
    if current_user.role == models.UserRole.PLATFORM_ADMIN:
        return current_user

    member = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == current_user.id,
        models.OrganizationMember.status == "active"
    ).first()

    if not member or member.role != "ORGANIZATION_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization administrator privileges required."
        )
    return current_user

def require_hr_or_admin(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
) -> models.User:
    """Security check: Ensures user is an authorized recruiter (HR, Org Admin, or Platform Admin)."""
    if current_user.role in (models.UserRole.CANDIDATE, models.UserRole.STUDENT) or current_user.email.endswith(".internal"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidates and students are not permitted to access recruiter tools."
        )

    if current_user.role == models.UserRole.PLATFORM_ADMIN:
        return current_user

    member = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == current_user.id,
        models.OrganizationMember.status == "active"
    ).first()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has not been invited to HiringAI. Please contact your organization administrator."
        )

    return current_user

@router.get("/me")
def get_current_user_profile(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Returns the authenticated user's profile, role, and resolved organization details.
    """
    if current_user.role == models.UserRole.PLATFORM_ADMIN:
        return {
            "user_id": current_user.id,
            "email": current_user.email,
            "role": "PLATFORM_ADMIN",
            "organization_id": None,
            "organization_name": None,
            "organization_slug": None
        }

    if current_user.role == models.UserRole.CANDIDATE or current_user.email.endswith(".internal"):
        return {
            "user_id": current_user.id,
            "email": current_user.email,
            "role": "CANDIDATE",
            "organization_id": None,
            "organization_name": None,
            "organization_slug": None
        }

    if current_user.role == models.UserRole.STUDENT or current_user.student_profile:
        return {
            "user_id": current_user.id,
            "email": current_user.email,
            "role": "STUDENT",
            "organization_id": current_user.organization_id,
            "organization_name": "PrepWin Student Assessment Hub",
            "organization_slug": "roleready-students"
        }

    member = db.query(models.OrganizationMember).filter(
        models.OrganizationMember.user_id == current_user.id,
        models.OrganizationMember.status == "active"
    ).first()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has not been invited to HiringAI. Please contact your organization administrator."
        )

    org = db.query(models.Organization).filter(models.Organization.id == member.organization_id).first()
    if not org or org.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your organization account is inactive or suspended. Please contact your administrator."
        )

    role_str = member.role
    if role_str in (models.UserRole.HR_ADMIN, models.UserRole.SUPER_ADMIN):
        role_str = "ORGANIZATION_ADMIN"

    return {
        "user_id": current_user.id,
        "email": current_user.email,
        "role": role_str,
        "organization_id": org.id,
        "organization_name": org.name,
        "organization_slug": org.slug
    }

