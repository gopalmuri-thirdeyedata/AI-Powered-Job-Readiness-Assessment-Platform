"""
AI Resume Analysis Service for Student Career & Placement Platform.
Extracts structured dimensions from resumes without fabricating achievements or skills.
Reuses existing RAG text extraction and LLM clients (Gemini) with robust fallback.
"""

import re
from typing import Dict, Any
from pathlib import Path
from services.rag_service import RAGService
from services import gemini_client

def extract_resume_text(file_path: str) -> str:
    """Extracts raw text from PDF or DOCX resume using existing RAG infrastructure."""
    path = Path(file_path)
    if not path.exists():
        return ""
    if path.suffix.lower() == ".pdf":
        return RAGService.extract_text_from_pdf(str(path))
    elif path.suffix.lower() in (".docx", ".doc"):
        return RAGService.extract_text_from_docx(str(path))
    else:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception:
            return ""

def extract_candidate_name_from_resume(raw_text: str) -> str:
    """
    Extracts the candidate's actual full name from the top lines of a resume.
    In almost all resumes (PDF/DOCX), the candidate's name is in the first 1-8 non-empty lines.
    """
    if not raw_text:
        return ""
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    for line in lines[:8]:
        # Handle lines where candidate name and titles/contacts are separated by dashes, pipes, bullets, spaces, or tabs
        parts = re.split(r'[-–—|•\t]+|\s{2,}', line)
        for part in parts:
            part_clean = part.strip()
            if not part_clean:
                continue
            lower_part = part_clean.lower()
            if any(bad in lower_part for bad in ["@", "http", "www.", "github", "linkedin", "leetcode", "phone", "curriculum", "resume", "education", "experience", "skills", "projects", "summary", "+91", "tel:"]):
                continue
            # Remove numbers and non-letter symbols
            cleaned = re.sub(r"[^A-Za-z\s\.\-']", "", part_clean).strip()
            words = cleaned.split()
            # Candidate name typically has 2 to 4 words (e.g., "Gopal Muri", "Jane Doe")
            if 2 <= len(words) <= 4 and all(len(w) >= 2 for w in words):
                return " ".join(words).title()
            if len(words) == 1 and 3 <= len(words[0]) <= 25 and words[0].lower() not in ("student", "candidate", "developer", "engineer", "software", "curriculum", "vitae"):
                return words[0].title()
    return ""

def _fallback_heuristic_analysis(raw_text: str) -> Dict[str, Any]:
    """Deterministic, rule-based extraction when LLM is unavailable or times out."""
    lower_text = raw_text.lower()
    extracted_candidate_name = extract_candidate_name_from_resume(raw_text)

    
    # Common tech skills dictionary
    tech_keywords = [
        "python", "javascript", "typescript", "java", "c++", "c", "c#", "go", "rust", "php", "ruby", "kotlin", "swift",
        "react", "react.js", "next.js", "vue", "angular", "node.js", "express", "django", "fastapi", "flask", "spring boot",
        "sql", "mysql", "postgresql", "mongodb", "redis", "firebase", "sqlite",
        "html", "css", "tailwind", "bootstrap",
        "git", "github", "docker", "kubernetes", "aws", "azure", "gcp", "linux",
        "machine learning", "data science", "pandas", "numpy", "tensorflow", "pytorch"
    ]
    extracted_tech = [k for k in tech_keywords if re.search(r'\b' + re.escape(k) + r'\b', lower_text)]
    
    # Soft skills dictionary
    soft_keywords = ["communication", "teamwork", "leadership", "problem solving", "adaptability", "critical thinking", "collaboration", "time management"]
    extracted_soft = [k for k in soft_keywords if re.search(r'\b' + re.escape(k) + r'\b', lower_text)]

    # DSA Indicators
    dsa_keywords = ["data structures", "algorithms", "dsa", "leetcode", "hackerrank", "codechef", "codeforces", "binary tree", "dynamic programming", "graph"]
    found_dsa = [k for k in dsa_keywords if k in lower_text]
    dsa_score = min(100.0, len(found_dsa) * 20.0)

    # Basic section presence checks
    has_projects = bool(re.search(r'\b(projects|academic projects|personal projects)\b', lower_text))
    has_education = bool(re.search(r'\b(education|academic background|qualification|b\.tech|bachelor|m\.tech|degree)\b', lower_text))
    has_experience = bool(re.search(r'\b(experience|internship|work experience|employment)\b', lower_text))
    has_certs = bool(re.search(r'\b(certifications|certificates|certified)\b', lower_text))
    has_metrics = bool(re.search(r'\b(\d+%\s*increase|\d+%\s*improvement|\d+\s*users|\d+\s*stars|\d+\s*ms)\b', lower_text))

    missing_info = []
    if not has_metrics:
        missing_info.append("Quantifiable metrics or measurable project outcomes")
    if not has_certs:
        missing_info.append("Relevant professional or technical certifications")
    if not has_experience:
        missing_info.append("Internship or practical industry experience")
    if not found_dsa:
        missing_info.append("Explicit Data Structures & Algorithms (DSA) or competitive programming profiles")
    if "github" not in lower_text and "linkedin" not in lower_text:
        missing_info.append("GitHub / LinkedIn profile links")

    strengths = []
    if len(extracted_tech) >= 5:
        strengths.append(f"Demonstrated core technical foundation across {len(extracted_tech)} technologies")
    if has_projects:
        strengths.append("Dedicated project section highlighting hands-on application")
    if has_education:
        strengths.append("Clearly stated educational and academic background")
    if found_dsa:
        strengths.append("Indicators of algorithms and computational problem-solving")
    if not strengths:
        strengths.append("Readable resume structure with foundational academic details")

    weaknesses = []
    if len(extracted_tech) < 4:
        weaknesses.append("Limited technical skill keywords for automated ATS indexing")
    if not has_metrics:
        weaknesses.append("Project descriptions lack quantifiable impact (metrics, user scale, efficiency)")
    if not has_experience:
        weaknesses.append("No industry internship or professional experience documented")
    if not found_dsa:
        weaknesses.append("Lacks explicit mentions of algorithms or coding practice (LeetCode / HackerRank)")
    if not weaknesses:
        weaknesses.append("Project technical depth and architecture documentation can be expanded")

    recommendations = [
        "Include measurable outcomes for each project (e.g. 'reduced latency by 25%', 'served 200+ requests')",
        "Add links to your public GitHub repositories and live hosted deployments",
        "Group technical skills into clear categories: Languages, Frameworks, Databases, Tools"
    ]

    # Calculate ATS score based on clarity, length, and sections
    ats_score = 50.0
    if has_education: ats_score += 10.0
    if has_projects: ats_score += 15.0
    if len(extracted_tech) >= 4: ats_score += 15.0
    if has_experience: ats_score += 10.0
    ats_score = min(100.0, max(30.0, ats_score))

    overall_score = round((ats_score * 0.5) + (min(100.0, len(extracted_tech) * 7.0) * 0.3) + (dsa_score * 0.2), 1)

    return {
        "candidate_name": extracted_candidate_name,
        "overall_score": overall_score,
        "ats_score": ats_score,
        "technical_skills": [s.title() for s in extracted_tech],
        "soft_skills": [s.title() for s in extracted_soft],
        "projects": [{"title": "Projects Section", "description": "Hands-on projects detected in resume"}] if has_projects else [],
        "education": [{"degree": "Academic Degree", "status": "Detected"}] if has_education else [],
        "experience": [{"role": "Internship / Experience", "status": "Detected"}] if has_experience else [],
        "certifications": ["Certifications present"] if has_certs else [],
        "dsa_indicators": {
            "score": dsa_score,
            "detected_keywords": found_dsa,
            "has_coding_profile": bool("leetcode" in lower_text or "codechef" in lower_text or "hackerrank" in lower_text)
        },
        "ats_compatibility": {
            "score": ats_score,
            "clean_formatting": True,
            "standard_sections": has_education and has_projects
        },
        "resume_quality": {
            "score": round((ats_score + overall_score) / 2, 1),
            "conciseness": len(raw_text.split()) < 900
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "missing_information": missing_info,
        "recommendations": recommendations
    }

def analyze_student_resume(raw_text: str, target_role: str = "Software Engineer") -> Dict[str, Any]:
    """
    Analyzes student resume using LLM with deterministic fallback.
    Strictly instructs model NEVER to fabricate information not present in the resume.
    """
    if not raw_text or len(raw_text.strip()) < 40:
        return _fallback_heuristic_analysis(raw_text)

    prompt = f"""
You are an expert technical recruiter and resume analyst.
Analyze the following STUDENT RESUME text for a candidate targeting the role of: '{target_role}'.

IMPORTANT INSTRUCTIONS:
- NEVER invent, assume, or hallucinate any experience, achievements, metrics, skills, projects, or certifications that are NOT in the text.
- If an item or metric is absent, explicitly mark it as missing in 'missing_information'.
- Base all scores strictly on the evidence in the resume text.
- Extract the candidate's actual full name from the top header of the resume.

Resume Text:
\"\"\"
{raw_text[:6000]}
\"\"\"

Respond with a single VALID JSON object (and nothing else) with the exact structure below:
{{
  "candidate_name": "<full name of candidate extracted from the header of the resume, e.g. Gopal Muri>",
  "overall_score": <float 0-100>,
  "ats_score": <float 0-100>,
  "technical_skills": [<list of strings extracted from resume>],
  "soft_skills": [<list of strings extracted from resume>],
  "projects": [
    {{
      "title": "<project name>",
      "technologies": [<tech list>],
      "description": "<summary based ONLY on resume text>",
      "has_metrics": <true or false>
    }}
  ],
  "education": [
    {{
      "degree": "<degree/course if present>",
      "institution": "<college/university if present>",
      "graduation_year": "<year or null>",
      "cgpa": "<cgpa/percentage or null>"
    }}
  ],
  "experience": [
    {{
      "role": "<role/internship title>",
      "company": "<company name>",
      "duration": "<dates if present>",
      "summary": "<summary based ONLY on text>"
    }}
  ],
  "certifications": [<list of strings>],
  "dsa_indicators": {{
    "score": <float 0-100>,
    "has_coding_profile": <true or false>,
    "notes": "<DSA mentions or 'No explicit DSA platform links found'>"
  }},
  "ats_compatibility": {{
    "score": <float 0-100>,
    "standard_headers": <true or false>,
    "notes": "<ATS feedback>"
  }},
  "resume_quality": {{
    "score": <float 0-100>,
    "formatting_clarity": "<feedback>",
    "action_verbs": <true or false>
  }},
  "strengths": [<list of 3-5 specific strengths found in the resume>],
  "weaknesses": [<list of 2-4 concrete weaknesses or gaps>],
  "missing_information": [<list of missing items, e.g. 'No quantifiable project metrics', 'Missing GitHub URL', 'Missing graduation year'>],
  "recommendations": [<list of 3-5 actionable improvement tips based ONLY on what is missing>]
}}
"""

    # 1. Try Gemini
    try:
        if gemini_client.is_ai_available():
            res = gemini_client.call_gemini(
                prompt=prompt,
                system_prompt="You are an expert technical resume evaluator. Return strictly valid JSON.",
                temperature=0.2,
                json_mode=True
            )
            if isinstance(res, dict) and "overall_score" in res:
                return _clean_and_validate_analysis(res, raw_text)
    except Exception as e:
        print(f"Gemini resume analysis attempt failed: {e}")

    # 2. Fallback to heuristic analysis
    return _fallback_heuristic_analysis(raw_text)

def _clean_and_validate_analysis(data: Dict[str, Any], raw_text: str) -> Dict[str, Any]:
    """Ensures all expected keys and types are present and clamped within valid ranges."""
    fallback = _fallback_heuristic_analysis(raw_text)
    
    overall_score = float(data.get("overall_score", fallback["overall_score"]))
    ats_score = float(data.get("ats_score", fallback["ats_score"]))
    candidate_name = data.get("candidate_name") or fallback.get("candidate_name") or ""
    if candidate_name:
        candidate_name = re.sub(r"[^A-Za-z\s\.\-']", "", str(candidate_name)).strip().title()

    return {
        "candidate_name": candidate_name or fallback.get("candidate_name", ""),
        "overall_score": min(100.0, max(10.0, round(overall_score, 1))),
        "ats_score": min(100.0, max(10.0, round(ats_score, 1))),
        "technical_skills": data.get("technical_skills") or fallback["technical_skills"],
        "soft_skills": data.get("soft_skills") or fallback["soft_skills"],
        "projects": data.get("projects") or fallback["projects"],
        "education": data.get("education") or fallback["education"],
        "experience": data.get("experience") or fallback["experience"],
        "certifications": data.get("certifications") or fallback["certifications"],
        "dsa_indicators": data.get("dsa_indicators") or fallback["dsa_indicators"],
        "ats_compatibility": data.get("ats_compatibility") or fallback["ats_compatibility"],
        "resume_quality": data.get("resume_quality") or fallback["resume_quality"],
        "strengths": data.get("strengths") or fallback["strengths"],
        "weaknesses": data.get("weaknesses") or fallback["weaknesses"],
        "missing_information": data.get("missing_information") or fallback["missing_information"],
        "recommendations": data.get("recommendations") or fallback["recommendations"],
    }


def persist_student_resume_version(db, profile, file_path: str, file_name: str, raw_text: str, analysis: Dict[str, Any]):
    """
    Saves an already-computed analysis as the student's next StudentResume version (V1, V2, ...),
    merges extracted skills into the profile and refreshes placement readiness. No AI call is made,
    so every flow that analyzes a resume (Resume page, RoleReady setup) shares one saved result.
    If the newest version holds identical text, it is returned unchanged instead of adding a duplicate.
    """
    import models
    from services.readiness_service import calculate_placement_readiness

    latest = db.query(models.StudentResume).filter(
        models.StudentResume.student_profile_id == profile.id
    ).order_by(models.StudentResume.version.desc()).first()

    if latest and (latest.full_text or "").strip() == (raw_text or "").strip():
        return latest

    student_resume = models.StudentResume(
        student_profile_id=profile.id,
        version=(latest.version + 1) if latest else 1,
        file_path=file_path,
        file_name=file_name,
        full_text=raw_text,
        overall_score=analysis["overall_score"],
        ats_score=analysis["ats_score"],
        analysis_data=analysis,
        strengths=analysis["strengths"],
        weaknesses=analysis["weaknesses"],
        missing_information=analysis["missing_information"],
        recommendations=analysis["recommendations"]
    )
    db.add(student_resume)

    profile.current_skills = list(set(profile.current_skills or []).union(analysis.get("technical_skills") or []))
    readiness = calculate_placement_readiness(profile, student_resume)
    profile.readiness_score = readiness["overall_score"]
    profile.readiness_breakdown = readiness["breakdown"]

    db.commit()
    db.refresh(student_resume)
    return student_resume
