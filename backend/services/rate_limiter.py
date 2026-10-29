"""
Small in-process sliding-window rate limiter + concurrency gate for the public assessment endpoints.

Per-process by design (no Redis dependency). With several uvicorn workers the effective limit is
limit x workers; put an nginx `limit_req` in front for a hard global cap. The client key is the direct peer
address, or the proxy-set X-Real-IP when (and only when) the peer is a trusted reverse proxy - see client_ip().
X-Forwarded-For is never trusted here because its left-most values are client controlled.
"""
import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Hashable

_clock = time.monotonic  # indirection for tests


def env_limit(name: str, default: int) -> int:
    """A per-minute limit from the environment; unset, empty, zero or malformed falls back to `default` (nothing changes unless it is set)."""
    try:
        value = int((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default
    return value if value >= 1 else default


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: Dict[Hashable, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: Hashable) -> bool:
        now = _clock()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if not q:
                self._hits.pop(key, None)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


class ConcurrencyGate:
    """Caps simultaneous in-flight operations per key (non-blocking)."""

    def __init__(self, limit: int):
        self.limit = limit
        self._active: Dict[Hashable, int] = defaultdict(int)
        self._lock = threading.Lock()

    def acquire(self, key: Hashable) -> bool:
        with self._lock:
            if self._active[key] >= self.limit:
                return False
            self._active[key] += 1
            return True

    def release(self, key: Hashable):
        with self._lock:
            self._active[key] = max(0, self._active[key] - 1)
            if self._active[key] == 0:
                self._active.pop(key, None)

    def reset(self):
        with self._lock:
            self._active.clear()


# ------------------------------------------------------------------------------
# Client identification behind a reverse proxy
# ------------------------------------------------------------------------------
import ipaddress
import os

_DEFAULT_TRUSTED = "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7"


def _trusted_networks():
    raw = os.getenv("PREPWIN_TRUSTED_PROXIES", _DEFAULT_TRUSTED)
    nets = []
    for part in raw.split(","):
        part = part.strip()
        if part:
            try:
                nets.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                continue
    return nets


def client_ip(request) -> str:
    """
    The rate-limit identity of a caller. The direct peer is used unless it is a trusted reverse proxy
    (private ranges by default, override with PREPWIN_TRUSTED_PROXIES); only then is the proxy-set X-Real-IP honoured.
    nginx overwrites X-Real-IP with $remote_addr, so a client cannot choose its own value; a request that reaches the
    app from an untrusted peer can never spoof it.
    """
    peer = request.client.host if request.client else "unknown"
    try:
        peer_ip = ipaddress.ip_address(peer)
    except ValueError:
        return peer
    if any(peer_ip in net for net in _trusted_networks()):
        real = (request.headers.get("x-real-ip") or "").strip()
        try:
            return str(ipaddress.ip_address(real))
        except ValueError:
            return peer
    return peer
