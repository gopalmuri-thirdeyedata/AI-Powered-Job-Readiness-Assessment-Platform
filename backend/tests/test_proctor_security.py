"""
Security tests for /api/proctor/analyze-frame and /api/proctor/status.

The detector (YOLO) is real; credentials are real (student JWT, invitation token, recruitment session capability). What is
mocked is only noted per test. These are unit/integration tests of authorization, validation, limits and error hygiene;
they say nothing about detection accuracy (see test_proctor_vision.py) or live camera behaviour.
"""
import base64
import io
import uuid
from datetime import datetime, timedelta

import pytest
from PIL import Image

import models
import utils
from routers import proctor
from services import proctor_service
from tests import recruitment_helpers as h
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (student fixtures)

client = h.client
ANALYZE = "/api/proctor/analyze-frame"
STATUS = "/api/proctor/status"


def jpeg_b64(size=(320, 240), color="white", prefix=True, fmt="JPEG"):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/{fmt.lower()};base64,{b64}" if prefix else b64


@pytest.fixture(autouse=True)
def _fresh_limits():
    def reset():
        for limiter in (proctor.frame_limiter, proctor.auth_fail_limiter, proctor.status_limiter):
            limiter.reset()
        for gate in (proctor.principal_gate, proctor.inference_gate):
            gate.reset()
        h.reset_public_limiters()
    reset()
    yield
    reset()


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def sittings(db):
    """Two organizations, each with a published job and one started recruitment sitting."""
    mp = pytest.MonkeyPatch()
    out = []
    for _ in range(2):
        admin = h.make_admin(db)
        job = h.create_published_job(admin, mp)
        token, _email = h.register_ok(job["share_token"])
        started = h.start_ok(job["share_token"], token)
        out.append({"admin": admin, "started": started})
    yield out
    mp.undo()
    h.cleanup_orgs(db, [o["admin"]["org"].id for o in out])


def session_headers(started):
    """The recruitment credential. Deliberately WITHOUT the volatile lease: the endpoint must not need it."""
    return {"X-Session-Id": started["session_uuid"], "X-Session-Token": started["session_token"]}


# ------------------------------------------------------------------------------ authorization: who may analyze frames
def test_unauthenticated_requests_are_rejected_before_any_work(monkeypatch):
    called = []
    monkeypatch.setattr(proctor_service, "analyze_frame", lambda *_a, **_k: called.append(1))
    monkeypatch.setattr(proctor, "analyze_frame", lambda *_a, **_k: called.append(1))
    r = client.post(ANALYZE, json={"image": jpeg_b64()})
    assert r.status_code == 401 and not called
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"Authorization": "Basic abc"}).status_code == 401
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"X-Invitation-Token": "nope"}).status_code == 403
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"X-Session-Id": "x", "X-Session-Token": "y"}).status_code == 403
    assert not called


def test_unauthorized_requests_do_not_read_the_body(monkeypatch):
    """Authorization runs before the body is read: an unauthenticated 5 MB upload is refused without being buffered."""
    consumed = []
    original = proctor._read_capped_json

    async def spy(request):
        consumed.append(1)
        return await original(request)

    monkeypatch.setattr(proctor, "_read_capped_json", spy)
    assert client.post(ANALYZE, content=b"x" * 5_000_000, headers={"Content-Type": "application/json"}).status_code == 401
    assert not consumed


def test_student_account_can_analyze_frames(setup_test_data):
    r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=setup_test_data["auth_headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and body["person_count"] == 0 and "no_person" in body["violations"]


def test_deactivated_or_unknown_accounts_are_rejected(db):
    tag = h.new_tag()
    user = models.User(email=f"proctor.off.{tag}@rwtest.com", hashed_password=utils.get_password_hash("x"), role=models.UserRole.STUDENT, is_active=False)
    db.add(user)
    db.commit()
    token = utils.create_access_token(data={"sub": user.email, "role": user.role})
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"Authorization": f"Bearer {token}"}).status_code == 401
    ghost = utils.create_access_token(data={"sub": f"ghost.{tag}@rwtest.com", "role": "STUDENT"})
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"Authorization": f"Bearer {ghost}"}).status_code == 401
    db.query(models.User).filter(models.User.id == user.id).delete()
    db.commit()


def test_invitation_sitting_can_analyze_and_expired_invitation_cannot(db):
    org = models.Organization(name=f"Inv Org {h.new_tag()}", slug=f"inv-org-{h.new_tag()}", status="active")
    db.add(org)
    db.commit()
    cand = models.Candidate(name="Inv Candidate", email=f"inv.{h.new_tag()}@rwtest.com", organization_id=org.id)
    db.add(cand)
    db.commit()
    live, dead = f"live-{uuid.uuid4().hex}", f"dead-{uuid.uuid4().hex}"
    for token, delta in ((live, timedelta(days=1)), (dead, -timedelta(days=1))):
        db.add(models.CandidateInvitation(organization_id=org.id, candidate_id=cand.id, invitation_token=token, status="PENDING",
                                          expires_at=datetime.utcnow() + delta))
    db.commit()
    try:
        assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"X-Invitation-Token": live}).status_code == 200
        assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"X-Invitation-Token": dead}).status_code == 403
    finally:
        db.query(models.CandidateInvitation).filter(models.CandidateInvitation.organization_id == org.id).delete()
        db.query(models.Candidate).filter(models.Candidate.id == cand.id).delete()
        db.query(models.Organization).filter(models.Organization.id == org.id).delete()
        db.commit()


def test_recruitment_candidate_uses_only_the_session_capability(sittings):
    """No student account, no lease: the recruitment capability alone is enough while the sitting is in progress."""
    r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=session_headers(sittings[0]["started"]))
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_analysis_does_not_touch_the_sitting(db, sittings):
    started = sittings[0]["started"]
    before = h.session_row(db, started["session_uuid"])
    snapshot = (before.current_state, before.last_heartbeat_at, before.active_lease_hash, before.overall_deadline_at)
    for _ in range(3):
        assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers=session_headers(started)).status_code == 200
    after = h.session_row(db, started["session_uuid"])
    assert (after.current_state, after.last_heartbeat_at, after.active_lease_hash, after.overall_deadline_at) == snapshot


def test_tenant_isolation_between_recruitment_sittings(sittings):
    a, b = sittings[0]["started"], sittings[1]["started"]
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers=session_headers(a)).status_code == 200
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers=session_headers(b)).status_code == 200
    # a capability for sitting A never authorizes sitting B (and the failure reveals nothing about B)
    crossed = {"X-Session-Id": b["session_uuid"], "X-Session-Token": a["session_token"]}
    r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=crossed)
    assert r.status_code == 403 and r.json() == {"detail": "Not authorized."}
    unknown = {"X-Session-Id": str(uuid.uuid4()), "X-Session-Token": a["session_token"]}
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers=unknown).json() == r.json()      # same answer: no enumeration


def test_student_sessions_are_not_reachable_with_a_recruitment_capability(db_session, setup_test_data, sittings):
    from services import roleready_service as rs
    student = rs.create_student_session(db=db_session, student_profile=setup_test_data["student_profile"], target_role="Dev", target_company="X")
    headers = {"X-Session-Id": student.session_uuid, "X-Session-Token": sittings[0]["started"]["session_token"]}
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers=headers).status_code == 403


def test_closed_sittings_lose_access(db, sittings):
    started = sittings[1]["started"]
    row = h.session_row(db, started["session_uuid"])
    original = row.current_state
    try:
        for state in ("ABANDONED", "COMPLETED", "TIMED_OUT"):
            row.current_state = state
            db.commit()
            r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=session_headers(started))
            assert r.status_code == 403, state
    finally:
        row.current_state = original
        db.commit()


# ------------------------------------------------------------------------------ request validation
@pytest.fixture
def student(setup_test_data):
    return setup_test_data["auth_headers"]


def test_malformed_bodies_are_rejected_cleanly(student):
    post = lambda **kw: client.post(ANALYZE, headers={**student, **kw.pop("headers", {})}, **kw)  # noqa: E731
    assert post(content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert post(content=b"", headers={"Content-Type": "application/json"}).status_code in (400, 422)
    assert post(json=["image"]).status_code == 422
    assert post(json={}).status_code == 422
    assert post(json={"image": 123}).status_code == 422
    assert post(json={"image": None}).status_code == 422
    assert post(json={"image": jpeg_b64(), "extra": "field"}).status_code == 422
    assert post(json={"image": ""}).status_code == 400


@pytest.mark.parametrize("image,detail", [
    ("invalid_base64_string!!!", "Invalid image encoding."),
    ("data:text/html;base64,PGh0bWw+", "Unsupported image type."),
    ("data:image/gif;base64,R0lGODlhAQABAAAAACw=", "Unsupported image type."),
    (base64.b64encode(b"this is not an image at all").decode(), "Unsupported image type."),
    ("A" * 40, "Unsupported image type."),
])
def test_invalid_images_are_400_with_a_safe_message(student, image, detail):
    r = client.post(ANALYZE, json={"image": image}, headers=student)
    assert r.status_code == 400 and r.json() == {"detail": detail}


def test_corrupt_jpeg_is_rejected_without_leaking_decoder_details(student):
    good = jpeg_b64(prefix=False)
    truncated = base64.b64encode(base64.b64decode(good)[:200]).decode()
    r = client.post(ANALYZE, json={"image": truncated}, headers=student)
    assert r.status_code == 400 and r.json() == {"detail": "Invalid image."}
    text = r.text.lower()
    assert not any(word in text for word in ("traceback", "pil", "file ", "\\\\", "/usr", "site-packages"))


def test_oversized_inputs_are_rejected(student):
    over_field = "A" * (proctor_service.MAX_BASE64_CHARS + 10)                      # inside the body allowance, beyond the field cap
    r = client.post(ANALYZE, json={"image": over_field}, headers=student)
    assert r.status_code == 400 and r.json() == {"detail": "Image is too large."}
    huge_body = "A" * (proctor_service.MAX_BASE64_CHARS + 50_000)
    r = client.post(ANALYZE, json={"image": huge_body}, headers=student)
    assert r.status_code == 413                                                     # refused by the body cap, never parsed
    # within the body cap but beyond the decoded-size cap
    blob = base64.b64encode(b"\xff\xd8\xff" + b"0" * (proctor_service.MAX_DECODED_BYTES + 100)).decode()
    assert client.post(ANALYZE, json={"image": blob}, headers=student).status_code == 400
    # a chunked upload (no Content-Length) is capped while streaming
    def chunks():
        for _ in range(8):
            yield b"x" * 400_000
    assert client.post(ANALYZE, content=chunks(), headers={**student, "Content-Type": "application/json"}).status_code == 413


def test_decompression_bomb_dimensions_are_rejected(student):
    big = jpeg_b64(size=(3000, 3000), color="black")                                # tiny on the wire, 9 megapixels decoded
    assert len(big) < proctor_service.MAX_BASE64_CHARS
    r = client.post(ANALYZE, json={"image": big}, headers=student)
    assert r.status_code == 400 and r.json() == {"detail": "Image dimensions are not allowed."}


def test_png_and_webp_and_raw_base64_are_accepted(student):
    for fmt in ("PNG", "WEBP"):
        assert client.post(ANALYZE, json={"image": jpeg_b64(fmt=fmt)}, headers=student).status_code == 200, fmt
    assert client.post(ANALYZE, json={"image": jpeg_b64(prefix=False)}, headers=student).status_code == 200


# ------------------------------------------------------------------------------ error hygiene
def test_internal_errors_never_reach_the_client(student, monkeypatch):
    class Exploding:
        names = {0: "person"}

        def __call__(self, *_a, **_k):
            raise RuntimeError("boom at C:\\secret\\models\\yolov8n.pt /srv/app/internal.py")

    monkeypatch.setattr(proctor_service, "get_model", lambda: Exploding())
    r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=student)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error" and body["error"] == "Frame analysis failed."
    assert "secret" not in r.text and "yolov8n" not in r.text and "internal.py" not in r.text


def test_model_unavailable_message_is_generic(student, monkeypatch):
    monkeypatch.setattr(proctor_service, "get_model", lambda: None)
    body = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=student).json()
    assert body["status"] == "error" and "file" not in body["error"].lower() and "yolo" not in body["error"].lower()


# ------------------------------------------------------------------------------ rate limits and resource protection
def test_frames_are_rate_limited_per_principal(student, sittings, monkeypatch):
    monkeypatch.setattr(proctor, "frame_limiter", proctor.SlidingWindowLimiter(3, 60))
    img = jpeg_b64()
    assert [client.post(ANALYZE, json={"image": img}, headers=student).status_code for _ in range(3)] == [200, 200, 200]
    limited = client.post(ANALYZE, json={"image": img}, headers=student)
    assert limited.status_code == 429 and limited.headers["Retry-After"]
    # another principal is unaffected by this one's budget
    assert client.post(ANALYZE, json={"image": img}, headers=session_headers(sittings[0]["started"])).status_code == 200


def test_failed_credential_attempts_are_throttled(monkeypatch):
    monkeypatch.setattr(proctor, "auth_fail_limiter", proctor.SlidingWindowLimiter(5, 60))
    codes = [client.post(ANALYZE, json={"image": jpeg_b64()}, headers={"X-Session-Id": "a", "X-Session-Token": f"guess{i}"}).status_code for i in range(8)]
    assert codes[:5] == [403] * 5 and codes[5:] == [429] * 3


def test_concurrent_frames_from_one_principal_are_refused(student, monkeypatch):
    seen = []

    class Busy:
        """A gate that reports a frame already in flight for this principal."""
        def acquire(self, key):
            seen.append(key)
            return False

        def release(self, key):
            raise AssertionError("never acquired, must not be released")

        def reset(self):
            pass

    monkeypatch.setattr(proctor, "principal_gate", Busy())
    r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=student)
    assert r.status_code == 429 and seen and seen[0][0] == "user"


def test_global_inference_capacity_is_bounded(student):
    taken = [proctor.inference_gate.acquire(proctor._GLOBAL) for _ in range(proctor.MAX_CONCURRENT_INFERENCES)]
    assert all(taken)
    r = client.post(ANALYZE, json={"image": jpeg_b64()}, headers=student)
    assert r.status_code == 503 and r.headers["Retry-After"]
    proctor.inference_gate.release(proctor._GLOBAL)
    assert client.post(ANALYZE, json={"image": jpeg_b64()}, headers=student).status_code == 200      # capacity returned


def test_gates_are_released_after_every_outcome(student):
    for payload in ({"image": ""}, {"image": "bad!!"}, {"nope": 1}, {"image": jpeg_b64()}):
        client.post(ANALYZE, json=payload, headers=student)
    assert not proctor.principal_gate._active and not proctor.inference_gate._active


# ------------------------------------------------------------------------------ /status
def test_public_status_is_minimal(setup_test_data):
    r = client.get(STATUS)
    assert r.status_code == 200 and r.json() == {"status": "ready"}
    text = r.text.lower()
    assert not any(word in text for word in ("yolov8", ".pt", "classes", "threshold", "cell phone"))


def test_authenticated_status_keeps_diagnostic_detail(student):
    data = client.get(STATUS, headers=student).json()
    assert data["status"] == "ready" and "yolov8n" in data["model_file"]
    assert "person" in data["classes_supported"] and "cell phone" in data["classes_supported"]


def test_status_with_a_bad_token_is_still_only_minimal():
    assert client.get(STATUS, headers={"Authorization": "Bearer garbage"}).json() == {"status": "ready"}


def test_status_reports_error_without_detail_when_the_model_is_missing(monkeypatch):
    monkeypatch.setattr(proctor_service, "get_model", lambda: None)
    assert client.get(STATUS).json() == {"status": "error"}


def test_status_is_rate_limited(monkeypatch):
    monkeypatch.setattr(proctor, "status_limiter", proctor.SlidingWindowLimiter(2, 60))
    assert [client.get(STATUS).status_code for _ in range(3)] == [200, 200, 429]
