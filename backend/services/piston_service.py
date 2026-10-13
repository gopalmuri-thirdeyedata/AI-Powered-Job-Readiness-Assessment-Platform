
import os
import requests

# NOTE: filename is historical. This is the Judge0 CE adapter (no Piston calls are made).
# The endpoint is configurable via JUDGE0_API_URL; hosting topology is a deferred decision.
DEFAULT_API_URL = "https://ce.judge0.com/submissions"

# Language Mapping (Frontend/Internal -> Judge0 language_id)
# RoleReady assessments and student practice enforce Python only at their own layers;
# other entries remain for the recruiter-managed assessment flows.
LANGUAGE_MAP = {
    "javascript": {"language_id": 63},
    "python": {"language_id": 71},
    "python3": {"language_id": 71},
    "java": {"language_id": 62},
    "cpp": {"language_id": 54},
    "c": {"language_id": 50},
    "go": {"language_id": 60}
}

# Sandbox limits sent with every submission
CPU_TIME_LIMIT_SECONDS = 5
WALL_TIME_LIMIT_SECONDS = 10
MEMORY_LIMIT_KB = 128000
MAX_SOURCE_BYTES = 64 * 1024
MAX_OUTPUT_CHARS = 10 * 1024
REQUEST_TIMEOUT_SECONDS = 30

TIMEOUT_MESSAGE = f"Execution Timed Out ({CPU_TIME_LIMIT_SECONDS:.1f}s)"


def normalize_output(text) -> str:
    """
    Output normalization policy used for every test-case comparison:
    CRLF/CR -> LF, trailing whitespace removed from each line, leading/trailing blank lines removed.
    Case, internal spacing, and line order/count are significant.
    """
    lines = str(text if text is not None else "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip("\n")


def outputs_match(actual, expected) -> bool:
    """Exact comparison of normalized outputs (no substring/prefix matching)."""
    return normalize_output(actual) == normalize_output(expected)


def _clip(text: str) -> str:
    return text[:MAX_OUTPUT_CHARS]


def _time_ms(result: dict):
    try:
        return round(float(result.get("time")) * 1000, 1)
    except (TypeError, ValueError):
        return None


def execute_code(language_key: str, code: str, stdin: str = ""):
    """
    Executes code using Judge0 CE API.

    Returns a dict with status in {"success", "failed", "error", "service_error"} and an `output`
    string, plus `stdout`, `stderr`, `compile_output`, `timed_out` and `execution_time_ms`.
    `service_error` means the sandbox itself was unreachable/failed (not a candidate error).
    """
    config = LANGUAGE_MAP.get(language_key)
    if not config:
        return {"error": f"Unsupported language: {language_key}"}

    if len((code or "").encode("utf-8")) > MAX_SOURCE_BYTES:
        return {
            "status": "error",
            "output": "Source code exceeds the 64 KB limit.",
            "stdout": "", "stderr": "Source code exceeds the 64 KB limit.", "compile_output": "",
            "timed_out": False, "execution_time_ms": None, "raw": {}
        }

    api_url = os.getenv("JUDGE0_API_URL", DEFAULT_API_URL)

    headers = {
        "Content-Type": "application/json"
    }

    payload = {
        "source_code": code,
        "language_id": config["language_id"],
        "stdin": stdin or "",
        "cpu_time_limit": CPU_TIME_LIMIT_SECONDS,
        "wall_time_limit": WALL_TIME_LIMIT_SECONDS,
        "memory_limit": MEMORY_LIMIT_KB
    }

    print(f"[Judge0] Executing language_id={config['language_id']} on {api_url}")

    try:
        # Synchronous execution: wait=true returns result directly
        response = requests.post(
            f"{api_url}?wait=true",
            json=payload,
            headers=headers,
            timeout=REQUEST_TIMEOUT_SECONDS
        )
        response.raise_for_status()
        result = response.json()

        stdout = _clip(result.get("stdout") or "")
        stderr = _clip(result.get("stderr") or "")
        compile_output = _clip(result.get("compile_output") or "")

        status_obj = result.get("status", {})
        status_id = status_obj.get("id", 0)
        status_desc = status_obj.get("description", "Unknown")

        print(f"[Judge0] Status: {status_id} - {status_desc}")

        common = {
            "stdout": stdout,
            "stderr": stderr,
            "compile_output": compile_output,
            "execution_time_ms": _time_ms(result),
            "raw": result,
        }

        # Status 6 = Compilation Error
        if status_id == 6:
            return {
                "status": "error",
                "output": compile_output or "Compilation Failed",
                "timed_out": False,
                **common
            }

        # Status 5 = Time Limit Exceeded
        if status_id == 5:
            return {
                "status": "failed",
                "output": TIMEOUT_MESSAGE,
                "timed_out": True,
                **common
            }

        # Status 7-12 = Runtime Errors
        if 7 <= status_id <= 12:
            return {
                "status": "failed",
                "output": stderr or stdout or status_desc,
                "timed_out": False,
                **common
            }

        # Status 3 = Accepted, Status 4 = Wrong Answer
        if status_id in (3, 4):
            return {
                "status": "success",
                "output": stdout or stderr,
                "timed_out": False,
                **common
            }

        # Fallback: queue states, internal error (13), exec format error (14), unknown
        return {
            "status": "service_error",
            "output": f"Judge0 status: {status_desc}. {stderr or compile_output or stdout}",
            "timed_out": False,
            **common
        }

    except requests.HTTPError as e:
        resp = e.response
        response_text = ""
        if resp is not None:
            try:
                response_text = resp.text.strip()
            except Exception:
                response_text = ""

        message = f"Judge0 API returned HTTP {resp.status_code if resp else 'unknown'}"
        if response_text:
            message = f"{message}: {response_text[:300]}"

        print(f"[Judge0] Execution Error: {message}")
        return {
            "status": "service_error",
            "output": message,
            "stdout": "", "stderr": "", "compile_output": "", "timed_out": False, "execution_time_ms": None,
            "raw": {"status_code": resp.status_code if resp else None, "body": response_text},
        }
    except Exception as e:
        print(f"[Judge0] Execution Error: {e}")
        return {
            "status": "service_error",
            "output": str(e),
            "stdout": "", "stderr": "", "compile_output": "", "timed_out": False, "execution_time_ms": None,
            "raw": {}
        }
