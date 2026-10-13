import re
import os
import time
import pypdf
import requests
import json
from typing import Optional, List, Dict, Any
from pathlib import Path
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from . import gemini_client

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

class RAGService:

    @staticmethod
    def extract_text_from_pdf(file_path):
        text = ""
        with open(file_path, 'rb') as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        return text

    @staticmethod
    def extract_text_from_docx(file_path):
        import zipfile
        import xml.etree.ElementTree as ET
        try:
            with zipfile.ZipFile(file_path) as z:
                xml_content = z.read('word/document.xml')
                root = ET.fromstring(xml_content)
                texts = []
                for paragraph in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                    p_text = []
                    for text in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
                        if text.text:
                            p_text.append(text.text)
                    if p_text:
                        texts.append("".join(p_text))
                return "\n".join(texts)
        except Exception as e:
            print(f"Error reading docx {file_path}: {e}")
            return ""

    @staticmethod
    def _clean_phone(raw_phone):
        """Clean and validate phone number to exactly 10 digits (Indian mobile)."""
        if not raw_phone:
            return None
        digits = re.sub(r'\D', '', raw_phone)
        # Remove common country codes: +91, 91, 0, 1
        if len(digits) == 12 and digits.startswith('91'):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith('0'):
            digits = digits[1:]
        elif len(digits) == 11 and digits.startswith('1'):
            digits = digits[1:]
        elif len(digits) > 10:
            digits = digits[-10:]  # Take last 10 digits
        # Validate: must be exactly 10 digits and start with 6-9 (Indian mobile)
        if len(digits) == 10 and digits[0] in '6789':
            return digits
        # Fallback: if 10 digits but doesn't start with 6-9, still return
        if len(digits) == 10:
            return digits
        return None

    @staticmethod
    def extract_candidate_info(text, filename=""):
        info = {
            "name": "Unknown Candidate",
            "email": None,
            "phone": None,
            "is_dummy_email": False,
            "original_dummy_email": None
        }

        # 1. Regex Email with spacing normalization (handling PDF artifacts like 'name @gmail.com')
        clean_text_for_email = re.sub(r'([a-zA-Z0-9._%+-]+)\s*@\s*([a-zA-Z0-9.-]+)\s*\.\s*([a-zA-Z]{2,})', r'\1@\2.\3', text)
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        raw_email_matches = re.findall(email_pattern, clean_text_for_email)

        from utils import is_valid_candidate_email
        valid_emails = []
        dummy_emails_found = []
        for em in raw_email_matches:
            em_clean = em.strip().rstrip('.')
            if is_valid_candidate_email(em_clean):
                if em_clean.lower() not in [v.lower() for v in valid_emails]:
                    valid_emails.append(em_clean)
            else:
                dummy_emails_found.append(em_clean)

        if valid_emails:
            info["email"] = valid_emails[0]
            info["is_dummy_email"] = False

        # 1b. Regex Phone (Indian mobile + international formats)
        phone_patterns = [
            r'(?:\+91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}',           # +91 9876543210
            r'(?:0|91)?[\s.-]?[6-9]\d{4}[\s.-]?\d{5}',           # 091 98765 43210
            r'(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}', # US format fallback
            r'(?:\+?\d[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,7}',  # General
        ]
        for pattern in phone_patterns:
            phone_matches = re.findall(pattern, text[:3000])
            for pm in phone_matches:
                cleaned = RAGService._clean_phone(pm)
                if cleaned:
                    info["phone"] = cleaned
                    break
            if info["phone"]:
                break

        # 2. Heuristic Name
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        for i in range(min(5, len(lines))):
            potential_name = lines[i]
            if (1 <= len(potential_name.split()) <= 4 and
                    len(potential_name) < 50 and
                    "@" not in potential_name and
                    not any(char.isdigit() for char in potential_name)):
                info["name"] = potential_name.title()
                break

        # 3. AI Fallback
        if not info["email"] or info["name"] == "Unknown Candidate" or not info["phone"]:
            try:
                header_text = text[:3000]
                ai_extracted = RAGService.extract_with_llm(header_text)
                if ai_extracted.get("name") and ai_extracted["name"] not in ["Unknown", "Null", None]:
                    info["name"] = ai_extracted["name"]
                if ai_extracted.get("email") and not info["email"]:
                    ai_email = str(ai_extracted["email"]).strip()
                    if is_valid_candidate_email(ai_email):
                        info["email"] = ai_email
                        info["is_dummy_email"] = False
                    else:
                        dummy_emails_found.append(ai_email)
                if ai_extracted.get("phone") and not info["phone"]:
                    cleaned_ai_phone = RAGService._clean_phone(ai_extracted["phone"])
                    if cleaned_ai_phone:
                        info["phone"] = cleaned_ai_phone
            except Exception as e:
                print(f"Candidate info extraction failed: {e}")

        # 4. Filename Fallback for Name
        if info["name"] in ["Unknown Candidate", "Resume", "Cv", "Curriculum Vitae"] and filename:
            base = os.path.splitext(filename)[0]
            clean_name = base.replace("_", " ").replace("-", " ").title()
            clean_name = re.sub(r'\bresume\b|\bcv\b|\bprofile\b', '', clean_name, flags=re.IGNORECASE).strip()
            if clean_name:
                info["name"] = clean_name

        # 5. Fallback for Email if only dummy email was found or no email exists in resume
        if not info["email"]:
            # Check for GitHub / LinkedIn handle in resume text (e.g., github.com/ashishps1)
            handle_match = re.search(r'github\.com/([a-zA-Z0-9_-]+)', text, re.IGNORECASE) or \
                           re.search(r'linkedin\.com/in/([a-zA-Z0-9_-]+)', text, re.IGNORECASE)
            handle = handle_match.group(1).lower() if handle_match else None
            if not handle:
                clean_name = re.sub(r'[^a-zA-Z0-9]+', '.', info["name"]).strip('.').lower()
                if clean_name and clean_name not in ["unknown", "unknown.candidate", "candidate", "resume", "cv"]:
                    handle = clean_name
                elif filename:
                    handle = os.path.splitext(filename)[0].lower().replace(' ', '_').replace('-', '_')
                else:
                    handle = f"candidate_{int(time.time())}"

            clean_handle = re.sub(r'[^a-zA-Z0-9._-]', '', handle).strip('._-')
            if not clean_handle:
                clean_handle = "candidate"

            # Assign valid internal candidate email
            info["email"] = f"{clean_handle}@candidate.hiringai.internal"
            info["is_dummy_email"] = True
            info["original_dummy_email"] = dummy_emails_found[0] if dummy_emails_found else None

        return info

    @staticmethod
    def extract_with_llm(text_chunk):
        """
        Uses Gemini to parse structured contact info from raw text.
        """
        if not gemini_client.is_ai_available():
            return {}

        try:
            return RAGService._inner_extract_with_llm(text_chunk)
        except Exception as e:
            print(f"Gemini extraction failed after retries: {e}")
            return {}

    @staticmethod
    def _inner_extract_with_llm(text_chunk):
        prompt = f"""
        Extract the **Candidate Name**, **Email Address**, and **Phone Number** from the text below.
        Return null for any field not found.
        
        TEXT:
        {text_chunk}
        
        OUTPUT JSON ONLY:
        {{
            "name": "Full Name or null",
            "email": "email or null",
            "phone": "phone number or null"
        }}
        """
        
        return gemini_client.call_gemini(
            prompt,
            system_prompt="You are a data extraction assistant. Output valid JSON only.",
            temperature=0.1,
            json_mode=True,
        )

    @staticmethod
    def screen_resume(
        jd_text: str,
        resume_id: str,
        resume_context: str = "",
        required_skills: Optional[list] = None,
        preferred_skills: Optional[list] = None,
        specific_targets: Optional[str] = None,
        scoring_weights: Optional[dict] = None
    ):
        """
        Ingests strict context and scores.
        """
        # 0. Validate JD
        clean_jd = jd_text.strip()
        if len(clean_jd) < 15 or len(clean_jd.split()) < 3:
             return {
                "score": 0, 
                "reasoning": "Job Description is too vague or invalid (Text too short). Please provide a detailed description.", 
                "key_skills_match": [],
                "missing_skills": []
            }

        # 3. Call Gemini with context
        if not gemini_client.is_ai_available():
            return {"score": 0, "reasoning": "Missing API Key", "key_skills_match": [], "missing_skills": []}
        return RAGService.call_gemini_screening(
            jd_text,
            resume_context,
            required_skills=required_skills,
            preferred_skills=preferred_skills,
            specific_targets=specific_targets,
            scoring_weights=scoring_weights
        )

    @staticmethod
    def call_gemini_screening(
        jd,
        resume_context,
        required_skills=None,
        preferred_skills=None,
        specific_targets=None,
        scoring_weights=None
    ):
        # Fetch dynamic scoring weights: use passed recruiter-scoped weights if provided,
        # otherwise query the latest configuration from database.
        if scoring_weights and isinstance(scoring_weights, dict):
            weights = {
                "skills": scoring_weights.get("skills", 40),
                "experience": scoring_weights.get("experience", 25),
                "projects": scoring_weights.get("projects", 20),
                "education": scoring_weights.get("education", 10),
                "bonus": scoring_weights.get("bonus", 5)
            }
        else:
            try:
                from database import SessionLocal
                import models
                db = SessionLocal()
                settings_obj = db.query(models.GlobalSettings).order_by(models.GlobalSettings.id.desc()).first()
                weights = settings_obj.config.get("scoring", {
                    "skills": 40,
                    "experience": 25,
                    "projects": 20,
                    "education": 10,
                    "bonus": 5
                }) if settings_obj else {
                    "skills": 40,
                    "experience": 25,
                    "projects": 20,
                    "education": 10,
                    "bonus": 5
                }
                db.close()
            except Exception as e:
                print(f"Error fetching scoring weights: {e}")
                weights = {
                    "skills": 40,
                    "experience": 25,
                    "projects": 20,
                    "education": 10,
                    "bonus": 5
                }

        req_skills_block = ", ".join(required_skills) if required_skills else "Extracted from JD"
        pref_skills_block = ", ".join(preferred_skills) if preferred_skills else "None specified"
        targets_block = specific_targets.strip() if specific_targets and specific_targets.strip() else "Standard role alignment based on JD"

        prompt = f"""
        Act as a Senior Technical Recruiter evaluation engine.
        
        CRITICAL EVALUATION PARAMETERS SPECIFIED BY HR:
        1. MUST-HAVE REQUIRED SKILLS:
        {req_skills_block}
        
        2. SPECIFIC TARGETS & KEY CRITERIA:
        {targets_block}
        
        3. PREFERRED / NICE-TO-HAVE SKILLS:
        {pref_skills_block}
        
        FULL JOB DESCRIPTION:
        {jd}
        
        CANDIDATE RESUME:
        {resume_context[:25000]} 
        
        TASK & SCORING RUBRIC (Total 100%):
        1. Required Skills Match ({weights.get('skills', 40)}%):
           - Compare candidate skills in resume strictly with HR must-have skills: [{req_skills_block}].
           - Candidate must demonstrate evidence of these required skills in experience/projects.
           - Component score = (matched_required / total_required) * {weights.get('skills', 40)}.
        2. Specific Targets Alignment ({weights.get('projects', 20)}%):
           - Evaluate how well candidate satisfies the Specific Targets: [{targets_block}].
           - Full alignment = {weights.get('projects', 20)}, partial = proportional, no evidence = 0.
        3. Experience Relevance ({weights.get('experience', 25)}%):
           - Compare depth and seniority of experience with JD responsibilities.
        4. Education & Qualifications ({weights.get('education', 10)}%):
           - Degree match, relevant coursework, certifications.
        5. Preferred Skills & Bonus ({weights.get('bonus', 5)}%):
           - Award bonus for matching preferred skills: [{pref_skills_block}].
        
        OUTPUT REQUIREMENTS:
        - Return a precise integer Total Score (0-100).
        - Component scores must sum up to the total score.
        - key_skills_match: List all matched required skills and relevant candidate skills.
        - missing_skills: List any missing must-have required skills from HR's requirements.
        - reasoning: Provide a concise 2-4 sentence executive summary detailing:
          * Number of required skills matched out of total (e.g., "Matches 4/4 required skills: Python, Java, React, JavaScript").
          * How the candidate satisfies the HR specific targets and criteria.
          * Overall readiness assessment for this role.
        - extracted_role: Normalized role title.
        
        Return STRICT JSON only:
        {{
            "score": (0-100 integer),
            "component_scores": {{
                "skills": (0-{weights.get('skills', 40)}),
                "experience": (0-{weights.get('experience', 25)}),
                "projects": (0-{weights.get('projects', 20)}),
                "education": (0-{weights.get('education', 10)}),
                "bonus": (0-{weights.get('bonus', 5)})
            }},
            "key_skills_match": ["Skill A", "Skill B"],
            "missing_skills": ["Skill X"],
            "reasoning": "Reasoning...",
            "extracted_role": "Job Title"
        }}
        """
        
        try:
            return gemini_client.call_gemini(
                prompt,
                system_prompt="You are a helpful and accurate recruitment assistant. You only output valid JSON.",
                temperature=0.1,
                json_mode=True,
            )
        except Exception as e:
            print(f"Gemini screening error: {e}")
            raise
