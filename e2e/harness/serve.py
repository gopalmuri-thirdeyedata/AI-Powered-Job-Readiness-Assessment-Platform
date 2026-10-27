"""
End-to-end test harness: the REAL FastAPI app on a scratch database, with exactly these substitutions and additions
(none of them exist in the production code path):

  * code sandbox   -> this machine's Python and JDK (javac / java) instead of Judge0 (which is an external service);
                      candidate code is executed locally ONLY in this harness, never by the application itself;
  * Gemini         -> the app's built-in offline mock mode (GEMINI_MOCK_MODE) - deterministic, no network, no quota;
  * ElevenLabs     -> an in-process stub (no billable speech calls) unless E2E_LIVE_VOICE=1;
  * clock          -> a test-controlled offset (POST /__e2e/advance) so timers can be exercised without waiting;
  * /__e2e/*       -> test-only routes to mint tokens, seed organizations and inspect persisted state.

Safety: it refuses to start unless DATABASE_URL points inside the E2E temp directory, so a real database can never be used.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import types
from datetime import timedelta

BACKEND = os.environ.get("E2E_BACKEND_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

DB_URL = os.environ.get("DATABASE_URL", "")
E2E_DIR = os.path.abspath(os.environ.get("E2E_DIR", ""))
if not (DB_URL.startswith("sqlite:///") and E2E_DIR and os.path.abspath(DB_URL.replace("sqlite:///", "", 1)).startswith(E2E_DIR)):
    sys.exit("e2e harness: DATABASE_URL must be a sqlite file inside E2E_DIR (refusing to touch any other database)")
if os.path.basename(DB_URL).lower() in ("hiringai.db", "prepwin.db"):
    sys.exit("e2e harness: refusing to use production database")

os.environ.setdefault("GEMINI_MOCK_MODE", "true")
os.environ["ASSESSMENT_SWEEPER_ENABLED"] = os.environ.get("ASSESSMENT_SWEEPER_ENABLED", "false")   # deterministic: backend tests cover the sweeper

import uvicorn  # noqa: E402
from fastapi import APIRouter, HTTPException  # noqa: E402
from services import assessment_clock, elevenlabs_service, judge0_service  # noqa: E402

# ------------------------------------------------------------------------------ local real-runtime sandbox
EXEC_LOG = []


def local_exec(language_key, code, stdin=""):
    EXEC_LOG.append(language_key)
    work = tempfile.mkdtemp(prefix="e2e_run_", dir=E2E_DIR)
    try:
        if language_key == "java":
            src = os.path.join(work, "Main.java")
            with open(src, "w", encoding="utf-8") as fh:
                fh.write(code)
            compiled = subprocess.run(["javac", "-d", work, src], capture_output=True, text=True, timeout=60)
            if compiled.returncode != 0:
                return {"status": "error", "output": compiled.stderr, "stdout": "", "stderr": "", "compile_output": compiled.stderr,
                        "timed_out": False, "execution_time_ms": None, "raw": {}}
            run = subprocess.run(["java", "-cp", work, "Main"], input=stdin, capture_output=True, text=True, timeout=30)
        else:
            src = os.path.join(work, "main.py")
            with open(src, "w", encoding="utf-8") as fh:
                fh.write(code)
            run = subprocess.run([sys.executable, "-I", src], input=stdin, capture_output=True, text=True, timeout=30)
        return {"status": "success" if run.returncode == 0 else "failed", "output": run.stdout if run.returncode == 0 else (run.stderr or run.stdout),
                "stdout": run.stdout, "stderr": run.stderr, "compile_output": "", "timed_out": False, "execution_time_ms": 1.0, "raw": {}}
    except subprocess.TimeoutExpired:
        return {"status": "failed", "output": judge0_service.TIMEOUT_MESSAGE, "stdout": "", "stderr": "", "compile_output": "",
                "timed_out": True, "execution_time_ms": None, "raw": {}}
    finally:
        shutil.rmtree(work, ignore_errors=True)


judge0_service.execute_code = local_exec

# ------------------------------------------------------------------------------ ElevenLabs stub (speech-to-text / text-to-speech)
VOICE_CALLS = []
if os.environ.get("E2E_LIVE_VOICE", "").lower() not in ("1", "true", "yes"):
    class _Resp:
        def __init__(self, status, body=None, content=b""):
            self.status_code, self._b, self.content, self.text = status, body, content, str(body)

        def json(self):
            return self._b

    def _voice_post(url, params=None, headers=None, json=None, data=None, files=None, timeout=None):
        VOICE_CALLS.append(("POST", url.rsplit("/", 1)[-1]))
        if url.endswith("/speech-to-text"):
            return _Resp(200, {"text": "I would start by profiling the slow path."})
        return _Resp(200, content=b"ID3-e2e-fake-mp3")

    elevenlabs_service.requests = types.SimpleNamespace(post=_voice_post, RequestException=Exception)   # this module's name only, not requests.post
    os.environ["ELEVENLABS_API_KEY"] = os.environ.get("ELEVENLABS_API_KEY") or "e2e-stub-key"
    os.environ["ELEVENLABS_VOICE_ID"] = os.environ.get("ELEVENLABS_VOICE_ID") or "e2e-stub-voice"

# ------------------------------------------------------------------------------ controllable clock
OFFSET = {"seconds": 0}
_real_now = assessment_clock.now
assessment_clock.now = lambda: _real_now() + timedelta(seconds=OFFSET["seconds"])

from main import app  # noqa: E402
import database  # noqa: E402
import models  # noqa: E402
import utils  # noqa: E402
from services import assessment_flow_service as flow, roleready_service as rs  # noqa: E402

JD_TEXT = ("We are hiring a Full Stack Engineer to build Python and FastAPI services backed by SQL databases, "
           "design REST APIs, and own reliability and performance in production.")
# Blueprints come from the application's own generate-blueprint path with Gemini in OFFLINE MOCK mode (a fixed 15 / 2 / 5 fixture:
# "Sum Two Numbers" and "Reverse String"); there is no template feature any more.

router = APIRouter(prefix="/__e2e")


def _db():
    return database.SessionLocal()


@router.post("/advance")
def advance(seconds: int):
    """Move the server clock forward (test-only). Never moves backwards."""
    if seconds < 0:
        raise HTTPException(400, "forward only")
    OFFSET["seconds"] += seconds
    return {"offset_seconds": OFFSET["seconds"]}


@router.get("/info")
def info():
    return {"offset_seconds": OFFSET["seconds"], "executions": list(EXEC_LOG), "voice_calls": list(VOICE_CALLS)}


E2E_PASSWORD = "E2e-Test-Passw0rd!"   # throw-away accounts in a throw-away database; used for the REAL cookie login


@router.post("/org-admin")
def org_admin(tag: str):
    """Create an organization + organization admin; returns its credentials (real login) and a Bearer token for API-only calls (test-only)."""
    db = _db()
    try:
        org = models.Organization(name=f"E2E Org {tag}", slug=f"e2e-org-{tag}", status="active")
        db.add(org)
        db.commit()
        user = models.User(email=f"e2e.admin.{tag}@e2e.test", hashed_password=utils.get_password_hash(E2E_PASSWORD),
                           role=models.UserRole.ORGANIZATION_ADMIN, organization_id=org.id, is_active=True)
        db.add(user)
        db.commit()
        db.add(models.OrganizationMember(organization_id=org.id, user_id=user.id, role="ORGANIZATION_ADMIN", status="active"))
        db.commit()
        return {"org_id": org.id, "email": user.email, "password": E2E_PASSWORD,
                "token": utils.create_access_token(data={"sub": user.email, "role": user.role})}
    finally:
        db.close()


@router.post("/student")
def student(tag: str):
    """Create a student account + profile; returns its credentials (real login) and a Bearer token for API-only calls (test-only)."""
    db = _db()
    try:
        org = db.query(models.Organization).filter_by(slug="e2e-students").first()
        if org is None:
            org = models.Organization(name="E2E Students", slug="e2e-students", status="active")
            db.add(org)
            db.commit()
        email = f"e2e.student.{tag}@e2e.test"
        user = models.User(email=email, hashed_password=utils.get_password_hash(E2E_PASSWORD), role=models.UserRole.STUDENT,
                           organization_id=org.id, is_active=True, password_changed=True)
        db.add(user)
        db.commit()
        profile = models.StudentProfile(user_id=user.id, organization_id=org.id, full_name="E2E Student", email=email,
                                        target_role="Full Stack Engineer", is_onboarded=True)
        db.add(profile)
        db.commit()
        return {"email": email, "password": E2E_PASSWORD, "token": utils.create_access_token(data={"sub": email, "role": user.role}), "profile_id": profile.id}
    finally:
        db.close()


@router.get("/session/{session_uuid}")
def session_state(session_uuid: str):
    """Persisted truth for assertions (test-only): state, section scores, overall column, scoring model."""
    db = _db()
    try:
        s = db.query(models.RoleReadySession).filter_by(session_uuid=session_uuid).first()
        if s is None:
            raise HTTPException(404, "no such session")
        rounds = {r.round_type: {"status": r.status, "score": r.score, "limit": r.time_limit_minutes,
                                 "violations": len(r.proctoring_violations or [])}
                  for r in db.query(models.RoleReadyRoundAttempt).filter_by(session_id=s.id)}
        report = s.final_report_data if isinstance(s.final_report_data, dict) else {}
        return {"state": s.current_state, "workflow": s.workflow_type, "aptitude": s.aptitude_score, "coding": s.coding_score,
                "interview": s.interview_score, "overall_column": s.overall_readiness_score,
                "reported_overall": rs.reported_overall(s), "scoring_model": report.get("scoring_model"),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "overall_deadline_at": s.overall_deadline_at.isoformat() if s.overall_deadline_at else None, "rounds": rounds}
    finally:
        db.close()


@router.post("/seed-job")
def seed_job(admin_token: str, title: str = "Full Stack Engineer"):
    """Create a job, generate its blueprint (offline Gemini mock) and publish it for an org admin token (test-only). Returns the share token."""
    from fastapi.testclient import TestClient
    c = TestClient(app)
    headers = {"Authorization": f"Bearer {admin_token}"}
    job = c.post("/api/admin/job-roles/", headers=headers, json={"title": title, "description": JD_TEXT})
    if job.status_code != 201:
        raise HTTPException(500, f"job create failed: {job.status_code}")
    job_id = job.json()["id"]
    for path in (f"/api/admin/job-roles/{job_id}/generate-blueprint", f"/api/admin/job-roles/{job_id}/publish"):
        r = c.post(path, headers=headers, json={})
        if r.status_code != 200:
            raise HTTPException(500, f"{path} failed: {r.status_code}")
    return {"job_id": job_id, "share_token": r.json()["share_token"]}


app.include_router(router)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8011")), log_level="warning")
