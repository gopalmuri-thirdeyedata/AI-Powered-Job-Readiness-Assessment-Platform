from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, String, JSON, Float, DateTime, Text, UniqueConstraint, text
from sqlalchemy.dialects.mysql import MEDIUMTEXT, DATETIME as MYSQL_DATETIME
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base

# Whole-second DATETIME on MySQL would round deadlines (strict 10.0s/10.1s arrival-window boundary) and break the
# sweeper's lease-fencing equality (sweeper_claimed_at = :claimed_at). Recruitment timestamps keep microseconds there.
PreciseDateTime = DateTime(timezone=True).with_variant(MYSQL_DATETIME(fsp=6), "mysql")


class UserRole(str, enum.Enum):
    """
    Canonical roles (the only values stored for login accounts):
      SUPER_ADMIN  platform owner: creates Student, Admin and Super Admin accounts; platform-level operations
      ADMIN        organization administrator: creates Student accounts only
      STUDENT      student / assessment taker
    CANDIDATE is the internal shadow account of a candidate-portal invitation; it can never sign in with a password.
    """
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    STUDENT = "STUDENT"

    # Backward-compatibility aliases (same stored value as the canonical role they name)
    PLATFORM_ADMIN = "SUPER_ADMIN"
    ORGANIZATION_ADMIN = "ADMIN"
    HR = "ADMIN"
    RECRUITER = "ADMIN"
    HR_ADMIN = "ADMIN"
    INTERVIEWER = "ADMIN"
    CANDIDATE = "CANDIDATE"


ADMIN_ROLES = (UserRole.ADMIN.value, UserRole.SUPER_ADMIN.value)


def is_admin_role(role) -> bool:
    """ADMIN or SUPER_ADMIN (every administrative surface); never true for STUDENT / CANDIDATE / unknown values."""
    return str(getattr(role, "value", role)) in ADMIN_ROLES


def is_super_admin_role(role) -> bool:
    return str(getattr(role, "value", role)) == UserRole.SUPER_ADMIN.value

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
    role = Column(String(50), default="ADMIN", nullable=False) # ADMIN, STUDENT
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
    role = Column(String(50), default=UserRole.STUDENT) # Stores enum value as string (ADMIN, STUDENT)
    is_active = Column(Boolean, default=True)
    password_changed = Column(Boolean, default=False)
    company_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    clerk_user_id = Column(String(150), index=True, nullable=True)  # legacy (Clerk era): kept as an inert column, never read for authentication
    # Local authentication profile (admin-managed accounts)
    full_name = Column(String(150), nullable=True)
    phone = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    assessments = relationship("Assessment", back_populates="user")
    memberships = relationship("OrganizationMember", back_populates="user")


class AuthSession(Base):
    """
    Server-side login session behind the HttpOnly session cookie. Only the SHA-256 of the opaque cookie value is stored, so a
    database leak does not leak usable sessions. Revocation (logout, password change/reset, deactivation) is a row update.
    """
    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    csrf_token = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)

    user = relationship("User")

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

    # Admin Recruitment Workflow: published assessment + reusable shared link
    is_published = Column(Boolean, default=False, server_default=text("0"), nullable=False)
    share_token = Column(String(64), unique=True, index=True, nullable=True)
    status = Column(String(30), default="DRAFT", server_default="DRAFT", nullable=False)  # DRAFT, PUBLISHED, CLOSED
    # Shared-link expiry (UTC, server clock): issued_at + 24 h. NULL = legacy link issued before expiry existed (never auto-expired).
    share_link_expires_at = Column(DateTime(timezone=True), nullable=True)
    blueprint_data = Column(JSON, nullable=True)
    blueprint_version = Column(Integer, default=0, server_default=text("0"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    organization = relationship("Organization", foreign_keys=[organization_id])


class JobShareLinkHistory(Base):
    """A superseded shared link. Kept (never deleted) so its URL keeps answering 410 "expired" instead of 404."""
    __tablename__ = "job_share_link_history"
    id = Column(Integer, primary_key=True, index=True)
    job_description_id = Column(Integer, ForeignKey("job_descriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    share_token = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    retired_at = Column(DateTime(timezone=True), server_default=func.now())

class Candidate(Base):
    __tablename__ = "candidates"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), default="Unknown Candidate")
    email = Column(String(150), index=True)
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

    # Email uniqueness is per organization and normalization-aware (LOWER(TRIM(email))), enforced by the engine.
    # The parenthesised text expression is valid for SQLite (3.9+) and MySQL 8.0.13+ functional key parts.
    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uix_org_candidate_email"),
        Index("uix_org_cand_norm_email", "organization_id", text("(lower(trim(email)))"), unique=True),
    )

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


# ==============================================================================
# STUDENT CAREER & PLACEMENT MODELS (PHASE 1)
# ==============================================================================

class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    
    full_name = Column(String(150), default="Student", nullable=False)
    email = Column(String(150), index=True, nullable=False)
    phone = Column(String(50), nullable=True)
    college_name = Column(String(200), nullable=True)
    branch = Column(String(100), nullable=True)
    graduation_year = Column(Integer, nullable=True)
    cgpa = Column(Float, nullable=True)
    
    target_role = Column(String(100), default="Software Engineer", nullable=False)
    target_company = Column(String(100), nullable=True)
    
    current_skills = Column(JSON, default=[], nullable=True)
    education_data = Column(JSON, nullable=True)
    experience_data = Column(JSON, nullable=True)
    projects_data = Column(JSON, nullable=True)
    
    readiness_score = Column(Float, default=0.0)
    readiness_breakdown = Column(JSON, default={}, nullable=True)
    
    is_onboarded = Column(Boolean, default=False, nullable=False)
    onboarding_step = Column(Integer, default=1, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    user = relationship("User", backref="student_profile")
    organization = relationship("Organization")
    resumes = relationship("StudentResume", back_populates="student_profile", cascade="all, delete-orphan", order_by="desc(StudentResume.version)")


class StudentResume(Base):
    __tablename__ = "student_resumes"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    file_path = Column(String(255), nullable=False)
    file_name = Column(String(255), nullable=False)
    full_text = Column(Text, nullable=True)
    
    overall_score = Column(Float, default=0.0)
    ats_score = Column(Float, default=0.0)
    
    # 9-dimension structured analysis data
    analysis_data = Column(JSON, nullable=True)
    strengths = Column(JSON, default=[], nullable=True)
    weaknesses = Column(JSON, default=[], nullable=True)
    missing_information = Column(JSON, default=[], nullable=True)
    recommendations = Column(JSON, default=[], nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student_profile = relationship("StudentProfile", back_populates="resumes")


class StudentRoadmap(Base):
    __tablename__ = "student_roadmaps"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    target_role = Column(String(100), nullable=False)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    total_weeks = Column(Integer, default=4, nullable=False)
    current_week = Column(Integer, default=1, nullable=False)
    status = Column(String(30), default="ACTIVE", nullable=False)  # ACTIVE, COMPLETED, ARCHIVED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    student_profile = relationship("StudentProfile", backref="roadmaps")
    organization = relationship("Organization")
    tasks = relationship("StudentDailyTask", back_populates="roadmap", cascade="all, delete-orphan")


class StudentDailyTask(Base):
    __tablename__ = "student_daily_tasks"

    id = Column(Integer, primary_key=True, index=True)
    roadmap_id = Column(Integer, ForeignKey("student_roadmaps.id", ondelete="CASCADE"), index=True, nullable=False)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    week_number = Column(Integer, nullable=False)
    day_number = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), default="TECHNICAL_SKILL", nullable=False)  # DSA, APTITUDE, TECHNICAL_SKILL, SYSTEM_DESIGN, RESUME, MOCK_INTERVIEW
    why_recommended = Column(Text, nullable=True)
    estimated_minutes = Column(Integer, default=45, nullable=False)
    status = Column(String(30), default="PENDING", nullable=False)  # PENDING, IN_PROGRESS, COMPLETED, SKIPPED
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    roadmap = relationship("StudentRoadmap", back_populates="tasks")
    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")


class StudentPracticeQuestion(Base):
    __tablename__ = "student_practice_questions"

    id = Column(Integer, primary_key=True, index=True)
    topic = Column(String(100), index=True, nullable=False)
    category = Column(String(50), index=True, nullable=False)  # CODING, APTITUDE
    difficulty = Column(String(20), index=True, default="Medium", nullable=False)  # Easy, Medium, Hard
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)  # [{"key": "A", "text": "..."}] for MCQ
    correct_answer = Column(String(255), nullable=False)  # Kept strictly server-side
    starter_code = Column(JSON, nullable=True)  # {"python": "...", "javascript": "...", "java": "..."}
    test_cases = Column(JSON, nullable=True)  # [{"input": "...", "expected_output": "...", "is_hidden": false}]
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class StudentPracticeAttempt(Base):
    __tablename__ = "student_practice_attempts"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    question_id = Column(Integer, ForeignKey("student_practice_questions.id", ondelete="CASCADE"), index=True, nullable=False)
    category = Column(String(50), nullable=False)
    topic = Column(String(100), nullable=False)
    code_submitted = Column(Text, nullable=True)
    language = Column(String(50), nullable=True)
    selected_option = Column(String(255), nullable=True)
    is_correct = Column(Boolean, default=False, nullable=False)
    tests_passed = Column(Integer, default=0, nullable=False)
    total_tests = Column(Integer, default=0, nullable=False)
    execution_time_ms = Column(Integer, nullable=True)
    feedback = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")
    question = relationship("StudentPracticeQuestion")


class StudentMockInterview(Base):
    __tablename__ = "student_mock_interviews"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    interview_type = Column(String(50), nullable=False)  # TECHNICAL, HR, MIXED
    target_role = Column(String(100), nullable=False)
    status = Column(String(30), default="IN_PROGRESS", nullable=False)  # IN_PROGRESS, COMPLETED, ABANDONED
    overall_score = Column(Float, default=0.0, nullable=False)
    star_structure_score = Column(Float, default=0.0, nullable=False)
    technical_accuracy_score = Column(Float, default=0.0, nullable=False)
    feedback_summary = Column(Text, nullable=True)
    strengths = Column(JSON, default=[], nullable=True)
    areas_to_improve = Column(JSON, default=[], nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")
    turns = relationship("StudentMockInterviewTurn", back_populates="interview", cascade="all, delete-orphan")


class StudentMockInterviewTurn(Base):
    __tablename__ = "student_mock_interview_turns"

    id = Column(Integer, primary_key=True, index=True)
    mock_interview_id = Column(Integer, ForeignKey("student_mock_interviews.id", ondelete="CASCADE"), index=True, nullable=False)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    turn_number = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    student_response = Column(Text, nullable=True)
    feedback = Column(Text, nullable=True)
    turn_score = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("StudentMockInterview", back_populates="turns")
    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")


class StudentProject(Base):
    __tablename__ = "student_projects"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    tech_stack = Column(JSON, default=[], nullable=True)
    github_url = Column(String(500), nullable=True)
    live_url = Column(String(500), nullable=True)
    architecture_review = Column(Text, nullable=True)
    completeness_score = Column(Float, default=0.0, nullable=False)
    suggested_interview_questions = Column(JSON, default=[], nullable=True)
    recommendations = Column(JSON, default=[], nullable=True)
    bullet_point_improvements = Column(JSON, default=[], nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")


class StudentPlacementSimulation(Base):
    __tablename__ = "student_placement_simulations"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    target_role = Column(String(100), nullable=False)
    status = Column(String(30), default="IN_PROGRESS", nullable=False)  # IN_PROGRESS, COMPLETED, ABANDONED
    current_round = Column(Integer, default=1, nullable=False)  # 1: Aptitude, 2: Coding, 3: Tech Interview, 4: HR
    aptitude_score = Column(Float, default=0.0, nullable=False)
    coding_score = Column(Float, default=0.0, nullable=False)
    technical_interview_score = Column(Float, default=0.0, nullable=False)
    hr_interview_score = Column(Float, default=0.0, nullable=False)
    overall_score = Column(Float, default=0.0, nullable=False)
    report_summary = Column(Text, nullable=True)
    strengths = Column(JSON, default=[], nullable=True)
    weaknesses = Column(JSON, default=[], nullable=True)
    recommendations = Column(JSON, default=[], nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")
    rounds = relationship("StudentPlacementSimulationRound", back_populates="simulation", cascade="all, delete-orphan")


class StudentPlacementSimulationRound(Base):
    __tablename__ = "student_placement_simulation_rounds"

    id = Column(Integer, primary_key=True, index=True)
    simulation_id = Column(Integer, ForeignKey("student_placement_simulations.id", ondelete="CASCADE"), index=True, nullable=False)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    round_number = Column(Integer, nullable=False)  # 1, 2, 3, 4
    round_type = Column(String(50), nullable=False)  # APTITUDE, CODING, TECHNICAL_INTERVIEW, HR_INTERVIEW
    status = Column(String(30), default="PENDING", nullable=False)  # PENDING, IN_PROGRESS, COMPLETED
    score = Column(Float, default=0.0, nullable=False)
    round_data = Column(JSON, nullable=True)  # questions, user responses, results
    feedback = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    simulation = relationship("StudentPlacementSimulation", back_populates="rounds")
    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")


class StudentCopilotMessage(Base):
    __tablename__ = "student_copilot_messages"

    id = Column(Integer, primary_key=True, index=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    role = Column(String(20), nullable=False)  # USER, ASSISTANT, SYSTEM
    content = Column(Text, nullable=False)
    intent = Column(String(50), nullable=True)  # ROADMAP_HELP, SKILL_GAP, INTERVIEW_PREP, GENERAL
    context_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")


class PlacementDrive(Base):
    __tablename__ = "placement_drives"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    company_name = Column(String(255), nullable=False)
    role_title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    eligibility_criteria = Column(Text, nullable=True)
    minimum_cgpa = Column(Float, default=0.0, nullable=False)
    required_skills = Column(JSON, default=list, nullable=True)
    package_lpa = Column(Float, nullable=True)
    application_deadline = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(30), default="OPEN", nullable=False)  # OPEN, CLOSED, COMPLETED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    organization = relationship("Organization")
    applications = relationship("PlacementDriveApplication", back_populates="drive", cascade="all, delete-orphan")


class PlacementDriveApplication(Base):
    __tablename__ = "placement_drive_applications"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(Integer, ForeignKey("placement_drives.id", ondelete="CASCADE"), index=True, nullable=False)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    status = Column(String(30), default="APPLIED", nullable=False)  # APPLIED, SHORTLISTED, REJECTED, PLACED
    notes = Column(Text, nullable=True)
    applied_at = Column(DateTime(timezone=True), server_default=func.now())

    drive = relationship("PlacementDrive", back_populates="applications")
    student_profile = relationship("StudentProfile")
    organization = relationship("Organization")


# ==============================================================================
# PREPWIN — JOB READINESS & ASSESSMENT PLATFORM MODELS
# ==============================================================================

class RoleReadySessionState(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    APTITUDE_IN_PROGRESS = "APTITUDE_IN_PROGRESS"
    APTITUDE_SUBMITTED = "APTITUDE_SUBMITTED"
    APTITUDE_EVALUATED = "APTITUDE_EVALUATED"
    CODING_UNLOCKED = "CODING_UNLOCKED"
    CODING_IN_PROGRESS = "CODING_IN_PROGRESS"
    CODING_SUBMITTED = "CODING_SUBMITTED"
    CODING_EVALUATED = "CODING_EVALUATED"
    INTERVIEW_UNLOCKED = "INTERVIEW_UNLOCKED"
    INTERVIEW_IN_PROGRESS = "INTERVIEW_IN_PROGRESS"
    INTERVIEW_SUBMITTED = "INTERVIEW_SUBMITTED"
    INTERVIEW_EVALUATED = "INTERVIEW_EVALUATED"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"
    TIMED_OUT = "TIMED_OUT"   # the 60-minute overall deadline ended the attempt before every section was completed


class RecruitmentBatch(Base):
    __tablename__ = "recruitment_batches"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    job_description_id = Column(Integer, ForeignKey("job_descriptions.id", ondelete="SET NULL"), index=True, nullable=True)
    batch_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    total_candidates = Column(Integer, default=0, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    organization = relationship("Organization")
    job_description = relationship("JobDescription")
    invitations = relationship("CandidateInvitation", back_populates="batch", cascade="all, delete-orphan")


class CandidateInvitation(Base):
    __tablename__ = "candidate_invitations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    job_description_id = Column(Integer, ForeignKey("job_descriptions.id", ondelete="SET NULL"), index=True, nullable=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), index=True, nullable=False)
    batch_id = Column(Integer, ForeignKey("recruitment_batches.id", ondelete="CASCADE"), index=True, nullable=True)
    
    invitation_token = Column(String(128), unique=True, index=True, nullable=False)
    status = Column(String(30), default="PENDING", nullable=False)  # PENDING, ACCEPTED, EXPIRED, REVOKED
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    accepted_at = Column(DateTime(timezone=True), nullable=True)

    organization = relationship("Organization")
    candidate = relationship("Candidate")
    job_description = relationship("JobDescription")
    batch = relationship("RecruitmentBatch", back_populates="invitations")


class RoleReadySession(Base):
    __tablename__ = "roleready_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_uuid = Column(String(64), unique=True, index=True, nullable=False)
    workflow_type = Column(String(30), default="SELF_ASSESSMENT", nullable=False)  # SELF_ASSESSMENT, RECRUITER_INVITATION
    
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), index=True, nullable=True)
    invitation_id = Column(Integer, ForeignKey("candidate_invitations.id", ondelete="SET NULL"), index=True, nullable=True)
    job_description_id = Column(Integer, ForeignKey("job_descriptions.id", ondelete="SET NULL"), index=True, nullable=True)

    # Job Description context
    target_role = Column(String(200), default="Software Engineer", nullable=False)
    target_company = Column(String(200), nullable=True)
    jd_title = Column(String(255), nullable=True)
    custom_jd_text = Column(Text, nullable=True)
    extracted_jd_data = Column(JSON, nullable=True)
    
    # Resume context snapshot
    resume_snapshot = Column(JSON, nullable=True)
    resume_file_path = Column(String(255), nullable=True)
    # MEDIUMTEXT on MySQL: a 10 MB resume can extract to more than TEXT's 64 KB limit.
    resume_raw_text = Column(Text().with_variant(MEDIUMTEXT(), "mysql"), nullable=True)  # Parsed resume text (audit & report grounding)

    # State Machine & Overall Status
    current_state = Column(String(50), default="NOT_STARTED", nullable=False)
    
    # Scores (0.0 to 100.0)
    aptitude_score = Column(Float, default=0.0, nullable=False)
    coding_score = Column(Float, default=0.0, nullable=False)
    interview_score = Column(Float, default=0.0, nullable=False)
    overall_readiness_score = Column(Float, default=0.0, nullable=False)
    
    # Final consolidated job-readiness report payload
    final_report_data = Column(JSON, nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Admin Recruitment Workflow (RECRUITMENT_ASSESSMENT): single attempt per registration, enforced by the DB.
    registration_id = Column(Integer, ForeignKey("candidate_registrations.id", ondelete="SET NULL"), unique=True, index=True, nullable=True)
    overall_deadline_at = Column(PreciseDateTime, nullable=True)
    current_section_deadline_at = Column(PreciseDateTime, nullable=True)
    last_heartbeat_at = Column(PreciseDateTime, nullable=True)
    session_capability_hash = Column(String(64), nullable=True, index=True)
    active_lease_hash = Column(String(64), nullable=True)
    abandoned_at = Column(PreciseDateTime, nullable=True)
    finalized_at = Column(PreciseDateTime, nullable=True)
    failed_at = Column(PreciseDateTime, nullable=True)
    incident_reference_id = Column(String(64), nullable=True, index=True)
    sweeper_claimed_at = Column(PreciseDateTime, nullable=True)
    sweeper_worker_id = Column(String(64), nullable=True)

    organization = relationship("Organization")
    student_profile = relationship("StudentProfile")
    candidate = relationship("Candidate")
    invitation = relationship("CandidateInvitation")
    job_description = relationship("JobDescription")
    round_attempts = relationship("RoleReadyRoundAttempt", back_populates="session", cascade="all, delete-orphan", order_by="RoleReadyRoundAttempt.round_order")


class AssessmentFeedback(Base):
    """The student's written feedback on a finished assessment (at least 20 words). One per assessment attempt."""
    __tablename__ = "assessment_feedback"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("roleready_sessions.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)
    student_profile_id = Column(Integer, ForeignKey("student_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    feedback_text = Column(Text, nullable=False)
    word_count = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RoleReadyRoundAttempt(Base):
    __tablename__ = "roleready_round_attempts"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("roleready_sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    round_type = Column(String(30), nullable=False)  # APTITUDE, CODING, INTERVIEW
    round_order = Column(Integer, default=1, nullable=False)  # 1, 2, 3
    status = Column(String(30), default="PENDING", nullable=False)  # PENDING, IN_PROGRESS, SUBMITTED, EVALUATED

    score = Column(Float, default=0.0, nullable=False)
    time_limit_minutes = Column(Integer, default=30, nullable=False)
    time_spent_seconds = Column(Integer, default=0, nullable=False)

    # Question payload sent to candidate (client-safe: NO answer keys, NO hidden tests)
    questions_payload = Column(JSON, nullable=True)
    # Server-only keys (hidden tests, expected outputs, correct options - STRICTLY PRIVATE)
    server_keys_payload = Column(JSON, nullable=True)
    # Submission payload from candidate
    submission_payload = Column(JSON, nullable=True)
    # Detailed scoring breakdown & qualitative feedback
    evaluation_payload = Column(JSON, nullable=True)
    # Proctoring incidents (tab switch count, fullscreen exits, webcam flags)
    proctoring_violations = Column(JSON, default=list, nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    evaluated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("RoleReadySession", back_populates="round_attempts")


class CandidateRegistration(Base):
    """Self-reported (unverified) candidate registration against a published assessment's shared link."""
    __tablename__ = "candidate_registrations"

    id = Column(Integer, primary_key=True, index=True)
    registration_token_hash = Column(String(64), nullable=False, index=True)
    job_description_id = Column(Integer, ForeignKey("job_descriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(50), nullable=False)
    email = Column(String(150), nullable=False)
    blueprint_version = Column(Integer, nullable=True)  # blueprint version active at registration time
    attempt_session_uuid = Column(String(64), unique=True, nullable=True)
    status = Column(String(30), default="REGISTERED", nullable=False)  # REGISTERED, CONSUMED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    job_description = relationship("JobDescription", foreign_keys=[job_description_id])
    organization = relationship("Organization", foreign_keys=[organization_id])

    __table_args__ = (
        UniqueConstraint("job_description_id", "email", name="uix_jd_candidate_reg_email"),
        Index("uix_jd_reg_norm_email", "job_description_id", text("(lower(trim(email)))"), unique=True),
    )


class JobBlueprintVersion(Base):
    """Immutable archive of every blueprint version saved for a job role."""
    __tablename__ = "job_blueprint_versions"

    id = Column(Integer, primary_key=True, index=True)
    job_description_id = Column(Integer, ForeignKey("job_descriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    blueprint_data = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("job_description_id", "version", name="uix_jd_blueprint_version"),
    )


class IncidentRecord(Base):
    """Corroborated platform incident window used by post-outage reconciliation."""
    __tablename__ = "incident_records"

    id = Column(Integer, primary_key=True, index=True)
    incident_reference_id = Column(String(64), unique=True, index=True, nullable=False)
    outage_start_utc = Column(PreciseDateTime, nullable=False)
    outage_resolved_utc = Column(PreciseDateTime, nullable=False)
    affected_subsystems = Column(JSON, nullable=True)
    telemetry_evidence_ref = Column(String(255), nullable=True)
    telemetry_complete = Column(Boolean, default=True, server_default=text("1"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reconciled_at = Column(PreciseDateTime, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
