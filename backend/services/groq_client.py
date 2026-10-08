import os
import requests
from dotenv import load_dotenv

# Ensure environment variables are loaded
load_dotenv()

def get_groq_api_keys():
    """
    Dynamically loads all configured Groq API keys from the environment.
    Supports primary key and multiple fallback keys.
    """
    # Force reload environment to catch real-time changes
    load_dotenv(override=True)
    
    keys = []
    
    # 1. Primary key
    primary = os.getenv("GROQ_API_KEY")
    if primary:
        keys.append(primary)
        
    # 2. Explicit Fallback keys (e.g. GROQ_API_KEY_FALLBACK_1, GROQ_API_KEY_FALLBACK_2)
    for i in range(1, 10):
        fallback = os.getenv(f"GROQ_API_KEY_FALLBACK_{i}")
        if fallback:
            keys.append(fallback)
            
    # 3. Alternate conventions (e.g. GROQ_API_KEY_2, GROQ_API_KEY_3)
    for i in range(2, 10):
        alt = os.getenv(f"GROQ_API_KEY_{i}")
        if alt:
            keys.append(alt)
            
    # Clean duplicates while preserving order
    seen = set()
    unique_keys = [k for k in keys if k not in seen and not seen.add(k)]
    return unique_keys

def has_groq_key() -> bool:
    """
    Checks if at least one Groq API key is present in the environment.
    """
    return len(get_groq_api_keys()) > 0

def get_groq_model() -> str:
    """
    Returns active Groq model configured in environment, defaulting to openai/gpt-oss-120b.
    """
    load_dotenv(override=True)
    return os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

def execute_groq_request(url: str, payload: dict, timeout: int = 30) -> requests.Response:
    """
    Performs an HTTP POST request to Groq API with robust fallback key rotation.
    Rotates to fallback keys when encountering rate limits (429) or other errors.
    """
    keys = get_groq_api_keys()
    if not keys:
        raise RuntimeError("No Groq API keys configured in the environment.")
        
    # Map unavailable/legacy model names to currently supported Groq model
    active_model = get_groq_model()
    if payload.get("model") in [None, "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "llama3-8b-8192"]:
        payload["model"] = active_model

    last_exception = None
    
    for idx, api_key in enumerate(keys):
        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
            
            # Check for Rate Limit (429) or Server Errors to trigger fallback
            if response.status_code == 429:
                print(f"[WARNING] Groq API Key {idx+1} rate limited. Attempting fallback key...")
                continue
            if response.status_code == 404 and "model" in response.text.lower():
                # Model not supported under this key, fallback to alternative verified model
                alt_model = "qwen/qwen3.8-27b" if payload.get("model") != "qwen/qwen3.8-27b" else "openai/gpt-oss-20b"
                payload["model"] = alt_model
                response = requests.post(url, headers=headers, json=payload, timeout=timeout)
                if response.status_code == 200:
                    return response
            if response.status_code != 200:
                print(f"[WARNING] Groq API Error {response.status_code} with key {idx+1}: {response.text}. Attempting fallback key...")
                continue
                
            return response
        except Exception as e:
            print(f"[ERROR] Groq Request failed with API Key {idx+1}: {e}")
            last_exception = e
            
    if last_exception:
        raise last_exception
    else:
        raise RuntimeError("All configured Groq API keys failed or rate-limited.")

def call_groq_sdk(fn, *args, **kwargs):
    """
    Executes a Groq SDK call (e.g. chat.completions.create) using rotated API keys.
    """
    keys = get_groq_api_keys()
    if not keys:
        raise RuntimeError("No Groq API keys configured in the environment.")
        
    from groq import Groq
    last_exception = None
    
    for idx, api_key in enumerate(keys):
        try:
            client = Groq(api_key=api_key)
            return fn(client, *args, **kwargs)
        except Exception as e:
            # Check for rate-limiting or other API anomalies
            print(f"[ERROR] Groq SDK call failed with API Key {idx+1}: {e}")
            last_exception = e
            
    if last_exception:
        raise last_exception
    else:
        raise RuntimeError("All configured Groq SDK clients failed or rate-limited.")
