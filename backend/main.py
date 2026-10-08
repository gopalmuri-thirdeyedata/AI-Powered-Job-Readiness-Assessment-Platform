from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

load_dotenv()

import models, database
from routers import auth, assessments, resume, dashboard, settings, interview, proctor, platform, organization

app = FastAPI(title="HiringAI Enterprise API")

# Mount media directory for resume files
os.makedirs("media/resumes", exist_ok=True)
app.mount("/media", StaticFiles(directory="media"), name="media")

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

@app.get("/")
def read_root():
    return {"message": "HiringAI Backend is running on FastAPI!"}
