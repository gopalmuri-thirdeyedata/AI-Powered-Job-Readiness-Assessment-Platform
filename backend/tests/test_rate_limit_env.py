"""The shared-link rate limits keep their strict defaults and can be raised through the environment (a class behind one address)."""
import importlib

import pytest

from services import rate_limiter


@pytest.mark.parametrize("raw,expected", [(None, 5), ("", 5), ("  ", 5), ("40", 40), (" 40 ", 40), ("abc", 5), ("0", 5), ("-3", 5), ("2.5", 5)])
def test_env_limit_parses_defensively(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("X_LIMIT", raising=False)
    else:
        monkeypatch.setenv("X_LIMIT", raw)
    assert rate_limiter.env_limit("X_LIMIT", 5) == expected


def test_defaults_are_unchanged_and_the_environment_raises_them(monkeypatch):
    from routers import proctor, public_assessment
    for name in ("PUBLIC_REGISTER_LIMIT_PER_MIN", "PUBLIC_START_LIMIT_PER_MIN", "PUBLIC_META_LIMIT_PER_MIN", "PROCTOR_STATUS_LIMIT_PER_MIN"):
        monkeypatch.delenv(name, raising=False)
    try:
        importlib.reload(public_assessment); importlib.reload(proctor)
        assert (public_assessment.register_limiter.limit, public_assessment.start_limiter.limit, public_assessment.meta_limiter.limit,
                proctor.status_limiter.limit) == (5, 30, 60, 60)
        monkeypatch.setenv("PUBLIC_REGISTER_LIMIT_PER_MIN", "40")
        monkeypatch.setenv("PROCTOR_STATUS_LIMIT_PER_MIN", "600")
        importlib.reload(public_assessment); importlib.reload(proctor)
        assert public_assessment.register_limiter.limit == 40 and proctor.status_limiter.limit == 600
        assert all(public_assessment.register_limiter.allow("10.97.0.1") for _ in range(40)) and not public_assessment.register_limiter.allow("10.97.0.1")
    finally:
        monkeypatch.undo()
        importlib.reload(public_assessment); importlib.reload(proctor)
