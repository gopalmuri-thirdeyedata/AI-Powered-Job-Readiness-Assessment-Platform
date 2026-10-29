"""
Who is in front of the camera: the rules that replaced "YOLO found no person" (which fired constantly on ordinary laptop-webcam framing).

  1. decide()  - the pure rules, with hand-made boxes;
  2. analyze_frame() - the whole pipeline with fake detectors (phones, books, people, empty frames);
  3. the real ONNX models on webcam-style crops of a known photo (runs when the ultralytics sample images are installed, skipped otherwise).
"""
import io
import os

import numpy as np
import pytest
from PIL import Image

from services import proctor_service as ps

FULL = (0.0, 0.0, 1.0, 1.0)


def face(score, x=0.4, w=0.2):
    return (score, (x, 0.3, x + w, 0.6))


def person(conf, x1, y1, x2, y2):
    return (conf, (x1, y1, x2, y2))


# ------------------------------------------------------------------------------ the rules
def test_a_face_alone_means_someone_is_there():
    count, violations, boxes = ps.decide([], [face(0.9)])
    assert count == 1 and violations == [] and len(boxes) == 1


def test_a_person_alone_means_someone_is_there():
    count, violations, boxes = ps.decide([person(0.8, 0.2, 0.1, 0.8, 0.95)], [])
    assert count == 1 and violations == [] and boxes == [(0.2, 0.1, 0.8, 0.95)]


def test_no_person_only_when_both_detectors_miss():
    assert ps.decide([], []) == (0, ["no_person"], [])
    assert ps.decide([], None)[1] == ["no_person"]                 # no face detector at all: person detection decides alone
    assert ps.decide([], [face(0.5)])[1] == ["no_person"]          # a doubtful face (below 0.60) is not enough
    assert ps.decide([], [face(0.65)])[1] == []


def test_two_clear_faces_are_two_people():
    count, violations, _ = ps.decide([], [face(0.95, x=0.1), face(0.9, x=0.6)])
    assert count == 2 and violations == ["multiple_persons"]


def test_a_doubtful_or_tiny_second_face_is_not_a_second_person():
    assert ps.decide([], [face(0.95, x=0.1), face(0.7, x=0.6)])[1] == []                 # real but not confident enough
    assert ps.decide([], [face(0.95, x=0.1), face(0.9, x=0.7, w=0.04)])[1] == []          # confident but far too small (a poster, a reflection)
    assert ps.decide([], [face(0.95, x=0.4), face(0.9, x=0.42)])[1] == []                 # the same face detected twice


def test_two_large_separate_people_are_flagged_even_if_one_turned_away():
    count, violations, _ = ps.decide([person(0.8, 0.0, 0.1, 0.5, 1.0), person(0.7, 0.55, 0.1, 1.0, 1.0)], [face(0.9, x=0.2)])
    assert count == 2 and violations == ["multiple_persons"]


def test_a_sliver_of_a_second_body_or_a_double_box_is_not_a_second_person():
    one_and_a_sliver = [person(0.9, 0.1, 0.0, 0.9, 1.0), person(0.5, 0.92, 0.6, 1.0, 0.9)]
    assert ps.decide(one_and_a_sliver, [face(0.9)])[1] == []
    double_box = [person(0.9, 0.1, 0.0, 0.9, 1.0), person(0.6, 0.12, 0.02, 0.88, 0.98)]
    assert ps.decide(double_box, [])[1] == []


# ------------------------------------------------------------------------------ the pipeline with fake detectors
class FakeYolo:
    names = ps.COCO_NAMES

    def __init__(self, detections):
        self.detections = detections

    def __call__(self, image, **_kw):
        return list(self.detections)


@pytest.fixture()
def pipeline(monkeypatch):
    """analyze_frame with chosen YOLO detections and chosen faces (no model files involved)."""
    def configure(detections=(), faces=()):
        monkeypatch.setattr(ps, "_model", FakeYolo(detections))
        monkeypatch.setattr(ps, "_face_detector", object())
        monkeypatch.setattr(ps, "_detect_faces", lambda image: list(faces))
        return ps.analyze_frame(Image.new("RGB", (640, 480), "gray"))
    return configure


def test_an_empty_room_is_no_person(pipeline):
    out = pipeline()
    assert out["status"] == "ok" and out["person_count"] == 0 and out["violations"] == ["no_person"]


def test_a_candidate_whose_webcam_shows_only_head_and_shoulders_is_not_flagged(pipeline):
    """The reported bug: YOLO sees no person (too little body), the face detector sees the candidate."""
    out = pipeline(detections=[], faces=[face(0.93)])
    assert out["person_count"] == 1 and out["violations"] == [] and out["face_count"] == 1 and len(out["face_boxes"]) == 1


def test_a_phone_in_view_is_reported_with_its_label(pipeline):
    out = pipeline(detections=[(67, 0.80, (0.6, 0.5, 0.7, 0.7))], faces=[face(0.9)])
    assert "phone_detected" in out["violations"] and "Phone" in out["suspect_label"]
    assert out["detections"][0]["class"] == "cell phone" and out["detections"][0]["bbox"] == [0.6, 0.5, 0.7, 0.7]


def test_a_doubtful_phone_is_ignored(pipeline):
    assert "phone_detected" not in pipeline(detections=[(67, 0.42, (0.6, 0.5, 0.7, 0.7))], faces=[face(0.9)])["violations"]


def test_laptop_and_book_are_reported(pipeline):
    out = pipeline(detections=[(63, 0.7, (0.1, 0.5, 0.5, 0.9)), (73, 0.6, (0.6, 0.5, 0.9, 0.9))], faces=[face(0.9)])
    assert {"device_detected", "notes_detected"} <= set(out["violations"])


def test_two_faces_report_multiple_persons_with_a_label(pipeline):
    out = pipeline(faces=[face(0.95, x=0.1), face(0.9, x=0.6)])
    assert out["person_count"] == 2 and "multiple_persons" in out["violations"] and "Multiple Persons" in out["suspect_label"]


def test_without_a_face_detector_person_detection_still_works(monkeypatch):
    monkeypatch.setattr(ps, "_model", FakeYolo([(0, 0.8, (0.2, 0.1, 0.8, 0.95))]))
    monkeypatch.setattr(ps, "_face_detector", None)
    out = ps.analyze_frame(Image.new("RGB", (640, 480), "gray"))
    assert out["person_count"] == 1 and out["violations"] == [] and out["face_count"] is None


def test_the_response_keeps_the_shape_the_browser_reads(pipeline):
    out = pipeline(detections=[(0, 0.8, (0.2, 0.1, 0.8, 0.95))], faces=[face(0.9)])
    for key in ("status", "violations", "detections", "person_count", "suspect_label", "face_boxes"):
        assert key in out


def test_wide_frames_are_scaled_down_before_analysis(monkeypatch):
    seen = {}

    class Spy(FakeYolo):
        def __call__(self, image, **kw):
            seen["shape"] = image.shape
            return []

    monkeypatch.setattr(ps, "_model", Spy([]))
    monkeypatch.setattr(ps, "_face_detector", None)
    ps.analyze_frame(Image.new("RGB", (1600, 1200), "gray"))
    assert seen["shape"] == (480, 640, 3), "bounded work: nothing wider than MAX_WORK_WIDTH is analysed as sent"


# ------------------------------------------------------------------------------ the real models
def _sample_photo():
    try:
        import ultralytics
        path = os.path.join(os.path.dirname(ultralytics.__file__), "assets", "zidane.jpg")
        return Image.open(path).convert("RGB") if os.path.exists(path) else None
    except Exception:
        return None


PHOTO = _sample_photo()
needs_photo = pytest.mark.skipif(PHOTO is None, reason="needs the ultralytics sample image (zidane.jpg) to build webcam-style crops")
X1, Y1, X2, Y2 = 749, 43, 1148, 711      # the person nearest the camera in that photo (found with YOLO at full resolution)


def webcam_crop(top, bottom):
    """A 640x480 JPEG-compressed 'webcam frame' showing the person from `top` to `bottom` (fractions of their height; 0 = top of the head)."""
    h = Y2 - Y1
    ch = (bottom - top) * h
    cw = ch * 4 / 3
    cx = (X1 + X2) / 2
    box = (max(0, cx - cw / 2), max(0, Y1 + top * h), min(1280, cx + cw / 2), min(720, Y1 + top * h + ch))
    buf = io.BytesIO()
    PHOTO.crop(tuple(int(v) for v in box)).resize((640, 480)).save(buf, "JPEG", quality=60)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


@needs_photo
@pytest.mark.parametrize("framing,top,bottom", [("waist up", -0.05, 0.60), ("chest up (laptop webcam)", -0.05, 0.42), ("head and shoulders", -0.03, 0.30)])
def test_real_models_a_normal_webcam_framing_is_not_flagged(framing, top, bottom):
    """With YOLO alone, the last two framings returned zero people. They must never raise no_person now."""
    out = ps.analyze_frame(webcam_crop(top, bottom))
    assert out["status"] == "ok" and out["person_count"] == 1 and "no_person" not in out["violations"], (framing, out)


@needs_photo
def test_real_models_two_people_in_frame_are_flagged():
    out = ps.analyze_frame(PHOTO.resize((640, 360)))
    assert out["person_count"] == 2 and "multiple_persons" in out["violations"]


@needs_photo
def test_real_models_a_plain_wall_is_no_person():
    wall = Image.fromarray(np.full((480, 640, 3), (200, 195, 190), dtype=np.uint8))
    out = ps.analyze_frame(wall)
    assert out["person_count"] == 0 and out["violations"] == ["no_person"]


def test_real_onnx_model_loads_and_runs_on_a_blank_frame():
    model = ps.get_model()
    assert model is not None and model.names[0] == "person" and model.names[67] == "cell phone"
    assert model(np.zeros((480, 640, 3), dtype=np.uint8), conf=0.4) == []
