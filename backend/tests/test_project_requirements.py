"""Portfolio projects: a proper description and a real public GitHub repository are mandatory, the repository is
checked, and the review is based on what is really in it."""
import pytest
import requests
from fastapi.testclient import TestClient

import database
import models
from main import app
from services import github_repo_service as gh
from services import project_analyzer_service as analyzer
from services import project_rules
from tests.test_student_phase6 import FAKE_REPO, VALID_DESCRIPTION, project_payload, setup_phase6_data  # noqa: F401

client = TestClient(app)


def auth(data):
    return {"Authorization": f"Bearer {data['token_a']}"}


def repo(**overrides):
    return {**FAKE_REPO, **overrides}


def use_repo(monkeypatch, summary=None, exc=None):
    def fake(owner, name):
        if exc:
            raise exc
        return {**summary, "full_name": f"{owner}/{name}"} if summary else {**FAKE_REPO, "full_name": f"{owner}/{name}"}
    monkeypatch.setattr(gh, "fetch_repo_summary", fake)


def count_projects(data):
    return len(client.get("/api/student/projects", headers=auth(data)).json())


# ───────────────────────────── the link itself ─────────────────────────────

@pytest.mark.parametrize("url,expected", [
    ("https://github.com/alice/cache", "https://github.com/alice/cache"),
    ("github.com/alice/cache", "https://github.com/alice/cache"),
    ("http://www.github.com/alice/cache/", "https://github.com/alice/cache"),
    ("https://github.com/alice/cache.git", "https://github.com/alice/cache"),
    ("https://github.com/alice/cache/tree/main/src", "https://github.com/alice/cache"),
    ("  https://github.com/Alice-1/My_Repo.v2  ", "https://github.com/Alice-1/My_Repo.v2"),
])
def test_valid_repository_links_are_accepted_and_made_canonical(url, expected):
    assert gh.parse_github_repo_url(url)[2] == expected


@pytest.mark.parametrize("url,fragment", [
    ("", "Add your GitHub repository link"),
    (None, "Add your GitHub repository link"),
    ("   ", "Add your GitHub repository link"),
    ("https://gitlab.com/alice/cache", "GitHub repository link"),
    ("https://example.com/alice/cache", "GitHub repository link"),
    ("https://github.com/alice", "profile, not a repository"),
    ("https://github.com/alice/", "profile, not a repository"),
    ("https://github.com/", "full repository link"),
    ("https://github.com/orgs/acme", "does not look like a repository"),
    ("https://github.com/orgs/acme/repos", "does not look like a repository"),
    ("https://github.com/settings/profile", "does not look like a repository"),
    ("https://github.com/-bad-/cache", "does not look like a repository"),
    ("https://github.com/alice/ca che", "spaces"),
    ("https://github.com/alice/..", "not valid"),
])
def test_bad_links_get_a_message_that_says_what_to_fix(url, fragment):
    with pytest.raises(ValueError) as err:
        gh.parse_github_repo_url(url)
    assert fragment in str(err.value)


# ───────────────────────────── reading the repository ─────────────────────────────

class Resp:
    def __init__(self, status=200, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text

    def json(self):
        return self._payload


def fake_github(monkeypatch, repo_status=200, languages=None, readme="# Title\n\nSome words about the project " * 20, readme_status=200):
    base = {"full_name": "alice/cache", "html_url": "https://github.com/alice/cache", "description": "A cache",
            "language": "Python", "topics": ["cache"], "stargazers_count": 5, "forks_count": 2, "open_issues_count": 1,
            "default_branch": "main", "pushed_at": "2026-10-01T00:00:00Z", "created_at": "2026-01-01T00:00:00Z",
            "archived": False, "fork": False, "size": 100}

    def fake_get(url, headers=None, timeout=None):
        fake_get.calls.append((url, headers))
        if url.endswith("/languages"):
            return Resp(200, languages if languages is not None else {"Python": 9000, "HTML": 1000})
        if url.endswith("/readme"):
            return Resp(readme_status, text=readme)
        return Resp(repo_status, base)
    fake_get.calls = []
    monkeypatch.setattr(gh.requests, "get", fake_get)
    return fake_get


def test_a_public_repository_is_summarised(monkeypatch):
    fake_github(monkeypatch)
    summary = gh.fetch_repo_summary("alice", "cache")
    assert summary["full_name"] == "alice/cache" and summary["stars"] == 5 and summary["primary_language"] == "Python"
    assert summary["languages"] == {"Python": 90.0, "HTML": 10.0}
    assert summary["has_readme"] is True and summary["readme_words"] >= 80
    assert summary["pushed_at"] == "2026-10-01T00:00:00Z"


def test_readme_noise_is_not_counted_as_words(monkeypatch):
    readme = "![badge](https://img.shields.io/x.svg)\n```python\nprint('code')\n```\n<img src='a.png'>\n[Docs](https://x.y)\n# Title\nreal words here"
    fake_github(monkeypatch, readme=readme)
    summary = gh.fetch_repo_summary("alice", "cache")
    assert summary["readme_excerpt"] == "Docs Title real words here"
    assert summary["readme_words"] == 5


def test_a_missing_repository_is_reported_as_not_found(monkeypatch):
    fake_github(monkeypatch, repo_status=404)
    with pytest.raises(gh.RepoNotFound):
        gh.fetch_repo_summary("alice", "nope")


@pytest.mark.parametrize("status", [403, 429, 500, 502, 503])
def test_github_outages_and_rate_limits_are_unavailable_not_not_found(monkeypatch, status):
    fake_github(monkeypatch, repo_status=status)
    with pytest.raises(gh.RepoUnavailable):
        gh.fetch_repo_summary("alice", "cache")


def test_network_failures_are_unavailable(monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError("no network")
    monkeypatch.setattr(gh.requests, "get", boom)
    with pytest.raises(gh.RepoUnavailable):
        gh.fetch_repo_summary("alice", "cache")


def test_missing_readme_and_failed_language_lookup_do_not_fail_the_whole_check(monkeypatch):
    calls = fake_github(monkeypatch, readme_status=404, languages={})
    summary = gh.fetch_repo_summary("alice", "cache")
    assert summary["has_readme"] is False and summary["readme_words"] == 0 and summary["languages"] == {}
    assert calls.calls, "the repository itself was still read"


def test_a_github_token_is_sent_when_configured(monkeypatch):
    calls = fake_github(monkeypatch)
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret")
    gh.fetch_repo_summary("alice", "cache")
    assert all(h.get("Authorization") == "Bearer ghp_secret" for _, h in calls.calls)
    monkeypatch.delenv("GITHUB_TOKEN")
    calls.calls.clear()
    gh.fetch_repo_summary("alice", "cache")
    assert all("Authorization" not in h for _, h in calls.calls)


# ───────────────────────────── the rules, through the API ─────────────────────────────

def create(data, **overrides):
    return client.post("/api/student/projects", json=project_payload(**overrides), headers=auth(data))


def test_a_complete_project_is_accepted_and_the_link_is_stored_canonically(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    res = create(setup_phase6_data, github_url="github.com/alice/cache.git")
    assert res.status_code == 201, res.text
    assert res.json()["github_url"] == "https://github.com/alice/cache"


def test_the_github_link_is_optional(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    for missing in (None, "", "   "):
        res = create(setup_phase6_data, github_url=missing)
        assert res.status_code == 201, res.text
        assert res.json()["github_url"] is None
    payload = project_payload()
    payload.pop("github_url")
    res = client.post("/api/student/projects", json=payload, headers=auth(setup_phase6_data))
    assert res.status_code == 201, res.text


@pytest.mark.parametrize("url", ["https://gitlab.com/a/b", "https://github.com/alice", "not a link"])
def test_a_link_that_is_not_a_repository_is_rejected(setup_phase6_data, monkeypatch, url):
    use_repo(monkeypatch)
    res = create(setup_phase6_data, github_url=url)
    assert res.status_code == 422 and isinstance(res.json()["detail"], str)


def test_a_repository_that_does_not_exist_is_rejected_and_nothing_is_saved(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch, exc=gh.RepoNotFound("x"))
    before = count_projects(setup_phase6_data)
    res = create(setup_phase6_data, github_url="https://github.com/alice/ghost")
    assert res.status_code == 422
    assert "could not find github.com/alice/ghost" in res.json()["detail"] and "public" in res.json()["detail"]
    assert count_projects(setup_phase6_data) == before


def test_when_github_is_unreachable_the_project_is_still_accepted_but_marked_unchecked(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    verified = create(setup_phase6_data, title="Verified project").json()
    use_repo(monkeypatch, exc=gh.RepoUnavailable("rate limited"))
    res = create(setup_phase6_data, title="Unchecked project")
    assert res.status_code == 201, "a GitHub outage must never stop a student from saving their project"
    unchecked = res.json()
    assert "could not be reached" in unchecked["architecture_review"] and "Repository Evidence" not in unchecked["architecture_review"]
    assert unchecked["completeness_score"] < verified["completeness_score"], "an unchecked link earns less than a verified one"


@pytest.mark.parametrize("description,fragment", [
    ("", "at least 20 words"),
    ("Too short.", "at least 20 words (2 so far)"),
    ("A notes app built with React and a small API for storing notes in a database.", "at least 20 words"),
    ("word " * 40, "repeats the same words"),
])
def test_a_thin_description_is_rejected_with_a_helpful_count(setup_phase6_data, monkeypatch, description, fragment):
    use_repo(monkeypatch)
    before = count_projects(setup_phase6_data)
    res = create(setup_phase6_data, description=description)
    assert res.status_code == 422 and fragment in res.json()["detail"]
    assert count_projects(setup_phase6_data) == before


def test_other_fields_are_checked_too(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    assert "title" in create(setup_phase6_data, title="ab").json()["detail"].lower()
    assert "under 120" in create(setup_phase6_data, title="x" * 121).json()["detail"]
    assert "live demo" in create(setup_phase6_data, live_url="not a url").json()["detail"].lower()
    assert create(setup_phase6_data, live_url="my-app.vercel.app").json()["live_url"] == "https://my-app.vercel.app"
    assert create(setup_phase6_data, live_url="").json()["live_url"] is None
    long_desc = (VALID_DESCRIPTION + " ") * 30
    assert "under 4000" in create(setup_phase6_data, description=long_desc).json()["detail"]


def test_an_empty_tech_stack_is_filled_from_the_repositorys_languages(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch, repo(languages={"Python": 70.0, "JavaScript": 20.0, "HTML": 10.0}))
    res = create(setup_phase6_data, tech_stack=[])
    assert res.status_code == 201 and res.json()["tech_stack"] == ["Python", "JavaScript", "HTML"]
    kept = create(setup_phase6_data, tech_stack=["Rust"]).json()
    assert kept["tech_stack"] == ["Rust"], "what the student wrote is never replaced"


def test_the_review_is_based_on_the_real_repository(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch, repo(has_readme=False, readme_words=0, languages={"Python": 100.0}, stars=7))
    body = create(setup_phase6_data, tech_stack=["Python", "FastAPI"]).json()
    review = body["architecture_review"]
    assert "Repository Evidence" in review and "Python 100%" in review and "7 star" in review and "README: missing" in review
    assert any("no README" in r for r in body["recommendations"])
    assert any("repository" in q.lower() for q in body["suggested_interview_questions"])


def test_a_stack_that_does_not_match_the_code_is_called_out(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch, repo(languages={"Python": 100.0}))
    body = create(setup_phase6_data, tech_stack=["Java", "Python"]).json()
    assert "Stack Check" in body["architecture_review"] and "Java" in body["architecture_review"]
    assert body["recommendations"][0].startswith("Your stack lists Java")
    honest = create(setup_phase6_data, tech_stack=["Python", "FastAPI"]).json()
    assert "Stack Check" not in honest["architecture_review"], "frameworks must not trigger a false mismatch"


def test_a_good_readme_and_recent_activity_raise_the_score(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch, repo(has_readme=True, readme_words=300, pushed_at="2026-10-20T00:00:00Z"))
    good = create(setup_phase6_data, title="Good repo").json()["completeness_score"]
    use_repo(monkeypatch, repo(has_readme=False, readme_words=0, pushed_at="2020-01-01T00:00:00Z"))
    poor = create(setup_phase6_data, title="Poor repo").json()["completeness_score"]
    assert good > poor


def test_resume_bullets_never_invent_numbers(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    bullets = create(setup_phase6_data).json()["bullet_point_improvements"]
    joined = " ".join(bullets)
    assert "99%" not in joined and "200ms" not in joined
    assert joined.count("[your") >= 3, "numbers must be placeholders the student fills with real figures"


# ───────────────────────────── editing and re-analysis ─────────────────────────────

def test_editing_to_a_repository_that_does_not_exist_changes_nothing(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    created = create(setup_phase6_data, title="Editable").json()
    use_repo(monkeypatch, exc=gh.RepoNotFound("x"))
    res = client.put(f"/api/student/projects/{created['id']}", headers=auth(setup_phase6_data),
                     json={"title": "Renamed", "github_url": "https://github.com/alice/ghost"})
    assert res.status_code == 422
    after = client.get(f"/api/student/projects/{created['id']}", headers=auth(setup_phase6_data)).json()
    assert after["title"] == "Editable" and after["github_url"] == created["github_url"]


def test_an_edit_cannot_make_the_description_thin_or_use_a_bad_link(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    created = create(setup_phase6_data, title="Keep me").json()
    pid = created["id"]
    assert client.put(f"/api/student/projects/{pid}", headers=auth(setup_phase6_data), json={"description": "Short."}).status_code == 422
    assert client.put(f"/api/student/projects/{pid}", headers=auth(setup_phase6_data), json={"github_url": ""}).status_code == 200
    client.put(f"/api/student/projects/{pid}", headers=auth(setup_phase6_data), json={"github_url": created["github_url"]})
    assert client.put(f"/api/student/projects/{pid}", headers=auth(setup_phase6_data), json={"github_url": "https://gitlab.com/a/b"}).status_code == 422
    still = client.get(f"/api/student/projects/{pid}", headers=auth(setup_phase6_data)).json()
    assert still["description"] == created["description"] and still["github_url"] == created["github_url"]


def test_older_projects_without_a_link_can_still_be_renamed_and_re_analysed(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    with database.SessionLocal() as db:
        profile = db.query(models.StudentProfile).filter(models.StudentProfile.id == setup_phase6_data["profile_a_id"]).first()
        legacy = models.StudentProject(student_profile_id=profile.id, organization_id=profile.organization_id,
                                       title="Legacy", description="Old short description.", tech_stack=[], github_url=None)
        db.add(legacy)
        db.commit()
        legacy_id = legacy.id
    renamed = client.put(f"/api/student/projects/{legacy_id}", headers=auth(setup_phase6_data), json={"title": "Legacy renamed"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Legacy renamed"
    assert any("GitHub repository" in r for r in renamed.json()["recommendations"])
    assert client.post(f"/api/student/projects/{legacy_id}/analyze", headers=auth(setup_phase6_data)).status_code == 200


def test_re_analysis_still_works_when_github_is_down_or_the_repository_vanished(setup_phase6_data, monkeypatch):
    use_repo(monkeypatch)
    pid = create(setup_phase6_data, title="Refresh me").json()["id"]
    for failure in (gh.RepoUnavailable("down"), gh.RepoNotFound("deleted")):
        use_repo(monkeypatch, exc=failure)
        res = client.post(f"/api/student/projects/{pid}/analyze", headers=auth(setup_phase6_data))
        assert res.status_code == 200 and res.json()["completeness_score"] > 0


# ───────────────────────────── analyzer in isolation ─────────────────────────────

def test_analyzer_without_a_repository_behaves_as_before():
    plain = analyzer.analyze_student_project("Demo", VALID_DESCRIPTION, ["Python"], "https://github.com/a/b", None)
    verified = analyzer.analyze_student_project("Demo", VALID_DESCRIPTION, ["Python"], "https://github.com/a/b", None, repo_summary=FAKE_REPO)
    none = analyzer.analyze_student_project("Demo", VALID_DESCRIPTION, ["Python"], None, None)
    assert none["completeness_score"] < plain["completeness_score"] < verified["completeness_score"]
    assert "Repository Evidence" not in plain["architecture_review"]


def test_rules_normalise_titles_descriptions_and_stacks():
    assert project_rules.clean_title("  My   Project  ") == "My Project"
    assert project_rules.clean_tech_stack(["Python", "python", " ", "FastAPI", "x" * 100]) == ["Python", "FastAPI", "x" * 40]
    assert len(project_rules.clean_tech_stack([f"t{i}" for i in range(50)])) == project_rules.MAX_TECH_ITEMS
    assert project_rules.stack_from_repo(None) == []
    assert project_rules.stack_from_repo({"languages": {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5}}) == ["A", "B", "C", "D"]
