"""
Skill Gap Analysis Service (Phase 2).
Analyzes student skills and resume extractions against target role benchmarks,
distinguishing required vs. preferred skills, identifying missing competencies,
and generating actionable career path guidance.
"""

from typing import List, Dict, Any, Optional
from services.skill_suggestion import (
    deduplicate_and_normalize_skills
)

# ==============================================================================
# CANONICAL TARGET ROLES TAXONOMY & BENCHMARKS
# ==============================================================================

TARGET_ROLES_CATALOG: Dict[str, Dict[str, Any]] = {
    "Full Stack Developer": {
        "title": "Full Stack Developer",
        "description": "Designs and develops end-to-end web applications across client interfaces and backend architectures.",
        "required_skills": ["React", "JavaScript", "Python", "Node.js", "SQL", "Git", "REST APIs"],
        "preferred_skills": ["TypeScript", "Docker", "Next.js", "PostgreSQL", "TailwindCSS", "GraphQL"],
        "core_competencies": ["Frontend Engineering", "Server-Side Logic", "Database Design", "API Integration"],
        "typical_interview_rounds": ["Aptitude & DSA Round", "Full Stack System Coding", "Technical Architecture", "HR Fitment"]
    },
    "Backend Engineer": {
        "title": "Backend Engineer",
        "description": "Architects resilient distributed systems, data processing pipelines, and high-throughput server APIs.",
        "required_skills": ["Python", "SQL", "FastAPI", "PostgreSQL", "Docker", "Git", "REST APIs", "Microservices"],
        "preferred_skills": ["Redis", "Kubernetes", "Apache Kafka", "AWS", "gRPC", "CI/CD"],
        "core_competencies": ["Data Modeling", "Distributed Systems", "Concurrency", "Performance Optimization"],
        "typical_interview_rounds": ["DSA Round", "Backend Architecture & Live Coding", "System Design", "Behavioral Interview"]
    },
    "Frontend Engineer": {
        "title": "Frontend Engineer",
        "description": "Constructs rich, performant, and accessible user interfaces and web applications.",
        "required_skills": ["JavaScript", "TypeScript", "React", "HTML5", "CSS3", "TailwindCSS", "Git"],
        "preferred_skills": ["Next.js", "Redux", "GraphQL", "Jest", "Webpack", "UI"],
        "core_competencies": ["Component Architecture", "State Management", "Web Performance", "Responsive Design"],
        "typical_interview_rounds": ["UI Technical Assessment", "Component Implementation", "Frontend Architecture", "HR Culture"]
    },
    "Data Scientist / ML Engineer": {
        "title": "Data Scientist / ML Engineer",
        "description": "Builds predictive statistical models, machine learning pipelines, and deep neural architectures.",
        "required_skills": ["Python", "Machine Learning", "Pandas", "NumPy", "SQL", "Scikit-Learn", "Git"],
        "preferred_skills": ["PyTorch", "TensorFlow", "Deep Learning", "Natural Language Processing", "Docker", "GCP"],
        "core_competencies": ["Statistical Analysis", "Model Evaluation", "Feature Engineering", "MLOps"],
        "typical_interview_rounds": ["Aptitude & Math/Stats", "Data Wrangling & ML Coding", "Machine Learning Architecture", "HR Round"]
    },
    "DevOps / Cloud Engineer": {
        "title": "DevOps / Cloud Engineer",
        "description": "Automates cloud infrastructure, deployment pipelines, observability, and container orchestration.",
        "required_skills": ["Linux", "Docker", "Kubernetes", "CI/CD", "AWS", "Git", "Python"],
        "preferred_skills": ["Terraform", "Ansible", "GCP", "Azure", "DevOps"],
        "core_competencies": ["Infrastructure as Code", "Continuous Deployment", "Cloud Security", "Monitoring"],
        "typical_interview_rounds": ["Linux & Scripting Assessment", "Container & Cloud Architecture", "DevOps Troubleshooting", "HR Round"]
    },
    "Mobile App Developer": {
        "title": "Mobile App Developer",
        "description": "Develops mobile applications for Android and iOS using modern native and cross-platform frameworks.",
        "required_skills": ["JavaScript", "React", "Mobile Development", "Git", "REST APIs"],
        "preferred_skills": ["TypeScript", "Flutter", "Android", "iOS", "Firebase"],
        "core_competencies": ["Mobile UI/UX", "Offline Storage", "Native Device APIs", "App Store Deployment"],
        "typical_interview_rounds": ["Mobile Coding Round", "Architecture & Lifecycle", "Portfolio Review", "HR Culture"]
    },
    "Software Engineer": {
        "title": "Software Engineer",
        "description": "Generalist software engineer proficient in core algorithms, data structures, and application development.",
        "required_skills": ["Python", "Java", "SQL", "Git", "Data Structures", "Algorithms"],
        "preferred_skills": ["Docker", "Linux", "REST APIs", "C++", "JavaScript"],
        "core_competencies": ["Algorithmic Problem Solving", "Object-Oriented Design", "Code Quality", "Testing"],
        "typical_interview_rounds": ["Aptitude Round", "Data Structures & Algorithms", "Technical Interview", "Managerial / HR Round"]
    }
}


def get_target_role_benchmark(target_role: Optional[str]) -> Dict[str, Any]:
    """Resolves target role benchmark, falling back to Software Engineer if unmatched."""
    if not target_role:
        return TARGET_ROLES_CATALOG["Software Engineer"]

    # Exact or case-insensitive match
    for role_name, data in TARGET_ROLES_CATALOG.items():
        if role_name.lower() == target_role.lower():
            return data

    # Partial substring match
    lower_target = target_role.lower()
    for role_name, data in TARGET_ROLES_CATALOG.items():
        if role_name.lower() in lower_target or lower_target in role_name.lower():
            return data

    # Fallback default
    return {
        "title": target_role,
        "description": f"Custom targeted placement preparation for {target_role}.",
        "required_skills": ["Python", "SQL", "Git", "Data Structures", "Algorithms"],
        "preferred_skills": ["Docker", "Linux", "REST APIs", "JavaScript"],
        "core_competencies": ["Problem Solving", "Software Design", "Technical Communication"],
        "typical_interview_rounds": ["Aptitude Assessment", "Coding Round", "Technical Interview", "HR Round"]
    }


def analyze_skill_gap(
    student_skills: List[str],
    resume_skills: List[str],
    target_role: str,
    target_company: Optional[str] = None
) -> Dict[str, Any]:
    """
    Compares the student's combined skills against target role benchmarks.
    Distinguishes required from preferred skills, computes match percentages,
    and returns evidence-backed strengths and missing skills.
    """
    role_benchmark = get_target_role_benchmark(target_role)

    # Normalize all skills
    all_student_skills = deduplicate_and_normalize_skills((student_skills or []) + (resume_skills or []))
    norm_student_set = {s.lower() for s in all_student_skills}

    required_skills = deduplicate_and_normalize_skills(role_benchmark.get("required_skills", []))
    preferred_skills = deduplicate_and_normalize_skills(role_benchmark.get("preferred_skills", []))

    matched_required = [s for s in required_skills if s.lower() in norm_student_set]
    missing_required = [s for s in required_skills if s.lower() not in norm_student_set]

    matched_preferred = [s for s in preferred_skills if s.lower() in norm_student_set]
    missing_preferred = [s for s in preferred_skills if s.lower() not in norm_student_set]

    # Weighted calculation: Required skills account for 75% weight, preferred 25%
    req_ratio = len(matched_required) / max(len(required_skills), 1)
    pref_ratio = len(matched_preferred) / max(len(preferred_skills), 1)
    match_percentage = round((req_ratio * 75.0) + (pref_ratio * 25.0), 1)

    # Distinguish evidence (resume-verified) from declared-only skills
    resume_norm_set = {s.lower() for s in (resume_skills or [])}
    verified_strengths = [s for s in matched_required if s.lower() in resume_norm_set]
    declared_strengths = [s for s in matched_required if s.lower() not in resume_norm_set]

    # Concrete recommendations
    recommendations = []
    if missing_required:
        top_missing = missing_required[:3]
        recommendations.append(
            f"Prioritize mastering core required technologies: {', '.join(top_missing)}."
        )
    if missing_preferred:
        recommendations.append(
            f"Strengthen your profile advantage by learning preferred tools like {missing_preferred[0]}."
        )
    if not missing_required:
        recommendations.append(
            "You satisfy all foundational requirements! Focus on mock interview practice and advanced system design."
        )
    if target_company:
        recommendations.append(
            f"Align project portfolio and system design preparation with {target_company}'s engineering stack."
        )

    # Career path progression advice
    career_path_advice = {
        "current_fit_level": "High" if match_percentage >= 75 else ("Moderate" if match_percentage >= 45 else "Developing"),
        "primary_focus_area": missing_required[0] if missing_required else (missing_preferred[0] if missing_preferred else "Interview Mastery"),
        "next_milestone": f"Complete practice problems in {missing_required[0]}" if missing_required else "Prepare for full placement simulation"
    }

    return {
        "target_role": role_benchmark.get("title", target_role),
        "target_company": target_company,
        "role_description": role_benchmark.get("description", ""),
        "match_percentage": match_percentage,
        "matched_skills": matched_required + matched_preferred,
        "missing_required": missing_required,
        "missing_preferred": missing_preferred,
        "verified_strengths": verified_strengths,
        "declared_strengths": declared_strengths,
        "all_student_skills": all_student_skills,
        "required_skills_count": len(required_skills),
        "matched_required_count": len(matched_required),
        "preferred_skills_count": len(preferred_skills),
        "matched_preferred_count": len(matched_preferred),
        "recommendations": recommendations,
        "career_path_advice": career_path_advice,
        "typical_interview_rounds": role_benchmark.get("typical_interview_rounds", [])
    }
