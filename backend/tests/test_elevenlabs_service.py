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
    monkeypatch.setattr(gemini_client, "call_gemini_text", lambda prompt, system_prompt, temperature=0.1, **kw: "Interesting. How did you test it?")
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


# ------------------------------------------------------------------------------ streaming turn
def _events(gen):
    return list(gen)


def test_the_stream_speaks_the_opening_line_then_finishes(elevenlabs_http):
    events = _events(el.run_turn_stream(_session(), opening=True))
    assert [e["type"] for e in events] == ["transcript", "audio", "done"]
    assert base64.b64decode(events[1]["audio_base64"]) == b"ID3-fake-mp3-bytes" and events[2]["reply_text"] == events[1]["text"]


def test_the_stream_delivers_the_reply_as_ordered_spoken_chunks(elevenlabs_http, monkeypatch):
    reply = ["Interesting. ", "How did you test that service in production? ", "And what would you change now?"]
    monkeypatch.setattr(gemini_client, "stream_gemini_text", lambda *a, **k: iter(reply))
    events = _events(el.run_turn_stream(_session(), audio=b"fake", history=[{"role": "ai", "text": "Hi"}]))
    kinds = [e["type"] for e in events]
    assert kinds[0] == "transcript" and kinds[-1] == "done" and set(kinds[1:-1]) == {"audio"}
    audio = [e for e in events if e["type"] == "audio"]
    assert [e["index"] for e in audio] == list(range(len(audio))) and len(audio) >= 1
    assert " ".join(e["text"] for e in audio) == events[-1]["reply_text"] == "Interesting. How did you test that service in production? And what would you change now?"
    assert events[0]["user_text"] == elevenlabs_http.transcript
    urls = [c["url"].rsplit("/", 1)[-1] for c in elevenlabs_http.calls]
    assert urls[0] == "speech-to-text" and urls.count("test-voice-id") == len(audio)


@pytest.mark.parametrize("heard", ["", "(background noise)"])
def test_the_stream_stops_after_the_transcript_when_nothing_was_said(elevenlabs_http, monkeypatch, heard):
    elevenlabs_http.transcript = heard
    monkeypatch.setattr(gemini_client, "stream_gemini_text", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no reply is generated")))
    events = _events(el.run_turn_stream(_session(), audio=b"fake"))
    assert [e["type"] for e in events] == ["transcript", "done"] and events[0]["user_text"] == "" and events[1]["reply_text"] == ""
    assert len(elevenlabs_http.calls) == 1


def test_stream_failures_become_one_safe_error_event(elevenlabs_http, monkeypatch):
    def boom(*a, **k):
        raise gemini_client.GeminiUnavailableError("secret upstream text", kind="x")
        yield  # pragma: no cover
    monkeypatch.setattr(gemini_client, "stream_gemini_text", boom)
    events = _events(el.run_turn_stream(_session(), audio=b"fake"))
    assert events[-1]["type"] == "error" and "secret" not in events[-1]["message"] and not any(e["type"] == "audio" for e in events)
    elevenlabs_http.fail_with = 401
    events = _events(el.run_turn_stream(_session(), opening=True))
    assert events[-1]["type"] == "error" and "401" not in events[-1]["message"]


def test_sentence_chunking_joins_short_acknowledgements_and_keeps_the_tail():
    chunks = list(el._chunk_sentences(iter(["Great. ", "Tell me about a time you used Python at scale. Why did you choose it? And", " what went wrong?"])))
    assert chunks == ["Great. Tell me about a time you used Python at scale.", "Why did you choose it? And what went wrong?"]
    assert list(el._chunk_sentences(iter(["Short."]))) == ["Short."]
    assert list(el._chunk_sentences(iter([]))) == []
    assert "*" not in "".join(el._chunk_sentences(iter(["**Interviewer:** Explain indexes in detail please. "])))


def test_repeated_lines_are_synthesised_once(elevenlabs_http):
    el.synthesize("A line the interviewer says twice in this test run.")
    el.synthesize("A line the interviewer says twice in this test run.")
    assert len(elevenlabs_http.calls) == 1


# ------------------------------------------------------------------------------ many students at once (the plan allows only a few simultaneous requests)
class _Resp:
    def __init__(self, status, body=b"ID3-audio", payload=None):
        self.status_code, self.content, self._payload, self.text = status, body, payload, ""

    def json(self):
        return self._payload


def test_surplus_voice_requests_wait_their_turn_instead_of_hitting_the_providers_concurrency_limit(monkeypatch):
    import concurrent.futures
    import threading
    import time as _time
    from services.student_sandbox import SandboxGate
    monkeypatch.setattr(el, "_tts_line", SandboxGate(2, 10.0, 100, busy_factory=el._voice_busy))
    live, peak, lock = [0], [0], threading.Lock()

    def fake_post(*args, **kwargs):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        _time.sleep(0.03)
        with lock:
            live[0] -= 1
        return _Resp(200)

    monkeypatch.setattr(el, "_post", fake_post)
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda i: el.synthesize(f"Hello student number {i}, welcome."), range(20)))
    assert len(results) == 20 and all(results)
    assert peak[0] <= 2, f"the provider saw {peak[0]} at once"


def test_a_429_from_the_provider_is_retried_briefly_and_then_succeeds(monkeypatch):
    monkeypatch.setattr(el.time, "sleep", lambda s: None)
    answers = iter([_Resp(429), _Resp(429), _Resp(200)])
    calls = []
    monkeypatch.setattr(el, "_post", lambda *a, **k: calls.append(1) or next(answers))
    assert el.synthesize("A line that hits the concurrency limit twice.") == b"ID3-audio"
    assert len(calls) == 3


def test_a_provider_that_keeps_saying_429_ends_as_the_ordinary_safe_failure(monkeypatch):
    monkeypatch.setattr(el.time, "sleep", lambda s: None)
    monkeypatch.setattr(el, "_post", lambda *a, **k: _Resp(429))
    with pytest.raises(el.VoiceServiceError) as caught:
        el.synthesize("Always limited.")
    assert "429" not in caught.value.public_message and "concurrent" not in caught.value.public_message.lower()


def test_a_wait_that_runs_out_is_a_safe_busy_message_for_the_candidate(monkeypatch):
    import threading
    import time as _time
    from services.student_sandbox import SandboxGate
    monkeypatch.setattr(el, "_stt_line", SandboxGate(1, 0.1, 5, busy_factory=el._voice_busy))
    release = threading.Event()
    monkeypatch.setattr(el, "_post", lambda *a, **k: release.wait(2) and _Resp(200, payload={"text": "hello"}))
    holder = threading.Thread(target=lambda: el.transcribe(b"audio-one"))
    holder.start()
    _time.sleep(0.05)
    with pytest.raises(el.VoiceServiceError) as caught:
        el.transcribe(b"audio-two")
    assert "busy" in caught.value.public_message.lower() and caught.value.status_code == 503
    release.set()
    holder.join()


def test_the_defaults_fit_a_starter_plan_with_four_workers(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_TTS_CONCURRENCY", raising=False)
    monkeypatch.delenv("ELEVENLABS_STT_CONCURRENCY", raising=False)
    assert el._concurrency_env("ELEVENLABS_TTS_CONCURRENCY", 1) * 4 <= 6          # Starter allows 6 text-to-speech at once
    assert el._concurrency_env("ELEVENLABS_STT_CONCURRENCY", 3) * 4 <= 12         # and 12 speech-to-text
    monkeypatch.setenv("ELEVENLABS_TTS_CONCURRENCY", "2")
    assert el._concurrency_env("ELEVENLABS_TTS_CONCURRENCY", 1) == 2
    monkeypatch.setenv("ELEVENLABS_TTS_CONCURRENCY", "nonsense")
    assert el._concurrency_env("ELEVENLABS_TTS_CONCURRENCY", 1) == 1
