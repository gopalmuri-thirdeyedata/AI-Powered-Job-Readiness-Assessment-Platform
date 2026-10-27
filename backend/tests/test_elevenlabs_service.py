"""Voice service unit tests: the provider is stubbed (see conftest.elevenlabs_http), nothing here calls ElevenLabs or Gemini for real."""
import base64

import pytest

from services import elevenlabs_service as el
from services import gemini_client


def _session():
    return el.build_voice_session("jo.smith92@example.com", "Backend Engineer", "Python, SQL", "", [{"category": "SQL", "question": "Explain indexes."}])


def test_a_raw_email_is_never_spoken_as_the_candidate_name():
    first = _session()["first_message"]
    assert first.startswith("Hello Jo Smith,") and "@" not in first and "92" not in first


def test_the_public_config_carries_the_limits_but_never_the_prompt():
    session = el.build_voice_session("Jo", "Engineer", max_duration_seconds=900)
    public = el.public_voice_config(session)
    assert public == {"firstMessage": session["first_message"], "maxDurationSeconds": 900, "silenceTimeoutSeconds": 180}
    assert "system_prompt" not in public


def test_the_opening_line_is_spoken_with_the_configured_voice(elevenlabs_http):
    out = el.run_turn(_session(), opening=True)
    assert base64.b64decode(out["audio_base64"]) == b"ID3-fake-mp3-bytes" and out["user_text"] == ""
    call = elevenlabs_http.calls[-1]
    assert call["url"].endswith("/text-to-speech/test-voice-id") and call["headers"]["xi-api-key"] == "test-api-key-not-real"


def test_a_recording_is_transcribed_answered_and_spoken(elevenlabs_http, monkeypatch):
    monkeypatch.setattr(gemini_client, "call_gemini_text", lambda prompt, system_prompt, temperature=0.1: "Interesting. How did you test it?")
    out = el.run_turn(_session(), audio=b"fake", history=[{"role": "ai", "text": "Hi"}, {"role": "bogus", "text": ""}], opening=False)
    assert out["user_text"] == elevenlabs_http.transcript and out["reply_text"] == "Interesting. How did you test it?"
    assert [c["url"].rsplit("/", 1)[-1] for c in elevenlabs_http.calls] == ["speech-to-text", "test-voice-id"]


@pytest.mark.parametrize("heard", ["", "   ", "(background noise)", "[music]"])
def test_silence_and_noise_are_not_treated_as_an_answer(elevenlabs_http, heard):
    elevenlabs_http.transcript = heard
    out = el.run_turn(_session(), audio=b"fake")
    assert out == {"user_text": "", "reply_text": "", "audio_base64": None, "mime": el.AUDIO_MPEG}
    assert len(elevenlabs_http.calls) == 1, "no reply is generated or billed for an empty recording"


def test_provider_errors_become_a_generic_message(elevenlabs_http):
    elevenlabs_http.fail_with = 401
    with pytest.raises(el.VoiceServiceError) as err:
        el.run_turn(_session(), opening=True)
    assert err.value.status_code == 503 and "401" not in err.value.public_message and "upstream" not in err.value.public_message


def test_an_unconfigured_service_fails_cleanly(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY")
    assert not el.is_configured()
    with pytest.raises(el.VoiceServiceError):
        el.synthesize("hello")


def test_an_oversized_recording_is_refused(elevenlabs_http):
    with pytest.raises(el.VoiceServiceError) as err:
        el.transcribe(b"x" * (el.MAX_AUDIO_BYTES + 1))
    assert err.value.status_code == 413 and elevenlabs_http.calls == []


def test_history_is_bounded_and_sanitised():
    turns = el._clean_history([{"role": "assistant", "text": "a" * 5000}] + [{"role": "user", "text": f"t{i}"} for i in range(60)] + ["junk"])
    assert len(turns) <= el.MAX_HISTORY_TURNS and all(len(t["text"]) <= el.MAX_TURN_CHARS for t in turns)


def test_gemini_failure_is_reported_without_provider_detail(monkeypatch):
    def boom(*a, **k):
        raise gemini_client.GeminiUnavailableError("secret upstream text", kind="x")
    monkeypatch.setattr(gemini_client, "call_gemini_text", boom)
    with pytest.raises(el.VoiceServiceError) as err:
        el.next_reply("system", [], "hello")
    assert "secret" not in err.value.public_message
