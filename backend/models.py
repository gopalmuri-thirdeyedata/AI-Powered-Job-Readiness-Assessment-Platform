from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, JSON, Float, DateTime, Text, Enum as SqlEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base

class UserRole(str, enum.Enum):
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    ORGANIZATION_ADMIN = "ORGANIZATION_ADMIN"
    HR = "HR"
    CANDIDATE = "CANDIDATE"
    # Backward compatibility aliases
    SUPER_ADMIN = "SUPER_ADMIN"
    HR_ADMIN = "HR_ADMIN"
    INTERVIEWER = "INTERVIEWER"

class OrganizationStatus(str, enum.Enum):
    active = "active"
    deactivated = "deactivated"

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    slug = Column(String(150), unique=True, index=True, nullable=False)
    clerk_org_id = Column(String(150), unique=True, index=True, nullable=True)
    status = Column(String(50), default="active", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    members = relationship("OrganizationMember", back_populates="organization", cascade="all, delete-orphan")

class OrganizationMember(Base):
    __tablename__ = "organization_members"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    clerk_user_id = Column(String(150), index=True, nullable=True)
    role = Column(String(50), default="HR", nullable=False) # ORGANIZATION_ADMIN, HR
    status = Column(String(50), default="active", nullable=False) # active, pending, deactivated
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    organization = relationship("Organization", back_populates="members")
    user = relationship("User")

class AssessmentType(str, enum.Enum):
    aptitude = "aptitude"
    coding = "coding"
    interview = "interview"

class AssessmentStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    failed = "failed"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(150), unique=True, index=True)
    hashed_password = Column(String(255))
    role = Column(String(50), default=UserRole.CANDIDATE) # Stores enum value as string
    is_active = Column(Boolean, default=True)
    password_changed = Column(Boolean, default=False)
    company_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    clerk_user_id = Column(String(150), index=True, nullable=True)

    assessments = relationship("Assessment", back_populates="user")
    memberships = relationship("OrganizationMember", back_populates="user")

class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(Integer, primary_key=True, index=True)
    candidate_email = Column(String(150), index=True)
    type = Column(String(50)) # Stores AssessmentType as string
    config = Column(JSON, default={})
    status = Column(String(50), default=AssessmentStatus.pending)
    score = Column(Float, default=0.0)
    analysis_data = Column(JSON, nullable=True)
    question_source = Column(String(50), default="ai") # 'ai' or 'manual'
    submission_data = Column(JSON, nullable=True) # Candidate raw submissions
    evaluation_details = Column(JSON, nullable=True) # Question-level breakdown
    
    user_id = Column(Integer, ForeignKey("users.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="assessments")

# Resume Screening Models
class CandidateStatus(str, enum.Enum):
    Applied = "Applied"
    In_Progress = "In Progress"
    Hired = "Hired"
    Rejected = "Rejected"

class CandidateStage(str, enum.Enum):
    Resume_Screening = "Resume Screening"
    Aptitude_Round = "Aptitude Round"
    Coding_Round = "Coding Round"
    Technical_Interview = "Technical Interview"
    HR_Round = "HR Round"
    Offer_Sent = "Offer Sent"

class JobDescription(Base):
    __tablename__ = "job_descriptions"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200))
    role = Column(String(200), nullable=True)
    description = Column(Text)
    required_skills = Column(JSON, nullable=True)
    preferred_skills = Column(JSON, nullable=True)
    responsibilities = Column(Text, nullable=True)
    experience_requirements = Column(String(200), nullable=True)
    specific_targets = Column(Text, nullable=True)
    expected_achievements = Column(Text, nullable=True)
    additional_requirements = Column(Text, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    target_capacity = Column(Integer, default=50)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    organization = relationship("Organization", foreign_keys=[organization_id])

class Candidate(Base):
    __tablename__ = "candidates"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), default="Unknown Candidate")
    email = Column(String(150), unique=True, index=True)
    role = Column(String(100))
    status = Column(String(50), default=CandidateStatus.Applied)
    stage = Column(String(50), default=CandidateStage.Resume_Screening)
    resume_file = Column(String(255), nullable=True) # File path
    full_text = Column(Text, nullable=True) # Full resume text for screening
    phone = Column(String(50), nullable=True)  # Phone from resume
    score = Column(Float, default=0.0)
    analysis_data = Column(JSON, nullable=True) # AI Breakdown
    hashed_password = Column(String(255), nullable=True) # Added for separate auth
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True) # Owner HR user
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    organization = relationship("Organization", foreign_keys=[organization_id])

class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    action = Column(String(100))
    target = Column(String(255))
    details = Column(Text, nullable=True)
    is_read = Column(Boolean, default=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

class GlobalSettings(Base):
    __tablename__ = "global_settings"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(50), index=True, default="default")
    config = Column(JSON, default={})
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True) # Owner HR user
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(200))
    message = Column(Text)
    is_read = Column(Boolean, default=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
