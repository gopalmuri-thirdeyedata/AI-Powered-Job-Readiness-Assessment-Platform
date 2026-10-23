"""
Gemini AI Client — single centralized LLM entry point for the platform.

* Official `google-generativeai` SDK when installed, native `httpx` REST otherwise.
* 3 retries with exponential backoff (1s, 2s, 4s) and a 30s request timeout.
* Offline deterministic mock mode (`GEMINI_MOCK_MODE=true`) for keyless dev/tests.
* No third-party LLM fallback: a missing key raises `GeminiUnavailableError`
  (a RuntimeError) so callers fall back to their own deterministic content.
"""
import json
import logging
import os
import re
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

logger = logging.getLogger("prepwin.gemini")

# Failure kinds (GeminiUnavailableError.kind). Callers use them to decide whether a retry can help and what to tell the user.
KIND_UNAVAILABLE = "unavailable"        # unknown / generic (retryable)
KIND_NOT_CONFIGURED = "not_configured"  # no API key
KIND_AUTH = "auth"                      # key rejected (invalid, expired, no permission)
KIND_QUOTA = "quota"                    # prepaid credits depleted / quota exhausted / billing
KIND_RATE_LIMIT = "rate_limit"          # too many requests per minute
KIND_MODEL = "model"                    # model name unknown / not available to this key
KIND_INVALID_REQUEST = "invalid_request"
KIND_TIMEOUT = "timeout"
KIND_NETWORK = "network"
KIND_SERVICE = "service"                # Gemini 5xx
KIND_BLOCKED = "blocked"                # empty or safety-blocked response
KIND_INVALID_OUTPUT = "invalid_output"  # response was not valid JSON
NON_RETRYABLE_KINDS = frozenset({KIND_NOT_CONFIGURED, KIND_AUTH, KIND_QUOTA, KIND_MODEL, KIND_INVALID_REQUEST})


class GeminiUnavailableError(RuntimeError):
    """
    Raised when Gemini cannot be used (no key configured, or the call failed).
    `kind` classifies the failure, `http_status` / `provider_status` carry what Gemini answered. The message is sanitised
    (no key material, no prompt text) and is safe to write to server logs; it is NOT meant to be shown to end users verbatim.
    """

    def __init__(self, message: str = "", kind: str = KIND_UNAVAILABLE, http_status: Optional[int] = None, provider_status: Optional[str] = None):
        super().__init__(message)
        self.kind = kind
        self.http_status = http_status
        self.provider_status = provider_status

    @property
    def retryable(self) -> bool:
        return self.kind not in NON_RETRYABLE_KINDS


def _redact(text: str) -> str:
    """Strip anything key-like from provider text before it is logged or stored in an exception."""
    text = str(text or "")
    key = os.getenv("GEMINI_API_KEY") or ""
    if key:
        text = text.replace(key, "<redacted>")
    return re.sub(r"AIza[0-9A-Za-z_\-]{16,}", "<redacted>", text)[:400]


def _classify_http_error(status: int, body_text: str) -> GeminiUnavailableError:
    """Turn a non-200 Gemini REST answer into a classified error (what Google actually said, not just the status code)."""
    provider_status, message = None, ""
    try:
        err = (json.loads(body_text or "{}") or {}).get("error") or {}
        provider_status, message = err.get("status"), str(err.get("message") or "")
    except (ValueError, AttributeError):
        message = body_text or ""
    low = message.lower()
    if status == 402 or "prepayment" in low or "credits are depleted" in low:
        kind = KIND_QUOTA
    elif status == 429:
        # 429 is either a per-minute rate limit (a retry later helps) or an exhausted daily quota / prepaid balance (it does not)
        kind = KIND_QUOTA if ("per day" in low or "daily" in low or "prepay" in low or "credit" in low) else KIND_RATE_LIMIT
    elif status in (401, 403) or "api key not valid" in low or "api_key_invalid" in low or provider_status in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
        kind = KIND_AUTH
    elif status == 404 or ("model" in low and ("not found" in low or "not supported" in low or "is not available" in low)):
        kind = KIND_MODEL
    elif status == 400:
        kind = KIND_AUTH if "api key" in low else KIND_INVALID_REQUEST
    elif status >= 500:
        kind = KIND_SERVICE
    else:
        kind = KIND_UNAVAILABLE
    text = f"Gemini API returned HTTP {status}" + (f" {provider_status}" if provider_status else "") + (f": {_redact(message)}" if message else "")
    return GeminiUnavailableError(text, kind=kind, http_status=status, provider_status=provider_status)


def _log_failure(error: GeminiUnavailableError, context: str = "") -> None:
    """Server-side diagnostics for every failed Gemini call: kind, HTTP status, provider status, model (never keys or prompts)."""
    logger.warning("Gemini call failed%s: kind=%s http_status=%s provider_status=%s model=%s detail=%s",
                   f" [{context}]" if context else "", error.kind, error.http_status, error.provider_status, get_model_name(), _redact(str(error)))


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
    """A retryable failure (429, 5xx, timeout, transport). `error` is the classified error raised if the retry also fails."""

    def __init__(self, message: str = "", error: Optional["GeminiUnavailableError"] = None):
        super().__init__(message)
        self.error = error


def _generate_via_sdk(genai, api_key, prompt, system_prompt, temperature, json_mode, timeout=REQUEST_TIMEOUT_SECONDS) -> str:
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
        response = model.generate_content(prompt, request_options={"timeout": timeout})
        return response.text
    except Exception as e:
        err_msg = str(e).lower()
        if any(term in err_msg for term in ["402", "prepayment", "credits are depleted"]):
            raise GeminiUnavailableError(_redact(str(e)), kind=KIND_QUOTA, http_status=402)
        if any(term in err_msg for term in ["api key not valid", "api_key_invalid", "permission", "401", "403"]):
            raise GeminiUnavailableError(_redact(str(e)), kind=KIND_AUTH)
        if any(term in err_msg for term in ["429", "500", "502", "503", "504", "deadline", "timeout", "resourceexhausted"]):
            raise _TransientGeminiError(_redact(str(e)), GeminiUnavailableError(_redact(str(e)), kind=KIND_TIMEOUT if "timeout" in err_msg or "deadline" in err_msg else KIND_SERVICE))
        raise GeminiUnavailableError(_redact(str(e)))


def _generate_via_rest(api_key, prompt, system_prompt, temperature, json_mode, timeout=REQUEST_TIMEOUT_SECONDS) -> str:
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
            timeout=timeout,
        )
    except httpx.TimeoutException as e:
        raise _TransientGeminiError(str(e), GeminiUnavailableError(f"Gemini request timed out after {timeout}s", kind=KIND_TIMEOUT))
    except httpx.TransportError as e:
        raise _TransientGeminiError(str(e), GeminiUnavailableError(f"Could not reach Gemini ({type(e).__name__})", kind=KIND_NETWORK))
    if resp.status_code != 200:
        error = _classify_http_error(resp.status_code, resp.text)
        # Only rate limits and server errors are worth one more try; a depleted balance, bad key or bad model never recovers by retrying.
        if error.kind == KIND_RATE_LIMIT or error.kind == KIND_SERVICE:
            raise _TransientGeminiError(str(error), error)
        raise error
    try:
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError, ValueError):
        block = ""
        try:
            block = (data.get("promptFeedback") or {}).get("blockReason") or (data.get("candidates") or [{}])[0].get("finishReason") or ""
        except Exception:
            pass
        raise GeminiUnavailableError("Gemini API returned an empty or blocked response" + (f" ({block})" if block else ""), kind=KIND_BLOCKED)


def _generate(prompt, system_prompt, temperature, json_mode, timeout=REQUEST_TIMEOUT_SECONDS) -> str:
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
                return _generate_via_sdk(genai, api_key, prompt, system_prompt, temperature, json_mode, timeout)
            return _generate_via_rest(api_key, prompt, system_prompt, temperature, json_mode, timeout)
        except GeminiUnavailableError:
            raise
        except _TransientGeminiError as e:
            last_error = e
            if attempt < len(RETRY_BACKOFF_SECONDS):
                _sleep(RETRY_BACKOFF_SECONDS[attempt])
        except Exception as e:
            # Non-retryable error: fail fast so deterministic fallback kicks in immediately
            raise GeminiUnavailableError(f"Gemini request failed: {_redact(e)}")
    classified = getattr(last_error, "error", None)
    if classified is not None:
        raise GeminiUnavailableError(f"{classified} (after retry)", kind=classified.kind, http_status=classified.http_status, provider_status=classified.provider_status)
    raise GeminiUnavailableError(f"Gemini request failed after retries: {_redact(last_error)}")


def call_gemini(prompt: str, system_prompt: str = "You are a helpful assistant.", temperature: float = 0.1, json_mode: bool = True,
                timeout: Optional[float] = None) -> dict:
    """
    Calls Gemini and returns a parsed JSON dict (json_mode) or {"text": ...}.
    Raises GeminiUnavailableError (with `.kind`) when no key is configured or the call fails; every failure is logged server side.
    `timeout` overrides the default 30s request timeout for unusually large generations.
    """
    if is_mock_mode_enabled():
        from . import gemini_mock_fixtures
        return gemini_mock_fixtures.get_mock_response(prompt, json_mode)

    if not has_gemini_key():
        error = GeminiUnavailableError("GEMINI_API_KEY is not configured. Safe error; session state preserved.", kind=KIND_NOT_CONFIGURED)
        _log_failure(error)
        raise error

    try:
        extra = {} if timeout is None else {"timeout": timeout}
        content = _generate(prompt, system_prompt, temperature, json_mode, **extra).strip()
    except GeminiUnavailableError as error:
        _log_failure(error)
        raise
    if json_mode:
        try:
            return json.loads(_clean_json_text(content), strict=False)
        except json.JSONDecodeError as e:
            error = GeminiUnavailableError(f"Gemini returned invalid JSON: {e}", kind=KIND_INVALID_OUTPUT)
            _log_failure(error)
            raise error
    return {"text": content}


def call_gemini_text(prompt: str, system_prompt: str = "You are a helpful assistant.", temperature: float = 0.1) -> str:
    """Calls Gemini and returns plain text response."""
    result = call_gemini(prompt, system_prompt, temperature, json_mode=False)
    return result.get("text", "")
