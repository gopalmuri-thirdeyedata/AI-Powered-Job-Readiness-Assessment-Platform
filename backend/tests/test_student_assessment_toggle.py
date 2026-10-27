"""
Admin-controlled access to the NORMAL student assessment (User Management -> Assessment Access).

Proves: students start locked; an Admin / Super Admin grants and revokes ONE student at a time inside their own organization; the lock
is enforced by the backend (not just hidden in the UI), for creating a session AND for the first start of a session created earlier;
revoking never ends an attempt in progress and never touches history; students cannot grant themselves; recruitment / recruiter-invitation
sessions, the rest of the student area and the schema migration are unaffected.
"""
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text

import models
import utils
import migrate_student_assessment_toggle as migration
from services import assessment_access
from tests import recruitment_helpers as h

client = h.client
USERS = "/api/admin/users"
PW = "Zx9#pLm2!qWe-4417"
JD = "Looking for a Backend Developer skilled in Python, FastAPI and SQL."
LOCKED = "ASSESSMENT_ACCESS_LOCKED"


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def world(db):
    a = h.make_admin(db)                                                            # ADMIN of org A
    b = h.make_admin(db)                                                            # ADMIN of org B (a different tenant)
    sa = h.make_admin(db, org=a["org"], tag="platform" + h.new_tag(), member_role="PLATFORM_ADMIN")   # SUPER_ADMIN in org A
    created = []
    yield {"a": a, "b": b, "sa": sa, "created": created}
    if created:
        db.rollback()
        sess = [r[0] for r in db.query(models.RoleReadySession.id).filter(models.RoleReadySession.student_profile_id.in_(
            db.query(models.StudentProfile.id).filter(models.StudentProfile.user_id.in_(created))))]
        if sess:
            db.query(models.RoleReadyRoundAttempt).filter(models.RoleReadyRoundAttempt.session_id.in_(sess)).delete(synchronize_session=False)
            db.query(models.RoleReadySession).filter(models.RoleReadySession.id.in_(sess)).delete(synchronize_session=False)
        db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id.in_(created)).delete(synchronize_session=False)
        db.query(models.StudentProfile).filter(models.StudentProfile.user_id.in_(created)).delete(synchronize_session=False)
        db.commit()
    h.cleanup_orgs(db, [a["org"].id, b["org"].id])
    if created:
        db.query(models.User).filter(models.User.id.in_(created)).delete(synchronize_session=False)
        db.commit()


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setenv("GEMINI_MOCK_MODE", "true")   # question generation never reaches the network


def make_student(world, admin, name="Asha Rao"):
    email = f"{name.lower().replace(' ', '.')}.{h.new_tag()}@students.example.org"
    r = client.post(f"{USERS}/", headers=h.auth(admin["token"]), json={"role": "STUDENT", "full_name": name, "email": email, "password": PW})
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    world["created"].append(user["id"])
    token = utils.create_access_token(data={"sub": email, "role": "STUDENT"})
    return {**user, "token": token, "headers": {"Authorization": f"Bearer {token}"}}


def set_access(actor, student_id, granted, org_id=None):
    return client.put(f"{USERS}/{student_id}/assessment-access", headers=h.auth(actor["token"], org_id), json={"granted": granted})


def access_of(student):
    r = client.get("/api/roleready/student/assessment-access", headers=student["headers"])
    assert r.status_code == 200, r.text
    return r.json()["access_granted"]


def initialize(student):
    return client.post("/api/roleready/student/initialize", headers=student["headers"],
                       data={"target_role": "Backend Developer", "custom_jd_text": JD})


def start(student, session_uuid):
    return client.post(f"/api/roleready/session/{session_uuid}/start-aptitude", headers=student["headers"])


def row_in_list(admin, user_id):
    r = client.get(f"{USERS}/", headers=h.auth(admin["token"]), params={"page_size": 100})
    assert r.status_code == 200, r.text
    return next(i for i in r.json()["items"] if i["id"] == user_id)


def is_locked_refusal(res):
    return res.status_code == 403 and res.json()["detail"]["code"] == LOCKED


# ---------------------------------------------------------------- initial policy
def test_new_students_start_locked_and_the_backend_refuses_to_create_a_session(world):
    s = make_student(world, world["a"])
    assert access_of(s) is False
    assert row_in_list(world["a"], s["id"])["assessment_access_granted"] is False
    res = initialize(s)
    assert is_locked_refusal(res), res.text
    assert "contact your admin" in res.json()["detail"]["message"].lower()


def test_the_lock_does_not_hide_the_rest_of_the_student_area(world):
    s = make_student(world, world["a"])
    assert client.get("/api/roleready/student/assessments", headers=s["headers"]).status_code == 200
    assert client.get("/api/roleready/student/history", headers=s["headers"]).status_code == 200


# ---------------------------------------------------------------- admin and super admin
def test_admin_grants_and_revokes_and_it_is_audited(db, world):
    a = world["a"]
    s = make_student(world, a)
    r = set_access(a, s["id"], True)
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is True and r.json()["user"]["assessment_access_granted"] is True and "granted" in r.json()["message"]
    assert access_of(s) is True and row_in_list(a, s["id"])["assessment_access_granted"] is True
    assert initialize(s).status_code == 200                       # works with no new login, no account re-creation

    r = set_access(a, s["id"], False)
    assert r.status_code == 200 and r.json()["user"]["assessment_access_granted"] is False
    assert access_of(s) is False
    assert is_locked_refusal(initialize(s))

    db.expire_all()
    actions = [x.action for x in db.query(models.ActivityLog).filter(models.ActivityLog.target == s["email"]).order_by(models.ActivityLog.id)]
    assert "assessment_access_granted" in actions and "assessment_access_revoked" in actions
    profile = db.query(models.StudentProfile).filter_by(user_id=s["id"]).first()
    assert profile.assessment_access_updated_by == a["user"].id and profile.assessment_access_updated_at is not None


def test_repeating_a_change_is_harmless_and_says_so(world):
    a = world["a"]
    s = make_student(world, a)
    assert set_access(a, s["id"], True).json()["changed"] is True
    again = set_access(a, s["id"], True)
    assert again.status_code == 200 and again.json()["changed"] is False and "already" in again.json()["message"]


def test_super_admin_grants_and_revokes(world):
    sa = world["sa"]
    s = make_student(world, world["a"])
    assert set_access(sa, s["id"], True, org_id=world["a"]["org"].id).status_code == 200
    assert access_of(s) is True and initialize(s).status_code == 200
    assert set_access(sa, s["id"], False, org_id=world["a"]["org"].id).status_code == 200
    assert access_of(s) is False


def test_one_students_permission_never_changes_anothers(world):
    a = world["a"]
    s1, s2, s3 = (make_student(world, a, n) for n in ("Ravi Kumar", "Meera Nair", "Dev Shah"))
    set_access(a, s1["id"], True)
    assert (access_of(s1), access_of(s2), access_of(s3)) == (True, False, False)
    assert initialize(s1).status_code == 200
    assert is_locked_refusal(initialize(s2)) and is_locked_refusal(initialize(s3))
    set_access(a, s2["id"], True)
    set_access(a, s1["id"], False)
    assert (access_of(s1), access_of(s2), access_of(s3)) == (False, True, False)


# ---------------------------------------------------------------- who may change it
def test_a_student_cannot_grant_themselves_or_anyone(world):
    a = world["a"]
    s, other = make_student(world, a), make_student(world, a)
    for target in (s, other):
        r = client.put(f"{USERS}/{target['id']}/assessment-access", headers=s["headers"], json={"granted": True})
        assert r.status_code == 403, r.text
    assert access_of(s) is False and access_of(other) is False
    assert client.put(f"{USERS}/{s['id']}/assessment-access", json={"granted": True}).status_code in (401, 403)   # anonymous
    assert is_locked_refusal(initialize(s))


def test_an_admin_cannot_manage_another_organizations_student(world):
    s = make_student(world, world["a"])
    r = set_access(world["b"], s["id"], True)
    assert r.status_code == 404, r.text                           # no cross-tenant existence leak
    assert access_of(s) is False


def test_only_students_have_the_switch_and_the_hierarchy_holds(db, world):
    a, sa = world["a"], world["sa"]
    # an Admin may not touch an Admin or Super Admin; a Super Admin may reach them but they have no switch
    assert set_access(a, sa["user"].id, True).status_code == 403
    assert set_access(sa, a["user"].id, True, org_id=a["org"].id).status_code == 400
    assert set_access(a, 99999999, True).status_code == 404
    bad = client.put(f"{USERS}/{make_student(world, a)['id']}/assessment-access", headers=h.auth(a["token"]), json={})
    assert bad.status_code == 422


# ---------------------------------------------------------------- direct backend requests cannot bypass the lock
def test_a_session_created_while_granted_cannot_be_started_after_revoke(world):
    a = world["a"]
    s = make_student(world, a)
    set_access(a, s["id"], True)
    init = initialize(s)
    assert init.status_code == 200, init.text
    uuid = init.json()["session_uuid"]
    set_access(a, s["id"], False)

    blocked = start(s, uuid)                                       # NOT_STARTED + locked: the "start another assessment" path
    assert is_locked_refusal(blocked), blocked.text
    assert client.get(f"/api/roleready/session/{uuid}", headers=s["headers"]).json()["current_state"] == "NOT_STARTED"

    set_access(a, s["id"], True)                                   # granting again unlocks the very same session
    assert start(s, uuid).status_code == 200


def test_revoking_does_not_silently_terminate_an_attempt_in_progress(db, world):
    a = world["a"]
    s = make_student(world, a)
    set_access(a, s["id"], True)
    uuid = initialize(s).json()["session_uuid"]
    started = start(s, uuid)
    assert started.status_code == 200, started.text

    assert set_access(a, s["id"], False).status_code == 200

    status_res = client.get(f"/api/roleready/session/{uuid}", headers=s["headers"])
    assert status_res.status_code == 200 and status_res.json()["current_state"] == "APTITUDE_IN_PROGRESS"
    assert status_res.json()["is_completed"] is False and status_res.json()["is_timed_out"] is False
    draft = client.put(f"/api/roleready/session/{uuid}/draft", headers=s["headers"], json={"section": "aptitude", "payload": {"answers": {"1": "A"}}})
    assert draft.status_code == 200, draft.text
    assert start(s, uuid).status_code == 200                       # re-opening the running section still works while locked
    submitted = client.post(f"/api/roleready/session/{uuid}/submit-aptitude", headers=s["headers"], json={"answers": {"1": "A"}, "time_spent_seconds": 20})
    assert submitted.status_code == 200, submitted.text            # the student can finish what they started

    db.expire_all()
    session = db.query(models.RoleReadySession).filter_by(session_uuid=uuid).first()
    assert session.current_state not in ("TIMED_OUT", "ABANDONED", "TERMINATED") and session.current_state != "NOT_STARTED"
    # ...but they still cannot begin a different attempt
    assert is_locked_refusal(initialize(s))


def test_history_reports_and_results_survive_a_revoke(world):
    a = world["a"]
    s = make_student(world, a)
    set_access(a, s["id"], True)
    uuid = initialize(s).json()["session_uuid"]
    assert start(s, uuid).status_code == 200
    set_access(a, s["id"], False)
    history = client.get("/api/roleready/student/assessments", headers=s["headers"])
    assert history.status_code == 200 and history.json()["total_attempted"] >= 1
    report = client.get(f"/api/roleready/session/{uuid}/report", headers=s["headers"])
    assert not is_locked_refusal(report)                           # the report is never gated by this switch


# ---------------------------------------------------------------- boundaries: other workflows are not gated
@pytest.mark.parametrize("workflow", ["RECRUITMENT_ASSESSMENT", "RECRUITER_INVITATION", "JOB_ROLE_ASSESSMENT", None])
def test_only_student_self_assessments_are_gated(db, workflow):
    not_started = models.RoleReadySessionState.NOT_STARTED
    session = SimpleNamespace(workflow_type=workflow, current_state=not_started, student_profile_id=None)
    assessment_access.require_access_to_start(db, session)         # no profile, not self-assessment: must not raise


def test_a_self_assessment_past_not_started_is_never_gated(db):
    for state in ("APTITUDE_IN_PROGRESS", "CODING_UNLOCKED", "INTERVIEW_IN_PROGRESS", "COMPLETED", "TIMED_OUT"):
        session = SimpleNamespace(workflow_type="SELF_ASSESSMENT", current_state=state, student_profile_id=None)
        assessment_access.require_access_to_start(db, session)


def test_a_not_started_self_assessment_without_a_grant_is_refused(db):
    session = SimpleNamespace(workflow_type="SELF_ASSESSMENT", current_state=models.RoleReadySessionState.NOT_STARTED, student_profile_id=None)
    with pytest.raises(HTTPException) as exc:
        assessment_access.require_access_to_start(db, session)
    assert exc.value.status_code == 403 and exc.value.detail["code"] == LOCKED


def test_students_outside_roleready_flows_and_recruiter_endpoints_do_not_import_the_gate():
    import inspect as pyinspect
    from routers import public_assessment, job_assessments, student
    for module in (public_assessment, job_assessments, student):
        assert "assessment_access" not in pyinspect.getsource(module), f"{module.__name__} must not depend on the student toggle"


# ---------------------------------------------------------------- schema migration
def _legacy_engine(tmp_path):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE student_profiles (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, email VARCHAR(150) NOT NULL)")
    conn.execute("INSERT INTO student_profiles (user_id, email) VALUES (1, 'old@student.test'), (2, 'older@student.test')")
    conn.commit()
    conn.close()
    return create_engine(f"sqlite:///{path}")


def test_migration_adds_columns_keeps_rows_locks_everyone_and_is_idempotent(tmp_path):
    engine = _legacy_engine(tmp_path)
    added = migration.apply(engine)
    assert set(added) == {f"student_profiles.{c}" for c in migration.COLUMNS}
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT email, assessment_access_enabled, assessment_access_updated_at FROM student_profiles ORDER BY id")).fetchall()
    assert [r[0] for r in rows] == ["old@student.test", "older@student.test"]
    assert all(not r[1] and r[2] is None for r in rows)            # every pre-existing student is LOCKED
    assert migration.apply(engine) == []                           # re-run is a no-op


def test_migration_is_a_no_op_on_a_fresh_database_and_on_the_real_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    assert migration.apply(engine) == []                           # no table yet: create_all builds it with the columns
    models.Base.metadata.create_all(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("student_profiles")}
    assert set(migration.COLUMNS) <= cols
    assert migration.apply(engine) == []


def test_startup_runs_the_migration():
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    assert "migrate_student_assessment_toggle.apply(database.engine)" in src
