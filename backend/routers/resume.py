from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pathlib import Path
from typing import List, Optional, Dict, Any
import shutil
import os
import json
from datetime import datetime, timedelta
import schemas, models, database
from services.rag_service import RAGService
from services import skill_suggestion
from routers.auth import get_current_user

router = APIRouter(
    prefix="/api/resume",
    tags=["resume"]
)

import time
import concurrent.futures

import re

COMMON_SKILLS = [
    "python", "javascript", "typescript", "java", "c++", "c#", "ruby", "php", "go", "golang", "rust", "swift", "kotlin",
    "react", "angular", "vue", "nextjs", "node", "nodejs", "express", "django", "fastapi", "flask", "spring", "laravel",
    "sql", "mysql", "postgresql", "mongodb", "redis", "cassandra", "elasticsearch", "oracle",
    "aws", "azure", "gcp", "docker", "kubernetes", "jenkins", "git", "github", "gitlab", "terraform", "ansible",
    "machine learning", "deep learning", "nlp", "ai", "artificial intelligence", "data science", "pandas", "numpy", "tensorflow", "pytorch",
    "html", "css", "tailwind", "bootstrap", "graphql", "rest api", "microservices", "agile", "scrum", "devops"
]

def require_recruiter_user(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Security check: Ensures candidate users cannot manage Job Descriptions."""
    if current_user.role == models.UserRole.CANDIDATE or current_user.email.endswith("@hiringai.internal"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidates are not permitted to manage Job Descriptions."
        )
    return current_user

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

    if getattr(current_user, "role", None) in (models.UserRole.HR_ADMIN, models.UserRole.SUPER_ADMIN):
        return getattr(current_user, "organization_id", 1) or 1

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Active organization membership required."
    )


def _skill_in_text(skill: str, text_lower: str) -> bool:
    """Helper to check if a technical skill is present with word boundary awareness and aliases."""
    s = skill.strip().lower()
    if not s:
        return False
    if s == "c++":
        return "c++" in text_lower or "cpp" in text_lower
    if s == "c#":
        return "c#" in text_lower or "csharp" in text_lower
    if s == ".net":
        return ".net" in text_lower or "dotnet" in text_lower
    if s in ["react", "react.js", "reactjs"]:
        return bool(re.search(r'\breact(?:\.js|js)?\b', text_lower))
    if s in ["node", "node.js", "nodejs"]:
        return bool(re.search(r'\bnode(?:\.js|js)?\b', text_lower))
    if s in ["vue", "vue.js", "vuejs"]:
        return bool(re.search(r'\bvue(?:\.js|js)?\b', text_lower))
    if s == "java":
        matches = re.findall(r'\bjava\b', text_lower)
        return len(matches) > 0
    if s in ["js", "javascript"]:
        return bool(re.search(r'\b(?:js|javascript)\b', text_lower))
    if s in ["ts", "typescript"]:
        return bool(re.search(r'\b(?:ts|typescript)\b', text_lower))
    if s in ["spring boot", "springboot"]:
        return "spring boot" in text_lower or "springboot" in text_lower
    escaped = re.escape(s)
    return bool(re.search(rf'(?:\b|_){escaped}(?:\b|_)', text_lower))

def get_keyword_score(
    resume_text: str,
    jd_text: str,
    explicit_skills: Optional[List[str]] = None,
    preferred_skills: Optional[List[str]] = None,
    specific_targets: Optional[str] = None,
    scoring_weights: Optional[dict] = None
):
    resume_text_lower = resume_text.lower()
    jd_text_lower = jd_text.lower()
    
    # 1. Determine Required Skills
    if explicit_skills and len(explicit_skills) > 0:
        required_skills = [s.strip() for s in explicit_skills if s and s.strip()]
    else:
        required_skills = [skill for skill in COMMON_SKILLS if _skill_in_text(skill, jd_text_lower)]
        
    if not required_skills:
        words = re.findall(r'\b\w{3,15}\b', jd_text_lower)
        stopwords = {'and', 'the', 'for', 'with', 'you', 'are', 'our', 'will', 'that', 'this', 'work', 'join', 'team', 'role', 'about', 'from', 'have', 'need', 'must'}
        required_skills = list(set(words) - stopwords)[:15]
        
    matched_skills = [s for s in required_skills if _skill_in_text(s, resume_text_lower)]
    missing_skills = [s for s in required_skills if not _skill_in_text(s, resume_text_lower)]
    
    skill_ratio = len(matched_skills) / len(required_skills) if required_skills else 0.0
    
    # 2. Evaluate Specific Targets
    targets_score = 0.0
    has_targets = False
    if specific_targets and specific_targets.strip():
        has_targets = True
        target_lines = [t.strip() for t in specific_targets.split('\n') if t and t.strip()]
        matched_target_count = 0
        for target in target_lines:
            target_words = [w.lower() for w in re.findall(r'\b\w{3,15}\b', target) if w.lower() not in {'and', 'the', 'for', 'with', 'you', 'are', 'built', 'work', 'team', 'have', 'must'}]
            if target_words:
                hits = sum(1 for tw in target_words if _skill_in_text(tw, resume_text_lower))
                if hits / len(target_words) >= 0.35:
                    matched_target_count += 1
            else:
                if target.lower() in resume_text_lower:
                    matched_target_count += 1
        targets_score = (matched_target_count / len(target_lines)) * 100.0 if target_lines else 0.0
        
    # 3. Preferred Skills Bonus
    pref_bonus = 0.0
    if preferred_skills:
        pref_matched = sum(1 for p in preferred_skills if _skill_in_text(p, resume_text_lower))
        pref_bonus = min(5.0, (pref_matched / len(preferred_skills)) * 5.0)
        
    # 4. Composite Score Calculation
    jd_words = set(re.findall(r'\b\w{4,15}\b', jd_text_lower)) - {'with', 'that', 'this', 'from', 'have', 'your', 'about'}
    jd_overlap = (sum(1 for w in jd_words if w in resume_text_lower) / max(1, len(jd_words))) * 100.0 if jd_words else 50.0

    if scoring_weights and isinstance(scoring_weights, dict):
        w_skills = float(scoring_weights.get("skills", 40))
        w_exp = float(scoring_weights.get("experience", 25))
        w_proj = float(scoring_weights.get("projects", 20))
        w_edu = float(scoring_weights.get("education", 10))
        w_bonus = float(scoring_weights.get("bonus", 5))

        has_degree = any(deg in resume_text_lower for deg in [
            'bachelor', 'master', 'degree', 'b.tech', 'm.tech', 'b.e', 'm.s', 'b.s', 'phd', 'graduate', 'university', 'college', 'mca', 'bca'
        ])
        edu_score = w_edu if has_degree else (w_edu * 0.5)

        pref_bonus_score = 0.0
        if preferred_skills:
            pref_matched = sum(1 for p in preferred_skills if _skill_in_text(p, resume_text_lower))
            pref_bonus_score = (pref_matched / max(1, len(preferred_skills))) * w_bonus
        elif pref_bonus > 0:
            pref_bonus_score = pref_bonus

        if has_targets:
            calc_score = (
                (skill_ratio * w_skills) +
                ((targets_score / 100.0) * w_proj) +
                ((jd_overlap / 100.0) * w_exp) +
                edu_score +
                pref_bonus_score
            )
        else:
            effective_skills_weight = w_skills + (w_proj * 0.6)
            effective_exp_weight = w_exp + (w_proj * 0.4)
            calc_score = (
                (skill_ratio * effective_skills_weight) +
                ((jd_overlap / 100.0) * effective_exp_weight) +
                edu_score +
                pref_bonus_score
            )
    else:
        if has_targets:
            # 55% Required Skills + 30% Specific Targets + 15% General JD + Preferred Bonus
            calc_score = (skill_ratio * 55.0) + (targets_score * 0.30) + (jd_overlap * 0.15) + pref_bonus
        else:
            # 75% Required Skills + 25% General JD + Preferred Bonus
            calc_score = (skill_ratio * 75.0) + (jd_overlap * 0.25) + pref_bonus

    final_score = round(min(100.0, max(0.0, calc_score)), 1)
    return final_score, matched_skills, missing_skills

def extract_single_resume(file_path: str, filename: str):
    try:
        suffix = os.path.splitext(filename)[1].lower()
        if suffix in [".docx", ".doc"]:
            full_text = RAGService.extract_text_from_docx(file_path)
        else:
            full_text = RAGService.extract_text_from_pdf(file_path)
        candidate_info = RAGService.extract_candidate_info(full_text, filename)
        return {
            "file": filename,
            "file_path": file_path,
            "status": "success",
            "candidate_info": candidate_info,
            "full_text": full_text
        }
    except Exception as e:
        print(f"Error extracting {filename}: {e}")
        return {
            "file": filename,
            "file_path": file_path,
            "status": "failed",
            "error": str(e),
            "candidate_info": {},
            "full_text": ""
        }

def _build_professional_summary(
    candidate_name: str,
    score: float,
    matched_skills: list,
    missing_skills: list,
    jd_title: str,
    required_skills: Optional[List[str]] = None,
    specific_targets: Optional[str] = None
) -> str:
    """Generate a clean, professional candidate summary reflecting HR requirements."""
    matched_count = len(matched_skills)
    parts = []
    
    if required_skills:
        req_matched = [s for s in required_skills if s.lower() in [m.lower() for m in matched_skills]]
        parts.append(f"{candidate_name} matches {len(req_matched)}/{len(required_skills)} HR required must-have skills ({', '.join(req_matched[:5]) if req_matched else 'None identified'}).")
    else:
        top_skills = ", ".join(matched_skills[:5]) if matched_count > 0 else "N/A"
        parts.append(f"{candidate_name} aligns with key skills: {top_skills}.")
        
    if specific_targets and specific_targets.strip():
        parts.append("Candidate demonstrates project background addressing HR specific targets.")

    if score >= 75:
        parts.append(f"Strong overall candidate readiness ({score:.0f}%) for the {jd_title} role.")
    elif score >= 50:
        gaps = f" Notable gaps: {', '.join(missing_skills[:3])}." if missing_skills else ""
        parts.append(f"Moderate alignment ({score:.0f}%) with transferable experience.{gaps}")
    else:
        parts.append(f"Limited overall match ({score:.0f}%) against required criteria for {jd_title}.")
        
    return " ".join(parts)

def run_llm_screening(
    candidate_data: dict,
    job_description: str,
    jd_title: str,
    required_skills: Optional[List[str]] = None,
    preferred_skills: Optional[List[str]] = None,
    specific_targets: Optional[str] = None,
    scoring_weights: Optional[dict] = None
):
    candidate_name = candidate_data['candidate_info'].get('name', candidate_data['file'])
    print(f"   [LLM Start] Running Gemini screening for {candidate_name}...")
    try:
        analysis = RAGService.screen_resume(
            job_description,
            f"temp_{candidate_data['file']}",
            candidate_data["full_text"],
            required_skills=required_skills,
            preferred_skills=preferred_skills,
            specific_targets=specific_targets,
            scoring_weights=scoring_weights
        )
        candidate_data["analysis"] = analysis
        candidate_data["score"] = analysis.get("score", 0)
        candidate_data["reasoning"] = analysis.get("reasoning", "N/A")
        candidate_data["status"] = "success"
        print(f"   [LLM Success] Completed Gemini screening for {candidate_name} | AI Score: {candidate_data['score']}%")
    except Exception as e:
        print(f"   [LLM Error] Gemini screening failed for {candidate_name} due to: {e}. Falling back to Stage 1 keyword score.")
        score = candidate_data["keyword_score"]
        matched = candidate_data["matched_skills"]
        missing = candidate_data["missing_skills"]
        reasoning = _build_professional_summary(
            candidate_name, score, matched, missing, jd_title,
            required_skills=required_skills, specific_targets=specific_targets
        )
        
        candidate_data["score"] = score
        candidate_data["reasoning"] = reasoning
        candidate_data["analysis"] = {
            "score": score,
            "extracted_role": jd_title,
            "reasoning": reasoning,
            "key_skills_match": matched,
            "missing_skills": missing
        }
        candidate_data["status"] = "success"
    return candidate_data

@router.post("/screen/")
def screen_resume(
    files: List[UploadFile] = File(...),
    job_description: Optional[str] = Form(None),
    job_description_id: Optional[int] = Form(None),
    required_skills: Optional[str] = Form(None),
    preferred_skills: Optional[str] = Form(None),
    specific_targets: Optional[str] = Form(None),
    top_n: Optional[int] = Form(10),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    start_total = time.time()
    print(f"--- START PARALLEL SCREENING: {len(files)} files (Top N: {top_n}) ---")
    
    # Normalization Helper
    def normalize_role(raw_title: str) -> str:
        # Common prefixes to strip
        prefixes = [
            "we are looking for a", "we are looking for an", "we are looking for",
            "hiring for a", "hiring for an", "hiring for",
            "seeking candidates for a", "seeking candidates for", "seeking", 
            "looking for a", "looking for"
        ]
        
        cleaned = raw_title.lower().strip()
        
        # 1. Strict Canonical Mapping (Based on User Rules)
        if any(k in cleaned for k in ["full stack", "fullstack", "mern", "mean"]):
             return "Full Stack Software Engineer"
        if any(k in cleaned for k in ["frontend", "front end", "react", "angular", "vue"]):
             return "Frontend Developer"
        if any(k in cleaned for k in ["backend", "back end", "node", "django", "fastapi", "java", "spring"]):
             return "Backend Developer"
        if any(k in cleaned for k in ["python", "machine learning", "ai", "data scientist"]):
             return "Python Developer"
        if any(k in cleaned for k in ["software engineer", "developer", "sde"]):
             return "Software Engineer"

        # 2. Fallback: Strip noise if no specific keyword match (preserve original intent but clean it)
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()
                break 
        
        # Strip noise suffixes
        noise_phrases = ["to join our development team", "and work on building", "remote", "(remote)", "urgent hiring"]
        for noise in noise_phrases:
            cleaned = cleaned.replace(noise, "")
            
        return cleaned.title().strip()

    # Extract Title from JD (First line)
    jd_lines = [l.strip() for l in (job_description or "").split('\n') if l.strip()]
    if jd_lines:
        raw_title = jd_lines[0][:100] # Take first line
        jd_title = normalize_role(raw_title)
    else:
        jd_title = "General Candidate"
    
    org_id = _get_tenant_org_id(current_user, db)
    cand_count_q = db.query(models.Candidate)
    if org_id:
        cand_count_q = cand_count_q.filter(models.Candidate.organization_id == org_id)
    candidate_count = cand_count_q.count()
    
    MAX_CANDIDATES = 50
    if candidate_count >= MAX_CANDIDATES:
        return {"message": f"Candidate limit ({MAX_CANDIDATES}) reached.", "status": "limit_exceeded"}
    
    if candidate_count + len(files) > MAX_CANDIDATES:
        allowed = MAX_CANDIDATES - candidate_count
        return {"message": f"Upload exceeds limit. Allow {allowed} more.", "status": "limit_exceeded"}

    UPLOAD_DIR = "media/resumes"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    # Parse required and preferred skills
    import json
    parsed_required_skills = []
    if required_skills:
        try:
            val = json.loads(required_skills)
            if isinstance(val, list):
                parsed_required_skills = [str(s).strip() for s in val if str(s).strip()]
            elif isinstance(val, str):
                parsed_required_skills = [s.strip() for s in val.split(',') if s.strip()]
        except Exception:
            parsed_required_skills = [s.strip() for s in required_skills.split(',') if s.strip()]

    parsed_preferred_skills = []
    if preferred_skills:
        try:
            val = json.loads(preferred_skills)
            if isinstance(val, list):
                parsed_preferred_skills = [str(s).strip() for s in val if str(s).strip()]
            elif isinstance(val, str):
                parsed_preferred_skills = [s.strip() for s in val.split(',') if s.strip()]
        except Exception:
            parsed_preferred_skills = [s.strip() for s in preferred_skills.split(',') if s.strip()]

    if job_description_id:
        jd_q = db.query(models.JobDescription).filter(models.JobDescription.id == job_description_id)
        if org_id:
            jd_q = jd_q.filter(models.JobDescription.organization_id == org_id)
        jd_record = jd_q.first()
        if jd_record:
            if not parsed_required_skills and jd_record.required_skills:
                parsed_required_skills = list(jd_record.required_skills)
            if not parsed_preferred_skills and jd_record.preferred_skills:
                parsed_preferred_skills = list(jd_record.preferred_skills)
            if not specific_targets and jd_record.specific_targets:
                specific_targets = jd_record.specific_targets
            if not job_description or not job_description.strip():
                job_description = skill_suggestion.build_jd_composite_text({
                    "title": jd_record.title,
                    "role": jd_record.role,
                    "responsibilities": jd_record.responsibilities,
                    "experience_requirements": jd_record.experience_requirements,
                    "specific_targets": jd_record.specific_targets,
                    "expected_achievements": jd_record.expected_achievements,
                    "additional_requirements": jd_record.additional_requirements,
                    "description": jd_record.description
                })

    # Build composite effective JD with explicit Required Skills and Specific Targets blocks
    composite_jd_parts = []
    if job_description and job_description.strip():
        composite_jd_parts.append(job_description.strip())
    if parsed_required_skills and "Required Skills:" not in (job_description or ""):
        composite_jd_parts.append(f"Required Skills (Must-Have):\n{', '.join(parsed_required_skills)}")
    if parsed_preferred_skills and "Preferred Skills:" not in (job_description or ""):
        composite_jd_parts.append(f"Preferred Skills (Nice-to-Have):\n{', '.join(parsed_preferred_skills)}")
    if specific_targets and specific_targets.strip() and "Specific Targets:" not in (job_description or ""):
        composite_jd_parts.append(f"Specific Targets (Key Evaluation Criteria):\n{specific_targets.strip()}")

    effective_jd = "\n\n".join(composite_jd_parts)
    if not effective_jd.strip():
        raise HTTPException(status_code=400, detail="Job Description is required.")

    # 1. Save all files to disk first (Fast IO)
    saved_files = [] 
    results = []
    
    for file in files:
        # Strip folder path from filename (folder upload sends paths like 'resume/file.pdf')
        safe_filename = os.path.basename(file.filename)
        if not safe_filename.lower().endswith(('.pdf', '.docx', '.doc')):
            results.append({"file": safe_filename, "error": "Unsupported format.", "status": "failed"})
            continue
            
        file_location = f"{UPLOAD_DIR}/{safe_filename}"
        with open(file_location, "wb+") as file_object:
            shutil.copyfileobj(file.file, file_object)
        
        saved_files.append((file_location, safe_filename))

    # 2. Stage 1: Parallel Text Extraction
    print(f"[Stage 1] Extracting text and matching keywords for {len(saved_files)} resumes...")
    extractions = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(extract_single_resume, loc, name): name 
            for loc, name in saved_files
        }
        for future in concurrent.futures.as_completed(futures):
            extractions.append(future.result())

    # Calculate keyword scores and filter out failures
    successful_extractions = []
    for ext in extractions:
        if ext["status"] == "failed":
            results.append(ext)
            continue
        
        email = ext["candidate_info"].get("email")
        if not email:
            ext["error"] = "Could not extract email."
            ext["status"] = "failed"
            results.append(ext)
            continue
            
        # Fetch user-scoped scoring weights
        user_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.created_by == current_user.id
        ).first()
        if not user_settings:
            user_settings = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.key == "default"
            ).first()

        scoring_weights = (
            user_settings.config.get("scoring")
            if user_settings and user_settings.config
            else None
        )

        keyword_score, matched_skills, missing_skills = get_keyword_score(
            ext["full_text"],
            effective_jd,
            explicit_skills=parsed_required_skills if parsed_required_skills else None,
            preferred_skills=parsed_preferred_skills if parsed_preferred_skills else None,
            specific_targets=specific_targets,
            scoring_weights=scoring_weights
        )
        ext["keyword_score"] = keyword_score
        ext["matched_skills"] = matched_skills
        ext["missing_skills"] = missing_skills
        
        candidate_name = ext["candidate_info"].get("name", ext["file"])
        print(f" -> Found candidate: {candidate_name} | Local Keyword Score: {keyword_score}%")
        successful_extractions.append(ext)

    # Sort by keyword score descending
    successful_extractions.sort(key=lambda x: x["keyword_score"], reverse=True)

    # Slice candidates
    to_llm = successful_extractions[:top_n]
    to_fallback = successful_extractions[top_n:]

    # 3. Stage 2: Parallel LLM screening for top candidates
    llm_screened = []
    if to_llm:
        print(f"[Stage 2] Submitting Top {len(to_llm)} candidates to Gemini LLM for deep evaluation:")
        for c in to_llm:
            c_name = c["candidate_info"].get("name", c["file"])
            print(f" -> Sending to LLM: {c_name} (Stage 1 Score: {c['keyword_score']}%)")
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(
                    run_llm_screening,
                    cand,
                    effective_jd,
                    jd_title,
                    required_skills=parsed_required_skills,
                    preferred_skills=parsed_preferred_skills,
                    specific_targets=specific_targets,
                    scoring_weights=scoring_weights
                ): cand["file"]
                for cand in to_llm
            }
            for future in concurrent.futures.as_completed(futures):
                llm_screened.append(future.result())

    # Build direct fallback matches for remaining candidates (no LLM call)
    fallback_screened = []
    if to_fallback:
        print(f"[Stage 2 Fallback] Bypassing LLM screening for remaining {len(to_fallback)} candidates to optimize speed:")
        for cand in to_fallback:
            cand_name = cand["candidate_info"].get("name", cand["file"])
            print(f" -> Bypassed LLM: {cand_name} | Using Keyword Score: {cand['keyword_score']}%")
            
            cand["score"] = cand["keyword_score"]
            cand["reasoning"] = _build_professional_summary(
                cand_name,
                cand['keyword_score'],
                cand['matched_skills'],
                cand['missing_skills'],
                jd_title,
                required_skills=parsed_required_skills,
                specific_targets=specific_targets
            )
            cand["analysis"] = {
                "score": cand["keyword_score"],
                "extracted_role": jd_title,
                "reasoning": cand["reasoning"],
                "key_skills_match": cand["matched_skills"],
                "missing_skills": cand["missing_skills"]
            }
            cand["status"] = "success"
            fallback_screened.append(cand)

    all_processed = llm_screened + fallback_screened

    # 4. Filter and process candidates by email validity
    # Resumes with invalid/placeholder/dummy emails are REJECTED with a clear reason.
    # They are NOT saved to the DB (never appear in Screened Candidates), but are returned in results so they are visible in screening.
    from utils import is_valid_candidate_email

    failed = [d for d in all_processed if d.get("status") == "failed"]
    valid_screened = []
    rejected_email_candidates = []

    for data in all_processed:
        if data.get("status") == "failed":
            continue

        info = data.get("candidate_info", {})
        cand_email = info.get("email")
        orig_dummy = info.get("original_dummy_email")

        # Determine if email is invalid, placeholder, or masked
        is_invalid = bool(
            info.get("is_dummy_email")
            or not cand_email
            or cand_email.endswith(".internal")
            or not is_valid_candidate_email(cand_email)
            or orig_dummy is not None
        )

        if is_invalid:
            placeholder_label = orig_dummy or cand_email or "No email found"
            rejection_reason = (
                f"Rejected: Invalid or placeholder email address ('{placeholder_label}') detected in resume. "
                f"A valid contact email is required to proceed with candidate screening."
            )
            data["status"] = "Rejected"
            data["score"] = 0
            data["reasoning"] = rejection_reason
            data["rejection_reason"] = rejection_reason
            if "analysis" in data:
                data["analysis"]["reasoning"] = rejection_reason
                data["analysis"]["score"] = 0
                data["analysis"]["missing_skills"] = ["Valid Contact Email"]

            data["id"] = f"rejected_{int(time.time())}_{data.get('file', 'cand')}"
            data["name"] = info.get("name") or data.get("file", "Unknown")
            data["email"] = placeholder_label
            data["role"] = jd_title
            data["phone"] = info.get("phone")
            data["is_dummy_email"] = True
            data["original_dummy_email"] = placeholder_label
            data["candidate"] = {
                "id": None,  # Not saved in DB
                "name": data["name"],
                "email": placeholder_label,
                "role": jd_title,
                "phone": info.get("phone"),
                "status": "Rejected",
                "is_dummy_email": True,
                "original_dummy_email": placeholder_label,
                "rejection_reason": rejection_reason
            }

            # Ensure candidate is deleted from DB if previously exists
            if cand_email:
                db.query(models.Candidate).filter(models.Candidate.email == cand_email).delete()
            if orig_dummy:
                db.query(models.Candidate).filter(models.Candidate.email == orig_dummy).delete()
            db.commit()

            print(f" -> REJECTED (Invalid Email): {data['name']} ('{placeholder_label}') - Not added to DB")
            rejected_email_candidates.append(data)
        else:
            valid_screened.append(data)

    # Sort valid candidates by score descending
    valid_screened.sort(key=lambda x: x.get("score", 0), reverse=True)
    top_candidates = valid_screened[:top_n]
    cutoff_candidates = valid_screened[top_n:]

    # Remove cutoff candidates from DB if they were previously added
    for data in cutoff_candidates:
        info = data.get("candidate_info", {})
        email = info.get("email")
        if email:
            existing = db.query(models.Candidate).filter(models.Candidate.email == email).first()
            if existing:
                db.delete(existing)
        print(f" -> CUTOFF (not in top {top_n}): {info.get('name', data.get('file', '?'))} | Score: {data.get('score', 0):.1f}%")
    db.commit()

    # DB Writes — ONLY for top_n VALID candidates
    for data in top_candidates:
        info = data["candidate_info"]
        email = info.get('email')
        score = data["score"]

        # DB Upsert
        cand_q = db.query(models.Candidate).filter(models.Candidate.email == email)
        if org_id:
            cand_q = cand_q.filter(models.Candidate.organization_id == org_id)
        candidate = cand_q.first()
        target_role = jd_title

        if not candidate:
            candidate = models.Candidate(
                name=info.get('name', 'Unknown'),
                email=email,
                phone=info.get('phone') or info.get('mobile') or info.get('contact'),
                role=target_role,
                status=models.CandidateStatus.Applied,
                stage=models.CandidateStage.Resume_Screening,
                resume_file=data["file"],
                full_text=data["full_text"],
                score=score,
                analysis_data=data["analysis"],
                created_by=current_user.id,
                organization_id=org_id
            )
            db.add(candidate)
            db.commit()
            db.refresh(candidate)
            log = models.ActivityLog(user_id=current_user.id, action="screened", target=candidate.name, details=f"Score: {score}/100", organization_id=org_id)
            db.add(log)
        else:
            new_name = info.get('name', 'Unknown')
            if new_name and new_name not in ["Unknown", "Unknown Candidate", "Candidate", "Resume", "CV"]:
                candidate.name = new_name
                info["name"] = new_name
            if candidate.role != target_role:
                candidate.role = target_role

            candidate.score = score
            candidate.analysis_data = data["analysis"]
            candidate.full_text = data["full_text"]
            phone = info.get('phone') or info.get('mobile') or info.get('contact')
            if phone:
                candidate.phone = phone
            candidate.status = models.CandidateStatus.Applied
            candidate.stage = models.CandidateStage.Resume_Screening
            candidate.created_by = current_user.id
            log = models.ActivityLog(user_id=current_user.id, action="re-screened", target=candidate.name, details=f"Score: {score}/100")
            db.add(log)
        db.commit()

        # Structure for Frontend
        data["id"] = candidate.id
        data["name"] = candidate.name
        data["email"] = candidate.email
        data["role"] = candidate.role
        data["phone"] = candidate.phone
        data["status"] = "Screened"
        data["is_dummy_email"] = False
        data["original_dummy_email"] = None
        data["candidate"] = {
            "name": candidate.name,
            "email": candidate.email,
            "id": candidate.id,
            "role": candidate.role,
            "phone": candidate.phone,
            "status": "Screened",
            "is_dummy_email": False,
            "original_dummy_email": None
        }

        results.append(data)

    # Append cutoff candidates (valid email, but outside top_n)
    for data in cutoff_candidates:
        results.append(data)

    # Append rejected candidates with invalid emails (Visible ONLY in screening results, NOT in DB)
    for data in rejected_email_candidates:
        results.append(data)

    # Add failed extractions for visibility
    for data in failed:
        results.append(data)

    total_time = time.time() - start_total
    print(f"--- BATCH COMPLETE in {total_time:.2f}s | Top {top_n} saved to DB ---")

    return {
        "message": "Screening Complete",
        "results": results,  # Already only top_n + any failures
        "total_screened": len(valid_screened) + len(rejected_email_candidates),
        "top_n": top_n,
        "status": "completed"
    }

@router.post("/screen-stream/")
def screen_resume_stream(
    files: List[UploadFile] = File(...),
    job_description: Optional[str] = Form(None),
    job_description_id: Optional[int] = Form(None),
    required_skills: Optional[str] = Form(None),
    preferred_skills: Optional[str] = Form(None),
    specific_targets: Optional[str] = Form(None),
    top_n: Optional[int] = Form(10),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Streaming screening endpoint: Processes resumes one-by-one and yields NDJSON progress
    and candidate_completed events in real time so the UI can progressively display results.
    """
    def normalize_role(raw_title: str) -> str:
        prefixes = [
            "we are looking for a", "we are looking for an", "we are looking for",
            "hiring for a", "hiring for an", "hiring for",
            "seeking candidates for a", "seeking candidates for", "seeking", 
            "looking for a", "looking for"
        ]
        cleaned = raw_title.lower().strip()
        if any(k in cleaned for k in ["full stack", "fullstack", "mern", "mean"]):
             return "Full Stack Software Engineer"
        if any(k in cleaned for k in ["frontend", "front end", "react", "angular", "vue"]):
             return "Frontend Developer"
        if any(k in cleaned for k in ["backend", "back end", "node", "django", "fastapi", "java", "spring"]):
             return "Backend Developer"
        if any(k in cleaned for k in ["python", "machine learning", "ai", "data scientist"]):
             return "Python Developer"
        if any(k in cleaned for k in ["software engineer", "developer", "sde"]):
             return "Software Engineer"
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()
                break 
        noise_phrases = ["to join our development team", "and work on building", "remote", "(remote)", "urgent hiring"]
        for noise in noise_phrases:
            cleaned = cleaned.replace(noise, "")
        return cleaned.title().strip()

    jd_lines = [l.strip() for l in (job_description or "").split('\n') if l.strip()]
    if jd_lines:
        raw_title = jd_lines[0][:100]
        jd_title = normalize_role(raw_title)
    else:
        jd_title = "General Candidate"

    candidate_count = db.query(models.Candidate).count()
    MAX_CANDIDATES = 50
    if candidate_count >= MAX_CANDIDATES:
        raise HTTPException(status_code=400, detail=f"Candidate limit ({MAX_CANDIDATES}) reached.")
    if candidate_count + len(files) > MAX_CANDIDATES:
        allowed = MAX_CANDIDATES - candidate_count
        raise HTTPException(status_code=400, detail=f"Upload exceeds limit. Allow {allowed} more.")

    UPLOAD_DIR = "media/resumes"
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Parse required and preferred skills
    parsed_required_skills = []
    if required_skills:
        try:
            val = json.loads(required_skills)
            if isinstance(val, list):
                parsed_required_skills = [str(s).strip() for s in val if str(s).strip()]
            elif isinstance(val, str):
                parsed_required_skills = [s.strip() for s in val.split(',') if s.strip()]
        except Exception:
            parsed_required_skills = [s.strip() for s in required_skills.split(',') if s.strip()]

    parsed_preferred_skills = []
    if preferred_skills:
        try:
            val = json.loads(preferred_skills)
            if isinstance(val, list):
                parsed_preferred_skills = [str(s).strip() for s in val if str(s).strip()]
            elif isinstance(val, str):
                parsed_preferred_skills = [s.strip() for s in val.split(',') if s.strip()]
        except Exception:
            parsed_preferred_skills = [s.strip() for s in preferred_skills.split(',') if s.strip()]

    org_id = _get_tenant_org_id(current_user, db)
    if job_description_id:
        jd_q = db.query(models.JobDescription).filter(models.JobDescription.id == job_description_id)
        if org_id:
            jd_q = jd_q.filter(models.JobDescription.organization_id == org_id)
        jd_record = jd_q.first()
        if jd_record:
            if not parsed_required_skills and jd_record.required_skills:
                parsed_required_skills = list(jd_record.required_skills)
            if not parsed_preferred_skills and jd_record.preferred_skills:
                parsed_preferred_skills = list(jd_record.preferred_skills)
            if not specific_targets and jd_record.specific_targets:
                specific_targets = jd_record.specific_targets
            if not job_description or not job_description.strip():
                job_description = skill_suggestion.build_jd_composite_text({
                    "title": jd_record.title,
                    "role": jd_record.role,
                    "responsibilities": jd_record.responsibilities,
                    "experience_requirements": jd_record.experience_requirements,
                    "specific_targets": jd_record.specific_targets,
                    "expected_achievements": jd_record.expected_achievements,
                    "additional_requirements": jd_record.additional_requirements,
                    "description": jd_record.description
                })

    composite_jd_parts = []
    if job_description and job_description.strip():
        composite_jd_parts.append(job_description.strip())
    if parsed_required_skills and "Required Skills:" not in (job_description or ""):
        composite_jd_parts.append(f"Required Skills (Must-Have):\n{', '.join(parsed_required_skills)}")
    if parsed_preferred_skills and "Preferred Skills:" not in (job_description or ""):
        composite_jd_parts.append(f"Preferred Skills (Nice-to-Have):\n{', '.join(parsed_preferred_skills)}")
    if specific_targets and specific_targets.strip() and "Specific Targets:" not in (job_description or ""):
        composite_jd_parts.append(f"Specific Targets (Key Evaluation Criteria):\n{specific_targets.strip()}")

    effective_jd = "\n\n".join(composite_jd_parts)
    if not effective_jd.strip():
        raise HTTPException(status_code=400, detail="Job Description is required.")

    # Save uploaded files to disk first (fast IO)
    saved_files = []
    for f in files:
        safe_name = os.path.basename(f.filename)
        loc = f"{UPLOAD_DIR}/{safe_name}"
        with open(loc, "wb+") as fo:
            shutil.copyfileobj(f.file, fo)
        saved_files.append((loc, safe_name))

    from utils import is_valid_candidate_email

    # Fetch user-scoped scoring weights
    user_settings = db.query(models.GlobalSettings).filter(
        models.GlobalSettings.created_by == current_user.id
    ).first()
    if not user_settings:
        user_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.key == "default"
        ).first()

    scoring_weights = (
        user_settings.config.get("scoring")
        if user_settings and user_settings.config
        else None
    )

    def stream_processor():
        session = database.SessionLocal()
        results = []
        valid_screened = []
        rejected_email_candidates = []

        try:
            for idx, (file_location, safe_filename) in enumerate(saved_files):
                # 1. Event: start_file (parsing)
                yield json.dumps({
                    "event": "start_file",
                    "index": idx,
                    "file": safe_filename,
                    "stage": "parsing"
                }) + "\n"

                # Check format
                if not safe_filename.lower().endswith(('.pdf', '.docx', '.doc')):
                    cand_data = {
                        "id": f"failed_{int(time.time())}_{idx}",
                        "file": safe_filename,
                        "name": safe_filename,
                        "status": "failed",
                        "error": "Unsupported format.",
                        "score": 0,
                        "reasoning": "Unsupported file format."
                    }
                    results.append(cand_data)
                    yield json.dumps({
                        "event": "candidate_completed",
                        "index": idx,
                        "candidate": cand_data
                    }) + "\n"
                    continue

                # 2. Event: stage extracting
                yield json.dumps({
                    "event": "stage",
                    "index": idx,
                    "file": safe_filename,
                    "stage": "extracting"
                }) + "\n"

                extraction = extract_single_resume(file_location, safe_filename)
                if extraction["status"] == "failed":
                    cand_data = {
                        "id": f"failed_{int(time.time())}_{idx}",
                        "file": safe_filename,
                        "name": safe_filename,
                        "status": "failed",
                        "error": extraction.get("error", "Extraction failed"),
                        "score": 0,
                        "reasoning": extraction.get("error", "Extraction failed")
                    }
                    results.append(cand_data)
                    yield json.dumps({
                        "event": "candidate_completed",
                        "index": idx,
                        "candidate": cand_data
                    }) + "\n"
                    continue

                info = extraction.get("candidate_info", {})
                email = info.get("email")
                if not email:
                    cand_data = {
                        "id": f"failed_{int(time.time())}_{idx}",
                        "file": safe_filename,
                        "name": info.get("name") or safe_filename,
                        "status": "failed",
                        "error": "Could not extract email.",
                        "score": 0,
                        "reasoning": "Could not extract email."
                    }
                    results.append(cand_data)
                    yield json.dumps({
                        "event": "candidate_completed",
                        "index": idx,
                        "candidate": cand_data
                    }) + "\n"
                    continue

                # 3. Event: stage matching
                yield json.dumps({
                    "event": "stage",
                    "index": idx,
                    "file": safe_filename,
                    "stage": "matching"
                }) + "\n"

                keyword_score, matched_skills, missing_skills = get_keyword_score(
                    extraction["full_text"],
                    effective_jd,
                    explicit_skills=parsed_required_skills if parsed_required_skills else None,
                    preferred_skills=parsed_preferred_skills if parsed_preferred_skills else None,
                    specific_targets=specific_targets,
                    scoring_weights=scoring_weights
                )
                extraction["keyword_score"] = keyword_score
                extraction["matched_skills"] = matched_skills
                extraction["missing_skills"] = missing_skills

                # Email validation check
                orig_dummy = info.get("original_dummy_email")
                is_invalid = bool(
                    info.get("is_dummy_email")
                    or not email
                    or email.endswith(".internal")
                    or not is_valid_candidate_email(email)
                    or orig_dummy is not None
                )

                if is_invalid:
                    placeholder_label = orig_dummy or email or "No email found"
                    rejection_reason = (
                        f"Rejected: Invalid or placeholder email address ('{placeholder_label}') detected in resume. "
                        f"A valid contact email is required to proceed with candidate screening."
                    )
                    cand_data = {
                        "id": f"rejected_{int(time.time())}_{idx}",
                        "file": safe_filename,
                        "name": info.get("name") or safe_filename,
                        "email": placeholder_label,
                        "role": jd_title,
                        "phone": info.get("phone"),
                        "status": "Rejected",
                        "score": 0,
                        "reasoning": rejection_reason,
                        "rejection_reason": rejection_reason,
                        "is_dummy_email": True,
                        "original_dummy_email": placeholder_label,
                        "analysis": {
                            "score": 0,
                            "extracted_role": jd_title,
                            "reasoning": rejection_reason,
                            "key_skills_match": matched_skills,
                            "missing_skills": ["Valid Contact Email"]
                        },
                        "candidate": {
                            "id": None,
                            "name": info.get("name") or safe_filename,
                            "email": placeholder_label,
                            "role": jd_title,
                            "phone": info.get("phone"),
                            "status": "Rejected",
                            "is_dummy_email": True,
                            "original_dummy_email": placeholder_label,
                            "rejection_reason": rejection_reason
                        }
                    }

                    # Ensure deleted from DB
                    if email:
                        session.query(models.Candidate).filter(models.Candidate.email == email).delete()
                    if orig_dummy:
                        session.query(models.Candidate).filter(models.Candidate.email == orig_dummy).delete()
                    session.commit()

                    results.append(cand_data)
                    rejected_email_candidates.append(cand_data)

                    yield json.dumps({
                        "event": "candidate_completed",
                        "index": idx,
                        "candidate": cand_data
                    }) + "\n"
                    continue

                # 4. Event: stage scoring
                yield json.dumps({
                    "event": "stage",
                    "index": idx,
                    "file": safe_filename,
                    "stage": "scoring"
                }) + "\n"

                # Run LLM screening
                scored_data = run_llm_screening(
                    extraction,
                    effective_jd,
                    jd_title,
                    required_skills=parsed_required_skills,
                    preferred_skills=parsed_preferred_skills,
                    specific_targets=specific_targets,
                    scoring_weights=scoring_weights
                )
                score = scored_data.get("score", keyword_score)

                # Upsert into DB for valid candidate
                cand_q = session.query(models.Candidate).filter(models.Candidate.email == email)
                if org_id:
                    cand_q = cand_q.filter(models.Candidate.organization_id == org_id)
                candidate = cand_q.first()
                if not candidate:
                    candidate = models.Candidate(
                        name=info.get('name', 'Unknown'),
                        email=email,
                        phone=info.get('phone') or info.get('mobile') or info.get('contact'),
                        role=jd_title,
                        status=models.CandidateStatus.Applied,
                        stage=models.CandidateStage.Resume_Screening,
                        resume_file=safe_filename,
                        full_text=scored_data["full_text"],
                        score=score,
                        analysis_data=scored_data["analysis"],
                        created_by=current_user.id,
                        organization_id=org_id
                    )
                    session.add(candidate)
                    session.commit()
                    session.refresh(candidate)
                    log = models.ActivityLog(user_id=current_user.id, action="screened", target=candidate.name, details=f"Score: {score}/100", organization_id=org_id)
                    session.add(log)
                    session.commit()
                else:
                    new_name = info.get('name', 'Unknown')
                    if new_name and new_name not in ["Unknown", "Unknown Candidate", "Candidate", "Resume", "CV"]:
                        candidate.name = new_name
                    if candidate.role != jd_title:
                        candidate.role = jd_title
                    candidate.score = score
                    candidate.analysis_data = scored_data["analysis"]
                    candidate.full_text = scored_data["full_text"]
                    phone = info.get('phone') or info.get('mobile') or info.get('contact')
                    if phone:
                        candidate.phone = phone
                    candidate.status = models.CandidateStatus.Applied
                    candidate.stage = models.CandidateStage.Resume_Screening
                    candidate.created_by = current_user.id
                    log = models.ActivityLog(user_id=current_user.id, action="re-screened", target=candidate.name, details=f"Score: {score}/100")
                    session.add(log)
                    session.commit()

                cand_output = {
                    "id": candidate.id,
                    "file": safe_filename,
                    "name": candidate.name,
                    "email": candidate.email,
                    "role": candidate.role,
                    "phone": candidate.phone,
                    "score": score,
                    "status": "Screened",
                    "reasoning": scored_data.get("reasoning", "Screening complete."),
                    "analysis": scored_data.get("analysis", {}),
                    "is_dummy_email": False,
                    "original_dummy_email": None,
                    "candidate": {
                        "name": candidate.name,
                        "email": candidate.email,
                        "id": candidate.id,
                        "role": candidate.role,
                        "phone": candidate.phone,
                        "status": "Screened",
                        "is_dummy_email": False,
                        "original_dummy_email": None
                    }
                }

                results.append(cand_output)
                valid_screened.append(cand_output)

                # Yield candidate_completed
                yield json.dumps({
                    "event": "candidate_completed",
                    "index": idx,
                    "candidate": cand_output
                }) + "\n"

            # Post-processing: Handle Top N cutoff in DB
            valid_screened.sort(key=lambda x: x.get("score", 0), reverse=True)
            cutoff_candidates = valid_screened[top_n:]

            for cut in cutoff_candidates:
                cut_email = cut.get("email")
                if cut_email:
                    existing = session.query(models.Candidate).filter(models.Candidate.email == cut_email).first()
                    if existing:
                        session.delete(existing)
            session.commit()

            # Final completed event
            all_sorted_results = sorted(results, key=lambda x: x.get("score", 0), reverse=True)
            yield json.dumps({
                "event": "done",
                "message": "Screening Complete",
                "results": all_sorted_results,
                "total_screened": len(valid_screened) + len(rejected_email_candidates),
                "top_n": top_n
            }) + "\n"

        except Exception as e:
            print(f"Error during streaming resume screening: {e}")
            yield json.dumps({
                "event": "error",
                "message": str(e)
            }) + "\n"
        finally:
            session.close()

    return StreamingResponse(stream_processor(), media_type="application/x-ndjson")

@router.post("/candidates/", response_model=schemas.CandidateResponse)
def create_candidate_manual(
    candidate_in: schemas.CandidateCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    cand_q = db.query(models.Candidate).filter(models.Candidate.email == candidate_in.email)
    if org_id:
        cand_q = cand_q.filter(models.Candidate.organization_id == org_id)
    existing = cand_q.first()
    if existing:
        raise HTTPException(status_code=400, detail="Candidate with this email already exists.")
    
    new_candidate = models.Candidate(
        name=candidate_in.name,
        email=candidate_in.email,
        role=candidate_in.role,
        stage=candidate_in.stage,
        status=candidate_in.status,
        score=0.0,
        analysis_data={"reasoning": "Manually added candidate."},
        created_by=current_user.id,
        organization_id=org_id
    )
    
    db.add(new_candidate)
    db.commit()
    db.refresh(new_candidate)
    
    # Log activity
    log = models.ActivityLog(
        user_id=current_user.id,
        action="manually added",
        target=new_candidate.name,
        details=f"Role: {new_candidate.role}",
        organization_id=org_id
    )
    db.add(log)
    db.commit()
    
    return new_candidate

@router.get("/candidates/", response_model=List[schemas.CandidateResponse])
def get_candidates(
    stage: Optional[str] = None,
    status: Optional[str] = None,
    role: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    else:
        query = query.filter(models.Candidate.created_by == current_user.id)

    if stage:
        query = query.filter(models.Candidate.stage == stage)
    if status:
        query = query.filter(models.Candidate.status == status)
    if role:
        query = query.filter(models.Candidate.role == role)
        
    return query.order_by(models.Candidate.created_at.desc()).all()

@router.get("/active-roles/", response_model=List[str])
def get_active_roles(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Fetch distinct, non-null job roles from candidates belonging to the current organization.
    """
    org_id = _get_tenant_org_id(current_user, db)
    cand_q = db.query(models.Candidate.role).distinct()
    jd_q = db.query(models.JobDescription.role).distinct()
    if org_id:
        cand_q = cand_q.filter(models.Candidate.organization_id == org_id)
        jd_q = jd_q.filter(models.JobDescription.organization_id == org_id)
    else:
        cand_q = cand_q.filter(models.Candidate.created_by == current_user.id)
        jd_q = jd_q.filter(models.JobDescription.created_by == current_user.id)

    roles = cand_q.filter(models.Candidate.role != None, models.Candidate.role != "").all()
    jd_roles = jd_q.filter(models.JobDescription.role != None, models.JobDescription.role != "").all()
    all_roles = set([r[0] for r in roles if r[0]] + [j[0] for j in jd_roles if j[0]])
    return sorted(list(all_roles))

@router.patch("/candidates/{candidate_id}/", response_model=schemas.CandidateResponse)
@router.put("/candidates/{candidate_id}/", response_model=schemas.CandidateResponse)
def update_candidate(
    candidate_id: int,
    update_data: schemas.CandidateUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate).filter(models.Candidate.id == candidate_id)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    candidate = query.first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    if update_data.stage:
        candidate.stage = update_data.stage
    if update_data.status:
        candidate.status = update_data.status
        
    db.commit()
    db.refresh(candidate)
    
    # Log the action
    log = models.ActivityLog(
        user_id=current_user.id,
        action="promoted",
        target=candidate.name,
        details=f"Moved to {candidate.stage}",
        organization_id=org_id
    )
    db.add(log)
    db.commit()
    
    return candidate

@router.delete("/candidates/{candidate_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate).filter(models.Candidate.id == candidate_id)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    else:
        query = query.filter(models.Candidate.created_by == current_user.id)
    candidate = query.first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    db.delete(candidate)
    db.commit()
    
    return None

@router.post("/candidates/bulk-update/", response_model=Dict[str, Any])
def bulk_update_candidates(
    payload: schemas.BulkCandidateUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate).filter(models.Candidate.id.in_(payload.candidate_ids))
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    else:
        query = query.filter(models.Candidate.created_by == current_user.id)
    candidates = query.all()
    
    if not candidates:
        raise HTTPException(status_code=404, detail="No candidates found with provided IDs")
    
    updated_count = 0
    
    # STAGE MAPPING
    STAGE_MAPPING = {
        "Resume Screening": models.CandidateStage.Resume_Screening.value,
        "Aptitude Round": models.CandidateStage.Aptitude_Round.value,
        "Coding Round": models.CandidateStage.Coding_Round.value,
        "Technical Interview": models.CandidateStage.Technical_Interview.value,
        "HR Round": models.CandidateStage.HR_Round.value,
        "Offer Sent": models.CandidateStage.Offer_Sent.value
    }
    
    # NEXT STAGE ENFORCEMENT
    VALID_NEXT = {
        models.CandidateStage.Resume_Screening.value: [models.CandidateStage.Aptitude_Round.value],
        models.CandidateStage.Aptitude_Round.value: [models.CandidateStage.Coding_Round.value],
        models.CandidateStage.Coding_Round.value: [models.CandidateStage.Technical_Interview.value],
        models.CandidateStage.Technical_Interview.value: [models.CandidateStage.Offer_Sent.value, models.CandidateStage.HR_Round.value],
        models.CandidateStage.HR_Round.value: [models.CandidateStage.Offer_Sent.value]
    }
    
    target_stage_fixed = STAGE_MAPPING.get(payload.stage, payload.stage) if payload.stage and payload.stage != 'NEXT' else None

    for candidate in candidates:
        has_changed = False
        
        # Determine target stage for this candidate
        current_target = None
        if payload.stage == 'NEXT':
            allowed_next = VALID_NEXT.get(candidate.stage, [])
            if allowed_next:
                current_target = allowed_next[0] # Pick the primary next stage
        else:
            current_target = target_stage_fixed

        # 1. Stage Update (STRICT)
        if current_target and candidate.stage != current_target: 
            # Check if valid next step (if not 'NEXT' mode, validate manually provided stage)
            if payload.stage != 'NEXT':
                # ALLOW ADMIN OVERRIDE: If admin explicitly selects a stage, allow it.
                # We only enforce strict sequence for 'NEXT' (auto-promote).
                pass
            else:
                # For 'NEXT' auto-promote, ensure we have a valid path
                allowed_next = VALID_NEXT.get(candidate.stage, [])
                if not allowed_next:
                     # If no defined next stage, do nothing or error? 
                     # For bulk 'NEXT', we just skip if no path.
                     continue 
                current_target = allowed_next[0]

            old_stage = candidate.stage
            candidate.stage = current_target
            
            # Reset results for any NEW assessment round
            assessment_stages = [
                models.CandidateStage.Aptitude_Round.value, 
                models.CandidateStage.Coding_Round.value,
                models.CandidateStage.Technical_Interview.value
            ]
            if current_target in assessment_stages:
                candidate.score = 0.0
                candidate.status = models.CandidateStatus.Applied
                # Clear round-specific analysis but keep reasoning if possible
                if candidate.analysis_data:
                    new_data = {k: v for k, v in candidate.analysis_data.items() if k in ['reasoning', 'extracted_role', 'sentiment']}
                    candidate.analysis_data = new_data
            
            has_changed = True
            log = models.ActivityLog(user_id=current_user.id, action="promoted (bulk)", target=candidate.name, details=f"Moved from {old_stage} to {candidate.stage}", organization_id=org_id)
            db.add(log)

        # 2. Status Update
        if payload.status and candidate.status != payload.status:
            candidate.status = payload.status
            has_changed = True
            
        # Move to the offer stage if the status is "Offer Released" or stage becomes "Offer Sent"
        if payload.status == "Offer Released" or current_target == models.CandidateStage.Offer_Sent.value:
            candidate.stage = models.CandidateStage.Offer_Sent.value # Update stage so they leave the interview round
            candidate.status = "Offer Released"
            has_changed = True

        if has_changed:
            updated_count += 1
        
    db.commit()
    
    msg = f"Successfully updated {updated_count} candidate(s)."
    
    return {
        "message": msg,
        "count": updated_count
    }

@router.get("/stats/", response_model=schemas.StatsResponse)
def get_stats(
    days: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    else:
        query = query.filter(models.Candidate.created_by == current_user.id)
    
    if days and days != 'all':
        try:
            d = int(days)
            start_date = datetime.utcnow() - timedelta(days=d)
            query = query.filter(models.Candidate.created_at >= start_date)
        except ValueError:
            pass

    candidates = query.all()
    
    total = len(candidates)
    active = sum(1 for c in candidates if c.status != "Rejected")
    screened = total
    # Count as assessments only if they are not in Applied status (meaning they are assigned/in-progress/completed)
    assessments = sum(1 for c in candidates if c.stage in ["Aptitude Round", "Coding Round", "Technical Interview"] and c.status != "Applied")
    # Count as offers if status is Hired/Offer Released or stage is Offer Sent
    offers = sum(1 for c in candidates if c.status in ["Hired", "Offer Released"] or c.stage == "Offer Sent")
    
    qualified = sum(1 for c in candidates if c.status != "Rejected" and c.stage != "Resume Screening")
    coding_passed = sum(1 for c in candidates if c.stage in ["Technical Interview", "Offer Sent", "HR Round"])
    interview_cleared = offers # Approx logic
    
    return {
        "metrics": {
            "active": active,
            "screened": screened,
            "assessments": assessments,
            "offers": offers
        },
        "funnel": {
            "applications": total,
            "qualified": qualified,
            "coding_passed": coding_passed,
            "interview_cleared": interview_cleared
        }
    }

@router.post("/rescreen-unscored/")
def rescreen_unscored_candidates(
    payload: dict,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Re-run AI screening for candidates whose score is 0 and analysis_data is empty.
    Uses the saved resume file on disk + the provided job_description.
    """
    job_description = payload.get("job_description", "")
    if not job_description or not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description is required.")

    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate).filter(
        models.Candidate.score == 0.0,
        models.Candidate.analysis_data == None
    )
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    else:
        query = query.filter(models.Candidate.created_by == current_user.id)
    unscored = query.all()

    if not unscored:
        return {"message": "All candidates already have scores.", "rescreened": 0}

    # Extract JD title
    jd_lines = [l.strip() for l in job_description.split('\n') if l.strip()]
    raw_title = jd_lines[0][:100] if jd_lines else "General Candidate"
    # Simple normalize
    cleaned = raw_title.lower()
    if any(k in cleaned for k in ["full stack", "fullstack", "mern", "mean"]):
        jd_title = "Full Stack Software Engineer"
    elif any(k in cleaned for k in ["frontend", "front end", "react"]):
        jd_title = "Frontend Developer"
    elif any(k in cleaned for k in ["backend", "back end", "node", "django"]):
        jd_title = "Backend Developer"
    elif any(k in cleaned for k in ["python", "machine learning", "ai"]):
        jd_title = "Python Developer"
    else:
        jd_title = raw_title.title()

    rescreened_count = 0
    results = []

    user_settings = None
    if org_id:
        user_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.organization_id == org_id
        ).first()
    if not user_settings:
        user_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.created_by == current_user.id
        ).first()
    if not user_settings:
        user_settings = db.query(models.GlobalSettings).filter(
            models.GlobalSettings.key == "default"
        ).first()

    scoring_weights = (
        user_settings.config.get("scoring")
        if user_settings and user_settings.config
        else None
    )

    for candidate in unscored:
        full_text = candidate.full_text or ""

        # Compute keyword score from stored full_text
        keyword_score, matched_skills, missing_skills = get_keyword_score(
            full_text,
            job_description,
            scoring_weights=scoring_weights
        )

        # Try LLM screening
        try:
            analysis = RAGService.screen_resume(
                job_description,
                f"rescreen_{candidate.id}",
                full_text,
                scoring_weights=scoring_weights
            )
            score = analysis.get("score", keyword_score)
            reasoning = analysis.get("reasoning", "Re-screened via AI.")
            analysis_data = {
                "score": score,
                "extracted_role": jd_title,
                "reasoning": reasoning,
                "key_skills_match": analysis.get("key_skills_match", matched_skills),
                "missing_skills": analysis.get("missing_skills", missing_skills)
            }
        except Exception:
            # Fallback to keyword score
            score = keyword_score
            reasoning = f"AI unavailable. Score based on keyword matching: {keyword_score}%"
            analysis_data = {
                "score": keyword_score,
                "extracted_role": jd_title,
                "reasoning": reasoning,
                "key_skills_match": matched_skills,
                "missing_skills": missing_skills
            }

        # Update candidate record
        candidate.score = score
        candidate.analysis_data = analysis_data
        db.commit()
        rescreened_count += 1
        results.append({
            "name": candidate.name,
            "email": candidate.email,
            "score": score,
            "reasoning": reasoning
        })
        print(f"[Re-Screen] {candidate.name} | Score: {score}%")

    db.commit()
    return {
        "message": f"Re-screened {rescreened_count} candidate(s) successfully.",
        "rescreened": rescreened_count,
        "results": results
    }



# Extract Text from JD File
@router.post("/extract-text/")
async def extract_text_from_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    import tempfile
    suffix = os.path.splitext(file.filename)[1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    try:
        if suffix == ".txt":
            with open(tmp_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        elif suffix == ".pdf":
            text = RAGService.extract_text_from_pdf(tmp_path)
        elif suffix in [".doc", ".docx"]:
            text = RAGService.extract_text_from_docx(tmp_path)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type.")
        return {"text": text.strip(), "filename": file.filename}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------
# Phase 5: Structured Job Description & AI Skill Suggestion
# ---------------------------------------------------------

@router.post("/suggest-skills/", response_model=schemas.SuggestSkillsResponse)
def suggest_skills(
    request: schemas.SuggestSkillsRequest,
    current_user: models.User = Depends(require_recruiter_user)
):
    """
    AI-powered skill suggestion based on structured Job Description fields.
    Validates, normalizes, and deduplicates technical skills with graceful fallback.
    """
    result = skill_suggestion.suggest_skills_from_jd(request.model_dump())
    return schemas.SuggestSkillsResponse(
        skills=result.get("skills", []),
        required_skills=result.get("required_skills", []),
        preferred_skills=result.get("preferred_skills", [])
    )


@router.post("/job-descriptions/", response_model=schemas.JobDescriptionResponse, status_code=status.HTTP_201_CREATED)
def create_job_description(
    jd_data: schemas.JobDescriptionCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(require_recruiter_user)
):
    """
    Creates a new structured Job Description with normalized and deduplicated skills.
    """
    org_id = _get_tenant_org_id(current_user, db)
    req_skills = skill_suggestion.deduplicate_and_normalize_skills(jd_data.required_skills or [])
    pref_skills = skill_suggestion.deduplicate_and_normalize_skills(jd_data.preferred_skills or [])

    title_val = (jd_data.title or jd_data.role or "Job Description").strip()
    role_val = (jd_data.role or jd_data.title or "General Candidate").strip()

    new_jd = models.JobDescription(
        title=title_val,
        role=role_val,
        description=jd_data.description,
        required_skills=req_skills,
        preferred_skills=pref_skills,
        responsibilities=jd_data.responsibilities,
        experience_requirements=jd_data.experience_requirements,
        specific_targets=jd_data.specific_targets,
        expected_achievements=jd_data.expected_achievements,
        additional_requirements=jd_data.additional_requirements,
        target_capacity=jd_data.target_capacity or 50,
        created_by=current_user.id,
        organization_id=org_id
    )
    db.add(new_jd)
    db.commit()
    db.refresh(new_jd)
    return new_jd


@router.get("/job-descriptions/", response_model=List[schemas.JobDescriptionResponse])
def list_job_descriptions(
    role: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(require_recruiter_user)
):
    """
    Lists all Job Descriptions for current organization with optional role filtering.
    """
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.JobDescription)
    if org_id:
        query = query.filter(models.JobDescription.organization_id == org_id)
    if role:
        query = query.filter(models.JobDescription.role.ilike(f"%{role}%"))
    return query.order_by(models.JobDescription.id.desc()).all()


@router.get("/job-descriptions/{jd_id}/", response_model=schemas.JobDescriptionResponse)
def get_job_description(
    jd_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(require_recruiter_user)
):
    """
    Retrieves a single Job Description by ID scoped to current organization.
    """
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.JobDescription).filter(models.JobDescription.id == jd_id)
    if org_id:
        query = query.filter(models.JobDescription.organization_id == org_id)
    jd = query.first()
    if not jd:
        raise HTTPException(status_code=404, detail="Job description not found")
    return jd


@router.put("/job-descriptions/{jd_id}/", response_model=schemas.JobDescriptionResponse)
def update_job_description(
    jd_id: int,
    update_data: schemas.JobDescriptionUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(require_recruiter_user)
):
    """
    Updates an existing structured Job Description scoped to current organization.
    """
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.JobDescription).filter(models.JobDescription.id == jd_id)
    if org_id:
        query = query.filter(models.JobDescription.organization_id == org_id)
    jd = query.first()
    if not jd:
        raise HTTPException(status_code=404, detail="Job description not found")

    if jd.organization_id and org_id and jd.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to modify this job description")

    if jd.created_by is not None and jd.created_by != current_user.id and getattr(current_user, "role", None) not in (models.UserRole.PLATFORM_ADMIN, models.UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to modify this job description")

    update_dict = update_data.model_dump(exclude_unset=True)

    if "required_skills" in update_dict and update_dict["required_skills"] is not None:
        update_dict["required_skills"] = skill_suggestion.deduplicate_and_normalize_skills(update_dict["required_skills"])
    if "preferred_skills" in update_dict and update_dict["preferred_skills"] is not None:
        update_dict["preferred_skills"] = skill_suggestion.deduplicate_and_normalize_skills(update_dict["preferred_skills"])

    for field, val in update_dict.items():
        setattr(jd, field, val)

    db.commit()
    db.refresh(jd)
    return jd


@router.delete("/job-descriptions/{jd_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_description(
    jd_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(require_recruiter_user)
):
    """
    Deletes a Job Description scoped to current organization.
    """
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.JobDescription).filter(models.JobDescription.id == jd_id)
    if org_id:
        query = query.filter(models.JobDescription.organization_id == org_id)
    jd = query.first()
    if not jd:
        raise HTTPException(status_code=404, detail="Job description not found")

    if jd.organization_id and org_id and jd.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete this job description")

    if jd.created_by is not None and jd.created_by != current_user.id and getattr(current_user, "role", None) not in (models.UserRole.PLATFORM_ADMIN, models.UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete this job description")
    db.delete(jd)
    db.commit()
    return None


@router.get("/file/{candidate_id}")
def get_candidate_resume_file(
    candidate_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Secure tenant-isolated resume file retrieval.
    Guarantees user cannot access another organization's resume files.
    """
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate).filter(models.Candidate.id == candidate_id)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    candidate = query.first()
    if not candidate or not candidate.resume_file:
        raise HTTPException(status_code=404, detail="Resume file not found or access denied")

    file_path = os.path.join("media", candidate.resume_file)
    if not os.path.exists(file_path):
        file_path = os.path.join("media", "resumes", candidate.resume_file)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File does not exist on disk")

    return FileResponse(
        file_path,
        filename=os.path.basename(candidate.resume_file),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "Pragma": "no-cache",
            "Expires": "0",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff"
        }
    )


@router.get("/preview-token")
def get_resume_preview_token(
    file_path: str = Query(..., description="Filename or relative path of candidate resume"),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Issues a short-lived (60s), narrowly scoped access token specifically for browser navigation
    and iframe preview of candidate resumes.
    Verifies tenant isolation and permissions before issuance.
    """
    import utils
    clean_filename = Path(file_path).name
    if current_user.role != models.UserRole.PLATFORM_ADMIN:
        if current_user.role == models.UserRole.STUDENT:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students cannot request recruiter resume preview tokens."
            )
        cand = db.query(models.Candidate).filter(
            or_(
                models.Candidate.resume_file == clean_filename,
                models.Candidate.resume_file == file_path,
                models.Candidate.resume_file.endswith("/" + clean_filename)
            )
        ).first()
        if cand:
            user_org_id = getattr(current_user, "organization_id", None)
            if not user_org_id:
                try:
                    user_org_id = _get_tenant_org_id(current_user, db)
                except Exception:
                    user_org_id = None
            if user_org_id and cand.organization_id and user_org_id != cand.organization_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: Cannot preview candidate resume from another organization."
                )
        elif current_user.role not in (models.UserRole.ORGANIZATION_ADMIN, models.UserRole.HR_ADMIN, models.UserRole.HR):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions to preview candidate resumes."
            )

    token = utils.create_resume_preview_token(
        email=current_user.email,
        file_path=clean_filename,
        expires_seconds=60
    )
    return {
        "preview_token": token,
        "expires_in": 60,
        "token_type": "Bearer"
    }

