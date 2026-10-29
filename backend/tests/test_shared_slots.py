"""Machine-wide voice slots: many worker processes share one plan limit, and a worker that dies gives its slot back."""
import multiprocessing as mp
import os
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import shared_slots                                                                  # noqa: E402

pytestmark = pytest.mark.skipif(shared_slots.fcntl is None, reason="file locks need a POSIX machine (the production container)")


class Busy(Exception):
    pass


def _worker(directory, slots, hold, wait, out):
    line = shared_slots.SharedLine("t", slots, directory)
    started = time.time()
    try:
        with line.slot(wait, Busy):
            got = time.time()
            time.sleep(hold)
            out.put(("ok", got, time.time()))
    except Busy:
        out.put(("busy", started, time.time()))


def _run(directory, slots, workers, hold, wait):
    out = mp.Queue()
    procs = [mp.Process(target=_worker, args=(directory, slots, hold, wait, out)) for _ in range(workers)]
    [p.start() for p in procs]
    results = [out.get(timeout=30) for _ in procs]
    [p.join() for p in procs]
    return results


def _max_overlap(results):
    events = sorted([(r[1], 1) for r in results if r[0] == "ok"] + [(r[2], -1) for r in results if r[0] == "ok"], key=lambda e: (e[0], e[1]))
    now = peak = 0
    for _, d in events:
        now += d
        peak = max(peak, now)
    return peak


def test_twelve_processes_never_use_more_than_the_shared_limit_and_all_get_through():
    with tempfile.TemporaryDirectory() as directory:
        results = _run(directory, slots=6, workers=12, hold=0.3, wait=10)
        assert all(r[0] == "ok" for r in results)
        assert _max_overlap(results) <= 6
        assert _max_overlap(results) >= 5                         # and the limit really is used, not one by one


def test_a_request_gives_up_with_the_busy_error_when_the_wait_runs_out():
    with tempfile.TemporaryDirectory() as directory:
        results = _run(directory, slots=1, workers=3, hold=1.0, wait=0.2)
        kinds = sorted(r[0] for r in results)
        assert kinds == ["busy", "busy", "ok"]


def _hold_forever(directory, ready):
    line = shared_slots.SharedLine("t", 1, directory)
    with line.slot(5, Busy):
        ready.put("held")
        time.sleep(60)


def test_a_slot_held_by_a_worker_that_dies_is_given_back():
    with tempfile.TemporaryDirectory() as directory:
        ready = mp.Queue()
        victim = mp.Process(target=_hold_forever, args=(directory, ready))
        victim.start()
        assert ready.get(timeout=10) == "held"
        line = shared_slots.SharedLine("t", 1, directory)
        with pytest.raises(Busy):
            with line.slot(0.1, Busy):
                pass                                                # taken: the dead-to-be worker holds it
        victim.kill()
        victim.join()
        with line.slot(2, Busy):                                    # the operating system released the lock with the process
            pass


def test_the_line_reports_itself_unavailable_when_its_folder_cannot_be_created(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    line = shared_slots.SharedLine("t", 2, str(blocker / "sub"))
    assert line.available is False
