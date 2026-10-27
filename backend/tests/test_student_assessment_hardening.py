"""
Hardening of the invited-student workflow:
  * the legacy accountless /register endpoint can no longer collide with a student's own assessment access,
  * student organization authorization (and the audit/backfill tool),
  * administrator-authorised retake links for student registrations,
  * a student's sitting cannot be driven by a leaked session token alone,
  * report contents / size limits / cookie and session isolation checks.
"""
import json
import threading
from datetime import datetime, timedelta, timezone

import pytest

import models
import utils
from services import assessment_clock
from services import student_assessment_service as svc
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h
from tests.test_student_assessment_flow import (  # noqa: F401  (fixtures + helpers shared with the main flow suite)
    API, PUBLIC, STUDENT_PASSWORD, WORDS_30, _setup, access, begin, completed_student, db, finish, make_student, session_of, signed_in, world,
)

client = h.client


def regs(db, job_id, email=None):
    db.expire_all()
    q = db.query(models.CandidateRegistration).filter_by(job_description_id=job_id)
    return q.filter(models.CandidateRegistration.email == email).count() if email else q.count()


# ------------------------------------------------------------------------------ 1. legacy /register vs student emails
@pytest.mark.parametrize("variant", [lambda e: e, lambda e: e.upper(), lambda e: f"  {e}  ", lambda e: e.replace("a", "\uff41", 1)])
def test_register_refuses_an_email_that_belongs_to_a_student_account(db, world, variant):
    student = make_student(db, world, world["a"]["org"], "Taken Email")
    token = world["job"]["share_token"]
    before = regs(db, world["job"]["id"])
    sessions = db.query(models.RoleReadySession).count()
    r = client.post(f"{PUBLIC}/{token}/register", json={"name": "Someone Else", "phone": "+14155550123", "email": variant(student.email)})
    assert r.status_code == 409 and "student account" in r.json()["detail"], r.text
    assert regs(db, world["job"]["id"]) == before                          # nothing reserved, no registration, no attempt
    assert db.query(models.RoleReadySession).count() == sessions
    # the student's own access is unaffected: signed-in access still hands out a start capability
    got = access(signed_in(student), token)
    assert got.status_code == 200 and got.json()["status"] == "READY"


def test_register_refuses_a_deactivated_students_email_too_and_leaks_nothing_more(db, world):
    student = make_student(db, world, world["a"]["org"], "Gone Student", active=False)
    r = client.post(f"{PUBLIC}/{world['job']['share_token']}/register", json={"name": "X Y", "phone": "+14155550123", "email": student.email})
    assert r.status_code == 409
    body = json.dumps(r.json())
    assert student.email not in body and "Gone Student" not in body       # the answer names no account, id or organization


def test_unrelated_candidates_can_still_register_and_duplicates_are_still_refused(db, world):
    token = world["job"]["share_token"]
    cap, email = h.register_ok(token, name="Walk In Person")
    assert regs(db, world["job"]["id"], email) == 1
    again, _ = h.register(token, email=email, name="Walk In Person")
    assert again.status_code == 409 and "student account" not in again.json()["detail"]   # the original duplicate protection
    assert client.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": cap}, json={"acknowledged": True}).status_code == 200


def test_the_student_check_is_server_side_whatever_the_payload_says(db, world):
    student = make_student(db, world, world["a"]["org"], "Payload Case")
    r = client.post(f"{PUBLIC}/{world['job']['share_token']}/register", json={
        "name": "Payload Case", "phone": "+14155550123", "email": student.email, "role": "CANDIDATE", "is_student": False, "student_user_id": None})
    assert r.status_code == 409


def test_a_student_account_created_during_the_request_is_caught_inside_the_transaction(db, world, monkeypatch):
    """The first (pre-insert) check passes, the account appears, the re-check before commit refuses and nothing stays behind."""
    from routers import public_assessment
    student = make_student(db, world, world["a"]["org"], "Race Student")
    real = public_assessment._is_student_account_email
    calls = []

    def late(db_, email):
        calls.append(1)
        return False if len(calls) == 1 else real(db_, email)

    monkeypatch.setattr(public_assessment, "_is_student_account_email", late)
    r = client.post(f"{PUBLIC}/{world['job']['share_token']}/register", json={"name": "Race Student", "phone": "+14155550123", "email": student.email})
    assert r.status_code == 409 and len(calls) == 2
    assert regs(db, world["job"]["id"], utils.normalize_email(student.email)) == 0


def test_concurrent_registrations_cannot_bypass_the_restriction(db, world, monkeypatch):
    from routers import public_assessment
    monkeypatch.setattr(public_assessment.register_limiter, "allow", lambda key: True)
    student = make_student(db, world, world["a"]["org"], "Concurrent Student")
    token = world["job"]["share_token"]
    stranger = f"stranger.{h.new_tag()}@example.org"
    out = {"student": [], "stranger": []}

    def hit(kind, email):
        r = client.post(f"{PUBLIC}/{token}/register", json={"name": "Some One", "phone": "+14155550123", "email": email})
        out[kind].append(r.status_code)

    threads = [threading.Thread(target=hit, args=("student", student.email)) for _ in range(6)] + \
              [threading.Thread(target=hit, args=("stranger", stranger)) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert out["student"] == [409] * 6
    assert sorted(out["stranger"]).count(200) == 1 and set(out["stranger"]) <= {200, 409}     # exactly one registration wins
    assert regs(db, world["job"]["id"], utils.normalize_email(student.email)) == 0
    assert regs(db, world["job"]["id"], utils.normalize_email(stranger)) == 1


def test_an_existing_accountless_registration_is_never_deleted_when_that_person_becomes_a_student(db, world):
    token = world["job"]["share_token"]
    email = f"later.student.{h.new_tag()}@rwtest.com"
    cap, _ = h.register_ok(token, email=email, name="Later Student")          # registered BEFORE having an account
    user = lah.ensure_user(db, email, models.UserRole.STUDENT.value, org=world["a"]["org"], password=STUDENT_PASSWORD, student_profile=True, full_name="Later Student")
    world["created"].append(user.id)
    got = access(signed_in(user), token).json()                               # the unused registration is adopted, not duplicated
    assert got["status"] == "READY"
    assert regs(db, world["job"]["id"], email) == 1
    assert db.query(models.CandidateRegistration).filter_by(email=email).one().student_user_id == user.id
    assert client.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": cap}, json={"acknowledged": True}).status_code in (401, 403)   # the old capability died


# ------------------------------------------------------------------------------ 2. organizations
def _bare_student(db, world, name, org=None, profile_org=None, member_of=None, member_status="active"):
    tag = h.new_tag()
    user = models.User(email=f"{name.lower().replace(' ', '.')}.{tag}@rwtest.com", full_name=name, role="STUDENT", is_active=True,
                       hashed_password=utils.get_password_hash(STUDENT_PASSWORD), organization_id=org.id if org else None)
    db.add(user)
    db.commit()
    db.refresh(user)
    world["created"].append(user.id)
    db.add(models.StudentProfile(user_id=user.id, organization_id=profile_org.id if profile_org else None, email=user.email, full_name=name, target_role=""))
    if member_of is not None:
        db.add(models.OrganizationMember(organization_id=member_of.id, user_id=user.id, role="STUDENT", status=member_status))
    db.commit()
    return user


def test_students_are_authorized_by_any_authoritative_organization_link(db, world):
    org = world["a"]["org"]
    token = world["job"]["share_token"]
    only_profile = _bare_student(db, world, "Profile Only", profile_org=org)
    only_member = _bare_student(db, world, "Member Only", member_of=org)
    for u in (only_profile, only_member):
        assert access(signed_in(u), token).json()["status"] == "READY", u.email
    inactive = _bare_student(db, world, "Inactive Member", member_of=org, member_status="deactivated")
    assert access(signed_in(inactive), token).status_code == 403              # an inactive membership proves nothing


def test_a_student_without_any_organization_is_refused_and_recorded_for_an_administrator(db, world):
    token = world["job"]["share_token"]
    orphan = _bare_student(db, world, "Orphan Student")
    c = signed_in(orphan)
    for _ in range(3):
        r = access(c, token)
        assert r.status_code == 403 and "not linked to an organization" in r.json()["detail"]
    db.expire_all()
    logged = db.query(models.ActivityLog).filter_by(action=svc.UNRESOLVED_ORG_ACTION, target=orphan.email).all()
    assert len(logged) == 1 and logged[0].organization_id == world["a"]["org"].id   # once, visible to the owning org's admins
    assert regs(db, world["job"]["id"], orphan.email) == 0
    other = _bare_student(db, world, "Other Org Student", org=world["b"]["org"])
    r = access(signed_in(other), token)
    assert r.status_code == 403 and "not linked" not in r.json()["detail"]    # a student of ANOTHER organization gets the generic refusal
    assert db.query(models.ActivityLog).filter_by(action=svc.UNRESOLVED_ORG_ACTION, target=other.email).count() == 0


def test_super_admin_and_admin_organization_scoping_ignores_client_claims(db, world):
    platform = h.make_admin(db, tag="platform" + h.new_tag(), member_role="PLATFORM_ADMIN")
    a, b = world["a"], world["b"]
    try:
        job = world["job"]
        assert client.get(f"/api/admin/job-roles/{job['id']}/share-students", headers=h.auth(platform["token"], a["org"].id)).status_code == 200
        assert client.get(f"/api/admin/job-roles/{job['id']}/share-students", headers=h.auth(platform["token"], 99999999)).status_code == 404
        # an organization administrator naming ANOTHER organization in the header is not authorized by naming it
        assert client.get(f"/api/admin/job-roles/{job['id']}/share-students", headers=h.auth(b["token"], a["org"].id)).status_code == 403
        assert client.get(f"/api/admin/job-roles/{job['id']}/share-students", headers=h.auth(b["token"])).status_code == 404
    finally:
        h.cleanup_orgs(db, [platform["org"].id])


def test_audit_tool_backfills_only_what_can_be_proven_and_is_idempotent(db, world):
    from scripts import audit_student_organizations as audit
    x, y = world["a"]["org"], world["b"]["org"]
    valid = _bare_student(db, world, "Valid Org", org=x, profile_org=y)            # valid account org: never changed, mismatch only reported
    by_profile = _bare_student(db, world, "Via Profile", profile_org=x)
    by_member = _bare_student(db, world, "Via Member", member_of=y)
    conflict = _bare_student(db, world, "Conflicting", profile_org=x, member_of=y)
    nothing = _bare_student(db, world, "Nothing Known")
    ids = {u.id for u in (valid, by_profile, by_member, conflict, nothing)}

    report = audit.analyze(db)
    bucket = {k: {r["user_id"] for r in report[k]} & ids for k in ("ok", "backfill", "conflict", "unresolved", "profile_mismatch")}
    assert bucket == {"ok": set(), "backfill": {by_profile.id, by_member.id}, "conflict": {conflict.id},
                      "unresolved": {nothing.id}, "profile_mismatch": {valid.id}}
    # a dry run (analyze) changes nothing
    db.expire_all()
    assert db.query(models.User).filter_by(id=by_profile.id).one().organization_id is None

    changed = audit.apply_backfill(db, report)
    assert changed >= 2
    db.expire_all()
    org_of = {i: db.query(models.User).filter_by(id=i).one().organization_id for i in ids}
    assert org_of == {valid.id: x.id, by_profile.id: x.id, by_member.id: y.id, conflict.id: None, nothing.id: None}
    log = db.query(models.ActivityLog).filter_by(action=audit.BACKFILLED, target=by_member.email).one()
    assert json.loads(log.details) == {"student_user_id": by_member.id, "from": None, "to": y.id, "source": "active_membership"}
    again = audit.analyze(db)
    assert not ({r["user_id"] for r in again["backfill"]} & ids)               # re-running finds nothing left to do
    assert audit.apply_backfill(db, again) == 0
    dumped = json.dumps(report)
    assert "hashed_password" not in dumped and STUDENT_PASSWORD not in dumped
    # and the backfilled student can now use the link of their organization
    assert access(signed_in(by_profile), world["job"]["share_token"]).json()["status"] == "READY"


# ------------------------------------------------------------------------------ 3. administrator retake links
def _retake_setup(db, world, name="Retake Student"):
    user = make_student(db, world, world["a"]["org"], name)
    c = signed_in(user)
    started = begin(c, world["job"])
    s = session_of(db, started["session_uuid"])
    s.current_state = "MANUAL_REVIEW_REQUIRED"
    db.commit()
    reg = db.query(models.CandidateRegistration).filter_by(id=s.registration_id).one()
    r = client.post(f"/api/admin/recruitment/candidates/{reg.id}/authorize-retake", headers=h.auth(world["a"]["token"]),
                    json={"justification": "Verified platform outage during the sitting."})
    assert r.status_code == 200, r.text
    return user, c, started, reg, r.json()["registration_token"]


def test_retake_link_requires_the_students_own_sign_in(db, world):
    user, uc, old, reg, retake = _retake_setup(db, world)
    share = world["job"]["share_token"]
    other = make_student(db, world, world["a"]["org"], "Other Student")
    sessions_before = db.query(models.RoleReadySession).filter_by(job_description_id=world["job"]["id"]).count()

    info = client.post(f"{PUBLIC}/{share}/registration-info", headers={"X-Registration-Token": retake})
    assert info.status_code == 200 and info.json() == {"valid": True, "student_login_required": True}
    assert client.post(f"{PUBLIC}/{share}/registration-info", headers={"X-Registration-Token": "not-a-token"}).status_code == 403
    assert client.post(f"{PUBLIC}/{share}/registration-info").status_code == 401

    # the token alone opens nothing: no sign-in, no access; no sitting can be started with it
    assert client.post(f"{API}/{share}/access", json={"retake_token": retake}).status_code == 401
    assert client.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": retake}, json={"acknowledged": True}).status_code == 401
    # another student cannot use it, with or without presenting it
    oc = signed_in(other)
    assert oc.post(f"{API}/{share}/access", json={"retake_token": retake}).status_code == 403
    assert oc.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": retake}, json={"acknowledged": True}).status_code == 401
    assert db.query(models.RoleReadySession).filter_by(job_description_id=world["job"]["id"]).count() == sessions_before

    # the owner signs in, presents the token and is taken to the instructions: still no attempt
    got = uc.post(f"{API}/{share}/access", json={"retake_token": retake})
    assert got.status_code == 200 and got.json()["status"] == "READY"
    assert db.query(models.RoleReadySession).filter_by(job_description_id=world["job"]["id"]).count() == sessions_before
    started = uc.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": got.json()["registration_token"]}, json={"acknowledged": True})
    assert started.status_code == 200
    db.expire_all()
    assert session_of(db, old["session_uuid"]).current_state == "REVOKED_RETRIED"      # the old attempt stays archived
    assert db.query(models.RoleReadySession).filter_by(job_description_id=world["job"]["id"]).count() == sessions_before + 1
    audit = db.query(models.ActivityLog).filter_by(action="ASSESSMENT_RETAKE_AUTHORIZED", target=f"registration:{reg.id}").count()
    assert audit == 1                                                                   # one authorisation, one audit record

    # reused: the same token cannot start a second attempt, and the link says so
    assert client.post(f"{PUBLIC}/{share}/registration-info", headers={"X-Registration-Token": retake}).status_code in (403, 409)
    assert uc.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": retake}, json={"acknowledged": True}).status_code in (403, 409)
    again = uc.post(f"{API}/{share}/access", json={"retake_token": got.json()["registration_token"]})
    assert again.status_code == 409


def test_retake_links_respect_link_expiry_and_closure(db, world, monkeypatch):
    user, uc, old, reg, retake = _retake_setup(db, world, "Expiry Retake")
    share = world["job"]["share_token"]
    clock = h.FakeClock(datetime.now(timezone.utc) + timedelta(hours=30))
    monkeypatch.setattr(assessment_clock, "now", clock.now)
    assert client.post(f"{PUBLIC}/{share}/registration-info", headers={"X-Registration-Token": retake}).status_code == 410
    assert uc.post(f"{API}/{share}/access", json={"retake_token": retake}).status_code == 410
    assert uc.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": retake}, json={"acknowledged": True}).status_code == 410


def test_accountless_retake_links_keep_working_without_a_sign_in(db, world):
    share = world["job"]["share_token"]
    cap, email = h.register_ok(share, name="Accountless Retake")
    started = client.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": cap}, json={"acknowledged": True}).json()
    s = session_of(db, started["session_uuid"])
    s.current_state = "INFRASTRUCTURE_FAILURE"
    db.commit()
    reg = db.query(models.CandidateRegistration).filter_by(id=s.registration_id).one()
    r = client.post(f"/api/admin/recruitment/candidates/{reg.id}/authorize-retake", headers=h.auth(world["a"]["token"]), json={"justification": "Verified outage."})
    token = r.json()["registration_token"]
    assert client.post(f"{PUBLIC}/{share}/registration-info", headers={"X-Registration-Token": token}).json() == {"valid": True, "student_login_required": False}
    assert client.post(f"{PUBLIC}/{share}/start", headers={"X-Registration-Token": token}, json={"acknowledged": True}).status_code == 200


def test_the_application_never_follows_a_redirect_target_from_the_url():
    """Where the student lands is computed from the share token only; no `next` / `redirect` / `returnTo` parameter is read anywhere."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[2] / "frontend" / "src"
    for rel in ("pages/candidate/SharedAssessmentEntry.jsx", "components/candidate/StudentAccessLogin.jsx", "pages/candidate/StudentAssessmentComplete.jsx"):
        src = (root / rel).read_text(encoding="utf-8")
        for param in ("'next'", "'redirect'", "'returnTo'", "'return_to'", "'continue'", "'url'"):
            assert f"searchParams.get({param})" not in src and f"get({param})" not in src, (rel, param)


# ------------------------------------------------------------------------------ 4. a sitting needs its student, not just its token
def test_a_leaked_session_token_cannot_drive_a_students_sitting(db, world):
    owner = make_student(db, world, world["a"]["org"], "Sitting Owner")
    thief = make_student(db, world, world["a"]["org"], "Sitting Thief")
    oc, tc = signed_in(owner), signed_in(thief)
    started = begin(oc, world["job"])
    hdr = h.sh(started)                                                              # the capability AND the lease: everything a leak could expose
    for call in (lambda c: c.get(h.sess_url(started, "state"), headers=hdr),
                 lambda c: c.post(h.sess_url(started, "heartbeat"), headers=hdr),
                 lambda c: c.put(h.sess_url(started, "draft"), headers=hdr, json={"section": "aptitude", "payload": {}}),
                 lambda c: c.post(h.sess_url(started, "submit-aptitude"), headers=hdr, json={"answers": {}})):
        assert call(client).status_code == 401, "anonymous holder of the tokens"
        assert call(tc).status_code == 401, "another signed-in student holding the tokens"
    assert oc.post(h.sess_url(started, "heartbeat"), headers=hdr).status_code == 200      # the owner is unaffected
    assert session_of(db, started["session_uuid"]).current_state == "APTITUDE_IN_PROGRESS"   # nothing was submitted by the others


def test_accountless_sittings_are_not_affected_by_the_ownership_binding(db, world):
    share = world["job"]["share_token"]
    cap, _ = h.register_ok(share, name="Plain Candidate")
    started = h.start_ok(share, cap)
    assert client.post(h.sess_url(started, "heartbeat"), headers=h.sh(started)).status_code == 200


# ------------------------------------------------------------------------------ 5/6. limits and report contents
def test_oversized_review_bodies_are_refused_before_processing(db, world):
    _, c, uuid = completed_student(db, world, "Huge Review")
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": "word " * 30000}).status_code == 422
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": "x" * 5001 + " " + WORDS_30}).status_code == 422   # policy cap, not just schema
    assert db.query(models.AssessmentReview).filter_by(session_id=session_of(db, uuid).id).count() == 0


def test_student_report_has_exactly_the_whitelisted_fields(db, world):
    _, c, uuid = completed_student(db, world, "Whitelist Check")
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    rep = c.get(f"{API}/attempts/{uuid}/report").json()
    assert set(rep) == {"assessment", "student", "completed_at", "overall_score", "overall_status", "scoring_model", "sections"}
    assert set(rep["assessment"]) == {"title", "role", "organization"} and set(rep["student"]) == {"name", "email"}
    by = {s["key"]: s for s in rep["sections"]}
    base = {"key", "label", "status", "score", "time_spent_seconds"}
    assert set(by["aptitude"]) == base | {"summary", "questions"}
    assert set(by["aptitude"]["questions"][0]) == {"question", "domain", "selected", "is_correct"}        # no options, key or explanation
    assert set(by["coding"]) == base | {"problems"}
    assert set(by["coding"]["problems"][0]) == {"title", "language", "passed_tests", "total_tests", "score", "message"}
    assert set(by["interview"]) == base | {"summary", "technical_depth_score", "communication_score", "key_strengths", "key_areas_for_improvement", "questions"}
    stored = session_of(db, uuid).final_report_data
    assert rep["overall_score"] == stored["overall_score"]                                          # stored result, not recomputed
    db.expire_all()
    s = session_of(db, uuid)
    assert s.final_report_data == stored                                                            # fetching a report changes nothing


def test_report_never_exposes_another_students_data_or_an_unrelated_existence(db, world):
    _, oc, uuid = completed_student(db, world, "Report Owner")
    other = make_student(db, world, world["a"]["org"], "Report Other")
    tc = signed_in(other)
    missing = tc.get(f"{API}/attempts/{'f' * 8}-0000-4000-8000-{'0' * 12}/report")
    foreign = tc.get(f"{API}/attempts/{uuid}/report")
    assert missing.status_code == foreign.status_code == 404
    assert missing.json() == foreign.json()                                                         # indistinguishable from "does not exist"


# ------------------------------------------------------------------------------ security checks
def test_student_and_admin_sessions_cannot_stand_in_for_each_other(db, world):
    student = make_student(db, world, world["a"]["org"], "Isolated Student")
    sc = signed_in(student)
    assert sc.get("/api/admin/job-roles/").status_code in (401, 403)
    assert sc.post(f"/api/admin/job-roles/{world['job']['id']}/invitations", json={"student_ids": [student.id]}).status_code in (401, 403)
    assert sc.get("/api/admin/users/").status_code in (401, 403)
    admin = lah.ensure_user(db, f"adm.{h.new_tag()}@rwtest.com", "ADMIN", org=world["a"]["org"], password=STUDENT_PASSWORD, admin_membership=True)
    world["created"].append(admin.id)
    ac = signed_in(admin)
    assert access(ac, world["job"]["share_token"]).status_code == 403
    assert ac.get(f"{API}/{world['job']['share_token']}/result").status_code == 403


def test_session_cookie_flags_follow_the_production_configuration(db, world, monkeypatch):
    student = make_student(db, world, world["a"]["org"], "Cookie Student")
    for env, secure in (({"ENVIRONMENT": "production", "DEBUG": "false"}, True), ({"ENVIRONMENT": "development"}, False)):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
        lah.reset_login_limits()
        r = lah.new_client().post("/api/auth/login/", json={"email": student.email, "password": STUDENT_PASSWORD})
        cookie = r.headers["set-cookie"].lower()
        assert r.status_code == 200 and "httponly" in cookie and "samesite=lax" in cookie, cookie
        assert ("secure" in cookie.replace("samesite", "")) is secure, cookie
        assert STUDENT_PASSWORD not in r.text


def test_failures_expose_no_internals(db, world, monkeypatch):
    _, c, uuid = completed_student(db, world, "Quiet Failure")
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    monkeypatch.setattr(svc, "build_student_report", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret internal path C:/x/y.py")))
    r = c.get(f"{API}/attempts/{uuid}/report")
    assert r.status_code == 503 and not any(w in r.text for w in ("Traceback", "secret internal", "C:/", "sqlalchemy", "password"))
