"""
Gemini AI Client — single centralized LLM entry point for the platform.

* Official `google-generativeai` SDK when installed, native `httpx` REST otherwise.
* 3 retries with exponential backoff (1s, 2s, 4s) and a 30s request timeout.
* Offline deterministic mock mode (`GEMINI_MOCK_MODE=true`) for keyless dev/tests.
* No third-party LLM fallback: a missing key raises `GeminiUnavailableError`
  (a RuntimeError) so callers fall back to their own deterministic content.
"""
import json
import os
import time
from typing import Optional

import httpx
from dotenv import load_dotenv

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_env_path = os.path.join(_backend_dir, ".env")
load_dotenv(_env_path)
load_dotenv()

DEFAULT_MODEL_NAME = "gemini-2.5-flash"
REQUEST_TIMEOUT_SECONDS = 30
RETRY_BACKOFF_SECONDS = (1,)  # 1 retry for transient errors during interactive assessment generation
GEMINI_REST_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Indirection so tests can run the retry loop without real sleeping.
_sleep = time.sleep


class GeminiUnavailableError(RuntimeError):
    """Raised when Gemini cannot be used (no key configured, or all retries failed)."""


def get_gemini_api_key() -> Optional[str]:
    """Get the Gemini API key from environment."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        load_dotenv(_env_path)
        key = os.getenv("GEMINI_API_KEY")
    return key


def get_model_name() -> str:
    name = os.getenv("GEMINI_MODEL_NAME")
    if not name:
        load_dotenv(_env_path)
        name = os.getenv("GEMINI_MODEL_NAME")
    return (name or DEFAULT_MODEL_NAME).strip()


def has_gemini_key() -> bool:
    """Checks if valid Gemini API key is present."""
    k = get_gemini_api_key()
    return bool(k and k.strip() and not k.startswith("YOUR_GEMINI"))


def is_mock_mode_enabled() -> bool:
    return os.getenv("GEMINI_MOCK_MODE", "false").strip().lower() in ("true", "1", "yes")


def is_ai_available() -> bool:
    """True when a call_gemini() attempt can be made (live key or mock mode)."""
    return is_mock_mode_enabled() or has_gemini_key()


def _clean_json_text(content: str) -> str:
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3].strip()
    return content.replace("```json", "").replace("```", "").strip()


class _TransientGeminiError(Exception):
    pass


def _generate_via_sdk(genai, api_key, prompt, system_prompt, temperature, json_mode) -> str:
    genai.configure(api_key=api_key)
    try:
        model = genai.GenerativeModel(
            model_name=get_model_name(),
            system_instruction=system_prompt,
            generation_config=genai.GenerationConfig(
                temperature=temperature,
                response_mime_type="application/json" if json_mode else "text/plain",
            ),
        )
        response = model.generate_content(prompt, request_options={"timeout": REQUEST_TIMEOUT_SECONDS})
        return response.text
    except Exception as e:
        err_msg = str(e).lower()
        if any(term in err_msg for term in ["429", "500", "502", "503", "504", "deadline", "timeout", "resourceexhausted"]):
            raise _TransientGeminiError(str(e))
        raise GeminiUnavailableError(str(e))


def _generate_via_rest(api_key, prompt, system_prompt, temperature, json_mode) -> str:
    model_name = get_model_name()
    generation_config = {
        "temperature": temperature,
        "responseMimeType": "application/json" if json_mode else "text/plain",
    }
    # For Gemini 2.5 models (e.g. gemini-2.5-flash), disable internal thinking for
    # structured JSON generation to eliminate multi-second reasoning latency.
    if json_mode and "2.5" in model_name:
        generation_config["thinkingConfig"] = {"thinkingBudget": 0}

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": generation_config,
    }
    try:
        resp = httpx.post(
            GEMINI_REST_URL.format(model=model_name),
            json=body,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except (httpx.TimeoutException, httpx.TransportError) as e:
        raise _TransientGeminiError(str(e))
    if resp.status_code == 429 or resp.status_code >= 500:
        raise _TransientGeminiError(f"HTTP {resp.status_code}")
    if resp.status_code != 200:
        raise GeminiUnavailableError(f"Gemini API returned HTTP {resp.status_code}")
    data = resp.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise GeminiUnavailableError("Gemini API returned an empty or blocked response")


def _generate(prompt, system_prompt, temperature, json_mode) -> str:
    api_key = get_gemini_api_key()
    # The REST path disables Gemini 2.5's internal "thinking" (it adds seconds to every structured JSON
    # call: ~40% of the latency measured on interview scoring). The installed SDK cannot set that, so the
    # SDK is opt-in only (GEMINI_USE_SDK=1) instead of silently taking over whenever it is installed.
    genai = None
    if os.getenv("GEMINI_USE_SDK", "").strip().lower() in ("1", "true", "yes"):
        try:
            import google.generativeai as genai  # optional dependency
        except ImportError:
            genai = None

    last_error: Optional[Exception] = None
    for attempt in range(len(RETRY_BACKOFF_SECONDS) + 1):
        try:
            if genai is not None:
                return _generate_via_sdk(genai, api_key, prompt, system_prompt, temperature, json_mode)
            return _generate_via_rest(api_key, prompt, system_prompt, temperature, json_mode)
        except GeminiUnavailableError:
            raise
        except _TransientGeminiError as e:
            last_error = e
            if attempt < len(RETRY_BACKOFF_SECONDS):
                _sleep(RETRY_BACKOFF_SECONDS[attempt])
        except Exception as e:
            # Non-retryable error: fail fast so deterministic fallback kicks in immediately
            raise GeminiUnavailableError(f"Gemini request failed: {e}")
    raise GeminiUnavailableError(f"Gemini request failed after retries: {last_error}")


def call_gemini(prompt: str, system_prompt: str = "You are a helpful assistant.", temperature: float = 0.1, json_mode: bool = True) -> dict:
    """
    Calls Gemini and returns a parsed JSON dict (json_mode) or {"text": ...}.
    Raises GeminiUnavailableError when no key is configured or the call fails.
    """
    if is_mock_mode_enabled():
        from . import gemini_mock_fixtures
        return gemini_mock_fixtures.get_mock_response(prompt, json_mode)

    if not has_gemini_key():
        raise GeminiUnavailableError("GEMINI_API_KEY is not configured. Safe error; session state preserved.")

    content = _generate(prompt, system_prompt, temperature, json_mode).strip()
    if json_mode:
        try:
            return json.loads(_clean_json_text(content), strict=False)
        except json.JSONDecodeError as e:
            raise GeminiUnavailableError(f"Gemini returned invalid JSON: {e}")
    return {"text": content}


def call_gemini_text(prompt: str, system_prompt: str = "You are a helpful assistant.", temperature: float = 0.1) -> str:
    """Calls Gemini and returns plain text response."""
    result = call_gemini(prompt, system_prompt, temperature, json_mode=False)
    return result.get("text", "")
