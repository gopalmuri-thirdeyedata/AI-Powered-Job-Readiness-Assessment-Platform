import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from jose import JWTError, jwt
from typing import Optional
from sqlalchemy.orm import Session
import database, models, schemas, utils
from routers.auth import get_current_user
from services import elevenlabs_service

router = APIRouter(
    prefix="/api/interview",
    tags=["interview"]
)

@router.get("/init")
def initialize_interview(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Defines the voice interview for the current candidate.
    Returns the public voice config and a signed token that carries the interview definition back to /voice-turn.
    """
    # 1. Identify Candidate
    # If the user is a 'candidate' role, current_user.email might be shadow email
    # Extract ID from 'candidate_123@hiringai.internal'
    
    candidate = None
    if "candidate_" in current_user.email:
        try:
            c_id = int(current_user.email.split('_')[1].split('@')[0])
            candidate = db.query(models.Candidate).filter(models.Candidate.id == c_id).first()
        except:
            pass
            
    if not candidate:
        candidate = db.query(models.Candidate).filter(models.Candidate.email == current_user.email).first()

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found")

    # 2. Get Context (Resume + Role)
    resume_summary = "No resume data available."
    if candidate.analysis_data:
        resume_summary = str(candidate.analysis_data)
        
    role = candidate.role or "Full Stack Engineer"
    
    # 2.5 Fetch Assessment Config & Questions
    custom_instructions = ""
    questions = []
    duration = 30
    assessment = None
    try:
        assessment = db.query(models.Assessment)\
            .filter(models.Assessment.candidate_email == candidate.email)\
            .filter(models.Assessment.type == "interview")\
            .order_by(models.Assessment.created_at.desc())\
            .first()
            
        if assessment and assessment.config:
            custom_instructions = assessment.config.get("instructions", "")
            duration = assessment.config.get("duration") or assessment.config.get("timeLimit") or 30

        if assessment and assessment.questions and isinstance(assessment.questions, list) and len(assessment.questions) > 0:
            questions = assessment.questions
        elif assessment and assessment.config and assessment.config.get("questions"):
            questions = assessment.config.get("questions")
    except Exception as e:
        print(f"Failed to fetch assessment config: {e}")

    # Generate 5 role-specific questions if not already present
    if not questions or len(questions) < 3:
        from services import ai_generator
        questions = ai_generator.generate_interview_questions({
            "role": role,
            "focus_area": role,
            "resume_summary": resume_summary
        })
        if assessment:
            try:
                assessment.questions = questions
                db.commit()
            except Exception as save_err:
                print(f"Failed to cache questions to assessment: {save_err}")
        
    # Resolve candidate real name directly from resume (never use raw email or email handle with digits)
    from services.student_resume_analyzer import extract_candidate_name_from_resume
    import re, os

    resolved_name = None
    # 1. Check if candidate.name is already a clean human name (no '@', no digits, not generic)
    if candidate.name and "@" not in candidate.name and not any(ch.isdigit() for ch in candidate.name):
        clean = candidate.name.strip()
        if clean.lower() not in ("candidate", "unknown candidate", "unknown", "student", "none"):
            resolved_name = clean.title()

    # 2. Check candidate.analysis_data for extracted name
    if not resolved_name and isinstance(candidate.analysis_data, dict):
        for k in ["candidate_name", "name", "full_name"]:
            val = candidate.analysis_data.get(k)
            if val and isinstance(val, str) and "@" not in val and not any(ch.isdigit() for ch in val):
                c = val.strip()
                if c.lower() not in ("candidate", "unknown candidate", "unknown", "student"):
                    resolved_name = c.title()
                    break

    # 3. Check candidate.full_text directly using resume name extractor
    if not resolved_name and candidate.full_text:
        from_resume = extract_candidate_name_from_resume(candidate.full_text)
        if from_resume:
            resolved_name = from_resume

    # 4. If resume_file is on disk, extract from physical file
    if not resolved_name and candidate.resume_file:
        file_path = os.path.join("media/resumes", candidate.resume_file) if not os.path.isabs(candidate.resume_file) else candidate.resume_file
        if os.path.exists(file_path):
            try:
                from services.student_resume_analyzer import extract_resume_text
                raw_text = extract_resume_text(file_path)
                from_file = extract_candidate_name_from_resume(raw_text)
                if from_file:
                    resolved_name = from_file
            except Exception:
                pass

    # 5. Fallback: clean email username (strip numbers, e.g. gopalmuri1919 -> Gopal Muri)
    if not resolved_name:
        raw_email = candidate.email or current_user.email or ""
        if "@" in raw_email:
            local = raw_email.split("@")[0]
            cleaned_local = re.sub(r"[^a-zA-Z\s]", " ", local).strip()
            words = [w for w in cleaned_local.split() if len(w) > 1]
            if words:
                resolved_name = " ".join(words).title()
            elif cleaned_local:
                resolved_name = cleaned_local.title()

    if not resolved_name:
        resolved_name = "Candidate"

    # Persist the clean real name back to candidate.name in DB
    if candidate.name != resolved_name and resolved_name != "Candidate":
        candidate.name = resolved_name
        try:
            db.commit()
        except Exception:
            pass

    # 3. Define the voice interview (5 questions); the signed token carries it to /voice-turn
    voice_session = elevenlabs_service.build_voice_session(
        candidate_name=resolved_name,
        role=role,
        resume_summary=resume_summary,
        custom_instructions=custom_instructions,
        questions=questions,
        max_duration_seconds=int(duration) * 60 if str(duration).isdigit() else None
    )

    # Mark Assessment as Started
    try:
        if assessment and not assessment.started_at:
            from sqlalchemy.sql import func
            assessment.started_at = func.now()
            db.commit()
    except Exception as e:
        print(f"Failed to mark interview as started: {e}")

    voice_token = jwt.encode(
        {"sub": str(current_user.id), "purpose": "voice-interview", "voice": voice_session,
         "exp": datetime.utcnow() + timedelta(seconds=voice_session["max_duration_seconds"] + 600)},
        utils.SECRET_KEY, algorithm=utils.ALGORITHM)

    return {
        "voiceConfig": elevenlabs_service.public_voice_config(voice_session),
        "voiceToken": voice_token,
        "questions": questions,
        "role": role,
        "candidateName": candidate.name,
        "duration": duration
    }


@router.post("/voice-turn")
def voice_turn(
    voice_token: str = Form(...),
    audio: Optional[UploadFile] = File(None),
    history: str = Form("[]"),
    opening: bool = Form(False),
    current_user: models.User = Depends(get_current_user),
):
    """One spoken exchange: the candidate's recording in, the interviewer's text and speech out."""
    try:
        claims = jwt.decode(voice_token, utils.SECRET_KEY, algorithms=[utils.ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="The interview session expired. Reload and try again.")
    if claims.get("purpose") != "voice-interview" or claims.get("sub") != str(current_user.id) or not isinstance(claims.get("voice"), dict):
        raise HTTPException(status_code=403, detail="This interview session does not belong to you.")
    try:
        parsed_history = json.loads(history or "[]")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation history.")
    audio_bytes = audio.file.read(elevenlabs_service.MAX_AUDIO_BYTES + 1) if audio is not None else None
    try:
        return elevenlabs_service.run_turn(
            claims["voice"], audio=audio_bytes,
            content_type=(audio.content_type if audio is not None else None) or elevenlabs_service.AUDIO_WEBM,
            history=parsed_history, opening=opening)
    except elevenlabs_service.VoiceServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.public_message)

@router.post("/submit")
def submit_interview(
    request: dict,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    """
    Saves interview completion data to candidate record.
    Expected payload: { "duration": 1800, "transcript": [...], "status": "completed" }
    """
    # 1. Identify Candidate
    candidate = None
    if "candidate_" in current_user.email:
        try:
            c_id = int(current_user.email.split('_')[1].split('@')[0])
            candidate = db.query(models.Candidate).filter(models.Candidate.id == c_id).first()
        except:
            pass
            
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found")
    
    # 2. Extract submission data
    duration = request.get("duration", 0)  # in seconds
    transcript = request.get("transcript", [])
    interview_status = request.get("status", "completed")
    
    # 3. Save to analysis_data (Reuse existing JSON column)
    # Ensure we don't overwrite existing data
    current_data = dict(candidate.analysis_data) if candidate.analysis_data else {}
    
    from datetime import datetime
    
    current_data["interview"] = {
        "status": interview_status,
        "duration_seconds": duration,
        "transcript": transcript,
        "completed_at": str(datetime.now())
    }
    
    # 3.5. AI Evaluation — generate scores from transcript (Fast-path if malpractice)
    is_malpractice = (
        "malpractice" in str(interview_status).lower() or
        bool(request.get("is_malpractice")) or
        "malpractice" in str(request.get("reason", "")).lower()
    )

    if is_malpractice:
        scores = {
            "technical_accuracy": 0,
            "communication_clarity": 0,
            "problem_solving": 0,
            "depth_of_knowledge": 0,
            "overall_score": 0,
            "feedback": f"Interview terminated due to malpractice: {interview_status}"
        }
        current_data["interview"]["scores"] = scores
        candidate.score = 0
        candidate.status = "Disqualified"
    else:
        try:
            from services.interview_evaluation import evaluate_interview_transcript
            scores = evaluate_interview_transcript(
                transcript=transcript,
                candidate_name=candidate.name,
                role=candidate.role or "Unknown",
                resume_summary=str(candidate.analysis_data) if candidate.analysis_data else ""
            )
            current_data["interview"]["scores"] = scores
            candidate.score = scores.get("overall_score", 0)
        except Exception as e:
            print(f"Interview evaluation failed: {e}")
            import traceback
            traceback.print_exc()
            current_data["interview"]["scores"] = {
                "technical_accuracy": 0,
                "communication_clarity": 0,
                "problem_solving": 0,
                "depth_of_knowledge": 0,
                "overall_score": 0,
                "feedback": "Evaluation unavailable"
            }

    candidate.analysis_data = current_data

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(candidate, "analysis_data")

    # 4. Update candidate status to "Submitted" for interview stage
    if candidate.stage == "Technical Interview":
        candidate.status = "Submitted"
    
    # 5. SYNC with Assessment table (CRITICAL for re-login prevention)
    try:
        assessment = db.query(models.Assessment)\
            .filter(models.Assessment.candidate_email == candidate.email)\
            .filter(models.Assessment.type == "interview")\
            .order_by(models.Assessment.created_at.desc())\
            .first()
        if assessment:
            assessment.status = "completed"
            assessment.score = candidate.score / 10.0 # Standardize to 0-10
            assessment.analysis_data = current_data["interview"]
    except Exception as e:
        print(f"Failed to sync interview assessment: {e}")

    # Send HR Notification if alerts enabled
    try:
        settings_record = None
        if candidate.created_by:
            settings_record = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.created_by == candidate.created_by
            ).first()
        if not settings_record:
            settings_record = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.key == "default"
            ).first()

        if settings_record and settings_record.config:
            notifications_conf = settings_record.config.get("notifications", {})
            if notifications_conf.get("emailAlerts", True):
                creator_user = None
                if candidate.created_by:
                    creator_user = db.query(models.User).filter(models.User.id == candidate.created_by).first()
                
                # Check if the creator email is a dummy/generic one, otherwise use it
                hr_email = creator_user.email if (creator_user and not creator_user.email.endswith('.internal')) else notifications_conf.get("recipientEmail")
                
                # If recipient email is a dummy (e.g. hr@company.com), fallback to the master admin email (admin@thirdeyedata.ai)
                if hr_email == "hr@company.com" or not hr_email:
                    hr_email = "admin@thirdeyedata.ai"

                if hr_email:
                    hr_subject = f"Candidate AI Interview Completed: {candidate.name}"
                    hr_body = f"""
                    <h3>Candidate AI Interview Completion Alert</h3>
                    <p><strong>Candidate Name:</strong> {candidate.name}</p>
                    <p><strong>Email:</strong> {candidate.email}</p>
                    <p><strong>Role:</strong> {candidate.role or 'Software Engineer'}</p>
                    <p><strong>Assessment Type:</strong> Technical Voice Interview (AI)</p>
                    <p><strong>Overall Score:</strong> {candidate.score}/100</p>
                    <br/>
                    <p>You can listen to the recording and read the transcript in the Admin Dashboard.</p>
                    """
                    utils.send_email(hr_email, hr_subject, hr_body)
                    print(f"HR notification email sent to {hr_email}")
    except Exception as e:
        print(f"Failed to send HR notification email: {e}")

    db.commit()
    db.refresh(candidate)
    
    return {
        "message": "Interview results saved successfully",
        "candidate_id": candidate.id,
        "scores": current_data.get("interview", {}).get("scores", {}),
        "overall_score": candidate.score
    }

