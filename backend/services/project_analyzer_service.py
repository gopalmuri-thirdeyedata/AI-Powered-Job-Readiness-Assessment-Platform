"""
Student Project & Portfolio Analyzer Service (Phase 6).
Provides deep technical critique of student software projects, architectural reviews,
likely technical interview questions, actionable recommendations, and STAR-format resume bullet points.
Strictly isolated from frozen recruiter services.
"""

from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

# Languages a student may list in their stack, mapped to the language names GitHub reports for a repository.
# Frameworks (React, Django...) are deliberately not checked: they do not map to one GitHub language.
_LANGUAGE_ALIASES = {
    "python": {"python"}, "java": {"java"}, "javascript": {"javascript", "typescript"},
    "typescript": {"typescript", "javascript"}, "c++": {"c++"}, "c#": {"c#"}, "go": {"go"}, "golang": {"go"},
    "rust": {"rust"}, "php": {"php"}, "ruby": {"ruby"}, "kotlin": {"kotlin"}, "swift": {"swift"},
}


def _days_since(iso_timestamp: Optional[str]) -> Optional[int]:
    if not iso_timestamp:
        return None
    try:
        then = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, (datetime.now(timezone.utc) - then).days)


def _repo_insights(repo: Dict[str, Any], stack: List[str]):
    """
    Turns the facts read from the student's real repository into a review paragraph, recommendations and a
    score bonus. Returns (paragraph, recommendations, bonus).
    """
    name = repo.get("full_name") or "the repository"
    languages = repo.get("languages") or {}
    lang_text = ", ".join(f"{lang} {pct:g}%" for lang, pct in languages.items()) or (repo.get("primary_language") or "not reported")
    days = _days_since(repo.get("pushed_at"))
    activity = "no recent activity recorded" if days is None else ("updated today" if days == 0 else f"last updated {days} day(s) ago")
    readme_words = repo.get("readme_words") or 0
    readme_text = f"present (about {readme_words} words)" if repo.get("has_readme") else "missing"

    paragraph = (
        f"**Repository Evidence (GitHub)**: {name} is a public repository. Languages: {lang_text}. "
        f"{activity.capitalize()}, {repo.get('stars', 0)} star(s), {repo.get('forks', 0)} fork(s). README: {readme_text}."
    )

    recommendations: List[str] = []
    bonus = 0.0
    if not repo.get("has_readme"):
        recommendations.append("Your repository has no README. Add one that explains what the project does, how to run it, and its architecture.")
    elif readme_words < 80:
        recommendations.append("Your README is very short. Add setup steps, a screenshot or architecture diagram, and what you would improve next.")
    else:
        bonus += 3.0
    if days is not None and days > 365:
        recommendations.append(f"The repository was last updated {days} days ago. Recent commits show the project is alive; push a small improvement.")
    elif days is not None:
        bonus += 2.0
    if repo.get("archived"):
        recommendations.append("The repository is archived on GitHub. Unarchive it, or explain why in the README.")
    if repo.get("is_fork"):
        recommendations.append("This repository is a fork. State clearly in the README which parts you built yourself.")
    if not repo.get("description") and not repo.get("topics"):
        recommendations.append("Add a short description and topics to the repository so recruiters understand it at a glance.")

    # Does the declared stack match the code that is really there?
    present = {name_.lower() for name_ in languages}
    if present:
        claimed = [t for t in stack if t.lower() in _LANGUAGE_ALIASES]
        missing = [t for t in claimed if not (_LANGUAGE_ALIASES[t.lower()] & present)]
        if missing:
            paragraph += (
                f"\n\n**Stack Check**: You listed {', '.join(missing)}, but the repository's code is written in "
                f"{', '.join(languages)}. Make sure this is the right repository, or correct the tech stack."
            )
            recommendations.insert(0, f"Your stack lists {', '.join(missing)} but the repository contains no such code. Check the link or the stack.")
    return paragraph, recommendations, bonus


def analyze_student_project(
    title: str,
    description: str,
    tech_stack: Optional[List[str]] = None,
    github_url: Optional[str] = None,
    live_url: Optional[str] = None,
    repo_summary: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Performs comprehensive technical analysis of a student project.
    Returns:
        - completeness_score (0-100)
        - architecture_review (Text)
        - suggested_interview_questions (List[str])
        - recommendations (List[str])
        - bullet_point_improvements (List[str])

    repo_summary holds facts read from the student's real GitHub repository (see github_repo_service). When it is
    given the review quotes them and the link earns full credit; a link that could not be checked earns half.
    """
    stack = [s.strip() for s in (tech_stack or []) if s.strip()]
    desc = (description or "").strip()
    words = desc.split()
    word_count = len(words)

    # 1. Calculate Completeness Score
    score = 50.0

    # Tech stack depth
    if len(stack) >= 4:
        score += 15.0
    elif len(stack) >= 2:
        score += 10.0
    elif len(stack) == 1:
        score += 5.0

    # Description depth & clarity
    if word_count >= 80:
        score += 15.0
    elif word_count >= 40:
        score += 10.0
    elif word_count >= 15:
        score += 5.0

    # Artifact completeness (links)
    repo_paragraph, repo_recommendations, repo_bonus = (None, [], 0.0)
    if repo_summary:
        score += 10.0
        repo_paragraph, repo_recommendations, repo_bonus = _repo_insights(repo_summary, stack)
        score += repo_bonus
    elif github_url and github_url.strip():
        score += 5.0  # a link was given but GitHub could not be reached to check it
    if live_url and live_url.strip():
        score += 10.0

    completeness_score = min(round(score, 1), 96.0)

    # Tech stack keywords detection
    lower_desc = desc.lower()
    combined_text = lower_desc + " " + " ".join([s.lower() for s in stack])

    has_db = any(k in combined_text for k in ["sql", "mysql", "postgres", "mongodb", "database", "orm", "redis"])
    has_api = any(k in combined_text for k in ["api", "rest", "graphql", "fastapi", "express", "django", "endpoint"])
    has_auth = any(k in combined_text for k in ["auth", "jwt", "oauth", "clerk", "session", "security"])
    has_devops = any(k in combined_text for k in ["docker", "kubernetes", "aws", "deploy", "ci/cd", "pipeline", "nginx"])

    # 2. Architecture Review
    arch_paragraphs = []
    
    # Overview
    stack_str = ", ".join(stack) if stack else "Modern Full Stack"
    arch_paragraphs.append(
        f"**System Architecture & Stack Evaluation**: The project '{title}' demonstrates solid conceptual scope using {stack_str}. "
        f"The integration between client, business logic, and persistence layers aligns with standard software patterns."
    )

    # Data layer critique
    if has_db:
        arch_paragraphs.append(
            "**Data Layer & Concurrency**: Clear data tier established. Ensure foreign key constraints, connection pooling, "
            "and appropriate index structures (B-Tree/composite indexes) are applied to frequent query paths to prevent N+1 query degradation."
        )
    else:
        arch_paragraphs.append(
            "**Data Persistence Gap**: No explicit database or persistence engine specified. Adding an ACID-compliant relational DB "
            "(PostgreSQL/MySQL) or document store would demonstrate production-grade data modeling skills."
        )

    # Security & Auth
    if has_auth:
        arch_paragraphs.append(
            "**Security & Identity**: Authentication layer noted. Verify token expiration, HTTP-only cookie transport, "
            "and strict role-based access control (RBAC) boundaries across protected routes."
        )
    else:
        arch_paragraphs.append(
            "**Security Posture**: Consider implementing token-based authentication (JWT/OAuth2) and CSRF/CORS validation "
            "to show hiring managers that security was an architectural priority from day one."
        )

    # Scalability & Deployment
    if has_devops or live_url:
        arch_paragraphs.append(
            "**Deployment & Operational Reliability**: Live deployment or containerization shows end-to-end execution capability. "
            "Monitoring endpoints (healthchecks, structured logging) further elevates industry readiness."
        )
    else:
        arch_paragraphs.append(
            "**Deployment & CI/CD Opportunity**: Packaging the service with Docker and setting up GitHub Actions for automated linting/tests "
            "will turn this academic project into an enterprise-ready portfolio asset."
        )

    if repo_paragraph:
        arch_paragraphs.insert(1, repo_paragraph)
    elif github_url and github_url.strip():
        arch_paragraphs.insert(1, "**Repository**: Link recorded. GitHub could not be reached just now, so the code itself was not "
                               "checked. Use Refresh Review later to add repository evidence.")

    architecture_review = "\n\n".join(arch_paragraphs)

    # 3. Suggested Interview Questions
    interview_questions = [
        f"Can you walk me through the high-level architecture of {title}? What was the hardest design tradeoff you made?",
        f"How did you choose the technologies in your stack ({stack_str}) compared to alternative frameworks?",
    ]

    if has_db:
        interview_questions.append(
            "How is data consistency handled in your database schema? How would you scale the data layer if read traffic increased 100x?"
        )
    if has_api:
        interview_questions.append(
            "How do your API endpoints handle validation, idempotency, and error handling when upstream clients submit invalid payloads?"
        )
    if has_auth:
        interview_questions.append(
            "Explain how authentication tokens are validated across API requests. How do you protect against session hijacking and XSS?"
        )
    else:
        interview_questions.append(
            "If you were to add multi-user authentication and authorization today, what architectural approach would you take?"
        )

    if repo_summary:
        interview_questions.insert(
            2,  # near the top: only the first five questions are shown
            f"I looked at your repository {repo_summary.get('full_name')}. Which file would you show me first, and what would you refactor if you had a week?"
        )
    interview_questions.append(
        f"What was the most challenging technical bug or bottleneck you encountered while developing {title}, and how did you debug it?"
    )

    # 4. Actionable Recommendations
    recommendations = list(repo_recommendations)
    if not github_url:
        recommendations.append("Link a public GitHub repository with a clean README, architecture diagrams, and setup instructions.")
    if not live_url:
        recommendations.append("Deploy a live demonstration on Vercel, Render, or AWS so recruiters can interact with the system.")
    if not has_devops:
        recommendations.append("Add a Dockerfile and docker-compose.yml to enable one-command local reproduction.")
    if word_count < 60:
        recommendations.append("Expand the project description to explicitly quantify users, throughput, latency, or test coverage.")
    recommendations.append("Add comprehensive automated test coverage (unit + integration tests) with a CI workflow badge.")

    # 5. STAR-Format Bullet Point Improvements (for Resume)
    primary_tech = stack[0] if stack else "Modern Tech Stack"
    secondary_tech = stack[1] if len(stack) > 1 else "REST APIs"

    bullets = [
        f"Architected and deployed {title} using {primary_tech} and {secondary_tech}, applying a clean, modular design.",
        "Built RESTful endpoints and optimised data retrieval, reducing response time to [your measured latency].",
        "Added error handling, input validation and automated tests covering [your real test coverage]% of the code.",
        "Built reusable UI components and state management, serving [your real number of users or sessions]."
    ]

    return {
        "completeness_score": completeness_score,
        "architecture_review": architecture_review,
        "suggested_interview_questions": interview_questions[:5],
        "recommendations": recommendations[:4],
        "bullet_point_improvements": bullets
    }
