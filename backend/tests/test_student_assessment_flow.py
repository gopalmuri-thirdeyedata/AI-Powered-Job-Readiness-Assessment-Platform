"""
Invited-student workflow: sign in with the account an administrator created -> instructions -> (explicit) start -> mandatory
30-word review -> report download. Real login sessions (HttpOnly cookie + CSRF), the real assessment engine on a scratch database,
offline Gemini and a local sandbox. The report-generation failure is simulated; nothing else is mocked.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import models
from services import assessment_clock
from services import review_policy
from services import student_assessment_service as svc
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h

client = h.client
PUBLIC = "/api/public/assessment"
API = "/api/student-assessment"
WORDS_30 = " ".join(f"word{i}" for i in range(30))
STUDENT_PASSWORD = "Zx9#pLm2!qWe-4417"
CASES = json.loads((Path(__file__).parent / "data" / "word_count_cases.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------------------ fixtures
@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def world(db):
    mp = pytest.MonkeyPatch()
    h.install_local_sandbox(mp)
    h.patch_interview_eval(mp)
    a, b = h.make_admin(db), h.make_admin(db)
    job = h.create_published_job(a, mp)
    mp.undo()
    created = []
    yield {"a": a, "b": b, "job": job, "created": created}
    ids = created
    if ids:
        db.rollback()
        sess_ids = [r[0] for r in db.query(models.RoleReadySession.id).filter(models.RoleReadySession.organization_id == a["org"].id)]
        if sess_ids:
            db.query(models.AssessmentReview).filter(models.AssessmentReview.session_id.in_(sess_ids)).delete(synchronize_session=False)
        db.query(models.StudentProfile).filter(models.StudentProfile.user_id.in_(ids)).delete(synchronize_session=False)
        db.query(models.AuthSession).filter(models.AuthSession.user_id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    h.cleanup_orgs(db, [a["org"].id, b["org"].id])
    if ids:
        db.query(models.User).filter(models.User.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    from routers import student_assessment
    student_assessment.access_limiter.reset()
    lah.reset_login_limits()
    yield
    h.reset_public_limiters()


def make_student(db, world, org, name, active=True):
    tag = h.new_tag()
    email = f"{name.lower().replace(' ', '.')}.{tag}@rwtest.com"
    user = lah.ensure_user(db, email, models.UserRole.STUDENT.value, org=org, password=STUDENT_PASSWORD, active=active,
                           student_profile=True, full_name=name)
    user.full_name = name
    user.phone = "+14155550123"
    db.commit()
    world["created"].append(user.id)
    return user


def signed_in(user, password=STUDENT_PASSWORD):
    c, res = lah.login(user.email, password)
    c.headers["X-CSRF-Token"] = res.json()["csrf_token"]
    return c


def access(c, token):
    return c.post(f"{API}/{token}/access")


def begin(c, job, ack=True):
    """access -> explicit start. Returns the started attempt."""
    got = access(c, job["share_token"])
    assert got.status_code == 200 and got.json()["status"] == "READY", got.text
    r = c.post(f"{PUBLIC}/{job['share_token']}/start", headers={"X-Registration-Token": got.json()["registration_token"]}, json={"acknowledged": ack})
    assert r.status_code == 200, r.text
    return r.json()


def finish(db, c, started, correct=15):
    """Submit the three sections exactly like a real sitting does."""
    assert c.post(h.sess_url(started, "submit-aptitude"), headers=h.sh(started), json={"answers": h.correct_aptitude_answers(db, started["session_uuid"], correct)}).status_code == 200
    assert c.post(h.sess_url(started, "submit-coding"), headers=h.sh(started), json={"solutions": h.GOOD_SOLUTIONS}).status_code == 200
    r = c.post(h.sess_url(started, "submit-interview"), headers=h.sh(started), json={"answers": {f"I{i}": "my answer" for i in range(1, 6)}})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED", r.text


def completed_student(db, world, name="Maya Patel"):
    user = make_student(db, world, world["a"]["org"], name)
    c = signed_in(user)
    started = begin(c, world["job"])
    finish(db, c, started)
    return user, c, started["session_uuid"]


def session_of(db, uuid):
    db.expire_all()
    return db.query(models.RoleReadySession).filter_by(session_uuid=uuid).first()


# ------------------------------------------------------------------------------ authentication and access
def test_anonymous_cannot_access_but_the_link_metadata_shows_no_questions(world):
    token = world["job"]["share_token"]
    assert client.post(f"{API}/{token}/access").status_code == 401
    meta = client.get(f"{PUBLIC}/{token}")
    assert meta.status_code == 200
    text = json.dumps(meta.json()).lower()
    assert "question" not in meta.json() and "correct_key" not in text and "hidden" not in text.replace("hidden tests", "")


def test_student_signs_in_and_gets_access_without_retyping_anything(db, world):
    user = make_student(db, world, world["a"]["org"], "Liam Chen")
    before_users = db.query(models.User).count()
    c = signed_in(user)
    r = c.post(f"{API}/{world['job']['share_token']}/access")        # no body: nothing is asked again
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "READY" and body["student"] == {"name": "Liam Chen", "email": user.email}
    assert body["registration_token"] and body["assessment"]["sections"] and body["assessment"]["rules"]
    # only the public metadata: sections, limits and rules. No question payload, answer key or section content
    assert set(body["assessment"]) == {"title", "role", "company_name", "organization_name", "description_snippet", "sections", "total_duration_minutes", "rules"}
    assert "correct_key" not in json.dumps(body) and all(set(s) == {"key", "label", "minutes"} for s in body["assessment"]["sections"])

    db.expire_all()
    reg = db.query(models.CandidateRegistration).filter_by(job_description_id=world["job"]["id"], student_user_id=user.id).one()
    assert (reg.name, reg.email, reg.phone, reg.status) == ("Liam Chen", user.email, "+14155550123", "REGISTERED")
    assert reg.attempt_session_uuid is None
    # access is not an attempt: no session, no timer, no extra account
    assert db.query(models.RoleReadySession).filter_by(registration_id=reg.id).count() == 0
    assert db.query(models.User).count() == before_users


def test_wrong_credentials_are_rejected_and_repeated_failures_are_throttled(db, world):
    user = make_student(db, world, world["a"]["org"], "Wrong Pass")
    c = lah.new_client()
    for _ in range(3):
        r = c.post("/api/auth/login/", json={"email": user.email, "password": "not-the-password"})
        assert r.status_code == 401 and "session" not in r.headers.get("set-cookie", "").lower()
    assert access(c, world["job"]["share_token"]).status_code == 401      # still nothing
    last = None
    for _ in range(12):
        last = c.post("/api/auth/login/", json={"email": user.email, "password": "still-wrong"})
    assert last.status_code == 429 and "Retry-After" in last.headers
    # even the right password is refused while throttled (existing protection)
    assert c.post("/api/auth/login/", json={"email": user.email, "password": STUDENT_PASSWORD}).status_code == 429


@pytest.mark.parametrize("role", [models.UserRole.ADMIN.value, models.UserRole.SUPER_ADMIN.value])
def test_admin_accounts_cannot_take_the_assessment(db, world, role):
    org = world["a"]["org"]
    admin = lah.ensure_user(db, f"adm.{h.new_tag()}@rwtest.com", role, org=org, password=STUDENT_PASSWORD, admin_membership=True)
    world["created"].append(admin.id)
    c = signed_in(admin)
    r = access(c, world["job"]["share_token"])
    assert r.status_code == 403 and "student" in r.json()["detail"].lower()
    assert db.query(models.CandidateRegistration).filter_by(job_description_id=world["job"]["id"], student_user_id=admin.id).count() == 0
    bearer = {"Authorization": f"Bearer {h.make_admin(db, org=org)['token']}"}
    assert client.post(f"{API}/{world['job']['share_token']}/access", headers=bearer).status_code == 403


def test_student_of_another_organization_is_not_authorized(db, world):
    outsider = make_student(db, world, world["b"]["org"], "Outside Student")
    r = access(signed_in(outsider), world["job"]["share_token"])
    assert r.status_code == 403
    assert db.query(models.CandidateRegistration).filter_by(student_user_id=outsider.id).count() == 0


def test_deactivated_student_cannot_sign_in(db, world):
    user = make_student(db, world, world["a"]["org"], "Gone Student", active=False)
    c = lah.new_client()
    assert c.post("/api/auth/login/", json={"email": user.email, "password": STUDENT_PASSWORD}).status_code == 403


def test_expired_closed_and_unknown_links(db, world, monkeypatch):
    mp = pytest.MonkeyPatch()
    org = world["a"]["org"]
    user = make_student(db, world, org, "Late Student")
    c = signed_in(user)
    assert access(c, "x" * 40).status_code == 404

    admin = world["a"]
    fresh = h.create_published_job(admin, mp, title="Short Lived Role")
    clock = h.FakeClock(datetime(2030, 1, 15, 9, 0, tzinfo=timezone.utc))
    mp.setattr(assessment_clock, "now", clock.now)
    try:
        # the 24 h window is the existing server policy; the link was created on the real clock, so move past it
        clock.set(datetime.now(timezone.utc) + timedelta(hours=25))
        r = access(c, fresh["share_token"])
        assert r.status_code == 410 and "expired" in r.json()["detail"].lower()
    finally:
        mp.undo()
    closed = h.create_published_job(admin, monkeypatch, title="Closed Role")
    assert client.post(f"/api/admin/job-roles/{closed['id']}/close", headers=h.auth(admin["token"])).status_code == 200
    r = access(c, closed["share_token"])
    assert r.status_code == 410 and "closed" in r.json()["detail"].lower()
    assert db.query(models.CandidateRegistration).filter_by(student_user_id=user.id).count() == 0


# ------------------------------------------------------------------------------ the start is explicit and single-use
def test_start_needs_the_signed_in_owner_and_explicit_acknowledgement(db, world):
    owner = make_student(db, world, world["a"]["org"], "Owner One")
    other = make_student(db, world, world["a"]["org"], "Other Two")
    token = world["job"]["share_token"]
    oc = signed_in(owner)
    capability = access(oc, token).json()["registration_token"]
    start = lambda c: c.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": capability}, json={"acknowledged": True})

    assert client.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": capability}, json={"acknowledged": True}).status_code == 401
    assert start(signed_in(other)).status_code == 401                     # a leaked token is useless to another student
    r = oc.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": capability}, json={"acknowledged": False})
    assert r.status_code == 422                                           # rules must be acknowledged explicitly
    db.expire_all()
    reg = db.query(models.CandidateRegistration).filter_by(student_user_id=owner.id, job_description_id=world["job"]["id"]).one()
    assert reg.status == "REGISTERED" and reg.attempt_session_uuid is None
    assert db.query(models.RoleReadySession).filter_by(registration_id=reg.id).count() == 0   # nothing consumed so far

    ok = start(oc)
    assert ok.status_code == 200 and ok.json()["state"]["section"]["key"] == "aptitude"
    assert session_of(db, ok.json()["session_uuid"]).registration_id == reg.id


def test_single_attempt_is_still_enforced(db, world):
    user = make_student(db, world, world["a"]["org"], "Once Only")
    c = signed_in(user)
    token = world["job"]["share_token"]
    cap = access(c, token).json()["registration_token"]
    first = c.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": cap}, json={"acknowledged": True})
    assert first.status_code == 200
    again = c.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": cap}, json={"acknowledged": True})
    assert again.status_code in (403, 409)
    r = access(c, token).json()                                           # going back to the link never yields a new attempt
    assert r["status"] == "ATTEMPTED" and "registration_token" not in r and r["attempt"]["in_progress"] is True
    assert db.query(models.RoleReadySession).filter_by(job_description_id=world["job"]["id"], registration_id=session_of(db, first.json()["session_uuid"]).registration_id).count() == 1


def test_access_rotates_the_unused_start_capability(db, world):
    user = make_student(db, world, world["a"]["org"], "Came Back")
    c = signed_in(user)
    token = world["job"]["share_token"]
    t1 = access(c, token).json()["registration_token"]
    t2 = access(c, token).json()["registration_token"]                    # returning later (new tab / next day) works
    assert t1 != t2
    assert c.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": t1}, json={"acknowledged": True}).status_code == 403
    assert db.query(models.CandidateRegistration).filter_by(student_user_id=user.id, job_description_id=world["job"]["id"]).count() == 1
    assert c.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": t2}, json={"acknowledged": True}).status_code == 200


def test_existing_candidate_registration_workflow_is_unchanged(db, world):
    token = world["job"]["share_token"]
    cap, email = h.register_ok(token, name="Walk In Candidate")           # the accountless path: no sign-in required
    r = client.post(f"{PUBLIC}/{token}/start", headers={"X-Registration-Token": cap}, json={"acknowledged": True})
    assert r.status_code == 200
    reg = db.query(models.CandidateRegistration).filter_by(email=email).one()
    assert reg.student_user_id is None


# ------------------------------------------------------------------------------ timers and scoring are untouched
def test_scores_and_timers_match_the_existing_engine(db, world):
    user = make_student(db, world, world["a"]["org"], "Score Check")
    c = signed_in(user)
    started = begin(c, world["job"])
    state = started["state"]
    assert state["section"]["remaining_seconds"] <= 20 * 60 and state["overall_remaining_seconds"] <= 60 * 60
    finish(db, c, started, correct=12)
    s = session_of(db, started["session_uuid"])
    assert round(s.aptitude_score, 2) == round(12 * 100 / 15, 2) and s.coding_score == 100.0
    assert s.overall_readiness_score == round((s.aptitude_score + s.coding_score + s.interview_score) / 3, 2)


# ------------------------------------------------------------------------------ the review
@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_word_count_matches_the_shared_vectors(case):
    assert review_policy.count_words(case["text"]) == case["words"]


@pytest.mark.parametrize("text,expected", [
    ("", 422), ("   \n\t  ", 422), ("too short", 422), (" ".join(["w"] * 29), 422), ("\n".join(["w"] * 29), 422),
    (" ".join(["w"] * 30), 200),
])
def test_review_threshold_is_enforced_by_the_server(db, world, text, expected):
    user, c, uuid = completed_student(db, world, f"Review Case {h.new_tag()}")
    r = c.post(f"{API}/attempts/{uuid}/review", json={"review": text})
    assert r.status_code == expected, r.text
    rows = db.query(models.AssessmentReview).filter_by(session_id=session_of(db, uuid).id).count()
    assert rows == (1 if expected == 200 else 0)
    if expected == 422:
        assert r.json()["detail"]["code"] in ("REVIEW_EMPTY", "REVIEW_TOO_SHORT")
        assert client.get(f"{API}/attempts/{uuid}/report").status_code == 401
        assert c.get(f"{API}/attempts/{uuid}/report").status_code == 403    # still locked after a rejected review


def test_review_accepts_exactly_30_and_more_than_30_words_with_messy_whitespace(db, world):
    _, c, uuid = completed_student(db, world, "Messy Whitespace")
    seps = [" ", "   ", "\n", "\r\n\r\n", "\t", " ", " \n "]
    messy = "  \n" + "".join(f"tok{i}{seps[i % len(seps)]}" for i in range(40)) + "\t "     # 40 words, every kind of separator
    assert review_policy.count_words(messy) == 40
    r = c.post(f"{API}/attempts/{uuid}/review", json={"review": messy})
    assert r.status_code == 200, r.text
    row = db.query(models.AssessmentReview).filter_by(session_id=session_of(db, uuid).id).one()
    assert row.word_count == 40 and row.review_text == messy.strip()
    assert r.json()["review"]["word_count"] == 40 and r.json()["report_available"] is True


def test_missing_or_non_string_review_field_is_rejected(db, world):
    _, c, uuid = completed_student(db, world, "Bad Payload")
    assert c.post(f"{API}/attempts/{uuid}/review", json={}).status_code == 422
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": None}).status_code == 422
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": ["a"] * 40}).status_code == 422
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": "word " * 2000}).status_code == 422   # over the size cap
    assert db.query(models.AssessmentReview).filter_by(session_id=session_of(db, uuid).id).count() == 0


def test_review_is_owned_stored_once_and_never_touches_the_attempt(db, world):
    user, c, uuid = completed_student(db, world, "Persist Me")
    before = session_of(db, uuid)
    snapshot = (before.current_state, before.aptitude_score, before.coding_score, before.interview_score,
                before.overall_readiness_score, json.dumps(before.final_report_data, sort_keys=True))
    sessions_before = db.query(models.RoleReadySession).count()
    regs_before = db.query(models.CandidateRegistration).count()

    r = c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30})
    assert r.status_code == 200
    row = db.query(models.AssessmentReview).filter_by(session_id=before.id).one()
    assert row.student_user_id == user.id and row.word_count == 30 and row.review_text == WORDS_30

    after = session_of(db, uuid)
    assert snapshot == (after.current_state, after.aptitude_score, after.coding_score, after.interview_score,
                        after.overall_readiness_score, json.dumps(after.final_report_data, sort_keys=True))
    assert db.query(models.RoleReadySession).count() == sessions_before            # no second attempt
    assert db.query(models.CandidateRegistration).count() == regs_before

    # immutable: a second submission (even a better one) is refused and the stored text is unchanged
    again = c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30 + " extra words here"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "REVIEW_ALREADY_SUBMITTED"
    assert db.query(models.AssessmentReview).filter_by(session_id=before.id).count() == 1
    db.expire_all()
    assert db.query(models.AssessmentReview).filter_by(session_id=before.id).one().review_text == WORDS_30


def test_review_is_refused_while_the_attempt_is_still_running(db, world):
    user = make_student(db, world, world["a"]["org"], "Still Running")
    c = signed_in(user)
    started = begin(c, world["job"])
    r = c.post(f"{API}/attempts/{started['session_uuid']}/review", json={"review": WORDS_30})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_SUBMITTED"


def test_nobody_else_can_review_or_read_a_students_attempt(db, world):
    owner, oc, uuid = completed_student(db, world, "Real Owner")
    thief = make_student(db, world, world["a"]["org"], "Would Be Thief")
    tc = signed_in(thief)
    assert tc.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 404
    assert tc.get(f"{API}/attempts/{uuid}/report").status_code == 404
    assert db.query(models.AssessmentReview).filter_by(session_id=session_of(db, uuid).id).count() == 0
    # the owner's review does not unlock anything for the other student either
    assert oc.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    assert tc.get(f"{API}/attempts/{uuid}/report").status_code == 404
    assert tc.get(f"{API}/{world['job']['share_token']}/result").status_code == 404
    assert client.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 401


# ------------------------------------------------------------------------------ the report
def test_report_is_blocked_until_a_valid_review_is_saved_then_released(db, world):
    user, c, uuid = completed_student(db, world, "Report Flow")
    blocked = c.get(f"{API}/attempts/{uuid}/report")
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "REVIEW_REQUIRED"
    assert "overall_score" not in blocked.text                            # nothing leaks in the refusal

    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    ok = c.get(f"{API}/attempts/{uuid}/report")
    assert ok.status_code == 200, ok.text
    rep = ok.json()

    stored = session_of(db, uuid).final_report_data
    assert rep["overall_score"] == stored["overall_score"] and rep["overall_status"] == "COMPLETED"
    assert rep["student"] == {"name": "Report Flow", "email": user.email}
    by_key = {s["key"]: s for s in rep["sections"]}
    assert [s["key"] for s in rep["sections"]] == ["aptitude", "coding", "interview"]
    for key in by_key:
        assert by_key[key]["score"] == stored["sections"][key]["score"]      # the engine's scores, nothing recomputed
    assert by_key["aptitude"]["summary"] == {"correct": 15, "total": 15}
    # answer keys, source code, transcripts and proctoring evidence never reach the student
    dumped = json.dumps(rep)
    for forbidden in ("correct_key", "transcript", "proctoring", "\"code\"", "hidden", "server_keys"):
        assert forbidden not in dumped, forbidden


def test_report_requires_a_completed_and_evaluated_attempt(db, world):
    _, c, uuid = completed_student(db, world, "Eval Pending")
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    s = session_of(db, uuid)
    saved_state, saved_report = s.current_state, s.final_report_data
    try:
        s.current_state = "EVALUATION_PENDING"
        db.commit()
        r = c.get(f"{API}/attempts/{uuid}/report")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "EVALUATION_PENDING"

        s.current_state, s.final_report_data = "COMPLETED", None
        db.commit()
        r = c.get(f"{API}/attempts/{uuid}/report")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "REPORT_NOT_READY"

        s.current_state, s.final_report_data = "TIMED_OUT", saved_report
        db.commit()
        assert c.get(f"{API}/attempts/{uuid}/report").status_code == 409
    finally:
        s.current_state, s.final_report_data = saved_state, saved_report
        db.commit()
    assert c.get(f"{API}/attempts/{uuid}/report").status_code == 200


def test_review_can_be_written_while_evaluation_is_pending_but_the_report_waits(db, world):
    _, c, uuid = completed_student(db, world, "Pending Review")
    s = session_of(db, uuid)
    s.current_state = "EVALUATION_PENDING"
    db.commit()
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    r = c.get(f"{API}/attempts/{uuid}/report")
    assert r.status_code == 409
    summary = c.get(f"{API}/{world['job']['share_token']}/result").json()["attempt"]
    assert summary["report_ready"] is False and summary["report_available"] is False and summary["review"]["word_count"] == 30


def test_a_tampered_or_short_stored_review_never_unlocks_the_report(db, world):
    _, c, uuid = completed_student(db, world, "Tampered Row")
    s = session_of(db, uuid)
    db.add(models.AssessmentReview(session_id=s.id, student_user_id=s.registration_id, review_text="far too short", word_count=99))
    db.commit()
    r = c.get(f"{API}/attempts/{uuid}/report")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "REVIEW_REQUIRED"   # recounted from the text, not trusted


def test_report_generation_failure_is_reported_and_can_be_retried(db, world, monkeypatch):
    _, c, uuid = completed_student(db, world, "Flaky Report")
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    calls = {"n": 0}
    real = svc.build_student_report

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom: internal detail")
        return real(*args, **kwargs)

    monkeypatch.setattr(svc, "build_student_report", flaky)
    failed = c.get(f"{API}/attempts/{uuid}/report")
    assert failed.status_code == 503 and failed.json()["detail"]["code"] == "REPORT_GENERATION_FAILED"
    assert "boom" not in failed.text                                       # internals stay in the server log
    assert db.query(models.AssessmentReview).filter_by(session_id=session_of(db, uuid).id).count() == 1   # review intact
    retry = c.get(f"{API}/attempts/{uuid}/report")
    assert retry.status_code == 200 and retry.json()["overall_score"] is not None


def test_report_endpoints_reject_other_roles_and_unknown_attempts(db, world):
    _, c, uuid = completed_student(db, world, "Role Matrix")
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    admin = h.make_admin(db, org=world["a"]["org"])
    bearer = {"Authorization": f"Bearer {admin['token']}"}
    assert client.get(f"{API}/attempts/{uuid}/report", headers=bearer).status_code == 403
    assert client.post(f"{API}/attempts/{uuid}/review", headers=bearer, json={"review": WORDS_30}).status_code == 403
    assert c.get(f"{API}/attempts/{'0' * 36}/report").status_code == 404
    assert c.get(f"{API}/attempts/not-a-session/report").status_code == 404


def test_results_stay_reachable_after_the_link_expires(db, world, monkeypatch):
    _, c, uuid = completed_student(db, world, "After Expiry")
    clock = h.FakeClock(datetime.now(timezone.utc) + timedelta(hours=30))
    monkeypatch.setattr(assessment_clock, "now", clock.now)
    token = world["job"]["share_token"]
    assert access(c, token).status_code == 410                             # the link itself is dead (existing 24 h policy)
    summary = c.get(f"{API}/{token}/result")                               # ...but the student can still finish up
    assert summary.status_code == 200 and summary.json()["attempt"]["completed"] is True
    assert c.post(f"{API}/attempts/{uuid}/review", json={"review": WORDS_30}).status_code == 200
    assert c.get(f"{API}/attempts/{uuid}/report").status_code == 200


def test_admin_roster_shows_the_student_by_name(db, world):
    user, c, uuid = completed_student(db, world, "Roster Visible")
    roster = client.get("/api/admin/recruitment/candidates", headers=h.auth(world["a"]["token"]), params={"search": "roster visible"}).json()
    assert [i["name"] for i in roster["items"]] == ["Roster Visible"]
    assert roster["items"][0]["status"] == "COMPLETED" and roster["items"][0]["email"] == user.email
