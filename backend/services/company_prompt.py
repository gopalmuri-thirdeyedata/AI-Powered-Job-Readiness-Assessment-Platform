"""
Company-aware prompt helpers shared by the admin (ai_generator) and RoleReady (roleready_service) question generators.

The company only shapes topic choice, framing and difficulty from Gemini's own knowledge. It never turns a generated
question into an "asked at <company>" claim, and the company name is never written into the question text.
Standalone on purpose: both generator modules import it without creating a circular import.
"""
import re
from typing import Optional

MAX_COMPANY_CHARS = 100
MAX_JD_CHARS = 1500

# Placeholders the app stores when no real company was supplied; they must never reach a prompt.
_PLACEHOLDER_COMPANIES = frozenset({"target company", "roleready", "n/a", "na", "none", "null", "-"})


def sanitize_company(company: Optional[str]) -> str:
    """Free text from a form: collapse whitespace/newlines, drop control chars and prompt-breaking quotes, cap the length."""
    if not company or not isinstance(company, str):
        return ""
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", company)
    cleaned = re.sub(r"[\"'`{}<>\\]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()[:MAX_COMPANY_CHARS].strip()
    if cleaned.lower() in _PLACEHOLDER_COMPANIES:
        return ""
    return cleaned


def company_style_note(company: Optional[str]) -> str:
    """Prompt section for a known company; an empty string (prompt unchanged) when the company is blank."""
    name = sanitize_company(company)
    if not name:
        return ""
    return (
        f"\nCOMPANY STYLE: The candidate is preparing for {name}.\n"
        f"Based on the question patterns, topics and difficulty {name} is known to use in its hiring assessments, "
        f"design the questions in that style.\n"
        f"Use the company only to shape topic choice, framing and difficulty. Do not mention the company name inside "
        f"the questions and do not state facts about it.\n"
        f"If you do not know {name}'s hiring pattern, ignore this section and follow the rest of the prompt.\n"
        f"All rules above remain authoritative; this note never overrides them.\n"
    )


def top_tech_style_note() -> str:
    """Prompt section used when no company was given: the style of leading tech companies, with no company named."""
    return (
        "\nSTYLE: No target company was given. Design the questions in the style of the hiring assessments used by "
        "leading technology companies for this role: practical, well-scoped and at a realistic difficulty.\n"
        "Do not mention any company name inside the questions and do not state facts about any company.\n"
        "All rules above remain authoritative; this note never overrides them.\n"
    )


def style_note(company: Optional[str]) -> str:
    """The note generators append: the company style when a company is known, otherwise the leading-tech style."""
    return company_style_note(company) or top_tech_style_note()


def jd_context_note(jd_text: Optional[str]) -> str:
    """Full job-description text for the prompt (capped); empty when there is none."""
    text = re.sub(r"\s+", " ", jd_text or "").strip()[:MAX_JD_CHARS]
    if not text:
        return ""
    return f"\nJOB DESCRIPTION CONTEXT (use it to choose relevant topics and the right level):\n{text}\n"


def normalize_provenance(raw, current_year: Optional[int] = None) -> Optional[dict]:
    """
    Verified source info for a question: {"company", "year", "times_asked"}, every part optional, or None when nothing valid.
    Only trusted code (the future question bank) may call attach_provenance(); the AI generators never set it.
    """
    if not isinstance(raw, dict):
        return None
    from datetime import datetime
    max_year = (current_year or datetime.utcnow().year) + 1
    out = {}
    company = sanitize_company(raw.get("company"))
    if company:
        out["company"] = company
        times = raw.get("times_asked")
        if isinstance(times, int) and not isinstance(times, bool) and times >= 1:
            out["times_asked"] = times
    year = raw.get("year")
    if isinstance(year, int) and not isinstance(year, bool) and 1990 <= year <= max_year:
        out["year"] = year
    return out or None


def attach_provenance(question: dict, raw) -> dict:
    """Returns the question with a normalized `provenance` object, or unchanged when there is no valid source info."""
    cleaned = normalize_provenance(raw)
    if cleaned:
        question["provenance"] = cleaned
    return question


# Top tech companies used when the candidate gave no target company: the 10 below, with the ones most relevant to the JD first.
TOP_TECH_10 = ("Google", "Amazon", "Microsoft", "Meta", "Apple", "Netflix", "Adobe", "Salesforce", "Oracle", "Uber")
_TOP_TECH_BY_FOCUS = (
    (("machine learning", "data scien", "deep learning", "nlp", "ai engineer", " ml", "data analyst", "analytics", "pandas"), ("Google", "Amazon", "Microsoft", "Meta", "Netflix", "Uber")),
    (("devops", "sre", "cloud", "kubernetes", "aws", "azure", "infrastructure", "platform engineer"), ("Amazon", "Microsoft", "Google", "Oracle", "Salesforce", "Netflix")),
    (("frontend", "front-end", "react", "angular", "vue", "ui developer", "javascript", "web developer"), ("Google", "Meta", "Netflix", "Adobe", "Apple", "Uber")),
    (("android", "ios", "mobile", "flutter", "swift", "kotlin"), ("Apple", "Google", "Meta", "Uber", "Netflix", "Microsoft")),
    (("java", "spring", ".net", "backend", "back-end", "full stack", "full-stack", "software engineer", "python", "sql"), ("Google", "Amazon", "Microsoft", "Oracle", "Salesforce", "Uber")),
)


def pick_top_tech_companies(role: Optional[str], skills: Optional[str] = "", jd_text: Optional[str] = "") -> tuple:
    """The top 10 tech companies, the ones that fit the JD's role and skills first (deterministic; always 10)."""
    haystack = f" {role or ''} {skills or ''} {(jd_text or '')[:600]} ".lower()
    first = ()
    for keywords, companies in _TOP_TECH_BY_FOCUS:
        if any(k in haystack for k in keywords):
            first = companies
            break
    return tuple(first) + tuple(c for c in TOP_TECH_10 if c not in first)


def multi_company_style_note(companies) -> str:
    """Prompt section for 'no company given': spread questions across the top companies, each tagged with its style company."""
    names = ", ".join(c for c in companies if c)
    return (
        "\nSTYLE: No target company was given. Spread the questions across these top tech companies, most relevant to this job first: "
        f"{names}. Several questions may follow the same company.\n"
        "Design each question in the style of that company's hiring assessments, but keep every question relevant to the job description.\n"
        'Add a field "style_company" to every question, set to the company from this list whose style it follows.\n'
        "Do not mention any company name inside the questions and do not state facts about any company.\n"
        "All rules above remain authoritative; this note never overrides them.\n"
    )


def style_block(company: Optional[str], style_companies=()) -> str:
    """What the RoleReady generators append: the entered company's style, else the multi-company style, else the generic note."""
    if sanitize_company(company):
        return company_style_note(company)
    if style_companies:
        return multi_company_style_note(style_companies)
    return top_tech_style_note()
