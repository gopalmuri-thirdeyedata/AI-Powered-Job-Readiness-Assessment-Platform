"""Phase 1/2: centralized Gemini client, mock mode, retry policy, and Groq/OpenAI purge."""
import pathlib
import sys

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import gemini_client  # noqa: E402

SERVICES_DIR = pathlib.Path(__file__).resolve().parents[1] / "services"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("GEMINI_MOCK_MODE", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: None)
    monkeypatch.setattr(gemini_client, "_sleep", lambda s: None)


def test_mock_mode_returns_ten_aptitude_questions(monkeypatch):
    monkeypatch.setenv("GEMINI_MOCK_MODE", "true")
    res = gemini_client.call_gemini("Generate 10 high-quality aptitude questions for ...")
    assert len(res["questions"]) == 10
    assert all(len(q["options"]) == 4 for q in res["questions"])


def test_mock_mode_returns_two_python_problems_with_hidden_tests(monkeypatch):
    monkeypatch.setenv("GEMINI_MOCK_MODE", "true")
    res = gemini_client.call_gemini("Generate 2 coding assessment problems tailored ...")
    assert len(res["problems"]) == 2
    for p in res["problems"]:
        assert list(p["starter_code"]) == ["python"]
        assert len(p["public_test_cases"]) == 1
        assert 3 <= len(p["hidden_test_cases"]) <= 4


def test_missing_key_raises_structured_runtime_error():
    with pytest.raises(RuntimeError) as exc:
        gemini_client.call_gemini("anything")
    assert isinstance(exc.value, gemini_client.GeminiUnavailableError)
    assert "GEMINI_API_KEY" in str(exc.value)


def test_model_name_default_and_override(monkeypatch):
    assert gemini_client.get_model_name() == "gemini-2.5-flash"
    monkeypatch.setenv("GEMINI_MODEL_NAME", "gemini-test")
    assert gemini_client.get_model_name() == "gemini-test"


def test_retry_uses_single_transient_backoff_then_raises(monkeypatch):
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "k")
    sleeps, calls = [], []
    monkeypatch.setattr(gemini_client, "_sleep", sleeps.append)
    monkeypatch.setattr(gemini_client, "_generate_via_rest",
                        lambda *a: calls.append(1) or (_ for _ in ()).throw(gemini_client._TransientGeminiError("x")))
    monkeypatch.setitem(sys.modules, "google.generativeai", None)  # force REST adapter
    with pytest.raises(gemini_client.GeminiUnavailableError):
        gemini_client.call_gemini("p")
    assert len(calls) == 2  # first attempt + 1 retry for interactive assessment creation
    assert sleeps == [1]


def test_rest_adapter_parses_response_and_strips_code_fences(monkeypatch):
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "k")
    monkeypatch.setitem(sys.modules, "google.generativeai", None)

    def fake_post(url, json, headers, timeout):
        assert headers["x-goog-api-key"] == "k"
        assert timeout == 30
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "```json\n{\"a\": 1}\n```"}]}}]})

    monkeypatch.setattr(gemini_client.httpx, "post", fake_post)
    assert gemini_client.call_gemini("p") == {"a": 1}


def test_rest_adapter_does_not_retry_auth_errors(monkeypatch):
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "k")
    monkeypatch.setitem(sys.modules, "google.generativeai", None)
    calls = []
    monkeypatch.setattr(gemini_client.httpx, "post",
                        lambda *a, **k: calls.append(1) or httpx.Response(403, json={}))
    with pytest.raises(gemini_client.GeminiUnavailableError):
        gemini_client.call_gemini("p")
    assert len(calls) == 1


def test_no_groq_references_in_services():
    offenders = [f.name for f in SERVICES_DIR.glob("*.py") if "groq" in f.read_text(encoding="utf-8").lower()]
    assert offenders == []


def test_no_openai_in_llm_call_paths():
    offenders = [f.name for f in SERVICES_DIR.glob("*.py") if "gpt-4" in f.read_text(encoding="utf-8").lower()]
    assert offenders == []


def test_voice_interviewer_replies_come_from_gemini_and_speech_from_elevenlabs(monkeypatch):
    """The interviewer's words are written by Gemini (plain spoken text); only the speech layer is ElevenLabs."""
    from services import elevenlabs_service
    seen = {}

    def fake_text(prompt, system_prompt, temperature=0.1):
        seen.update(prompt=prompt, system_prompt=system_prompt)
        return "**Interviewer:** Question 2: how do you debug a slow query?"

    monkeypatch.setattr(gemini_client, "call_gemini_text", fake_text)
    session = elevenlabs_service.build_voice_session("Jo", "Backend Engineer", "summary", "", questions=[{"category": "SQL", "question": "Explain indexes."}])
    reply = elevenlabs_service.next_reply(session["system_prompt"], [{"role": "ai", "text": "Hi Jo"}], "I used indexes a lot.")
    assert reply == "Question 2: how do you debug a slow query?"          # markdown and the speaker label are stripped before it is spoken
    assert "Interviewer: Hi Jo" in seen["prompt"] and "Candidate: I used indexes a lot." in seen["prompt"]
    assert "Question 1 [SQL]: Explain indexes." in seen["system_prompt"] and "NEVER say goodbye" in seen["system_prompt"]


def test_gemini_2_5_model_passes_thinking_budget_zero(monkeypatch):
    """Gemini 2.5 models disable internal thinking tokens for fast, low-latency JSON synthesis."""
    monkeypatch.setattr(gemini_client, "has_gemini_key", lambda: True)
    monkeypatch.setattr(gemini_client, "get_gemini_api_key", lambda: "k")
    monkeypatch.setenv("GEMINI_MODEL_NAME", "gemini-2.5-flash")
    monkeypatch.setitem(sys.modules, "google.generativeai", None)

    captured = {}

    def fake_post(url, json, headers, timeout):
        captured.update(json=json)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "{\"ok\": true}"}]}}]})

    monkeypatch.setattr(gemini_client.httpx, "post", fake_post)
    res = gemini_client.call_gemini("test prompt", json_mode=True)
    assert res == {"ok": True}
    assert "thinkingConfig" in captured["json"]["generationConfig"]
    assert captured["json"]["generationConfig"]["thinkingConfig"]["thinkingBudget"] == 0

