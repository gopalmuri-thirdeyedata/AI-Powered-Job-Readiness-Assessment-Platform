"""
Proctoring frame analysis: ONNX Runtime object detection (YOLOv8n) + a lightweight face detector (YuNet).

Why two detectors. YOLOv8n is trained on COCO, so what it finds is a whole PERSON, and it often finds nobody when a laptop webcam shows only
the head and shoulders. The old "face not visible" rule was really "YOLO found no person", which fired constantly for ordinary candidates.
Now:
  * "is someone there" = the FACE detector sees a face OR YOLO sees a person (both must miss before `no_person` is raised);
  * "more than one person" = two clear faces, or two large, separate people (a lone, partly visible second body is not enough);
  * phones, laptops and books still come from YOLO, which is what it is good at.
ONNX Runtime instead of PyTorch: the same weights, about 2.5x faster per frame at the default size, a much smaller memory footprint per
worker, and no torch in the backend image. Nothing here is a verdict: the browser counts consecutive misses, and recruitment only RECORDS events.

Settings (environment): PROCTOR_YOLO_WIDTH (default 448; the model input width, 320 = fastest, 640 = most sensitive to small phones),
PROCTOR_THREADS (CPU threads per inference, default 2), PROCTOR_FACE_WIDTH (width the frame is scaled to for the face detector, default 320).
"""
import os
import base64
import binascii
import io
import threading
import re
try:
    import numpy as np
    from PIL import Image
    VISION_LIBS_AVAILABLE = True
except ImportError:
    np = None
    Image = None
    VISION_LIBS_AVAILABLE = False
from pathlib import Path


MODELS_DIR = Path(__file__).parent.parent / 'models'

# Active models (both ship in the repository under backend/models)
ACTIVE_MODEL = str(MODELS_DIR / 'yolov8n.onnx')
FACE_MODEL = str(MODELS_DIR / 'face_detection_yunet_2023mar.onnx')

_model = None                    # the YOLO detector (see OnnxYolo); None until loaded
_face_detector = None            # cv2.FaceDetectorYN, or None when unavailable (analysis then falls back to YOLO persons only)
_model_lock = threading.Lock()   # only one thread loads the models; the rest wait for it
_infer_lock = threading.Lock()   # one inference at a time per worker, so frames never fight for the CPU
_load_state = 'unloaded'         # unloaded | loading | ready | error
_warmup_thread = None

# COCO class IDs relevant for proctoring
PERSON_CLASS_ID = 0
RELEVANT_CLASSES = {
    0:  'person',
    63: 'laptop',
    64: 'mouse',
    65: 'remote',
    66: 'keyboard',
    67: 'cell phone',
    73: 'book',
    76: 'scissors',
}
_RELEVANT_IDS = np.array(sorted(RELEVANT_CLASSES), dtype=np.int64) if np is not None else None

_COCO_NAMES = (
    "person bicycle car motorcycle airplane bus train truck boat traffic_light fire_hydrant stop_sign parking_meter bench bird cat dog horse sheep cow "
    "elephant bear zebra giraffe backpack umbrella handbag tie suitcase frisbee skis snowboard sports_ball kite baseball_bat baseball_glove skateboard "
    "surfboard tennis_racket bottle wine_glass cup fork knife spoon bowl banana apple sandwich orange broccoli carrot hot_dog pizza donut cake chair "
    "couch potted_plant bed dining_table toilet tv laptop mouse remote keyboard cell_phone microwave oven toaster sink refrigerator book clock vase "
    "scissors teddy_bear hair_drier toothbrush").split()
COCO_NAMES = {i: name.replace("_", " ") for i, name in enumerate(_COCO_NAMES)}

# Tuning (all overridable in tests; defaults chosen on real webcam-like crops, see tests/test_proctor_vision.py)
YOLO_WIDTH = int(os.getenv("PROCTOR_YOLO_WIDTH", "448"))
CPU_THREADS = max(1, int(os.getenv("PROCTOR_THREADS", "2")))
FACE_WIDTH = int(os.getenv("PROCTOR_FACE_WIDTH", "320"))
MAX_WORK_WIDTH = 640                  # frames wider than this are scaled down before analysis (bounds the CPU cost of any upload)
NMS_IOU = 0.45
FACE_SCORE_THRESHOLD = 0.60           # a face this confident counts as "someone is there"
STRONG_FACE_SCORE = 0.80              # ...and this confident, and big enough, counts toward "more than one person"
STRONG_FACE_MIN_WIDTH = 0.07          # fraction of the frame width: small, distant detections never make a second person
BIG_PERSON_MIN_AREA = 0.10            # fraction of the frame: a person this large (and separate from the other) counts toward "more than one"
SAME_PERSON_IOU = 0.50

# ── Request limits (the endpoint is reachable by candidates, so every input is bounded) ─────────────────────────────────
MAX_BASE64_CHARS = 1_500_000          # request field size; a 640x480 JPEG at quality 0.6 is ~40k characters
MAX_DECODED_BYTES = 1_048_576         # 1 MiB after base64 decoding
MAX_IMAGE_PIXELS = 2_100_000          # ~1920x1080; larger images are rejected before they are decoded into memory
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
_DATA_URL_PATTERN = r"^data:image/(jpeg|jpg|png|webp);base64,"
_MAGIC = ((bytes.fromhex("ffd8ff"), "JPEG"), (bytes.fromhex("89504e470d0a1a0a"), "PNG"))


class InvalidFrame(ValueError):
    """The submitted frame is malformed or exceeds the limits. The message is safe to show to a client."""


def decode_frame(image_base64) -> "Image.Image":
    """
    Strictly validate and decode a client frame. Raises InvalidFrame (never returns a partially valid image).
    Order matters: cheap checks first, pixel-count check before the pixels are decoded (decompression-bomb guard).
    """
    if not VISION_LIBS_AVAILABLE:
        raise InvalidFrame("Proctoring is unavailable.")
    if not isinstance(image_base64, str) or not image_base64.strip():
        raise InvalidFrame("No image provided.")
    if len(image_base64) > MAX_BASE64_CHARS:
        raise InvalidFrame("Image is too large.")
    data = image_base64.strip()
    if data.lower().startswith("data:"):
        match = re.match(_DATA_URL_PATTERN, data, re.IGNORECASE)
        if not match:
            raise InvalidFrame("Unsupported image type.")
        data = data[match.end():]
    if len(data) * 3 // 4 > MAX_DECODED_BYTES + 3:
        raise InvalidFrame("Image is too large.")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidFrame("Invalid image encoding.")
    if not raw or len(raw) > MAX_DECODED_BYTES:
        raise InvalidFrame("Image is too large.")
    if not (any(raw.startswith(sig) for sig, _ in _MAGIC) or (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")):
        raise InvalidFrame("Unsupported image type.")
    try:
        image = Image.open(io.BytesIO(raw))
        if image.format not in ALLOWED_IMAGE_FORMATS:
            raise InvalidFrame("Unsupported image type.")
        width, height = image.size
        if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
            raise InvalidFrame("Image dimensions are not allowed.")
        image.load()
        return image.convert("RGB")
    except InvalidFrame:
        raise
    except Exception:  # corrupt / truncated data: PIL's message may describe internals, so none of it is returned
        raise InvalidFrame("Invalid image.")


# Detection confidence threshold
CONFIDENCE_THRESHOLD = 0.40
PHONE_CONFIDENCE_THRESHOLD = 0.45


def _ceil32(value: float) -> int:
    return max(32, int(-(-value // 32) * 32))


def _iou(a, b) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _nms(boxes, scores, iou_threshold: float):
    """Greedy non-maximum suppression over (N, 4) xyxy boxes; returns the kept indices, best first."""
    order = np.argsort(-scores)
    keep = []
    while order.size:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        iou = inter / np.maximum(area_i + area_r - inter, 1e-9)
        order = rest[iou <= iou_threshold]
    return keep


class OnnxYolo:
    """YOLOv8n through ONNX Runtime (CPU). Calling it returns [(class_id, confidence, (x1, y1, x2, y2) normalized 0-1)] for the classes proctoring cares about."""

    def __init__(self, path: str, width: int = YOLO_WIDTH, threads: int = CPU_THREADS):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.width = _ceil32(width)
        self.names = COCO_NAMES

    def __call__(self, image, conf: float = CONFIDENCE_THRESHOLD, **_ignored):
        height, width = image.shape[:2]
        mw = self.width
        mh = _ceil32(mw * height / width)
        scale = min(mw / width, mh / height)
        nw, nh = max(1, round(width * scale)), max(1, round(height * scale))
        resized = np.asarray(Image.fromarray(image).resize((nw, nh), Image.BILINEAR))
        canvas = np.full((mh, mw, 3), 114, dtype=np.uint8)          # letterbox: the frame keeps its shape, grey bars fill the rest
        padx, pady = (mw - nw) // 2, (mh - nh) // 2
        canvas[pady:pady + nh, padx:padx + nw] = resized
        tensor = (canvas.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]

        out = self.session.run(None, {self.input_name: tensor})[0][0].T          # (anchors, 4 + classes)
        scores = out[:, 4:]
        class_ids = scores.argmax(1)
        confidences = scores[np.arange(len(class_ids)), class_ids]
        keep = (confidences >= conf) & np.isin(class_ids, _RELEVANT_IDS)
        if not keep.any():
            return []
        out, class_ids, confidences = out[keep], class_ids[keep], confidences[keep]
        cx, cy, bw, bh = out[:, 0], out[:, 1], out[:, 2], out[:, 3]
        boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - padx) / scale / width        # back to the original frame, normalized
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pady) / scale / height
        boxes = np.clip(boxes, 0.0, 1.0)
        detections = []
        for cid in np.unique(class_ids):                                     # per-class suppression, as the standard pipeline does
            idx = np.where(class_ids == cid)[0]
            for k in _nms(boxes[idx], confidences[idx], NMS_IOU):
                j = idx[k]
                detections.append((int(cid), float(confidences[j]), tuple(float(v) for v in boxes[j])))
        return detections


def _load_yolo():
    return OnnxYolo(ACTIVE_MODEL)


def _load_face_detector():
    """YuNet through OpenCV (0.2 MB). None when OpenCV or the model file is missing: analysis then falls back to YOLO persons only."""
    try:
        import cv2
        cv2.setNumThreads(CPU_THREADS)
        if not os.path.exists(FACE_MODEL):
            print("[ProctoringService] Face model file is missing; using person detection only")
            return None
        return cv2.FaceDetectorYN.create(FACE_MODEL, "", (320, 240), FACE_SCORE_THRESHOLD, 0.3, 500)
    except Exception as e:
        print(f"[ProctoringService] Face detector unavailable ({type(e).__name__}); using person detection only")
        return None


def get_model():
    """Load the detectors once and cache them in memory (the YOLO model is the one whose absence makes proctoring unavailable)."""
    global _model, _face_detector, _load_state
    if not VISION_LIBS_AVAILABLE:
        return None
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            _load_state = 'loading'
            try:
                _model = _load_yolo()
                _face_detector = _load_face_detector()
                _load_state = 'ready'
                print(f"[ProctoringService] Model loaded: {ACTIVE_MODEL} (faces: {'on' if _face_detector is not None else 'off'}, input width {YOLO_WIDTH})")
            except Exception as e:
                print(f"[ProctoringService] Failed to load the detection model: {type(e).__name__}: {e}")
                _model = None
                _load_state = 'error'
        return _model


def warm_up() -> bool:
    """
    Loads the models and runs one throwaway inference, so the first candidate frame (and everything queued behind it) does not pay for
    library start-up. Done in the background at server start.
    """
    model = get_model()
    if model is None or np is None:
        return False
    try:
        with _infer_lock:
            model(np.zeros((240, 320, 3), dtype=np.uint8), conf=CONFIDENCE_THRESHOLD, verbose=False, device='cpu')
            if _face_detector is not None:
                _detect_faces(np.zeros((240, 320, 3), dtype=np.uint8))
        return True
    except Exception as e:
        print(f"[ProctoringService] Warm-up inference failed: {e}")
        return False


def start_warm_up_in_background():
    """Starts warm_up() once per process on a daemon thread and returns immediately."""
    global _warmup_thread
    if _warmup_thread is not None or _model is not None:
        return
    _warmup_thread = threading.Thread(target=warm_up, name='proctor-warmup', daemon=True)
    _warmup_thread.start()


def get_public_status() -> dict:
    """The minimum a readiness check needs: is the detector usable? No file names, class lists or thresholds."""
    return {"status": "ready" if get_model() is not None else "error"}


def get_model_status(block: bool = True) -> dict:
    """
    Return runtime status of the detection engine.

    block=True loads the model if needed and waits for it. block=False never waits: while the model is
    still loading it answers {"status": "loading"} straight away (and starts the load in the background).
    """
    if block:
        status = "ready" if get_model() is not None else "error"
    elif _model is not None:
        status = "ready"
    elif _load_state == 'error':
        status = "error"
    else:
        start_warm_up_in_background()
        status = "loading"
    supported_classes = [RELEVANT_CLASSES[k] for k in sorted(RELEVANT_CLASSES.keys())]
    return {
        "status": status,
        "model_file": os.path.basename(ACTIVE_MODEL),
        "model_name": "YOLOv8n (ONNX Runtime, CPU)",
        "face_model": "yunet" if _face_detector is not None else "unavailable",
        "classes_supported": supported_classes,
        "person_class_id": PERSON_CLASS_ID,
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "phone_confidence_threshold": PHONE_CONFIDENCE_THRESHOLD,
        "input_width": YOLO_WIDTH,
    }


def _detect_faces(image_np):
    """[(score, (x1, y1, x2, y2) normalized)] for faces YuNet finds, or None when the face detector is not available."""
    detector = _face_detector
    if detector is None:
        return None
    import cv2
    height, width = image_np.shape[:2]
    if width > FACE_WIDTH:
        scaled = cv2.resize(image_np, (FACE_WIDTH, max(1, round(height * FACE_WIDTH / width))), interpolation=cv2.INTER_AREA)
    else:
        scaled = image_np
    sh, sw = scaled.shape[:2]
    detector.setInputSize((sw, sh))
    _, rows = detector.detect(cv2.cvtColor(scaled, cv2.COLOR_RGB2BGR))
    faces = []
    for row in (rows if rows is not None else []):
        x, y, w, h, score = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[-1])
        faces.append((score, (max(0.0, x / sw), max(0.0, y / sh), min(1.0, (x + w) / sw), min(1.0, (y + h) / sh))))
    return faces


def _debug_save(image):
    """Development aid: PROCTOR_DEBUG_DIR=<folder> keeps the last 40 frames the server receives (to see what the browser really sends)."""
    folder = os.getenv("PROCTOR_DEBUG_DIR")
    if not folder:
        return
    try:
        os.makedirs(folder, exist_ok=True)
        import time
        image.save(os.path.join(folder, f"frame_{int(time.time() * 1000)}.jpg"), quality=90)
        files = sorted(f for f in os.listdir(folder) if f.startswith("frame_"))
        for old in files[:-40]:
            os.remove(os.path.join(folder, old))
    except Exception:
        pass


def decide(person_boxes, faces):
    """
    The proctoring rules for people (pure, so they are unit tested):
      person_boxes = [(confidence, (x1, y1, x2, y2))] from YOLO, faces = [(score, box)] from the face detector, or None if there is none.
    Returns (person_count, violations, boxes_for_overlay).
      * someone is present when the face detector sees a face OR YOLO sees a person; only when BOTH miss is `no_person` raised
      * `multiple_persons` needs two clear faces, or two large and clearly separate people
    """
    faces = [f for f in (faces or []) if f[0] >= FACE_SCORE_THRESHOLD]
    strong = []
    for score, box in sorted(faces, key=lambda f: -f[0]):
        if score >= STRONG_FACE_SCORE and (box[2] - box[0]) >= STRONG_FACE_MIN_WIDTH and all(_iou(box, other) < SAME_PERSON_IOU for _, other in strong):
            strong.append((score, box))
    big = []
    for conf, box in sorted(person_boxes, key=lambda p: -p[0]):
        if (box[2] - box[0]) * (box[3] - box[1]) >= BIG_PERSON_MIN_AREA and all(_iou(box, other) < SAME_PERSON_IOU for _, other in big):
            big.append((conf, box))
    present = bool(faces) or bool(person_boxes)
    people = max(len(strong), len(big), 1 if present else 0)
    violations = []
    if not present:
        violations.append("no_person")
    if len(strong) >= 2 or len(big) >= 2:
        violations.append("multiple_persons")
    overlay = [box for _, box in faces] or [box for _, box in person_boxes]
    return people, violations, overlay


def analyze_frame(image_base64: str) -> dict:
    """
    Analyze a base64-encoded image frame for proctoring violations.

    Returns:
        {
            "status": "ok",
            "model_name": "YOLOv8n + YuNet (ONNX Runtime, CPU)",
            "violations": ["phone_detected", "multiple_persons"],
            "detections": [{"class": "cell phone", "class_id": 67, "confidence": 0.87, "bbox": [x1, y1, x2, y2]}],
            "person_count": 2,
            "face_count": 2,
            "suspect_label": "📱 Phone Detected",
            "face_boxes": [[x1, y1, x2, y2]]
        }
    """
    model = get_model()
    if model is None:
        return {
            "status": "error",
            "violations": [],
            "detections": [],
            "person_count": -1,
            "face_boxes": [],
            "error": "Proctoring model is unavailable."
        }

    try:
        # Accept an already-validated PIL image (the router decodes first) or a base64 string (validated here)
        image = decode_frame(image_base64) if isinstance(image_base64, str) else image_base64

        # Bound the work: anything wider than MAX_WORK_WIDTH is scaled down first (a 640x480 webcam frame is analysed as sent)
        if image.width > MAX_WORK_WIDTH:
            image = image.resize((MAX_WORK_WIDTH, max(1, round(image.height * MAX_WORK_WIDTH / image.width))))
        image_np = np.array(image)
        _debug_save(image)

        with _infer_lock:
            raw = model(image_np, conf=CONFIDENCE_THRESHOLD, verbose=False, device='cpu')
            faces = _detect_faces(image_np)

        detections = []
        violations = []
        person_boxes = []

        for class_id, confidence, (x1, y1, x2, y2) in raw:
            # Only report relevant classes
            if class_id not in RELEVANT_CLASSES:
                continue

            # Phone confidence threshold tuning to avoid false positives
            if class_id == 67 and confidence < PHONE_CONFIDENCE_THRESHOLD:
                continue

            detections.append({
                "class": model.names.get(class_id, f'class_{class_id}'),
                "class_id": class_id,
                "confidence": round(confidence, 2),
                "bbox": [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]
            })
            if class_id == PERSON_CLASS_ID:
                person_boxes.append((confidence, (x1, y1, x2, y2)))

        # --- Violation Logic ---
        person_count, people_violations, face_boxes = decide(person_boxes, faces)
        violations.extend(people_violations)   # "no_person" (the browser tracks consecutive misses) / "multiple_persons"

        # Electronic devices & books detected
        for det in detections:
            c = det['class']
            if c == 'cell phone':
                violations.append("phone_detected")
            elif c == 'laptop':
                violations.append("device_detected")
            elif c == 'book':
                violations.append("notes_detected")

        # Build human-readable suspect label for UI display
        suspect_label = None
        for det in detections:
            c = det['class']
            if c == 'cell phone':
                suspect_label = f"📱 Phone Detected ({int(det['confidence'] * 100)}%)"
                break
            elif c == 'laptop':
                suspect_label = f"💻 Secondary Device ({int(det['confidence'] * 100)}%)"
                break
            elif c == 'book':
                suspect_label = f"📖 Notes Detected ({int(det['confidence'] * 100)}%)"
                break
        if "multiple_persons" in violations and not suspect_label:
            suspect_label = f"👥 Multiple Persons ({person_count})"

        return {
            "status": "ok",
            "model_name": "YOLOv8n + YuNet (ONNX Runtime, CPU)",
            "violations": list(set(violations)),
            "detections": detections,
            "person_count": person_count,
            "face_count": len(faces) if faces is not None else None,
            "suspect_label": suspect_label,
            "face_boxes": [[round(v, 4) for v in box] for box in face_boxes]
        }

    except InvalidFrame as e:
        return {"status": "error", "violations": [], "detections": [], "person_count": -1, "face_boxes": [], "error": str(e)}
    except Exception as e:
        print(f"[ProctoringService] Frame analysis error: {type(e).__name__}")   # detail stays in the server log only
        return {
            "status": "error",
            "violations": [],
            "detections": [],
            "person_count": -1,
            "face_boxes": [],
            "error": "Frame analysis failed."
        }
