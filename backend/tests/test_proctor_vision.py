import pytest
import base64
import io
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from main import app
from services.proctor_service import get_model, analyze_frame, get_model_status, RELEVANT_CLASSES, PERSON_CLASS_ID

client = TestClient(app)


@pytest.fixture(scope="module")
def auth():
    """Frame analysis and the detailed status require a valid sitting credential (see tests/test_proctor_security.py)."""
    import database, models, utils
    db = database.SessionLocal()
    user = db.query(models.User).filter(models.User.email == "proctor.vision@rwtest.com").first()
    if user is None:
        user = models.User(email="proctor.vision@rwtest.com", hashed_password=utils.get_password_hash("x"), role=models.UserRole.STUDENT)
        db.add(user)
        db.commit()
    token = utils.create_access_token(data={"sub": user.email, "role": user.role})
    db.close()
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _reset_proctor_limits():
    from routers import proctor
    for limiter in (proctor.frame_limiter, proctor.auth_fail_limiter, proctor.status_limiter):
        limiter.reset()
    yield


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


def test_get_model_status_endpoint(auth):
    """Verify the /api/proctor/status endpoint returns model readiness and class metadata to an authenticated caller."""
    resp = client.get("/api/proctor/status", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ready"
    assert "yolov8n" in data["model_file"] and data["face_model"] in ("yunet", "unavailable")
    assert "person" in data["classes_supported"]
    assert "cell phone" in data["classes_supported"]


def test_analyze_frame_no_person(auth):
    """Verify that a blank frame detects 0 persons and returns 'no_person' violation."""
    img = Image.new('RGB', (320, 240), color='white')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

    resp = client.post("/api/proctor/analyze-frame", json={"image": b64}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["person_count"] == 0
    assert "no_person" in data["violations"]
    assert isinstance(data["detections"], list)
    assert isinstance(data["face_boxes"], list)


def test_analyze_frame_raw_base64_without_header(auth):
    """Verify analyze_frame handles raw base64 strings without data: prefix."""
    img = Image.new('RGB', (320, 240), color='blue')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    b64 = base64.b64encode(buf.getvalue()).decode()

    resp = client.post("/api/proctor/analyze-frame", json={"image": b64}, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["person_count"] == 0


def test_analyze_frame_empty_payload(auth):
    """Verify analyze_frame rejects empty payload with 400 Bad Request."""
    resp = client.post("/api/proctor/analyze-frame", json={"image": ""}, headers=auth)
    assert resp.status_code == 400
    assert "No image provided" in resp.json()["detail"]


def test_analyze_frame_invalid_image(auth):
    """Corrupt base64 is a client error: 400 with a safe message (it used to be a 200 carrying an error status)."""
    resp = client.post("/api/proctor/analyze-frame", json={"image": "invalid_base64_string!!!"}, headers=auth)
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Invalid image encoding."}
