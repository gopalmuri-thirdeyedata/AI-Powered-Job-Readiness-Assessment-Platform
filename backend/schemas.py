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

