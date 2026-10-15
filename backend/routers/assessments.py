from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List, Optional, Union, Dict, Any
import string
import random
import os
import copy
from datetime import datetime
import schemas, models, utils, database
from .auth import get_current_user
from services import ai_generator, email_templates, piston_service, aptitude_evaluation, coding_evaluation

router = APIRouter(
    prefix="/api/assessments",
    tags=["assessments"]
)

def sanitize_assessment_for_candidate(assessment: Union[models.Assessment, Dict[str, Any]]) -> Optional[schemas.AssessmentResponse]:
    """
    Security Sanitizer: Strips all answer keys, confidential solutions, and hidden test cases
    before returning assessment payloads to candidate-facing endpoints.
    Operates on deep copies to guarantee database state is never mutated.
    """
    if assessment is None:
        return None

    if isinstance(assessment, dict):
        raw_config = assessment.get("config") or {}
        a_id = assessment.get("id", 0)
        a_type = assessment.get("type", "")
        a_status = assessment.get("status", "pending")
        a_score = float(assessment.get("score") or 0.0)
        a_analysis_data = assessment.get("analysis_data")
        a_email = assessment.get("candidate_email", "")
        a_created_at = assessment.get("created_at") or datetime.now()
        a_started_at = assessment.get("started_at")
        a_source = assessment.get("question_source", "ai")
    else:
        raw_config = assessment.config or {}
        a_id = assessment.id
        a_type = assessment.type
        a_status = assessment.status
        a_score = float(assessment.score or 0.0)
        a_analysis_data = assessment.analysis_data
        a_email = assessment.candidate_email
        a_created_at = assessment.created_at or datetime.now()
        a_started_at = assessment.started_at
        a_source = getattr(assessment, "question_source", "ai") or "ai"

    # Isolate from ORM to prevent accidental persistence
    config = copy.deepcopy(raw_config)
    
    # Strip top-level confidential keys
    config.pop("answer_key", None)
    config.pop("solution", None)
    config.pop("solution_code", None)
    config.pop("evaluation_details", None)
    config.pop("submission_data", None)

    for q_list_key in ["generated_questions", "questions"]:
        if q_list_key in config and isinstance(config[q_list_key], list):
            sanitized_list = []
            for item in config[q_list_key]:
                if not isinstance(item, dict):
                    sanitized_list.append(item)
                    continue
                q = copy.deepcopy(item)
                
                # Aptitude secrets removal
                q.pop("correct", None)
                q.pop("correct_answer", None)
                q.pop("correct_option", None)
                q.pop("answer", None)
                q.pop("explanation", None)
                
                # Coding secrets removal
                q.pop("solution", None)
                q.pop("solution_code", None)
                q.pop("hidden_test_cases", None)
                q.pop("hidden_tests", None)
                
                # Coding test case secrets removal
                if "testCases" in q and isinstance(q["testCases"], list):
                    public_test_cases = []
                    for tc in q["testCases"]:
                        if isinstance(tc, dict):
                            # Exclude hidden test cases completely from candidate view
                            if tc.get("is_hidden") is True or tc.get("hidden") is True:
                                continue
                            clean_tc = copy.deepcopy(tc)
                            clean_tc["is_hidden"] = False
                            clean_tc.pop("hidden", None)
                            clean_tc.pop("explanation", None)
                            public_test_cases.append(clean_tc)
                        else:
                            public_test_cases.append(tc)
                    q["testCases"] = public_test_cases

                sanitized_list.append(q)
            config[q_list_key] = sanitized_list

    # For coding assessments, strictly sanitize analysis_data so hidden test counts and results are NEVER exposed to candidate
    if a_type == "coding" and a_analysis_data:
        cand_analysis = {}
        if isinstance(a_analysis_data, dict):
            if "time_taken_seconds" in a_analysis_data:
                cand_analysis["time_taken_seconds"] = a_analysis_data["time_taken_seconds"]
            # Expose ONLY public test results if present
            if "public_passed" in a_analysis_data and "public_total" in a_analysis_data:
                cand_analysis["public_passed"] = a_analysis_data["public_passed"]
                cand_analysis["public_total"] = a_analysis_data["public_total"]
            elif "passed" in a_analysis_data and "total" in a_analysis_data and not a_analysis_data.get("has_hidden_tests"):
                # Legacy AI assessment where 100% of test cases were public
                cand_analysis["public_passed"] = a_analysis_data["passed"]
                cand_analysis["public_total"] = a_analysis_data["total"]

            if a_analysis_data.get("has_hidden_tests"):
                cand_analysis["has_hidden_tests"] = True
                cand_analysis["hidden_status"] = "Private evaluation"
        a_analysis_data = cand_analysis if cand_analysis else None

    return schemas.AssessmentResponse(
        id=a_id,
        type=a_type,
        config=config,
        status=a_status,
        score=a_score,
        analysis_data=a_analysis_data,
        candidate_email=a_email,
        created_at=a_created_at,
        started_at=a_started_at,
        question_source=a_source,
        evaluation_details=None
    )

def _get_tenant_org_id(current_user: models.User, db: Session) -> Optional[int]:
    """Resolves current organization ID for multi-tenant data isolation."""
    if getattr(current_user, "role", None) == models.UserRole.PLATFORM_ADMIN:
        return getattr(current_user, "organization_id", None)
    
    member = None
    if hasattr(current_user, "id") and current_user.id:
        member = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.user_id == current_user.id,
            models.OrganizationMember.status == "active"
        ).first()

    if member:
        return member.organization_id

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Active organization membership required."
    )

@router.post("/assign/", response_model=schemas.AssignResponse)
def assign_assessment(
    request: schemas.AssessmentCreateRequest,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Admin sends list of candidates
    user_role = getattr(current_user, "role", None)
    email = getattr(current_user, "email", "")
    if user_role == models.UserRole.CANDIDATE or (email and email.endswith("@hiringai.internal")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted: Candidate accounts are not permitted to assign assessments."
        )
    org_id = _get_tenant_org_id(current_user, db)
    candidate_list = request.candidates
    round_type = request.type
    config = request.config
    deadline = request.deadline
    question_src = getattr(request, "question_source", None) or config.get("question_source", "ai")
    
    # --- MANUAL APTITUDE VALIDATION & SETUP ---
    if round_type == "aptitude" and question_src == "manual":
        manual_qs = config.get("questions") or config.get("generated_questions")
        if not manual_qs:
            raise HTTPException(status_code=400, detail="Manual aptitude assessment requires at least one question in 'questions'.")
        try:
            validated_qs = aptitude_evaluation.validate_manual_aptitude_questions(manual_qs)
            config["questions"] = validated_qs
            config["generated_questions"] = validated_qs
            config["answer_key"] = {str(q["id"]): q["correct_answer"] for q in validated_qs}
            config["question_source"] = "manual"
        except ValueError as val_err:
            raise HTTPException(status_code=400, detail=str(val_err))

    # --- MANUAL CODING VALIDATION & SETUP ---
    elif round_type == "coding" and question_src == "manual":
        manual_qs = config.get("questions") or config.get("generated_questions")
        if not manual_qs:
            raise HTTPException(status_code=400, detail="Manual coding assessment requires at least one problem in 'questions'.")
        try:
            validated_qs = coding_evaluation.validate_manual_coding_questions(manual_qs)
            config["questions"] = validated_qs
            config["generated_questions"] = validated_qs
            config["question_source"] = "manual"
        except ValueError as val_err:
            raise HTTPException(status_code=400, detail=str(val_err))

    # If manual questions were supplied under 'questions' for other rounds, mirror them
    elif question_src == "manual" and config.get("questions") and not config.get("generated_questions"):
        config["generated_questions"] = copy.deepcopy(config["questions"])

    # Phase 5: Connect final recruiter-selected skills to AI assessment configuration if job_description_id is provided
    jd_id = config.get("job_description_id")
    if jd_id:
        jd_q = db.query(models.JobDescription).filter(models.JobDescription.id == jd_id)
        if org_id:
            jd_q = jd_q.filter(models.JobDescription.organization_id == org_id)
        jd_record = jd_q.first()
        if jd_record:
            recruiter_skills = (jd_record.required_skills or []) + (jd_record.preferred_skills or [])
            if recruiter_skills and not config.get("topics"):
                config["topics"] = recruiter_skills

    # --- PRE-GENERATE QUESTIONS (Optimization) ---
    # Generate ONCE per batch assignment to save time and ensure consistency
    try:
        # Skip generation for Interview type (VAPI handles it dynamically) and Manual authoring
        if round_type != "interview" and question_src != "manual" and not config.get("generated_questions"):
            generated_qs = ai_generator.generate_questions(round_type, config)
            if generated_qs:
                config["generated_questions"] = generated_qs
            else:
                raise HTTPException(status_code=500, detail="AI failed to generate questions. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation Error: {str(e)}")
    # ---------------------------------------------
    
    email_errors = []
    assigned_count = 0

    for candidate_entry in candidate_list:
        email = candidate_entry.get('email')
        if not email:
            continue
        
        
        # 1. Get or Create Candidate Record
        cand_q = db.query(models.Candidate).filter(models.Candidate.email == email)
        if org_id:
            cand_q = cand_q.filter(models.Candidate.organization_id == org_id)
        candidate = cand_q.first()
        if not candidate:
            candidate = models.Candidate(
                name=candidate_entry.get('name', 'Candidate'),
                email=email,
                role=config.get('role') or config.get('topic') or "Candidate",
                stage=round_type,
                status=models.CandidateStatus.Applied,
                created_by=current_user.id,
                organization_id=org_id
            )
            db.add(candidate)
            db.flush() # Get ID
            db.refresh(candidate)

        # 2. Update Candidate Creds (Separate from Admin User)
        plain_password = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        hashed = utils.get_password_hash(plain_password)
        candidate.hashed_password = hashed
        candidate.is_active = True
        
        password_display = plain_password

        # 3. Create Shadow User for Auth Session
        # This ensures get_current_user works without conflicting with Admin's real User account
        shadow_email = f"candidate_{candidate.id}@hiringai.internal"
        shadow_user = db.query(models.User).filter(models.User.email == shadow_email).first()
        
        if not shadow_user:
            shadow_user = models.User(
                email=shadow_email,
                hashed_password=hashed,
                role=models.UserRole.CANDIDATE.value, # Fix: Use .value
                is_active=True,
                organization_id=org_id
            )
            db.add(shadow_user)
        else:
            shadow_user.hashed_password = hashed
            if org_id and not shadow_user.organization_id:
                shadow_user.organization_id = org_id
        
        db.flush() 
        db.refresh(shadow_user)
        
        # User for assessment is SHADOW user
        user = shadow_user 


        # 1.5 Update Candidate Stage if they exist in Candidate table
        # This unifies "Promote" and "Assign Assessment"
        STAGE_MAPPING = {
            "aptitude": models.CandidateStage.Aptitude_Round,
            "coding": models.CandidateStage.Coding_Round,
            "interview": models.CandidateStage.Technical_Interview
        }
        
        target_stage = STAGE_MAPPING.get(round_type, models.CandidateStage.Resume_Screening)

        candidate_record = cand_q.first()
        if candidate_record:
            candidate_record.stage = target_stage
            candidate_record.created_by = current_user.id
            if org_id:
                candidate_record.organization_id = org_id
            
            # Reset results for a fresh start in this stage
            candidate_record.status = models.CandidateStatus.In_Progress
            candidate_record.score = 0.0
            if candidate_record.analysis_data:
                # Keep screening reasoning but clear previous round data
                candidate_record.analysis_data = {k: v for k, v in candidate_record.analysis_data.items() if k in ['reasoning', 'extracted_role', 'sentiment']}
            
            # Log Promotion
            friendly_round = round_type.replace('_', ' ').title()
            log = models.ActivityLog(
                user_id=current_user.id, 
                action="invited",
                target=candidate_record.name,
                details=f"Invited to {friendly_round} Assessment",
                organization_id=org_id
            )
            db.add(log)

        # 2. Create Assessment (Use deepcopy to ensure isolation)
        assessment = models.Assessment(
            candidate_email=email,
            type=round_type,
            config=copy.deepcopy(config),
            status=models.AssessmentStatus.pending,
            user_id=user.id,
            question_source=question_src,
            organization_id=org_id
        )
        db.add(assessment)
        
        # CRITICAL: Commit DB changes BEFORE sending email so login works immediately
        db.commit()
        
        # 3. Send Email with Magic Link (Secure)
        frontend_url = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")
        
        # FIX: Use Candidate's specific role if available, fallback to Config role, then 'Candidate'
        target_role = candidate_record.role if candidate_record and candidate_record.role else config.get('role', 'Candidate')
        
        subject = f"Action Required: {target_role} - {round_type.title()} Invitation"
        
        deadline_text = f"Deadline: {deadline}" if deadline else "Deadline: ASAP"
        
        # Generate Login Link (Manual Only)
        login_link = f"{frontend_url}/portal/login"
        


        html_body = email_templates.get_invitation_email_template(
            candidate_name=candidate_entry.get('name', 'Candidate'),
            role_title=target_role,
            round_type=round_type,
            login_url=login_link, # MANUAL LOGIN LINK
            deadline_text=deadline_text,
            instructions=config.get('description', None),
            password=password_display,
            email=email
        )
        sent = utils.send_email(email, subject, html_body)
        if not sent:
            email_errors.append(f"{email}: Failed to send email")
        
        assigned_count += 1
    
    # db.commit() - Moved inside loop


    msg = f"Successfully assigned {round_type} to {assigned_count} candidates."
    if email_errors:
        msg += f" WARNING: Email failed for {len(email_errors)} candidates."

    return schemas.AssignResponse(
        message=msg,
        status="success" if not email_errors else "warning",
        email_errors=email_errors
    )

@router.get("/my-pending/", response_model=List[schemas.AssessmentResponse])
def get_my_pending_assessments(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    assessments = db.query(models.Assessment).filter(
        models.Assessment.user_id == current_user.id,
        models.Assessment.status == models.AssessmentStatus.pending
    ).order_by(models.Assessment.created_at.desc()).all()
    
    return [sanitize_assessment_for_candidate(a) for a in assessments]

@router.get("/my-status/", response_model=Optional[schemas.AssessmentResponse])
def get_my_latest_assessment(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    try:
        # Fetch the most recent assessment for the user
        assessment = db.query(models.Assessment).filter(
            models.Assessment.user_id == current_user.id
        ).order_by(models.Assessment.created_at.desc()).first()
        
        if assessment:
            q_src = getattr(assessment, "question_source", "ai") or assessment.config.get("question_source", "ai")
            # Check if questions need to be generated (Lazy Generation)
            # Optimization: Skip for 'interview' (VAPI dynamic) and 'manual' (admin authored)
            if not assessment.config.get("generated_questions") and assessment.type != "interview" and q_src != "manual":
                questions = ai_generator.generate_questions(assessment.type, assessment.config)
                
                if questions:
                    new_config = dict(assessment.config)
                    new_config["generated_questions"] = questions
                    assessment.config = new_config
                    
                    db.commit()
                    db.refresh(assessment)

            return sanitize_assessment_for_candidate(assessment)

        return None
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/start/{assessment_id}")
def start_assessment(
    assessment_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    assessment = db.query(models.Assessment).filter(
        models.Assessment.id == assessment_id,
        models.Assessment.user_id == current_user.id
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
        
    if assessment.status == models.AssessmentStatus.completed:
        raise HTTPException(status_code=400, detail="Assessment already completed")
        
    if not assessment.started_at:
        assessment.started_at = func.now()
        db.commit()
        db.refresh(assessment)
        
    return {"message": "Assessment started", "started_at": assessment.started_at}

@router.post("/execute/")
def execute_code(
    request: schemas.ExecutionRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    # 0. Load the Safe Configuration from DB (Security)
    assessment = db.query(models.Assessment).filter(
        models.Assessment.user_id == current_user.id
    ).order_by(models.Assessment.created_at.desc()).first()
    
    question_config = {}
    if assessment and assessment.config:
        generated_qs = assessment.config.get("generated_questions", [])
        # Find the question by ID if provided, or matching title
        target_q = None
        if request.questionId:
            target_q = next((q for q in generated_qs if q.get('id') == request.questionId), None)
        else:
            target_q = next((q for q in generated_qs if q.get('title') == request.question.get('title')), None)
            
        if target_q:
            question_config = target_q

    # 1. Generate Runner Code using Trusted Templates
    runner_code = ai_generator.generate_runner_code(
        request.code, 
        request.language, 
        request.testCases,
        question_config=question_config
    )
    

    
    if not runner_code:
        # Fallback to pure AI if wrapper fails (Safety Net)
        return ai_generator.evaluate_code(
            request.code, request.language, request.question, request.testCases
        )
        
    # 2. Execute on Piston
    piston_res = piston_service.execute_code(request.language, runner_code)

    
    # 3. Process Results (Strict Stream Parsing)
    if piston_res.get("status") == "success":
        raw_output = piston_res.get("output", "").strip()

        results = []
        
        # New Robust Parsing Strategy: Extract lines between Markers
        marker_start = "---EXECUTION_RESULT_START---"
        marker_end = "---EXECUTION_RESULT_END---"
        
        lines = raw_output.split('\n')
        parsing_started = False
        parsed_any = False
        
        import json
        for line in lines:
            line = line.strip()
            if not line: continue
            
            if marker_start in line:
                parsing_started = True
                continue
            if marker_end in line:
                parsing_started = False
                break
                
            if parsing_started:
                try:
                    # Line should be: {"id":..., "status":..., "output":..., "expected":...}
                    res_obj = json.loads(line)
                    
                    # Backend evaluation: Compare output vs expected
                    actual = res_obj.get('output')
                    expected = res_obj.get('expected')
                    
                    # Normalize comparison (Handle string vs original types)
                    # We try to parse expected as JSON if it's a string representation
                    exp_obj = expected
                    try:
                        if isinstance(expected, str):
                            # Try to parse if it looks like JSON structure
                            if expected.strip().startswith(('[', '{')):
                                exp_obj = json.loads(expected)
                    except:
                        pass
                        
                    # Compare actual value with expected object
                    # Also handle simple string comparisons for primitive types
                    is_pass = (actual == exp_obj) or (str(actual).strip() == str(expected).strip())
                    
                    # Find original input for display
                    tc_orig = next((t for t in request.testCases if t.get('id') == res_obj.get('id')), {})
                    
                    results.append({
                        "id": res_obj.get('id'),
                        "status": "passed" if is_pass else "failed",
                        "input": tc_orig.get('input', {}),
                        "output": str(actual),
                        "expected": str(expected)
                    })
                    parsed_any = True
                except Exception as e_line:
                    print(f"Failed to parse result line: {line} - {e_line}")

        if parsed_any:
            return {
                "syntax_valid": True,
                "results": results,
                "feedback": "Executed and verified successfully."
            }
        
        # Fallback Strategy: If no markers found, try to find any valid JSON array
        try:
             import re
             match = re.search(r'\[.*\]', raw_output, re.DOTALL)
             if match:
                 results = json.loads(match.group(0))
                 return {"syntax_valid": True, "results": results, "feedback": "Executed via fallback parsing"}
        except:
             pass
            
    # If we are here, Piston failed or Parsing failed
    analysis = ai_generator.analyze_error(request.code, piston_res.get("output", ""))

    error_type = "compilation_error"
    if piston_res.get("status") == "service_error":
        error_type = "service_error"
    elif piston_res.get("status") == "failed":
        error_type = "runtime_error"
    
    return {
        "syntax_valid": False,
        "error_message": piston_res.get("output", "Execution Failed"),
        "error_type": error_type,
        "results": [],
        "feedback": analysis
    }

def send_completion_emails(candidate_email: str, candidate_name: str, target_role: str, assessment_type: str, friendly_type: str, score_detail: str, created_by_id: Optional[int]):
    from database import SessionLocal
    db = SessionLocal()
    try:
        completion_subject = "Assessment Completed - Thank You for Your Time"
        completion_body = email_templates.get_completion_email_template(
            candidate_name=candidate_name,
            role_title=target_role,
            round_type=assessment_type
        )
        utils.send_email(candidate_email, completion_subject, completion_body)
        print(f"Completion email sent to {candidate_email}")
        
        # Send HR Notification if alerts enabled
        settings_record = None
        if created_by_id:
            settings_record = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.created_by == created_by_id
            ).first()
        if not settings_record:
            settings_record = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.key == "default"
            ).first()
            
        if settings_record and settings_record.config:
            notifications_conf = settings_record.config.get("notifications", {})
            if notifications_conf.get("emailAlerts", True):
                creator_user = None
                if created_by_id:
                    creator_user = db.query(models.User).filter(models.User.id == created_by_id).first()
                
                # Check if the creator email is a dummy/generic one, otherwise use it
                hr_email = creator_user.email if (creator_user and not creator_user.email.endswith('.internal')) else notifications_conf.get("recipientEmail")
                
                # If recipient email is a dummy (e.g. hr@company.com), fallback to the synced admin email (gopalmuri1919@gmail.com)
                if hr_email == "hr@company.com" or not hr_email:
                    hr_email = os.getenv("PLATFORM_ADMIN_EMAIL", "gopalmuri1919@gmail.com").strip().lower()

                if hr_email:
                    hr_subject = f"Candidate Assessment Submitted: {candidate_name}"
                    hr_body = f"""
                    <h3>Candidate Assessment Submission Alert</h3>
                    <p><strong>Candidate Name:</strong> {candidate_name}</p>
                    <p><strong>Email:</strong> {candidate_email}</p>
                    <p><strong>Role:</strong> {target_role}</p>
                    <p><strong>Assessment Type:</strong> {friendly_type}</p>
                    <p><strong>Status/Score:</strong> {score_detail}</p>
                    <br/>
                    <p>You can view the full evaluation details in the Admin Dashboard.</p>
                    """
                    utils.send_email(hr_email, hr_subject, hr_body)
                    print(f"HR notification email sent to {hr_email}")
    except Exception as e:
        print(f"Failed to send email notifications in background: {e}")
    finally:
        db.close()

@router.post("/submit/", response_model=schemas.AssessmentResponse)
def submit_assessment(
    payload: schemas.SubmissionPayload,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    assessment = db.query(models.Assessment).filter(
        models.Assessment.user_id == current_user.id
    ).order_by(models.Assessment.created_at.desc()).first()

    if not assessment:
        raise HTTPException(status_code=404, detail="No active assessment found")

    if assessment.status == models.AssessmentStatus.completed:
        raise HTTPException(status_code=400, detail="Assessment already submitted")
    
    # --- FAST-PATH FOR MALPRACTICE TERMINATION ---
    is_malpractice = False
    status_str = str(payload.status or "").lower()
    if "malpractice" in status_str:
        is_malpractice = True
    elif payload.answers and isinstance(payload.answers, dict) and "malpractice" in str(payload.answers.get("reason", "")).lower():
        is_malpractice = True

    if is_malpractice:
        assessment.score = 0.0
        assessment.status = models.AssessmentStatus.completed
        assessment.completed_at = datetime.utcnow()
        assessment.evaluation_details = {
            "disqualified": True,
            "reason": str(payload.status or "Malpractice Termination"),
            "score": 0.0
        }
        assessment.submission_data = payload.answers or {}
        if assessment.candidate_id:
            cand = db.query(models.Candidate).filter(models.Candidate.id == assessment.candidate_id).first()
            if cand:
                cand.score = 0.0
                cand.status = "Disqualified"
        db.commit()
        db.refresh(assessment)
        return assessment

    # --- SCORING LOGIC ---
    calculated_score = 0.0
    correct_count = 0
    total_questions = 0
    passed = 0
    total = 0
    apt_eval_res = None
    
    if assessment.type == "aptitude":
        generated_questions = assessment.config.get("generated_questions") or assessment.config.get("questions") or []
        apt_eval_res = aptitude_evaluation.evaluate_aptitude_submission(generated_questions, payload.answers or {})
        calculated_score = apt_eval_res["score"]
        correct_count = apt_eval_res["correct_count"]
        total_questions = apt_eval_res["total_questions"]
        assessment.evaluation_details = apt_eval_res["breakdown"]
        assessment.submission_data = payload.answers or {}
            
    elif assessment.type == "coding":
        generated_qs = assessment.config.get("generated_questions") or assessment.config.get("questions") or []
        q_src = getattr(assessment, "question_source", "ai") or assessment.config.get("question_source", "ai")
        
        has_submitted_code = (payload.code is not None) or (
            payload.answers and isinstance(payload.answers, dict) and (
                "code" in payload.answers or "codeByQuestion" in payload.answers
            )
        )
        
        if q_src == "manual" or has_submitted_code:
            eval_res = coding_evaluation.execute_and_evaluate_coding_submission(
                questions=generated_qs,
                payload_code=payload.code,
                answers=payload.answers,
                fallback_result=payload.result,
                language=payload.language
            )
            calculated_score = eval_res["score"]
            passed = eval_res["passed_test_cases"]
            total = eval_res["total_test_cases"]
            assessment.evaluation_details = eval_res["evaluation_details"]
            assessment.submission_data = {
                "code": payload.code,
                "answers": payload.answers,
                "language": payload.language
            }
            coding_eval_res = eval_res
        else:
            # Backward compatibility: legacy submission with only payload.result
            if payload.result:
                passed = payload.result.get("passed", 0)
                actual_total = sum(len(q.get('testCases', [])) for q in generated_qs)
                total = actual_total if actual_total > 0 else payload.result.get("total", 5)
                if total > 0:
                    calculated_score = (passed / total) * 10.0
            else:
                calculated_score = 0.0
            coding_eval_res = None
    
    assessment.status = models.AssessmentStatus.completed
    assessment.score = calculated_score
    
    # Calculate time taken (from start to now)
    from datetime import datetime, timezone
    time_taken_seconds = 0
    
    # Use started_at if available, otherwise fallback to created_at
    base_time = assessment.started_at or assessment.created_at
    
    if base_time:
        # DB timezone-aware datetime comparison
        now = datetime.now(timezone.utc)
        # Ensure base_time is comparison-friendly (if it came from DB with TZ)
        if base_time.tzinfo is None:
            # Fallback for naive timestamps
            time_diff = datetime.now() - base_time
        else:
            time_diff = now - base_time
        
        time_taken_seconds = int(time_diff.total_seconds())
        # Ensure no negative timing (sanity check)
        if time_taken_seconds < 0:
            time_taken_seconds = 0
    
    # Store detailed analysis
    if assessment.type == "aptitude":
        if apt_eval_res:
            assessment.analysis_data = copy.deepcopy(apt_eval_res["analysis_data"])
            assessment.analysis_data["time_taken_seconds"] = time_taken_seconds
        else:
            assessment.analysis_data = {
                "correct": 0,
                "total": 0,
                "incorrect": 0,
                "marks_earned": 0,
                "total_marks": 0,
                "score_percentage": 0.0,
                "time_taken_seconds": time_taken_seconds
            }
    elif assessment.type == "coding":
        if coding_eval_res:
            assessment.analysis_data = copy.deepcopy(coding_eval_res["analysis_data"])
            assessment.analysis_data["time_taken_seconds"] = time_taken_seconds
        else:
            assessment.analysis_data = {
                "public_passed": passed,
                "public_total": total,
                "has_hidden_tests": False,
                "score_percentage": (calculated_score / 10) * 100 if total > 0 else 0,
                "time_taken_seconds": time_taken_seconds
            }
    
    # 2. SYNC: Update Candidate record and Log Activity
    candidate = db.query(models.Candidate).filter(models.Candidate.email == assessment.candidate_email).first()
    if candidate:
        # Update Candidate Score and Status
        candidate.score = calculated_score * 10.0 # Convert 0-10 back to 0-100 for percentage
        
        # CRITICAL FIX: Copy analysis_data to candidate record for frontend access
        candidate.analysis_data = assessment.analysis_data
        
        # Store detailed score in status string for frontend display "5/10"
        # Format: "Submitted: Correct/Total"
        if payload.status:
            candidate.status = payload.status
        elif assessment.type == "aptitude":
            candidate.status = f"Submitted: {correct_count}/{total_questions}"
        elif assessment.type == "coding":
            candidate.status = f"Submitted: {passed}/{total}"
        else:
            candidate.status = "Review Pending"
        
        # Log Submission for Admin Panel
        friendly_type = assessment.type.replace('_', ' ').title()
        score_detail = candidate.status.split(': ')[1] if ':' in candidate.status else 'Completed'
        log = models.ActivityLog(
            user_id=candidate.created_by,
            action="completed",
            target=candidate.name,
            details=f"Completed {friendly_type} | Result: {score_detail}"
        )
        db.add(log)
        
        # --- SEND COMPLETION EMAIL (New) ---
        target_role = candidate.role if candidate.role else "Candidate"
        background_tasks.add_task(
            send_completion_emails,
            candidate.email,
            candidate.name,
            target_role,
            assessment.type,
            friendly_type,
            score_detail,
            candidate.created_by
        )
        # -----------------------------------

    db.commit()
    db.refresh(assessment)
    
    return sanitize_assessment_for_candidate(assessment)

