"""
A waiting line whose slots are shared by every worker process on this machine.

ElevenLabs allows only a few simultaneous requests per plan (Starter: 6 text-to-speech, 12 speech-to-text). The backend runs several worker
processes; giving each its own fixed share wastes slots whenever the candidates are spread unevenly (one worker busy, another idle). Here the
slots are small lock files: a request takes any free one, so the whole plan limit is used wherever the candidates happen to be.

Locks are operating-system file locks (fcntl.flock), so they are released automatically if a worker dies and need no extra service or package.
Where file locks are unavailable (Windows development machines) or the folder cannot be created, `SharedLine.available` is False and the caller
keeps its ordinary per-worker line.
"""
import logging
import os
import tempfile
import time
from contextlib import contextmanager
from typing import Optional

logger = logging.getLogger(__name__)

try:                                    # POSIX only
    import fcntl
except ImportError:                     # pragma: no cover - exercised on Windows
    fcntl = None

POLL_SECONDS = 0.02


class SharedLine:
    def __init__(self, name: str, slots: int, directory: Optional[str] = None):
        self.name = name
        self.slots = max(1, int(slots))
        self.directory = directory or os.path.join(tempfile.gettempdir(), f"prepwin-slots-{os.getuid() if hasattr(os, 'getuid') else 'user'}")
        self.available = False
        if fcntl is None:
            return
        try:
            os.makedirs(self.directory, exist_ok=True)
            self._paths = [os.path.join(self.directory, f"{name}-{i}.lock") for i in range(self.slots)]
            for path in self._paths:                       # create them now so a failure shows up here, not in the middle of a candidate's turn
                os.close(os.open(path, os.O_CREAT | os.O_RDWR, 0o600))
            self.available = True
        except OSError as exc:
            logger.warning("shared voice slots unavailable (%s): using per-worker lines", type(exc).__name__)

    def _try_take(self) -> Optional[int]:
        for path in self._paths:
            fd = os.open(path, os.O_RDWR)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return fd
            except OSError:
                os.close(fd)
        return None

    @contextmanager
    def slot(self, max_wait_seconds: float, busy):
        """Wait (bounded) for any free slot of the machine, hold it for the body, release it. `busy(message)` builds the exception for a timeout."""
        deadline = time.monotonic() + max(0.0, max_wait_seconds)
        fd = self._try_take()
        while fd is None:
            if time.monotonic() >= deadline:
                raise busy("The voice service is busy right now. Please try again in a moment.")
            time.sleep(POLL_SECONDS)
            fd = self._try_take()
        try:
            yield
        finally:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
