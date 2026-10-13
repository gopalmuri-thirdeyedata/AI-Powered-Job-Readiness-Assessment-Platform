"""
Student Project & Portfolio Analyzer Service (Phase 6).
Provides deep technical critique of student software projects, architectural reviews,
likely technical interview questions, actionable recommendations, and STAR-format resume bullet points.
Strictly isolated from frozen recruiter services.
"""

from typing import List, Dict, Any, Optional
import re


def analyze_student_project(
    title: str,
    description: str,
    tech_stack: Optional[List[str]] = None,
    github_url: Optional[str] = None,
    live_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Performs comprehensive technical analysis of a student project.
    Returns:
        - completeness_score (0-100)
        - architecture_review (Text)
        - suggested_interview_questions (List[str])
        - recommendations (List[str])
        - bullet_point_improvements (List[str])
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
    if github_url and github_url.strip():
        score += 10.0
    if live_url and live_url.strip():
        score += 10.0

    completeness_score = min(round(score, 1), 96.0)

    # Tech stack keywords detection
    lower_desc = desc.lower()
    combined_text = lower_desc + " " + " ".join([s.lower() for s in stack])

    has_db = any(k in combined_text for k in ["sql", "mysql", "postgres", "mongodb", "database", "orm", "redis"])
    has_api = any(k in combined_text for k in ["api", "rest", "graphql", "fastapi", "express", "django", "endpoint"])
    has_frontend = any(k in combined_text for k in ["react", "vue", "angular", "next.js", "tailwind", "frontend", "ui"])
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

    interview_questions.append(
        f"What was the most challenging technical bug or bottleneck you encountered while developing {title}, and how did you debug it?"
    )

    # 4. Actionable Recommendations
    recommendations = []
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
        f"Architected and deployed {title} utilizing {primary_tech} and {secondary_tech}, implementing clean modular design patterns.",
        f"Engineered responsive RESTful endpoints and optimized data retrieval pipelines, maintaining sub-200ms response latencies.",
        f"Structured robust error handling, automated input validation schemas, and end-to-end integration tests to guarantee 99%+ service uptime.",
        f"Integrated secure state management and modular UI components, streamlining user interaction flows and overall software usability."
    ]

    return {
        "completeness_score": completeness_score,
        "architecture_review": architecture_review,
        "suggested_interview_questions": interview_questions[:5],
        "recommendations": recommendations[:4],
        "bullet_point_improvements": bullets
    }
