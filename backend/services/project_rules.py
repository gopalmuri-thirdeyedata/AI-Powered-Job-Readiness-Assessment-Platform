"""
What a portfolio project must contain before it is analysed, with messages that tell the student what to fix.
Validation raises HTTP 422 with a plain-text `detail` so the page can show it next to the form.
"""
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import HTTPException

from services import github_repo_service

MIN_TITLE_CHARS = 3
MAX_TITLE_CHARS = 120
MIN_DESCRIPTION_CHARS = 100
MIN_DESCRIPTION_WORDS = 20
MIN_DISTINCT_WORDS = 10
MAX_DESCRIPTION_CHARS = 4000
MAX_TECH_ITEMS = 20
MAX_TECH_CHARS = 40
MAX_URL_CHARS = 500


def _fail(message: str) -> None:
    raise HTTPException(status_code=422, detail=message)


def clean_title(title: Optional[str]) -> str:
    value = " ".join((title or "").split())
    if len(value) < MIN_TITLE_CHARS:
        _fail(f"Give your project a title of at least {MIN_TITLE_CHARS} characters.")
    if len(value) > MAX_TITLE_CHARS:
        _fail(f"Keep the project title under {MAX_TITLE_CHARS} characters.")
    return value


def clean_description(description: Optional[str]) -> str:
    value = "\n".join(line.strip() for line in (description or "").strip().splitlines())
    words = value.split()
    if len(value) > MAX_DESCRIPTION_CHARS:
        _fail(f"Keep the description under {MAX_DESCRIPTION_CHARS} characters.")
    if len(words) < MIN_DESCRIPTION_WORDS or len(value) < MIN_DESCRIPTION_CHARS:
        _fail(
            f"Describe the project properly: at least {MIN_DESCRIPTION_WORDS} words ({len(words)} so far). "
            "Say what it does, how it is built and what the result was."
        )
    if len({w.lower().strip('.,;:!?()"\'') for w in words}) < MIN_DISTINCT_WORDS:
        _fail("The description repeats the same words. Describe what the project does and how you built it.")
    return value


def clean_tech_stack(tech_stack: Optional[List[str]]) -> List[str]:
    seen, cleaned = set(), []
    for raw in tech_stack or []:
        item = " ".join(str(raw).split())[:MAX_TECH_CHARS]
        if item and item.lower() not in seen:
            seen.add(item.lower())
            cleaned.append(item)
    return cleaned[:MAX_TECH_ITEMS]


def clean_live_url(url: Optional[str]) -> Optional[str]:
    value = (url or "").strip()
    if not value:
        return None
    if len(value) > MAX_URL_CHARS:
        _fail("The live demo link is too long.")
    parsed = urlparse(value if "://" in value else "https://" + value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or "." not in parsed.hostname or " " in value:
        _fail("The live demo link is not a valid web address. Use something like https://my-project.vercel.app.")
    return parsed.geturl()


def clean_github_url(url: Optional[str]) -> Dict[str, str]:
    """Validates the repository link and returns {owner, repo, url} with the canonical URL."""
    try:
        owner, repo, canonical = github_repo_service.parse_github_repo_url(url)
    except ValueError as exc:
        _fail(str(exc))
    return {"owner": owner, "repo": repo, "url": canonical}


def load_repo(repo: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """
    Reads the repository from GitHub. A repository that does not exist (or is private) is rejected; if GitHub
    itself cannot be reached the project is still accepted, just marked unverified (returns None).
    """
    try:
        return github_repo_service.fetch_repo_summary(repo["owner"], repo["repo"])
    except github_repo_service.RepoNotFound:
        _fail(
            f"We could not find github.com/{repo['owner']}/{repo['repo']}. Check the link, and make sure the "
            "repository is public so it can be reviewed."
        )
    except github_repo_service.RepoUnavailable as exc:
        print(f"[Projects] GitHub could not be reached for {repo['owner']}/{repo['repo']}: {exc}")
        return None


def stack_from_repo(repo_summary: Optional[Dict[str, Any]], limit: int = 4) -> List[str]:
    """When the student lists no technologies, the repository's own languages are used."""
    if not repo_summary:
        return []
    return list((repo_summary.get("languages") or {}).keys())[:limit]
