"""Shared helpers for the recruitment-workflow test modules (not collected as tests)."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import database
import models
import utils
from main import app
from services import assessment_clock, gemini_mock_fixtures, jd_blueprint_service

client = TestClient(app)


class FakeClock:
    """Controllable server clock: monkeypatch `assessment_clock.now` with `clock.now`."""

    def __init__(self, start=None):
        self.current = start or datetime.now(timezone.utc)

    def now(self):
        return self.current

    def advance(self, seconds):
        self.current = self.current + timedelta(seconds=seconds)
        return self.current

    def set(self, dt):
        self.current = dt


def new_tag():
    return uuid.uuid4().hex[:8]


def make_admin(db, org=None, tag=None, member_role="ORGANIZATION_ADMIN", user_role=None, active=True):
    tag = tag or new_tag()
    if org is None:
        org = models.Organization(name=f"RW Org {tag}", slug=f"rw-org-{tag}", status="active")
        db.add(org)
        db.commit()
        db.refresh(org)
    # Platform scope is the stored SUPER_ADMIN role (never an e-mail pattern); every other member role is an ordinary ADMIN account
    role = user_role or (models.UserRole.SUPER_ADMIN if member_role == "PLATFORM_ADMIN"
                         else models.UserRole.ORGANIZATION_ADMIN if member_role == "ORGANIZATION_ADMIN" else models.UserRole.HR)
    email_prefix = "platform" if (member_role == "PLATFORM_ADMIN" or "platform" in str(tag).lower()) else "rw.admin"
    user = models.User(email=f"{email_prefix}.{tag}@rwtest.com", hashed_password=utils.get_password_hash("password123"),
                       role=role, organization_id=org.id, is_active=active)
    db.add(user)
    db.commit()
    db.refresh(user)
    member = models.OrganizationMember(organization_id=org.id, user_id=user.id, role=member_role, status="active")
    db.add(member)
    db.commit()
    token = utils.create_access_token(data={"sub": user.email, "role": user.role})
    return {"org": org, "user": user, "member": member, "token": token}


def auth(token, org_id=None):
    h = {"Authorization": f"Bearer {token}"}
    if org_id is not None:
        h["X-Organization-Id"] = str(org_id)
    return h


def patch_gemini_blueprint(monkeypatch, blueprint=None, fail=False):
    """Make blueprint generation deterministic and offline."""
    calls = {"n": 0}

    def fake_call(prompt, system_prompt="", temperature=0.1, json_mode=True, timeout=None):
        calls["n"] += 1
        if fail:
            raise jd_blueprint_service.gemini_client.GeminiUnavailableError("simulated outage")
        return blueprint if blueprint is not None else gemini_mock_fixtures.sample_blueprint()

    monkeypatch.setattr(jd_blueprint_service.gemini_client, "call_gemini", fake_call)
    monkeypatch.setattr(jd_blueprint_service, "_sleep", lambda s: None)
    return calls


JD_TEXT = ("We are hiring a Backend Engineer to build Python and FastAPI services backed by SQL databases, "
           "design REST APIs, and own reliability and performance in production.")


def create_job(admin, title="Backend Engineer", description=JD_TEXT):
    r = client.post("/api/admin/job-roles/", headers=auth(admin["token"]), json={"title": title, "description": description})
    assert r.status_code == 201, r.text
    return r.json()


def create_published_job(admin, monkeypatch, **kw):
    patch_gemini_blueprint(monkeypatch)
    job = create_job(admin, **kw)
    r = client.post(f"/api/admin/job-roles/{job['id']}/generate-blueprint", headers=auth(admin["token"]))
    assert r.status_code == 200, r.text
    r = client.post(f"/api/admin/job-roles/{job['id']}/publish", headers=auth(admin["token"]))
    assert r.status_code == 200, r.text
    return r.json()


def register(share_token, email=None, name="Test Candidate", phone="+14155550123"):
    email = email or f"cand.{new_tag()}@example.com"
    r = client.post(f"/api/public/assessment/{share_token}/register", json={"name": name, "phone": phone, "email": email})
    return r, email


def register_ok(share_token, **kw):
    r, email = register(share_token, **kw)
    assert r.status_code == 200, r.text
    return r.json()["registration_token"], email


def start(share_token, registration_token, acknowledged=True):
    return client.post(f"/api/public/assessment/{share_token}/start", headers={"X-Registration-Token": registration_token},
                       json={"acknowledged": acknowledged})


def start_ok(share_token, registration_token):
    r = start(share_token, registration_token)
    assert r.status_code == 200, r.text
    return r.json()


def sh(started, lease=True):
    h = {"X-Session-Token": started["session_token"]}
    if lease:
        h["X-Session-Lease"] = started["session_lease"]
    return h


def sess_url(started, path):
    return f"/api/public/assessment/session/{started['session_uuid']}/{path}"


def correct_aptitude_answers(db, session_uuid, count=None):
    sess = db.query(models.RoleReadySession).filter_by(session_uuid=session_uuid).first()
    rnd = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=sess.id, round_type="APTITUDE").first()
    keys = {qid: info["correct_key"] for qid, info in rnd.server_keys_payload.items()}
    items = list(keys.items())
    return {qid: key for qid, key in (items[:count] if count is not None else items)}


def session_row(db, session_uuid):
    db.expire_all()
    return db.query(models.RoleReadySession).filter_by(session_uuid=session_uuid).first()


def cleanup_orgs(db, org_ids):
    """Remove everything a test created (SQLite has no FK enforcement here, so cascades are explicit)."""
    db.rollback()
    org_ids = [o for o in org_ids if o]
    if not org_ids:
        return
    sess_ids = [r[0] for r in db.query(models.RoleReadySession.id).filter(models.RoleReadySession.organization_id.in_(org_ids))]
    if sess_ids:
        db.query(models.RoleReadyRoundAttempt).filter(models.RoleReadyRoundAttempt.session_id.in_(sess_ids)).delete(synchronize_session=False)
        db.query(models.RoleReadySession).filter(models.RoleReadySession.id.in_(sess_ids)).delete(synchronize_session=False)
    db.query(models.CandidateRegistration).filter(models.CandidateRegistration.organization_id.in_(org_ids)).delete(synchronize_session=False)
    job_ids = [r[0] for r in db.query(models.JobDescription.id).filter(models.JobDescription.organization_id.in_(org_ids))]
    if job_ids:
        db.query(models.JobShareLinkHistory).filter(models.JobShareLinkHistory.job_description_id.in_(job_ids)).delete(synchronize_session=False)
        db.query(models.JobBlueprintVersion).filter(models.JobBlueprintVersion.job_description_id.in_(job_ids)).delete(synchronize_session=False)
        db.query(models.JobDescription).filter(models.JobDescription.id.in_(job_ids)).delete(synchronize_session=False)
    db.query(models.ActivityLog).filter(models.ActivityLog.organization_id.in_(org_ids)).delete(synchronize_session=False)
    user_ids = [r[0] for r in db.query(models.OrganizationMember.user_id).filter(models.OrganizationMember.organization_id.in_(org_ids))]
    db.query(models.OrganizationMember).filter(models.OrganizationMember.organization_id.in_(org_ids)).delete(synchronize_session=False)
    # rows that reference these orgs/users must go first (MySQL enforces the foreign keys; SQLite here does not)
    gs = db.query(models.GlobalSettings).filter(models.GlobalSettings.organization_id.in_(org_ids))
    gs.delete(synchronize_session=False)
    if user_ids:
        db.query(models.GlobalSettings).filter(models.GlobalSettings.created_by.in_(user_ids)).delete(synchronize_session=False)
        db.query(models.IncidentRecord).filter(models.IncidentRecord.created_by.in_(user_ids)).delete(synchronize_session=False)
    if user_ids:
        db.query(models.User).filter(models.User.id.in_(user_ids), models.User.email.like("%@rwtest.com")).delete(synchronize_session=False)
    db.query(models.Candidate).filter(models.Candidate.organization_id.in_(org_ids)).delete(synchronize_session=False)
    db.query(models.Organization).filter(models.Organization.id.in_(org_ids)).delete(synchronize_session=False)
    db.commit()


def reset_public_limiters():
    from routers import public_assessment
    from services import assessment_flow_service as flow
    public_assessment.register_limiter.reset()
    public_assessment.start_limiter.reset()
    public_assessment.meta_limiter.reset()
    flow.run_code_limiter.reset()
    flow.run_code_gate.reset()
    flow.vapi_init_limiter.reset()


def install_local_sandbox(monkeypatch, fail=False):
    """Replace the Judge0 call with a local subprocess so coding evaluation runs for real, offline."""
    import os
    import subprocess
    import sys
    import tempfile
    from services import piston_service

    calls = {"n": 0, "sources": [], "stdins": [], "languages": []}

    def local_exec(language_key, code, stdin=""):
        calls["n"] += 1
        calls["sources"].append(code)
        calls["stdins"].append(stdin)
        calls["languages"].append(language_key)
        if language_key == "java":   # no JDK is assumed locally: a routing stand-in, never counted as a live Java run
            return {"status": "success", "output": "", "stdout": "", "stderr": "", "compile_output": "",
                    "timed_out": False, "execution_time_ms": 1.0, "raw": {}}
        if fail:
            return {"status": "service_error", "output": "connection refused", "stdout": "", "stderr": "",
                    "compile_output": "", "timed_out": False, "execution_time_ms": None, "raw": {}}
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
            path = f.name
        try:
            p = subprocess.run([sys.executable, path], input=stdin, capture_output=True, text=True, timeout=30)
        finally:
            os.unlink(path)
        return {"status": "success" if p.returncode == 0 else "failed", "output": p.stdout, "stdout": p.stdout,
                "stderr": p.stderr, "compile_output": "", "timed_out": False, "execution_time_ms": 1.0, "raw": {}}

    monkeypatch.setattr(piston_service, "execute_code", local_exec)
    return calls


# Blueprint problems reach the candidate in the student stdin format (see assessment_engine.adapt_blueprint): one JSON value
# per line on standard input, the JSON-encoded result on standard output. This is the harness the Python starter code carries.
STDIN_HARNESS = (
    "\n\nif __name__ == \"__main__\":\n"
    "    import json, sys\n"
    "    _args = [json.loads(line) for line in sys.stdin.read().splitlines() if line.strip()]\n"
    "    print(json.dumps(solve(*_args)))\n"
)


def program(solve_source):
    return solve_source.rstrip() + STDIN_HARNESS


GOOD_SOLUTIONS = {
    "C1": {"language": "python", "code": program("def solve(a, b):\n    return a + b\n")},
    "C2": {"language": "python", "code": program("def solve(s):\n    return s[::-1]\n")},
}


def patch_interview_eval(monkeypatch, score=80.0, source="ai"):
    from services import interview_evaluation

    def fake(questions, answers, role, jd_summary="", resume_summary="", transcript=None, call_gemini_fn=None):
        return {"score": score, "overall_score": score, "summary": "ok", "evaluation_source": source,
                "question_evaluations": [{"question_id": i + 1, "score": score, "status": "correct", "explanation": "fine",
                                          "demonstrated_strengths": ["x"], "knowledge_gaps": []} for i in range(len(questions))]}

    monkeypatch.setattr(interview_evaluation, "evaluate_five_technical_questions", fake)


def new_session():
    """
    Test session. MySQL defaults to REPEATABLE READ, so a long-lived fixture session would never see rows the API
    commits afterwards; READ COMMITTED matches what each short-lived API request sees. SQLite is unaffected.
    """
    from sqlalchemy.orm import sessionmaker
    if database.engine.dialect.name == "mysql":
        return sessionmaker(bind=database.engine.execution_options(isolation_level="READ COMMITTED"),
                            autocommit=False, autoflush=False)()
    return database.SessionLocal()
