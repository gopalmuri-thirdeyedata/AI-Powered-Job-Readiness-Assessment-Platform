"""
Real, web-researched questions. Gemini searches the internet (Google Search grounding) for questions that were actually asked
at the target company (or at leading tech companies when none is given). A company / year / times-asked label is kept only when
the question's source site is one of the pages Gemini really read in that search; otherwise the question loses its label.
Any failure returns an empty list so the caller falls back to normal generation. Results are cached per (kind, company, role).
"""
import json
import logging
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional

from services import gemini_client
from services.company_prompt import normalize_provenance, sanitize_company, jd_context_note

logger = logging.getLogger("prepwin.web_questions")

CACHE_TTL_SECONDS = 24 * 60 * 60
_cache: Dict[tuple, tuple] = {}
_cache_lock = threading.Lock()
TOP_TECH = "Google, Amazon, Microsoft, Meta, Apple, Netflix and other leading tech companies"
_LABEL_KEYS = ("company", "year", "times_asked", "source_domain", "provenance", "style_company")


def is_enabled() -> bool:
    flag = os.getenv("WEB_QUESTION_SEARCH", "true").strip().lower() in ("true", "1", "yes")
    return flag and not gemini_client.is_mock_mode_enabled() and gemini_client.has_gemini_key()


def _cache_key(kind: str, company: str, role: str) -> tuple:
    return (kind, company.lower(), re.sub(r"\s+", " ", role.lower()).strip())


def _extract_json_array(text: str) -> List[Any]:
    text = re.sub(r"```(?:json)?", "", text or "").strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        data = json.loads(text[start:end + 1], strict=False)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _domain(value: Any) -> str:
    value = re.sub(r"^https?://", "", str(value or "").lower().strip()).split("/")[0]
    return value[4:] if value.startswith("www.") else value


def _source_domains(sources: List[Dict[str, str]]) -> set:
    # grounding links are redirect URLs; the page's site name is in the title (usually its domain)
    return {d for d in (_domain(s.get("title")) for s in sources) if d}


def _verified_provenance(item: Dict[str, Any], domains: set) -> Optional[Dict[str, Any]]:
    """Keep company/year/times_asked only when the cited source site is one Gemini actually read."""
    site = _domain(item.get("source_domain"))
    if not site or not any(site == d or site.endswith("." + d) or d.endswith("." + site) for d in domains):
        return None
    return normalize_provenance({
        "company": item.get("company"), "year": item.get("year"), "times_asked": item.get("times_asked"),
    })


def _prompt(kind: str, role: str, skills: str, company: str, count: int, jd_text: str) -> str:
    target = company if company else TOP_TECH
    if kind == "aptitude":
        what = "aptitude, logical reasoning, quantitative and role-relevant technical MCQ questions"
        shape = ('{"topic": "...", "question": "the question, clean and self-contained", '
                 '"options": [{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}], '
                 '"correct_key": "A|B|C|D", "explanation": "short rationale", ')
    else:
        what = "coding / algorithm problems (Python 3, stdin and stdout)"
        shape = ('{"title": "...", "difficulty": "Easy|Medium|Hard", "description": "full problem statement in your own words", '
                 '"input_format": "stdin format", "output_format": "stdout format", "constraints": "limits", '
                 '"starter_code": {"python": "skeleton only: imports, function signature, stdin parsing, print; NO solution logic"}, '
                 '"public_test_cases": [exactly one {"input","expected_output","explanation"}], '
                 '"hidden_test_cases": [three to four {"input","expected_output"}], ')
    return (
        f'Use Google Search to find REAL {what} that candidates have reported being asked at {target} '
        f'for the role "{role}" (skills: {skills}).\n'
        f"Find up to {count} different questions. Never invent a question; only use questions you actually found on web pages. "
        f"Reword them cleanly.\n"
        f"Each item: {shape}"
        '"company": "company that asked it, ONLY if the page says so, else null", '
        '"year": 4-digit year ONLY if the page says so, else null, '
        '"times_asked": number of times it was reported ONLY if the page says so, else null, '
        '"source_domain": "website you found it on, e.g. example.com"}.\n'
        "Return ONLY a JSON array of items, no other text."
        f"{jd_context_note(jd_text)}"
    )


def research(kind: str, role: str, skills: str, company: str = "", jd_text: str = "", count: int = 10) -> List[Dict[str, Any]]:
    """Verified web questions as raw generator-schema dicts, each with an optional 'provenance'. [] on any problem."""
    if kind not in ("aptitude", "coding") or not is_enabled():
        return []
    company = sanitize_company(company)
    key = _cache_key(kind, company, role)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return [dict(i) for i in hit[1]]
    result = gemini_client.call_gemini_grounded(
        _prompt(kind, role, skills, company, count, jd_text),
        system_prompt="You are a careful interview-question researcher. You never invent questions or sources.",
    )
    domains = _source_domains(result["sources"])
    items: List[Dict[str, Any]] = []
    for raw in _extract_json_array(result["text"]):
        if not isinstance(raw, dict):
            continue
        clean = {k: v for k, v in raw.items() if k not in _LABEL_KEYS}
        prov = _verified_provenance(raw, domains)
        if prov:
            clean["provenance"] = prov
        elif isinstance(raw.get("company"), str) and raw["company"].strip():
            clean["style_company"] = raw["company"].strip()[:60]  # unverified: only usable as a "style" hint, never as "asked at"
        items.append(clean)
    logger.info("web research %s company=%r role=%r queries=%d sources=%d items=%d", kind, company, role,
                len(result["queries"]), len(result["sources"]), len(items))
    if items:
        with _cache_lock:
            _cache[key] = (now, [dict(i) for i in items])
    return items


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
