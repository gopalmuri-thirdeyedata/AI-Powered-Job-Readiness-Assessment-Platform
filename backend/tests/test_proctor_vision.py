import pytest
import base64
import io
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from main import app
from services.proctor_service import get_model, analyze_frame, get_model_status, RELEVANT_CLASSES, PERSON_CLASS_ID

client = TestClient(app)


def test_yolo_model_loading_and_classes():
    """Verify that YOLOv8n loads correctly and has required classes for person and phone detection."""
    model = get_model()
    assert model is not None, "YOLO model should load successfully from backend/models/yolov8n.pt"
    assert PERSON_CLASS_ID == 0
    assert 0 in model.names
    assert model.names[0] == 'person'
    assert 67 in model.names
    assert model.names[67] == 'cell phone'
    assert 63 in model.names
    assert model.names[63] == 'laptop'
    assert 73 in model.names
    assert model.names[73] == 'book'


def test_get_model_status_endpoint():
    """Verify the /api/proctor/status endpoint returns model readiness and class metadata."""
    resp = client.get("/api/proctor/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ready"
    assert "yolov8n.pt" in data["model_file"]
    assert "person" in data["classes_supported"]
    assert "cell phone" in data["classes_supported"]


def test_analyze_frame_no_person():
    """Verify that a blank frame detects 0 persons and returns 'no_person' violation."""
    img = Image.new('RGB', (320, 240), color='white')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

    resp = client.post("/api/proctor/analyze-frame", json={"image": b64})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["person_count"] == 0
    assert "no_person" in data["violations"]
    assert isinstance(data["detections"], list)
    assert isinstance(data["face_boxes"], list)


def test_analyze_frame_raw_base64_without_header():
    """Verify analyze_frame handles raw base64 strings without data: prefix."""
    img = Image.new('RGB', (320, 240), color='blue')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    b64 = base64.b64encode(buf.getvalue()).decode()

    resp = client.post("/api/proctor/analyze-frame", json={"image": b64})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["person_count"] == 0


def test_analyze_frame_empty_payload():
    """Verify analyze_frame rejects empty payload with 400 Bad Request."""
    resp = client.post("/api/proctor/analyze-frame", json={"image": ""})
    assert resp.status_code == 400
    assert "No image provided" in resp.json()["detail"]


def test_analyze_frame_invalid_image():
    """Verify analyze_frame handles corrupt base64 gracefully with error status."""
    resp = client.post("/api/proctor/analyze-frame", json={"image": "invalid_base64_string!!!"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "error"
    assert data["person_count"] == -1
