"""
Candidate endpoints of a section retest (see services/retest_service.py).

Authorization reuses what the candidate already has:
  * student-made registration -> the signed-in student's normal PrepWin session (cookie or Bearer); no token, nothing to type;
  * accountless registration  -> the single-use hand-over token the administrator received at assignment (X-Retest-Token).
Once the sitting starts it runs on the same capability + volatile lease model as the original attempt (X-Session-Token / X-Session-Lease).
The path names the retest, never a section or a score: the server only ever serves and grades the section that was assigned.
"""
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

import database
from routers.public_assessment import DraftRequest, RunCodeRequest, SubmitRequest, _signed_in_user_id
from services import elevenlabs_service
from services import retest_service as svc
from services.rate_limiter import SlidingWindowLimiter, client_ip

info_limiter = SlidingWindowLimiter(limit=60, window_seconds=60)
start_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)


def _no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


router = APIRouter(prefix="/api/public/retest", tags=["public-retest"], dependencies=[Depends(_no_store)])


def _limit(limiter: SlidingWindowLimiter, request: Request):
    if not limiter.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a minute and try again.", headers={"Retry-After": "60"})


class StartRequest(BaseModel):
    acknowledged: bool = False


@router.get("/{retest_uuid}")
def retest_info(retest_uuid: str, request: Request, x_retest_token: Optional[str] = Header(None, alias="X-Retest-Token"),
                db=Depends(database.get_db)):
    _limit(info_limiter, request)
    row = svc.find(db, retest_uuid)
    svc.authorize_owner(db, row, token=x_retest_token, viewer_id=_signed_in_user_id(request, db))
    pk = row.id
    svc.settle(db, pk)
    db.expire_all()
    return svc.describe(db, svc.find(db, retest_uuid))


@router.post("/{retest_uuid}/start")
def retest_start(retest_uuid: str, request: Request, body: Optional[StartRequest] = None,
                 x_retest_token: Optional[str] = Header(None, alias="X-Retest-Token"), db=Depends(database.get_db)):
    _limit(start_limiter, request)
    return svc.start(db, retest_uuid, token=x_retest_token, viewer_id=_signed_in_user_id(request, db),
                     acknowledged=bool(body and body.acknowledged))


# ------------------------------------------------------------------------------ the sitting
class _SessionAuth(tuple):
    viewer = None


def _session_headers(request: Request, x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
                     x_session_lease: Optional[str] = Header(None, alias="X-Session-Lease"), db=Depends(database.get_db)):
    auth = _SessionAuth((x_session_token, x_session_lease))
    auth.viewer = lambda: _signed_in_user_id(request, db)
    return auth


def _sitting(db, retest_uuid: str, headers, **kw):
    token, lease = headers
    return svc.load(db, retest_uuid, token, lease, viewer=headers.viewer, **kw)


@router.get("/{retest_uuid}/state")
def retest_state(retest_uuid: str, headers=Depends(_session_headers), db=Depends(database.get_db)):
    return svc.get_state(db, _sitting(db, retest_uuid, headers, allow_terminal=True))


@router.post("/{retest_uuid}/heartbeat")
def retest_heartbeat(retest_uuid: str, headers=Depends(_session_headers), db=Depends(database.get_db)):
    return svc.heartbeat(db, _sitting(db, retest_uuid, headers))


@router.put("/{retest_uuid}/draft")
def retest_draft(retest_uuid: str, body: DraftRequest, headers=Depends(_session_headers), db=Depends(database.get_db)):
    return svc.save_draft(db, _sitting(db, retest_uuid, headers), body.section, body.payload, violations=body.violations)


@router.post("/{retest_uuid}/start-section/{section}")
def retest_start_section(retest_uuid: str, section: str, headers=Depends(_session_headers), db=Depends(database.get_db)):
    if section.upper() not in svc.SECTIONS:
        raise HTTPException(status_code=404, detail="Not found.")
    return svc.start_section(db, _sitting(db, retest_uuid, headers), section)


@router.post("/{retest_uuid}/run-code")
def retest_run_code(retest_uuid: str, body: RunCodeRequest, headers=Depends(_session_headers), db=Depends(database.get_db)):
    return svc.run_code(db, _sitting(db, retest_uuid, headers), body.problem_id, body.language, body.code, body.custom_input)


@router.post("/{retest_uuid}/submit")
def retest_submit(retest_uuid: str, body: SubmitRequest, headers=Depends(_session_headers), db=Depends(database.get_db)):
    """One submit endpoint for every section: the retest decides which section is graded, whatever the body carries."""
    row = _sitting(db, retest_uuid, headers)
    payload: Optional[Dict[str, Any]] = None
    if row.section == "APTITUDE" and body.answers is not None:
        payload = {"answers": body.answers if isinstance(body.answers, dict) else {}}
    elif row.section == "CODING" and body.solutions is not None:
        payload = {"solutions": body.solutions}
    elif row.section == "INTERVIEW" and (body.answers is not None or body.transcript is not None):
        payload = {"answers": body.answers if body.answers is not None else [], "transcript": body.transcript or []}
    return svc.submit(db, row, payload, violations=body.violations)


@router.post("/{retest_uuid}/voice-init")
def retest_voice_init(retest_uuid: str, headers=Depends(_session_headers), db=Depends(database.get_db)):
    return svc.voice_init(db, _sitting(db, retest_uuid, headers))


def _history(raw: str) -> List[Any]:
    try:
        return json.loads(raw or "[]")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation history.")


@router.post("/{retest_uuid}/voice-turn")
def retest_voice_turn(retest_uuid: str, audio: Optional[UploadFile] = File(None), history: str = Form("[]"), opening: bool = Form(False),
                      headers=Depends(_session_headers), db=Depends(database.get_db)):
    row = _sitting(db, retest_uuid, headers)
    audio_bytes = audio.file.read(elevenlabs_service.MAX_AUDIO_BYTES + 1) if audio is not None else None
    return svc.voice_turn(db, row, audio_bytes, (audio.content_type if audio is not None else None) or elevenlabs_service.AUDIO_WEBM,
                          _history(history), opening)


@router.post("/{retest_uuid}/voice-caption-token")
def retest_caption_token(retest_uuid: str, headers=Depends(_session_headers), db=Depends(database.get_db)):
    return JSONResponse(content=svc.voice_caption_session(db, _sitting(db, retest_uuid, headers)), headers={"Cache-Control": "no-store"})


@router.post("/{retest_uuid}/voice-turn-stream")
def retest_voice_turn_stream(retest_uuid: str, audio: Optional[UploadFile] = File(None), history: str = Form("[]"), opening: bool = Form(False),
                             headers=Depends(_session_headers), db=Depends(database.get_db)):
    row = _sitting(db, retest_uuid, headers)
    audio_bytes = audio.file.read(elevenlabs_service.MAX_AUDIO_BYTES + 1) if audio is not None else None
    events = svc.voice_turn_stream(db, row, audio_bytes, (audio.content_type if audio is not None else None) or elevenlabs_service.AUDIO_WEBM,
                                   _history(history), opening)
    return StreamingResponse((json.dumps(event, separators=(",", ":")) + "\n" for event in events), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "Content-Encoding": "identity"})
