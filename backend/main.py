from fastapi import FastAPI, Request, Depends, HTTPException, status, Header, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from jose import jwt, JWTError

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(env_path)
load_dotenv()

import models, database, utils
from routers import auth, assessments, resume, dashboard, settings, interview, proctor, platform, organization, student, college, roleready
from routers import job_assessments, public_assessment, admin_results

# Validate JWT secret configuration on startup (fails safely in production if secret is weak/default)
utils.validate_jwt_secret()

app = FastAPI(title="PrepWin — AI-Powered Job Readiness & Assessment Platform API")

# Ensure required storage directories exist
os.makedirs("media/resumes", exist_ok=True)
os.makedirs("media/student_resumes", exist_ok=True)
os.makedirs("media/roleready", exist_ok=True)

@app.get("/media/resumes/{file_path:path}", tags=["resumes"])
def get_recruiter_resume(
    file_path: str,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    db: Session = Depends(database.get_db)
):
    """
    Secure endpoint for downloading recruiter candidate resumes:
    1. Rejects unauthenticated requests with HTTP 401.
    2. Prevents directory traversal attacks with HTTP 400.
    3. Enforces organization tenant boundaries (HTTP 403 on cross-tenant access).
    4. Restricts access to authorized Recruiters/HR, Platform Admins, or Candidate owners.
    """
    # 1. Resolve authentication token (Header Bearer token or Query token for browser iframe/window.open)
    token_str = None
    if authorization and authorization.startswith("Bearer "):
        token_str = authorization.split(" ", 1)[1].strip()
    elif token:
        token_str = token.strip()

    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to access candidate resumes."
        )

    # 2. Authenticate user credentials
    try:
        payload = jwt.decode(token_str, utils.get_secret_key(), algorithms=[utils.ALGORITHM])
        email = payload.get("sub")
        scope = payload.get("scope")
        token_file = payload.get("file_path")
        if not email:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired. Please refresh your view."
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials."
        )

    # 3. Path traversal defense
    base_dir = Path("media/resumes").resolve()
    target_path = (base_dir / file_path).resolve()
    if ".." in file_path or not str(target_path).startswith(str(base_dir)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path.")

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume file not found.")

    # Validate scoped preview token binding
    if scope == "resume_preview":
        clean_target = target_path.name
        clean_token_file = Path(token_file or "").name
        if clean_token_file != clean_target and token_file != file_path:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Scoped token does not match the requested resume file."
            )

    # 4. Role-based & Tenant authorization check
    if getattr(user, "role", None) != models.UserRole.PLATFORM_ADMIN:
        user_role = getattr(user, "role", None)
        if user_role == models.UserRole.STUDENT:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Students cannot access recruiter candidate resumes."
            )

        filename = target_path.name
        cand = db.query(models.Candidate).filter(
            or_(
                models.Candidate.resume_file == filename,
                models.Candidate.resume_file == file_path,
                models.Candidate.resume_file.endswith("/" + filename)
            )
        ).first()

        if cand:
            if user_role in (models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR_ADMIN, models.UserRole.HR):
                if user.organization_id and cand.organization_id and user.organization_id != cand.organization_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied: You do not have permission to access another organization's candidate resumes."
                    )
            elif user_role == models.UserRole.CANDIDATE:
                if user.email != cand.email:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied: You cannot access other candidates' resumes."
                    )
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: Insufficient permissions to view candidate resumes."
                )
        else:
            if user_role not in (models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR_ADMIN, models.UserRole.HR):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: Insufficient permissions to view candidate resumes."
                )

    # 5. Safe file return with Cache and Referrer protections
    ext = target_path.suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".txt": "text/plain"
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=str(target_path),
        filename=target_path.name,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "Pragma": "no-cache",
            "Expires": "0",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff"
        }
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Log sanitized error without returning sensitive request bodies in client responses
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )

# Database Init
def create_tables_with_retry(attempts: int = 8) -> None:
    """
    Several server workers start at the same moment. On a brand-new database each one tries to create the same
    tables, and the loser used to crash with "table already exists" / "schema has changed" (the container then
    restarted). The tables exist by the next try, so the loser simply tries again.
    """
    import random
    import time
    from sqlalchemy.exc import OperationalError

    for attempt in range(attempts):
        try:
            models.Base.metadata.create_all(bind=database.engine)
            return
        except OperationalError as exc:
            message = str(exc).lower()
            transient = any(text in message for text in ("already exists", "schema has changed", "database is locked"))
            if not transient or attempt == attempts - 1:
                raise
            time.sleep(0.2 + random.random() * 0.6)


create_tables_with_retry()

# Shared-link expiry column: one nullable ADD COLUMN, idempotent. Without it every job-role query would fail on an older database.
try:
    import migrate_share_link_expiry
    migrate_share_link_expiry.apply(database.engine)
except Exception as _exc:  # never block startup; the schema guard below / the migration script report it
    print(f"[Startup Note] share-link expiry column check: {_exc}")

# CORS Configuration — Production Environment Driven
cors_origins_env = os.getenv("CORS_ORIGINS", "").strip()
if cors_origins_env:
    allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
else:
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").strip()
    allowed_origins = list(dict.fromkeys([
        frontend_url,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:80",
        "http://127.0.0.1:80",
        "http://localhost:8212",
        "http://127.0.0.1:8212"
    ]))

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auto-seed default Platform Admin & primary organization for direct authentication
@app.on_event("startup")
def warm_up_proctoring_model():
    """Load the person-detection model in the background so no candidate frame has to wait for it."""
    try:
        from services import proctor_service
        proctor_service.start_warm_up_in_background()
    except Exception as e:  # never stop the server from starting
        print(f"[Startup] Proctoring warm-up skipped: {e}")


@app.on_event("startup")
def ensure_default_platform_admin():
    try:
        with database.SessionLocal() as db:
            # 1. Ensure primary enterprise organization exists
            default_org = db.query(models.Organization).filter_by(slug="thirdeyedata").first()
            if not default_org:
                default_org = db.query(models.Organization).first()
            if not default_org:
                default_org = models.Organization(
                    name="ThirdEye Data",
                    slug="thirdeyedata",
                    status="active"
                )
                db.add(default_org)
                db.commit()
                db.refresh(default_org)
                print(f"[Startup] Provisioned Primary Organization: {default_org.name} (id={default_org.id})")
            elif default_org.status != "active":
                default_org.status = "active"
                db.commit()

            # 2. Ensure Platform Admin user exists
            admin_email = "admin@thirdeyedata.ai"
            default_pass = os.getenv("ADMIN_DEFAULT_PASSWORD", "ThirdEyeAdmin@2026!").strip()
            admin = db.query(models.User).filter(func.lower(models.User.email) == admin_email).first()
            if not admin:
                admin = models.User(
                    email=admin_email,
                    role=models.UserRole.PLATFORM_ADMIN,
                    hashed_password=utils.get_password_hash(default_pass),
                    is_active=True,
                    organization_id=default_org.id
                )
                db.add(admin)
                db.commit()
                db.refresh(admin)
                print(f"[Startup] Provisioned Platform Admin: {admin_email}")
            else:
                updated = False
                if admin.role != models.UserRole.PLATFORM_ADMIN:
                    admin.role = models.UserRole.PLATFORM_ADMIN
                    updated = True
                if not admin.is_active:
                    admin.is_active = True
                    updated = True
                if admin.organization_id != default_org.id:
                    admin.organization_id = default_org.id
                    updated = True
                if updated:
                    db.commit()
                    db.refresh(admin)

            # 3. Ensure OrganizationMember entry for Platform Admin
            member = db.query(models.OrganizationMember).filter(
                models.OrganizationMember.user_id == admin.id,
                models.OrganizationMember.organization_id == default_org.id
            ).first()
            if not member:
                member = models.OrganizationMember(
                    user_id=admin.id,
                    organization_id=default_org.id,
                    role="ORGANIZATION_ADMIN",
                    status="active"
                )
                db.add(member)
                db.commit()
            elif member.status != "active":
                member.status = "active"
                db.commit()

            # 4. Connect unlinked candidate and student records to the primary organization
            db.query(models.Candidate).filter(models.Candidate.organization_id == None).update(
                {"organization_id": default_org.id}, synchronize_session=False
            )
            db.query(models.StudentProfile).filter(models.StudentProfile.organization_id == None).update(
                {"organization_id": default_org.id}, synchronize_session=False
            )
            db.query(models.RoleReadySession).filter(models.RoleReadySession.organization_id == None).update(
                {"organization_id": default_org.id}, synchronize_session=False
            )
            db.commit()
    except Exception as e:
        print(f"[Startup Note] Platform Admin initialization: {e}")

# Recruitment workflow: schema guard + background sweeper (immediate catch-up on startup, then every 60s)
import asyncio
import logging

_sweeper_stop = None
_sweeper_task = None


def _recruitment_schema_ready() -> bool:
    from sqlalchemy import inspect as sa_inspect
    try:
        insp = sa_inspect(database.engine)
        needed = {"share_token", "blueprint_data", "status", "share_link_expires_at"}
        have_jd = {c["name"] for c in insp.get_columns("job_descriptions")}
        have_sess = {c["name"] for c in insp.get_columns("roleready_sessions")}
        return needed <= have_jd and "registration_id" in have_sess and "overall_deadline_at" in have_sess
    except Exception:
        return False


@app.on_event("startup")
async def start_assessment_sweeper():
    global _sweeper_stop, _sweeper_task
    if not _recruitment_schema_ready():
        logging.getLogger("prepwin").warning(
            "Recruitment workflow schema is not migrated. Run `python migrate_recruitment_workflow.py` "
            "(it takes a verified backup first). The assessment sweeper is NOT started.")
        return
    if os.getenv("ASSESSMENT_SWEEPER_ENABLED", "true").strip().lower() in ("0", "false", "no"):
        return
    from services import assessment_sweeper_service as sweeper_service
    from starlette.concurrency import run_in_threadpool
    try:
        # Reconcile any recorded-but-unreconciled outage first so affected candidates are never mislabelled.
        def _reconcile():
            with database.SessionLocal() as db:
                return sweeper_service.reconcile_infrastructure_failures(db)
        await run_in_threadpool(_reconcile)
    except Exception as exc:
        logging.getLogger("prepwin").warning("Startup incident reconciliation skipped: %s", type(exc).__name__)
    _sweeper_stop = asyncio.Event()
    _sweeper_task = asyncio.create_task(sweeper_service.sweeper_loop(_sweeper_stop))


@app.on_event("shutdown")
async def stop_assessment_sweeper():
    if _sweeper_stop is not None:
        _sweeper_stop.set()
    if _sweeper_task is not None:
        try:
            await asyncio.wait_for(_sweeper_task, timeout=5)
        except Exception:
            pass


# Health Check Endpoints (Phase 20)
@app.get("/health/live", tags=["health"])
def health_live():
    """Liveness probe: verifies process is alive."""
    return {"status": "alive", "service": "HiringAI API"}

@app.get("/health/ready", tags=["health"])
def health_ready():
    """Readiness probe: verifies database connectivity."""
    try:
        from sqlalchemy.sql import text
        with database.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready", "database": "connected"}
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "database": "disconnected"}
        )

# Routers
app.include_router(auth.router)
app.include_router(platform.router)
app.include_router(organization.router)
app.include_router(assessments.router)
app.include_router(resume.router)
app.include_router(dashboard.router)
app.include_router(settings.router)
app.include_router(interview.router)
app.include_router(proctor.router)
app.include_router(student.router)
app.include_router(college.router)
app.include_router(roleready.router)
app.include_router(job_assessments.router)
app.include_router(public_assessment.router)
app.include_router(admin_results.router)

@app.get("/")
def read_root():
    return {"message": "PrepWin API is running on FastAPI!"}
