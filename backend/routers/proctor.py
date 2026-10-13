from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.proctor_service import analyze_frame, get_model_status

router = APIRouter(prefix="/api/proctor", tags=["Proctoring"])


class FrameRequest(BaseModel):
    image: str  # base64-encoded image (data:image/jpeg;base64,... or raw base64)


@router.get("/status")
async def get_proctoring_status():
    """
    Returns YOLO model loading status, supported classes, and active confidence settings.
    Used for frontend hardware readiness checks and diagnostic validation.
    """
    return get_model_status()


@router.post("/analyze-frame")
async def analyze_proctor_frame(payload: FrameRequest):
    """
    Analyze a camera frame for proctoring violations using YOLOv8n.

    No auth required — called directly by candidate during test.
    Detects: multiple persons, no person, phone, laptop, book/notes.
    Returns violation flags + suspect_label for the frontend to act on.
    """
    if not payload.image:
        raise HTTPException(status_code=400, detail="No image provided")

    result = analyze_frame(payload.image)
    return result

