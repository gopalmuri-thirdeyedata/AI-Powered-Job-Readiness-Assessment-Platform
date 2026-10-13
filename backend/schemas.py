import enum
from typing import List, Optional, Any, Dict, Union
from datetime import datetime
from pydantic import BaseModel, EmailStr, model_validator

# Token
class Token(BaseModel):
    access: str # Match 'access' key expected by frontend
    refresh: Optional[str] = None # Optional for now
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class BulkCandidateUpdate(BaseModel):
    candidate_ids: List[int]
    stage: Optional[str] = None
    status: Optional[str] = None

# User
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    is_active: bool
    role: str
    
    class Config:
        from_attributes = True

# --- V2 Question & Assessment Schemas ---

class QuestionType(str, enum.Enum):
    MCQ = "mcq"
    TRUE_FALSE = "true_false"
    SHORT_ANSWER = "short_answer"

class ManualAptitudeQuestion(BaseModel):
    id: Optional[int] = None
    question: str
    type: str = "mcq" # 'mcq', 'true_false', 'short_answer'
    options: Optional[List[str]] = None
    correct_answer: Optional[Any] = None # index for mcq, bool for true_false, str for short_answer
    marks: Optional[int] = 1
    difficulty: Optional[str] = "Medium"
    explanation: Optional[str] = None

class CodingTestCase(BaseModel):
    id: Optional[Union[int, str]] = None
    input: Any
    expected: Optional[Any] = None
    output: Optional[Any] = None
    is_hidden: Optional[bool] = False
    explanation: Optional[str] = None

class ManualCodingQuestion(BaseModel):
    id: Optional[Union[int, str]] = None
    title: str
    description: str
    difficulty: Optional[str] = "Medium"
    marks: Optional[int] = 10
    time_limit: Optional[int] = None
    input_format: Optional[str] = None
    output_format: Optional[str] = None
    constraints: Optional[List[str]] = None
    examples: Optional[List[Dict[str, Any]]] = None
    testCases: Optional[List[CodingTestCase]] = None
    starterCode: Optional[Dict[str, str]] = None

# --- V2 Job Description Schemas ---

class JobDescriptionBase(BaseModel):
    title: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    preferred_skills: Optional[List[str]] = None
    responsibilities: Optional[str] = None
    experience_requirements: Optional[str] = None
    specific_targets: Optional[str] = None
    expected_achievements: Optional[str] = None
    additional_requirements: Optional[str] = None
    target_capacity: Optional[int] = 50

class JobDescriptionCreate(JobDescriptionBase):
    @model_validator(mode="after")
    def validate_title_or_role(self):
        if not self.title and not self.role:
            raise ValueError("Either 'title' or 'role' is required.")
        if not self.title:
            self.title = self.role
        if not self.role:
            self.role = self.title
        return self

class JobDescriptionUpdate(BaseModel):
    title: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    preferred_skills: Optional[List[str]] = None
    responsibilities: Optional[str] = None
    experience_requirements: Optional[str] = None
    specific_targets: Optional[str] = None
    expected_achievements: Optional[str] = None
    additional_requirements: Optional[str] = None
    target_capacity: Optional[int] = None

class JobDescriptionResponse(JobDescriptionBase):
    id: int
    title: str
    uploaded_at: Optional[datetime] = None
    created_by: Optional[int] = None

    class Config:
        from_attributes = True

# --- Skill Auto-Detection & Suggestion Schemas ---

class SuggestSkillsRequest(BaseModel):
    role: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    job_description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    preferred_skills: Optional[List[str]] = None
    responsibilities: Optional[str] = None
    experience_requirements: Optional[str] = None
    specific_targets: Optional[str] = None
    expected_achievements: Optional[str] = None
    additional_requirements: Optional[str] = None

class SuggestSkillsResponse(BaseModel):
    skills: List[str]
    required_skills: Optional[List[str]] = None
    preferred_skills: Optional[List[str]] = None

class ExtractSkillsRequest(BaseModel):
    job_description: Optional[str] = None
    role: Optional[str] = None
    responsibilities: Optional[str] = None

class ExtractedSkillsResponse(BaseModel):
    required_skills: List[str] = []
    preferred_skills: List[str] = []

# Assessment
class AssessmentBase(BaseModel):
    type: str # 'aptitude', 'coding', 'interview'
    config: Dict[str, Any]

class AssessmentCreateRequest(AssessmentBase):
    candidates: List[Dict[str, str]] # [{'email': '...', 'name': '...'}]
    deadline: Optional[str] = None
    question_source: Optional[str] = "ai"

class AssessmentResponse(AssessmentBase):
    id: int
    candidate_email: str
    status: str
    score: float
    analysis_data: Optional[Dict[str, Any]] = None
    question_source: Optional[str] = "ai"
    started_at: Optional[datetime] = None
    evaluation_details: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ExecutionRequest(BaseModel):
    code: str
    language: str
    question: Dict[str, Any]
    testCases: List[Dict[str, Any]]
    questionId: Optional[int] = None

class SubmissionPayload(BaseModel):
    answers: Optional[Dict[str, Any]] = None
    code: Optional[Any] = None 
    result: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    language: Optional[str] = None

class AssignResponse(BaseModel):
    message: str
    status: str
    email_errors: List[str]

# Candidate / Resume
class CandidateCreate(BaseModel):
    name: str
    email: EmailStr
    role: str
    stage: Optional[str] = "Resume Screening"
    status: Optional[str] = "Applied"

class CandidateUpdate(BaseModel):
    stage: Optional[str] = None
    status: Optional[str] = None
class CandidateResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str] = None
    role: str
    status: str
    stage: str
    score: float
    resume_file: Optional[str] = None
    analysis_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

class StatsResponse(BaseModel):
    metrics: Dict[str, int]
    funnel: Dict[str, int]

class ActivityLogResponse(BaseModel):
    user_id: Optional[int]
    action: str
    target: str
    details: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True

# --- Analytics Dashboard Schemas ---

class AnalyticsKpi(BaseModel):
    total_applicants: int = 0
    active_pipeline: int = 0
    avg_talent_score: float = 0.0
    placement_rate: float = 0.0
    pipeline_health_score: float = 0.0
    pipeline_health_status: str = "Healthy" # "Healthy", "Fair", "Needs Attention"
    applicants_trend: Optional[float] = None
    avg_score_trend: Optional[float] = None
    placement_rate_trend: Optional[float] = None

class FunnelStageMetric(BaseModel):
    name: str
    count: int = 0
    conversion_rate: float = 0.0
    drop_off_rate: float = 0.0

class AiRecommendationMetric(BaseModel):
    name: str
    count: int = 0
    percentage: float = 0.0
    color: str

class RoundPerformanceMetric(BaseModel):
    round_name: str
    candidates_count: int = 0
    completed_count: int = 0
    pending_count: int = 0
    avg_score: float = 0.0
    median_score: float = 0.0
    pass_rate: float = 0.0

class RoleInsightMetric(BaseModel):
    role: str
    total_applicants: int = 0
    evaluated_count: int = 0
    avg_score: float = 0.0
    top_candidate_name: Optional[str] = None
    top_candidate_score: Optional[float] = None
    pass_rate: float = 0.0
    pipeline_status: str = "Healthy"

class PipelineBottleneck(BaseModel):
    stage: str
    severity: str = "warning" # 'warning', 'critical', 'info'
    message: str
    affected_count: int = 0

class SkillIntelligenceItem(BaseModel):
    skill: str
    candidate_count: int = 0

class CandidateAttentionItem(BaseModel):
    id: int
    name: str
    email: str
    role: str
    stage: str
    issue: str

class AnalyticsDashboardResponse(BaseModel):
    kpi: AnalyticsKpi
    funnel: List[FunnelStageMetric] = []
    ai_recommendations: List[AiRecommendationMetric] = []
    round_performance: List[RoundPerformanceMetric] = []
    score_distribution: List[Dict[str, Any]] = []
    role_insights: List[RoleInsightMetric] = []
    bottlenecks: List[PipelineBottleneck] = []
    skills_intelligence: List[SkillIntelligenceItem] = []
    attention_items: List[CandidateAttentionItem] = []
    available_roles: List[str] = []
    date_range_label: str = "All Time"
    total_evaluated: int = 0


# ==============================================================================
# STUDENT CAREER & PLACEMENT SCHEMAS (PHASE 1)
# ==============================================================================

class StudentProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    college_name: Optional[str] = None
    branch: Optional[str] = None
    graduation_year: Optional[int] = None
    cgpa: Optional[float] = None
    target_role: Optional[str] = None
    target_company: Optional[str] = None
    current_skills: Optional[List[str]] = None

class StudentProfileResponse(BaseModel):
    id: int
    user_id: int
    organization_id: Optional[int] = None
    full_name: str
    email: str
    phone: Optional[str] = None
    college_name: Optional[str] = None
    branch: Optional[str] = None
    graduation_year: Optional[int] = None
    cgpa: Optional[float] = None
    target_role: str
    target_company: Optional[str] = None
    current_skills: List[str] = []
    readiness_score: float = 0.0
    readiness_breakdown: Optional[Dict[str, Any]] = None
    latest_resume: Optional[Dict[str, Any]] = None
    is_onboarded: bool = False
    onboarding_step: int = 1
    created_at: datetime

    class Config:
        from_attributes = True

class StudentResumeAnalysisResponse(BaseModel):
    id: int
    version: int
    file_name: str
    overall_score: float
    ats_score: float
    technical_skills: List[str] = []
    soft_skills: List[str] = []
    projects: List[Dict[str, Any]] = []
    education: List[Dict[str, Any]] = []
    experience: List[Dict[str, Any]] = []
    certifications: List[str] = []
    dsa_indicators: Dict[str, Any] = {}
    ats_compatibility: Dict[str, Any] = {}
    resume_quality: Dict[str, Any] = {}
    strengths: List[str] = []
    weaknesses: List[str] = []
    missing_information: List[str] = []
    recommendations: List[str] = []
    created_at: datetime

class PlacementReadinessResponse(BaseModel):
    indicator_title: str = "Placement Readiness Indicator"
    disclaimer: str = "This score is an automated preparation indicator to guide your learning and practice. It is not an objective guarantee of employment."
    overall_score: float
    breakdown: Dict[str, float]
    strengths: List[str]
    areas_to_improve: List[str]

class StudentDashboardResponse(BaseModel):
    student_name: str
    readiness_score: float
    resume_score: float
    target_role: str
    target_company: Optional[str] = None
    strengths: List[str] = []
    areas_to_improve: List[str] = []
    resume_recommendations: List[str] = []
    latest_resume_version: Optional[int] = None
    readiness_breakdown: Dict[str, float] = {}

# ==============================================================================
# PHASE 2: SKILL GAP & TARGET ROLES SCHEMAS
# ==============================================================================

class TargetRoleInfo(BaseModel):
    title: str
    description: str
    required_skills: List[str]
    preferred_skills: List[str]
    core_competencies: List[str] = []
    typical_interview_rounds: List[str] = []

class SkillGapAnalyzeRequest(BaseModel):
    target_role: str
    target_company: Optional[str] = None
    additional_skills: Optional[List[str]] = None

class SkillGapAnalysisResponse(BaseModel):
    target_role: str
    target_company: Optional[str] = None
    role_description: str
    match_percentage: float
    matched_skills: List[str] = []
    missing_required: List[str] = []
    missing_preferred: List[str] = []
    verified_strengths: List[str] = []
    declared_strengths: List[str] = []
    all_student_skills: List[str] = []
    required_skills_count: int
    matched_required_count: int
    preferred_skills_count: int
    matched_preferred_count: int
    recommendations: List[str] = []
    career_path_advice: Dict[str, Any] = {}
    typical_interview_rounds: List[str] = []

# ==============================================================================
# PHASE 3: ROADMAP & DAILY PREPARATION PLAN SCHEMAS
# ==============================================================================

class DailyTaskResponse(BaseModel):
    id: int
    week_number: int
    day_number: int
    title: str
    description: Optional[str] = None
    category: str
    why_recommended: Optional[str] = None
    estimated_minutes: int
    status: str
    completed_at: Optional[datetime] = None

class RoadmapWeekResponse(BaseModel):
    week_number: int
    title: str
    completed_count: int
    total_count: int
    tasks: List[DailyTaskResponse] = []

class RoadmapResponse(BaseModel):
    id: int
    target_role: str
    title: str
    summary: Optional[str] = None
    total_weeks: int
    current_week: int
    status: str
    total_tasks: int
    completed_tasks: int
    in_progress_tasks: int
    completion_rate: float
    weeks: List[RoadmapWeekResponse] = []
    created_at: datetime

class UpdateDailyTaskStatusRequest(BaseModel):
    status: str  # PENDING, IN_PROGRESS, COMPLETED, SKIPPED

class GenerateRoadmapRequest(BaseModel):
    target_role: Optional[str] = None
    regenerate: bool = False

# ==============================================================================
# PHASE 4: DSA & APTITUDE TOPIC-WISE PRACTICE SCHEMAS
# ==============================================================================

class PracticeTopicOverview(BaseModel):
    topic: str
    category: str
    total_questions: int
    solved_count: int
    completion_rate: float

class PracticeQuestionPublicResponse(BaseModel):
    id: int
    topic: str
    category: str
    difficulty: str
    title: str
    description: str
    options: Optional[List[Dict[str, Any]]] = None
    starter_code: Optional[Dict[str, str]] = None
    public_test_cases: List[Dict[str, Any]] = []
    is_solved: bool = False

class PracticeSubmissionRequest(BaseModel):
    question_id: int
    code: Optional[str] = None
    language: Optional[str] = None
    selected_option: Optional[str] = None

class PracticeSubmissionResponse(BaseModel):
    question_id: int
    is_correct: bool
    tests_passed: int
    total_tests: int
    feedback: str
    public_results: List[Dict[str, Any]] = []
    explanation: Optional[str] = None


# ==============================================================================
# PHASE 5: MOCK INTERVIEW & COMMUNICATION EVALUATION SCHEMAS
# ==============================================================================

class MockInterviewStartRequest(BaseModel):
    interview_type: str = "TECHNICAL"  # TECHNICAL, HR, MIXED
    target_role: Optional[str] = None

class MockInterviewTurnRequest(BaseModel):
    student_response: str

class MockInterviewTurnResponse(BaseModel):
    turn_number: int
    score: float
    star_score: float
    feedback: str
    strengths: List[str] = []
    improvements: List[str] = []
    next_question: Optional[str] = None
    is_finished: bool

class MockInterviewTurnDetail(BaseModel):
    id: int
    turn_number: int
    question_text: str
    student_response: Optional[str] = None
    feedback: Optional[str] = None
    turn_score: float
    created_at: datetime

class MockInterviewDetailResponse(BaseModel):
    id: int
    interview_type: str
    target_role: str
    status: str
    overall_score: float
    star_structure_score: float
    technical_accuracy_score: float
    feedback_summary: Optional[str] = None
    strengths: List[str] = []
    areas_to_improve: List[str] = []
    created_at: datetime
    completed_at: Optional[datetime] = None
    turns: List[MockInterviewTurnDetail] = []

class MockInterviewSummaryResponse(BaseModel):
    id: int
    interview_type: str
    target_role: str
    status: str
    overall_score: float
    created_at: datetime
    completed_at: Optional[datetime] = None
    turns_count: int = 0


# ==============================================================================
# PHASE 6: STUDENT PROJECTS & ARCHITECTURAL ANALYZER SCHEMAS
# ==============================================================================

class StudentProjectCreateRequest(BaseModel):
    title: str
    description: str
    tech_stack: Optional[List[str]] = []
    github_url: Optional[str] = None
    live_url: Optional[str] = None

class StudentProjectUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tech_stack: Optional[List[str]] = None
    github_url: Optional[str] = None
    live_url: Optional[str] = None

class StudentProjectResponse(BaseModel):
    id: int
    student_profile_id: int
    organization_id: int
    title: str
    description: str
    tech_stack: List[str] = []
    github_url: Optional[str] = None
    live_url: Optional[str] = None
    architecture_review: Optional[str] = None
    completeness_score: float = 0.0
    suggested_interview_questions: List[str] = []
    recommendations: List[str] = []
    bullet_point_improvements: List[str] = []
    created_at: datetime
    updated_at: datetime

class StudentProjectAnalysisResponse(BaseModel):
    id: int
    title: str
    completeness_score: float
    architecture_review: str
    suggested_interview_questions: List[str] = []
    recommendations: List[str] = []
    bullet_point_improvements: List[str] = []


# ==============================================================================
# PHASE 7: PLACEMENT SIMULATION & MULTI-FACTOR READINESS SCHEMAS
# ==============================================================================

class SimulationStartRequest(BaseModel):
    target_role: Optional[str] = None

class SimulationRoundSubmitRequest(BaseModel):
    answers: Optional[Dict[str, str]] = None
    code: Optional[str] = None
    language: Optional[str] = None
    response: Optional[str] = None

class SimulationRoundDetail(BaseModel):
    id: int
    round_number: int
    round_type: str
    status: str
    score: float
    round_data: Optional[Dict[str, Any]] = None
    feedback: Optional[str] = None
    completed_at: Optional[datetime] = None

class SimulationDetailResponse(BaseModel):
    id: int
    student_profile_id: int
    organization_id: int
    target_role: str
    status: str
    current_round: int
    aptitude_score: float
    coding_score: float
    technical_interview_score: float
    hr_interview_score: float
    overall_score: float
    report_summary: Optional[str] = None
    strengths: List[str] = []
    weaknesses: List[str] = []
    recommendations: List[str] = []
    rounds: List[SimulationRoundDetail] = []
    created_at: datetime
    completed_at: Optional[datetime] = None

class SimulationRoundSubmitResponse(BaseModel):
    round_number: int
    round_type: str
    score: float
    feedback: str
    is_simulation_finished: bool
    next_round: Optional[int] = None
    overall_score: float


# ==============================================================================
# PHASE 8: CAREER COPILOT & UNIFIED DASHBOARD SCHEMAS
# ==============================================================================

class CopilotChatRequest(BaseModel):
    content: str

class CopilotMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    intent: Optional[str] = None
    created_at: datetime

class CopilotHistoryResponse(BaseModel):
    messages: List[CopilotMessageResponse] = []
    suggestions: List[str] = []

class StudentDashboardSummaryResponse(BaseModel):
    profile: StudentProfileResponse
    readiness_score: float
    readiness_breakdown: Dict[str, float] = {}
    roadmap_progress: Dict[str, Any] = {}
    practice_stats: Dict[str, Any] = {}
    mock_interview_stats: Dict[str, Any] = {}
    project_stats: Dict[str, Any] = {}
    simulation_stats: Dict[str, Any] = {}
    copilot_suggestions: List[str] = []


# ==============================================================================
# PHASE 9: COLLEGE PLACEMENT OFFICER DASHBOARD & DRIVES SCHEMAS
# ==============================================================================

class PlacementDriveCreateRequest(BaseModel):
    company_name: str
    role_title: str
    description: str
    eligibility_criteria: Optional[str] = None
    minimum_cgpa: Optional[float] = 0.0
    required_skills: Optional[List[str]] = []
    package_lpa: Optional[float] = None
    application_deadline: Optional[datetime] = None
    status: Optional[str] = "OPEN"

class PlacementDriveUpdateRequest(BaseModel):
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    description: Optional[str] = None
    eligibility_criteria: Optional[str] = None
    minimum_cgpa: Optional[float] = None
    required_skills: Optional[List[str]] = None
    package_lpa: Optional[float] = None
    application_deadline: Optional[datetime] = None
    status: Optional[str] = None

class PlacementDriveResponse(BaseModel):
    id: int
    organization_id: int
    company_name: str
    role_title: str
    description: str
    eligibility_criteria: Optional[str] = None
    minimum_cgpa: float = 0.0
    required_skills: List[str] = []
    package_lpa: Optional[float] = None
    application_deadline: Optional[datetime] = None
    status: str
    created_at: datetime
    updated_at: datetime
    applicant_count: Optional[int] = 0
    is_eligible: Optional[bool] = None
    has_applied: Optional[bool] = None

class DriveApplicationStatusUpdateRequest(BaseModel):
    status: str  # APPLIED, SHORTLISTED, REJECTED, PLACED
    notes: Optional[str] = None

class DriveApplicationResponse(BaseModel):
    id: int
    drive_id: int
    student_profile_id: int
    organization_id: int
    status: str
    notes: Optional[str] = None
    applied_at: datetime
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    student_branch: Optional[str] = None
    student_cgpa: Optional[float] = None
    student_readiness_score: Optional[float] = None
    student_skills: Optional[List[str]] = []
    company_name: Optional[str] = None
    role_title: Optional[str] = None

class CollegeStudentListItemResponse(BaseModel):
    id: int
    user_id: int
    organization_id: int
    full_name: str
    email: str
    branch: Optional[str] = None
    graduation_year: Optional[int] = None
    cgpa: Optional[float] = None
    target_role: Optional[str] = None
    current_skills: List[str] = []
    readiness_score: float
    resume_score: Optional[float] = None
    has_resume: bool = False
    applications_count: int = 0
    created_at: datetime

class CollegeCohortOverviewResponse(BaseModel):
    total_students: int
    average_readiness_score: float
    high_readiness_count: int
    moderate_readiness_count: int
    at_risk_count: int
    total_drives: int
    active_drives: int
    total_applications: int
    total_placed: int
    top_cohort_skills: List[Dict[str, Any]] = []
    common_skill_gaps: List[Dict[str, Any]] = []
    branch_distribution: Dict[str, int] = {}


# ==============================================================================
# PHASE 10: STUDENT ENROLLMENT, ONBOARDING & ROLE-BASED UX SCHEMAS
# ==============================================================================

class OnboardingStatusResponse(BaseModel):
    is_onboarded: bool
    onboarding_step: int
    has_resume: bool
    target_role: Optional[str] = None
    target_company: Optional[str] = None
    branch: Optional[str] = None
    graduation_year: Optional[int] = None
    cgpa: Optional[float] = None
    skills_count: int = 0
    completed_steps: List[int] = []
    recommended_action: str

class OnboardingStepUpdateRequest(BaseModel):
    step: int
    target_role: Optional[str] = None
    target_company: Optional[str] = None
    college_name: Optional[str] = None
    branch: Optional[str] = None
    graduation_year: Optional[int] = None
    cgpa: Optional[float] = None
    current_skills: Optional[List[str]] = None

class OnboardingCompleteRequest(BaseModel):
    target_role: str
    target_company: Optional[str] = None
    college_name: Optional[str] = None
    branch: Optional[str] = None
    graduation_year: Optional[int] = None
    cgpa: Optional[float] = None
    current_skills: Optional[List[str]] = []








