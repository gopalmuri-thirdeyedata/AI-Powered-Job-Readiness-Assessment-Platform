"""
Local (self-hosted) authentication primitives: password policy, login abuse protection, server-side sessions and cookies.

Design
  * The credential of a browser login is an opaque random value in an HttpOnly cookie. Only its SHA-256 is stored
    (models.AuthSession), so logout / password change / deactivation are real, immediate revocations and a database leak
    does not leak usable sessions. Nothing about the session is readable by page JavaScript.
  * Cookie-authenticated state-changing requests must also present the per-session CSRF token (X-CSRF-Token). SameSite=Lax is
    the first line of defence, the token the second.
  * Login failures are rate limited per (email, client) pair, per client and per email. The trackers are per-process (like
    services.rate_limiter); with several workers the effective limit is limit x workers, so keep nginx limit_req in front.
"""
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Deque, Dict, Optional, Tuple

from fastapi import Response
from sqlalchemy.orm import Session

import models

SESSION_COOKIE = "prepwin_session"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_BYTES = 72  # bcrypt only hashes the first 72 bytes; longer secrets would be silently truncated

_COMMON_PASSWORDS = frozenset({
    "password", "password1", "password12", "password123", "passw0rd123", "1234567890", "12345678910", "qwertyuiop",
    "qwerty12345", "iloveyou123", "welcome123", "welcome1234", "admin12345", "letmein1234", "changeme123", "abcd123456",
})


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, "").strip() or default))
    except ValueError:
        return default


def session_ttl() -> timedelta:
    """Absolute lifetime of a login (default 12 h)."""
    return timedelta(hours=_env_int("SESSION_TTL_HOURS", 12))


def session_idle_timeout() -> timedelta:
    """A session unused for this long is dead even before its absolute expiry (default 120 min)."""
    return timedelta(minutes=_env_int("SESSION_IDLE_MINUTES", 120))


def utcnow() -> datetime:
    return datetime.utcnow()


# ------------------------------------------------------------------------------
# Email / phone / password validation
# ------------------------------------------------------------------------------
def normalize_email(raw: Optional[str]) -> str:
    return (raw or "").strip().lower()


_PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()\-.]{5,19}$")


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Optional field: blank -> None. Raises ValueError for something that is not a plausible phone number."""
    value = (raw or "").strip()
    if not value:
        return None
    if not _PHONE_RE.match(value) or not 7 <= sum(ch.isdigit() for ch in value) <= 15:
        raise ValueError("Mobile number must contain 7 to 15 digits (an optional leading + and spaces, dashes or brackets are allowed).")
    return value


def password_policy_errors(password: Optional[str], email: Optional[str] = None) -> list:
    """Human-readable policy violations; empty list = acceptable. Never includes the password itself."""
    errors = []
    pw = password or ""
    if len(pw) < PASSWORD_MIN_LENGTH:
        errors.append(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long.")
    if len(pw.encode("utf-8")) > PASSWORD_MAX_BYTES:
        errors.append(f"Password must be at most {PASSWORD_MAX_BYTES} bytes long.")
    if pw and pw != pw.strip():
        errors.append("Password must not start or end with whitespace.")
    if not re.search(r"[a-z]", pw):
        errors.append("Password must contain a lowercase letter.")
    if not re.search(r"[A-Z]", pw):
        errors.append("Password must contain an uppercase letter.")
    if not re.search(r"[0-9]", pw):
        errors.append("Password must contain a digit.")
    lowered = pw.lower()
    if lowered in _COMMON_PASSWORDS:
        errors.append("Password is too common.")
    local_part = normalize_email(email).split("@")[0]
    if local_part and len(local_part) >= 4 and local_part in lowered:
        errors.append("Password must not contain the e-mail address name.")
    return errors


# ------------------------------------------------------------------------------
# Login abuse protection
# ------------------------------------------------------------------------------
class LoginAttemptTracker:
    """Counts FAILED logins in a sliding window. A bucket at its limit is blocked until its oldest failure ages out."""

    MAX_TRACKED_KEYS = 20000

    def __init__(self, window_seconds: float = 900.0, pair_limit: int = 5, ip_limit: int = 30, email_limit: int = 15):
        self.window = window_seconds
        self.pair_limit, self.ip_limit, self.email_limit = pair_limit, ip_limit, email_limit
        self._failures: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._clock = time.monotonic

    def _keys(self, email: str, ip: str):
        return [(("pair", f"{email}|{ip}"), self.pair_limit), (("ip", ip), self.ip_limit), (("email", email), self.email_limit)]

    def _trim(self, q: Deque[float], now: float):
        while q and now - q[0] >= self.window:
            q.popleft()

    def retry_after(self, email: str, ip: str) -> int:
        """Seconds the caller must wait; 0 = allowed to attempt."""
        now = self._clock()
        wait = 0.0
        with self._lock:
            for key, limit in self._keys(email, ip):
                q = self._failures.get(key)
                if not q:
                    continue
                self._trim(q, now)
                if not q:
                    self._failures.pop(key, None)
                elif len(q) >= limit:
                    wait = max(wait, self.window - (now - q[0]))
        return int(wait) + 1 if wait > 0 else 0

    def record_failure(self, email: str, ip: str):
        now = self._clock()
        with self._lock:
            if len(self._failures) > self.MAX_TRACKED_KEYS:      # bounded memory: spraying random e-mails cannot grow this forever
                for key in [k for k, q in self._failures.items() if not q or now - q[-1] >= self.window]:
                    del self._failures[key]
            for key, _limit in self._keys(email, ip):
                self._failures[key].append(now)

    def record_success(self, email: str, ip: str):
        """A correct password clears the (email, client) pair; the client-wide and email-wide counters keep ageing out."""
        with self._lock:
            self._failures.pop(("pair", f"{email}|{ip}"), None)

    def reset(self):
        with self._lock:
            self._failures.clear()


login_tracker = LoginAttemptTracker()


# ------------------------------------------------------------------------------
# Server-side sessions
# ------------------------------------------------------------------------------
def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_session(db: Session, user: models.User, ip: Optional[str] = None, user_agent: Optional[str] = None) -> Tuple[str, models.AuthSession]:
    """Creates a brand-new session (fresh identifier, fresh CSRF token). Returns (raw cookie value, row). Caller commits."""
    raw = secrets.token_urlsafe(32)
    now = utcnow()
    row = models.AuthSession(
        token_hash=_hash_token(raw),
        user_id=user.id,
        csrf_token=secrets.token_urlsafe(24),
        created_at=now,
        last_seen_at=now,
        expires_at=now + session_ttl(),
        ip_address=(ip or "")[:64] or None,
        user_agent=(user_agent or "")[:255] or None,
    )
    db.add(row)
    return raw, row


def resolve_session(db: Session, raw: Optional[str]) -> Optional[Tuple[models.AuthSession, models.User]]:
    """The live (session, user) behind a cookie value, or None. Expired/revoked/idle sessions and inactive users never resolve."""
    if not raw or len(raw) > 200:
        return None
    row = db.query(models.AuthSession).filter(models.AuthSession.token_hash == _hash_token(raw)).first()
    if row is None or row.revoked_at is not None:
        return None
    now = utcnow()
    if row.expires_at <= now or now - row.last_seen_at > session_idle_timeout():
        return None
    user = db.query(models.User).filter(models.User.id == row.user_id).first()
    if user is None or user.is_active is False:
        return None
    if now - row.last_seen_at > timedelta(seconds=60):  # sliding idle window without a write on every request
        row.last_seen_at = now
        db.commit()
    return row, user


def csrf_matches(session_row: models.AuthSession, presented: Optional[str]) -> bool:
    return bool(presented) and hmac.compare_digest(str(presented), session_row.csrf_token)


def revoke_session(db: Session, session_row: Optional[models.AuthSession]):
    if session_row is not None and session_row.revoked_at is None:
        session_row.revoked_at = utcnow()


def revoke_user_sessions(db: Session, user_id: int, except_session_id: Optional[int] = None) -> int:
    """Revokes every live session of a user (password change/reset, deactivation). Caller commits."""
    query = db.query(models.AuthSession).filter(models.AuthSession.user_id == user_id, models.AuthSession.revoked_at.is_(None))
    if except_session_id is not None:
        query = query.filter(models.AuthSession.id != except_session_id)
    count = 0
    now = utcnow()
    for row in query.all():
        row.revoked_at = now
        count += 1
    return count


def purge_dead_sessions(db: Session, older_than_days: int = 30) -> int:
    """Housekeeping: deletes sessions that expired or were revoked more than N days ago."""
    cutoff = utcnow() - timedelta(days=older_than_days)
    deleted = db.query(models.AuthSession).filter(
        (models.AuthSession.expires_at < cutoff) | (models.AuthSession.revoked_at < cutoff)
    ).delete(synchronize_session=False)
    db.commit()
    return deleted


# ------------------------------------------------------------------------------
# Cookies
# ------------------------------------------------------------------------------
def _cookie_secure() -> bool:
    override = os.getenv("SESSION_COOKIE_SECURE", "").strip().lower()
    if override in ("1", "true", "yes"):
        return True
    if override in ("0", "false", "no"):
        return False
    import utils
    return utils.is_production()


def _cookie_samesite() -> str:
    value = os.getenv("SESSION_COOKIE_SAMESITE", "lax").strip().lower()
    return value if value in ("lax", "strict", "none") else "lax"


def set_session_cookie(response: Response, raw: str):
    secure = _cookie_secure()
    samesite = _cookie_samesite()
    response.set_cookie(
        SESSION_COOKIE, raw,
        max_age=int(session_ttl().total_seconds()), httponly=True,
        secure=secure or samesite == "none",  # browsers reject SameSite=None without Secure
        samesite=samesite, path="/",
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=_cookie_secure(), samesite=_cookie_samesite())
