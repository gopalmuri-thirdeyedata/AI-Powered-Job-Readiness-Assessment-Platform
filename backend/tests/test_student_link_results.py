"""
A student who wrote the assessment through the admin's shared link sees that result on their own pages (dashboard, history, skill gap,
report). The match is by e-mail, only for FINISHED attempts of the same organization; in-progress or foreign attempts never appear.
"""
import uuid

import pytest

import models
import utils
from services import student_link_results
from tests import local_auth_helpers as lh
from tests import recruitment_helpers as h

client = h.client


@pytest.fixture(scope="module")
def db():
    session = h.new_session()
    yield session
    session.close()


@pytest.fixture(scope="module")
def env(db):
    mp = pytest.MonkeyPatch()
    admin = h.make_admin(db)
    job = h.create_published_job(admin, mp)
    yield {"admin": admin, "job": job, "token": job["share_token"]}
    mp.undo()
    h.cleanup_orgs(db, [admin["org"].id])


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    from routers import public_assessment
    monkeypatch.setattr(public_assessment, "_is_student_account_email", lambda *a, **kw: False)
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    student_link_results.reset_throttle()
    yield
    h.reset_public_limiters()


def _student(db, env, email=None):
    email = email or f"link.student.{uuid.uuid4().hex[:8]}@example.com"
    user = lh.ensure_user(db, email, models.UserRole.STUDENT, org=env["admin"]["org"], student_profile=True, full_name="Link Student")
    token = utils.create_access_token(data={"sub": user.email, "role": models.UserRole.STUDENT})
    return email, {"Authorization": f"Bearer {token}"}


def _write_link_test(db, env, email, finish=True):
    """The candidate registers with `email` on the admin's link and writes the whole assessment (or stops after coding)."""
    token, _ = h.register_ok(env["token"], email=email)
    s = h.start_ok(env["token"], token)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])}).status_code == 200
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS}).status_code == 200
    if finish:
        answers = [{"question_id": f"I{i}", "response": f"Answer {i}"} for i in range(1, 6)]
        r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": answers, "transcript": []})
        assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    return s


def test_before_the_test_the_student_sees_nothing_and_after_it_the_data_appears(db, env):
    email, auth = _student(db, env)
    before = client.get("/api/roleready/student/assessments", headers=auth)
    assert before.status_code == 200 and before.json()["total_attempted"] == 0

    s = _write_link_test(db, env, email)
    student_link_results.reset_throttle()

    after = client.get("/api/roleready/student/assessments", headers=auth)
    assert after.status_code == 200 and after.json()["total_completed"] == 1
    history = client.get("/api/student/performance/history", headers=auth)
    assert history.status_code == 200
    items = history.json()["items"] if "items" in history.json() else history.json().get("assessments", [])
    assert [i["raw_id"] for i in items] == [s["session_uuid"]] and items[0]["status"] == "COMPLETED" and items[0]["percentage"] is not None
    assert client.get("/api/student/performance/dashboard", headers=auth).status_code == 200
    assert client.get("/api/student/skill-gap", headers=auth).status_code == 200


def test_the_email_match_ignores_case_and_spaces(db, env):
    email, auth = _student(db, env)
    _write_link_test(db, env, f"  {email.upper()} ")
    student_link_results.reset_throttle()
    assert client.get("/api/roleready/student/assessments", headers=auth).json()["total_completed"] == 1


def test_an_unfinished_attempt_is_not_shown(db, env):
    email, auth = _student(db, env)
    _write_link_test(db, env, email, finish=False)
    student_link_results.reset_throttle()
    assert client.get("/api/roleready/student/assessments", headers=auth).json()["total_attempted"] == 0


def test_someone_elses_attempt_is_not_shown(db, env):
    _, auth = _student(db, env)
    _write_link_test(db, env, f"somebody.else.{uuid.uuid4().hex[:8]}@example.com")
    student_link_results.reset_throttle()
    assert client.get("/api/roleready/student/assessments", headers=auth).json()["total_attempted"] == 0


def test_another_organizations_attempt_is_not_shown(db, env):
    other = h.make_admin(db)
    try:
        email = f"cross.org.{uuid.uuid4().hex[:8]}@example.com"
        user = lh.ensure_user(db, email, models.UserRole.STUDENT, org=other["org"], student_profile=True, full_name="Other Org")
        auth = {"Authorization": "Bearer " + utils.create_access_token(data={"sub": user.email, "role": models.UserRole.STUDENT})}
        _write_link_test(db, env, email)                      # written on the FIRST organization's link
        student_link_results.reset_throttle()
        assert client.get("/api/roleready/student/assessments", headers=auth).json()["total_attempted"] == 0
    finally:
        h.cleanup_orgs(db, [other["org"].id])


def test_the_student_can_open_the_report_of_the_link_attempt(db, env):
    email, auth = _student(db, env)
    s = _write_link_test(db, env, email)
    student_link_results.reset_throttle()
    client.get("/api/roleready/student/assessments", headers=auth)          # triggers the match
    report = client.get(f"/api/roleready/session/{s['session_uuid']}/report", headers=auth)
    assert report.status_code == 200, report.text


def test_new_assessments_stay_locked_the_match_creates_nothing(db, env):
    email, auth = _student(db, env)
    _write_link_test(db, env, email)
    student_link_results.reset_throttle()
    before = db.query(models.RoleReadySession).count()
    client.get("/api/roleready/student/assessments", headers=auth)
    db.expire_all()
    assert db.query(models.RoleReadySession).count() == before


def test_only_the_owner_can_open_the_report_and_nothing_else_opens_for_link_attempts(db, env):
    email, auth = _student(db, env)
    s = _write_link_test(db, env, email)
    student_link_results.reset_throttle()
    client.get("/api/roleready/student/assessments", headers=auth)                       # attaches the attempt to this student
    _, other_auth = _student(db, env)
    uuid_ = s["session_uuid"]
    assert client.get(f"/api/roleready/session/{uuid_}/report", headers=other_auth).status_code == 404       # another student
    assert client.get(f"/api/roleready/session/{uuid_}/report").status_code == 401                            # nobody signed in
    # the exception is read-only and report-only: every action route still treats a link attempt as not found
    assert client.post(f"/api/roleready/session/{uuid_}/start-aptitude", headers=auth).status_code == 404
    assert client.post(f"/api/roleready/session/{uuid_}/voice-init", headers=auth).status_code == 404


# ------------------------------------------------------------------------------ the 20-word feedback that unlocks download / dashboard
TWENTY = " ".join(["word"] * 20)


def test_feedback_needs_twenty_real_words_and_unlocks_once_saved(db, env):
    email, auth = _student(db, env)
    s = _write_link_test(db, env, email)
    student_link_results.reset_throttle()
    client.get("/api/roleready/student/assessments", headers=auth)
    url = f"/api/roleready/session/{s['session_uuid']}/feedback"

    assert client.get(url, headers=auth).json() == {"submitted": False, "min_words": 20}
    short = client.post(url, headers=auth, json={"feedback": " ".join(["word"] * 19)})
    assert short.status_code == 422 and "20 words" in short.json()["detail"]
    assert client.post(url, headers=auth, json={"feedback": "-- " * 30}).status_code == 422          # punctuation is not words
    assert client.post(url, headers=auth, json={"feedback": ""}).status_code == 422
    assert client.get(url, headers=auth).json()["submitted"] is False                                # nothing was saved

    ok = client.post(url, headers=auth, json={"feedback": f"  {TWENTY}  "})
    assert ok.status_code == 200 and ok.json()["submitted"] is True
    assert client.get(url, headers=auth).json()["submitted"] is True
    again = client.post(url, headers=auth, json={"feedback": TWENTY + " and more words here"})
    assert again.status_code == 200
    db.expire_all()
    rows = db.query(models.AssessmentFeedback).all()
    assert len([r for r in rows if r.feedback_text.startswith("word")]) >= 1 and all(r.word_count >= 20 for r in rows)


def test_only_the_owner_can_read_or_send_feedback(db, env):
    email, auth = _student(db, env)
    s = _write_link_test(db, env, email)
    student_link_results.reset_throttle()
    client.get("/api/roleready/student/assessments", headers=auth)
    _, other = _student(db, env)
    url = f"/api/roleready/session/{s['session_uuid']}/feedback"
    assert client.get(url, headers=other).status_code == 404
    assert client.post(url, headers=other, json={"feedback": TWENTY}).status_code == 404
    assert client.post(url, json={"feedback": TWENTY}).status_code == 401


def test_too_long_feedback_is_refused(db, env):
    email, auth = _student(db, env)
    s = _write_link_test(db, env, email)
    student_link_results.reset_throttle()
    client.get("/api/roleready/student/assessments", headers=auth)
    r = client.post(f"/api/roleready/session/{s['session_uuid']}/feedback", headers=auth, json={"feedback": "word " * 800})
    assert r.status_code == 422
