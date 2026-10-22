"""Proctoring must never freeze the server: a slow frame (or the first-time model load) may not delay other
requests such as submitting a round."""
import asyncio
import sys
import threading
import time
import types

import httpx
import pytest

import routers.proctor as proctor_router
from main import app
from services import proctor_service


def run(coro):
    return asyncio.run(coro)


def test_a_slow_frame_does_not_block_other_requests(monkeypatch):
    """The old endpoint ran the model on the server's main loop, so every request waited behind it."""
    def slow_analyze(_image):
        time.sleep(1.5)
        return {"status": "ok", "violations": [], "detections": [], "person_count": 1, "face_boxes": []}
    monkeypatch.setattr(proctor_router, "analyze_frame", slow_analyze)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # The clock starts before the slow frame does: if the frame blocks the server, the other request
            # cannot even begin until it is finished, and that wait is exactly what is measured.
            began = time.perf_counter()
            frame = asyncio.create_task(client.post("/api/proctor/analyze-frame", json={"image": "x"}))

            async def other_request():
                res = await client.get("/health/live")
                return res.status_code, time.perf_counter() - began

            other = asyncio.create_task(other_request())
            other_status, other_done = await other
            frame_result = await frame
            return other_status, other_done, frame_result.status_code

    other_status, other_took, frame_status = run(scenario())
    assert frame_status == 200
    assert other_status == 200
    assert other_took < 0.6, f"another request waited {other_took:.2f}s behind the frame"


def test_status_check_answers_instantly_while_the_model_is_still_loading(monkeypatch):
    monkeypatch.setattr(proctor_service, "_model", None)
    monkeypatch.setattr(proctor_service, "_load_state", "unloaded")
    monkeypatch.setattr(proctor_service, "start_warm_up_in_background", lambda: None)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            started = time.perf_counter()
            res = await client.get("/api/proctor/status")
            return res.status_code, res.json(), time.perf_counter() - started

    code, body, took = run(scenario())
    assert code == 200 and body["status"] == "loading"
    assert took < 0.5
    assert "person" in body["classes_supported"]


def test_status_reports_ready_error_and_loading_correctly(monkeypatch):
    monkeypatch.setattr(proctor_service, "start_warm_up_in_background", lambda: None)
    monkeypatch.setattr(proctor_service, "_model", object())
    assert proctor_service.get_model_status(block=False)["status"] == "ready"
    monkeypatch.setattr(proctor_service, "_model", None)
    monkeypatch.setattr(proctor_service, "_load_state", "error")
    assert proctor_service.get_model_status(block=False)["status"] == "error"
    monkeypatch.setattr(proctor_service, "_load_state", "loading")
    assert proctor_service.get_model_status(block=False)["status"] == "loading"


def test_the_model_is_loaded_exactly_once_even_when_frames_arrive_together(monkeypatch):
    loads = []

    class FakeYolo:
        def __init__(self, path):
            time.sleep(0.3)  # a slow load
            loads.append(path)

        def __call__(self, *args, **kwargs):
            return []

    fake_module = types.ModuleType("ultralytics")
    fake_module.YOLO = FakeYolo
    monkeypatch.setitem(sys.modules, "ultralytics", fake_module)
    monkeypatch.setattr(proctor_service, "_model", None)
    monkeypatch.setattr(proctor_service, "_load_state", "unloaded")

    results = []
    threads = [threading.Thread(target=lambda: results.append(proctor_service.get_model())) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]

    assert len(loads) == 1, "six simultaneous frames must not load the model six times"
    assert len(results) == 6 and all(r is results[0] and r is not None for r in results)
    assert proctor_service._load_state == "ready"


def test_a_failed_load_is_reported_and_does_not_crash(monkeypatch):
    class BrokenYolo:
        def __init__(self, path):
            raise RuntimeError("weights missing")

    fake_module = types.ModuleType("ultralytics")
    fake_module.YOLO = BrokenYolo
    monkeypatch.setitem(sys.modules, "ultralytics", fake_module)
    monkeypatch.setattr(proctor_service, "_model", None)
    monkeypatch.setattr(proctor_service, "_load_state", "unloaded")
    assert proctor_service.get_model() is None
    assert proctor_service._load_state == "error"
    assert proctor_service.get_model_status(block=False)["status"] == "error"
    result = proctor_service.analyze_frame("data:image/jpeg;base64,AAAA")
    assert result["status"] == "error" and result["person_count"] == -1


def test_warm_up_runs_one_throwaway_inference(monkeypatch):
    calls = []

    class FakeModel:
        def __call__(self, image, **kwargs):
            calls.append(image.shape)
            return []

    monkeypatch.setattr(proctor_service, "_model", FakeModel())
    monkeypatch.setattr(proctor_service, "_load_state", "ready")
    assert proctor_service.warm_up() is True
    assert calls == [(240, 320, 3)]


def test_warm_up_starts_once_in_the_background_and_returns_immediately(monkeypatch):
    started = []
    release = threading.Event()

    def fake_warm_up():
        started.append(1)
        release.wait(2)

    monkeypatch.setattr(proctor_service, "_model", None)
    monkeypatch.setattr(proctor_service, "_warmup_thread", None)
    monkeypatch.setattr(proctor_service, "warm_up", fake_warm_up)
    t = time.perf_counter()
    proctor_service.start_warm_up_in_background()
    proctor_service.start_warm_up_in_background()
    proctor_service.start_warm_up_in_background()
    assert time.perf_counter() - t < 0.3, "start-up must not wait for the model"
    time.sleep(0.1)
    assert started == [1], "only one warm-up thread may run"
    release.set()


def test_the_server_triggers_the_warm_up_when_it_starts():
    import main
    source = open(main.__file__, encoding="utf-8").read()
    assert "start_warm_up_in_background" in source
    assert '@app.on_event("startup")\ndef warm_up_proctoring_model' in source


def test_frame_inference_is_serialised(monkeypatch):
    """Two frames at once must not both run the model, which would double the CPU load and the latency."""
    active, peak = [0], [0]
    lock = threading.Lock()

    class FakeModel:
        names = {0: "person"}

        def __call__(self, *args, **kwargs):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            time.sleep(0.15)
            with lock:
                active[0] -= 1
            return []

    monkeypatch.setattr(proctor_service, "_model", FakeModel())
    monkeypatch.setattr(proctor_service, "_load_state", "ready")
    import base64
    import io

    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), (10, 10, 10)).save(buf, format="JPEG")
    frame = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

    threads = [threading.Thread(target=proctor_service.analyze_frame, args=(frame,)) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert peak[0] == 1
