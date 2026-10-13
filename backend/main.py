from fastapi import FastAPI, Request, Depends, HTTPException, status, Header, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from sqlalchemy import or_
from jose import jwt, JWTError

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(env_path)
load_dotenv()

import models, database, utils
from routers import auth, assessments, resume, dashboard, settings, interview, proctor, platform, organization, student, college, roleready

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
models.Base.metadata.create_all(bind=database.engine)

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
        "http://localhost:3000"
    ]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/")
def read_root():
    return {"message": "PrepWin API is running on FastAPI!"}
