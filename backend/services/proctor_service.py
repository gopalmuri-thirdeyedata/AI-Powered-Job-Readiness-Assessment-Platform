import os
import base64
import io
import threading
try:
    import numpy as np
    from PIL import Image
    VISION_LIBS_AVAILABLE = True
except ImportError:
    np = None
    Image = None
    VISION_LIBS_AVAILABLE = False
from pathlib import Path


# Base directory — resolves to e:\HiringAi\backend\models\
MODELS_DIR = Path(__file__).parent.parent / 'models'

# Active model — yolov8n.pt for CPU; swap to yolov8s.pt or yolo11s.pt on GPU server
ACTIVE_MODEL = str(MODELS_DIR / 'yolov8n.pt')

# YOLOv11n model — loaded once and cached in memory
_model = None
_model_lock = threading.Lock()   # only one thread loads the model; the rest wait for it
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

# Detection confidence threshold
CONFIDENCE_THRESHOLD = 0.40
PHONE_CONFIDENCE_THRESHOLD = 0.45


def get_model():
    """
    Load model once and cache it in memory.
    Model file: backend/models/yolov8n.pt
    On GPU server: change ACTIVE_MODEL to yolov8s.pt or yolo11s.pt — zero other changes needed.
    """
    global _model, _load_state
    if not VISION_LIBS_AVAILABLE:
        return None
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            _load_state = 'loading'
            try:
                from ultralytics import YOLO
                _model = YOLO(ACTIVE_MODEL)
                _load_state = 'ready'
                print(f"[ProctoringService] Model loaded: {ACTIVE_MODEL}")
            except Exception as e:
                print(f"[ProctoringService] Failed to load YOLO model: {e}")
                _model = None
                _load_state = 'error'
        return _model


def warm_up() -> bool:
    """
    Loads the model and runs one throwaway inference. The very first inference in a process takes ~20s
    (library start-up and first-use initialisation), so this is done in the background at server start
    instead of making the first candidate frame, and everything queued behind it, wait.
    """
    model = get_model()
    if model is None or np is None:
        return False
    try:
        with _infer_lock:
            model(np.zeros((240, 320, 3), dtype=np.uint8), conf=CONFIDENCE_THRESHOLD, verbose=False, device='cpu')
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


def get_model_status(block: bool = True) -> dict:
    """
    Return runtime status of the YOLO detection engine.

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
        "model_name": "YOLOv8n (CPU-Optimized)",
        "classes_supported": supported_classes,
        "person_class_id": PERSON_CLASS_ID,
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "phone_confidence_threshold": PHONE_CONFIDENCE_THRESHOLD
    }


def analyze_frame(image_base64: str) -> dict:
    """
    Analyze a base64-encoded image frame for proctoring violations.
    
    Returns:
        {
            "status": "ok",
            "model_name": "YOLOv8n (CPU)",
            "violations": ["phone_detected", "multiple_persons"],
            "detections": [{"class": "cell phone", "class_id": 67, "confidence": 0.87, "bbox": [x1, y1, x2, y2]}],
            "person_count": 2,
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
            "error": "YOLO model not initialized or file missing"
        }

    try:
        # Decode base64 image
        if ',' in image_base64:
            image_base64 = image_base64.split(',')[1]
        
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        
        # Resize to 320x240 for faster CPU inference
        image = image.resize((320, 240))
        image_np = np.array(image)

        # Run YOLO inference
        with _infer_lock:
            results = model(
                image_np,
                conf=CONFIDENCE_THRESHOLD,
                verbose=False,   # Suppress per-frame console output
                device='cpu'     # Explicit CPU — no GPU needed
            )

        detections = []
        violations = []
        person_count = 0

        for result in results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                class_name = result.names.get(class_id, f'class_{class_id}')

                # Only report relevant classes
                if class_id not in RELEVANT_CLASSES:
                    continue

                # Phone confidence threshold tuning to avoid false positives
                if class_id == 67 and confidence < PHONE_CONFIDENCE_THRESHOLD:
                    continue

                # Normalized bounding box [x1, y1, x2, y2] in 0-1 range
                x1, y1, x2, y2 = box.xyxyn[0].tolist()

                detections.append({
                    "class": class_name,
                    "class_id": class_id,
                    "confidence": round(confidence, 2),
                    "bbox": [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]
                })

                if class_id == PERSON_CLASS_ID:
                    person_count += 1

        # --- Violation Logic ---

        # Multiple persons in frame
        if person_count >= 2:
            violations.append("multiple_persons")

        # No person in frame (return special flag — browser tracks consecutive count)
        if person_count == 0:
            violations.append("no_person")

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
        if person_count >= 2 and not suspect_label:
            suspect_label = f"👥 Multiple Persons ({person_count})"

        # ── Collect person bboxes for UI overlay ──────────────────────────────
        face_boxes = [
            d['bbox'] for d in detections if d['class'] == 'person'
        ]

        return {
            "status": "ok",
            "model_name": "YOLOv8n (CPU)",
            "violations": list(set(violations)),
            "detections": detections,
            "person_count": person_count,
            "suspect_label": suspect_label,
            "face_boxes": face_boxes
        }

    except Exception as e:
        print(f"[ProctoringService] Frame analysis error: {e}")
        return {
            "status": "error",
            "violations": [],
            "detections": [],
            "person_count": -1,
            "face_boxes": [],
            "error": str(e)
        }

