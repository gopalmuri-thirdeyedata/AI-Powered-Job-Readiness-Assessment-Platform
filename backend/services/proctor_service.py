import os
import base64
import io
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
    global _model
    if not VISION_LIBS_AVAILABLE:
        return None
    if _model is None:
        try:
            from ultralytics import YOLO
            _model = YOLO(ACTIVE_MODEL)
            print(f"[ProctoringService] Model loaded: {ACTIVE_MODEL}")
        except Exception as e:
            print(f"[ProctoringService] Failed to load YOLO model: {e}")
            _model = None
    return _model


def get_model_status() -> dict:
    """Return runtime status of the YOLO detection engine."""
    model = get_model()
    is_ready = model is not None
    supported_classes = [RELEVANT_CLASSES[k] for k in sorted(RELEVANT_CLASSES.keys())]
    return {
        "status": "ready" if is_ready else "error",
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

