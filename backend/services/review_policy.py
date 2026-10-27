"""
The mandatory exam review: what counts as a word, how many are required, and the single validation used by the API.

The frontend mirrors this definition exactly (frontend/src/utils/wordCount.js). Both are checked against the same shared test
vectors (backend/tests/data/word_count_cases.json), so the live counter and the server can never disagree.

A word is a maximal run of non-whitespace characters. "Whitespace" is spelled out as an explicit set (the characters JavaScript's
\\s matches) rather than relying on each language's own idea of \\s, which differ for a few control characters.
"""
import re
from typing import Optional

MIN_REVIEW_WORDS = 30
MAX_REVIEW_CHARS = 5000

WHITESPACE = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
_SPLIT = f"[{WHITESPACE}]+"


def count_words(text: Optional[str]) -> int:
    return len([w for w in re.split(_SPLIT, text or "") if w])


def clean(text: Optional[str]) -> str:
    """Leading/trailing whitespace removed; the text itself (including its line breaks) is stored as written."""
    return re.sub(f"^[{WHITESPACE}]+|[{WHITESPACE}]+$", "", text or "")


def validation_error(text: Optional[str]) -> Optional[str]:
    """None when the review is acceptable, otherwise the message the student sees."""
    cleaned = clean(text)
    if not cleaned:
        return f"Please write your exam review. It must contain at least {MIN_REVIEW_WORDS} words."
    words = count_words(cleaned)
    if words < MIN_REVIEW_WORDS:
        return f"Your review must contain at least {MIN_REVIEW_WORDS} words (you have written {words})."
    if len(cleaned) > MAX_REVIEW_CHARS:
        return f"Your review is too long. Please keep it under {MAX_REVIEW_CHARS} characters."
    return None
