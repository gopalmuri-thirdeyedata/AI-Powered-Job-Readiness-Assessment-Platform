"""
GitHub repository link handling for student portfolio projects.

parse_github_repo_url   strict, friendly validation of the link a student types
fetch_repo_summary      reads public facts about the repository (languages, README, activity) so the project
                        review is based on the real code, not only on the description

Only public repositories can be read. A missing repository is reported as such; a GitHub outage or rate limit is
reported separately so a student is never blocked because GitHub was unreachable for a moment.
Set GITHUB_TOKEN to raise GitHub's rate limit from 60 to 5000 requests per hour.
"""
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import requests

API_BASE = "https://api.github.com"
CONNECT_TIMEOUT_SECONDS = 3
READ_TIMEOUT_SECONDS = 5
README_MAX_CHARS = 20000

_OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
_REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
# first path segments on github.com that are pages, not accounts
_RESERVED_OWNERS = {
    "orgs", "settings", "topics", "features", "marketplace", "sponsors", "about", "pricing", "login", "join",
    "explore", "notifications", "pulls", "issues", "new", "apps", "enterprise", "collections", "trending",
    "search", "security", "customer-stories", "readme", "site", "contact", "gist",
}


class RepoNotFound(Exception):
    """The repository does not exist, or it is private."""


class RepoUnavailable(Exception):
    """GitHub could not be reached or refused the request (outage, rate limit), so nothing is known either way."""


def parse_github_repo_url(url: Optional[str]) -> Tuple[str, str, str]:
    """
    Returns (owner, repo, canonical_url) or raises ValueError with a message that tells the student what to fix.
    Accepts links with or without https://, a trailing slash or .git, and deep links such as /tree/main.
    """
    text = (url or "").strip()
    if not text:
        raise ValueError("Add your GitHub repository link. We use it to check and review your real code.")
    if re.search(r"\s", text):
        raise ValueError("The GitHub link must not contain spaces.")
    if not re.match(r"^https?://", text, re.IGNORECASE):
        text = "https://" + text

    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    if host not in ("github.com", "www.github.com"):
        raise ValueError("Use a GitHub repository link, for example https://github.com/your-name/your-project.")

    parts = [p for p in parsed.path.split("/") if p]
    if not parts:
        raise ValueError("Add the full repository link, for example https://github.com/your-name/your-project.")
    owner = parts[0]
    if len(parts) == 1:
        raise ValueError(
            "That link points to a GitHub profile, not a repository. Open the project's repository and copy its "
            "link, for example https://github.com/your-name/your-project."
        )
    repo = parts[1]
    if repo.lower().endswith(".git"):
        repo = repo[:-4]

    if owner.lower() in _RESERVED_OWNERS or not _OWNER_RE.match(owner):
        raise ValueError("That does not look like a repository link. Copy it from the repository's page on GitHub.")
    if repo in (".", "..") or not _REPO_RE.match(repo):
        raise ValueError("The repository name in that link is not valid. Copy the link from the repository's page on GitHub.")

    return owner, repo, f"https://github.com/{owner}/{repo}"


def _headers(accept: str) -> Dict[str, str]:
    headers = {"Accept": accept, "User-Agent": "PrepWin-ProjectReview", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get(path: str, accept: str = "application/vnd.github+json") -> requests.Response:
    return requests.get(
        f"{API_BASE}{path}", headers=_headers(accept), timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS)
    )


def _language_percentages(raw: Dict[str, int], limit: int = 6) -> Dict[str, float]:
    total = sum(v for v in raw.values() if isinstance(v, (int, float)) and v > 0)
    if not total:
        return {}
    ranked = sorted(raw.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return {name: round(100.0 * size / total, 1) for name, size in ranked if size > 0}


def _clean_readme(text: str) -> str:
    """Plain words from a README: drops images, badges, code fences, raw HTML and link targets."""
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[#>*_`|-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch_repo_summary(owner: str, repo: str) -> Dict[str, Any]:
    """
    Public facts about the repository. Raises RepoNotFound (404) or RepoUnavailable (anything else that stops
    us from knowing). Languages and README are best effort: a failure there leaves those fields empty.
    """
    try:
        response = _get(f"/repos/{owner}/{repo}")
    except requests.RequestException as exc:
        raise RepoUnavailable(str(exc)) from exc

    if response.status_code == 404:
        raise RepoNotFound(f"{owner}/{repo}")
    if response.status_code != 200:  # 403/429 rate limit, 5xx outage, anything unexpected
        raise RepoUnavailable(f"GitHub answered HTTP {response.status_code}")
    data = response.json()

    def languages():
        try:
            res = _get(f"/repos/{owner}/{repo}/languages")
            return _language_percentages(res.json()) if res.status_code == 200 else {}
        except (requests.RequestException, ValueError):
            return {}

    def readme():
        try:
            res = _get(f"/repos/{owner}/{repo}/readme", accept="application/vnd.github.raw+json")
            return res.text[:README_MAX_CHARS] if res.status_code == 200 else None
        except requests.RequestException:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        lang_future = pool.submit(languages)
        readme_future = pool.submit(readme)
        language_split = lang_future.result()
        readme_raw = readme_future.result()

    readme_clean = _clean_readme(readme_raw) if readme_raw else ""
    return {
        "full_name": data.get("full_name") or f"{owner}/{repo}",
        "url": data.get("html_url") or f"https://github.com/{owner}/{repo}",
        "description": (data.get("description") or "").strip(),
        "primary_language": data.get("language"),
        "languages": language_split,
        "topics": list(data.get("topics") or []),
        "stars": int(data.get("stargazers_count") or 0),
        "forks": int(data.get("forks_count") or 0),
        "open_issues": int(data.get("open_issues_count") or 0),
        "default_branch": data.get("default_branch") or "main",
        "created_at": data.get("created_at"),
        "pushed_at": data.get("pushed_at"),
        "archived": bool(data.get("archived")),
        "is_fork": bool(data.get("fork")),
        "size_kb": int(data.get("size") or 0),
        "has_readme": readme_raw is not None and bool(readme_clean),
        "readme_words": len(readme_clean.split()) if readme_clean else 0,
        "readme_excerpt": readme_clean[:600],
    }
