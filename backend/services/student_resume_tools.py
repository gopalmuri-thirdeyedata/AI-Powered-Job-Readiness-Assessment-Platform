"""
Resume Analyzer (JD match) and Resume Formatter (structured extraction) for students.
Both reuse the existing text extraction and Gemini client, never invent resume content,
and fall back to deterministic rule-based results when Gemini is unavailable.
"""

import re
from typing import Any, Dict, List

from services import gemini_client
from services.student_resume_analyzer import extract_candidate_name_from_resume

MIN_RESUME_CHARS = 40
MIN_JD_CHARS = 50
FIT_VERDICTS = ("Strong", "Good", "Partial", "Weak")

SECTION_ALIASES = {
    "summary": ("summary", "profile", "objective", "about me", "career objective", "professional summary"),
    "skills": ("skills", "technical skills", "key skills", "core competencies", "technologies"),
    "experience": ("experience", "work experience", "professional experience", "internships", "internship", "employment"),
    "projects": ("projects", "academic projects", "personal projects", "key projects"),
    "education": ("education", "academic background", "qualifications", "academics"),
    "certifications": ("certifications", "certificates", "licenses", "courses"),
    "achievements": (
        "achievements", "awards", "honors", "honours", "accomplishments", "honors and awards",
        "awards and achievements", "extracurricular", "extracurricular activities", "activities",
        "positions of responsibility",
    ),
}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+|(?:linkedin\.com|github\.com)/\S+", re.IGNORECASE)
_BULLET_RE = re.compile(r"^\s*[•\-•●▪*▪●]+\s*")


def _str_list(value: Any, limit: int = 30) -> List[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        text = str(item).strip() if item is not None else ""
        if text and text not in out:
            out.append(text)
    return out[:limit]


def _clamp_score(value: Any, default: float = 0.0) -> float:
    try:
        return round(min(100.0, max(0.0, float(value))), 1)
    except (TypeError, ValueError):
        return default


def _skill_present(skill: str, lower_text: str) -> bool:
    return bool(re.search(r"(?<![\w+#])" + re.escape(skill.lower()) + r"(?![\w+#])", lower_text))


def verdict_for_score(score: float) -> str:
    if score >= 75:
        return FIT_VERDICTS[0]
    if score >= 55:
        return FIT_VERDICTS[1]
    if score >= 35:
        return FIT_VERDICTS[2]
    return FIT_VERDICTS[3]


# ----------------------------------------------------------------------------
# JD match analysis
# ----------------------------------------------------------------------------

# Skills worth matching beyond the base technology list (JDs often name these explicitly)
_JD_EXTRA_SKILLS = [
    "rest api", "restful apis", "microservices", "ci/cd", "authentication", "authorization", "oauth", "jwt", "graphql",
    "agile", "scrum", "unit testing", "oop", "data structures", "algorithms", "system design", "jira", "postman",
    "devops", "terraform", "jenkins", "nginx", "celery", "kafka", "rabbitmq", "spark", "hadoop", "tableau", "power bi",
    "excel", "figma", "selenium", "junit", "pytest", "scikit-learn", "nlp", "llm", "golang", "spring", "hibernate",
    "django rest framework", "websockets", "swagger", "orm", "nosql", "etl", "bigquery", "snowflake", "airflow",
]
_JD_SOFT_SKILLS = [
    "communication", "teamwork", "leadership", "problem solving", "problem-solving", "adaptability", "critical thinking",
    "collaboration", "time management", "ownership", "analytical",
]
_STOPWORDS = set(
    "the and for with that this from will have your you our are who can able work working strong good "
    "ability knowledge experience understanding skills required preferred including such other using well "
    "must should team role job candidate years year plus or any all more their they them its into has had been "
    "being per via etc able both each also than then over under across within".split()
)
_ROLE_WORDS = (
    "engineer", "developer", "analyst", "intern", "manager", "designer", "scientist", "architect", "consultant",
    "tester", "administrator", "specialist", "associate", "programmer", "lead",
)
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_DEGREE_RE = re.compile(
    r"\b(b\.?\s?tech|b\.?\s?e\.?|bachelor'?s?|b\.?\s?sc|bca|m\.?\s?tech|master'?s?|mca|m\.?\s?sc|mba|degree|diploma)\b",
    re.IGNORECASE,
)


def _skills_in(text: str) -> List[str]:
    """Skills (base technologies + common JD terms) present in the text, in display form, de-duplicated."""
    from services.student_resume_analyzer import TECH_KEYWORDS, format_skill_name

    lower = text.lower()
    found: List[str] = []
    seen = set()
    for kw in [k for k in TECH_KEYWORDS if k not in ("go", "c")] + _JD_EXTRA_SKILLS:
        if _skill_present(kw, lower):
            name = format_skill_name(kw)
            # "react" and "react.js" are one skill
            canon = name.lower().replace(".js", "")
            if canon not in seen:
                seen.add(canon)
                found.append(name)
    return found


def _jd_title_and_company(jd_text: str):
    title = company = ""
    lines = [l.strip() for l in jd_text.splitlines() if l.strip()]
    for line in lines[:25]:
        m = re.match(r"(?i)^(?:job\s*title|role|position|designation|opening)\s*[:\-–]\s*(.+)$", line)
        if m and not title:
            title = m.group(1).strip(" .")
        m = re.match(r"(?i)^(?:company|organi[sz]ation|employer|client)\s*(?:name)?\s*[:\-–]\s*(.+)$", line)
        if m and not company:
            company = m.group(1).strip(" .")
        m = re.match(r"(?i)^about\s+(?!the\b|us\b|you\b|this\b)([A-Z][\w&.\- ]{1,40}?)\s*[:\-–]?$", line)
        if m and not company:
            company = m.group(1).strip()
    if not title and lines:
        first = lines[0]
        if len(first) <= 90 and any(w in first.lower() for w in _ROLE_WORDS):
            title = re.sub(r"(?i)^(?:we are hiring|hiring|job description|jd)\s*[:\-–]?\s*", "", first).strip(" .")
    # "Full Stack Developer - ThirdEye Data" / "Data Analyst | Acme": split the trailing company off the role
    parts = re.split(r"\s+[-–—|]\s+", title)
    if len(parts) == 2 and len(parts[1]) <= 40 and not any(w in parts[1].lower() for w in _ROLE_WORDS):
        title = parts[0].strip()
        company = company or parts[1].strip()
    elif company and title.lower().endswith(company.lower()):
        title = re.sub(r"[\s\-–—|,]+$", "", title[: -len(company)])
    at = re.search(r"(?i)\b(?:at|@)\s+([A-Z][\w&.\-]*(?:\s[A-Z][\w&.\-]*){0,3})", title)
    if title and at and not company:
        company = at.group(1).strip()
        title = re.sub(r"(?i)\s*(?:at|@)\s+" + re.escape(at.group(1)) + r".*$", "", title).strip(" -–,")
    return title[:90], company[:60]


def _jd_required_years(jd_text: str):
    """Returns (min_years, label). (0, 'Fresher / entry level') when the JD targets freshers or interns."""
    lower = jd_text.lower()
    best = None
    for m in re.finditer(r"(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*years?", lower):
        window = lower[max(0, m.start() - 60): m.end() + 60]
        if "experience" in window or "exp" in window:
            lo = int(m.group(1))
            hi = int(m.group(2)) if m.group(2) else None
            label = f"{lo}-{hi} years" if hi else f"{lo}+ years"
            if best is None or lo < best[0]:
                best = (lo, label)
    if best:
        return best
    if re.search(r"fresher|entry[- ]level|graduate|intern(?:ship)?\b|0\s*(?:-|to)\s*1\s*year", lower):
        return 0, "Fresher / entry level"
    return None, ""


def _resume_experience_years(resume_text: str) -> float:
    """Rough experience length from the dates in the resume's own experience section."""
    from datetime import date

    sections = _split_sections(resume_text)
    today = date.today()
    total_months = 0
    for line in sections.get("experience", []):
        parts = re.split(r"\s*(?:-|–|—|\bto\b)\s*", line.strip(), maxsplit=1)
        if len(parts) != 2:
            continue

        def point(token: str):
            token = token.strip().lower()
            if re.search(r"present|current|till|ongoing|now", token):
                return today.year * 12 + today.month
            y = re.search(r"(19|20)\d{2}", token)
            if not y:
                return None
            mo = next((n for k, n in _MONTHS.items() if re.search(r"\b" + k, token)), 1)
            return int(y.group(0)) * 12 + mo

        start, end = point(parts[0]), point(parts[1])
        if start is not None and end is not None and end >= start:
            total_months += max(1, end - start)
    return round(total_months / 12, 1)


def _requirement_lines(jd_text: str) -> List[str]:
    lines = []
    for raw in jd_text.splitlines():
        if _BULLET_RE.match(raw):
            text = _BULLET_RE.sub("", raw).strip()
            if 12 <= len(text) <= 220 and not re.search(r"(?i)(full[- ]time|part[- ]time|contract|permanent)", text):
                lines.append(text)
    return lines[:25]


def _key_terms(text: str) -> List[str]:
    words = re.findall(r"[A-Za-z][A-Za-z+#.\-]{3,}", text.lower())
    return [w.strip(".-") for w in words if w.strip(".-") not in _STOPWORDS]


def _fallback_jd_match(resume_text: str, jd_text: str) -> Dict[str, Any]:
    """Rule-based analysis used when Gemini is unavailable: skills, requirements, experience, qualification."""
    resume_lower = resume_text.lower()
    jd_skills = _skills_in(jd_text)
    resume_skills = _skills_in(resume_text)
    resume_canon = {s.lower().replace(".js", "") for s in resume_skills}
    matched = [s for s in jd_skills if s.lower().replace(".js", "") in resume_canon]
    missing = [s for s in jd_skills if s not in matched]

    title, company = _jd_title_and_company(jd_text)

    # Requirement-by-requirement coverage
    reqs = _requirement_lines(jd_text)
    covered, uncovered = [], []
    for r in reqs:
        terms = list(dict.fromkeys(_key_terms(r)))
        if len(terms) < 2:
            continue
        hits = sum(1 for t in terms if t in resume_lower)
        (covered if hits / len(terms) >= 0.4 else uncovered).append(r)

    # Experience
    req_years, req_label = _jd_required_years(jd_text)
    have_years = _resume_experience_years(resume_text)
    have_label = f"about {have_years:g} year(s) of dated experience/internships" if have_years else "no dated work experience found"
    if req_years is None:
        experience_fit = f"The job description does not state a required experience level. Resume shows {have_label}."
        exp_ratio = None
    elif req_years == 0:
        experience_fit = f"The role is open to freshers or interns, so your profile ({have_label}) meets the level."
        exp_ratio = 1.0
    else:
        exp_ratio = min(1.0, have_years / req_years)
        verdict = "meets" if have_years >= req_years else "is below"
        experience_fit = f"The role asks for {req_label} of experience; your resume shows {have_label}, which {verdict} that requirement."

    # Qualification
    jd_degree = _DEGREE_RE.search(jd_text)
    resume_has_degree = bool(_DEGREE_RE.search(resume_text)) or bool(_split_sections(resume_text).get("education"))
    if jd_degree:
        qual_ratio = 1.0 if resume_has_degree else 0.0
        qualification_fit = (
            "The job description asks for a degree/qualification and your resume lists your education."
            if resume_has_degree else
            "The job description asks for a degree/qualification, but no education section was found in your resume."
        )
    else:
        qual_ratio = None
        qualification_fit = "The job description does not state a specific degree requirement."

    # Soft skills
    jd_lower = jd_text.lower()
    soft_jd = [s for s in _JD_SOFT_SKILLS if s in jd_lower]
    soft_have = [s for s in soft_jd if s.replace("-", " ") in resume_lower.replace("-", " ")]
    soft_missing = [s for s in soft_jd if s not in soft_have]

    # Weighted score over the parts the JD actually specifies
    parts = []
    if jd_skills:
        parts.append((60, len(matched) / len(jd_skills)))
    if covered or uncovered:
        parts.append((20, len(covered) / (len(covered) + len(uncovered))))
    if exp_ratio is not None:
        parts.append((10, exp_ratio))
    if qual_ratio is not None:
        parts.append((10, qual_ratio))
    score = round(100.0 * sum(w * r for w, r in parts) / sum(w for w, _ in parts), 1) if parts else 0.0

    strengths = []
    if matched:
        strengths.append(f"Resume shows {len(matched)} of {len(jd_skills)} skills named in the job description: {', '.join(matched[:8])}")
    if covered:
        strengths.append(f"{len(covered)} of {len(covered) + len(uncovered)} listed requirements are reflected in your resume")
    if exp_ratio is not None and exp_ratio >= 1.0:
        strengths.append("Your experience level meets what the role asks for")
    if qual_ratio == 1.0:
        strengths.append("Your education matches the role's qualification requirement")
    if soft_have:
        strengths.append(f"Soft skills the role values that your resume shows: {', '.join(s.title() for s in soft_have)}")

    weaknesses = []
    if missing:
        weaknesses.append(f"Skills the job description asks for that your resume does not mention: {', '.join(missing[:8])}")
    for r in uncovered[:3]:
        weaknesses.append(f"Requirement not evident in your resume: {r}")
    if exp_ratio is not None and exp_ratio < 1.0:
        weaknesses.append(f"Experience is below the {req_label} the role asks for")
    if qual_ratio == 0.0:
        weaknesses.append("No education details found to match the role's qualification requirement")
    if soft_missing:
        weaknesses.append(f"Soft skills the role mentions but your resume does not show: {', '.join(s.title() for s in soft_missing)}")
    if not jd_skills:
        weaknesses.append("No recognizable skills were found in the job description to compare against")

    recommendations = [f"Add genuine experience with {s} to your resume if you have it (project, internship or coursework)" for s in missing[:4]]
    if uncovered:
        recommendations.append("Address the unmatched requirements above with a project or bullet point that shows real evidence")
    if exp_ratio is not None and exp_ratio < 1.0:
        recommendations.append("Highlight internships, freelance work and substantial projects to make up for limited work experience")
    recommendations.append("Mirror the job description's wording for skills you really have, so ATS keyword filters match")

    who = " ".join(x for x in [title, f"at {company}" if company else ""] if x)
    summary = (
        f"{'For ' + who + ': ' if who else ''}your resume matches {len(matched)} of {len(jd_skills)} skills named in the job "
        f"description and covers {len(covered)} of {len(covered) + len(uncovered)} listed requirements. "
        "(Basic rule-based comparison; AI analysis was unavailable.)"
    )

    return {
        "ai_generated": False,
        "job_title": title,
        "company": company,
        "required_experience": req_label,
        "resume_experience": have_label,
        "match_score": score,
        "fit_verdict": verdict_for_score(score),
        "summary": summary,
        "matched_skills": matched,
        "missing_skills": missing,
        "strengths": strengths or ["Resume content was readable and could be compared with the job description"],
        "weaknesses": weaknesses or ["No major gaps were detected in this basic comparison"],
        "experience_fit": experience_fit,
        "qualification_fit": qualification_fit,
        "recommendations": recommendations,
    }


def _validate_jd_match(data: Dict[str, Any], resume_text: str, jd_text: str) -> Dict[str, Any]:
    fallback = _fallback_jd_match(resume_text, jd_text)
    score = _clamp_score(data.get("match_score"), fallback["match_score"])
    verdict = data.get("fit_verdict")
    if verdict not in FIT_VERDICTS:
        verdict = verdict_for_score(score)
    return {
        "ai_generated": True,
        "job_title": str(data.get("job_title") or fallback.get("job_title") or "").strip()[:90],
        "company": str(data.get("company") or fallback.get("company") or "").strip()[:60],
        "required_experience": str(data.get("required_experience") or fallback.get("required_experience") or "").strip(),
        "resume_experience": str(data.get("resume_experience") or fallback.get("resume_experience") or "").strip(),
        "match_score": score,
        "fit_verdict": verdict,
        "summary": str(data.get("summary") or "").strip(),
        "matched_skills": _str_list(data.get("matched_skills")) or fallback["matched_skills"],
        "missing_skills": _str_list(data.get("missing_skills")),
        "strengths": _str_list(data.get("strengths")) or fallback["strengths"],
        "weaknesses": _str_list(data.get("weaknesses")) or fallback["weaknesses"],
        "experience_fit": str(data.get("experience_fit") or fallback["experience_fit"]).strip(),
        "qualification_fit": str(data.get("qualification_fit") or fallback["qualification_fit"]).strip(),
        "recommendations": _str_list(data.get("recommendations")) or fallback["recommendations"],
    }


def analyze_resume_against_jd(resume_text: str, jd_text: str) -> Dict[str, Any]:
    prompt = f"""
You are an expert technical recruiter. Compare the RESUME with the JOB DESCRIPTION and judge the candidate's fit.

RULES:
- NEVER invent skills, experience, achievements or qualifications that are not in the resume text.
- A skill is "matched" only if the resume actually shows it; otherwise list it under "missing_skills".
- Base every judgement strictly on the two texts.

RESUME:
\"\"\"
{resume_text[:6000]}
\"\"\"

JOB DESCRIPTION:
\"\"\"
{jd_text[:4000]}
\"\"\"

Respond with a single VALID JSON object and nothing else:
{{
  "job_title": "<the role title stated in the job description, or empty>",
  "company": "<the hiring company named in the job description, or empty>",
  "required_experience": "<experience the JD asks for, e.g. '2-4 years' or 'Fresher', or empty>",
  "resume_experience": "<the candidate's experience as shown in the resume>",
  "match_score": <number 0-100>,
  "fit_verdict": "<Strong | Good | Partial | Weak>",
  "summary": "<2-3 sentence overall suitability summary>",
  "matched_skills": [<skills required by the JD that the resume shows>],
  "missing_skills": [<skills required by the JD that the resume does not show>],
  "strengths": [<3-5 strengths relative to this job>],
  "weaknesses": [<2-5 weaknesses or gaps relative to this job>],
  "experience_fit": "<how the candidate's experience compares with the role's requirements>",
  "qualification_fit": "<how education and certifications compare with the role's requirements>",
  "recommendations": [<3-5 concrete, honest improvements for this job>]
}}
"""
    try:
        if gemini_client.is_ai_available():
            res = gemini_client.call_gemini(
                prompt=prompt,
                system_prompt="You are a precise resume-to-job matching evaluator. Return strictly valid JSON.",
                temperature=0.2,
                json_mode=True,
            )
            if isinstance(res, dict) and "match_score" in res:
                return _validate_jd_match(res, resume_text, jd_text)
    except Exception as e:
        print(f"Gemini JD match attempt failed: {e}")
    return _fallback_jd_match(resume_text, jd_text)


# ----------------------------------------------------------------------------
# Structured extraction for the formatter
# ----------------------------------------------------------------------------

def _empty_structured() -> Dict[str, Any]:
    return {
        "ai_generated": False,
        "name": "",
        "contact": {"email": "", "phone": "", "location": "", "links": []},
        "summary": "",
        "skills": [],
        "experience": [],
        "projects": [],
        "education": [],
        "certifications": [],
        "achievements": [],
    }


def _section_key(line: str):
    cleaned = re.sub(r"[^a-z ]", "", line.lower()).strip()
    if not cleaned or len(cleaned) > 40:
        return None
    for key, aliases in SECTION_ALIASES.items():
        if cleaned in aliases:
            return key
    return None


def _split_sections(raw_text: str) -> Dict[str, List[str]]:
    sections: Dict[str, List[str]] = {"header": []}
    current = "header"
    for line in raw_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        key = _section_key(stripped)
        if key:
            current = key
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(stripped)
    return sections


# Link markers and arrows that PDF text extraction leaves behind ("[GitHub ↗]", "Certificate ↗")
_LINK_MARKER_RE = re.compile(r"\[\s*(?:GitHub|Live|Demo|Link|Code|Website)[^\]]*\]", re.IGNORECASE)
_ARROW_RE = re.compile(r"[\u2190-\u21FF\u2B00-\u2BFF\u27F0-\u27FF\u25B6\u25B7\u25BA]")
_ZERO_WIDTH_RE = re.compile(r"[\u200B-\u200D\u2060\uFEFF]")
_MONTHS_RE = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?"
_DATE_TAIL_RE = re.compile(rf"\s*((?:{_MONTHS_RE}\s+)?(?:19|20)\d{{2}}(?:\s*[-\u2013\u2014]\s*(?:(?:{_MONTHS_RE}\s+)?(?:19|20)\d{{2}}|Present|Current))?(?:\s*\([A-Za-z ]{{3,12}}\))?)\s*$", re.IGNORECASE)


def _clean_resume_text(text: str) -> str:
    """Repairs common PDF-extraction artefacts without changing any wording."""
    text = _ZERO_WIDTH_RE.sub("", text or "")
    text = re.sub(r"(?<=\w) -(?=\w)", "-", text)  # "real -time" -> "real-time", "Object -oriented"
    return text


def _strip_link_noise(text: str) -> str:
    text = _LINK_MARKER_RE.sub(" ", text)
    text = _ARROW_RE.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip(" \t")


def _is_continuation(previous: str, line: str) -> bool:
    """True when `line` is the wrapped second half of the bullet text in `previous`, not a new entry."""
    if not previous or not line:
        return False
    if line[0].islower() or line[0] in ",;:)-\u2013":
        return True
    prev = previous.rstrip()
    if prev and prev[-1] in ",;:(/&-\u2013":
        return True
    return bool(re.search(r"\b(and|or|with|for|to|of|the|a|an|in|on|by|using|via|as|from)\s*$", prev, re.IGNORECASE))


def _merge_wrapped_lines(lines: List[str]) -> List[str]:
    """Joins wrapped bullet lines back together so they are not mistaken for new entries."""
    merged: List[str] = []
    in_bullet = False
    for line in lines:
        is_bullet = bool(_BULLET_RE.match(line))
        if merged and in_bullet and not is_bullet and _is_continuation(merged[-1], line):
            merged[-1] = f"{merged[-1]} {line}"
            continue
        merged.append(line)
        in_bullet = is_bullet
    return merged


def _split_items(lines: List[str]) -> List[str]:
    """One item per list entry: splits inline '•' separated lists and drops link arrows."""
    items: List[str] = []
    for line in lines:
        for part in re.split(r"\s*\u2022\s*", _BULLET_RE.sub("", line)):
            part = _strip_link_noise(part)
            if part:
                items.append(part)
    return items


def _split_outside_parens(text: str, separators: str = ",;|") -> List[str]:
    parts, depth, current = [], 0, ""
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch in separators and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p.strip(" .\u2022-") for p in parts if p.strip(" .\u2022-")]


def _parse_project_title(head: str):
    """'Name [GitHub] - Python | Flask | OpenCV Jul 2025' -> (name, tech list, dates)."""
    text = _strip_link_noise(head)
    dates = ""
    m = _DATE_TAIL_RE.search(text)
    if m:
        dates = m.group(1).strip()
        text = text[: m.start()].rstrip(" -\u2013\u2014|,")
    name, tech = text, []
    parts = re.split(r"\s+[-\u2013\u2014]\s+", text, maxsplit=1)
    if len(parts) == 2 and 0 < len(parts[1]) <= 160 and parts[0].strip():
        candidate = [t.strip() for t in re.split(r"\s*[|/,]\s*", parts[1]) if t.strip()]
        if candidate and all(len(t) <= 30 for t in candidate):
            name, tech = parts[0].strip(" -\u2013\u2014"), candidate
    return name, tech, dates


_CGPA_TAIL_RE = re.compile(r"\s*\b(CGPA|GPA|Percentage|Aggregate)\s*:?\s*([\d.]+\s*%?(?:\s*/\s*\d+)?)\s*$", re.IGNORECASE)


def _parse_education_head(head: str):
    """'B.E. in Computer Science Dec 2022 - Apr 2026 (Expected) CGPA : 9.00' -> (degree, dates, 'CGPA: 9.00')."""
    text = _strip_link_noise(head)
    score = ""
    m = _CGPA_TAIL_RE.search(text)
    if m:
        score = f"{m.group(1).upper() if m.group(1).lower() in ('cgpa', 'gpa') else m.group(1).title()}: {m.group(2).strip()}"
        text = text[: m.start()].rstrip(" -\u2013\u2014|,")
    dates = ""
    d = _DATE_TAIL_RE.search(text)
    if d:
        dates = d.group(1).strip()
        text = text[: d.start()].rstrip(" -\u2013\u2014|,")
    return text.strip(), dates, score


def _blocks(lines: List[str]) -> List[List[str]]:
    """Group section lines into entries: a non-bullet line after bullets starts a new entry."""
    blocks: List[List[str]] = []
    current: List[str] = []
    seen_bullet = False
    for line in _merge_wrapped_lines(lines):
        is_bullet = bool(_BULLET_RE.match(line))
        if current and not is_bullet and seen_bullet:
            blocks.append(current)
            current, seen_bullet = [], False
        current.append(line)
        seen_bullet = seen_bullet or is_bullet
    if current:
        blocks.append(current)
    return blocks


def _entry_parts(block: List[str]):
    head = [l for l in block if not _BULLET_RE.match(l)]
    bullets = [_BULLET_RE.sub("", l).strip() for l in block if _BULLET_RE.match(l)]
    return (head[0] if head else ""), (head[1:] if len(head) > 1 else []), [b for b in bullets if b]


def _heuristic_structured(raw_text: str) -> Dict[str, Any]:
    result = _empty_structured()
    sections = _split_sections(raw_text)
    header_text = "\n".join(sections.get("header", [])[:10])

    result["name"] = extract_candidate_name_from_resume(raw_text)
    emails = _EMAIL_RE.findall(header_text)
    phones = [p.strip() for p in _PHONE_RE.findall(header_text) if len(re.sub(r"\D", "", p)) >= 10]
    result["contact"]["email"] = emails[0] if emails else ""
    result["contact"]["phone"] = phones[0] if phones else ""
    result["contact"]["links"] = _str_list(_URL_RE.findall(header_text), limit=5)

    result["summary"] = " ".join(sections.get("summary", [])).strip()

    skill_lines = []
    for line in sections.get("skills", []):
        line = _strip_link_noise(_BULLET_RE.sub("", line))
        label = re.match(r"^([A-Za-z][A-Za-z &/]{1,30}?)\s*:\s*(.+)$", line)  # "Programming Skills : Java, ..."
        skill_lines.append(label.group(2) if label else line)
    skills = _split_outside_parens(" , ".join(skill_lines), ",;|\u2022")
    result["skills"] = _str_list([s for s in skills if 0 < len(s) <= 60], limit=40)

    for block in _blocks(sections.get("experience", [])):
        title, rest, bullets = _entry_parts(block)
        if title:
            result["experience"].append({
                "title": title, "company": rest[0] if rest else "", "dates": rest[1] if len(rest) > 1 else "",
                "bullets": bullets,
            })
    for block in _blocks(sections.get("projects", [])):
        head, rest, bullets = _entry_parts(block)
        if head:
            name, tech, dates = _parse_project_title(head)
            result["projects"].append({
                "name": name, "description": _strip_link_noise(" ".join(rest)), "bullets": bullets, "tech": tech, "dates": dates,
            })
    for block in _blocks(sections.get("education", [])):
        head, rest, bullets = _entry_parts(block)
        if head:
            degree, head_dates, score = _parse_education_head(head)
            result["education"].append({
                "degree": degree or head,
                "institution": _strip_link_noise(rest[0]) if rest else "",
                "dates": head_dates or (rest[1] if len(rest) > 1 else ""),
                "details": "; ".join(([score] if score else []) + bullets),
            })
    result["certifications"] = _str_list(_split_items(sections.get("certifications", [])))
    result["achievements"] = _str_list(_split_items(sections.get("achievements", [])))
    return result


def _dict_list(value: Any, keys: Dict[str, Any], limit: int = 15) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if not isinstance(item, dict):
            continue
        entry = {}
        for key, default in keys.items():
            raw = item.get(key, default)
            entry[key] = _str_list(raw) if isinstance(default, list) else str(raw or "").strip()
        if any(entry.values()):
            out.append(entry)
    return out[:limit]


def _validate_structured(data: Dict[str, Any], raw_text: str) -> Dict[str, Any]:
    fallback = _heuristic_structured(raw_text)
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else {}
    return {
        "ai_generated": True,
        "name": str(data.get("name") or fallback["name"]).strip(),
        "contact": {
            "email": str(contact.get("email") or fallback["contact"]["email"]).strip(),
            "phone": str(contact.get("phone") or fallback["contact"]["phone"]).strip(),
            "location": str(contact.get("location") or "").strip(),
            "links": _str_list(contact.get("links"), limit=5) or fallback["contact"]["links"],
        },
        "summary": str(data.get("summary") or "").strip(),
        "skills": _str_list(data.get("skills"), limit=40) or fallback["skills"],
        "experience": _dict_list(data.get("experience"), {"title": "", "company": "", "dates": "", "bullets": []})
        or fallback["experience"],
        "projects": _dict_list(data.get("projects"), {"name": "", "description": "", "bullets": [], "tech": [], "dates": ""})
        or fallback["projects"],
        "education": _dict_list(data.get("education"), {"degree": "", "institution": "", "dates": "", "details": ""})
        or fallback["education"],
        "certifications": _str_list(data.get("certifications")) or fallback["certifications"],
        "achievements": _str_list(data.get("achievements")) or fallback["achievements"],
    }


def extract_structured_resume(raw_text: str) -> Dict[str, Any]:
    raw_text = _clean_resume_text(raw_text)
    prompt = f"""
Convert the RESUME below into structured data for re-formatting. Copy the candidate's own words.

RULES:
- NEVER invent or embellish anything. Use only information present in the text.
- Leave a field empty ("" or []) when the resume does not contain it.
- Keep bullet points as written (you may fix spelling and spacing only).

RESUME:
\"\"\"
{raw_text[:8000]}
\"\"\"

Respond with a single VALID JSON object and nothing else:
{{
  "name": "<full name>",
  "contact": {{"email": "", "phone": "", "location": "", "links": [<profile / portfolio URLs>]}},
  "summary": "<summary or objective text if the resume has one>",
  "skills": [<individual skills>],
  "experience": [{{"title": "", "company": "", "dates": "", "bullets": []}}],
  "projects": [{{"name": "", "description": "", "bullets": [], "tech": [], "dates": ""}}],
  "education": [{{"degree": "", "institution": "", "dates": "", "details": ""}}],
  "certifications": [<strings>],
  "achievements": [<awards, honours, achievements and extracurricular items as strings>]
}}
"""
    try:
        if gemini_client.is_ai_available():
            res = gemini_client.call_gemini(
                prompt=prompt,
                system_prompt="You convert resumes into faithful structured JSON. Never add information.",
                temperature=0.1,
                json_mode=True,
            )
            if isinstance(res, dict) and "skills" in res and "experience" in res:
                return _validate_structured(res, raw_text)
    except Exception as e:
        print(f"Gemini structured extraction attempt failed: {e}")
    return _heuristic_structured(raw_text)
