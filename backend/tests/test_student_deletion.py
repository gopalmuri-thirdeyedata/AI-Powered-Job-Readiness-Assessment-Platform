"""
Admin User Management -> Delete student account (DELETE /api/admin/users/{id}?confirm_email=...).

Covers: successful deletion, cleanup of every dependent table, transaction rollback, organization scoping, refusal of Admin / Super
Admin targets and non-admin callers, login rejection afterwards, repeated / concurrent requests, preservation (and anonymisation) of
the audit trail, upload-file removal, deletion under ENFORCED foreign keys, and a regression pass over the neighbouring features.
Runs on the throw-away test database (tests/db_guard.py); no real e-mail, Gemini or Judge0 is involved.
"""
import json
import threading
import uuid
from types import SimpleNamespace
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import database
import models
import utils
from main import app
from services import local_auth, student_deletion

PASSWORD = "Str0ng-Passw0rd!"
USERS = "/api/admin/users"


@pytest.fixture(autouse=True)
def _fresh_limiter():
    local_auth.login_tracker.reset()
    yield
    local_auth.login_tracker.reset()


_SHARED_ROWS = []   # question-bank / drive rows the seed creates: they belong to no student, so the tests must remove them themselves


@pytest.fixture(autouse=True)
def _remove_shared_rows():
    """The practice-question bank is shared with other test modules (some assert on its contents): leave it as we found it."""
    yield
    s = database.SessionLocal()
    try:
        for model, pk in _SHARED_ROWS:
            if model is models.StudentPracticeQuestion:
                s.query(models.StudentPracticeAttempt).filter_by(question_id=pk).delete()
            if model is models.PlacementDrive:
                s.query(models.PlacementDriveApplication).filter_by(drive_id=pk).delete()
            s.query(model).filter_by(id=pk).delete()
        s.commit()
    finally:
        _SHARED_ROWS.clear()
        s.close()


@pytest.fixture()
def db():
    s = database.SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def media(tmp_path, monkeypatch):
    root = tmp_path / "media"
    (root / "roleready").mkdir(parents=True)
    (root / "student_resumes").mkdir(parents=True)
    monkeypatch.setattr(student_deletion, "MEDIA_ROOTS", [root])
    return root


def tag():
    return uuid.uuid4().hex[:8]


def new_client():
    return TestClient(app, base_url="http://testserver")


def make_org(db):
    t = tag()
    org = models.Organization(name=f"Del Org {t}", slug=f"del-org-{t}", status="active")
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def make_account(db, org, role, email=None, profile=True):
    email = email or f"{role.lower()}.{tag()}@deltest.com"
    user = models.User(email=email, full_name=f"{role.title()} Person", phone="+14155550101", hashed_password=utils.get_password_hash(PASSWORD),
                       role=role, organization_id=org.id, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    if role == "ADMIN":
        db.add(models.OrganizationMember(organization_id=org.id, user_id=user.id, role="ADMIN", status="active"))
    elif role == "STUDENT" and profile:
        db.add(models.StudentProfile(user_id=user.id, organization_id=org.id, email=email, full_name="Student Person", phone="+14155550101",
                                     target_role="Engineer", college_name="Example College"))
    db.commit()
    return user


def login(email):
    c = new_client()
    res = c.post("/api/auth/login/", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return c, {"X-CSRF-Token": res.json()["csrf_token"]}


def admin_session(db, role="ADMIN", org=None):
    org = org or make_org(db)
    user = make_account(db, org, role)
    c, csrf = login(user.email)
    return c, csrf, user, org


def delete(c, csrf, target, confirm=None, **kw):
    email = confirm if confirm is not None else (target.email if hasattr(target, "email") else target)
    uid = target.id if hasattr(target, "id") else target
    return c.delete(f"{USERS}/{uid}", params={"confirm_email": email}, headers=csrf, **kw)


# ------------------------------------------------------------------------------ seeding
def seed_student(db, org, media=None, name="Maya Patel"):
    """A student with at least one row in every table that references the account, its profile, its attempts or its registration."""
    t = tag()
    email = f"maya.{t}@students.example.org"
    user = make_account(db, org, "STUDENT", email=email)
    pid = db.query(models.StudentProfile).filter_by(user_id=user.id).one().id
    rows, kept = [], []

    def add(obj, keep=False):
        """keep=True: the organization's own record the student's rows point at (it must survive the deletion)."""
        db.add(obj)
        db.flush()
        (kept if keep else rows).append((type(obj), obj.id))
        if keep:
            _SHARED_ROWS.append((type(obj), obj.id))
        return obj

    files = []
    if media is not None:
        recorded = media / "student_resumes" / f"student_{user.id}_v1_20260101_000000_cv.txt"
        recorded.write_text("resume text")
        swept_only = media / "roleready" / f"jd_student_{pid}_deadbeef.pdf"           # never stored in any row
        swept_only.write_text("jd")
        sess_file = media / "roleready" / f"resume_student_{pid}_cafebabe.pdf"
        sess_file.write_text("pdf")
        files = [recorded, swept_only, sess_file]

    resume = add(models.StudentResume(student_profile_id=pid, version=1, file_name="cv.txt", full_text="private resume text",
                                      file_path=str(files[0]) if files else "media/student_resumes/none.txt"))
    roadmap = add(models.StudentRoadmap(student_profile_id=pid, organization_id=org.id, target_role="Engineer", title="Plan"))
    add(models.StudentDailyTask(roadmap_id=roadmap.id, student_profile_id=pid, organization_id=org.id, week_number=1, day_number=1, title="Day 1"))
    question = add(models.StudentPracticeQuestion(topic="arrays", category="CODING", title=f"Q {t}", description="d", correct_answer="x"), keep=True)
    add(models.StudentPracticeAttempt(student_profile_id=pid, organization_id=org.id, question_id=question.id, category="CODING", topic="arrays",
                                      code_submitted="print('my private code')"))
    interview = add(models.StudentMockInterview(student_profile_id=pid, organization_id=org.id, interview_type="HR", target_role="Engineer"))
    add(models.StudentMockInterviewTurn(mock_interview_id=interview.id, student_profile_id=pid, organization_id=org.id, turn_number=1,
                                        question_text="Tell me", student_response="my private answer"))
    add(models.StudentProject(student_profile_id=pid, organization_id=org.id, title="Proj", description="d"))
    sim = add(models.StudentPlacementSimulation(student_profile_id=pid, organization_id=org.id, target_role="Engineer"))
    add(models.StudentPlacementSimulationRound(simulation_id=sim.id, student_profile_id=pid, organization_id=org.id, round_number=1, round_type="APTITUDE"))
    add(models.StudentCopilotMessage(student_profile_id=pid, organization_id=org.id, role="USER", content="private chat"))
    drive = add(models.PlacementDrive(organization_id=org.id, company_name="Acme", role_title="SDE", description="d"), keep=True)
    add(models.PlacementDriveApplication(drive_id=drive.id, student_profile_id=pid, organization_id=org.id))

    # self-assessment attempt (keyed by the profile)
    self_sess = add(models.RoleReadySession(session_uuid=f"self-{t}", workflow_type="SELF_ASSESSMENT", organization_id=org.id, student_profile_id=pid,
                                            target_role="Engineer", current_state="COMPLETED", resume_file_path=str(files[2]) if files else None))
    add(models.RoleReadyRoundAttempt(session_id=self_sess.id, round_type="APTITUDE", round_order=1, submission_payload={"answers": ["secret"]}))
    add(models.AssessmentFeedback(session_id=self_sess.id, student_profile_id=pid, feedback_text="great " * 25, word_count=25))

    # shared-link (invited student) attempt: registration -> session -> rounds -> review, plus one archived retaken attempt
    job = add(models.JobDescription(title=f"Role {t}", description="jd", organization_id=org.id, share_token=f"tok-{t}", is_published=True), keep=True)
    reg = add(models.CandidateRegistration(registration_token_hash="h" * 64, job_description_id=job.id, organization_id=org.id, name=name,
                                           phone="+14155550101", email=email, student_user_id=user.id, status="CONSUMED", attempt_session_uuid=f"link-{t}"))
    link_sess = add(models.RoleReadySession(session_uuid=f"link-{t}", workflow_type="RECRUITMENT_ASSESSMENT", organization_id=org.id,
                                            job_description_id=job.id, registration_id=reg.id, target_role="Engineer", current_state="COMPLETED"))
    add(models.RoleReadyRoundAttempt(session_id=link_sess.id, round_type="CODING", round_order=2, submission_payload={"code": "secret"}))
    add(models.AssessmentReview(session_id=link_sess.id, student_user_id=user.id, review_text="review " * 40, word_count=40))
    archived = add(models.RoleReadySession(session_uuid=f"old-{t}", workflow_type="RECRUITMENT_ASSESSMENT", organization_id=org.id,
                                           job_description_id=job.id, registration_id=None, target_role="Engineer", current_state="REVOKED_RETRIED"))
    add(models.RoleReadyRoundAttempt(session_id=archived.id, round_type="APTITUDE", round_order=1, submission_payload={"answers": ["old secret"]}))
    add(models.AssessmentInvitation(job_description_id=job.id, organization_id=org.id, student_user_id=user.id, share_token=f"tok-{t}",
                                    recipient_email=email, status="SENT"))
    add(models.Notification(user_id=user.id, organization_id=org.id, title="Hi", message=f"hello {email}"))
    add(models.Assessment(user_id=user.id, candidate_email=email, type="aptitude", organization_id=org.id))
    add(models.CredentialDelivery(user_id=user.id, organization_id=org.id, ciphertext="x", expires_at=datetime.utcnow() + timedelta(hours=1)))
    db.add(models.AuthSession(token_hash=tag() * 8, user_id=user.id, csrf_token="c", created_at=datetime.utcnow(), last_seen_at=datetime.utcnow(),
                              expires_at=datetime.utcnow() + timedelta(hours=1)))
    db.flush()
    rows.append((models.User, user.id))
    rows.append((models.StudentProfile, pid))

    # audit trail rows that mention the student
    admin = make_account(db, org, "ADMIN")
    db.add(models.ActivityLog(user_id=admin.id, organization_id=org.id, action="user_created", target=email, details="role=STUDENT"))
    db.add(models.ActivityLog(user_id=admin.id, organization_id=org.id, action="CREDENTIALS_SHARE_SENT", target=email.upper(), details=f"to {email}"))
    db.add(models.ActivityLog(user_id=user.id, organization_id=org.id, action="STUDENT_ORGANIZATION_UNRESOLVED", target=email, details="x"))
    db.add(models.ActivityLog(user_id=None, organization_id=org.id, action="ASSESSMENT_RULES_ACKNOWLEDGED", target=f"session:old-{t}",
                              details=json.dumps({"registration_id": reg.id, "rules_version": "v1", "job_role_id": job.id})))
    db.commit()
    ident = SimpleNamespace(id=user.id, email=email, role="STUDENT")            # stays readable after the ORM row is gone
    return {"user": ident, "email": email, "pid": pid, "org": org, "rows": rows, "kept": kept, "files": files, "reg_id": reg.id, "job_id": job.id, "admin": admin}


def exists(db, model, pk):
    db.expire_all()
    return db.get(model, pk) is not None


def survivors(db, seed):
    return [(m.__name__, pk) for m, pk in seed["rows"] if exists(db, m, pk)]


def audit_count(db):
    return db.query(models.ActivityLog).count()


def email_mentions(db, email):
    db.expire_all()
    needle = email.lower()
    return [r.id for r in db.query(models.ActivityLog).all() if needle in (r.target or "").lower() or needle in (r.details or "").lower()]


# ------------------------------------------------------------------------------ success + cleanup
def test_admin_deletes_student_and_every_dependent_row(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    bystander = seed_student(db, org)
    other_rows = [(m.__name__, pk) for m, pk in bystander["rows"]]
    assert survivors(db, seed), "seed must exist before deletion"
    assert len({m for m, _ in seed["rows"]}) >= 20          # the seed really covers many tables

    res = delete(c, csrf, seed["user"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert seed["email"] in body["message"] and "permanently" in body["message"]
    assert body["deleted_rows"]["users"] == 1 and body["deleted_rows"]["student_profiles"] == 1
    assert body["total_rows_deleted"] >= len(seed["rows"])

    assert survivors(db, seed) == []                        # nothing the student owned survives, in ANY table
    assert db.query(models.User).filter(models.User.id == seed["user"].id).count() == 0
    assert db.query(models.AuthSession).filter_by(user_id=seed["user"].id).count() == 0
    assert db.query(models.CandidateRegistration).filter_by(student_user_id=seed["user"].id).count() == 0
    # a different student in the same organization is untouched, row for row
    assert [(m.__name__, pk) for m, pk in bystander["rows"] if exists(db, m, pk)] == other_rows
    # kept organization records
    assert exists(db, models.Organization, org.id)
    assert [(m, pk) for m, pk in seed["kept"] if not exists(db, m, pk)] == []   # the job, the question bank and the drive are the organization's


def test_login_is_rejected_after_deletion_and_old_sessions_die(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    student_client, _ = login(seed["email"])
    assert student_client.get("/api/auth/me").status_code == 200

    assert delete(c, csrf, seed["user"]).status_code == 200

    assert student_client.get("/api/auth/me").status_code == 401                       # the live cookie session is gone
    local_auth.login_tracker.reset()
    res = new_client().post("/api/auth/login/", json={"email": seed["email"], "password": PASSWORD})
    assert res.status_code == 401
    # the same e-mail can be registered again as a brand-new, empty account
    again = c.post(f"{USERS}/", headers=csrf, json={"role": "STUDENT", "full_name": "Maya Again", "email": seed["email"], "password": "Zx9#pLm2!qWe-4417"})
    assert again.status_code == 201 and again.json()["user"]["id"] != 0
    assert db.query(models.RoleReadySession).filter(models.RoleReadySession.student_profile_id == seed["pid"]).count() == 0


def test_student_without_profile_can_be_deleted(db):
    c, csrf, _admin, org = admin_session(db)
    user = make_account(db, org, "STUDENT", profile=False)
    assert delete(c, csrf, user).status_code == 200
    assert not exists(db, models.User, user.id)


def test_deleted_student_disappears_from_the_list(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    ids = lambda: [u["id"] for u in c.get(f"{USERS}/", headers=csrf, params={"page_size": 100}).json()["items"]]  # noqa: E731
    assert seed["user"].id in ids()
    assert delete(c, csrf, seed["user"]).status_code == 200
    assert seed["user"].id not in ids()
    assert c.get(f"{USERS}/{seed['user'].id}", headers=csrf).status_code == 404


def test_archived_retaken_attempt_is_found_and_removed(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    archived = db.query(models.RoleReadySession).filter(models.RoleReadySession.current_state == "REVOKED_RETRIED",
                                                       models.RoleReadySession.job_description_id == seed["job_id"]).one()
    archived_id = archived.id
    assert archived.registration_id is None and archived.student_profile_id is None        # nothing links it to the student except the log
    assert delete(c, csrf, seed["user"]).status_code == 200
    assert not exists(db, models.RoleReadySession, archived_id)
    assert db.query(models.RoleReadyRoundAttempt).filter_by(session_id=archived_id).count() == 0


# ------------------------------------------------------------------------------ foreign keys enforced / no orphans
def test_deletion_succeeds_with_foreign_keys_enforced_and_leaves_no_orphans(db, media):
    """The production MySQL enforces foreign keys; SQLite here does not. Run the service with SQLite FK enforcement ON."""
    org = make_org(db)
    seed = seed_student(db, org, media)
    engine = sa.create_engine(database.SQLALCHEMY_DATABASE_URL)

    @sa.event.listens_for(engine, "connect")
    def _fk_on(conn, _rec):
        conn.execute("PRAGMA foreign_keys=ON")

    strict = sessionmaker(bind=engine, autoflush=False)()
    try:
        assert strict.execute(sa.text("PRAGMA foreign_keys")).scalar() == 1
        before = len(strict.execute(sa.text("PRAGMA foreign_key_check")).all())
        user = strict.get(models.User, seed["user"].id)
        result = student_deletion.delete_student(strict, user=user, actor_id=seed["admin"].id, org_id=org.id)
        assert result["deleted_rows"]["users"] == 1
        assert len(strict.execute(sa.text("PRAGMA foreign_key_check")).all()) == before        # no new dangling reference anywhere
    finally:
        strict.close()
        engine.dispose()
    assert survivors(db, seed) == []


def test_every_reference_to_users_has_a_deletion_policy():
    assert student_deletion.schema_gaps() == []
    declared = {(c.table.name, c.name) for c in student_deletion._refs("users")}
    assert student_deletion.USER_OWNED <= declared                                   # no stale policy entries
    # student profile children are discovered from the schema, so a new table is covered automatically
    assert {c.table.name for c in student_deletion._refs("student_profiles")} >= {
        "student_resumes", "student_roadmaps", "student_mock_interviews", "roleready_sessions", "assessment_feedback"}


# ------------------------------------------------------------------------------ transaction behaviour
def test_failure_midway_rolls_everything_back(db, media, monkeypatch):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    student_client, _ = login(seed["email"])
    audit_before = audit_count(db)
    real = student_deletion._delete_rows

    def boom(session, table, conditions):
        if table.name == "student_profiles":                    # earlier tables were already deleted inside the transaction
            raise RuntimeError("simulated database failure")
        return real(session, table, conditions)

    monkeypatch.setattr(student_deletion, "_delete_rows", boom)
    res = delete(c, csrf, seed["user"])
    assert res.status_code == 500 and res.json()["detail"]["code"] == "DELETE_FAILED"
    assert "nothing was changed" in res.json()["detail"]["message"]
    monkeypatch.undo()

    assert len(survivors(db, seed)) == len(seed["rows"])        # every row is still there
    assert audit_count(db) == audit_before                      # ... and no half-written audit / anonymisation
    assert email_mentions(db, seed["email"])                    # the audit rows still carry the e-mail: the rollback undid that too
    assert all(f.exists() for f in seed["files"])               # files are only removed after a successful commit
    assert student_client.get("/api/auth/me").status_code == 200   # the student can still sign in


def test_orphan_check_failure_rolls_back(db, media, monkeypatch):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)

    def boom(*_a, **_k):
        raise student_deletion.StudentDeletionError("DEPENDENT_RECORDS", "still referenced")

    monkeypatch.setattr(student_deletion, "_check_no_orphans", boom)
    res = delete(c, csrf, seed["user"])
    assert res.status_code == 409 and res.json()["detail"]["code"] == "DEPENDENT_RECORDS"
    monkeypatch.undo()
    assert len(survivors(db, seed)) == len(seed["rows"])


def test_unhandled_schema_reference_fails_closed(db, media, monkeypatch):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    monkeypatch.setattr(student_deletion, "schema_gaps", lambda: ["new_table.user_id"])
    res = delete(c, csrf, seed["user"])
    assert res.status_code == 409 and res.json()["detail"]["code"] == "UNHANDLED_REFERENCES"
    monkeypatch.undo()
    assert len(survivors(db, seed)) == len(seed["rows"])


# ------------------------------------------------------------------------------ audit trail
def test_audit_trail_is_kept_but_carries_no_identity(db, media):
    c, csrf, admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    logs_before = audit_count(db)
    mentioned = email_mentions(db, seed["email"])
    assert len(mentioned) >= 3
    detached_before = db.query(models.ActivityLog).filter(models.ActivityLog.user_id == seed["user"].id).count()
    assert detached_before == 1

    assert delete(c, csrf, seed["user"]).status_code == 200

    assert audit_count(db) == logs_before + 1                                      # nothing deleted, exactly one deletion record added
    assert email_mentions(db, seed["email"]) == []                                 # no row still names the student
    pseudonym = f"deleted-user:{seed['user'].id}"
    pseudonymised = db.query(models.ActivityLog).filter(models.ActivityLog.id.in_(mentioned)).all()
    assert pseudonymised and all(pseudonym in (r.target or "") + (r.details or "") for r in pseudonymised)
    assert {r.action for r in pseudonymised} >= {"user_created", "CREDENTIALS_SHARE_SENT", "STUDENT_ORGANIZATION_UNRESOLVED"}
    assert db.query(models.ActivityLog).filter(models.ActivityLog.user_id == seed["user"].id).count() == 0   # detached as actor, row kept

    record = db.query(models.ActivityLog).filter_by(action="student_account_deleted", target=pseudonym).one()
    assert record.user_id == admin.id and record.organization_id == org.id
    detail = json.loads(record.details)
    assert detail["email_sha256"] == student_deletion.email_digest(seed["email"]) and seed["email"] not in record.details
    assert detail["deleted_rows"]["users"] == 1 and detail["audit_rows_pseudonymised"] == len(mentioned)


# ------------------------------------------------------------------------------ files
def test_uploaded_files_are_removed_only_inside_the_media_root(db, media, tmp_path):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    outside = tmp_path / "elsewhere.txt"
    outside.write_text("not ours")
    db.query(models.StudentResume).filter_by(student_profile_id=seed["pid"]).update({"file_path": str(outside)})
    db.commit()
    other = seed_student(db, org, media)                                         # its files must survive
    kept = list(other["files"])

    res = delete(c, csrf, seed["user"])
    assert res.status_code == 200, res.text
    # the resume (found by the app's own naming scheme even though its row was re-pointed), the JD and the session resume
    assert res.json()["files_removed"] == 3
    assert not any(f.exists() for f in seed["files"])
    assert outside.exists()                                                      # a stored path outside media/ is never followed
    assert all(f.exists() for f in kept)


def test_a_file_still_referenced_by_someone_else_is_kept(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    other = seed_student(db, org)
    shared = seed["files"][0]
    db.query(models.StudentResume).filter_by(student_profile_id=other["pid"]).update({"file_path": str(shared)})
    db.commit()
    assert delete(c, csrf, seed["user"]).status_code == 200
    assert shared.exists()


# ------------------------------------------------------------------------------ authorization
def test_admin_of_another_organization_cannot_delete_the_student(db, media):
    _c_a, _csrf_a, _admin_a, org_a = admin_session(db)
    seed = seed_student(db, org_a, media)
    c_b, csrf_b, _admin_b, _org_b = admin_session(db)
    res = delete(c_b, csrf_b, seed["user"])
    assert res.status_code == 404 and res.json()["detail"] == "User not found."          # no existence leak
    assert len(survivors(db, seed)) == len(seed["rows"])


def test_nobody_can_delete_admin_or_super_admin_accounts(db):
    org = make_org(db)
    super_user, admin_user, other_admin = (make_account(db, org, "SUPER_ADMIN"), make_account(db, org, "ADMIN"), make_account(db, org, "ADMIN"))
    other_super = make_account(db, org, "SUPER_ADMIN")
    sc, scsrf = login(super_user.email)
    ac, acsrf = login(admin_user.email)
    for client, csrf, target in [(ac, acsrf, other_super), (ac, acsrf, other_admin), (ac, acsrf, admin_user),
                                 (sc, scsrf, other_super), (sc, scsrf, other_admin), (sc, scsrf, super_user)]:
        res = delete(client, csrf, target)
        assert res.status_code == 403, (target.role, res.text)
        assert "Only Student accounts" in res.json()["detail"]
        assert exists(db, models.User, target.id)
    # the admin / super admin can still sign in
    assert login(other_admin.email) and login(other_super.email)


def test_super_admin_follows_the_hierarchy_and_may_delete_a_student(db, media):
    c, csrf, _sa, org = admin_session(db, role="SUPER_ADMIN")
    seed = seed_student(db, org, media)
    assert delete(c, csrf, seed["user"]).status_code == 200
    assert survivors(db, seed) == []


def test_students_and_anonymous_callers_cannot_use_the_endpoint(db, media):
    org = make_org(db)
    seed = seed_student(db, org, media)
    victim = seed_student(db, org)
    sc, scsrf = login(seed["email"])
    for target in (victim["user"], seed["user"]):
        res = delete(sc, scsrf, target)
        assert res.status_code == 403
    assert new_client().delete(f"{USERS}/{victim['user'].id}", params={"confirm_email": victim["email"]}).status_code in (401, 403)
    assert len(survivors(db, victim)) == len(victim["rows"]) and len(survivors(db, seed)) == len(seed["rows"])


def test_csrf_token_is_required(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    res = c.delete(f"{USERS}/{seed['user'].id}", params={"confirm_email": seed["email"]})
    assert res.status_code == 403
    assert exists(db, models.User, seed["user"].id)


def test_explicit_email_confirmation_is_required(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    assert c.delete(f"{USERS}/{seed['user'].id}", headers=csrf).status_code == 422                       # missing
    res = delete(c, csrf, seed["user"], confirm="someone.else@students.example.org")
    assert res.status_code == 400 and "does not match" in res.json()["detail"]
    assert len(survivors(db, seed)) == len(seed["rows"])
    assert delete(c, csrf, seed["user"], confirm=f"  {seed['email'].upper()} ").status_code == 200       # case / spaces tolerated


def test_student_that_also_holds_an_admin_membership_is_refused(db):
    c, csrf, _admin, org = admin_session(db)
    user = make_account(db, org, "STUDENT")
    db.add(models.OrganizationMember(organization_id=org.id, user_id=user.id, role="ADMIN", status="active"))
    db.commit()
    res = delete(c, csrf, user)
    assert res.status_code == 403 and res.json()["detail"]["code"] == "HAS_ADMIN_ROLE"
    assert exists(db, models.User, user.id)


# ------------------------------------------------------------------------------ repeated requests
def test_repeated_and_unknown_requests_are_safe(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    assert delete(c, csrf, seed["user"]).status_code == 200
    logs = audit_count(db)
    again = c.delete(f"{USERS}/{seed['user'].id}", params={"confirm_email": seed["email"]}, headers=csrf)
    assert again.status_code == 404
    assert c.delete(f"{USERS}/99999999", params={"confirm_email": "nobody@example.org"}, headers=csrf).status_code == 404
    assert audit_count(db) == logs                                               # a no-op request writes nothing


def test_concurrent_duplicate_requests_delete_once(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    statuses = []

    def fire():
        cl = TestClient(app, base_url="http://testserver")
        cl.cookies.update(c.cookies)
        statuses.append(cl.delete(f"{USERS}/{seed['user'].id}", params={"confirm_email": seed["email"]}, headers=csrf).status_code)

    threads = [threading.Thread(target=fire) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert statuses.count(200) == 1, statuses
    assert all(s in (200, 404, 409, 500) for s in statuses)
    assert survivors(db, seed) == []
    assert db.query(models.ActivityLog).filter_by(action="student_account_deleted", target=f"deleted-user:{seed['user'].id}").count() == 1


# ------------------------------------------------------------------------------ records that only share the e-mail
def test_unlinked_email_records_are_reported_not_silently_kept_or_deleted(db, media):
    c, csrf, _admin, org = admin_session(db)
    seed = seed_student(db, org, media)
    candidate = models.Candidate(name="Maya (recruiter upload)", email=seed["email"], role="Engineer", organization_id=org.id)
    other_job = models.JobDescription(title="Other role", description="jd", organization_id=org.id, share_token=f"tok-{tag()}", is_published=True)
    db.add_all([candidate, other_job])
    db.flush()
    accountless = models.CandidateRegistration(registration_token_hash="a" * 64, job_description_id=other_job.id, organization_id=org.id, name="Maya",
                                               phone="+14155550101", email=seed["email"], student_user_id=None, status="REGISTERED")
    legacy = models.Assessment(candidate_email=seed["email"], type="aptitude", organization_id=org.id, user_id=None)
    db.add_all([accountless, legacy])
    db.commit()

    res = delete(c, csrf, seed["user"])
    assert res.status_code == 200
    kept = res.json()["unlinked_email_records_kept"]
    assert kept == {"candidates": 1, "accountless_registrations": 1, "email_only_assessments": 1}
    assert exists(db, models.Candidate, candidate.id) and exists(db, models.CandidateRegistration, accountless.id) and exists(db, models.Assessment, legacy.id)
    # the deletion record itself says what was left, so it is never "silent"
    record = db.query(models.ActivityLog).filter_by(action="student_account_deleted", target=f"deleted-user:{seed['user'].id}").one()
    assert json.loads(record.details)["unlinked_email_records_kept"] == kept


# ------------------------------------------------------------------------------ regression: neighbouring features
def test_other_user_management_features_still_work(db, media):
    c, csrf, _admin, org = admin_session(db)
    gone = seed_student(db, org, media)
    keep = seed_student(db, org)
    assert delete(c, csrf, gone["user"]).status_code == 200

    uid = keep["user"].id
    assert c.get(f"{USERS}/{uid}", headers=csrf).json()["email"] == keep["email"]
    assert c.patch(f"{USERS}/{uid}", headers=csrf, json={"full_name": "Renamed Student"}).status_code == 200
    assert c.put(f"{USERS}/{uid}/assessment-access", headers=csrf, json={"granted": True}).json()["user"]["assessment_access_granted"] is True
    assert c.put(f"{USERS}/{uid}/assessment-access", headers=csrf, json={"granted": False}).status_code == 200
    assert c.post(f"{USERS}/{uid}/deactivate", headers=csrf).status_code == 200
    local_auth.login_tracker.reset()
    assert new_client().post("/api/auth/login/", json={"email": keep["email"], "password": PASSWORD}).status_code in (401, 403)
    assert c.post(f"{USERS}/{uid}/activate", headers=csrf).status_code == 200
    assert c.post(f"{USERS}/{uid}/reset-password", headers=csrf, json={"new_password": "Zx9#pLm2!qWe-4417"}).status_code == 200
    created = c.post(f"{USERS}/", headers=csrf, json={"role": "STUDENT", "full_name": "New One", "email": f"new.{tag()}@deltest.com", "password": "Zx9#pLm2!qWe-4417"})
    assert created.status_code == 201
    # sharing needs SMTP (not configured in tests): it must answer with its own error, not be affected by the new route
    assert c.post(f"{USERS}/{uid}/share-credentials", headers=csrf).status_code != 405
    # the bystander's whole data set is intact
    assert len(survivors(db, keep)) == len(keep["rows"])
