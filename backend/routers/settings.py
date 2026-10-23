from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models
from routers.auth import get_current_user, require_organization_admin_context, TenantContext
from pydantic import BaseModel
from typing import Dict, Any

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"]
)

class SettingsUpdate(BaseModel):
    config: Dict[str, Any]

DEFAULT_CONFIG = {
    "orgName": "My Organization",
    "timezone": "UTC",
    "pipeline": {
        "stages": ["Resume Screening", "Aptitude Round", "Coding Round", "Technical Interview", "Offer Sent"],
        "autoReject": False
    },
    "scoring": {
        "skills": 40,
        "experience": 25,
        "projects": 20,
        "education": 10,
        "bonus": 5
    },
    "assessments": {
        "aptitudeDuration": 30,
        "aptitudePassingScore": 60,
        "codingDuration": 45,
        "interviewDuration": 15,
        "allowedLanguages": ["Python", "JavaScript"]
    },
    "roles": [
        "Full Stack Software Engineer",
        "Frontend Developer",
        "Backend Developer",
        "Python Developer"
    ],
    "emails": {
        "invitationSubject": "Invitation to Assessment Round - HiringAI",
        "invitationBody": "Dear Candidate,\n\nYou have been promoted to the next stage of our recruitment process. Please log in to the portal to take your assessment.",
        "reminderSubject": "Reminder: Pending Assessment - HiringAI",
        "reminderBody": "Dear Candidate,\n\nThis is a friendly reminder to complete your pending assessment as soon as possible."
    },
    "security": {
        "faceProctoring": True,
        "fullscreenProctoring": True,
        "autoFlagSuspicious": True
    },
    "notifications": {
        "emailAlerts": True,
        "slackIntegration": False,
        "weeklyDigest": True,
        "recipientEmail": "admin@thirdeyedata.ai"
    }
}

@router.get("/")
def get_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Resolve Candidate shadow user to their candidate organization
    creator_id = current_user.id
    target_org_id = getattr(current_user, "organization_id", None) or getattr(current_user, "company_id", None)

    if current_user.email.endswith('.internal') or current_user.role == "CANDIDATE" or current_user.role == "candidate":
        try:
            if '_' in current_user.email and '@' in current_user.email:
                cand_id_str = current_user.email.split('_')[1].split('@')[0]
                candidate_id = int(cand_id_str)
                candidate = db.query(models.Candidate).filter(models.Candidate.id == candidate_id).first()
                if candidate:
                    if candidate.organization_id:
                        target_org_id = candidate.organization_id
                    if candidate.created_by:
                        creator_id = candidate.created_by
        except Exception as e:
            print(f"Failed to resolve settings creator for shadow user {current_user.email}: {e}")

    # Fallback to organization membership if org_id is not set directly on user
    if not target_org_id and not (current_user.email.endswith('.internal') or current_user.role == "CANDIDATE"):
        member = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.user_id == current_user.id
        ).first()
        if member:
            target_org_id = member.organization_id

    # 1. Look up by organization_id first if available
    settings = None
    if target_org_id:
        settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.organization_id == target_org_id
        ).first()

    # 2. Fallback to creator_id for backward compatibility
    if not settings:
        settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.created_by == creator_id
        ).first()

    if not settings:
        settings = models.GlobalSettings(
            key=f"org_{target_org_id}" if target_org_id else f"user_{creator_id}",
            config=DEFAULT_CONFIG,
            created_by=creator_id,
            organization_id=target_org_id
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    else:
        config = dict(settings.config)
        modified = False
        # Merge any missing sections from defaults
        for key in ["scoring", "assessments", "roles", "emails", "security", "notifications"]:
            if key not in config:
                config[key] = DEFAULT_CONFIG[key]
                modified = True
        if modified:
            settings.config = config
            db.commit()

    return settings.config

@router.put("/")
def update_settings(
    settings_update: SettingsUpdate,
    db: Session = Depends(get_db),
    tenant_context: TenantContext = Depends(require_organization_admin_context)
):
    current_user = tenant_context.user
    target_org_id = tenant_context.tenant_id

    db_settings = None
    if target_org_id:
        db_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.organization_id == target_org_id
        ).first()

    if not db_settings:
        db_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.created_by == current_user.id
        ).first()

    if not db_settings:
        db_settings = models.GlobalSettings(
            key=f"org_{target_org_id}" if target_org_id else f"user_{current_user.id}",
            config=settings_update.config,
            created_by=current_user.id,
            organization_id=target_org_id
        )
        db.add(db_settings)
    else:
        db_settings.config = settings_update.config
        if target_org_id and not db_settings.organization_id:
            db_settings.organization_id = target_org_id

    db.commit()
    return {"message": "Settings updated", "config": db_settings.config}
