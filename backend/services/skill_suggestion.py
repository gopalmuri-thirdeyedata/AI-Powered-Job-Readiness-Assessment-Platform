"""
Skill Suggestion & Normalization Service for Phase 5.
Extracts, normalizes, deduplicates, and validates technical and role-specific skills
from structured Job Descriptions using existing AI infrastructure with resilient fallbacks.
"""

import re
from typing import List, Dict, Any, Optional
from services import ai_generator

# Canonical skill normalization dictionary
CANONICAL_SKILL_MAP = {
    "python": "Python",
    "python3": "Python",
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "sql": "SQL",
    "postgresql": "PostgreSQL",
    "postgres": "PostgreSQL",
    "mysql": "MySQL",
    "mongodb": "MongoDB",
    "mongo": "MongoDB",
    "redis": "Redis",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "k8s": "Kubernetes",
    "aws": "AWS",
    "amazon web services": "AWS",
    "gcp": "GCP",
    "google cloud": "GCP",
    "azure": "Azure",
    "microsoft azure": "Azure",
    "react": "React",
    "react.js": "React",
    "reactjs": "React",
    "next.js": "Next.js",
    "nextjs": "Next.js",
    "vue": "Vue.js",
    "vue.js": "Vue.js",
    "vuejs": "Vue.js",
    "angular": "Angular",
    "node": "Node.js",
    "node.js": "Node.js",
    "nodejs": "Node.js",
    "typescript": "TypeScript",
    "ts": "TypeScript",
    "javascript": "JavaScript",
    "js": "JavaScript",
    "java": "Java",
    "spring": "Spring Boot",
    "spring boot": "Spring Boot",
    "c++": "C++",
    "cpp": "C++",
    "c#": "C#",
    "csharp": "C#",
    ".net": ".NET",
    "dotnet": ".NET",
    "go": "Go",
    "golang": "Go",
    "rust": "Rust",
    "php": "PHP",
    "ruby": "Ruby",
    "ruby on rails": "Ruby on Rails",
    "rails": "Ruby on Rails",
    "rest api": "REST APIs",
    "rest apis": "REST APIs",
    "rest": "REST APIs",
    "restful api": "REST APIs",
    "restful apis": "REST APIs",
    "graphql": "GraphQL",
    "grpc": "gRPC",
    "ci/cd": "CI/CD",
    "cicd": "CI/CD",
    "git": "Git",
    "github": "GitHub",
    "gitlab": "GitLab",
    "linux": "Linux",
    "html": "HTML5",
    "html5": "HTML5",
    "css": "CSS3",
    "css3": "CSS3",
    "tailwind": "TailwindCSS",
    "tailwindcss": "TailwindCSS",
    "bootstrap": "Bootstrap",
    "microservices": "Microservices",
    "terraform": "Terraform",
    "ansible": "Ansible",
    "kafka": "Apache Kafka",
    "apache kafka": "Apache Kafka",
    "rabbitmq": "RabbitMQ",
    "elasticsearch": "Elasticsearch",
    "pandas": "Pandas",
    "numpy": "NumPy",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "scikit-learn": "Scikit-Learn",
    "machine learning": "Machine Learning",
    "deep learning": "Deep Learning",
    "nlp": "Natural Language Processing",
    "agile": "Agile",
    "scrum": "Scrum",
    "devops": "DevOps",
    "system design": "System Design"
}

# Generic filler/stop phrases to discard
DISALLOWED_SKILL_PATTERNS = [
    r"^problem\s*solving",
    r"^communication\s*skills?",
    r"^team\s*player",
    r"^hard\s*worker",
    r"^self\s*starter",
    r"^fast\s*learner",
    r"^detail\s*oriented",
    r"^good\s*attitude",
    r"^work\s*ethic",
    r"^critical\s*thinking",
    r"^you\s*must",
    r"^responsible\s*for",
    r"^the\s*candidate",
    r"^ability\s*to",
    r"^experience\s*in",
    r"^years\s*of",
    r"^\d+\s*years?"
]

def normalize_skill(skill: str) -> Optional[str]:
    """
    Cleans, validates, and normalizes a single skill string.
    Returns canonical title-cased name, or None if invalid/disallowed.
    """
    if not skill or not isinstance(skill, str):
        return None

    # Strip leading bullets, numbers, hyphens, and whitespace
    cleaned = re.sub(r"^[\s\-\*\•\d\.\)\:\,]+", "", skill).strip()
    # Strip trailing punctuation, commas, dots, and quotes
    cleaned = cleaned.strip(" \t\n\r,.;:-*•()[]{}'\"").strip()

    if not cleaned or len(cleaned) < 2 or len(cleaned) > 50:
        return None

    # Reject full sentences (contains period in middle or excessive words)
    words = cleaned.split()
    if len(words) > 5:
        return None

    lower_cleaned = cleaned.lower()

    # Reject filler / disallowed phrases
    for pattern in DISALLOWED_SKILL_PATTERNS:
        if re.search(pattern, lower_cleaned):
            return None

    # Check canonical dictionary
    if lower_cleaned in CANONICAL_SKILL_MAP:
        return CANONICAL_SKILL_MAP[lower_cleaned]

    # Clean capitalization for non-mapped skills
    # Preserve acronyms like AWS, API, SDK, CLI
    formatted_words = []
    for w in words:
        if w.upper() in ["API", "APIS", "SDK", "CLI", "UI", "UX", "ETL", "ORM", "SDKs", "JWT", "AI", "ML"]:
            formatted_words.append(w.upper())
        elif len(w) <= 3 and w.isupper():
            formatted_words.append(w)
        else:
            formatted_words.append(w.capitalize())

    return " ".join(formatted_words)


def deduplicate_and_normalize_skills(skills: List[str]) -> List[str]:
    """
    Normalizes a list of skills, strips invalid values, and eliminates duplicates
    case-insensitively while preserving insertion order.
    """
    if not skills:
        return []

    seen = set()
    result = []

    for raw in skills:
        norm = normalize_skill(raw)
        if norm and norm.lower() not in seen:
            seen.add(norm.lower())
            result.append(norm)

    return result


def extract_fallback_skills(text: str) -> List[str]:
    """
    Deterministic rule-based skill extraction from JD text
    used as a reliable fallback when AI providers are unavailable.
    """
    if not text:
        return []

    text_lower = text.lower()
    matched = []

    for key, canonical in CANONICAL_SKILL_MAP.items():
        pattern = r"\b" + re.escape(key) + r"\b"
        if re.search(pattern, text_lower):
            matched.append(canonical)

    return deduplicate_and_normalize_skills(matched)


def build_jd_composite_text(jd_data: Dict[str, Any]) -> str:
    """Combines structured JD fields into a clean text prompt context."""
    sections = []
    if jd_data.get("role"):
        sections.append(f"Role / Title: {jd_data['role']}")
    elif jd_data.get("title"):
        sections.append(f"Role / Title: {jd_data['title']}")

    if jd_data.get("experience_requirements"):
        sections.append(f"Experience: {jd_data['experience_requirements']}")

    if jd_data.get("responsibilities"):
        sections.append(f"Responsibilities:\n{jd_data['responsibilities']}")

    if jd_data.get("specific_targets"):
        sections.append(f"Specific Targets:\n{jd_data['specific_targets']}")

    if jd_data.get("expected_achievements"):
        sections.append(f"Expected Achievements:\n{jd_data['expected_achievements']}")

    if jd_data.get("additional_requirements"):
        sections.append(f"Additional Requirements:\n{jd_data['additional_requirements']}")

    if jd_data.get("description") or jd_data.get("job_description"):
        desc = jd_data.get("description") or jd_data.get("job_description")
        sections.append(f"Description:\n{desc}")

    if jd_data.get("required_skills"):
        existing_req = ", ".join(jd_data["required_skills"])
        sections.append(f"Current Required Skills: {existing_req}")

    if jd_data.get("preferred_skills"):
        existing_pref = ", ".join(jd_data["preferred_skills"])
        sections.append(f"Current Preferred Skills: {existing_pref}")

    return "\n\n".join(sections)


def suggest_skills_from_jd(jd_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main entry point for AI skill suggestion.
    Analyzes structured JD information, queries the LLM with strict JSON formatting,
    and returns a clean, normalized, deduplicated list of suggested skills.
    Fails gracefully to heuristic extraction on LLM error/timeout.
    """
    composite_text = build_jd_composite_text(jd_data)

    if not composite_text.strip():
        return {
            "skills": [],
            "required_skills": [],
            "preferred_skills": []
        }

    prompt = f"""
You are an expert technical recruitment assistant. Analyze this Job Description and suggest relevant technical and role-specific skills.

Job Description Information:
{composite_text}

Instructions:
1. Extract and suggest core technologies, programming languages, frameworks, databases, cloud tools, and technical competencies directly relevant to this job.
2. Return ONLY a JSON object with a single key "skills" containing an array of strings.
3. Each skill must be concise (1 to 4 words max, e.g. "Python", "FastAPI", "PostgreSQL", "Docker", "REST APIs", "Kubernetes").
4. Do NOT include full sentences, explanations, bullet points, or numbering.
5. Do NOT include generic filler phrases like "good communication", "team player", "problem solving".
6. Do NOT return duplicate skills.

Example Response:
{{
  "skills": ["Python", "FastAPI", "SQL", "PostgreSQL", "Docker", "REST APIs"]
}}
"""

    suggested_raw = []
    try:
        response = ai_generator.call_llm(prompt, retries=2)
        if isinstance(response, dict) and "skills" in response:
            suggested_raw = response.get("skills", [])
        elif isinstance(response, list):
            suggested_raw = response
        elif isinstance(response, dict):
            # Attempt to find any list in the response dict
            for val in response.values():
                if isinstance(val, list):
                    suggested_raw.extend(val)
    except Exception as e:
        print(f"[skill_suggestion] LLM invocation failed: {e}")
        suggested_raw = []

    # Normalize and deduplicate AI output
    clean_skills = deduplicate_and_normalize_skills(suggested_raw)

    # If AI returned empty or failed, use heuristic fallback extraction from JD text
    if not clean_skills:
        clean_skills = extract_fallback_skills(composite_text)

    # Separate into recommended required vs preferred based on input or core seniority
    # (If recruiter already provided skills, keep those in mind)
    existing_all = set()
    for s in (jd_data.get("required_skills") or []) + (jd_data.get("preferred_skills") or []):
        norm = normalize_skill(s)
        if norm:
            existing_all.add(norm.lower())

    # Filter out skills already selected by recruiter to prioritize new suggestions,
    # or return all clean skills if list is small
    final_skills = deduplicate_and_normalize_skills(clean_skills)

    return {
        "skills": final_skills,
        "required_skills": [s for s in final_skills[:len(final_skills)//2 + 1]],
        "preferred_skills": [s for s in final_skills[len(final_skills)//2 + 1:]]
    }
